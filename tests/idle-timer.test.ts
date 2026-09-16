import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "./helpers";

const SCRIPT = join(REPO_ROOT, "handoff", "scripts", "idle-timer.sh");

// Claude Code's input line begins with U+276F (the glyph) followed by a
// NON-BREAKING SPACE (U+00A0), not an ASCII space, confirmed by hexdumping
// a live pane's captured input line. Built from explicit numeric escapes
// rather than pasted characters: a pasted NBSP is invisible in a diff, and
// an editor silently normalizing it back to a plain space is exactly the
// bug this constant exists to guard against (idle-timer.sh's own marker is
// built the same way, for the same reason -- see its "input_marker" comment).
const INPUT_MARKER = "\u276F\u00A0";
// A scrollback line can legitimately begin with the glyph followed by an
// ordinary ASCII space -- e.g. Claude Code echoing a past prompt back into
// the transcript above the live input line. This is the exact false
// positive an earlier, unanchored ASCII-space-based match picked up in
// review; used below to assert it is never mistaken for the real input
// line, which only ever starts with INPUT_MARKER (the NBSP form).
const ASCII_SPACE_LOOKALIKE = "\u276F ";

let repo: string;
let bin: string;
let tmuxLog: string;
let tmuxPanes: string;
let tmuxCapture: string;
let bigTranscript: string;

// Timer processes armed by a test (idle-timer.sh --fire, its own process
// group leader) get killed as a group. A plain dummy process used only to
// occupy a pid for the pid-reuse test is NOT a group leader of anything of
// ours, so it is tracked and killed separately — signalling its negative pid
// would hit this test runner's own process group instead.
let armedPids: number[];
let plainProcesses: ChildProcess[];

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitFor(predicate: () => boolean, timeoutMs = 3000, intervalMs = 50): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    Bun.sleepSync(intervalMs);
  }
  return predicate();
}

function pidfilePath(lane: string) {
  return join(repo, ".handoff", `${lane}.timer.pid`);
}

function draftPath(lane: string) {
  return join(repo, ".handoff", `${lane}.draft.txt`);
}

/** Reads a pidfile as {pid, token}, or null if it does not exist. */
function readPidfile(lane: string): { pid: number; token: string } | null {
  const path = pidfilePath(lane);
  if (!existsSync(path)) return null;
  const [pid, token] = readFileSync(path, "utf-8").trim().split(/\s+/);
  return { pid: Number(pid), token: token ?? "" };
}

/** Runs idle-timer.sh in Stop hook mode with the given JSON payload on stdin. */
function run(payload: Record<string, unknown>, env: Record<string, string> = {}) {
  return execFileSync("bash", [SCRIPT], {
    cwd: repo,
    input: JSON.stringify(payload),
    encoding: "utf-8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      // Cleared first so this test runner's own environment (a real
      // TMUX_PANE, an inherited HANDOFF_LANE) can't leak into a case that
      // expects one of these to be unset — same posture as session-start.test.ts.
      HANDOFF_LANE: "",
      HERDR_PANE_ID: "",
      TMUX_PANE: "",
      TMUX: "",
      TMUX_STUB_LOG: tmuxLog,
      TMUX_STUB_PANES: tmuxPanes,
      TMUX_STUB_CAPTURE: tmuxCapture,
      ...env,
    },
  });
}

function stopPayload(overrides: Record<string, unknown> = {}) {
  return { transcript_path: bigTranscript, cwd: repo, agent_id: "", ...overrides };
}

/** Arms a timer for `lane` and returns its recorded pid, tracked for cleanup. */
function arm(lane: string, env: Record<string, string> = {}) {
  run(stopPayload(), { HANDOFF_LANE: lane, TMUX_PANE: "%1", TMUX: "fake", HANDOFF_IDLE_SECONDS: "100", ...env });
  expect(waitFor(() => readPidfile(lane) !== null)).toBe(true);
  const entry = readPidfile(lane);
  if (entry) armedPids.push(entry.pid);
  return entry;
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "handoff-idle-timer-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });

  bin = mkdtempSync(join(tmpdir(), "handoff-idle-timer-bin-"));
  const tmuxStub = join(bin, "tmux");
  // Records every invocation to TMUX_STUB_LOG so tests can assert on the
  // exact call sequence, and answers the two read commands idle-timer.sh
  // actually issues (list-panes for existence, capture-pane for salvage)
  // from files the test controls.
  writeFileSync(
    tmuxStub,
    `#!/usr/bin/env bash
echo "$@" >> "$TMUX_STUB_LOG"
case "$1" in
  list-panes) cat "$TMUX_STUB_PANES" 2>/dev/null ;;
  capture-pane) cat "$TMUX_STUB_CAPTURE" 2>/dev/null ;;
esac
exit 0
`,
  );
  chmodSync(tmuxStub, 0o755);

  const state = mkdtempSync(join(tmpdir(), "handoff-idle-timer-state-"));
  tmuxLog = join(state, "tmux.log");
  tmuxPanes = join(state, "panes.txt");
  tmuxCapture = join(state, "capture.txt");
  writeFileSync(tmuxLog, "");
  writeFileSync(tmuxPanes, "%1\n");
  writeFileSync(tmuxCapture, "");

  bigTranscript = join(state, "transcript.jsonl");
  writeFileSync(bigTranscript, "x".repeat(3000));

  armedPids = [];
  plainProcesses = [];
});

afterEach(() => {
  // Every timer this suite armed is its own process group leader (see
  // idle-timer.sh's arm_timer), so a negative pid tears down the timer and
  // its sleeping child together instead of leaking either one past the test.
  for (const pid of armedPids) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  for (const child of plainProcesses) {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
  rmSync(repo, { recursive: true, force: true });
  rmSync(bin, { recursive: true, force: true });
});

describe("idle-timer.sh Stop hook mode", () => {
  it("arms a detached timer and writes a pidfile when preconditions hold", () => {
    const entry = arm("main");

    expect(entry).not.toBeNull();
    expect(entry?.pid).toBeGreaterThan(0);
    expect(entry?.token.length).toBeGreaterThan(0);
    expect(isAlive(entry?.pid ?? -1)).toBe(true);
  });

  it("does not arm when neither tmux nor herdr env is present", () => {
    run(stopPayload(), { HANDOFF_LANE: "main", HANDOFF_IDLE_SECONDS: "100" });

    expect(existsSync(pidfilePath("main"))).toBe(false);
  });

  it("does not arm or cancel for a subagent turn", () => {
    const first = arm("main");

    run(stopPayload({ agent_id: "sub-1" }), {
      HANDOFF_LANE: "main",
      TMUX_PANE: "%1",
      TMUX: "fake",
      HANDOFF_IDLE_SECONDS: "1",
    });
    Bun.sleepSync(300);

    const after = readPidfile("main");
    expect(after?.pid).toBe(first?.pid);
    expect(isAlive(first?.pid ?? -1)).toBe(true);
  });

  it("cancels a previously armed timer on the next turn", () => {
    const first = arm("main");
    const second = arm("main");

    expect(second?.pid).not.toBe(first?.pid);
    expect(isAlive(first?.pid ?? -1)).toBe(false);
    expect(isAlive(second?.pid ?? -1)).toBe(true);
  });

  it("does not kill a pid that is not ours, guarding against pid reuse", () => {
    const dummy = spawn("sleep", ["30"]);
    plainProcesses.push(dummy);
    if (!dummy.pid) throw new Error("failed to spawn dummy process");

    mkdirSync(join(repo, ".handoff"), { recursive: true });
    writeFileSync(pidfilePath("main"), `${dummy.pid} not-our-token\n`);

    run(stopPayload(), { HANDOFF_LANE: "main", TMUX_PANE: "%1", TMUX: "fake", HANDOFF_IDLE_SECONDS: "100" });
    Bun.sleepSync(300);

    expect(isAlive(dummy.pid)).toBe(true);

    // The hook still arms its own real timer alongside leaving the stranger
    // alone — clean it up like any other armed timer.
    const armedAfter = readPidfile("main");
    if (armedAfter && armedAfter.pid !== dummy.pid) armedPids.push(armedAfter.pid);
  });

  it("skips arming below the transcript size floor", () => {
    const small = join(repo, "small.jsonl");
    writeFileSync(small, "tiny");

    run(stopPayload({ transcript_path: small }), {
      HANDOFF_LANE: "main",
      TMUX_PANE: "%1",
      TMUX: "fake",
      HANDOFF_IDLE_SECONDS: "100",
    });

    expect(existsSync(pidfilePath("main"))).toBe(false);
  });

  it("skips arming right after a fresh handoff write", () => {
    mkdirSync(join(repo, ".handoff"), { recursive: true });
    writeFileSync(join(repo, ".handoff", "main.md"), "# Progress: test\n\njust written\n");

    run(stopPayload(), { HANDOFF_LANE: "main", TMUX_PANE: "%1", TMUX: "fake", HANDOFF_IDLE_SECONDS: "100" });

    expect(existsSync(pidfilePath("main"))).toBe(false);
  });

  it("gives two lanes independent pidfiles", () => {
    const alpha = arm("alpha");
    const beta = arm("beta");

    expect(alpha).not.toBeNull();
    expect(beta).not.toBeNull();
    expect(alpha?.pid).not.toBe(beta?.pid);
    expect(isAlive(alpha?.pid ?? -1)).toBe(true);
    expect(isAlive(beta?.pid ?? -1)).toBe(true);
  });

  it("HANDOFF_IDLE_TIMER=0 cancels a pending timer and does not re-arm", () => {
    const first = arm("main");

    run(stopPayload(), {
      HANDOFF_LANE: "main",
      TMUX_PANE: "%1",
      TMUX: "fake",
      HANDOFF_IDLE_SECONDS: "100",
      HANDOFF_IDLE_TIMER: "0",
    });
    Bun.sleepSync(300);

    expect(isAlive(first?.pid ?? -1)).toBe(false);
    expect(existsSync(pidfilePath("main"))).toBe(false);
  });
});

describe("idle-timer.sh fire mode", () => {
  it("emits C-u before /handoff Enter, in that order", () => {
    writeFileSync(tmuxCapture, `some pane chrome\n${INPUT_MARKER}half-typed draft text`);

    run(stopPayload(), { HANDOFF_LANE: "main", TMUX_PANE: "%1", TMUX: "fake", HANDOFF_IDLE_SECONDS: "1" });
    const entry = readPidfile("main");
    if (entry) armedPids.push(entry.pid);

    expect(waitFor(() => readFileSync(tmuxLog, "utf-8").includes("/handoff"), 5000)).toBe(true);

    const calls = readFileSync(tmuxLog, "utf-8").trim().split("\n");
    const clearIndex = calls.findIndex((c) => c.includes("send-keys") && c.includes("C-u"));
    const submitIndex = calls.findIndex(
      (c) => c.includes("send-keys") && c.includes("/handoff") && c.includes("Enter"),
    );

    expect(clearIndex).toBeGreaterThanOrEqual(0);
    expect(submitIndex).toBeGreaterThan(clearIndex);

    // Fire mode removes its own pidfile once it has acted.
    expect(waitFor(() => !existsSync(pidfilePath("main")))).toBe(true);
  });

  it("salvages only the text after the input-line marker, not the surrounding pane chrome", () => {
    writeFileSync(
      tmuxCapture,
      `Welcome to Claude Code\nsome previous turn's output\n────────────\n${INPUT_MARKER}half-typed draft text`,
    );

    run(stopPayload(), { HANDOFF_LANE: "main", TMUX_PANE: "%1", TMUX: "fake", HANDOFF_IDLE_SECONDS: "1" });
    const entry = readPidfile("main");
    if (entry) armedPids.push(entry.pid);

    expect(waitFor(() => existsSync(draftPath("main")), 5000)).toBe(true);
    const draft = readFileSync(draftPath("main"), "utf-8");
    expect(draft.trim()).toBe("half-typed draft text");
    expect(draft).not.toContain("previous turn's output");
  });

  it("writes no draft when the marker is found but the input line is empty (the common idle case)", () => {
    writeFileSync(tmuxCapture, `some previous turn's output\n${INPUT_MARKER}`);

    run(stopPayload(), { HANDOFF_LANE: "main", TMUX_PANE: "%1", TMUX: "fake", HANDOFF_IDLE_SECONDS: "1" });
    const entry = readPidfile("main");
    if (entry) armedPids.push(entry.pid);

    expect(waitFor(() => readFileSync(tmuxLog, "utf-8").includes("/handoff"), 5000)).toBe(true);
    Bun.sleepSync(200);

    expect(existsSync(draftPath("main"))).toBe(false);
  });

  it("sends no keys at all when the input-line marker is absent (a pending dialog, for example)", () => {
    // Stop does not fire for a turn blocked on a permission or plan-approval
    // dialog, so the previous turn's timer stays armed and wakes up with the
    // dialog on screen. C-u then Enter into that dialog would select the
    // highlighted option. The marker's absence is the only evidence the
    // script has that the input box is not showing, and it must treat that
    // as a hard stop: no send-keys of any kind, not just no /handoff.
    writeFileSync(
      tmuxCapture,
      "Bash command\n\n  rm -rf build/\n\nDo you want to proceed?\n❯ 1. Yes\n  2. Yes, and don't ask again\n  3. No",
    );

    run(stopPayload(), { HANDOFF_LANE: "main", TMUX_PANE: "%1", TMUX: "fake", HANDOFF_IDLE_SECONDS: "1" });
    const entry = readPidfile("main");
    if (entry) armedPids.push(entry.pid);

    // The capture-pane call proves the timer woke up and reached
    // salvage_draft; anything it was going to send would follow right after.
    expect(waitFor(() => readFileSync(tmuxLog, "utf-8").includes("capture-pane"), 5000)).toBe(true);
    Bun.sleepSync(300);

    const calls = readFileSync(tmuxLog, "utf-8").trim().split("\n");
    expect(calls.some((c) => c.includes("send-keys"))).toBe(false);
    expect(waitFor(() => !existsSync(pidfilePath("main")))).toBe(true);
  });

  it("still writes the labeled full-pane fallback draft when the marker is absent but text is visible", () => {
    writeFileSync(tmuxCapture, "an unexpected pane layout with no prompt marker present anywhere");

    run(stopPayload(), { HANDOFF_LANE: "main", TMUX_PANE: "%1", TMUX: "fake", HANDOFF_IDLE_SECONDS: "1" });
    const entry = readPidfile("main");
    if (entry) armedPids.push(entry.pid);

    expect(waitFor(() => existsSync(draftPath("main")), 5000)).toBe(true);
    const draft = readFileSync(draftPath("main"), "utf-8");
    expect(draft).toContain("could not find the input-line marker");
    expect(draft).toContain("an unexpected pane layout with no prompt marker present anywhere");

    // Writing the fallback draft is not permission to inject.
    Bun.sleepSync(300);
    expect(readFileSync(tmuxLog, "utf-8")).not.toContain("send-keys");
  });

  it("writes no draft and sends no keys when the marker is absent and the capture is blank", () => {
    writeFileSync(tmuxCapture, "\n   \n\n");

    run(stopPayload(), { HANDOFF_LANE: "main", TMUX_PANE: "%1", TMUX: "fake", HANDOFF_IDLE_SECONDS: "1" });
    const entry = readPidfile("main");
    if (entry) armedPids.push(entry.pid);

    expect(waitFor(() => readFileSync(tmuxLog, "utf-8").includes("capture-pane"), 5000)).toBe(true);
    Bun.sleepSync(300);

    expect(existsSync(draftPath("main"))).toBe(false);
    expect(readFileSync(tmuxLog, "utf-8")).not.toContain("send-keys");
  });

  it("does not mistake a scrollback line's ASCII-space lookalike for the real NBSP input line", () => {
    // The false positive found in review: an unanchored, ASCII-space-based
    // search matched ordinary scrollback text that happened to start with
    // the glyph. The real input line always uses INPUT_MARKER's NBSP; this
    // scrollback line uses ASCII_SPACE_LOOKALIKE and must never be selected,
    // even though it appears earlier in the same capture as the real line.
    writeFileSync(
      tmuxCapture,
      `${ASCII_SPACE_LOOKALIKE}some earlier scrollback message\nmore chrome\n${INPUT_MARKER}typed draft`,
    );

    run(stopPayload(), { HANDOFF_LANE: "main", TMUX_PANE: "%1", TMUX: "fake", HANDOFF_IDLE_SECONDS: "1" });
    const entry = readPidfile("main");
    if (entry) armedPids.push(entry.pid);

    expect(waitFor(() => existsSync(draftPath("main")), 5000)).toBe(true);
    const draft = readFileSync(draftPath("main"), "utf-8");
    expect(draft.trim()).toBe("typed draft");
    expect(draft).not.toContain("some earlier scrollback message");
  });

  it("does not inject when the pane is gone by fire time", () => {
    writeFileSync(tmuxPanes, ""); // no panes exist

    run(stopPayload(), { HANDOFF_LANE: "main", TMUX_PANE: "%1", TMUX: "fake", HANDOFF_IDLE_SECONDS: "1" });
    const entry = readPidfile("main");
    if (entry) armedPids.push(entry.pid);

    // Give the fire well past its window; it should re-verify pane-exists,
    // find nothing, and quietly do nothing rather than send-keys blind.
    Bun.sleepSync(2000);

    const log = readFileSync(tmuxLog, "utf-8");
    expect(log).not.toContain("/handoff");
    expect(existsSync(pidfilePath("main"))).toBe(false);
  });

  it("does not inject when the handoff file was written since arming", () => {
    run(stopPayload(), { HANDOFF_LANE: "main", TMUX_PANE: "%1", TMUX: "fake", HANDOFF_IDLE_SECONDS: "1" });
    const entry = readPidfile("main");
    if (entry) armedPids.push(entry.pid);

    // Simulate a manual /handoff landing during the idle window.
    mkdirSync(join(repo, ".handoff"), { recursive: true });
    writeFileSync(join(repo, ".handoff", "main.md"), "# Progress: test\n\nwritten during the idle window\n");

    Bun.sleepSync(2000);

    const log = readFileSync(tmuxLog, "utf-8");
    expect(log).not.toContain("/handoff");
    expect(existsSync(pidfilePath("main"))).toBe(false);
  });
});

describe("idle-timer.sh fire mode pidfile ownership", () => {
  it("does not delete a replacement timer's pidfile if its own kill was delayed", async () => {
    // Regression test for a real race: a cancelling Stop hook's `kill -TERM`
    // returns immediately, without waiting for the signal to be delivered.
    // In that window the same Stop hook can go on to arm a replacement,
    // which writes ITS pid into this same path before the original timer's
    // EXIT trap actually runs. We don't need to win that race to test it —
    // we can force the exact interleaving directly: start a real fire-mode
    // timer, let it record its own pidfile, overwrite that file to look like
    // a replacement already claimed it, then deliver the SIGTERM and check
    // what's left behind.
    //
    // This spawns the timer as a direct Node child (unlike arm_timer's own
    // detach, which reparents it away from the Stop hook process), so it has
    // to be awaited via its own "exit" event rather than polled with
    // Bun.sleepSync: a synchronous sleep never yields to the event loop, so
    // Node never reaps the child and `kill(pid, 0)` keeps reporting a
    // terminated-but-unreaped process as still alive.
    const lane = "regress";
    const child = spawn("bash", [SCRIPT, "--fire", "orig-token", lane, repo, "tmux", "%1", "", "100"], {
      stdio: "ignore",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    plainProcesses.push(child);
    if (!child.pid) throw new Error("failed to spawn fire-mode process");
    const armedPid = child.pid;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));

    expect(waitFor(() => existsSync(pidfilePath(lane)))).toBe(true);
    expect(readPidfile(lane)?.pid).toBe(armedPid);

    writeFileSync(pidfilePath(lane), "999999 other-token\n");

    process.kill(armedPid, "SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);

    // The trap must have checked ownership and found it no longer matched,
    // so it must have left the "replacement's" pidfile untouched rather
    // than deleting the file out from under it.
    expect(readFileSync(pidfilePath(lane), "utf-8").trim()).toBe("999999 other-token");
  });
});
