import { describe, expect, it } from "bun:test";
import { deriveFeatureName, extractChatId, parseArgs } from "../v0-setup/scripts/fetch-v0.mjs";

describe("extractChatId", () => {
  it("extracts slug, hashId, and featureName from v0.app URL with long hash", () => {
    const result = extractChatId("https://v0.app/chat/vacation-rental-website-pCP3OQ8u3PU");
    expect(result).toEqual({
      slug: "vacation-rental-website-pCP3OQ8u3PU",
      hashId: "pCP3OQ8u3PU",
      featureName: "vacation-rental-website",
    });
  });

  it("extracts slug, hashId, and featureName from v0.app URL (acceptance criteria example)", () => {
    const result = extractChatId("https://v0.app/chat/book-advertising-dashboard-mEnUngV39k5");
    expect(result).toEqual({
      slug: "book-advertising-dashboard-mEnUngV39k5",
      hashId: "mEnUngV39k5",
      featureName: "book-advertising-dashboard",
    });
  });

  it("extracts slug, hashId, and featureName from v0.dev URL", () => {
    const result = extractChatId("https://v0.dev/chat/my-dashboard-Abc123");
    expect(result).toEqual({
      slug: "my-dashboard-Abc123",
      hashId: "Abc123",
      featureName: "my-dashboard",
    });
  });

  it("returns raw ID passthrough when input is not a URL", () => {
    const result = extractChatId("mEnUngV39k5");
    expect(result).toEqual({
      slug: "mEnUngV39k5",
      hashId: "mEnUngV39k5",
      featureName: "mEnUngV39k5",
    });
  });

  it("handles slug with no hash suffix gracefully (slug and hashId are same)", () => {
    const result = extractChatId("https://v0.app/chat/singleword");
    expect(result.slug).toBe("singleword");
    expect(result.hashId).toBe("singleword");
  });

  it("handles all-lowercase suffix (not a hash) as part of featureName", () => {
    const result = extractChatId("https://v0.app/chat/my-dashboard-settings");
    expect(result.slug).toBe("my-dashboard-settings");
    // "settings" is all lowercase so it's not a hash — slug and hashId should be same
    expect(result.hashId).toBe("my-dashboard-settings");
    expect(result.featureName).toBe("my-dashboard-settings");
  });

  it("handles short suffix that looks like a hash", () => {
    const result = extractChatId("https://v0.app/chat/app-Ab12Cd");
    expect(result.slug).toBe("app-Ab12Cd");
    expect(result.hashId).toBe("Ab12Cd");
    expect(result.featureName).toBe("app");
  });

  // --- Edge cases found during probing ---

  it("URL with query string strips query params correctly", () => {
    const result = extractChatId("https://v0.app/chat/my-feature-Abc123?foo=bar");
    expect(result.slug).toBe("my-feature-Abc123");
    expect(result.hashId).toBe("Abc123");
    expect(result.featureName).toBe("my-feature");
  });

  it("URL with trailing slash extracts slug correctly", () => {
    const result = extractChatId("https://v0.app/chat/my-feature-Abc123/");
    expect(result.slug).toBe("my-feature-Abc123");
    expect(result.hashId).toBe("Abc123");
    expect(result.featureName).toBe("my-feature");
  });

  it("URL with hash fragment extracts slug correctly", () => {
    const result = extractChatId("https://v0.app/chat/my-feature-Abc123#section");
    expect(result.slug).toBe("my-feature-Abc123");
    expect(result.hashId).toBe("Abc123");
    expect(result.featureName).toBe("my-feature");
  });

  it("all-digits last segment (6+) is NOT treated as a hash ID", () => {
    // "123456" is all digits — digits-only strings are not valid hash segments
    // slug, hashId, and featureName should all be the full slug
    const result = extractChatId("https://v0.app/chat/my-feature-123456");
    expect(result.slug).toBe("my-feature-123456");
    expect(result.hashId).toBe("my-feature-123456");
    expect(result.featureName).toBe("my-feature-123456");
  });

  it("non-v0 URL throws a clear error", () => {
    // A URL from a non-v0 host is not a supported input — should throw rather than
    // silently return a garbled slug containing the full URL
    expect(() => extractChatId("https://example.com/chat/my-feature-Abc123")).toThrow();
  });

  it("null input throws a clear error", () => {
    // Passing null should throw a descriptive error, not a cryptic TypeError
    // @ts-expect-error intentional bad input
    expect(() => extractChatId(null)).toThrow();
  });

  it("undefined input throws a clear error", () => {
    // Passing undefined should throw a descriptive error, not a cryptic TypeError
    // @ts-expect-error intentional bad input
    expect(() => extractChatId(undefined)).toThrow();
  });

  it("slug with intermediate hash-like segment: featureName retains it", () => {
    // Only the last segment is checked for hash pattern
    // "my-Abc123-dashboard-Xyz789" → featureName includes "Abc123" in the middle
    const result = extractChatId("https://v0.app/chat/my-Abc123-dashboard-Xyz789");
    expect(result.slug).toBe("my-Abc123-dashboard-Xyz789");
    expect(result.hashId).toBe("Xyz789");
    expect(result.featureName).toBe("my-Abc123-dashboard"); // "Abc123" retained in featureName
  });

  it("empty string returns empty slug/hashId/featureName without throwing", () => {
    const result = extractChatId("");
    expect(result.slug).toBe("");
    expect(result.hashId).toBe("");
    expect(result.featureName).toBe("");
  });

  it("whitespace-only string is treated as empty", () => {
    const result = extractChatId("   ");
    expect(result.slug).toBe("");
    expect(result.hashId).toBe("");
    expect(result.featureName).toBe("");
  });

  it("ftp:// URL throws a clear error", () => {
    expect(() => extractChatId("ftp://v0.app/chat/my-feature-Abc123")).toThrow();
  });
});

describe("deriveFeatureName", () => {
  it("strips hash suffix", () => {
    expect(deriveFeatureName("vacation-rental-website-pCP3OQ8u3PU")).toBe("vacation-rental-website");
  });

  it("keeps all-lowercase suffix", () => {
    expect(deriveFeatureName("my-dashboard-settings")).toBe("my-dashboard-settings");
  });

  it("handles no hyphens", () => {
    expect(deriveFeatureName("singleword")).toBe("singleword");
  });

  it("handles short suffix that looks like a hash", () => {
    expect(deriveFeatureName("app-Ab12Cd")).toBe("app");
  });
});

describe("parseArgs", () => {
  it("URL only", () => {
    const result = parseArgs(["node", "fetch-v0.mjs", "https://v0.app/chat/abc123"]);
    expect(result.inputArg).toBe("https://v0.app/chat/abc123");
    expect(result.customName).toBeNull();
    expect(result.outputDir).toBe(process.cwd());
  });

  it("URL + name", () => {
    const result = parseArgs(["node", "fetch-v0.mjs", "https://v0.app/chat/abc123", "my-feature"]);
    expect(result.inputArg).toBe("https://v0.app/chat/abc123");
    expect(result.customName).toBe("my-feature");
  });

  it("--output-dir flag", () => {
    const result = parseArgs(["node", "fetch-v0.mjs", "https://v0.app/chat/abc123", "--output-dir", "/tmp/out"]);
    expect(result.inputArg).toBe("https://v0.app/chat/abc123");
    expect(result.outputDir).toBe("/tmp/out");
  });

  it("flag before positionals", () => {
    const result = parseArgs(["node", "fetch-v0.mjs", "--output-dir", "/tmp/out", "https://v0.app/chat/abc123"]);
    expect(result.inputArg).toBe("https://v0.app/chat/abc123");
    expect(result.outputDir).toBe("/tmp/out");
  });

  it("all three combined", () => {
    const result = parseArgs([
      "node",
      "fetch-v0.mjs",
      "https://v0.app/chat/abc123",
      "dashboard",
      "--output-dir",
      "/tmp/out",
    ]);
    expect(result.inputArg).toBe("https://v0.app/chat/abc123");
    expect(result.customName).toBe("dashboard");
    expect(result.outputDir).toBe("/tmp/out");
  });

  it("no args", () => {
    const result = parseArgs(["node", "fetch-v0.mjs"]);
    expect(result.inputArg).toBeNull();
    expect(result.customName).toBeNull();
  });

  // --- New tests for --version and --list-versions flags ---

  it("--version flag", () => {
    const result = parseArgs(["node", "fetch-v0.mjs", "https://v0.app/chat/abc123", "--version", "ver_abc123"]);
    expect(result.inputArg).toBe("https://v0.app/chat/abc123");
    expect(result.versionId).toBe("ver_abc123");
    expect(result.listVersions).toBe(false);
  });

  it("--list-versions flag", () => {
    const result = parseArgs(["node", "fetch-v0.mjs", "https://v0.app/chat/abc123", "--list-versions"]);
    expect(result.inputArg).toBe("https://v0.app/chat/abc123");
    expect(result.listVersions).toBe(true);
    expect(result.versionId).toBeNull();
  });

  it("both flags together", () => {
    const result = parseArgs([
      "node",
      "fetch-v0.mjs",
      "https://v0.app/chat/abc123",
      "--version",
      "ver_abc123",
      "--list-versions",
    ]);
    expect(result.inputArg).toBe("https://v0.app/chat/abc123");
    expect(result.versionId).toBe("ver_abc123");
    expect(result.listVersions).toBe(true);
  });

  it("defaults when no flags", () => {
    const result = parseArgs(["node", "fetch-v0.mjs", "https://v0.app/chat/abc123"]);
    expect(result.versionId).toBeNull();
    expect(result.listVersions).toBe(false);
  });

  it("--version before positionals", () => {
    const result = parseArgs(["node", "fetch-v0.mjs", "--version", "ver_abc123", "https://v0.app/chat/abc123"]);
    expect(result.inputArg).toBe("https://v0.app/chat/abc123");
    expect(result.versionId).toBe("ver_abc123");
  });

  it("--version with all other flags", () => {
    const result = parseArgs([
      "node",
      "fetch-v0.mjs",
      "https://v0.app/chat/abc123",
      "my-feature",
      "--output-dir",
      "/tmp/out",
      "--version",
      "ver_abc123",
    ]);
    expect(result.inputArg).toBe("https://v0.app/chat/abc123");
    expect(result.customName).toBe("my-feature");
    expect(result.outputDir).toBe("/tmp/out");
    expect(result.versionId).toBe("ver_abc123");
    expect(result.listVersions).toBe(false);
  });

  it("--version without value", () => {
    const result = parseArgs(["node", "fetch-v0.mjs", "https://v0.app/chat/abc123", "--version"]);
    expect(result.inputArg).toBe("https://v0.app/chat/abc123");
    // --version with no following value should result in null (graceful handling)
    expect(result.versionId).toBeNull();
  });

  // --- Amy's edge case probes ---

  it("--version with empty string value: versionId is null (empty string rejected)", () => {
    const result = parseArgs(["node", "fetch-v0.mjs", "https://v0.app/chat/abc123", "--version", ""]);
    expect(result.inputArg).toBe("https://v0.app/chat/abc123");
    expect(result.versionId).toBeNull();
  });

  it("--version followed by another flag: flag is NOT consumed as version ID", () => {
    // --version --list-versions: next.startsWith("--") is true, so versionId stays null
    // and --list-versions is then processed correctly on next iteration
    const result = parseArgs(["node", "fetch-v0.mjs", "https://v0.app/chat/abc123", "--version", "--list-versions"]);
    expect(result.inputArg).toBe("https://v0.app/chat/abc123");
    expect(result.versionId).toBeNull();
    expect(result.listVersions).toBe(true);
  });

  it("duplicate --version flags: last one wins", () => {
    // No deduplication logic; second --version overwrites first
    const result = parseArgs([
      "node",
      "fetch-v0.mjs",
      "https://v0.app/chat/abc123",
      "--version",
      "v1",
      "--version",
      "v2",
    ]);
    expect(result.inputArg).toBe("https://v0.app/chat/abc123");
    expect(result.versionId).toBe("v2");
  });

  it("--list-version typo (missing 's'): silently treated as positional arg (BUG: no warning)", () => {
    // --list-version (typo) does not match "--list-versions" so it falls into the positional path.
    // If inputArg is already set, it becomes customName; if neither is set yet, it becomes inputArg.
    const result = parseArgs(["node", "fetch-v0.mjs", "https://v0.app/chat/abc123", "--list-version"]);
    expect(result.inputArg).toBe("https://v0.app/chat/abc123");
    // Typo silently becomes customName — no error or warning
    expect(result.customName).toBe("--list-version");
    expect(result.listVersions).toBe(false);
  });

  it("--list-versions followed by a value: value silently becomes a positional arg", () => {
    // --list-versions is boolean; it doesn't consume the next arg.
    // "true" then falls into the positional slot (becomes customName here).
    const result = parseArgs(["node", "fetch-v0.mjs", "https://v0.app/chat/abc123", "--list-versions", "true"]);
    expect(result.inputArg).toBe("https://v0.app/chat/abc123");
    expect(result.listVersions).toBe(true);
    // "true" is silently consumed as customName
    expect(result.customName).toBe("true");
  });

  it("unknown flag silently becomes a positional arg", () => {
    // Unknown flags like --unknown fall into the positional slot (customName here)
    const result = parseArgs(["node", "fetch-v0.mjs", "https://v0.app/chat/abc123", "--unknown-flag"]);
    expect(result.inputArg).toBe("https://v0.app/chat/abc123");
    expect(result.customName).toBe("--unknown-flag");
  });
});
