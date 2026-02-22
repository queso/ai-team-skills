import { describe, expect, it } from "bun:test";

// runPipeline does not exist yet. We use a dynamic import wrapper so the
// test file loads even when the export is missing. Each test will fail with
// "runPipeline is not a function" until B.A. implements and exports it.
let runPipeline: (options: Record<string, unknown>, deps: Record<string, unknown>) => Promise<Record<string, unknown>>;

try {
  const mod = await import("../v0-setup/scripts/fetch-v0.mjs");
  runPipeline = (mod as Record<string, unknown>).runPipeline as typeof runPipeline;
} catch {
  // Module loaded but runPipeline not exported — assign undefined so tests
  // fail with a clear "not a function" error per test case.
  runPipeline = undefined as unknown as typeof runPipeline;
}

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const TEST_URL = "https://v0.app/chat/book-advertising-dashboard-mEnUngV39k5";
const TEST_HASH_ID = "mEnUngV39k5";
const TEST_FEATURE_NAME = "book-advertising-dashboard";
const TEST_API_KEY = "test-api-key-fake";

function makeVersion(id: string, status: string, createdAt: string) {
  return { id, status, createdAt };
}

const VERSIONS = [
  makeVersion("ver_003", "generating", "2024-01-15T12:00:00Z"),
  makeVersion("ver_002", "completed", "2024-01-15T10:30:00Z"),
  makeVersion("ver_001", "completed", "2024-01-14T08:00:00Z"),
];

const EXTRACTED_FILES = [
  { name: "app/page.tsx", size: 1200, content: "export default function Page() { return <div>Hello</div>; }" },
  {
    name: "app/layout.tsx",
    size: 800,
    content: "export default function Layout({ children }) { return <html>{children}</html>; }",
  },
  { name: "components/chart.tsx", size: 500, content: "export function Chart() { return <canvas />; }" },
  { name: "lib/utils.ts", size: 300, content: "export function cn(...args) { return args.join(' '); }" },
];

const CUSTOM_FILE_NAMES = ["app/page.tsx", "components/chart.tsx"];

function makeDefaultOptions(overrides: Record<string, unknown> = {}) {
  return {
    inputArg: TEST_URL,
    customName: null,
    outputDir: "/tmp/test-output",
    apiKey: TEST_API_KEY,
    versionId: null,
    listVersions: false,
    ...overrides,
  };
}

/**
 * Creates a full set of mock deps with sensible defaults for happy-path testing.
 * Individual mocks can be overridden via the overrides parameter.
 */
function makeMockDeps(overrides: Record<string, unknown> = {}) {
  const logs: string[] = [];
  const errors: string[] = [];
  const warns: string[] = [];
  const writtenFiles: Array<{ path: string; content: string }> = [];
  const createdDirs: string[] = [];

  const deps: Record<string, unknown> = {
    fetchVersionList: async (_slug: string, _hashId: string, _apiKey: string) => ({
      versions: VERSIONS,
      resolvedChatId: TEST_HASH_ID,
    }),
    selectBestVersion: (versions: Array<{ id: string; status: string; createdAt: string }>) => {
      const completed = versions.find((v) => v.status === "completed");
      return completed ?? null;
    },
    downloadAndExtract: async (_resolvedChatId: string, _versionId: string, _apiKey: string, _targetDir: string) =>
      EXTRACTED_FILES,
    fetchCustomFileList: async (_resolvedChatId: string, _versionId: string, _apiKey: string) => CUSTOM_FILE_NAMES,
    classifyFiles: (allFiles: Array<{ name: string; size: number; content: string }>, customFileNames: string[]) => {
      const customSet = new Set(customFileNames);
      const custom = allFiles.filter((f) => customSet.has(f.name)).map((f) => ({ ...f, isCustom: true as const }));
      const defaultFiles = allFiles
        .filter((f) => !customSet.has(f.name))
        .map((f) => ({ ...f, isCustom: false as const }));
      return { custom, default: defaultFiles };
    },
    validateCustomFiles: (
      customFiles: Array<{ name: string; content: string }>,
      _isPlaceholderFn: (content: string) => boolean,
    ) => ({
      valid: customFiles,
      warnings: [] as Array<{ name: string; reason: string }>,
    }),
    isPlaceholderContent: (content: string) => {
      if (content == null || typeof content !== "string") return true;
      const trimmed = content.trim();
      return trimmed === "" || trimmed.toLowerCase() === "generating";
    },
    writeFileSync: (path: string, content: string) => {
      writtenFiles.push({ path, content: typeof content === "string" ? content : String(content) });
    },
    mkdirSync: (path: string) => {
      createdDirs.push(path);
    },
    console: {
      log: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
      error: (...args: unknown[]) => errors.push(args.map(String).join(" ")),
      warn: (...args: unknown[]) => warns.push(args.map(String).join(" ")),
    },
    ...overrides,
  };

  return { deps, logs, errors, warns, writtenFiles, createdDirs };
}

// ---------------------------------------------------------------------------
// runPipeline Integration Tests
// ---------------------------------------------------------------------------

describe("runPipeline", () => {
  // -------------------------------------------------------------------------
  // 1. Happy path: full pipeline
  // -------------------------------------------------------------------------
  describe("happy path", () => {
    it("should orchestrate full pipeline: version selection, download, classify, validate, and write manifest", async () => {
      const { deps, writtenFiles } = makeMockDeps();
      const options = makeDefaultOptions();

      const result = await runPipeline(options, deps);

      // Verify result shape
      expect(result.featureName).toBe(TEST_FEATURE_NAME);
      expect(result.versionId).toBe("ver_002"); // selectBestVersion picks first completed
      expect(result.resolvedChatId).toBe(TEST_HASH_ID);
      expect(result.totalFiles).toBe(4);
      expect(result.customFileCount).toBe(2);
      expect(result.defaultFileCount).toBe(2);
      expect(result.warnings).toEqual([]);

      // Manifest should have been written
      const manifestWrite = writtenFiles.find((f) => f.path.includes("manifest.json"));
      expect(manifestWrite).toBeDefined();
      const manifest = JSON.parse(manifestWrite?.content ?? "{}");
      expect(manifest.customFileCount).toBe(2);
      expect(manifest.defaultFileCount).toBe(2);
      expect(manifest.versionId).toBe("ver_002");
      expect(manifest.warnings).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Custom name override
  // -------------------------------------------------------------------------
  describe("custom name override", () => {
    it("should use customName instead of derived featureName when provided", async () => {
      const { deps } = makeMockDeps();
      const options = makeDefaultOptions({ customName: "my-custom-dashboard" });

      const result = await runPipeline(options, deps);

      expect(result.featureName).toBe("my-custom-dashboard");
      expect(result.designDir).toContain("my-custom-dashboard");
    });
  });

  // -------------------------------------------------------------------------
  // 3. --list-versions flag
  // -------------------------------------------------------------------------
  describe("--list-versions flag", () => {
    it("should return formatted version list and NOT call download/classify/validate", async () => {
      let downloadCalled = false;
      let classifyCalled = false;
      let validateCalled = false;

      const { deps } = makeMockDeps({
        downloadAndExtract: async () => {
          downloadCalled = true;
          return [];
        },
        classifyFiles: () => {
          classifyCalled = true;
          return { custom: [], default: [] };
        },
        validateCustomFiles: () => {
          validateCalled = true;
          return { valid: [], warnings: [] };
        },
      });
      const options = makeDefaultOptions({ listVersions: true });

      const result = await runPipeline(options, deps);

      // Should NOT have called download, classify, or validate
      expect(downloadCalled).toBe(false);
      expect(classifyCalled).toBe(false);
      expect(validateCalled).toBe(false);

      // Should have listVersionsOutput in the result
      expect(result.listVersionsOutput).toBeDefined();
      expect(typeof result.listVersionsOutput).toBe("string");
      expect(result.listVersionsOutput.length).toBeGreaterThan(0);
    });

    it("should include version IDs, statuses, and dates in formatted output", async () => {
      const { deps } = makeMockDeps();
      const options = makeDefaultOptions({ listVersions: true });

      const result = await runPipeline(options, deps);

      const output = result.listVersionsOutput as string;
      // Should contain version IDs
      expect(output).toContain("ver_003");
      expect(output).toContain("ver_002");
      expect(output).toContain("ver_001");
      // Should contain statuses
      expect(output).toContain("completed");
      expect(output).toContain("generating");
      // Should contain a "selected" marker on the best version
      expect(output).toContain("selected");
    });
  });

  // -------------------------------------------------------------------------
  // 4. --version flag
  // -------------------------------------------------------------------------
  describe("--version flag", () => {
    it("should use the specified versionId instead of calling selectBestVersion", async () => {
      let selectBestCalled = false;

      const { deps } = makeMockDeps({
        selectBestVersion: () => {
          selectBestCalled = true;
          return makeVersion("ver_002", "completed", "2024-01-15T10:30:00Z");
        },
      });
      const options = makeDefaultOptions({ versionId: "ver_001" });

      const result = await runPipeline(options, deps);

      expect(selectBestCalled).toBe(false);
      expect(result.versionId).toBe("ver_001");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Placeholder warnings with specific suggested version
  // -------------------------------------------------------------------------
  describe("placeholder warnings", () => {
    it("should include warnings in result and log to stderr with suggested version ID", async () => {
      const placeholderWarnings = [{ name: "app/page.tsx", reason: "File content is a GENERATING placeholder" }];

      const { deps, errors } = makeMockDeps({
        validateCustomFiles: () => ({
          valid: [{ name: "components/chart.tsx", content: "real content" }],
          warnings: placeholderWarnings,
        }),
      });
      const options = makeDefaultOptions();

      const result = await runPipeline(options, deps);

      // Warnings should be in the result
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].name).toBe("app/page.tsx");

      // Stderr should contain a suggestion to use a specific older completed version
      // The next older completed version after ver_002 is ver_001
      const stderrText = errors.join("\n");
      expect(stderrText).toContain("ver_001");
    });
  });

  // -------------------------------------------------------------------------
  // 6. No completed versions: selectBestVersion returns fallback
  // -------------------------------------------------------------------------
  describe("no completed versions", () => {
    it("should continue when selectBestVersion returns a non-completed fallback version", async () => {
      const nonCompletedVersions = [
        makeVersion("ver_003", "generating", "2024-01-15T12:00:00Z"),
        makeVersion("ver_002", "pending", "2024-01-15T10:30:00Z"),
      ];

      const { deps } = makeMockDeps({
        fetchVersionList: async () => ({
          versions: nonCompletedVersions,
          resolvedChatId: TEST_HASH_ID,
        }),
        selectBestVersion: (versions: Array<{ id: string; status: string }>) => {
          // No completed version, fallback to most recent
          return versions[0] ?? null;
        },
      });
      const options = makeDefaultOptions();

      const result = await runPipeline(options, deps);

      // Pipeline should still complete using the fallback version
      expect(result.versionId).toBe("ver_003");
      expect(result.totalFiles).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // 7. selectBestVersion returns null (empty version list)
  // -------------------------------------------------------------------------
  describe("empty version list", () => {
    it("should throw or error gracefully when selectBestVersion returns null", async () => {
      const { deps } = makeMockDeps({
        fetchVersionList: async () => ({
          versions: [],
          resolvedChatId: TEST_HASH_ID,
        }),
        selectBestVersion: () => null,
      });
      const options = makeDefaultOptions();

      await expect(runPipeline(options, deps)).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 8. Output directory structure
  // -------------------------------------------------------------------------
  describe("output directory", () => {
    it("should target designs/<featureName>/v0-source/ subdirectory", async () => {
      const { deps } = makeMockDeps();
      const options = makeDefaultOptions({ outputDir: "/tmp/project" });

      const result = await runPipeline(options, deps);

      // designDir should end with designs/<featureName>/v0-source
      expect(result.designDir).toContain("designs");
      expect(result.designDir).toContain(TEST_FEATURE_NAME);
      expect(result.designDir).toMatch(/v0-source\/?$/);
    });
  });

  // -------------------------------------------------------------------------
  // 9. Manifest.json content
  // -------------------------------------------------------------------------
  describe("manifest.json", () => {
    it("should write manifest with customFileCount, defaultFileCount, warnings, versionId, and versionSelectedFrom", async () => {
      const { deps, writtenFiles } = makeMockDeps();
      const options = makeDefaultOptions();

      await runPipeline(options, deps);

      const manifestWrite = writtenFiles.find((f) => f.path.includes("manifest.json"));
      expect(manifestWrite).toBeDefined();

      const manifest = JSON.parse(manifestWrite?.content ?? "{}");
      expect(manifest.customFileCount).toBe(2);
      expect(manifest.defaultFileCount).toBe(2);
      expect(manifest.versionId).toBe("ver_002");
      expect(Array.isArray(manifest.warnings)).toBe(true);
      // versionSelectedFrom should be the total number of versions available
      expect(manifest.versionSelectedFrom).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // 10. --list-versions output format (table columns)
  // -------------------------------------------------------------------------
  describe("--list-versions output format", () => {
    it("should format output with index, id, status, date columns and selected marker", async () => {
      const { deps } = makeMockDeps();
      const options = makeDefaultOptions({ listVersions: true });

      const result = await runPipeline(options, deps);

      const output = result.listVersionsOutput as string;
      const lines = output.split("\n").filter((l: string) => l.trim().length > 0);

      // Should have a header/title line mentioning total count
      const headerLine = lines.find((l: string) => l.includes("total") || l.includes("Versions"));
      expect(headerLine).toBeDefined();

      // Each version line should contain an index (#N), version ID, and status
      const versionLines = lines.filter((l: string) => l.includes("ver_"));
      expect(versionLines.length).toBe(3);

      // The selected version (ver_002, best completed) should have a marker
      const selectedLine = versionLines.find((l: string) => l.includes("ver_002"));
      expect(selectedLine).toBeDefined();
      expect(selectedLine).toContain("selected");
    });
  });

  // -------------------------------------------------------------------------
  // 11. Placeholder warning suggests specific older version
  // -------------------------------------------------------------------------
  describe("placeholder warning version suggestion", () => {
    it("should suggest the next older completed version when placeholders are found", async () => {
      // ver_002 is selected (most recent completed), ver_001 is the next older completed
      const { deps, errors } = makeMockDeps({
        validateCustomFiles: () => ({
          valid: [],
          warnings: [{ name: "app/page.tsx", reason: "GENERATING placeholder" }],
        }),
      });
      const options = makeDefaultOptions();

      await runPipeline(options, deps);

      // Stderr should suggest ver_001 specifically (the next older completed version)
      const stderrText = errors.join("\n");
      expect(stderrText).toContain("ver_001");
    });
  });

  // -------------------------------------------------------------------------
  // 12. Path traversal prevention
  // -------------------------------------------------------------------------
  describe("path traversal prevention", () => {
    it("should reject customName containing '..'", async () => {
      const { deps } = makeMockDeps();
      const options = makeDefaultOptions({ customName: "../../../etc/evil" });

      await expect(runPipeline(options, deps)).rejects.toThrow(/path traversal/i);
    });

    it("should reject customName containing '/'", async () => {
      const { deps } = makeMockDeps();
      const options = makeDefaultOptions({ customName: "evil/path" });

      await expect(runPipeline(options, deps)).rejects.toThrow(/path traversal/i);
    });

    it("should reject customName containing '\\'", async () => {
      const { deps } = makeMockDeps();
      const options = makeDefaultOptions({ customName: "evil\\path" });

      await expect(runPipeline(options, deps)).rejects.toThrow(/path traversal/i);
    });
  });

  // -------------------------------------------------------------------------
  // 13. No placeholder warnings - clean result
  // -------------------------------------------------------------------------
  describe("no placeholder warnings", () => {
    it("should return empty warnings array when all files pass validation", async () => {
      const { deps } = makeMockDeps({
        validateCustomFiles: (customFiles: Array<{ name: string; content: string }>) => ({
          valid: customFiles,
          warnings: [],
        }),
      });
      const options = makeDefaultOptions();

      const result = await runPipeline(options, deps);

      expect(result.warnings).toEqual([]);
    });
  });
});
