# handoff eval

Manual. Spends real tokens (~$0.40 per replicate) and is deliberately **not**
wired into CI.

```bash
bun add -g @theaiteam/promptdiff
./run.sh              # one replicate
RUNS=3 ./run.sh       # three
```

## What it measures

Not "does the skill write a file" — that is trivially true and tells you
nothing. The question is whether what it wrote survives a context clear.

**Stage 1 (`compare`)** — a fresh agent reads `fixture/SESSION.md`, a synthetic
debugging session, and performs a handoff. Two arms:

| arm | instruction |
|---|---|
| baseline | a plain "summarize the current work so a later session can resume" |
| proposed | the real `handoff/SKILL.md` (copied in by `run.sh`, so the eval cannot drift from what ships) |

**Stage 2 — recall (`measure`)** — a *different* agent gets that progress file
plus the repository, with **no transcript**, and answers six fixed questions.

The questions live in `scenarios/resume.json` and are deliberately not generated
by the skill under test: a skill that writes its own exam grades itself. Three of
them are recoverable from the repository (`q1`, `q4`, `q5`); three exist **only**
in the session and can be answered only by a handoff that carried them:

- `q2` why in-memory dedupe was rejected (three replicas)
- `q3` what dependency the user ruled out (Redis)
- `q6` the candidate column names behind the blocking decision

**Stage 3 — consumption (`measure`)** — the stage that actually discriminates.
Recall saturates, because recalling is easy. What separates a good handoff from a
mediocre one is whether the agent that *ingests* it then acts correctly. A fresh
agent is asked to pick the work up and say what it would do next, and is scored
on behaviour rather than memory:

| signal | why it matters |
|---|---|
| blocker surfaced | did it flag the undecided column name, or quietly choose one |
| knew Redis was vetoed | the user's constraint, unrecoverable from the repo |
| knew in-memory was vetoed | the rejected approach and its reason |
| targets `schema.ts` | did the pointers land it in the right file |
| **re-proposed a vetoed fix** | the failure a weak handoff actually causes |
| ingest tokens / turns | what the handoff *costs* to consume — a summary that carries everything but costs more to read has not obviously won |

That last row is the one to watch. This whole skill exists to reduce token burn;
a handoff that is more expensive to ingest than a plain summary has to buy
something real with the difference.

## Instrument validation

An early run where the proposed arm produced no file at all scored **2/6**, and
the two it got were exactly `q1` and `q4` — the repo-recoverable questions, and
nothing session-only. The eval discriminates in the direction it is supposed to.

## Results (n=3)

**Recall is saturated. It does not discriminate and should not be read as a
score.** Both arms answered 18/18, including 9/9 on the session-only facts. The
fixture is one page; a plain "summarize this" carries it perfectly well.

Consumption, across two runs — the second after the Step 4 rewrite described
below. The baseline arm was **not modified between them**:

| | baseline (control) | proposed |
|---|---|---|
| ingest, run 1 | 16,443 tok / 4.7 turns | 24,974 tok / 6.0 turns |
| ingest, run 2 | **26,114 tok / 6.7 turns** | 21,982 tok / 5.7 turns |
| blocker surfaced | 3/3, 3/3 | 3/3, 3/3 |
| knew Redis vetoed | 3/3, 3/3 | 3/3, 3/3 |
| knew in-memory vetoed | 3/3, 3/3 | 3/3, 3/3 |
| re-proposed a vetoed fix | 0/3, 0/3 | 0/3, 0/3 |

**The ingest metric is not usable at n=3.** An unchanged control arm moved 59%
between runs — more than any effect being claimed for the treatment. Neither the
original "+52% to ingest" nor the later "−16%" is a real finding. Measuring
ingest cost credibly needs far more replicates or a lower-variance metric.

What does hold at this sample size:

- Neither arm ever re-proposed an approach the user had vetoed (6/6 runs).
- Both arms always surfaced the open decision rather than guessing past it.
- The skill's structural additions are real and free at read time: the stamp line
  the session hook parses for its staleness guard, the `progress.checks.md`
  artifact, and a fixed section schema a rewrite can target. The baseline's
  improvised headings are decent prose that nothing downstream can rely on.

**On the prose itself, the skill has not been shown to beat a one-line
instruction**, and that should stay written here until a run says otherwise.

### Long fixture (`FIXTURE=long`, n=3)

The short fixture saturating was expected — it is one page. `fixture-long/` was
built to be structurally hard rather than merely longer, around the failure that
costs most after an overnight gap: **a decision that was reversed mid-session.**
An advisory lock is implemented, then backed out after it deadlocks under three
replicas; the real answer is an idempotent upsert. It also carries a hypothesis
investigated and cleared (retry backoff), a constraint stated once and never
repeated (ship before Friday, so no schema migrations), a side-issue explicitly
parked (a logger bug), and three failing tests of which only one belongs to the
work.

| | baseline | proposed |
|---|---|---|
| recall overall | 17/18 | 18/18 |
| session-only facts | 12/12 | 12/12 |
| knew the lock was backed out | 3/3 | 3/3 |
| **re-proposed the backed-out lock** | 0/3 | 0/3 |
| **carried the parked distractor** | 0/3 | 0/3 |
| blocker surfaced | 3/3 | 3/3 |
| knew retry was cleared | 2/3 | 3/3 |
| targets the right file | 1/3 | 2/3 |
| ingest | 33,097 tok / 6.3 turns | 25,371 tok / 6.0 turns |

**None of the traps caught either arm.** Neither ever re-proposed the reversed
decision, neither dragged the parked distractor back in, and both carried every
session-only fact. The remaining gaps are single-run flips at n=3, and the ingest
difference sits inside the ±59% control variance measured above.

### The regime this cannot reach

Three fixtures across two shapes now say the same thing: **the skill's prose
guidance is not measurably better than a one-line instruction.** The likeliest
reason is that in every fixture here the writing agent can see the entire session
comfortably, so summarizing it well is easy. The regime the skill is actually for
— 400k of context, where the writing agent is itself under pressure and must
choose what to drop — needs a fixture 50–100× larger than these, and that costs
real money per replicate. Until someone spends it, "the prose guidance helps"
remains unsupported.

### Cost asymmetry worth knowing

`handoff/SKILL.md` is ~2,180 tokens; the baseline instruction is ~106. The skill
is inlined into every session that loads it. On the evidence here, the extra
~2,080 tokens buys the *structural* outputs — the stamp line the session hook
parses, the checks file, a fixed schema, the fallback path — and not better
prose. That is an argument for keeping the structural spec and trimming the
persuasion, not for keeping the file at its current length.

## What the eval caught

Worth recording, since it is the reason to have one:

- **The progress file was in the wrong directory.** The skill originally wrote to
  `.claude/progress.md`. In a sandboxed run the baseline degraded to the repo
  root and the skill refused, writing *nothing at all* — a total loss in CI or
  any restricted environment. The first fix was a fallback path; the real fix was
  to stop using a guarded directory. A control run confirms it directly: in one
  headless invocation with identical permissions, `.handoff/progress.md` was
  written and `.claude/progress.md` was blocked as a sensitive file. The
  canonical location is now `.handoff/`, and the fallback is gone.
- **"Write pointers, not summaries" was moving cost, not saving it.** The
  original Step 4 told the agent to prefer `file.ts:42` over stating the finding.
  Handoffs written that way carried 11 line references across 3 replicates, and
  the resuming agent dereferenced them. Step 4 now says to state the conclusion
  and attach the path as corroboration; line references dropped to 0 with recall
  unchanged at 18/18 — the same information, without sending the reader to go
  fetch it. (The token saving this was meant to demonstrate is the claim the
  control-arm variance above will not support.)

## Layout

```
agent-write.md          stage 1 framing (constant across arms)
agent-resume.md         stage 2 framing + answer contract
agent-continue.md       stage 3 framing + next-action contract
arms/baseline/SKILL.md  the "just summarize it" control
arms/proposed/SKILL.md  generated by run.sh from ../../handoff/SKILL.md (gitignored)
arms/neutral/SKILL.md   no-op for stages 2-3 (compare rejects an empty skill list)
fixture/                seed repo + SESSION.md
scenarios/*.json        promptdiff configs
run.sh                  stage 1 -> extract -> re-seed -> stages 2 and 3 -> score
```

Arm paths are kept the same shape on purpose. Skills are inlined under a header
naming their resolved path, so an asymmetric path is an asymmetric prompt.

The checked-in arms carry **no YAML frontmatter**, and should not have any added.
`skills add` walks five directory levels looking for any `SKILL.md` and registers
what it finds by frontmatter `name:`, so an arm with a name is offered to users as
an installable skill — which, for the baseline arm, means shipping the deliberately
weaker prompt this eval exists to reject. promptdiff strips frontmatter before
inlining (`src/prompt.ts`), so the arms lose nothing by omitting it. This is also
why the whole eval lives outside `handoff/`: anything under a skill directory is
copied into every user's skills directory on install.
