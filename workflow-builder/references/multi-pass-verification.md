# Multi-Pass Verification

What this is: the headline mechanic of A(i)-Team-style workflows. Quality is checked by **multiple distinct review passes**, each from a different angle, rather than one big checklist. Different angles catch different defects. A single reviewer with a long list always weights the front of the list.

---

## Why multiple passes

A single reviewer with a 40-item checklist will not give equal attention to every item. They will catch the things they happen to look for first, and tire out before the rest. Worse: a single reviewer has one mental model, and every defect that mental model does not naturally surface stays hidden.

Two reviewers with two **distinct angles** fix this. Each pass has a tight focus — a specific failure mode it is uniquely suited to catch. The other angles are explicitly out of scope for that pass.

This is not about adding more reviewers until you cover everything. It is about choosing **which angles** so the union of their coverage is wide and the overlap between them is small. Three passes designed thoughtfully beat ten passes that all kind of look at the same thing.

---

## The core question to ask for each pass

For every review stage in your pipeline, you should be able to answer:

> What failure mode does this pass uniquely catch — that the other passes cannot?

If the answer is "general quality" or "a careful eye," you have not designed a pass. You have a roving reviewer. The angle is the design.

A good angle has these properties:

- It names a specific failure mode (not "bugs," but "the test passes but the production code is not actually wired into the page").
- It implies a specific procedure (open the browser, navigate to the feature, click the thing, see the result).
- It is uncomfortable. Adversarial framing produces better catches than collegial framing.
- It cannot be done well alongside a different angle — focus is part of why it works.

---

## Three worked examples

The same structure realizes in three domains. Each pipeline has three review passes, each from a different angle, each catching what the others miss.

### Engineering pipeline (the source)

**Pass 1 — adversarial implementation review** (`agents/lynch.md:160-164`):

> After evaluating test quality, switch perspective: become an attacker trying to break the implementation. For each function in the diff, ask: **what input would break this function?** — null, empty string, zero, negative number, extremely large value, unicode, whitespace-only.

The angle: brittleness. The reviewer assumes happy-path code is fine and probes specifically for the inputs the author did not handle. Tests-as-written and code-as-written are both treated as evidence about the author's mental model — and the reviewer hunts for the gap.

**Pass 2 — don't-trust-tests, browser check** (`agents/amy.md:75-78`):

> DO NOT TRUST TESTS. Your job is to verify from the USER'S PERSPECTIVE, not the test's perspective. The `ai-team:perspective-test` skill explains why: tests mock integration points, components get defined but never wired, props get passed in tests but not in the real app.
>
> For UI features, you MUST load the app in a browser, navigate to where the feature should appear, interact as a user would, and verify the expected UI shows up.

The angle: integration / wiring. The reviewer assumes the unit tests pass (the previous pass already verified this) and probes for the "tests pass but the feature does not exist" failure mode. This catches the components-built-but-never-rendered case, the props-defined-but-never-passed case, the API-route-exists-but-routing-config-is-stale case.

**Pass 3 — holistic, spec-scoped final review** (`agents/stockwell.md:233-241`):

> This is your chance to see the forest, not just the trees.
>
> - Focus on PRD requirements vs actual diff — did we deliver what was asked?
> - Catch issues that only appear when code integrates
> - Be the security gate for the whole system
> - But still: if it works and is secure, approve it

The angle: cross-cutting consistency. The reviewer reads the original spec, reads the cumulative diff across the whole mission, and asks "did we build what was asked?" Catches scope drift, missing requirements, inconsistencies between independently-built features.

Three angles: brittleness, integration, spec-fidelity. Their overlap is small. Their union is wide.

### Video pipeline

**Pass 1 — visual coherence (motion-reviewer):** does the cut feel right? Are the graphics serving the story or competing with it? Are transitions motivated by content or arbitrary? Does the lower-third on this clip match the brand book? This pass looks at the timeline as a viewer experiencing the cut — not as a colorist or audio engineer.

**Pass 2 — audio mix (audio-reviewer):** integrated LUFS within delivery spec? Dialogue ducked appropriately under music? Any clipping, hum, hiss, breath pops, or room tone discontinuities at edit points? L/R channel balance correct? This pass ignores visuals entirely and listens with reference headphones.

**Pass 3 — delivery spec (qc):** correct aspect ratio for the target platform? Captions present and accurate? Codec, bitrate, container, color space, frame rate all match the delivery contract? File naming convention followed? Thumbnail conforms to spec? This pass treats the file as an artifact, not as a video — it does not care if the cut is good, only if it is correctly formatted.

Three angles: storytelling, sonic quality, delivery contract. A single "video reviewer" who tried to do all three would over-weight the first one (it is the most fun to think about) and skim the third (it is the most boring). Three passes force completeness.

### Social pipeline

**Pass 1 — voice match:** does this draft sound like our brand? Is the tone consistent with the voice guide (sentence rhythm, vocabulary, use of contractions, level of formality)? Would a longtime follower recognize this as us, or would it feel off? This pass reads as a brand-voice consistency check, not a content critique.

**Pass 2 — engagement strength:** is the hook strong (does the first line make a scrolling reader stop)? Is there a clear payoff to the post? Is the call-to-action specific and aligned with the post's purpose? Is the format right for the platform? This pass looks at the post as a piece of attention-economy content competing in a feed.

**Pass 3 — compliance:** legal claims accurate and substantiable? Disclosures present where required (sponsored, affiliate, AI-generated)? Platform rules followed (image dimensions, link placement, hashtag limits)? Brand-safety violations? Trademark misuse? This pass ignores quality entirely and asks only "will this get us in trouble?"

Three angles: brand voice, engagement design, risk. Each one's failures are invisible from the other two angles. A post can be on-brand and on-trend and still expose the company to a legal claim.

---

## Earliest-flagged-stage rejection routing

When a defect implicates multiple earlier stages, route the rejection to the **earliest** implicated stage — not the most recent.

The pipeline only flows forward. If you route to a later stage when an earlier-stage gap also exists, the next reviewer will bounce it back to the earlier stage anyway, costing an extra cycle. Routing to the earliest stage closes the loop in one cycle.

The A(i)-Team encodes this rule (`scripts/hooks/enforce-handoff.js:64-85`):

```javascript
// Earliest-flagged-stage principle: when a single rejection implicates
// failures at multiple pipeline stages, route to the EARLIEST flagged
// stage. The pipeline only flows forward (testing → implementing →
// review → probing), so routing to the earliest gap lets the rework
// flow through in one cycle.
//
// Amy's `testing` route exists for FLAGs that name a test gap (with or
// without an accompanying impl bug). FLAGs that name only an impl bug
// route to `implementing`.
const REJECTION_TARGETS = {
  lynch: { testing: 'murdock', implementing: 'ba' },
  amy:   { testing: 'murdock', implementing: 'ba' },
  ba:    { testing: 'murdock' },
};
```

The reference table (`skills/teams-messaging/SKILL.md:304-316`) makes the routing explicit per role:

| Rejector | Valid `--return-to` | REJECTED recipient |
|----------|---------------------|--------------------|
| Lynch    | `testing`           | `murdock-N`        |
| Lynch    | `implementing`      | `ba-N`             |
| Amy      | `testing`           | `murdock-N`        |
| Amy      | `implementing`      | `ba-N`             |
| B.A.     | `testing` (TEST BUG only) | `murdock-N`  |

Worked examples:

- **Engineering, Lynch finds an impl bug AND a missing test:** route to `testing` (earlier). Murdock writes the failing test that catches the bug; B.A. fixes the impl in pass-through. One cycle.
- **Engineering, Lynch finds an impl bug but tests are fine:** route to `implementing`. B.A. fixes directly.
- **Video, QC finds an audio glitch AND a wrong aspect ratio:** route to `audio-mix` (earlier). The audio engineer fixes the glitch; the export step re-renders with the correct aspect ratio. One cycle.
- **Video, QC finds only an aspect ratio mismatch:** route to `export`. No re-mix needed.
- **Social, compliance flags an unsubstantiated claim AND a tonal issue:** route to `draft` (earliest reviewable stage where copy is rewritten). Copywriter rewrites; voice-reviewer and hook-reviewer re-evaluate.

The principle: the rework should fix the cause, not the most recent symptom.

---

## Rejection cap → blocked

After N rejections (default 2 in A(i)-Team, configurable via `ATEAM_REJECTION_CAP`), the item transitions to a `blocked` state requiring human review.

This prevents infinite ping-pong. If an item has bounced between stages twice and the same defect is being flagged again, automation has done what automation can do — surface the item to a human.

A few design notes:

- **Count rejections per item, not per pipeline.** A pipeline that reliably ships with one rejection per item is fine; the cap is a per-item safety valve.
- **Increment the count atomically with the rejection itself.** Otherwise you can lose track in concurrent rework cycles.
- **Tune the cap to your tolerance.** Two is aggressive (catches problems early). Four is permissive (lets specialists iterate). Pick deliberately.
- **The blocked state needs an exit.** Most workflows allow a human to inspect a blocked item, fix it (or annotate it), and move it back to `ready` for redispatch.

---

## Adversarial framing in agent prompts

The angle of a review pass lives in the reviewer's prompt. Vague prompts produce vague reviews; specific adversarial framing produces specific catches.

**Bad — vague, opinion-seeking:**

```
You are a code reviewer. Review the changes in this PR for quality.
Look for issues with correctness, style, and maintainability.
Approve if the code looks good.
```

This reviewer will produce style nitpicks and "looks fine to me" approvals. Nothing in the prompt tells them what to look for or how hard to look.

**Good — specific, adversarial, procedural** (from `agents/lynch.md:160-164`):

```
After evaluating test quality, switch perspective: become an attacker
trying to break the implementation. For each function in the diff, ask:
**what input would break this function?** — null, empty string, zero,
negative number, extremely large value, unicode, whitespace-only.

Then run the `ai-team:defensive-coding` skill's Self-Check against the
diff (lookup guards, async error recovery, validation consistency, URL
encoding, resource cleanup, mode transition resets, in-flight guards).
Flag any function where the brittleness probe or self-check reveals a
path the tests do not cover and the code does not guard against.
```

Three things the good prompt does:

1. **Names the angle:** "become an attacker." The reviewer's frame of mind is set.
2. **Names the procedure:** for each function, list specific inputs to try.
3. **References an external checklist (a skill):** the substance of the angle lives in a checklist, not in the reviewer's instinct.

The same shape works for non-engineering reviewers:

**Video, audio-reviewer (good):**
```
Listen to the cut on reference headphones with visuals OFF. For each
edit point, listen for: clicks/pops, abrupt room tone changes, breath
discontinuity, drastic level shifts, music ducking errors. Run the
`audio-loudness-spec` Self-Check (integrated LUFS, true peak ceiling,
LRA window). FLAG any edit point that fails any item.
```

**Social, compliance-reviewer (good):**
```
Read the draft from the perspective of the legal team. For each
factual claim, ask: can I substantiate this with a public source?
For each comparison ("better than X"), ask: is this a substantiated
performance claim? Run the `platform-specs` and `disclosure-rules`
Self-Checks. FLAG any claim that lacks evidence, any comparison that
implies superiority without basis, any required disclosure that is
missing.
```

The pattern: name the angle, name the procedure, reference an explicit checklist. Avoid "use your judgment." Judgment is exactly what we are trying to backstop.

---

## Putting passes together

A few rules that travel across domains:

1. **Two or three passes is the sweet spot.** One pass overweights the front of the checklist. Five is too many handoffs and starts losing context between passes.
2. **Each pass owns its angle exclusively.** Do not let passes overlap their concerns — that is how passes implicitly delegate to each other and gaps appear.
3. **Each pass must have authority to reject.** A "pass" with no rejection edge is documentation, not verification.
4. **Reviewers do not rewrite.** Reviewers annotate (and reject). Rewriting belongs to the original specialist — see `role-boundaries.md`. If reviewers ever modify the work they are reviewing, they erase the verification value.
5. **The final pass is holistic.** End with a spec-scoped or delivery-scoped pass that asks "did we deliver what was asked?" The earlier passes are tactical; the final one is strategic.

The result is a verification stack where each pass is sharp, the union is wide, and rejections route to where the rework actually belongs.
