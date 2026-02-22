import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./helpers";

describe("repo hygiene", () => {
  const staleDirs = ["commands", "scripts", "designs", "skills"];

  for (const dir of staleDirs) {
    it(`no stale ${dir}/ directory at repo root`, () => {
      expect(existsSync(join(REPO_ROOT, dir))).toBe(false);
    });
  }
});
