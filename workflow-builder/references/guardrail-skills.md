# Guardrail Skills

Reviewer standards belong in skills, not in the reviewer's prompt. A guardrail skill is an explicit, versioned checklist a reviewer applies to the work in front of it. The reviewer's prompt names the skill; the skill carries the rules.

---

## The Pattern

Reviewers (the agents that say "this is fine" or "send it back") have one job: catch defects from a particular angle. The quality of a reviewer is determined by the *checklist* it applies, not by its judgment in the moment.

A guardrail skill captures that checklist as a discrete, named artifact:

- **Banned anti-patterns** — things the reviewer must reject on sight, with examples.
- **Required checks** — boxes the reviewer must tick before approving, each with a one-line rationale.
- **A self-check section** — the same list, written for the producer to use *before* submitting, so reviews are short.

The reviewer's prompt is then short and stable: "Apply the `<skill-name>` checklist to the work. Reject any item that violates a rule."

When standards change — a new failure mode, a new platform requirement, a new policy — you edit the skill, not every reviewer's prompt.

---

## Bad vs Good

A reviewer prompt that relies on judgment produces inconsistent reviews. The same submission can be approved one day and rejected the next, depending on what the reviewer happens to notice.

```
# BAD: opinion-only review
"Review the work for quality. Flag anything that looks wrong."
```

The same prompt, refactored to reference an explicit skill, produces deterministic reviews:

```
# GOOD: skill-anchored review
"Apply the `motion-design-standards` skill's Self-Check section to the diff.
Reject any motion clip that violates these rules. Cite the specific rule for
each rejection (e.g., 'Rule 3: Easing curves must use ease-out for entrances')."
```

The "good" prompt is enforceable. A second reviewer reading the same skill will reach the same verdict on the same work. Drift is in the skill (versioned, reviewable, A/B testable), not in 12 different prompts.

---

## What a Guardrail Skill Looks Like

A guardrail skill is small and focused. One skill = one angle. Keep them tight enough that a reviewer can hold the whole list in working memory.

The shape:

1. **Frontmatter** — `name` and `description` fields the runtime auto-discovers.
2. **A short opening** — one paragraph stating the rule the skill enforces ("every clip must hold its frame for at least 200ms after the last motion ends").
3. **A list of N rules** — each with a name, a one-line "why," and a Bad/Good example pair.
4. **A Self-Check section** — the same list, recast as questions the producer answers before submitting.

The A(i)-Team plugin uses this shape for engineering guardrails. Three examples to read directly:

- `skills/test-writing/SKILL.md` — 13 banned anti-patterns for test code, each with a Bad and Good code block, plus a 21-item self-check at the end. The reviewer (Lynch) cites this skill rather than judging "is this a good test?"
- `skills/perspective-test/SKILL.md` — three-layer wiring verification (static analysis, wiring trace, browser check). Catches a class of defect (broken integration that passes unit tests) that no single test layer can.
- `skills/defensive-coding/SKILL.md` — eight defensive patterns (guard before operate, async error recovery, resource cleanup, etc.) with language-agnostic pseudocode and a 13-item self-check.

These are *engineering* guardrails. The shape transfers; the contents do not.

---

## Domain-Mapped Examples

For each verification angle a workflow needs, codify it as a guardrail skill.

### Video production

| Angle | Guardrail skill | What it checks |
|---|---|---|
| Pacing | `cutting-rhythm-guide` | Average shot length per scene type; cut-on-action rules; J-cuts and L-cuts; dwell time after motion ends. |
| Motion design | `motion-design-standards` | Easing curves (ease-out for entrances, ease-in for exits); no linear motion on camera moves; minimum frame hold; staggered animation timing. |
| Audio delivery | `audio-loudness-spec` | LUFS target per platform (-14 LUFS for YouTube, -16 for podcasts); peak ceiling (-1.0 dBTP); silence at head/tail; hum and clip detection. |

A `motion-reviewer` agent's prompt becomes: "Apply the `motion-design-standards` Self-Check to every motion clip in this scene. Reject any clip that fails a check, citing the rule."

### Social content

| Angle | Guardrail skill | What it checks |
|---|---|---|
| Tone | `brand-voice-guide` | Banned phrases ("game-changer", "unprecedented"); sentence length distribution; persona consistency (first person? second?); emoji policy. |
| Engagement | `hook-patterns` | First-three-words tests; question-vs-statement balance; specific-number rule (avoid "a lot", use "37"); "you-first" framing. |
| Compliance | `platform-specs` | Character limits per platform; hashtag count caps; required disclosures (#ad, #sponsored); link policies; image aspect ratios. |

A `voice-reviewer` agent's prompt: "Apply the `brand-voice-guide` checklist to this draft. Reject any draft that violates a banned-phrase rule or persona rule."

### A(i)-Team engineering

The pattern is the same, applied to code:

- `test-writing` codifies what a real test looks like.
- `perspective-test` codifies the wiring-verification angle.
- `defensive-coding` codifies the resilience angle.

Each reviewer (Murdock for tests, Lynch for code review, Amy for integration) loads the relevant skills via frontmatter and applies them.

---

## Why This Beats a Long Agent Prompt

Putting the checklist in the agent prompt instead of a skill loses on four axes:

1. **Token budget.** Long prompts get truncated or compress badly. A 2,000-token reviewer prompt with embedded rules competes with the actual work being reviewed.
2. **Drift.** When the same checklist appears in three reviewers' prompts, they diverge. Someone updates one, forgets the others.
3. **Versioning.** Skills are files. They live in source control. You can diff a skill across versions and see "we added rule 7 last Tuesday." You cannot meaningfully diff three reviewer prompts.
4. **A/B testing.** "Run mission with `motion-design-standards@v2` for half the items, `@v1` for the other half" is a one-line change. The same experiment with embedded prompts requires forking the agent.

A skill is a unit of *content*; an agent is a unit of *behavior*. Keep them separate. The agent decides when and how to apply the checklist; the skill decides what's on it.

---

## When You DON'T Need a Guardrail Skill

Not every reviewer needs a skill. The threshold is roughly:

- **1-3 items:** put it in the prompt. "Reject if the file is over 10MB, the title contains profanity, or the duration exceeds 60 seconds." A skill is overhead.
- **4+ items, evolving:** make a skill. The list will grow. You want one place to add to it.
- **Multi-reviewer reuse:** if the same standards apply to two or more reviewers (e.g., both `voice-reviewer` and `compliance-reviewer` reference the brand voice rules), the skill is mandatory — no copy-paste.
- **Standards owned by a different team:** if the marketing team owns the voice rules, give them a skill they edit. The reviewer agent stays untouched.

---

## A Reviewer's Prompt That Does It Right

Here is what a reviewer agent's body looks like once standards live in skills:

```markdown
# voice-reviewer

You review social drafts for brand voice match.

## Process
1. Load the `brand-voice-guide` skill.
2. For each draft:
   a. Apply every rule in the Self-Check section.
   b. If any rule fails, reject with the rule name and a one-line quote of the violation.
   c. If all rules pass, approve.

## You do NOT
- Rewrite drafts. Annotate only.
- Apply rules not in the skill.
- Use judgment beyond the checklist.

## Output
For each draft: APPROVE or REJECT. If REJECT, list the failing rules and the quoted text.
```

Total: ~15 lines. The reviewer is now a function of the skill.

---

## Self-Check for Workflow Designers

When designing a verification pass, ask:

1. Does the reviewer have an explicit checklist, or are they "using their judgment"?
2. If a checklist exists, is it in a skill (versioned, swappable) or embedded in the prompt (drifting, opaque)?
3. Does the checklist have at least one Bad/Good example per rule? A rule without an example is ambiguous.
4. Could a second reviewer apply the same skill to the same work and reach the same verdict? If not, the skill is too vague.
5. Is the same skill referenced by every reviewer that needs those standards? Duplication is drift waiting to happen.
