# Orchestration and Fan-Out

What this is: the two coordination decisions every multi-agent workflow has to make explicit — who dispatches handoffs (orchestration model), and how parallelism within a stage is managed (fan-out strategy). Get these wrong and the pipeline either bottlenecks or thrashes.

---

## Decision 1: orchestration model

Three viable models. Pick one and commit.

### Central orchestration

One coordinator agent receives every signal and dispatches every handoff. When a stage finishes, it tells the coordinator; the coordinator picks the next agent and dispatches.

- **Strengths:** every handoff is observable in one place. Easy to debug ("what did the coordinator do?"). Easy to enforce global invariants like rejection caps and dependency gates.
- **Weakness:** the coordinator becomes a throughput bottleneck and a single point of failure. Every handoff round-trips through it.
- **When to choose it:** small workflows (1-3 items in flight at any time). Workflows where "what's happening?" visibility matters more than throughput.

### Peer-to-peer (P2P) orchestration

Each specialist hands off directly to the next. No central dispatcher in the middle of the pipeline.

- **Strengths:** parallelism scales linearly with stage count. Handoffs are atomic between two parties. No bottleneck.
- **Weakness:** debugging is harder — there is no central log of every transition. Errors at handoff time can leave items in indeterminate states. Global invariants need explicit enforcement at each handoff site.
- **When to choose it:** rarely on its own. The hybrid model below is almost always better.

### Hybrid: P2P happy path + central wakeup-on-alert (recommended default)

Specialists hand off directly to one another. A central coordinator is alive for the whole mission but only intervenes when a handoff fails or an exception fires.

The A(i)-Team uses this model. Pipeline workers (Murdock → B.A. → Lynch → Amy) hand off peer-to-peer; Hannibal sits in a 4-phase event loop and processes incoming messages (`playbooks/orchestration-native.md:417-571`):

```
LOOP CONTINUOUSLY:
    PHASE 1: PROCESS INCOMING MESSAGES (FYI / ALERT / DONE)
    PHASE 1b: DRAIN PENDING ALERTS
    PHASE 2: CHECK DEPENDENCY GATES (catch-all)
    PHASE 3: FILL PIPELINE FROM READY (per-column WIP limits)
    PHASE 4: COMPLETION DETECTION (FALLBACK)
```

The coordinator does **not** poll. It waits for messages. Each pipeline agent emits an `FYI` after a successful handoff (informational — coordinator updates its tracking map and moves on) or an `ALERT` if the handoff fails (queued for redispatch when capacity opens). On `MISSION_COMPLETE`, the coordinator transitions out of the loop and into the final-review sequence.

The coordinator's forbidden list (`agents/hannibal.md:681-768`) is just as important as its responsibilities:

> 1. NEVER use Write/Edit on `src/**` — implementation belongs to the implementer.
> 2. NEVER approve/reject work items — verdicts belong to the reviewer.
> 3. NEVER fix bugs directly — the investigator reports, the implementer fixes.
> 4. NEVER bypass the CLI — all state changes via canonical commands.

Generalize: **the coordinator dispatches. It does not do the work.** If the coordinator is editing files, redrawing the timeline, rewriting copy, or "just this once" implementing a fix, the role boundaries are gone and the pipeline's quality gates collapse with them.

Domain realizations of the same hybrid pattern:

- **Video pipeline:** an `orchestrator` agent is alive for the whole render run. The editor hands off directly to the motion-designer; only on a failed handoff (motion-designer pool empty, render pipeline crashed) does the orchestrator step in.
- **Social pipeline:** the coordinator dispatches the first specialist (copywriter) for each post idea. Copywriter hands directly to voice-reviewer, who hands directly to hook-reviewer, etc. The coordinator only intervenes if a reviewer rejects with no specialist instance available.
- **Engineering:** as described above.

---

## Decision 2: event-driven, not polling

Whichever orchestration model you pick, the loop is event-driven.

Polling means the coordinator wakes up on a timer and asks "is anyone done yet?". This is wasteful (most polls find nothing) and laggy (work sits idle between polls).

Event-driven means the coordinator wakes up when a message arrives. The bus delivers `FYI`, `ALERT`, `DONE`, `BLOCKED` messages; the coordinator processes each and goes back to sleep.

The protocol the A(i)-Team uses, abstracted (see `skills/teams-messaging/SKILL.md`):

| Message | Direction | Meaning |
|---------|-----------|---------|
| `START` | sender → next agent | "I finished my stage; here is the work for yours." |
| `ACK` | receiver → sender | "Got it, beginning work." |
| `FYI` | any agent → coordinator | "Handoff succeeded; here is the new state." |
| `ALERT` | any agent → coordinator | "Something needs intervention; the handoff failed or no instance was available." |
| `REJECTED` | reviewer → upstream peer | "I am sending this back to you with a specific defect to fix." |
| `DONE` | terminal agent → coordinator | "Pipeline finished for this item; nothing further to hand off." |
| `BLOCKED` | any agent → coordinator | "I cannot proceed without help." |

A handoff sequence in the happy path:

1. Stage N finishes. Specialist calls the runtime's "advance" command, which atomically advances the item and (if a next-stage instance is idle) claims the next slot.
2. Specialist sends `START` directly to the claimed next-stage instance.
3. Specialist waits up to 20 seconds for `ACK`.
4. On `ACK`: specialist sends `FYI` to the coordinator and exits.
5. On no `ACK`: specialist sends `ALERT` to the coordinator, who handles redispatch.

The coordinator never gets in the way of the handoff itself — it is informed, not consulted.

---

## Decision 3: fan-out via instance pools

When a stage needs to process multiple items in parallel, spawn N instances of that stage's specialist (`editor-1`, `editor-2`, `editor-3`). Each instance owns one item at a time. The pool's job is to make item-to-instance assignment **atomic** — no two items end up on the same instance, and no item ends up on a busy instance.

The A(i)-Team implements this with a file-based pool (`skills/pool-handoff/SKILL.md`). Each instance has a slot file in a shared directory, with a state suffix:

- `editor-1.idle` — the instance is free.
- `editor-1.busy` — the instance is working an item.

Claiming an instance is an atomic file rename: `editor-1.idle` → `editor-1.busy`. Filesystem rename is atomic on POSIX, so two upstream agents racing to claim the same slot will see exactly one winner — the loser's rename fails and it tries the next slot.

The exit-code contract makes the race-loser case crisp:

```
| Exit | Meaning                                              |
|------|------------------------------------------------------|
| 0    | Slot claimed (you won)                               |
| 2    | Already claimed by an upstream pre-claim — proceed   |
| 3    | No such instance                                     |
| 4    | Corrupted state                                      |
| 5    | Pool dir missing                                     |
```

The pattern generalizes beyond filesystems — any atomic compare-and-swap will do (Redis SETNX, a database UPDATE with a WHERE clause on status, etc.). The point is that the claim primitive must be atomic so concurrent upstream specialists never both think they own the same slot.

Realizations:

- **Video:** `editor-1`, `editor-2`, `editor-3` for a 3-way fan-out at the rough-cut stage. Each owns one video clip. The motion-designer pool is similarly sized.
- **Social:** `copywriter-1` through `copywriter-5` if the daily volume justifies it.
- **Engineering:** `murdock-1`, `murdock-2`, etc., one per pipeline lane.

---

## Decision 4: per-stage WIP limits

WIP (work-in-progress) limits cap how many items can be in a stage at once. **Limits are per stage, not global.**

The A(i)-Team makes this explicit (`agents/hannibal.md:176-197`):

> WIP is enforced per stage (per column), not as a global count across the whole pipeline.

WRONG (global WIP):
```
in_flight = count(testing) + count(implementing) + count(review)
if in_flight >= WIP_LIMIT: wait   # blocks idle agents unnecessarily
```

RIGHT (per-stage WIP):
```
# Each stage is independent. If the next-stage instance is idle, dispatch.
claimed = claimInstance("murdock")
if claimed: dispatch(claimed, item_id)
```

A per-stage cap is just the pool size of that stage. If `editor` has 3 instances, the WIP limit at `rough-cut` is 3. There is no separate global cap to reason about.

The failure mode of a global WIP cap: if `review` is full and `implementing` is empty, the global cap blocks new items from entering `implementing` even though there is capacity there. Idle specialists, idle pipeline.

---

## Decision 5: lazy lane spawning

Spawning the full pool up front is wasteful. Most pipelines have a Wave 1 scaffold step (1 item) followed by a fan-out wave (N items). Pre-warming all N pipeline lanes at mission start leaves N-1 lanes idle for Wave 1 and burns context budget on agents that may never receive work.

The A(i)-Team uses lazy lane spawning (`playbooks/orchestration-native.md:188-365`):

- At mission start, spawn lane 1 only.
- On every dispatch attempt: if no idle instance is found AND there are unspawned lanes, spawn the next lane *before* falling back to "all instances busy."
- Wait for all agents in the new lane to send a `READY` signal before marking their slots idle.

```
# Mission start — spawn lane 1 only
spawn_lane(1)

# Wave 1 has 1 item — Phase 3 dispatches WI-001 to murdock-1
# Lane 2 stays unspawned. No wasted context.

# Wave 2 has 4 items — Phase 3 attempts:
#   claim murdock → murdock-1 already busy → null
#   spawn_lane(2)
#   claim murdock → murdock-2 (newly idle)
# Lane 2 spawned exactly when needed.
```

This keeps the pool sized to actual demand. For a pipeline that never needs more than 2 lanes, lanes 3 and 4 are never spawned — saving the cost of N idle agents.

---

## Decision 6: dispatch timeout and crash recovery

Agents crash. Subprocesses die. Network hiccups. Plan for it.

The A(i)-Team enforces a 60-second acknowledgment timeout after every dispatch (`playbooks/orchestration-native.md:600-644`):

```
function dispatch_with_timeout(instance, item_id):
    dispatch(instance, item_id)
    deadline = now() + 60s

    while now() < deadline:
        msg = receive next SendMessage (timeout: deadline - now())
        if msg confirms activity from instance (ACK, FYI, or teammate_idle):
            return SUCCESS

    # Timeout — agent is presumed crashed
    Bash("ateam pool release {instance.name}")
    SendMessage(type: "shutdown_request", recipient: instance.name, ...)
    Task(... same params as original spawn ...)
    # Wait for READY, then redispatch
```

Three rules that travel:

1. **Use message-based health signals, not process-existence checks.** A process can exist with a dead worker inside it. The A(i)-Team puts it bluntly: "Do NOT check tmux pane liveness as a proxy for agent health."
2. **Release the dead agent's claim** when timing out, so it does not block other handoffs.
3. **Respawn before redispatching.** If the respawn also fails, mark the lane degraded and surface a single `ALERT` — do not spin retrying.

---

## When NOT to fan out

Fan-out has a coordination tax: pool management, atomic claims, lazy spawning, timeout handling. It is worth paying when you have many items in flight. It is **not** worth paying when you don't.

If your workflow has 1-2 items at a stage at any given time, run sequentially. One specialist instance per stage. No pool, no claim primitive, no lane spawning. The orchestration model becomes "the coordinator dispatches the next stage when the current one finishes."

Some signs you do not need fan-out:

- Items arrive serially (one per day, one per command invocation).
- Each item takes long enough that you would not realistically run multiple in parallel.
- The specialist's tooling does not parallelize cleanly (e.g., a video render that saturates the GPU — running two in parallel just makes both slower).
- The cost of the coordination machinery exceeds the speedup you would get.

The A(i)-Team supports an N=1 fallback (`skills/pool-handoff/SKILL.md`) where filenames are just `murdock.idle`, `ba.busy`, etc. Same protocol, no parallelism. Pick this when the workflow does not justify the fan-out tax.

---

## Putting it together: three workflow shapes

### Video pipeline (high fan-out, hybrid orchestration)

- Pool per production stage: `editor-1..3`, `motion-designer-1..3`, `colorist-1..2`, `audio-engineer-1..2`, `qc-1`.
- Hybrid: editor hands directly to motion-designer; coordinator only intervenes on no-idle-instance ALERT.
- Lazy lanes: a 3-clip batch only spawns lane 2 when needed; a 1-clip batch never spawns lane 2.
- Per-stage WIP = pool size; an idle colorist takes work even if the editor pool is full.

### Social pipeline (moderate fan-out, hybrid orchestration)

- Smaller pools: `copywriter-1..3`, single instance for each reviewer (`voice-reviewer`, `hook-reviewer`, `compliance-reviewer`).
- Hybrid: copywriter hands directly to voice-reviewer.
- Reviewers may bottleneck — measure first, scale up if throughput suffers.

### Single-author daily essay (no fan-out, central orchestration)

- One specialist per stage. No pool needed.
- Central orchestrator: dispatches each stage in order. Simple is fine here.
- Skip lazy spawning, skip timeout handling beyond a basic "did this finish?" check.

The point: each decision in this document scales independently. Pick the model that fits your throughput needs and pay only for the coordination machinery you actually use.
