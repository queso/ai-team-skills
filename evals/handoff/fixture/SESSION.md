# Working session so far

A record of the conversation up to this point, oldest first.

---

**User:** Customers are getting charged twice for some orders. Started maybe a week ago, not every order, and I can't reproduce it locally.

**Assistant:** Let me look at how order events are consumed. Reading `src/queue/worker.ts`.

The consumer calls `processOrder()` and only acknowledges the message *after* the charge succeeds. If the charge succeeds but the ack times out, the broker redelivers and the order is charged again. That matches "not every order" — it needs the ack to fail.

**User:** That sounds right. How do we fix it?

**Assistant:** Simplest fix is a dedupe set in the worker — keep the last N order IDs in memory and skip anything we have already seen.

**User:** That won't work. We run 3 replicas of the worker in production. Each one would have its own set and none of them would know what the others processed.

**Assistant:** You're right, that's not viable. In-memory dedupe is dead — anything we do has to be shared across replicas.

The obvious shared store would be Redis, with a short TTL on the order ID.

**User:** No Redis. I'm not adding another piece of infrastructure to this stack for one bug. Use what we already have.

**Assistant:** Understood — no new infrastructure. We already have Postgres, so the durable option is an idempotency key stored in the database: a unique column on the charges table, written inside the same transaction as the charge. A redelivery hits the unique constraint and we treat that as already-done.

I ran the existing tests to see what's covered:

```
$ bun test tests/webhook.test.ts
 6 pass
 2 fail
```

Both failures are in the "processes events in order" test. Reading them, they fail because the test harness fires events concurrently and the assertions assume sequential delivery — a pre-existing test bug, not related to the double-charge. Leaving them alone for now so we don't confuse the two problems.

**User:** Fine, leave those. Where does the key go?

**Assistant:** It goes in `src/db/schema.ts`, on the charges table, plus a migration. I checked `src/queue/handlers.ts` too — `handleOrderCreated()` is where the charge is actually issued, so that is where the key gets written.

One thing I need you to decide before I write the migration: what to call the column. `idempotency_key` is the conventional name, but this table already uses a `ref_` prefix for external identifiers, so `ref_idempotency` would match the existing style. I don't want to guess and have it renamed in review.

**User:** Let me think about that one.
