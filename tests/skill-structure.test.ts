import { describe, expect, it } from "bun:test";
import { discoverSkills, parseFrontmatterSync } from "./helpers";

const skills = discoverSkills();

describe("skill structure", () => {
  it("discovers at least one skill", () => {
    expect(skills.length).toBeGreaterThan(0);
  });

  for (const skill of skills) {
    describe(skill.dirName, () => {
      const { data } = parseFrontmatterSync(skill.skillMdPath);

      it("has a non-empty name field", () => {
        expect(typeof data.name).toBe("string");
        expect(data.name.length).toBeGreaterThan(0);
      });

      it("has a non-empty description field", () => {
        expect(typeof data.description).toBe("string");
        expect(data.description.length).toBeGreaterThan(0);
      });

      it("name matches directory name", () => {
        expect(data.name).toBe(skill.dirName);
      });
    });
  }
});
