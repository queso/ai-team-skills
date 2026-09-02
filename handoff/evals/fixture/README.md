# billing-worker (eval fixture)

Not a real project. This is the seed repository for the `handoff` skill eval — a
small, plausible codebase that the synthetic session in `SESSION.md` refers to,
so that file paths mentioned in a handoff are real paths an agent can verify.

```
src/queue/worker.ts     consumer; acks after charging
src/queue/handlers.ts   handleOrderCreated() issues the charge
src/db/schema.ts        table definitions, `ref_` prefix convention
```

`SESSION.md` also references `tests/webhook.test.ts`, which is deliberately
absent: a file matching `*.test.ts` anywhere in this repository would be
collected and executed by the real `bun test` run in CI.
