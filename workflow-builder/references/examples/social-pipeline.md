# Worked example: social content pipeline

A multi-stage pipeline that takes a content brief or trend signal and produces scheduled, on-brand, compliance-cleared social posts across multiple platforms — then measures the result. Designed for solo creators, in-house social teams, or agencies running 20-200 posts per week across X, LinkedIn, TikTok, Instagram, and Threads.

This example mirrors the section structure in `references/design-template.md` so a reader can scaffold from it directly via `/workflow-builder:scaffold`.

---

## 1. Workflow goal & domain

**Domain:** social content production and distribution.

**Goal:** turn upstream signals (trend research, campaign brief, repurposed long-form content) into scheduled posts that match brand voice, contain a strong hook, comply with brand+legal rules, post on time, and feed engagement data back into the next round of research.

**Unit of work:** one post (sometimes a thread/carousel — still one work item). Each item carries:
- `signal` — the source trend, pillar, or repurposed asset that prompted the post
- `platform` — single platform per item (a "cross-post" is N items, one per platform)
- `format` — text, single image, carousel, short video, thread
- `target_window` — scheduling window (e.g. "Tue 8-10am ET")
- `outputs.draft`, `outputs.assets`, `outputs.scheduled_id`, `outputs.metrics`

**Input:** signal/brief.
**Output:** posted content + measured engagement, fed back into the trend-researcher for the next cycle.

---

## 2. Stages

```
ideate -> draft -> voice-review -> hook-review -> compliance-review -> schedule -> post -> measure
```

A separate `blocked` stage holds items that fail the rejection cap or that compliance permanently rejects.

### Transition matrix

| From | Valid forward | Valid backward (rejection) |
|------|---------------|----------------------------|
| `ideate` | `draft`, `blocked` | — |
| `draft` | `voice-review`, `blocked` | `ideate` (signal too thin) |
| `voice-review` | `hook-review`, `blocked` | `draft` (rewrite needed) |
| `hook-review` | `compliance-review`, `blocked` | `draft` (hook weak), `voice-review` (voice fix changed hook) |
| `compliance-review` | `schedule`, `blocked` | `draft` (rewrite for compliance), `voice-review`, `hook-review` (earliest implicated) |
| `schedule` | `post`, `blocked` | — (schedule is metadata-only, no rejection edge) |
| `post` | `measure`, `blocked` | `schedule` (publish failed, retry slot) |
| `measure` | `done`, `blocked` | — |
| `blocked` | `ideate` (recover from start) | — |

The matrix forbids skipping any of the three review angles — there is no edge from `draft` directly to `schedule`.

---

## 3. Specialists

| Stage | Specialist | Owns | Reads | Reviewer? |
|-------|------------|------|-------|-----------|
| `ideate` | trend-researcher | `briefs/<id>.md` | trends API, prior post metrics, content pillars | no |
| `draft` | copywriter | `drafts/<id>.md`, `assets/<id>/**` (generated images, captions) | brief, brand voice guide, platform spec | no |
| `voice-review` | voice-reviewer | review annotations only (`reviews/<id>-voice.md`) | draft (read-only) | yes |
| `hook-review` | hook-reviewer | review annotations only (`reviews/<id>-hook.md`) | draft (read-only) | yes |
| `compliance-review` | compliance-reviewer | review annotations only (`reviews/<id>-compliance.md`) | draft, brand+legal checklist | yes |
| `schedule` | scheduler | post metadata (`schedule/<id>.json`) — time slot, platform, tags | drafted content (read-only) | no |
| `post` | publisher | platform API receipts (`posted/<id>.json`) | scheduled metadata | no |
| `measure` | analyst | `metrics/<id>.json` | platform analytics API | no |

**Reviewers can only annotate, not rewrite.** This is the highest-leverage boundary in the whole pipeline — without it, reviewers drift into ghostwriting and the copywriter loses ownership.

---

## 4. Fan-out plan

Many posts run through the pipeline simultaneously. The copywriter is the most contended specialist.

| Specialist | Pool size | Rationale |
|------------|-----------|-----------|
| trend-researcher | 2 | research is batchy; usually one specialist covers a content cycle |
| copywriter | 5 | most contended; drafting is the bottleneck; per-post wall time is highest here |
| voice-reviewer | 3 | fast read-and-annotate, scales well |
| hook-reviewer | 3 | fast read-and-annotate, scales well |
| compliance-reviewer | 2 | careful work; quality drops at parallelism > 2 |
| scheduler | 2 | metadata only, very cheap |
| publisher | 2 | rate-limited by platform APIs; over-pooling triggers throttling |
| analyst | 2 | runs lazily after enough metrics accrue (24-48h after `post`) |

**WIP is per-stage.** The copywriter pool can be full while the compliance-reviewer pool is idle — that's normal pipeline geometry. Do not gate dispatch on global in-flight count.

**Pool-claim contract:** a copywriter instance claims a draft slot atomically before reading the brief. Two copywriters never draft the same post.

---

## 5. Orchestration model

**Recommendation: peer-to-peer handoffs with a central coordinator that wakes only on alerts.**

- The central coordinator (call it the "editor-in-chief") dispatches the first stage, then sleeps.
- Each specialist completes their work, sends `START` to the next stage, and signals `FYI` to the editor-in-chief.
- On `ALERT` (next pool full, platform API down for `post`, etc.) the editor-in-chief wakes to handle re-dispatch.

**Why P2P:** hook-review handing off to compliance-review is one message. Routing through a central poller would 2x the latency on every post.

**When central polling is fine:** if you publish 1-2 posts per day (e.g. an executive's personal account), a single-threaded sequential loop is simpler and the message protocol is overkill.

**Special case — `schedule` and `post`:** these stages are time-gated. The scheduler stamps a target window and the post-stage worker wakes at that time. The orchestration model here looks like cron: the publisher polls scheduled items by `post_at <= now()`, claims, posts, hands off to `measure` after a delay.

---

## 6. Verification passes

Three distinct skeptic angles. Each catches what the others can't.

| Pass | Stage | Angle | Look for |
|------|-------|-------|----------|
| voice-reviewer | `voice-review` | **does this sound like the brand?** | tone, vocabulary, sentence rhythm, banned words/cliches, voice drift toward generic-AI cadence |
| hook-reviewer | `hook-review` | **will this stop the scroll?** | first-line stopping power, specificity, curiosity gap, payoff, format-fit (X first-15-words, LinkedIn first-line, TikTok 1.5s visual hook) |
| compliance-reviewer | `compliance-review` | **is this safe to publish?** | brand-prohibited claims, legal/regulatory (FTC #ad disclosure, jurisdiction-specific claims), competitor mentions, PII in screenshots, music licensing |

The angles are deliberately non-overlapping. The voice-reviewer has no opinion on whether the hook works; the hook-reviewer has no opinion on FTC compliance; the compliance-reviewer has no opinion on whether the post sounds robotic. A single combined review collapses these angles and ships posts that are on-voice, hooky, and illegal.

### Rejection routing — earliest implicated stage

When a reviewer flags a defect that spans stages, route to the **earliest** stage implicated.

| Defect named in rejection | Route to | Specialist who fixes |
|---------------------------|----------|----------------------|
| Voice drift (generic phrasing) | `draft` | copywriter rewrites |
| Weak hook (buried lede) | `draft` | copywriter rewrites |
| Voice drift AND weak hook | `draft` (earliest implicated; one rewrite covers both) | copywriter |
| Compliance issue, fixable by phrasing | `draft` | copywriter rewrites |
| Compliance issue, structural (the post itself is non-compliant — e.g. medical claim) | `ideate` | trend-researcher reframes the angle entirely |
| Hook works but voice off | `draft` (rewrite preserving hook) | copywriter |
| Brand-banned word | `draft` | copywriter |
| Missing #ad disclosure | `draft` | copywriter (one-line addition) |
| Both voice AND compliance issue | `draft` | copywriter (single rewrite) |

**Rejection cap:** 3 round-trips per item. After 3, the item goes to `blocked` and the editor-in-chief surfaces it. Common cause of hitting the cap: the angle itself is bad and no rewrite saves it — a human should reframe or kill the post.

---

## 7. Enforcement

| Boundary | Enforcement |
|----------|-------------|
| copywriter cannot edit `reviews/**` | **hook** (`block-copywriter-reviews-writes.js`) — Write/Edit denied on review annotation files |
| voice-reviewer cannot edit drafts | **hook** (`block-reviewer-draft-writes.js`) — Write/Edit denied on `drafts/**`; only `reviews/<id>-voice.md` allowed |
| hook-reviewer cannot edit drafts | **hook** — same shape, scoped to `reviews/<id>-hook.md` |
| compliance-reviewer cannot edit drafts | **hook** — same shape, scoped to `reviews/<id>-compliance.md` |
| scheduler can only edit metadata | **hook** (`block-scheduler-content-writes.js`) — Write/Edit denied on `drafts/**` and `assets/**`; only `schedule/<id>.json` allowed |
| publisher cannot rewrite content at post-time | **hook** — Write/Edit denied on `drafts/**`; can only call platform API + write `posted/<id>.json` |
| reviewers must consult their guardrail skill before APPROVED | **soft (prompt)** — reviewer prompt invokes the relevant skill's Self-Check |

The reviewer-can't-rewrite hooks are load-bearing. Without them, every reviewer becomes a copywriter, voice consistency degrades, and the copywriter stops learning because their drafts get silently fixed.

Hook stubs live at `hooks/block-<role>-<scope>-writes.js` and follow the same shape as `scripts/hooks/block-murdock-impl-writes.js` in the A(i)-Team source repo.

---

## 8. Guardrail skills

| Skill | Used by | Self-Check covers |
|-------|---------|-------------------|
| `brand-voice-guide` | copywriter (self-check), voice-reviewer | tone descriptors, banned words, sentence rhythm patterns, persona consistency, "would-the-founder-say-this" gut check |
| `hook-patterns` | copywriter (self-check), hook-reviewer | platform-specific hook formulas (X open, LinkedIn first line, TikTok 1.5s visual), hook taxonomy (curiosity, contrarian, list, story-cold-open), specificity check, payoff-must-match-promise check |
| `platform-specs` | copywriter, scheduler, publisher | character limits, hashtag conventions, link handling, image dimensions, alt-text requirements, optimal post times by platform |
| `compliance-checklist` | compliance-reviewer | FTC disclosure rules, jurisdictional regulated-industry rules (finance, health, legal), competitor mention policy, music licensing, PII redaction |

When the brand updates its voice guide, you edit `brand-voice-guide` once. Every voice-reviewer picks it up on the next run. When a regulator publishes new disclosure rules, you edit `compliance-checklist` once. This is the central reason reviewer judgment lives in skills and not in agent prompts.

---

## Hand-off summary

Once a human runs `/workflow-builder:design` and produces this doc, `/workflow-builder:scaffold` would emit:
- Claude Code target: `.claude-plugin/plugin.json` named `social-pipeline`
- OpenCode target: `.opencode/agents/**`, `.opencode/commands/**`, `.opencode/skills/**`, and `.opencode/plugins/workflow-boundaries.ts` when hard boundaries are selected
- `agents/trend-researcher.md`, `copywriter.md`, `voice-reviewer.md`, `hook-reviewer.md`, `compliance-reviewer.md`, `scheduler.md`, `publisher.md`, `analyst.md`
- `commands/run.md` for `/social-pipeline:run`
- `hooks/block-copywriter-reviews-writes.js`, `block-reviewer-draft-writes.js` (parameterized per reviewer), `block-scheduler-content-writes.js`, `block-publisher-content-writes.js`
- `skills/brand-voice-guide/SKILL.md`, `hook-patterns/SKILL.md`, `platform-specs/SKILL.md`, `compliance-checklist/SKILL.md`

Each scaffolded file carries TODOs pointing back to `references/role-boundaries.md`, `references/multi-pass-verification.md`, and `references/guardrail-skills.md`.
