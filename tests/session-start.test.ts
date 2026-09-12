import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "./helpers";

const SCRIPT = join(REPO_ROOT, "handoff", "scripts", "session-start.sh");

let repo: string;

/** Runs session-start.sh from inside the sandbox repo, with the given env added. */
function run(env: Record<string, string> = {}) {
  return execFileSync("bash", [SCRIPT], {
    cwd: repo,
    encoding: "utf-8",
    env: {
      ...process.env,
      // Cleared first so the environment the test runner happens to be
      // running under (e.g. a real TMUX_PANE) can't leak into a case that
      // expects a lane var to be unset.
      HANDOFF_LANE: "",
      HERDR_WORKSPACE_ID: "",
      TMUX_PANE: "",
      ...env,
    },
  });
}

function writeProgress(name: string, body = "# Progress: test\n\nsome state\n") {
  mkdirSync(join(repo, ".handoff"), { recursive: true });
  writeFileSync(join(repo, ".handoff", name), body);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "handoff-session-start-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("session-start.sh lane resolution", () => {
  it("falls back to .handoff/progress.md when no lane env var is set", () => {
    writeProgress("progress.md");

    const out = JSON.parse(run());

    expect(out.hookSpecificOutput.additionalContext).toContain("some state");
  });

  it("prefers HANDOFF_LANE over everything else", () => {
    writeProgress("mine.md", "# Progress: mine\n\nlane state\n");
    writeProgress("progress.md", "# Progress: other\n\nshould not load\n");

    const out = JSON.parse(run({ HANDOFF_LANE: "mine", HERDR_WORKSPACE_ID: "herdr-ws", TMUX_PANE: "%3" }));

    expect(out.hookSpecificOutput.additionalContext).toContain("lane state");
    expect(out.hookSpecificOutput.additionalContext).not.toContain("should not load");
  });

  it("falls back to HERDR_WORKSPACE_ID when HANDOFF_LANE is unset", () => {
    writeProgress("herdr-ws.md", "# Progress: herdr\n\nworkspace state\n");

    const out = JSON.parse(run({ HERDR_WORKSPACE_ID: "herdr-ws", TMUX_PANE: "%3" }));

    expect(out.hookSpecificOutput.additionalContext).toContain("workspace state");
  });

  it("falls back to TMUX_PANE when neither HANDOFF_LANE nor HERDR_WORKSPACE_ID is set", () => {
    // TMUX_PANE's "%" is sanitized to "_" before it is used in a path.
    writeProgress("_3.md", "# Progress: pane\n\npane state\n");

    const out = JSON.parse(run({ TMUX_PANE: "%3" }));

    expect(out.hookSpecificOutput.additionalContext).toContain("pane state");
  });

  it("does not load another lane's file", () => {
    writeProgress("other-lane.md", "# Progress: other\n\nother lane state\n");

    // No lane resolves to "other-lane", and no progress.md exists either.
    const out = run({ HANDOFF_LANE: "mine" });

    expect(out).toBe("");
  });

  it("sanitizes a lane containing path separators instead of escaping .handoff/", () => {
    writeProgress(".._.._etc_passwd.md", "# Progress: sanitized\n\nsanitized state\n");

    const out = JSON.parse(run({ HANDOFF_LANE: "../../etc/passwd" }));

    expect(out.hookSpecificOutput.additionalContext).toContain("sanitized state");
    // No "/" survives sanitization, so nothing outside .handoff/ can be created or read.
    expect(existsSync(join(repo, "etc"))).toBe(false);
  });

  it("stays silent when the resolved lane has no progress file at all", () => {
    const out = run({ HANDOFF_LANE: "empty-lane" });

    expect(out).toBe("");
  });
});
