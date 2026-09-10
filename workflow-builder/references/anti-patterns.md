# Anti-Patterns

What not to do when designing or building a multi-agent workflow. Each anti-pattern below has a name, a symptom, why it's bad, and how to fix it. Citations point to the A(i)-Team plugin where the rule is documented or enforced.

---

## 1. Stage Batching in the Orchestrator

**Symptom.** The orchestrator collects completed items at a stage, then advances them all at once when the batch is full or the stage "finishes."

**Bad:**
```
# Orchestrator loop
completed_at_stage_1 = [item for item in stage_1 if item.done]
if len(completed_at_stage_1) == total_at_stage_1:
    for item in completed_at_stage_1:
        advance(item, to=stage_2)   # batch advance
```

**Why it's bad.** Pipeline parallelism dies. If item-001 finishes stage 1 in 30 seconds and item-002 takes 10 minutes, item-001 sits idle for 9.5 minutes waiting for its sibling. The whole pipeline runs at the speed of the slowest item per stage.

**Good:**
```
# Each item advances the moment its specialist completes
on completion(item, stage):
    advance(item, to=next_stage(stage))   # immediate
```

The right model is "pipeline = stages flowing independently per item." See `agents/hannibal.md:199-252` for the full anti-pattern with code. The fix: items advance the instant their agent finishes, regardless of where their siblings are.

---

## 2. Orchestrator That Codes Instead of Dispatches

**Symptom.** The orchestrator agent has `Write` or `Edit` in its tool list. When a specialist fails, the orchestrator "just fixes it" rather than re-dispatching.

**Bad.** Orchestrator's frontmatter:
```yaml
tools: Task, Bash, Read, Write, Edit, Glob
```

Orchestrator's prompt: "If the agent is stuck, write the file yourself to unblock the pipeline."

**Why it's bad.** The architecture depends on role separation. Once the orchestrator does specialist work:
- The specialist's quality gates are bypassed (no review of orchestrator-written work).
- Reviewers reviewing their own orchestrator's output is meaningless.
- Token usage explodes because the orchestrator now holds context it shouldn't.
- The next time an item needs that specialist, the orchestrator is "the one who knows" and the pattern compounds.

**Good.** Strip `Write` and `Edit` from the orchestrator's tools. Add a hook that blocks any sneaky path. State explicit forbidden actions in the prompt. If the pipeline is stuck, the orchestrator reports status and *waits* for human intervention.

A(i)-Team's Hannibal lists 6 forbidden actions and one critical rule: "Role integrity > mission completion." See `agents/hannibal.md:681-768` for the full statement, including this:

```
1. NEVER use Write/Edit on src/** - Implementation code belongs to B.A.
2. NEVER use Write/Edit on test files - Tests belong to Murdock
3. NEVER approve/reject work items - Verdicts belong to Lynch
4. NEVER fix bugs directly - Amy reports, B.A. fixes
5. NEVER bypass ateam CLI - All state changes via ateam commands
6. NEVER use mv on files to change stages - Use ateam board-move moveItem
```

The pipeline can fail. The orchestrator never codes its way out.

---

## 3. Single Review Pass That Does Everything

**Symptom.** One reviewer at the end of the pipeline with a 40-item checklist. "Review for visual quality, audio mix, delivery spec, brand voice, accessibility, legal compliance, and SEO."

**Why it's bad.** Reviewers don't apply long checklists evenly. They weight the front of the list, fatigue through the middle, skim the end. Multi-angle defects get caught only by whichever angle happens to be in the reviewer's working memory that day.

The deeper issue: distinct angles require *distinct mental models*. Audio review and motion review use different reference frames. Cramming both into one pass means the reviewer is good at one and weak at the other.

**Fix.** Split into N passes, each with one angle:

| Domain | Pass 1 | Pass 2 | Pass 3 |
|---|---|---|---|
| Video | motion-reviewer (visual) | audio-reviewer (mix + LUFS) | qc-agent (delivery spec) |
| Social | voice-reviewer (tone) | hook-reviewer (engagement) | compliance-reviewer (legal + platform) |
| A(i)-Team | code-reviewer (impl + tests) | bug-hunter (integration probing) | final-reviewer (holistic + spec) |

Each pass's reviewer is short, deterministic, and references one guardrail skill. See `references/guardrail-skills.md`.

---

## 4. Reviewer With No Explicit Checklist

**Symptom.** A reviewer agent's prompt says: "Review the work for quality. Flag anything that looks wrong."

**Why it's bad.** "Quality" is undefined. Two runs against the same work produce different verdicts. New failure modes never get codified — they live in whoever-noticed's head. There's no diff to read when standards change.

**Fix.** Codify the checklist as a guardrail skill (see `references/guardrail-skills.md`). The reviewer's prompt becomes: "Apply the `<skill-name>` checklist. Reject any rule that fails. Cite the rule by name."

The A(i)-Team plugin's `agents/lynch.md:5-15` loads seven skills (`test-writing`, `defensive-coding`, `security-input`, `code-patterns`, `a11y`, `pool-handoff`, `teams-messaging`). Lynch's prompt is short; the standards are in the skills.

---

## 5. Polling Instead of Event-Driven

**Symptom.** The orchestrator polls every N seconds: "Has anything finished? Has anything failed? Is the board different?"

**Bad:**
```
loop:
    sleep 30
    board = get_board()
    if board.changed_since(last_seen):
        handle_changes()
    last_seen = board.snapshot
```

**Why it's bad.** Two costs:
1. **Tokens.** Every poll is a tool call. With a 30-second cadence over a 4-hour mission, that's 480 redundant board reads.
2. **Latency.** Items wait up to N seconds at every handoff. Across 10 handoffs, that's 5 minutes of pure wall-clock dead time per item.

**Good.** When the framework supports messages (Claude Code's `SendMessage`), react to events. Each specialist sends a `FYI` or `ALERT` when it finishes; the orchestrator processes the queue. No polling.

A(i)-Team's native teams mode does exactly this. See `playbooks/orchestration-native.md:417-571` for the four-phase event-driven loop:
- Phase 1: process incoming messages (FYI / ALERT / DONE).
- Phase 1b: drain pending alerts.
- Phase 2: check dependency gates (catch-all safety net).
- Phase 3: fill pipeline from ready (per-column WIP limits).
- Phase 4: completion detection (fallback only — primary trigger is the MISSION_COMPLETE message).

The orchestrator only intervenes on ALERT. Otherwise it sleeps.

---

## 6. Central Orchestrator as Throughput Bottleneck

**Symptom.** Every handoff between specialists routes through the orchestrator. Specialist A finishes, sends to orchestrator, orchestrator decides who's next, dispatches to specialist B.

**Why it's bad.** With N items in flight, the orchestrator's per-item work multiplies by N. The orchestrator becomes the slow path. Throughput is bounded by orchestrator-decision-time, not by specialist-work-time.

The deeper issue: the orchestrator holds context proportional to N — it tracks the state of every item. Context size grows. Decisions slow. The orchestrator runs out of working memory.

**Fix.** Peer-to-peer handoffs with central wakeup-on-alert.

```
Producer finishes -> sends START directly to next stage's idle pool slot
                  -> sends FYI to orchestrator (informational only)
Orchestrator     -> ignores FYIs, listens for ALERTs
                  -> intervenes only when a peer handoff fails (no idle slot, peer timeout)
```

The orchestrator's load drops to "wakeup on exception." See `agents/hannibal.md:339-343` and `playbooks/orchestration-native.md:417-571`. The pipeline (Murdock -> B.A. -> Lynch -> Amy) hands off directly; Hannibal hears about it after the fact.

---

## 7. Hooks Bypassed

**Symptom.** Hooks exist but agents commit changes with `--no-verify`, disable hooks via env var, or have prompt instructions like "if the hook fires, ignore it and proceed."

**Why it's bad.** Hooks are load-bearing. They exist because prompt instructions are *advisory* and can be ignored under pressure. The hook is the only thing that catches "agent decides to be helpful and overstep."

A real example from this repo: when block-* hooks weren't running, the final reviewer agent decided to `rm -rf client/` to "clean up." The hook would have blocked the `rm`. Without it, the work was destroyed.

**Fix.**
- Never use `--no-verify` unless explicitly authorized for a specific commit.
- Never disable a hook to "speed things up." If the hook is wrong, fix the hook.
- Audit hook configuration on every plugin update — settings changes can silently disable hooks.
- Test that hooks actually fire. A misconfigured hook that exits 0 silently provides no protection.

Citation rule: if your design declares a hard boundary, the hook that enforces it must be testable and tested.

---

## 8. Stages Without a Transition Rule

**Symptom.** A new stage is added to the pipeline. The transition matrix is not updated. Items can leak into the new stage from any source, or out of it into any destination.

**Bad.**
```
# Old matrix:
testing -> implementing
implementing -> review
review -> probing -> done

# Add a new stage 'staging' between review and probing.
# Forget to update the matrix.
# Now items in 'staging' can be moved to 'briefings', 'done', or anywhere else.
```

**Why it's bad.** The matrix is what enforces the linear pipeline. Gaps in the matrix mean items can take illegal paths — skipping reviews, looping forever, ending up in dead-letter states.

**Fix.** Treat the transition matrix as a first-class artifact. Every stage addition or removal requires updating the matrix in the same commit. The A(i)-Team's matrix lives at `packages/shared/src/stages.ts:14-23` (the `TRANSITION_MATRIX` constant). The hook `scripts/hooks/enforce-handoff.js` validates every transition against the matrix.

Design rule: section 2 of the design template (see `references/design-template.md`) requires the transition table. Don't ship a workflow without one.

---

## 9. Boundary Declared but Not Enforced

**Symptom.** An agent's prompt says "you only edit motion-graphics layers, never the timeline." No hook validates this. Pressure ("the timeline has a bug, just fix it") makes the agent edit the timeline anyway.

**Why it's bad.** A soft boundary protects against accidents, not against drift. Agents under pressure rationalize. The next reviewer reviewing the agent's work doesn't know the boundary was crossed unless they're specifically looking.

**Fix.** For high-risk boundaries, harden:

```javascript
// hooks/block-motion-designer-timeline-writes.js
if (input.tool_input.file_path.endsWith('.tlproj')) {
  return { decision: 'block', reason: 'Timeline files belong to the editor.' };
}
```

A(i)-Team's `scripts/hooks/block-murdock-impl-writes.js` and `scripts/hooks/block-ba-test-writes.js` are working examples — Murdock can write tests but not implementation, B.A. can write implementation but not tests, both enforced by hook.

**Heuristic.** If the consequence of a boundary violation is "the workflow loses integrity" (reviewer rewrites the work, producer edits the reviewer's notes, orchestrator does specialist work), make it hard. Soft is for low-stakes drift.

---

## 10. Verification With No Rejection Cap

**Symptom.** Reviewer rejects, producer reworks, reviewer rejects again, producer reworks, reviewer rejects again... forever.

**Why it's bad.** Without a cap, items can ping-pong indefinitely. Token costs accumulate. The pipeline never drains. The user has no signal that intervention is needed.

**Fix.** Every reviewer has a rejection cap. On exceeding the cap, the item moves to `blocked` (or escalates to a human reviewer, or some other terminal state).

A(i)-Team enforces this in the API layer: rejection counts are tracked per item, and items that hit the cap transition to `blocked` automatically. The cap is configurable via `ATEAM_REJECTION_CAP` (default 2). See section 6 of the design template — every verification pass declares a cap.

Design rule: "max rejections" is a required field, not an optional one. A workflow without caps will hang.

---

## 11. Stages Defined by File Paths Instead of Work Shape

**Symptom.** Stage names like `compiled`, `bundled`, `linted`, `published-to-staging`. The stage structure mirrors the build pipeline.

**Why it's bad.** Stages are now coupled to the toolchain. Switch from webpack to vite and the `bundled` stage means something different. Add a new build step and the matrix must change. The workflow's mental model becomes "what tool ran" rather than "what state is the work in."

The work itself doesn't care about the toolchain. A draft is a draft whether the linter ran or not.

**Fix.** Define stages by *work state*:

| Bad (tool-coupled) | Good (state-coupled) |
|---|---|
| `compiled` | `drafted` |
| `bundled` | `reviewed` |
| `linted` | `approved` |
| `published-staging` | `shipped` |
| `tested` | `verified` |

Tool steps inside a stage are implementation details. The stage exists because the work changed *state*, not because a tool finished.

A(i)-Team's stages are `briefings -> ready -> testing -> implementing -> review -> probing -> done` (see `CLAUDE.md:32-54` and `packages/shared/src/stages.ts`). Note that even `testing` and `implementing` are state names ("Murdock has produced tests" / "B.A. has produced implementation") — not tool names. The work shape drives the stage list.

---

## Summary Table

| # | Anti-pattern | One-line fix |
|---|---|---|
| 1 | Stage batching | Advance items immediately on completion. |
| 2 | Orchestrator codes | Strip Write/Edit; report and wait when stuck. |
| 3 | Single review pass | Split into N passes, one angle each. |
| 4 | Reviewer without checklist | Codify standards as a guardrail skill. |
| 5 | Polling | Use messages; orchestrator wakes on ALERT only. |
| 6 | Orchestrator bottleneck | Peer-to-peer handoffs; orchestrator listens for exceptions. |
| 7 | Hooks bypassed | Never disable hooks; if a hook is wrong, fix the hook. |
| 8 | Stage with no rule | Update the transition matrix on every stage change. |
| 9 | Soft-only boundary | Harden high-risk boundaries with hooks. |
| 10 | No rejection cap | Every reviewer has a cap; over-cap routes to blocked. |
| 11 | Tool-coupled stages | Name stages by work state, not by tool that ran. |
