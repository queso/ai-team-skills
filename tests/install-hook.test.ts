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
function run(args: string[] = [], opts: { script?: string } = {}) {
  return execFileSync("bash", [opts.script ?? SCRIPT, ...args], {
    env: { ...process.env, HOME: home },
    encoding: "utf-8",
  });
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** The commands of every SessionStart hook registered in a settings file. */
function sessionStartCommands(path: string): string[] {
  const matchers = readJson(path).hooks?.SessionStart ?? [];
  return matchers.flatMap((m: { hooks?: { command?: string }[] }) => (m.hooks ?? []).map((h) => h.command ?? ""));
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
});
