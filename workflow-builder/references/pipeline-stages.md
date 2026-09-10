# Pipeline Stages

What this is: the stage primitive that every workflow built with this skill is composed from. A stage is a discrete phase of work owned by exactly one specialist role, and the set of legal moves between stages is an explicit transition matrix — not a vibe.

---

## What a stage is

A stage is **one discrete phase of work, with one specialist role**. Concretely:

- A stage has a name (`rough-cut`, `voice-review`, `testing`).
- A stage has exactly one specialist role responsible for advancing items through it (`editor`, `voice-reviewer`, `tester`).
- A stage has a write boundary — see `role-boundaries.md` — that constrains what the specialist can touch.
- A stage has a definition-of-done. When that is met, the item moves on.

A "work item" is one unit flowing through the pipeline. Domain examples:

- Video pipeline: a single video clip from raw footage to final export.
- Social pipeline: a single post (or thread) from idea to scheduled publication.
- Engineering pipeline: a single feature or bug.

If a stage has more than one specialist role, that is a sign the stage should be split. If a specialist role spans more than one stage, that is a sign the role should be split. Stages and roles are 1:1 by design — the constraint is what makes ownership and review legible.

---

## The transition matrix

Every workflow has a fixed list of stages and a fixed list of allowed transitions between them. Encode the full set as a **transition matrix** — a map from each stage to the stages it can move to. Anything not in the matrix is illegal.

The A(i)-Team engineering pipeline encodes this in code (`packages/shared/src/stages.ts:14-23`):

```typescript
export const TRANSITION_MATRIX: Record<StageId, readonly StageId[]> = {
  briefings:    ['ready', 'blocked'],
  ready:        ['testing', 'implementing', 'probing', 'blocked', 'briefings'],
  testing:      ['implementing', 'blocked'],
  implementing: ['review', 'blocked'],
  probing:      ['ready', 'done', 'blocked'],
  review:       ['testing', 'implementing', 'probing', 'blocked'],
  done:         [],
  blocked:      ['ready'],
};
```

The matrix does three things:

1. **Forces a forward direction.** `testing → implementing` is allowed; `implementing → testing` is not — that is a rejection, with its own routing (see "Rejection edges" below).
2. **Names the terminal stages.** `done` has no outgoing transitions. `blocked` only goes back to `ready`.
3. **Catches typos at the boundary.** A stage move that is not in the matrix is rejected by the runtime, not silently accepted.

Validate every transition against the matrix at the runtime boundary. Do not rely on the orchestrator's prompt to "know" which moves are legal — make it impossible to express the wrong move.

---

## Immediate advance on completion

When a stage finishes its work on an item, that item advances **immediately**. Never batch-advance siblings.

The A(i)-Team orchestrator playbook spells this out (`agents/hannibal.md:199-252`):

> Within a wave, items flow through stages INDEPENDENTLY.
> 001 finishes testing → DON'T wait for 002 to also finish testing.
> Advance 001 to implementing IMMEDIATELY.

Why this matters: stage batching collapses pipeline parallelism. If you wait for every item at `rough-cut` to finish before any can move to `motion-graphics`, you have built a sequence of barriers, not a pipeline. Throughput drops to the slowest item per stage, every stage.

The correct picture is an assembly line where each stage runs independently:

```
Item 001:     [rough-cut] → [motion-graphics] → [color-grade] → ...
Item 002:           [rough-cut]   → [motion-graphics] → [color-grade] → ...
Item 003:                 [rough-cut] → [motion-graphics] → ...
```

Item 001 advances the moment its rough cut is done. It does not wait for 002.

The anti-pattern (`agents/hannibal.md:225-235`):

```
# WRONG — collecting completions then batch-processing
completed_testing = [item for item in testing if completed]
for item in completed_testing:
    move_to_implementing(item)   # Moving all at once = BATCH

# CORRECT — advance each item immediately on completion
if item_001_completed:
    move_001_to_implementing()   # Don't wait for 002
```

---

## Dependency waves vs stage batching

There is exactly one legitimate reason for an item to wait at the start of the pipeline: it depends on the output of another item. This is a **dependency wave**, and it is fundamentally different from stage batching.

- **Dependency wave (correct):** Item 003 depends on item 001's output. 003 sits in the first stage (`briefings` / `ingest` / `ideate`) until 001 reaches `done`. Other items in the same wave flow in parallel.
- **Stage batching (wrong):** All items at `rough-cut` wait for every other item also at `rough-cut` before any of them advance.

Quoting the A(i)-Team playbook (`agents/hannibal.md:237-252`):

> "Wave" refers to DEPENDENCY DEPTH, not pipeline stage.
> CORRECT: "Wave 2 items wait in ready stage until Wave 1 deps are done"
> WRONG: "All Wave 1 items must finish testing before any can implement"

The test for whether an item should be waiting:

- Is it waiting for **another item's output**? Legitimate (dependency wave).
- Is it waiting for **a sibling item at the same stage to finish**? Anti-pattern (stage batching).

---

## Three transition matrices side by side

The same primitive realizes in any domain. Three example pipelines:

### Video production pipeline

```
ingest         → rough-cut, blocked
rough-cut      → motion-graphics, blocked
motion-graphics→ color-grade, blocked
color-grade    → audio-mix, blocked
audio-mix      → final-qc, blocked
final-qc       → export, rough-cut, motion-graphics, color-grade, audio-mix, blocked
export         → done, blocked
done           → (terminal)
blocked        → ingest
```

Specialists, in order: ingest-agent, editor, motion-designer, colorist, audio-engineer, qc-agent, publisher. `final-qc` is the rejection hub — it can send back to any earlier production stage based on what the QC pass flagged (the earliest-flagged-stage principle from `multi-pass-verification.md`).

### Social content pipeline

```
ideate            → draft, blocked
draft             → voice-review, blocked
voice-review      → hook-review, draft, blocked
hook-review       → compliance-review, draft, blocked
compliance-review → schedule, draft, blocked
schedule          → posted, blocked
posted            → measured
measured          → done
blocked           → ideate
```

Specialists: trend-researcher, copywriter, voice-reviewer, hook-reviewer, compliance-reviewer, scheduler, publisher, analyst. Each reviewer can reject back to `draft` (where the copywriter reworks). Note that `posted` and `measured` are intentionally separate stages — once content is live, the work shifts from production to observation, and that is a different specialist.

### A(i)-Team engineering pipeline

The matrix shown earlier in this document (`packages/shared/src/stages.ts:14-23`). Specialists: Face (decomposes into `briefings`), Murdock (`testing`), B.A. (`implementing`), Lynch (`review`), Amy (`probing`), Stockwell (final review at mission end), Tawnia (post-mission documentation). The matrix permits `review` to send back to either `testing` or `implementing`, and `probing` to send back to `ready` — these are the rejection edges.

The point of placing these side by side: the **shape** is the same. Each pipeline has production stages, review stages, a terminal `done`, and a `blocked` escape hatch. What changes is the names and the specialists.

---

## Rejection edges

Some transitions in the matrix go backward through the pipeline. These are **rejection edges**, and they are the mechanism by which a reviewer sends an item back for rework.

In the engineering matrix:

- `review → testing` (reviewer found a missing or weak test)
- `review → implementing` (reviewer found a code defect, tests are fine)
- `probing → ready` (investigator found something requiring rework on multiple stages)

Two rules govern rejection edges:

1. **Always route to the earliest implicated stage.** If the rejection touches multiple earlier stages, send it to the earliest. This is covered in depth in `multi-pass-verification.md`.
2. **Cap the number of rejections per item.** After N rejections (default 2 in A(i)-Team), the item transitions to `blocked` for human review. This prevents infinite ping-pong.

Rejection edges look the same across domains:

- Video: `final-qc → audio-mix` (audio issue), `final-qc → motion-graphics` (graphics issue), `final-qc → rough-cut` (the cut itself is wrong).
- Social: `hook-review → draft`, `compliance-review → draft`.
- Engineering: `review → testing`, `review → implementing`.

---

## When to use this pattern

Use a stage-and-transition pipeline when:

- Work flows through a recognizable sequence of phases.
- Each phase needs a different skill set or perspective.
- You want explicit visibility into where each item is and who owns it.
- Multiple items are in flight at once and you want them flowing in parallel through stages.

## When NOT to use it

- A single specialist does the whole thing end-to-end with no handoffs. (One stage, one role — no need for a matrix.)
- The work has no natural phases — it is a single creative act with no review gates. (Use a single-step task instead.)
- Items must be processed strictly sequentially with no parallelism. (A queue is simpler than a kanban.)

---

## Designing your own matrix

A short procedure:

1. **List the phases of the work**, in order, from intake to ship. Name each one with a noun-or-verb that describes its output state, not the role doing it. (`rough-cut`, not `editor`.)
2. **Assign one specialist role per stage.** If two roles share a stage, split.
3. **Add `done` and `blocked`.** Every workflow needs both.
4. **Draw the forward edges.** Most stages have exactly one forward edge — the next stage in the line.
5. **Draw the rejection edges.** For each review/QC stage, list which earlier stages it can send work back to. Reviewers usually send back to the stage where the defect was created.
6. **Encode the matrix.** Put it in code or config — not in a prompt. Make illegal moves throw at the runtime boundary.

Once the matrix is locked, every other decision in `orchestration-and-fan-out.md`, `multi-pass-verification.md`, and `role-boundaries.md` is downstream of it.
