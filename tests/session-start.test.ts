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
      HERDR_PANE_ID: "",
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

    const out = JSON.parse(run({ HANDOFF_LANE: "mine", HERDR_PANE_ID: "%9", TMUX_PANE: "%3" }));

    expect(out.hookSpecificOutput.additionalContext).toContain("lane state");
    expect(out.hookSpecificOutput.additionalContext).not.toContain("should not load");
  });

  it("falls back to HERDR_PANE_ID when HANDOFF_LANE is unset", () => {
    writeProgress("_1.md", "# Progress: herdr\n\npane state\n");

    const out = JSON.parse(run({ HERDR_PANE_ID: "%1", TMUX_PANE: "%3" }));

    expect(out.hookSpecificOutput.additionalContext).toContain("pane state");
  });

  it("falls back to TMUX_PANE when neither HANDOFF_LANE nor HERDR_PANE_ID is set", () => {
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

describe("session-start.sh legacy progress.md orphaning", () => {
  it("warns when a lane var resolves to a missing file but legacy .handoff/progress.md exists", () => {
    writeProgress("progress.md", "# Progress: legacy\n\npre-upgrade state\n");

    // "mine" has no .handoff/mine.md, so the legacy single-file progress.md
    // is left behind with nothing pointing the user at it unless we warn.
    const out = JSON.parse(run({ HANDOFF_LANE: "mine" }));

    expect(out.systemMessage).toContain(".handoff/progress.md");
    expect(out.systemMessage).toContain("mine");
    expect(out.hookSpecificOutput).toBeUndefined();
  });

  it("does not warn about the legacy file when no lane var is set at all", () => {
    // Lane resolves to "progress" itself, so .handoff/progress.md IS the
    // resolved file, not an orphan of it — no separate warning is needed.
    writeProgress("progress.md", "# Progress: legacy\n\npre-upgrade state\n");

    const out = JSON.parse(run());

    expect(out.systemMessage).toBeUndefined();
    expect(out.hookSpecificOutput.additionalContext).toContain("pre-upgrade state");
  });

  it("does not warn when neither the lane file nor a legacy progress.md exists", () => {
    const out = run({ HANDOFF_LANE: "empty-lane" });

    expect(out).toBe("");
  });
});

describe("session-start.sh staleness checks operate on the resolved lane file", () => {
  it("names the lane file (not progress.md) in a branch-mismatch warning", () => {
    // A repo with no commits has no resolvable HEAD, so the branch check
    // would silently no-op — give it one so `git rev-parse --abbrev-ref HEAD`
    // actually returns a branch name to compare against.
    execFileSync(
      "git",
      ["-c", "user.email=test@test.com", "-c", "user.name=test", "commit", "--allow-empty", "-q", "-m", "init"],
      {
        cwd: repo,
      },
    );
    writeProgress(
      "mine.md",
      "# Progress: mine\n\nrepo: test-repo | branch: totally-different-branch | head: abc1234\nupdated: 2024-01-01T00:00:00Z\n\nstate\n",
    );

    const out = JSON.parse(run({ HANDOFF_LANE: "mine" }));

    expect(out.systemMessage).toContain(".handoff/mine.md");
    expect(out.systemMessage).toContain("totally-different-branch");
  });

  it("names the lane file (not progress.md) in a staleness warning", () => {
    writeProgress(
      "mine.md",
      "# Progress: mine\n\nrepo: test-repo | branch: main | head: abc1234\nupdated: 2000-01-01T00:00:00Z\n\nstate\n",
    );

    const out = JSON.parse(run({ HANDOFF_LANE: "mine", HANDOFF_IGNORE_BRANCH: "1" }));

    expect(out.systemMessage).toContain(".handoff/mine.md");
    expect(out.systemMessage).toContain("days old");
  });
});

describe("lane.sh", () => {
  const LANE_SCRIPT = join(REPO_ROOT, "handoff", "scripts", "lane.sh");

  function runLane(env: Record<string, string> = {}) {
    return execFileSync("bash", [LANE_SCRIPT], {
      encoding: "utf-8",
      env: {
        ...process.env,
        HANDOFF_LANE: "",
        HERDR_PANE_ID: "",
        TMUX_PANE: "",
        ...env,
      },
    }).trim();
  }

  it("defaults to progress when nothing is set", () => {
    expect(runLane()).toBe("progress");
  });

  it("prefers HANDOFF_LANE over everything else", () => {
    expect(runLane({ HANDOFF_LANE: "mine", HERDR_PANE_ID: "%9", TMUX_PANE: "%3" })).toBe("mine");
  });

  it("falls back to HERDR_PANE_ID, sanitized, when HANDOFF_LANE is unset", () => {
    expect(runLane({ HERDR_PANE_ID: "%1", TMUX_PANE: "%3" })).toBe("_1");
  });

  it("falls back to TMUX_PANE when neither HANDOFF_LANE nor HERDR_PANE_ID is set", () => {
    expect(runLane({ TMUX_PANE: "%3" })).toBe("_3");
  });

  it("sanitizes non-ASCII lane names byte-wise, so a UTF-8 locale can't collapse two of them onto one file", () => {
    // Under a UTF-8 locale, tr's -c class matches by character, so a 2-byte
    // "é" and a 3-byte "€" would both become a single "_" and collide.
    // Forcing LC_ALL=C makes the match byte-based regardless of the caller's
    // locale, so differently-sized encodings sanitize to different lengths.
    const withE = runLane({ HANDOFF_LANE: "ws-é", LC_ALL: "C.UTF-8" });
    const withEuro = runLane({ HANDOFF_LANE: "ws-€", LC_ALL: "C.UTF-8" });

    expect(withE).toBe("ws-__");
    expect(withEuro).toBe("ws-___");
    expect(withE).not.toBe(withEuro);
  });
});
