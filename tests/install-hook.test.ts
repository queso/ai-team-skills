import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "./helpers";

const SCRIPT = join(REPO_ROOT, "handoff", "scripts", "install-hook.sh");

let sandbox: string;
let home: string;

/** Runs install-hook.sh with HOME pointed at the sandbox. */
function run(args: string[] = [], opts: { script?: string; cwd?: string } = {}) {
  return execFileSync("bash", [opts.script ?? SCRIPT, ...args], {
    env: { ...process.env, HOME: home },
    encoding: "utf-8",
    cwd: opts.cwd,
  });
}

/** Creates an empty git repository under the sandbox and returns its path. */
function initRepo(name: string): string {
  const repo = join(sandbox, name);
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q", repo], { env: { ...process.env, HOME: home } });
  return repo;
}

const EXCLUDE_LINES = [".handoff/*.draft.txt", ".handoff/*.timer.pid"];

/** The non-comment lines of a repo's .git/info/exclude, or [] if absent. */
function excludeLines(repo: string): string[] {
  const path = join(repo, ".git", "info", "exclude");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("#"));
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** The commands of every SessionStart hook registered in a settings file. */
function sessionStartCommands(path: string): string[] {
  return eventCommands(path, "SessionStart");
}

/** The commands of every hook registered for `event` in a settings file. */
function eventCommands(path: string, event: string): string[] {
  const matchers = readJson(path).hooks?.[event] ?? [];
  return matchers.flatMap((m: { hooks?: { command?: string }[] }) => (m.hooks ?? []).map((h) => h.command ?? ""));
}

/** The commands of every Stop hook registered in a settings file. */
function stopCommands(path: string): string[] {
  return eventCommands(path, "Stop");
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "handoff-install-"));
  home = join(sandbox, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("install-hook.sh", () => {
  const userSettings = () => join(home, ".claude", "settings.json");

  it("creates a settings file that registers session-start.sh", () => {
    run(["--user"]);

    const commands = sessionStartCommands(userSettings());
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("session-start.sh");
  });

  it("is idempotent — a second run changes nothing", () => {
    run(["--user"]);
    const first = readFileSync(userSettings(), "utf-8");

    const output = run(["--user"]);

    expect(output).toContain("already registered");
    expect(readFileSync(userSettings(), "utf-8")).toBe(first);
  });

  it("preserves unrelated settings and unrelated SessionStart hooks", () => {
    writeFileSync(
      userSettings(),
      JSON.stringify({
        model: "opus",
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo unrelated" }] }],
          PreToolUse: [{ matcher: "Bash", hooks: [] }],
        },
      }),
    );

    run(["--user"]);

    const settings = readJson(userSettings());
    expect(settings.model).toBe("opus");
    expect(settings.hooks.PreToolUse).toEqual([{ matcher: "Bash", hooks: [] }]);
    expect(sessionStartCommands(userSettings())).toContain("echo unrelated");
    expect(sessionStartCommands(userSettings())).toHaveLength(2);
  });

  // An install recorded against an older skills path should be corrected, not
  // duplicated — two SessionStart hooks would inject the progress file twice.
  it("updates a hook recorded at a stale path instead of adding a second one", () => {
    writeFileSync(
      userSettings(),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [{ type: "command", command: 'bash "/old/path/handoff/scripts/session-start.sh"' }],
            },
          ],
        },
      }),
    );

    const output = run(["--user"]);

    expect(output).toContain("updated in");
    const commands = sessionStartCommands(userSettings());
    expect(commands).toHaveLength(1);
    expect(commands[0]).not.toContain("/old/path");
  });

  // A settings.json tracked in a dotfiles repo is commonly a symlink into it.
  // An atomic-rename write would replace the link with a regular file and
  // silently detach it from the repo.
  it("writes through a symlinked settings file without replacing the link", () => {
    const real = join(sandbox, "dotfiles-settings.json");
    writeFileSync(real, JSON.stringify({ model: "opus" }));
    rmSync(userSettings(), { force: true });
    symlinkSync(real, userSettings());

    run(["--user"]);

    expect(lstatSync(userSettings()).isSymbolicLink()).toBe(true);
    expect(readJson(real).model).toBe("opus");
    expect(sessionStartCommands(real)).toHaveLength(1);
  });

  // The recorded command has to survive being read on another machine, since
  // the settings file it lands in is often synced.
  it("records a $HOME-relative command when the skill lives under HOME", () => {
    const installed = join(home, ".claude", "skills", "handoff", "scripts");
    mkdirSync(installed, { recursive: true });
    for (const name of ["session-start.sh", "install-hook.sh"]) {
      writeFileSync(join(installed, name), readFileSync(join(REPO_ROOT, "handoff", "scripts", name)));
    }

    run(["--user"], { script: join(installed, "install-hook.sh") });

    expect(sessionStartCommands(userSettings())[0]).toContain("$HOME/");
    expect(sessionStartCommands(userSettings())[0]).not.toContain(home);
  });

  it("--dry-run prints the result without writing", () => {
    const output = run(["--user", "--dry-run"]);

    expect(JSON.parse(output).hooks.SessionStart).toHaveLength(1);
    expect(existsSync(userSettings())).toBe(false);
  });

  it("--uninstall removes the hook and prunes the structures it emptied", () => {
    run(["--user"]);
    run(["--user", "--uninstall"]);

    expect(readJson(userSettings()).hooks).toBeUndefined();
  });

  it("--uninstall leaves unrelated hooks in place", () => {
    writeFileSync(
      userSettings(),
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo unrelated" }] }] },
      }),
    );
    run(["--user"]);
    run(["--user", "--uninstall"]);

    expect(sessionStartCommands(userSettings())).toEqual(["echo unrelated"]);
  });

  it("refuses to touch a settings file that is not valid JSON", () => {
    const bad = join(sandbox, "bad.json");
    writeFileSync(bad, "{ broken");

    expect(() => run(["--target", bad])).toThrow();
    expect(readFileSync(bad, "utf-8")).toBe("{ broken");
  });

  it("backs the settings file up before overwriting it", () => {
    writeFileSync(userSettings(), JSON.stringify({ model: "opus" }));

    run(["--user"]);

    expect(readJson(`${userSettings()}.handoff-backup`)).toEqual({ model: "opus" });
  });

  describe("--idle-timer", () => {
    it("a default install registers SessionStart and NOT Stop", () => {
      run(["--user"]);

      expect(sessionStartCommands(userSettings())).toHaveLength(1);
      expect(stopCommands(userSettings())).toHaveLength(0);
    });

    it("registers both SessionStart and Stop", () => {
      run(["--user", "--idle-timer"]);

      const sessionStart = sessionStartCommands(userSettings());
      const stop = stopCommands(userSettings());
      expect(sessionStart).toHaveLength(1);
      expect(sessionStart[0]).toContain("session-start.sh");
      expect(stop).toHaveLength(1);
      expect(stop[0]).toContain("idle-timer.sh");
    });

    it("is idempotent — a second run changes nothing", () => {
      run(["--user", "--idle-timer"]);
      const first = readFileSync(userSettings(), "utf-8");

      const output = run(["--user", "--idle-timer"]);

      expect(output).toContain("already registered");
      expect(readFileSync(userSettings(), "utf-8")).toBe(first);
    });

    it("updates a Stop hook recorded at a stale path instead of adding a second one", () => {
      writeFileSync(
        userSettings(),
        JSON.stringify({
          hooks: {
            Stop: [
              {
                hooks: [{ type: "command", command: 'bash "/old/path/handoff/scripts/idle-timer.sh"' }],
              },
            ],
          },
        }),
      );

      const output = run(["--user", "--idle-timer"]);

      expect(output).toContain("updated in");
      const commands = stopCommands(userSettings());
      expect(commands).toHaveLength(1);
      expect(commands[0]).not.toContain("/old/path");
      // SessionStart was absent and gets freshly added alongside the update.
      expect(sessionStartCommands(userSettings())).toHaveLength(1);
    });

    it("--uninstall removes both SessionStart and Stop", () => {
      run(["--user", "--idle-timer"]);

      run(["--user", "--uninstall"]);

      expect(readJson(userSettings()).hooks).toBeUndefined();
    });

    it("--uninstall --idle-timer removes only Stop and leaves SessionStart intact", () => {
      run(["--user", "--idle-timer"]);

      run(["--user", "--uninstall", "--idle-timer"]);

      expect(sessionStartCommands(userSettings())).toHaveLength(1);
      expect(stopCommands(userSettings())).toHaveLength(0);
    });

    it("uninstall does not remove or prune an unrelated user-authored hook on either event", () => {
      writeFileSync(
        userSettings(),
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: "echo unrelated-session-start" }] }],
            Stop: [{ hooks: [{ type: "command", command: "echo unrelated-stop" }] }],
          },
        }),
      );
      run(["--user", "--idle-timer"]);

      run(["--user", "--uninstall"]);

      expect(sessionStartCommands(userSettings())).toEqual(["echo unrelated-session-start"]);
      expect(stopCommands(userSettings())).toEqual(["echo unrelated-stop"]);
      // Both event keys still hold the unrelated hook, so neither is deleted.
      expect(readJson(userSettings()).hooks.SessionStart).toBeDefined();
      expect(readJson(userSettings()).hooks.Stop).toBeDefined();
    });

    it("uninstall --idle-timer does not delete the Stop event key when it still holds an unrelated hook", () => {
      writeFileSync(
        userSettings(),
        JSON.stringify({
          hooks: {
            Stop: [{ hooks: [{ type: "command", command: "echo unrelated-stop" }] }],
          },
        }),
      );
      run(["--user", "--idle-timer"]);

      run(["--user", "--uninstall", "--idle-timer"]);

      expect(stopCommands(userSettings())).toEqual(["echo unrelated-stop"]);
      expect(readJson(userSettings()).hooks.Stop).toBeDefined();
    });

    it("--dry-run with --idle-timer writes nothing", () => {
      const output = run(["--user", "--idle-timer", "--dry-run"]);

      const parsed = JSON.parse(output);
      expect(parsed.hooks.SessionStart).toHaveLength(1);
      expect(parsed.hooks.Stop).toHaveLength(1);
      expect(existsSync(userSettings())).toBe(false);
    });

    // The draft file holds whatever was typed in the input box, verbatim. A
    // --project install is scoped to one repo, so that repo's local exclude
    // file is the right place to keep the timer's scratch files out of git.
    describe("--project", () => {
      it("lists the timer's scratch files in .git/info/exclude, once, across repeated runs", () => {
        const repo = initRepo("repo");

        run(["--project", "--idle-timer"], { cwd: repo });
        run(["--project", "--idle-timer"], { cwd: repo });

        const lines = excludeLines(repo);
        for (const pattern of EXCLUDE_LINES) {
          expect(lines.filter((line) => line === pattern)).toHaveLength(1);
        }
        expect(stopCommands(join(repo, ".claude", "settings.json"))).toHaveLength(1);
      });

      it("keeps entries the user already had in .git/info/exclude", () => {
        const repo = initRepo("repo");
        mkdirSync(join(repo, ".git", "info"), { recursive: true });
        writeFileSync(join(repo, ".git", "info", "exclude"), "scratch/\n");

        run(["--project", "--idle-timer"], { cwd: repo });

        expect(excludeLines(repo)).toEqual(["scratch/", ...EXCLUDE_LINES]);
      });

      it("without --idle-timer does not touch .git/info/exclude", () => {
        const repo = initRepo("repo");

        run(["--project"], { cwd: repo });

        expect(excludeLines(repo)).toEqual([]);
      });
    });

    it("--user inside a git repo leaves that repo's .git/info/exclude alone", () => {
      const repo = initRepo("repo");

      run(["--user", "--idle-timer"], { cwd: repo });

      expect(excludeLines(repo)).toEqual([]);
      expect(stopCommands(userSettings())).toHaveLength(1);
    });

    it("--user outside any git repo succeeds", () => {
      const plain = join(sandbox, "not-a-repo");
      mkdirSync(plain, { recursive: true });

      run(["--user", "--idle-timer"], { cwd: plain });

      expect(stopCommands(userSettings())).toHaveLength(1);
    });
  });
});
