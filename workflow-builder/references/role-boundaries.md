# Role Boundaries

What this is: every specialist in a workflow has an explicit **write boundary** (what they can modify) and **read boundary** (what they can see). Boundaries make ownership legible and review meaningful — without them, "code review" is reviewing your own work and "QC" is approving the cut you just made.

---

## Why boundaries matter

A pipeline's quality gates depend on each stage being **owned by exactly one role**. If two roles can write to the same artifact, you no longer know who is responsible when it breaks. If a reviewer can rewrite the work they are reviewing, the review is theater — they will fix issues silently rather than flag them, and the original specialist never learns.

Boundaries codify ownership. The specialist who owns a stage's output is the only one who can write to it. Everyone else can read (usually) but not modify. Rejection routing replaces "fix it yourself" — when a reviewer finds a defect, they send the item back to the owning specialist with a specific note.

This is the same mechanism that makes specialization possible. A motion-designer who can also rewrite the colorist's grade nodes is not really a motion-designer — they are an everything-designer who picks up whichever task is in front of them. The boundary is what makes the role a role.

---

## Write boundary

The write boundary is the set of paths/resources/artifacts a specialist can modify. State it as explicit globs or resource patterns, not prose.

### Example boundaries across domains

**Video pipeline:**
- `editor`: `timeline/*.fcpxml`, `proxies/*` — the timeline file and proxy renders.
- `motion-designer`: `graphics/*.aep`, `graphics-renders/*` — After Effects projects and rendered graphics layers. NOT the timeline.
- `colorist`: `grade/*.cube`, `grade-nodes/*` — color LUTs and grade nodes. NOT the timeline, NOT the graphics.
- `audio-engineer`: `audio/*.wav`, `mix/*.aaf` — audio stems and mix sessions. NOT video.
- `qc-agent`: nothing — QC annotates and rejects, never modifies.

**Social pipeline:**
- `copywriter`: `drafts/*.md` — the post copy itself.
- `voice-reviewer`, `hook-reviewer`, `compliance-reviewer`: nothing — annotate and reject only.
- `scheduler`: `metadata/*.json`, `schedule.json` — scheduling and tagging metadata. NOT the copy.
- `publisher`: `published/*.json` — publication records. NOT the copy or metadata.
- `analyst`: `metrics/*.json` — measurement records.

**Engineering pipeline:**
- `tester` (Murdock): `**/*.test.ts`, `**/__tests__/`, `**/types/**`. NOT `src/` impl files. Cite (`scripts/hooks/block-murdock-impl-writes.js:97-103`):

  ```
  // Block everything else — this is implementation territory
  const reason = `BLOCKED: Murdock cannot write implementation files: ${filePath}.
                  Implementation is B.A.'s job.`;
  ```

- `implementer` (B.A.): `src/**` impl files. NOT test files. Cite (`scripts/hooks/block-ba-test-writes.js:42-49`):

  ```
  // Block writes to test/spec files
  if (filePath.match(/\.(test|spec)\.(ts|js|tsx|jsx)$/)) {
    const reason = `BLOCKED: B.A. cannot modify test files: ${filePath}.
                    Tests are Murdock's responsibility.`;
  ```

- `reviewer` (Lynch): nothing in the diff — annotate and reject only.
- `investigator` (Amy): nothing in production code — investigate and report only.
- `documentation` (Tawnia): `README.md`, `CHANGELOG.md`, `docs/**`. NOT `src/`, NOT tests.

A simple way to test if your boundary is well-drawn: read it aloud and check whether you can name a specific file the role would *try* to edit but is not allowed to. If you can't, the boundary is too vague.

---

## Read boundary

Read boundaries are usually broader than write boundaries — specialists need context. The colorist needs to see the timeline (to know what shots to grade). The reviewer needs to see the impl, the tests, and the spec.

Narrow the read boundary only when you have a specific reason:

- **Security:** the publisher does not need access to upstream source files; restrict to the published artifact only.
- **Focus:** the audio-reviewer reviews with visuals OFF (a discipline embedded in the prompt, sometimes also in tooling).
- **Independence:** sometimes you want a reviewer to review without being primed by upstream rationales — limit them to the artifact, not the discussion thread that produced it.

When in doubt, allow read access and tighten only when a specific failure mode demands it.

---

## Hard vs soft enforcement

Boundaries can be enforced two ways:

### Hard (hook-enforced)

A pre-tool-use hook intercepts every Write/Edit call and blocks paths outside the role's write boundary. The tool call fails before any change is made.

Hard enforcement looks like the hook excerpts above (`block-murdock-impl-writes.js`, `block-ba-test-writes.js`). The hook reads the agent identity, reads the path the tool is targeting, and either allows the call or exits with an error code that the runtime treats as a tool failure.

**Use hard enforcement when:**

- A boundary violation would corrupt the workflow. The clearest case: a reviewer rewriting the artifact under review erases the verification. Once the reviewer has touched the artifact, you cannot tell whether the original specialist's work was correct.
- The role is operating with reduced supervision (a background agent, a long-running automation). A prompt-only boundary depends on the agent reading and obeying it; a hook does not.
- The cost of recovery from a violation is high. If the colorist's accidental edit to the timeline blew away an hour of editor work, hard-block.

The A(i)-Team uses hard enforcement for exactly the cases above. The orchestrator (Hannibal) cannot Write/Edit `src/`. The tester cannot write impl. The implementer cannot write tests. Every reviewer is blocked from Write/Edit on the diff. The hooks are load-bearing — without them, role drift creeps in within a single mission.

### Soft (prompt-only)

The boundary lives in the role's prompt as a clear instruction. No hook backs it up.

**Use soft enforcement when:**

- The violation is unlikely (the role would have to specifically choose to misbehave).
- The violation is recoverable (the artifact can be regenerated, the change can be reverted).
- You are still designing the workflow and want to see what the role naturally does before deciding where to harden.

Soft enforcement is a perfectly reasonable starting point — most workflows do not need every boundary hooked from day one. The risk is that "soft" can drift into "ignored." If a soft boundary is regularly violated, escalate it to hard.

### When to escalate from soft to hard

Watch for these signals during the first few runs:

- The role *did* violate the boundary, and it caused a problem (escalate).
- The role violated the boundary "helpfully" — fixing something it noticed in passing — and the fix made the next reviewer approve work that should have been rejected (escalate immediately).
- A reviewer started rewriting instead of annotating (escalate immediately — this kills the verification value).
- The role is asking permission to violate the boundary in its messages ("can I just fix this?"). The fact that it is asking means a clear hard rule would help it.

Conversely, if a soft boundary has held for many runs without drift, it does not need to be hardened. Don't pay the maintenance cost of a hook for a rule the role naturally respects.

---

## Boundary statement format

Put the write and read boundaries in the agent's frontmatter or opening section, in explicit globs. The role file is the canonical place — not the orchestrator, not a separate config.

Recommended format:

```markdown
---
name: editor
model: sonnet
description: Video editor — assembles rough cuts from raw footage.
---

# Editor

## Write boundary

You may modify ONLY:
- `timeline/*.fcpxml` — the timeline project file
- `proxies/*` — proxy renders
- `notes/<item-id>.md` — your editor notes for the current clip

You may NOT modify:
- `graphics/**` — that is the motion-designer's territory
- `audio/**` — that is the audio-engineer's territory
- `grade/**` — that is the colorist's territory
- Any file outside the project's `clips/<item-id>/` working directory

## Read boundary

You may read anything in the project's `clips/<item-id>/` directory and
the brand's reference materials at `brand/voice.md` and `brand/visual.md`.

## Role

[role prompt here]
```

A few notes on this format:

- **Write boundary first, role description second.** The boundary is the single most important piece of information in the file. Put it where someone debugging a violation will find it.
- **List both what you can do and what you cannot.** The "may NOT" list is what makes the boundary specific.
- **Use globs, not prose.** "Editor handles cutting work" is not a boundary; `timeline/*.fcpxml` is.
- **Reference the hook that enforces it.** If a hook backs the boundary, link to the hook file in a comment so future maintainers know where the enforcement lives.

---

## Reviewers as a special case

Reviewers have a particularly important boundary: **annotate only, no rewrites.**

If a reviewer ever modifies the artifact under review, they have erased the verification. You cannot tell whether the original specialist would have caught the issue, whether the work meets the spec as the specialist produced it, or whether the rework cycle is correctly attributing defects.

Reviewers must:

- **Read the artifact.**
- **Annotate findings** — usually as messages or structured rejection records. The A(i)-Team's `agentStop --outcome rejected --return-to <stage> --summary "..."` is one realization.
- **Reject with specifics** — name the AC, the observed gap, the specific change required. Vague rejections ("looks off") are not useful to the upstream specialist.
- **Never edit the diff/artifact themselves.**

This boundary is often soft (lived in the prompt) but the moment it is violated, harden it. The A(i)-Team hardens it with hooks for every reviewer role: `block-lynch-writes.js`, etc. Reviewer rewrites are the most common boundary violation in practice and the most damaging — they should be the first boundary you protect with a hook.

---

## Quick checklist

For each role in your workflow, verify:

1. The write boundary is stated as explicit globs/patterns, not prose.
2. The "may NOT modify" list is non-empty (a role with no restrictions is not a role — it is a generalist).
3. The read boundary is broader than the write boundary by default; narrow only with a stated reason.
4. The enforcement (hard or soft) is chosen deliberately. Hard for reviewers and high-cost violations; soft is a fine starting point elsewhere.
5. Each reviewer's boundary forbids modifying the artifact under review.
6. The boundary lives in the role's file (not in the orchestrator and not in a separate doc).

When boundaries hold, the rest of the workflow's quality machinery — multi-pass verification, rejection routing, role specialization — works as designed. When they leak, every quality gate downstream gets quietly weakened.
