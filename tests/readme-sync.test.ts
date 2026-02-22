import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { discoverSkills, REPO_ROOT } from "./helpers";

const readmePath = join(REPO_ROOT, "README.md");
const readme = readFileSync(readmePath, "utf-8");
const skills = discoverSkills();

describe("README sync", () => {
  for (const skill of skills) {
    describe(skill.dirName, () => {
      it(`has a ### ${skill.dirName} header in README.md`, () => {
        const headerPattern = new RegExp(`^### ${skill.dirName}$`, "m");
        expect(readme).toMatch(headerPattern);
      });

      it("has correct install command", () => {
        const installCmd = `npx skills add queso/ai-team-skills@${skill.dirName}`;
        expect(readme).toContain(installCmd);
      });
    });
  }

  it("no stale README sections for non-existent skill directories", () => {
    // Find all ### headers in the Skills section
    const skillHeaders = [...readme.matchAll(/^### ([a-z0-9-]+)$/gm)].map((m) => m[1]);
    const skillDirNames = skills.map((s) => s.dirName);

    for (const header of skillHeaders) {
      expect(skillDirNames).toContain(header);
    }
  });
});
