---
name: workflow-builder
description: Design, scaffold, and review multi-agent workflows for any domain — video editing, social content, engineering pipelines. Walks through stage design, fan-out, multi-pass verification, and role boundaries; emits a Claude Code or OpenCode workflow skeleton you can fill in.
---

# Workflow Builder

A meta-skill for designing pipeline-style multi-agent workflows. The patterns are drawn from the A(i)-Team plugin's working architecture — staged kanban flow, fan-out within a stage, distinct-angle review passes, and hook-enforced role boundaries — but the skill itself is domain-agnostic. It fits video production, social content, engineering, ops, content moderation, anything where work moves through specialist hands.

## When to use

Trigger phrases:

- "design a multi-agent workflow"
- "build a pipeline of specialists"
- "scaffold a Claude Code plugin team"
- "scaffold an OpenCode workflow"
- "review my workflow"
- "I need a team of agents to handle <domain>"

Domain is open. The skill makes no assumption that the workflow is about code. Use it for:

- Video pipelines (ingest → rough cut → motion → color → audio → QC → export).
- Social content pipelines (ideate → draft → voice review → hook review → compliance → schedule → post → measure).
- Engineering pipelines (the A(i)-Team's TDD shape is one example).
- Ops, content moderation, research workflows, customer-support triage — any multi-stage flow with specialists and quality gates.

## Mental model

A workflow is a pipeline of stages. Each stage has a specialist with a defined boundary — what it writes, what it reads, what it must not touch. Reviewers approach work from distinct angles so each catches what the others miss.

## Three commands

- **`/workflow-builder:design`** — Interactive walkthrough that produces a design doc you can review and edit. See `commands/design.md`.
- **`/workflow-builder:scaffold`** — Reads a design doc and emits a Claude Code plugin skeleton, an OpenCode project skeleton, or both, with TODO markers you fill in. See `commands/scaffold.md`.
- **`/workflow-builder:review`** — Audits a built workflow plugin against the patterns and known anti-patterns. See `commands/review.md`.

## Reference index

Depth lives in `references/`. The commands point at these as you walk through decisions — you don't need to memorize the patterns.

**Architecture**

- `references/pipeline-stages.md` — Stage as the core primitive; transition matrix; immediate-advance-on-completion.
- `references/orchestration-and-fan-out.md` — Central vs peer-to-peer; event-driven loop; instance pools; per-stage WIP.
- `references/multi-pass-verification.md` — Distinct skeptic angles; earliest-flagged rejection routing; rejection cap.
- `references/role-boundaries.md` — Write/read scopes; hook-enforced (hard) vs prompt-only (soft).

**Format**

- `references/guardrail-skills.md` — Codify reviewer standards as skills, not as opinion.
- `references/plugin-anatomy.md` — Claude Code and OpenCode workflow file layouts.

**Tools**

- `references/design-template.md` — The 8-section template `/design` fills in.
- `references/scaffold-templates/` — Skeleton files emitted by `/scaffold` (`plugin.json.template`, `agent.md.template`, `command.md.template`, `hook.js.template`, `skill.md.template`).
- `references/anti-patterns.md` — What not to do; what `/review` scans for.

**Worked examples**

- `references/examples/video-pipeline.md` — Video production pipeline.
- `references/examples/social-pipeline.md` — Social content pipeline.
- `references/examples/ai-team-pipeline.md` — The A(i)-Team engineering pipeline (the source-of-truth implementation).
