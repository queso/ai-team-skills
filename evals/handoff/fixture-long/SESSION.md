# Working session so far

A record of the conversation up to this point, oldest first. This has been a long
session.

---

**User:** Some orders are getting stuck in `pending_sync` and never make it to the shop. Not all of them. It's been happening for about two weeks but it got worse after we scaled the workers out.

One thing up front: whatever we do has to ship before Friday's billing run. That means no schema migrations — those need a maintenance window and we don't have one before Friday.

**Assistant:** Understood. Let me start with the logs and see what the stuck orders have in common.

```
$ kubectl logs -l app=billing-worker --since=24h | grep pending_sync | head -40
{"level":"info","message":"order received","ref_external":"EXT-88213","ref_shop":"shop_41","attempt":0}
{"level":"info","message":"resolving variant","ref_external":"EXT-88213","ref_shop":"shop_41"}
{"level":"info","message":"order received","ref_external":"EXT-88213","ref_shop":"shop_41","attempt":0}
{"level":"info","message":"resolving variant","ref_external":"EXT-88213","ref_shop":"shop_41"}
{"level":"error","message":"duplicate key value violates unique constraint \"order_sync_ref_external_ref_shop_key\"","ref_external":"EXT-88213"}
{"level":"info","message":"order received","ref_external":"EXT-88402","ref_shop":"shop_12","attempt":0}
{"level":"info","message":"resolving variant","ref_external":"EXT-88402","ref_shop":"shop_12"}
{"level":"info","message":"variant resolved","ref_external":"EXT-88402","ref_shop":"shop_12","status":"synced"}
{"level":"info","message":"order received","ref_external":"EXT-88517","ref_shop":"shop_41","attempt":0}
{"level":"info","message":"order received","ref_external":"EXT-88517","ref_shop":"shop_41","attempt":0}
{"level":"info","message":"resolving variant","ref_external":"EXT-88517","ref_shop":"shop_41"}
{"level":"info","message":"resolving variant","ref_external":"EXT-88517","ref_shop":"shop_41"}
{"level":"error","message":"duplicate key value violates unique constraint \"order_sync_ref_external_ref_shop_key\"","ref_external":"EXT-88517"}
{"level":"info","message":"order received","ref_external":"EXT-88604","ref_shop":"shop_03","attempt":1}
{"level":"info","message":"resolving variant","ref_external":"EXT-88604","ref_shop":"shop_03"}
{"level":"info","message":"variant resolved","ref_external":"EXT-88604","ref_shop":"shop_03","status":"synced"}
...
```

Two things stand out. The stuck ones are logged twice, near-simultaneously, and they end in a unique-constraint violation. The ones that succeed appear once.

Also worth noting for later: there is already a unique constraint on
`order_sync(ref_external, ref_shop)`. It exists in production today.

**User:** So it's a duplicate delivery problem?

**Assistant:** Possibly, but the interesting part is that the duplicate *fails* rather than being ignored. Let me check whether the retry backoff is redelivering too aggressively.

```
$ cat src/queue/retry.ts
```

Backoff is exponential with full jitter, base 250ms, capped at 6 attempts. That's not aggressive. Let me confirm empirically rather than eyeball it.

```
$ bun run scripts/replay-backoff.ts --attempts 10000
attempt 0: p50    118ms  p99    247ms
attempt 1: p50    241ms  p99    498ms
attempt 2: p50    503ms  p99    996ms
attempt 3: p50   1004ms  p99   1993ms
attempt 4: p50   1998ms  p99   3987ms
attempt 5: p50   4011ms  p99   7981ms
mean redeliveries within 1s window: 0.03
```

0.03 redeliveries per second-window. The backoff is not producing the double
delivery. **Ruling out the retry logic** — it's not the cause and we should stop
looking at `src/queue/retry.ts`.

**User:** OK. So where do the two come from?

**Assistant:** They aren't redeliveries of one message — they're two *different*
replicas handling the same order concurrently. Look at `resolveVariant()` in
`src/queue/variant-resolution.ts`: it does a `selectOne` and then an `insert`.
Two replicas can both miss the select and both attempt the insert. One wins, one
hits the unique constraint, throws, and the order is left at `pending_sync`.

That also explains why it got worse when we scaled out — more replicas, more
overlap.

**User:** That makes sense. How do we fix it?

**Assistant:** The direct fix is to serialize the resolve. Postgres advisory
locks would do it without touching the schema: take `pg_advisory_xact_lock` on a
hash of the external ref at the top of `resolveVariant()`, so only one replica
does the read-then-write at a time.

**User:** Fine, let's do that.

**Assistant:** Implementing it now in `src/queue/variant-resolution.ts`.

```
$ bun test tests/variant-resolution.test.ts
 8 pass
 0 fail
```

Green locally. Let me run it against a 3-replica setup to be sure.

```
$ docker compose -f compose.replicas.yml up --scale worker=3
$ bun run scripts/load.ts --orders 500 --concurrency 32

worker-1  | {"level":"info","message":"acquired advisory lock","key":8821302}
worker-2  | {"level":"info","message":"waiting on advisory lock","key":8821302}
worker-3  | {"level":"info","message":"waiting on advisory lock","key":8821302}
worker-1  | {"level":"info","message":"variant resolved","ref_external":"EXT-88213"}
worker-2  | {"level":"info","message":"acquired advisory lock","key":8840201}
worker-1  | {"level":"info","message":"waiting on advisory lock","key":8840201}
...
worker-3  | {"level":"error","message":"deadlock detected"}
worker-3  | Error: deadlock detected
worker-3  |     at PostgresError.from (src/db/client.ts:214:18)
worker-3  |     at PostgresConnection.parseErrorMessage (src/db/client.ts:388:9)
worker-3  |     at resolveVariant (src/queue/variant-resolution.ts:14:22)
worker-3  |     at processMessage (src/queue/worker.ts:18:11)
worker-1  | {"level":"error","message":"deadlock detected"}
worker-2  | {"level":"error","message":"canceling statement due to lock timeout"}

throughput: 41 orders/s  (baseline 380 orders/s)
errors: 63/500
```

That's much worse. The advisory lock deadlocks — orders touching multiple shops
take the locks in different orders across replicas, and throughput collapses by
an order of magnitude.

**Backing the advisory lock out entirely.** It is the wrong approach: it
deadlocks under 3 replicas and it costs 90% of throughput. Reverted
`src/queue/variant-resolution.ts` to its previous state.

**User:** Damn. What else?

**Assistant:** Don't serialize it — make the insert idempotent instead. We
already have the unique constraint on `(ref_external, ref_shop)`, so the insert
can become an upsert:

```sql
INSERT INTO order_sync (ref_external, ref_shop, status)
VALUES ($1, $2, 'pending_sync')
ON CONFLICT (ref_external, ref_shop) DO NOTHING
RETURNING *;
```

The loser of the race gets zero rows back instead of an exception, and proceeds
normally. No lock, no serialization, and — importantly for Friday — **no schema
migration**, because the constraint we need already exists.

**User:** That's better. Do it.

**Assistant:** Before I write it — while I was in the logger output I noticed
`createLogger().child()` in `src/util/logger.ts` shallow-merges its fields, so a
nested field set on the parent gets dropped when a child sets the same key. It's
why some of those log lines are missing `ref_shop`.

It is unrelated to this bug. I've written it up as a separate issue. **Not doing
it in this session** — flagging it so it isn't lost.

**User:** Agreed, leave it.

**Assistant:** Ran the full suite to see where we stand:

```
$ bun test
 47 pass
  3 fail

FAIL tests/webhook.test.ts > processes events in order
  expected 3 events in order, received [2, 1, 3]
      at tests/webhook.test.ts:88

FAIL tests/webhook.test.ts > acks after handler resolves
  expected ack to be called once, received 2
      at tests/webhook.test.ts:114

FAIL tests/variant-resolution.test.ts > returns undefined on first sight
  expected undefined, received { ref_external: 'EXT-1', status: 'pending_sync' }
      at tests/variant-resolution.test.ts:31
```

Of those three, the two in `tests/webhook.test.ts` are pre-existing — they fire
events concurrently and assert sequential delivery, and they were failing before
this work started. Unrelated, leave them.

The third one, in `tests/variant-resolution.test.ts`, is real and mine: the
upsert changes what `resolveVariant()` returns on first sight, and the test
still expects the old shape. That one has to be fixed as part of this change.

**User:** Got it.

**Assistant:** One thing I need from you before I can finish the upsert. The
`ON CONFLICT` target has to match an actual unique index. Today the constraint
is on `(ref_external, ref_shop)` — the pair. But if `ref_external` is globally
unique across all shops, the conflict target should just be `(ref_external)`,
and using the pair would let the same external ref sync twice under two
different shops.

Is `ref_external` unique globally, or only within a shop? I don't want to guess
this one — getting it wrong is a silent data problem, not a crash.

**User:** I'll have to check with the integrations team.

**Assistant:** Understood, parking there. Nothing further until that comes back.
