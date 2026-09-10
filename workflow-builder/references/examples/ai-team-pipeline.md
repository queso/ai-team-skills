# Worked example: the A(i)-Team pipeline (source-of-truth implementation)

This is the multi-agent workflow that the `workflow-builder` skill abstracts its patterns from, mapped explicitly into the same template the other examples use. If you want to read the working code that proves these patterns out, every section here cites the source files.

Source repo: `/home/josh/Code/TheAITeam/the-ai-team-plugin/`. All citations below are paths relative to that repo root.

---

## 1. Workflow goal & domain

**Domain:** software engineering — turning Product Requirements Documents (PRDs) into shipped, tested, reviewed code.

**Goal:** consume a PRD, decompose it into independently-shippable feature items, and run each item through a strict TDD pipeline with adversarial multi-pass review until the whole mission is complete and documented.

**Unit of work:** one feature item (`WI-NNN`). Each item carries:
- `objective` — one behavioral sentence
- `acceptance` — measurable AC list
- `context` — integration points
- `outputs.test`, `outputs.impl`, optional `outputs.types` — destination paths
- `dependencies` — other item IDs that must reach `done` first

See `CLAUDE.md:103-141` for the full work-item schema.

**Input:** PRD in `prd/ready/`.
**Output:** merged code, passing tests, updated docs, final commit by Tawnia.

---

## 2. Stages

```
briefings -> ready -> testing -> implementing -> review -> probing -> done
                                                                       (+ blocked)
```

Stage list and transition matrix are defined in `packages/shared/src/stages.ts:1-23`.

### Transition matrix (verbatim from `packages/shared/src/stages.ts:14-23`)

| From | Valid forward transitions |
|------|---------------------------|
| `briefings` | `ready`, `blocked` |
| `ready` | `testing`, `implementing`, `probing`, `blocked`, `briefings` |
| `testing` | `implementing`, `blocked` |
| `implementing` | `review`, `blocked` |
| `probing` | `ready`, `done`, `blocked` |
| `review` | `testing`, `implementing`, `probing`, `blocked` |
| `done` | (terminal) |
| `blocked` | `ready` |

Backward edges (`review -> testing`, `review -> implementing`, `probing -> ready`) only fire via `agentStop --outcome rejected --return-to <stage>` — direct `board-move` cannot walk an item backward (`agents/hannibal.md:359-364`).

The matrix is enforced server-side (database-level) and at the hook layer by `scripts/hooks/enforce-handoff.js:54-85`.

---

## 3. Specialists

| Stage / role | Agent | Owns | Reads | File |
|--------------|-------|------|-------|------|
| `briefings` decomposition | Face | work items (creates) | PRD, existing code | `agents/face.md` |
| decomposition critique | Sosa | annotations on items | PRD, items | `agents/sosa.md` |
| `testing` | Murdock | `*.test.{ts,tsx,js,jsx}`, `__tests__/**`, `*.d.ts`, `/types/**` | impl files (read-only) | `agents/murdock.md` |
| `implementing` | B.A. | `src/**` (non-test) | tests (read-only) | `agents/ba.md` |
| `review` (per-feature) | Lynch | review verdict only | tests + impl + types | `agents/lynch.md` |
| `probing` | Amy | activity log only | full feature surface area | `agents/amy.md` |
| Final Mission Review | Stockwell | final review report | PRD + full diff | `agents/stockwell.md` |
| Documentation + final commit | Tawnia | `CHANGELOG.md`, `README.md`, `docs/**` | full codebase | `agents/tawnia.md` |
| Orchestration | Hannibal | dispatches only — never writes code | board state, work logs | `agents/hannibal.md` |

**Hannibal runs in the main Claude context, not as a subagent** (`agents/hannibal.md:42-58`). Worker agents are dispatched as subagents with their own context windows.

**Reviewers (Lynch, Amy, Stockwell) all use distinct skeptic angles** — see Section 6.

---

## 4. Fan-out plan

Pool sizes are determined dynamically by `ateam scaling compute` based on host concurrency and memory. The scaling formula lives in `docs/ORCHESTRATION.md` (see line 122 of that file). Default targets:

| Specialist | Pool size | Notes |
|------------|-----------|-------|
| Murdock | N (typically 2-4) | tests are the load-bearing first step |
| B.A. | N (typically 2-4) | implementation, balanced with Murdock pool |
| Lynch | N (typically 2-3) | per-feature review |
| Amy | N (typically 2-3) | bug-hunt probing |
| Hannibal | 1 | central orchestrator |
| Face / Sosa / Stockwell / Tawnia | 1 | gate roles, single instance by design |

**WIP is per-stage, not global** (`agents/hannibal.md:176-197`). This is called out explicitly because early implementations got it wrong: summing `count(testing) + count(implementing) + count(review) + count(probing)` against a global cap blocks idle agent instances unnecessarily. Each stage's WIP equals its pool size.

**Pool-claim is atomic via filesystem locks** in `/tmp/.ateam-pool/<missionId>/<role>/` — see `skills/pool-handoff/SKILL.md`. The first agent to `mkdir` a slot wins it; others retry. This survives Claude Code session boundaries.

---

## 5. Orchestration model

**Hybrid: central orchestrator (Hannibal) plus peer-to-peer pipeline handoffs.**

In **native teams mode** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`):
- Hannibal dispatches only the **first** worker per item (Murdock).
- Murdock -> B.A. -> Lynch -> Amy hand off to each other directly via `START` messages after `agentStop --advance`.
- Hannibal receives `FYI` (handoff succeeded) or `ALERT` (handoff failed/timed out) and intervenes only on `ALERT`.

In **legacy mode**:
- Hannibal polls each background subagent's TaskOutput and re-dispatches the next stage when complete.

The 4-phase orchestration loop, lazy spawning, and dispatch timeout are all defined in `playbooks/orchestration-native.md` (lines 417-571 for the loop; 188-365 for lazy spawning; 600-644 for dispatch timeout).

**Message protocol** (`skills/teams-messaging/SKILL.md`, see lines 304-316 for the format reference):
- `START` — "you have item X, here's the rendered context"
- `ACK` — "I claimed it"
- `FYI` — "I handed off to Y"
- `ALERT` — "handoff failed, please intervene"
- `REJECTED` — "I'm sending this backward to stage Z, here's why"

This is the protocol the video- and social-pipeline examples copy.

---

## 6. Verification passes

Three distinct skeptic angles, each catching what the others can't.

| Pass | Stage | Agent | Angle | Authoritative section |
|------|-------|-------|-------|------------------------|
| Adversarial impl review | `review` | Lynch | "does the impl actually pass the tests for the right reason, and is it clean?" | `agents/lynch.md:160-164` |
| Don't-trust-tests probing (Raptor Protocol) | `probing` | Amy | "tests can pass and the feature can still be broken — what didn't get tested?" | `agents/amy.md:75-78` |
| Holistic + PRD-scoped final review | (post-mission) | Stockwell | "the whole codebase against the PRD — cross-cutting concerns, race conditions, security, consistency" | `agents/stockwell.md:233-241` |

The angles are deliberately non-overlapping. Lynch trusts tests as the spec; Amy doesn't trust tests at all; Stockwell trusts neither and re-reads the PRD as the source of truth.

### Rejection routing — earliest implicated stage

When a reviewer flags a defect spanning stages, the rejection routes to the **earliest** stage implicated. The matrix is encoded in `packages/shared/src/stages.ts` and enforced by `scripts/hooks/enforce-handoff.js:54-85`.

| Reviewer flags | `--return-to` |
|----------------|---------------|
| Lynch: test gap only | `testing` (Murdock) |
| Lynch: impl bug only | `implementing` (B.A.) |
| Lynch: both test gap and impl bug | `testing` (Murdock audits coverage first; earliest-implicated rule) |
| Amy FLAG: test-gap-named | `testing` |
| Amy FLAG: impl-bug-only | `implementing` |
| Amy FLAG: both named | `testing` |
| Stockwell: any | `ready` (full re-flow through pipeline) |

**Rejection cap:** default `4`, configurable via `ATEAM_REJECTION_CAP`. After the cap, the item moves to `blocked` and surfaces to the human (`agents/hannibal.md:570-578`).

The earliest-implicated principle is the load-bearing invariant: it prevents items from ping-ponging between B.A. and Lynch when the real defect is a missing test that should have caught the impl bug in the first place.

---

## 7. Enforcement

Boundaries are enforced by Claude Code hooks listed in each agent's frontmatter and stored under `scripts/hooks/`.

| Boundary | Hook | Source |
|----------|------|--------|
| Hannibal cannot Write/Edit `src/**` or test files | `block-hannibal-writes.js` | `scripts/hooks/block-hannibal-writes.js` |
| Hannibal cannot use raw `mv` to change stages | `block-raw-mv.js` | `scripts/hooks/block-raw-mv.js` |
| Murdock cannot Write/Edit impl files | `block-murdock-impl-writes.js` | `scripts/hooks/block-murdock-impl-writes.js` |
| B.A. cannot Write/Edit test files | `block-ba-test-writes.js` | `scripts/hooks/block-ba-test-writes.js` |
| Lynch cannot Write/Edit (review-only) | `block-lynch-writes.js` | `scripts/hooks/block-lynch-writes.js` |
| Amy cannot Write/Edit test files | `block-amy-test-writes.js` | `scripts/hooks/block-amy-test-writes.js` |
| Amy cannot Write/Edit production code | `block-amy-writes.js` | `scripts/hooks/block-amy-writes.js` |
| Sosa cannot modify items directly | `block-sosa-writes.js` | `scripts/hooks/block-sosa-writes.js` |
| Workers cannot call `board-claim` directly | `block-worker-board-claim.js` | `scripts/hooks/block-worker-board-claim.js` |
| Workers cannot call `board-move` directly | `block-worker-board-move.js` | `scripts/hooks/block-worker-board-move.js` |
| Handoff routing follows the matrix | `enforce-handoff.js` | `scripts/hooks/enforce-handoff.js` |
| Final review must run before mission complete | `enforce-final-review.js` | `scripts/hooks/enforce-final-review.js` |
| Browser verification fired when required | `enforce-browser-verification.js` | `scripts/hooks/enforce-browser-verification.js` |

The `block-*` hooks all share the same shape: read tool-call from stdin, check `tool_name` and `file_path`, exit `2` with a stderr message on violation, exit `0` otherwise. `block-murdock-impl-writes.js` is the canonical reference.

The hooks are load-bearing. Earlier in the project's history, Stockwell deleted a `client/` directory because the boundary hooks weren't running — the lesson is in `~/.claude/projects/.../memory/MEMORY.md`'s "Enforcement hooks are load-bearing" entry.

---

## 8. Guardrail skills

Reviewer judgment is codified as skills, not opinions. Each skill ships a Self-Check the agent must run.

| Skill | Used by | Self-Check focus | Source |
|-------|---------|------------------|--------|
| `test-writing` | Murdock, Lynch | banned anti-patterns, AC mapping, only/never qualifiers, AC cross-product, integration test requirement | `skills/test-writing/SKILL.md` |
| `tdd-workflow` | Murdock | test scope by item type, red-green-refactor | `skills/tdd-workflow/SKILL.md` |
| `perspective-test` | Amy, Stockwell | three-layer verification (static analysis -> wiring trace -> browser check) | `skills/perspective-test/SKILL.md` |
| `defensive-coding` | B.A., Lynch | guard-before-operate, async error recovery, input validation, never-weaken-safety-nets | `skills/defensive-coding/SKILL.md` |
| `code-patterns` | B.A., Lynch | naming, function design, immutability, type safety, async best practices, consistent API shapes | `skills/code-patterns/SKILL.md` |
| `security-input` | B.A., Lynch | injection prevention, secrets handling, OWASP quick reference | `skills/security-input/SKILL.md` |
| `a11y` | Murdock, B.A., Lynch, Amy | input labeling, ARIA, keyboard interaction, focus management | `skills/a11y/SKILL.md` |
| `pool-handoff` | Murdock, B.A., Lynch, Amy | atomic pool slot claim, next-agent claim handoff | `skills/pool-handoff/SKILL.md` |
| `teams-messaging` | all pipeline workers | START/ACK/FYI/ALERT/REJECTED message formats | `skills/teams-messaging/SKILL.md` |
| `ateam-cli` | all agents | CLI reference for board/item/agent commands | `skills/ateam-cli/SKILL.md` |
| `agent-lifecycle` | all working agents | activity logging, completion signaling | `skills/agent-lifecycle/SKILL.md` |
| `work-breakdown` | Face, Sosa | item structure, sizing, AC standards | `skills/work-breakdown/SKILL.md` |
| `write-prd` | Face | PRD authoring | `skills/write-prd/SKILL.md` |

These skills are why the A(i)-Team's reviewer prompts are short. Lynch's prompt does not embed "what makes a good test" — it invokes `Skill(ai-team:test-writing)` and runs the Self-Check. Update the skill, every reviewer picks it up on the next run.

---

## Mapping back to the abstract pattern

This is the same architecture as the video and social pipelines:

| Abstract pattern | A(i)-Team realization |
|------------------|------------------------|
| Stage as primitive | 7 named stages + `blocked` (`packages/shared/src/stages.ts`) |
| Specialist per stage with bounded scope | one agent per stage, hook-enforced write boundaries |
| Fan-out within a stage | filesystem-locked instance pools per role |
| Per-stage WIP, not global | pool size per role; `agents/hannibal.md:176-197` |
| Multi-pass distinct-angle verification | Lynch (impl) + Amy (don't-trust-tests) + Stockwell (holistic+PRD) |
| Earliest-implicated rejection routing | `--return-to <stage>` enforced by `enforce-handoff.js` |
| Rejection cap -> blocked | `ATEAM_REJECTION_CAP` (default 4) |
| Hooks for hard boundaries, prompts for soft | `scripts/hooks/block-*.js` (hard) + agent-prompt boundary statements (soft) |
| Reviewer standards as skills | 13+ skills under `skills/`, invoked by reviewers via Self-Check |
| Central + P2P orchestration | Hannibal (central) + native teams mode P2P handoffs |

The video and social pipelines fit the same template by replacing the specialists, stage names, and guardrail skills. The architecture is identical.
