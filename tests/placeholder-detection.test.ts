import { describe, expect, it } from "bun:test";
import { isPlaceholderContent, validateFiles } from "../v0-setup/scripts/placeholder-detection.mjs";

describe("isPlaceholderContent", () => {
  it('returns true for "GENERATING"', () => {
    expect(isPlaceholderContent("GENERATING")).toBe(true);
  });

  it('returns true for "GENERATING\\n" (with trailing newline)', () => {
    expect(isPlaceholderContent("GENERATING\n")).toBe(true);
  });

  it("returns true for lowercase generating (case-insensitive)", () => {
    expect(isPlaceholderContent("generating")).toBe(true);
  });

  it("returns true for mixed case generating", () => {
    expect(isPlaceholderContent("Generating")).toBe(true);
  });

  it("returns true for empty string", () => {
    expect(isPlaceholderContent("")).toBe(true);
  });

  it("returns true for whitespace-only content", () => {
    expect(isPlaceholderContent("   \n  ")).toBe(true);
  });

  it("returns true for tab-only content", () => {
    expect(isPlaceholderContent("\t\t")).toBe(true);
  });

  it("returns false for real React component code", () => {
    expect(isPlaceholderContent("import React from 'react';\nexport default function App() { ... }")).toBe(false);
  });

  it("returns false for a short but real comment", () => {
    expect(isPlaceholderContent("// short but real comment")).toBe(false);
  });

  it("returns false for content that contains GENERATING as a substring within real code", () => {
    expect(
      isPlaceholderContent(
        "const status = 'GENERATING';\nexport default function StatusBadge() { return <span>{status}</span>; }",
      ),
    ).toBe(false);
  });

  it("returns false for a very short but valid file (single character)", () => {
    expect(isPlaceholderContent("x")).toBe(false);
  });

  it("returns false for a numeric string", () => {
    expect(isPlaceholderContent("0")).toBe(false);
  });

  // --- Edge cases found during probing ---

  it("returns true for null input (treated as placeholder — no content)", () => {
    // @ts-expect-error intentional bad input
    expect(isPlaceholderContent(null)).toBe(true);
  });

  it("returns true for undefined input (treated as placeholder — no content)", () => {
    // @ts-expect-error intentional bad input
    expect(isPlaceholderContent(undefined)).toBe(true);
  });

  it("returns true for just newlines (whitespace-only)", () => {
    expect(isPlaceholderContent("\n\n\n")).toBe(true);
  });

  it("returns true for GENERATING with leading/trailing spaces", () => {
    expect(isPlaceholderContent("  GENERATING  ")).toBe(true);
  });

  it("returns true for BOM + GENERATING (trim strips BOM in V8)", () => {
    expect(isPlaceholderContent("\uFEFFGENERATING")).toBe(true);
  });

  it("returns true for BOM-only content (trim strips BOM, leaving empty string)", () => {
    expect(isPlaceholderContent("\uFEFF")).toBe(true);
  });

  it("returns false for GENERATING embedded in real code comment", () => {
    expect(isPlaceholderContent("// GENERATING report...")).toBe(false);
  });

  it("returns true for non-string input (number 0 — not real content)", () => {
    // @ts-expect-error intentional bad input
    expect(isPlaceholderContent(0)).toBe(true);
  });
});

describe("validateFiles", () => {
  it("partitions a mixed array of real and placeholder files", () => {
    const files = [
      { name: "app.tsx", content: "import React from 'react';\nexport default function App() {}" },
      { name: "loading.tsx", content: "GENERATING" },
      { name: "styles.css", content: "body { margin: 0; }" },
      { name: "pending.tsx", content: "" },
      { name: "utils.ts", content: "export const noop = () => {};" },
      { name: "widget.tsx", content: "   \n  " },
    ];

    const { valid, placeholders } = validateFiles(files);

    expect(valid).toHaveLength(3);
    expect(placeholders).toHaveLength(3);

    expect(valid.map((f) => f.name)).toEqual(["app.tsx", "styles.css", "utils.ts"]);
    expect(placeholders.map((f) => f.name)).toEqual(["loading.tsx", "pending.tsx", "widget.tsx"]);
  });

  it("returns all valid when no placeholders present", () => {
    const files = [
      { name: "a.ts", content: "export const a = 1;" },
      { name: "b.ts", content: "export const b = 2;" },
    ];

    const { valid, placeholders } = validateFiles(files);

    expect(valid).toHaveLength(2);
    expect(placeholders).toHaveLength(0);
  });

  it("returns all placeholders when all files are placeholders", () => {
    const files = [
      { name: "a.tsx", content: "GENERATING" },
      { name: "b.tsx", content: "" },
    ];

    const { valid, placeholders } = validateFiles(files);

    expect(valid).toHaveLength(0);
    expect(placeholders).toHaveLength(2);
  });

  it("returns empty arrays for an empty file list", () => {
    const { valid, placeholders } = validateFiles([]);

    expect(valid).toHaveLength(0);
    expect(placeholders).toHaveLength(0);
  });

  it("does not treat file with GENERATING as substring of real code as placeholder", () => {
    const files = [
      {
        name: "status.tsx",
        content:
          "const status = 'GENERATING';\nexport default function StatusBadge() { return <span>{status}</span>; }",
      },
    ];

    const { valid, placeholders } = validateFiles(files);

    expect(valid).toHaveLength(1);
    expect(placeholders).toHaveLength(0);
  });

  // --- Edge cases found during probing ---

  it("returns empty result when files array is null", () => {
    // @ts-expect-error intentional bad input
    const { valid, placeholders } = validateFiles(null);
    expect(valid).toHaveLength(0);
    expect(placeholders).toHaveLength(0);
  });

  it("returns empty result when files array is undefined", () => {
    // @ts-expect-error intentional bad input
    const { valid, placeholders } = validateFiles(undefined);
    expect(valid).toHaveLength(0);
    expect(placeholders).toHaveLength(0);
  });

  it("treats file with null content as a placeholder", () => {
    // v0 API may return files with null content — should be classified as placeholder
    const { valid, placeholders } = validateFiles([{ name: "a.tsx", content: null }]);
    expect(valid).toHaveLength(0);
    expect(placeholders).toHaveLength(1);
  });

  it("treats file with undefined content (missing content field) as a placeholder", () => {
    // file.content is undefined when the field is absent from the API response
    const { valid, placeholders } = validateFiles([{ name: "a.tsx", content: undefined }]);
    expect(valid).toHaveLength(0);
    expect(placeholders).toHaveLength(1);
  });

  it("treats file missing the content property entirely as a placeholder", () => {
    const { valid, placeholders } = validateFiles([{ name: "a.tsx" }]);
    expect(valid).toHaveLength(0);
    expect(placeholders).toHaveLength(1);
  });

  it("treats null array elements as placeholders", () => {
    // @ts-expect-error intentional bad input
    const { valid, placeholders } = validateFiles([null]);
    expect(valid).toHaveLength(0);
    expect(placeholders).toHaveLength(1);
  });

  it("file missing name property is still classified correctly (name is undefined)", () => {
    // validateFiles doesn't require name — only content is used for classification
    const { valid, placeholders } = validateFiles([{ content: "real code here" }]);
    expect(valid).toHaveLength(1);
    expect(placeholders).toHaveLength(0);
    expect(valid[0].name).toBeUndefined();
  });
});
