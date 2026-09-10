# Workflow Design Template

This is the OUTPUT TEMPLATE that `/workflow-builder:design` fills in. The walkthrough's eight decisions map 1:1 to the eight sections below. Placeholders in `<angle brackets>` are slots the design command populates from user answers.

---

```markdown
---
workflow-name: <kebab-case-name>
domain: <video | social | engineering | other>
created: <YYYY-MM-DD>
last-updated: <YYYY-MM-DD>
version: 0.1.0
---

# <Workflow Name> Design

## 1. Workflow Goal & Domain

> Purpose: state what "done" looks like for one unit of work. Everything downstream serves this.

- **Domain:** <video production | social content | engineering | other>
- **Unit of work:** <one video | one post | one feature | one ...>
- **Input:** <raw footage in /inbox | content brief | PRD | ...>
- **Output:** <delivered .mp4 with captions | published post on N platforms | merged PR | ...>
- **Definition of done:** <one sentence — e.g., "the video is exported, captioned, color-graded, and uploaded to the delivery folder">

## 2. Stages

> Purpose: the ordered list of states a unit passes through. Each stage has one specialist role responsible for advancing items out of it.

| # | Stage | One-line description |
|---|---|---|
| 1 | `<intake>` | <what happens here> |
| 2 | `<produce>` | <what happens here> |
| 3 | `<review-1>` | <what happens here> |
| 4 | `<review-2>` | <what happens here> |
| 5 | `<ship>` | <what happens here> |
| ... | ... | ... |

### Transition matrix

> Purpose: every stage transition that's *allowed* — gaps mean items can't legally move that direction.

| From stage | Allowed next stages | Notes |
|---|---|---|
| `<intake>` | `<produce>` | Forward only. |
| `<produce>` | `<review-1>` | Forward only. |
| `<review-1>` | `<review-2>`, `<produce>` | Reviewer can reject back to producer. |
| `<review-2>` | `<ship>`, `<produce>`, `<review-1>` | Reject routes to earliest implicated stage. |
| `<ship>` | `<done>` | Terminal. |

## 3. Specialists

> Purpose: one role per stage. Each role has a write boundary (what it touches) and a read boundary (what it can see).

| Stage | Role | What they do | Write boundary | Read boundary | Model |
|---|---|---|---|---|---|
| `<intake>` | `<intake-agent>` | <one sentence> | <files/dirs they create or edit> | <files/dirs they read> | <opus/sonnet/haiku> |
| `<produce>` | `<producer>` | <one sentence> | <files/dirs> | <files/dirs> | <opus/sonnet/haiku> |
| `<review-1>` | `<reviewer-1>` | <one sentence> | <annotation file only> | <produced files + reference docs> | <model> |
| `<review-2>` | `<reviewer-2>` | <one sentence> | <annotation file only> | <produced files + reference docs> | <model> |
| `<ship>` | `<shipper>` | <one sentence> | <delivery dir, metadata> | <produced files> | <model> |

## 4. Fan-out Plan

> Purpose: how many items move through the pipeline simultaneously, and how many specialist instances exist per stage.

- **Mode:** <sequential (one item end-to-end at a time) | parallel (multiple items in flight) | hybrid>
- **Per-stage WIP caps:**
  - `<stage-1>`: <N items> (instance pool size: <N>)
  - `<stage-2>`: <N items> (instance pool size: <N>)
  - `<stage-3>`: <N items> (instance pool size: <N>)
  - ...
- **Pool model:** <one instance per stage | N instances per stage from a pool | dynamic spawning>
- **Bottleneck stage (expected):** <stage name and reason — usually the stage with the longest per-item duration>
- **Total in-flight ceiling:** <sum of WIPs OR explicit global cap>

## 5. Orchestration

> Purpose: how items move from one specialist to the next.

- **Coordination model:** <central orchestrator | peer-to-peer with central wakeup | pure peer-to-peer>
- **Default for this workflow:** <chosen mode and one-line reason>
- **Message protocol summary:**
  - `START`: <who sends to whom, when>
  - `ACK`: <who confirms receipt>
  - `FYI`: <who sends informational updates to the orchestrator>
  - `ALERT`: <who sends intervention requests>
  - `REJECTED`: <who sends rejection signals back upstream>
- **Orchestrator role:** <name — typically only intervenes on `ALERT`; otherwise listens>
- **Wakeup-on-alert vs polling:** <event-driven | polling-every-N-seconds — event-driven is the default>

## 6. Verification Passes

> Purpose: each pass reviews from a *distinct angle* the others can't see. One reviewer per angle.

| # | Pass | Angle (what it catches that others miss) | Rejection routes to | Rejection cap |
|---|---|---|---|---|
| 1 | `<reviewer-1>` | <e.g., visual coherence, brand match> | `<stage>` (earliest implicated) | <N> |
| 2 | `<reviewer-2>` | <e.g., audio mix balance + LUFS> | `<stage>` | <N> |
| 3 | `<reviewer-3>` | <e.g., delivery spec compliance> | `<stage>` | <N> |
| Final | `<final-reviewer>` | <holistic + spec-scoped> | `<any earlier stage>` | <N> |

- **Routing rule on multi-angle defects:** route to the *earliest* flagged stage so rework flows through one cycle.
- **On exceeding rejection cap:** <move to `blocked` | escalate to human | other>

## 7. Enforcement

> Purpose: every boundary declared above. For each, decide whether prompt-only is enough or you need a hook.

| Boundary | Hard or soft | Mechanism |
|---|---|---|
| `<producer>` cannot edit reviewer annotations | hard | `hooks/<name>.js` blocks `Write|Edit` on annotation paths |
| `<reviewer>` cannot rewrite source | hard | `hooks/<name>.js` blocks `Write|Edit` on producer paths |
| `<reviewer>` annotates only, doesn't approve directly | soft | prompt instruction in `agents/<reviewer>.md` |
| `<orchestrator>` cannot do specialist work | hard | tools omitted from frontmatter + `hooks/<name>.js` |
| `<shipper>` is only one allowed to write to delivery dir | hard | `hooks/<name>.js` blocks others |

- **Rule of thumb:** if the consequence of a violation is "the workflow loses integrity" (e.g., reviewer rewrites the work they're reviewing), make it hard. If the consequence is "minor style drift," soft is fine.

## 8. Guardrail Skills

> Purpose: reviewer standards codified as skills, not opinions. See `references/guardrail-skills.md`.

| Skill | Used by | What it codifies |
|---|---|---|
| `<skill-1>` | `<reviewer-1>` | <one-line description of the rules — e.g., "easing curves, frame holds, animation principles"> |
| `<skill-2>` | `<reviewer-2>` | <one-line description — e.g., "LUFS targets per platform, peak ceilings, silence rules"> |
| `<skill-3>` | `<reviewer-3>` | <one-line description — e.g., "delivery spec: codecs, aspect ratios, captions, durations"> |
| `<skill-4>` | `<final-reviewer>` | <one-line description — e.g., "cross-cutting checks: brand consistency, narrative arc"> |

Each skill lives at `skills/<skill-name>/SKILL.md` and is referenced from the using reviewer's agent frontmatter:

```yaml
skills:
  - <skill-name>
```

---

## Next Steps

This design doc is the input to scaffolding. To generate a Claude Code plugin skeleton, an OpenCode workflow skeleton, or both from it:

```
/workflow-builder:scaffold <path-to-this-file>
```

The scaffold command will emit:

- Claude Code target: `.claude-plugin/plugin.json`, `agents/<role>.md`, `commands/*.md`, `hooks/*.js`, and `skills/<skill-name>/SKILL.md`.
- OpenCode target: `.opencode/agents/<role>.md`, `.opencode/commands/*.md`, `.opencode/plugins/workflow-boundaries.ts` when hard boundaries are needed, `.opencode/skills/<skill-name>/SKILL.md`, and `opencode.json` only when config is needed.

To audit a built plugin against this design:

```
/workflow-builder:review <path-to-plugin-root>
```
```
