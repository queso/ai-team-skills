# Worked example: video production pipeline

A multi-stage pipeline that takes raw footage and produces polished, delivery-ready edits with motion graphics, color, and mixed audio. Designed for small teams or single creators producing 5-50 videos per cycle (e.g. a weekly YouTube channel batch, a campaign of social cuts, an episodic show).

This example mirrors the section structure in `references/design-template.md` so a reader can scaffold from it directly via `/workflow-builder:scaffold`.

---

## 1. Workflow goal & domain

**Domain:** video post-production.

**Goal:** transform a folder of raw camera footage + audio + brief into N polished videos that meet a published delivery spec (codec, container, aspect ratio, LUFS target, captions present, brand-safe motion graphics applied).

**Unit of work:** one video. Each work item carries:
- `source_clips` — paths to ingest-ready footage
- `brief` — script or shot list, runtime target, platform target (YouTube 16:9, TikTok 9:16, etc.)
- `delivery_spec` — codec, bitrate, LUFS, caption requirement, brand assets ID
- `outputs.timeline`, `outputs.export` — where the timeline file and final render will live

**Input:** raw clips + brief.
**Output:** final exported file(s) at the delivery spec, plus the source timeline retained for revisions.

---

## 2. Stages

```
ingest -> rough-cut -> motion-graphics -> color-grade -> audio-mix -> final-qc -> export
```

A separate `blocked` stage holds items that fail the rejection cap.

### Transition matrix

| From | Valid forward | Valid backward (rejection) |
|------|---------------|----------------------------|
| `ingest` | `rough-cut`, `blocked` | — |
| `rough-cut` | `motion-graphics`, `blocked` | `ingest` (footage missing/corrupt) |
| `motion-graphics` | `color-grade`, `blocked` | `rough-cut` (timing wrong) |
| `color-grade` | `audio-mix`, `blocked` | `rough-cut` (re-edit needed), `motion-graphics` (graphic clashes with grade) |
| `audio-mix` | `final-qc`, `blocked` | `rough-cut` (sync issue), `motion-graphics` (sound-design tied to graphic timing) |
| `final-qc` | `export`, `blocked` | `rough-cut`, `motion-graphics`, `color-grade`, `audio-mix` (earliest implicated) |
| `export` | `done`, `blocked` | `final-qc` (render artifact) |
| `blocked` | `ingest` (retry from start) | — |

The matrix is the contract that prevents skipping verification — there is no edge from `motion-graphics` directly to `final-qc`.

---

## 3. Specialists

| Stage | Specialist | Owns | Reads | Reviewer? |
|-------|------------|------|-------|-----------|
| `ingest` | ingest-agent | `media/proxies/**`, ingest manifests | raw clips, brief | no |
| `rough-cut` | editor | timeline files (`*.fcpxml`, `*.prproj`, `*.kdenlive`) | proxies, brief, transcript | no |
| `motion-graphics` | motion-designer | graphics layer files only (`*.mogrt`, motion comps in `mograph/**`) | timeline (read-only), brand kit | no |
| `color-grade` | colorist | grade/LUT nodes in timeline, `grade/**` | timeline, footage scopes | no |
| `audio-mix` | audio-engineer | audio bus settings, `audio/**` mix sessions | timeline, transcript, music stems | no |
| `final-qc` | qc-agent | QC report (`qc/<id>.json`), captions sidecar | finalized timeline | yes |
| `export` | export-agent | `exports/<id>/**`, render manifest | finalized timeline + QC pass | no |

**Reviewers (run during their own stage):**

| Reviewer | Stage | Angle |
|----------|-------|-------|
| motion-reviewer | `motion-graphics` | visual coherence, brand fidelity, graphic-timing-vs-cuts |
| audio-reviewer | `audio-mix` | mix balance, LUFS, dialog intelligibility, sync drift |
| qc-reviewer | `final-qc` | delivery spec compliance (codec, aspect, captions, runtime tolerance) |

The motion-reviewer and audio-reviewer are **specialists embedded in their stage** — they run after the producer in the same stage finishes, and either approve forward or reject backward. The qc-reviewer is the holistic final pass.

---

## 4. Fan-out plan

Many videos run through the pipeline simultaneously. Pool sizes target the contended specialist; cheaper stages can over-pool slightly so they never bottleneck the editor.

| Specialist | Pool size | Rationale |
|------------|-----------|-----------|
| ingest-agent | 5 | I/O bound, cheap |
| editor | 3 | most contended; longest stage; raise pool to 4-5 only if cuts are short-form |
| motion-designer | 2 | GPU-bound on render preview; over-pooling causes thrash |
| colorist | 2 | scope-driven, careful work; quality drops with parallelism > 2 |
| audio-engineer | 2 | mix decisions need quiet; not parallelism-friendly |
| qc-agent | 3 | pure verification, scales well |
| export-agent | 4 | render farm; hardware-limited |

**WIP is per-stage.** If `rough-cut` has 3 in-flight and `motion-graphics` has 0, the editor pool is full but the motion-designer pool is idle — that's fine, items will arrive. Do not gate dispatch on global in-flight count.

**Pool-claim contract:** a specialist instance claims an item atomically (file lock or DB row claim) before reading it. Two editors never grab the same timeline.

---

## 5. Orchestration model

**Recommendation: peer-to-peer handoffs with a central coordinator that wakes only on alerts.**

- The central coordinator (call it the "producer") is the one human-readable entry point. It dispatches the first stage, then sleeps.
- Each specialist completes their work, sends a `START` message to a claimed instance of the next-stage specialist, and signals `FYI` to the producer ("handed off cleanly"). The producer logs but does not act.
- If a handoff times out (no `ACK` from the next stage within N seconds, e.g. the motion-designer pool is full), the specialist sends `ALERT` and the producer wakes to handle re-dispatch when capacity opens.

**Why P2P:** the editor finishing a cut should not wait for the producer to poll a board and re-dispatch. The motion-designer is one message away.

**When central polling is fine:** if you are producing 1-2 videos at a time for a small client, a single-threaded "do the next stage" loop in the producer is simpler and avoids the message protocol entirely. P2P pays off at ~5+ concurrent items.

**Message types** (mirrors `skills/teams-messaging` in the A(i)-Team source repo):
- `START` — "you have item X, here's the rendered context"
- `ACK` — "I claimed it"
- `FYI` — "I handed off to Y, here's the audit trail"
- `ALERT` — "handoff failed, please intervene"
- `REJECTED` — "I'm sending this backward to stage Z, here's why"

---

## 6. Verification passes

Three distinct skeptic angles. Each catches what the others can't.

| Pass | Stage | Angle | Look for |
|------|-------|-------|----------|
| motion-reviewer | `motion-graphics` | **visual coherence** — does the screen tell one story? | brand-color drift, font inconsistency, lower-thirds covering faces, motion that fights the cut |
| audio-reviewer | `audio-mix` | **listener experience** — does it sound right at target loudness? | mix balance (dialog vs music vs SFX), LUFS within ±1.0 of target, intelligibility, pumping/clipping, sync drift |
| qc-reviewer | `final-qc` | **delivery contract** — will the platform accept it? | codec/container, aspect ratio, runtime within tolerance, captions present and accurate, color space, audio channel layout |

The angles are deliberately non-overlapping. The motion-reviewer has no opinion on LUFS; the audio-reviewer has no opinion on lower-third alignment; the qc-reviewer has no opinion on whether the cut "feels right." A single combined review collapses these angles and misses defects in the angle the reviewer happens not to be in the mood for.

### Rejection routing — earliest implicated stage

When a reviewer flags a defect that spans stages, route to the **earliest** stage implicated. This avoids ping-pong and preserves invariants downstream.

| Defect named in rejection | Route to | Specialist who fixes |
|---------------------------|----------|----------------------|
| Cut timing wrong (graphic landing on wrong frame) | `rough-cut` | editor |
| Graphic style off-brand | `motion-graphics` | motion-designer |
| Grade clashes with graphic | `motion-graphics` (graphic was wrong choice for shot) OR `color-grade` (grade is at fault). If both: `motion-graphics`. | earliest-implicated rule |
| LUFS off-target | `audio-mix` | audio-engineer |
| Caption typo | `final-qc` (regenerate) | qc-agent |
| Runtime over spec | `rough-cut` (cut down) | editor |
| Aspect ratio wrong on export | `export` | export-agent |
| Both cut timing AND grade clash | `rough-cut` (earliest) | editor first, then re-flow forward |

**Rejection cap:** 3 round-trips per item. After 3 rejections the item moves to `blocked` and the producer surfaces it to the human. This prevents infinite loops where an editor and motion-designer disagree about whose fault a defect is.

---

## 7. Enforcement

| Boundary | Enforcement |
|----------|-------------|
| editor cannot edit graphics layer files | **hook** (`block-editor-graphics-writes.js`) — Write/Edit on `mograph/**` or `*.mogrt` is denied for the editor agent |
| motion-designer cannot retime cuts | **hook** — Write/Edit on the timeline's cut blocks (parsed from `*.fcpxml`/`*.prproj`) is denied; only graphic-layer XML mutations allowed |
| colorist cannot touch audio bus | **hook** — Write/Edit outside `grade/**` and color nodes is denied |
| audio-engineer cannot regrade | **hook** — Write/Edit outside `audio/**` is denied |
| qc-agent cannot edit anything | **hook** (`block-qc-writes.js`) — Write/Edit/MultiEdit globally denied; can only emit a QC report |
| export-agent cannot modify timeline | **hook** — Write/Edit on timeline files is denied |
| reviewers must consult their guardrail skill before approving | **soft (prompt)** — reviewer agent prompt says "invoke `Skill(motion-design-standards)` Self-Check before responding APPROVED" |

Hook stubs live at `hooks/block-<role>-writes.js` and follow the same shape as `scripts/hooks/block-murdock-impl-writes.js` in the A(i)-Team source repo: read tool-call from stdin, check `tool_name` and `file_path`, exit 2 with a stderr message on violation, exit 0 otherwise.

---

## 8. Guardrail skills

Reviewer judgment is codified as skills, not opinions. Each skill ships a Self-Check the reviewer is required to run before issuing a verdict.

| Skill | Used by | Self-Check covers |
|-------|---------|-------------------|
| `cutting-rhythm-guide` | editor (self-check), motion-reviewer | shot length distribution, cut-on-action, jump-cut policy, breath/pause handling |
| `motion-design-standards` | motion-designer, motion-reviewer | brand color tokens, font stack, lower-third placement zones, motion easing curves, max-onscreen-elements |
| `audio-loudness-spec` | audio-engineer, audio-reviewer | LUFS target per platform, true-peak ceiling, dialog-to-bed ratio, channel layout |
| `delivery-spec-checks` | qc-agent, qc-reviewer, export-agent | codec/container matrix per platform, caption format requirements, aspect ratios, runtime tolerances |

These skills are the centerpiece of "reviewer quality is codified, not opinion." When the brand updates its color palette, you edit `motion-design-standards` once — every reviewer picks up the new check on the next run.

---

## Hand-off summary

Once a human runs `/workflow-builder:design` and produces this doc, `/workflow-builder:scaffold` would emit:
- Claude Code target: `.claude-plugin/plugin.json` named `video-pipeline`
- OpenCode target: `.opencode/agents/**`, `.opencode/commands/**`, `.opencode/skills/**`, and `.opencode/plugins/workflow-boundaries.ts` when hard boundaries are selected
- `agents/ingest-agent.md`, `editor.md`, `motion-designer.md`, `colorist.md`, `audio-engineer.md`, `qc-agent.md`, `export-agent.md`, `motion-reviewer.md`, `audio-reviewer.md`, `qc-reviewer.md`
- `commands/run.md` for `/video-pipeline:run`
- `hooks/block-editor-graphics-writes.js`, `block-motion-designer-cuts.js`, `block-colorist-writes.js`, `block-audio-writes.js`, `block-qc-writes.js`
- `skills/cutting-rhythm-guide/SKILL.md`, `motion-design-standards/SKILL.md`, `audio-loudness-spec/SKILL.md`, `delivery-spec-checks/SKILL.md`

Each scaffolded file carries TODOs pointing back to `references/role-boundaries.md`, `references/multi-pass-verification.md`, and `references/guardrail-skills.md` so the human knows exactly what to fill in.
