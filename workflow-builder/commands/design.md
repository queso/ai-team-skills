---
description: Walk through workflow design decisions and produce a design doc.
argument-hint: [workflow-name]
---

# /workflow-builder:design

Interactive walkthrough that produces a design doc for a multi-agent workflow. The doc is the input to `/workflow-builder:scaffold` and the audit target for `/workflow-builder:review`.

This command is **decision-driven and consultative** — at every step the assistant points at the relevant `references/*.md` so the user can read the depth before answering. The output is a markdown design doc the user reviews and edits before moving on.

## Step 1: Confirm scope

If the user provided a workflow name as an argument, use it. Otherwise ask:

- "What's the workflow called? (kebab-case, e.g. `video-pipeline`, `social-content`, `triage-bot`)"

Then ask, in one batched message:

- "What domain is this workflow for? (e.g. video editing, social content, engineering, ops, customer support, other)"
- "What does done look like in one sentence? — i.e. what artifact or outcome does the pipeline produce?"
- "What's the unit of work — a video, a post, a feature, a ticket?"

## Step 2: Suggest a starter shape

Based on the domain, read the matching example if one exists:

- video / film → `references/examples/video-pipeline.md`
- social / content / marketing → `references/examples/social-pipeline.md`
- engineering / coding → `references/examples/ai-team-pipeline.md`

If no example matches, propose a generic 4-stage shape: `intake → produce → review → ship`.

Show the starter shape and ask: "Use this as a starting point and refine, or design from scratch?"

## Step 3: Walk decisions in order

These match the 8 sections of `references/design-template.md`. Ask the user at each decision with 2-4 options where the choice space is bounded; ask freeform for names/IDs.

### 3.1 — Workflow goal & domain

Capture:

- One-sentence goal.
- Domain.
- Unit of work.
- Input / output artifacts.

Freeform — no options. Consult `references/pipeline-stages.md` for how stages relate to artifacts.

### 3.2 — Stages

Ask the user to list stages in order. Default to the starter shape from Step 2. Confirm:

- Stage names (kebab-case).
- The transition rules — does each stage advance to one next stage, or can it branch?
- Whether failed verification routes back through the pipeline.

Consult `references/pipeline-stages.md` for the transition-matrix pattern and immediate-advance-on-completion.

### 3.3 — Specialists per stage

For each stage, ask:

- Specialist role name.
- One-sentence responsibility.
- **Write boundary** — what files / artifacts can this role create or modify?
- **Read boundary** — what does it need to read?

Consult `references/role-boundaries.md` for the write/read scope pattern and the hard-vs-soft enforcement decision (covered later in step 3.7).

### 3.4 — Fan-out plan

Ask the user:

- Q: "How does work flow through this pipeline?"
  - **Sequential, one item at a time** — simple, low throughput, easy to reason about.
  - **Parallel within a stage** — multiple items at the same stage processed by N instances of the specialist (recommended for >1 item missions).
  - **Parallel across stages (pipeline parallelism)** — different items at different stages simultaneously, plus parallel within a stage.

If parallel, ask:

- Per-stage WIP cap — how many items can a stage hold at once?
- Are specialists pooled (multiple instances of the same role)?

Consult `references/orchestration-and-fan-out.md` for the per-stage WIP rule and instance pool pattern.

### 3.5 — Orchestration model

Ask the user:

- Q: "How do agents coordinate?"
  - **Central orchestrator** — one orchestrator dispatches every stage handoff. Simple, becomes a bottleneck at scale.
  - **Peer-to-peer** — agents hand off directly to the next agent. Fast, harder to recover from failure.
  - **Hybrid (recommended default)** — peer-to-peer handoffs for the happy path; central wakeup-on-alert for failures and rejections.

Consult `references/orchestration-and-fan-out.md` for the trade-offs and the message-protocol abstraction (`START / ACK / FYI / ALERT / REJECTED`).

### 3.6 — Verification passes

This is the headline mechanic. Ask the user:

- Q: "How many verification passes does the work go through?"
  - **One** — single review pass (only OK for very low stakes; collapses distinct angles).
  - **Two** — a primary review and a separate skeptic angle (recommended minimum for production work).
  - **Three or more** — multiple distinct angles plus a final holistic check.

For each pass, ask freeform:

- What angle does this reviewer take? (each pass should catch what the others can't see — e.g., for video: visual coherence vs audio mix vs delivery spec; for social: voice match vs engagement strength vs compliance)
- What does the reviewer reject for?
- Where does a rejection route to? (default: earliest stage implicated — see the reference)
- Rejection cap before the item moves to `blocked`? Default: **2**.

Consult `references/multi-pass-verification.md` for distinct-angle examples and the earliest-flagged-stage routing rule.

### 3.7 — Enforcement

For each role's write boundary from step 3.3, ask the user:

- Q: "How is this boundary enforced?"
  - **Hook-enforced (hard block)** — a hook prevents writes outside the scope. Use for boundaries where a violation breaks the pipeline (e.g., reviewer must not rewrite source).
  - **Prompt-only (soft)** — the agent is told to stay in scope. Use when the cost of a slip is low and you want flexibility.

Consult `references/role-boundaries.md` for when to escalate from soft to hard.

### 3.8 — Guardrail skills

For each reviewer role, ask the user:

- Q: "Should this reviewer's standard be codified as a skill?"
  - **Yes** — write the standard as a skill the reviewer references. Updates roll out centrally.
  - **No** — keep the standard in the reviewer's prompt. Faster to start, harder to maintain.

For each yes, ask the skill name (e.g. `brand-voice-guide`, `motion-design-standards`, `audio-loudness-spec`).

Consult `references/guardrail-skills.md` for the bad-vs-good diff (opinion-only review vs explicit-checklist review).

## Step 4: Produce the design doc

Use `references/design-template.md` as the structure. Fill in every section from the answers above. Save to `<workflow-name>-design.md` in the user's working directory.

Show the user the full doc and ask: "Edit anything before we wrap?"

## Step 5: Tell the user what's next

Print:

```
Design doc written to <workflow-name>-design.md.

Next steps:
  1. Review and edit the doc — anything ambiguous now will be ambiguous in the scaffolded plugin.
  2. When ready, run:
       /workflow-builder:scaffold <workflow-name>-design.md
```

## What this command does NOT do

- **Does not write code.** It produces a design doc only.
- **Does not install anything.** Scaffolding happens in the next command.
- **Does not make decisions for you.** It asks, suggests defaults, points at references — the user decides.
- **Does not validate against a target codebase.** It captures intent; `/workflow-builder:review` audits the built artifact later.
