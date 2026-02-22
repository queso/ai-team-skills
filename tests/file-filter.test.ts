import { describe, expect, it, mock } from "bun:test";
import { classifyFiles, fetchCustomFileList, validateCustomFiles } from "../v0-setup/scripts/file-filter.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchMock(...responses: Array<{ status: number; body: unknown }>) {
  let callIndex = 0;
  return mock((_url: string, _init?: RequestInit) => {
    const response = responses[callIndex++] ?? responses[responses.length - 1];
    return Promise.resolve({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: () => Promise.resolve(response.body),
    } as Response);
  });
}

// ---------------------------------------------------------------------------
// fetchCustomFileList
// ---------------------------------------------------------------------------

describe("fetchCustomFileList", () => {
  const resolvedChatId = "my-chat-Abc123";
  const versionId = "ver_abc123";
  const apiKey = "test-api-key";

  it("returns array of filenames from the API response (name property)", async () => {
    const fetchMock = makeFetchMock({
      status: 200,
      body: {
        files: [
          { name: "app.tsx", size: 1200 },
          { name: "components/Button.tsx", size: 400 },
        ],
      },
    });

    const result = await fetchCustomFileList(resolvedChatId, versionId, apiKey, fetchMock as unknown as typeof fetch);

    expect(result).toEqual(["app.tsx", "components/Button.tsx"]);
  });

  it("constructs URL with ?includeDefaultFiles=false query param", async () => {
    const urlsVisited: string[] = [];
    const fetchMock = mock((url: string, _init?: RequestInit) => {
      urlsVisited.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ files: [] }),
      } as Response);
    });

    await fetchCustomFileList(resolvedChatId, versionId, apiKey, fetchMock as unknown as typeof fetch);

    expect(urlsVisited).toHaveLength(1);
    expect(urlsVisited[0]).toContain("includeDefaultFiles=false");
  });

  it("constructs URL with correct chat ID and version ID path segments", async () => {
    const urlsVisited: string[] = [];
    const fetchMock = mock((url: string, _init?: RequestInit) => {
      urlsVisited.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ files: [] }),
      } as Response);
    });

    await fetchCustomFileList(resolvedChatId, versionId, apiKey, fetchMock as unknown as typeof fetch);

    expect(urlsVisited[0]).toContain(resolvedChatId);
    expect(urlsVisited[0]).toContain(versionId);
  });

  it("includes Authorization header with Bearer token", async () => {
    const headersReceived: Record<string, string>[] = [];
    const fetchMock = mock((_url: string, init?: RequestInit) => {
      headersReceived.push((init?.headers ?? {}) as Record<string, string>);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ files: [] }),
      } as Response);
    });

    await fetchCustomFileList(resolvedChatId, versionId, apiKey, fetchMock as unknown as typeof fetch);

    expect(headersReceived).toHaveLength(1);
    const headers = headersReceived[0];
    // Support both Headers instance and plain object
    const authHeader =
      typeof headers.get === "function"
        ? headers.get("Authorization")
        : (headers.Authorization ?? headers.authorization);
    expect(authHeader).toContain(apiKey);
  });

  it("handles empty files array — returns empty array", async () => {
    const fetchMock = makeFetchMock({
      status: 200,
      body: { files: [] },
    });

    const result = await fetchCustomFileList(resolvedChatId, versionId, apiKey, fetchMock as unknown as typeof fetch);

    expect(result).toEqual([]);
    expect(Array.isArray(result)).toBe(true);
  });

  it("throws on HTTP 401 error", async () => {
    const fetchMock = makeFetchMock({ status: 401, body: { error: "unauthorized" } });

    await expect(
      fetchCustomFileList(resolvedChatId, versionId, apiKey, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow();
  });

  it("throws on HTTP 404 error", async () => {
    const fetchMock = makeFetchMock({ status: 404, body: { error: "not found" } });

    await expect(
      fetchCustomFileList(resolvedChatId, versionId, apiKey, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow();
  });

  it("throws on HTTP 500 error", async () => {
    const fetchMock = makeFetchMock({ status: 500, body: { error: "server error" } });

    await expect(
      fetchCustomFileList(resolvedChatId, versionId, apiKey, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow();
  });

  it("extracts filenames using path property when name is absent", async () => {
    const fetchMock = makeFetchMock({
      status: 200,
      body: {
        files: [
          { path: "src/index.ts", size: 800 },
          { path: "src/utils.ts", size: 200 },
        ],
      },
    });

    const result = await fetchCustomFileList(resolvedChatId, versionId, apiKey, fetchMock as unknown as typeof fetch);

    expect(result).toEqual(["src/index.ts", "src/utils.ts"]);
  });
});

// ---------------------------------------------------------------------------
// classifyFiles
// ---------------------------------------------------------------------------

describe("classifyFiles", () => {
  it("correctly classifies a mixed list of custom and default files", () => {
    const allFiles = [
      { name: "app.tsx", size: 1200 },
      { name: "components/Button.tsx", size: 400 },
      { name: "next.config.js", size: 300 },
      { name: "tailwind.config.ts", size: 150 },
    ];
    const customFileNames = ["app.tsx", "components/Button.tsx"];

    const result = classifyFiles(allFiles, customFileNames);

    expect(result.custom).toHaveLength(2);
    expect(result.default).toHaveLength(2);
    expect(result.custom.map((f) => f.name)).toEqual(["app.tsx", "components/Button.tsx"]);
    expect(result.default.map((f) => f.name)).toEqual(["next.config.js", "tailwind.config.ts"]);
  });

  it("marks custom files with isCustom = true", () => {
    const allFiles = [{ name: "app.tsx", size: 1200 }];
    const customFileNames = ["app.tsx"];

    const result = classifyFiles(allFiles, customFileNames);

    expect(result.custom[0].isCustom).toBe(true);
  });

  it("marks default files with isCustom = false", () => {
    const allFiles = [{ name: "next.config.js", size: 300 }];
    const customFileNames = [];

    const result = classifyFiles(allFiles, customFileNames);

    expect(result.default[0].isCustom).toBe(false);
  });

  it("classifies all files as custom when all names are in customFileNames", () => {
    const allFiles = [
      { name: "a.tsx", size: 100 },
      { name: "b.tsx", size: 200 },
    ];
    const customFileNames = ["a.tsx", "b.tsx"];

    const result = classifyFiles(allFiles, customFileNames);

    expect(result.custom).toHaveLength(2);
    expect(result.default).toHaveLength(0);
  });

  it("classifies all files as default when customFileNames is empty", () => {
    const allFiles = [
      { name: "a.tsx", size: 100 },
      { name: "b.tsx", size: 200 },
    ];
    const customFileNames: string[] = [];

    const result = classifyFiles(allFiles, customFileNames);

    expect(result.custom).toHaveLength(0);
    expect(result.default).toHaveLength(2);
  });

  it("returns empty arrays when allFiles is empty", () => {
    const result = classifyFiles([], ["app.tsx"]);

    expect(result.custom).toHaveLength(0);
    expect(result.default).toHaveLength(0);
  });

  it("preserves size on classified FileInfo objects", () => {
    const allFiles = [{ name: "app.tsx", size: 9999 }];
    const customFileNames = ["app.tsx"];

    const result = classifyFiles(allFiles, customFileNames);

    expect(result.custom[0].size).toBe(9999);
  });

  it("file not in customFileNames list goes to default", () => {
    const allFiles = [{ name: "layout.tsx", size: 500 }];
    const customFileNames = ["app.tsx"]; // layout.tsx not listed

    const result = classifyFiles(allFiles, customFileNames);

    expect(result.default).toHaveLength(1);
    expect(result.default[0].name).toBe("layout.tsx");
    expect(result.custom).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateCustomFiles
// ---------------------------------------------------------------------------

describe("validateCustomFiles", () => {
  const generatingPlaceholderFn = (content: string) => content.trim().toUpperCase() === "GENERATING";
  const emptyContentFn = (content: string) => content.trim() === "";

  // Combined: detects both GENERATING and empty content
  const isPlaceholderFn = (content: string) => generatingPlaceholderFn(content) || emptyContentFn(content);

  it("detects GENERATING placeholder in custom files — returns warning", () => {
    const customFiles = [{ name: "loading.tsx", content: "GENERATING" }];

    const result = validateCustomFiles(customFiles, isPlaceholderFn);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].name).toBe("loading.tsx");
    expect(result.warnings[0].reason).toContain("GENERATING");
  });

  it("detects empty content in custom files — returns warning", () => {
    const customFiles = [{ name: "empty.tsx", content: "" }];

    const result = validateCustomFiles(customFiles, isPlaceholderFn);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].name).toBe("empty.tsx");
    expect(result.warnings[0].reason).toBeDefined();
  });

  it("passes through valid custom files into the valid array", () => {
    const customFiles = [{ name: "app.tsx", content: "import React from 'react';\nexport default function App() {}" }];

    const result = validateCustomFiles(customFiles, isPlaceholderFn);

    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].name).toBe("app.tsx");
    expect(result.warnings).toHaveLength(0);
  });

  it("returns both valid and warnings arrays for mixed input", () => {
    const customFiles = [
      { name: "app.tsx", content: "import React from 'react';\nexport default function App() {}" },
      { name: "loading.tsx", content: "GENERATING" },
      { name: "styles.css", content: "body { margin: 0; }" },
      { name: "empty.tsx", content: "" },
    ];

    const result = validateCustomFiles(customFiles, isPlaceholderFn);

    expect(result.valid).toHaveLength(2);
    expect(result.warnings).toHaveLength(2);
    expect(result.valid.map((f) => f.name)).toEqual(["app.tsx", "styles.css"]);
    expect(result.warnings.map((w) => w.name)).toEqual(["loading.tsx", "empty.tsx"]);
  });

  it("returns empty arrays for empty input", () => {
    const result = validateCustomFiles([], isPlaceholderFn);

    expect(result.valid).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(Array.isArray(result.valid)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("uses the provided isPlaceholderFn callback — custom predicate", () => {
    // Custom predicate: anything starting with "TODO" is a placeholder
    const todoPlaceholderFn = (content: string) => content.startsWith("TODO");

    const customFiles = [
      { name: "feature.tsx", content: "TODO: implement this" },
      { name: "done.tsx", content: "export const x = 1;" },
    ];

    const result = validateCustomFiles(customFiles, todoPlaceholderFn);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].name).toBe("feature.tsx");
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].name).toBe("done.tsx");
  });

  it("warning object has name and reason properties", () => {
    const customFiles = [{ name: "bad.tsx", content: "GENERATING" }];

    const result = validateCustomFiles(customFiles, isPlaceholderFn);

    expect(result.warnings[0]).toHaveProperty("name");
    expect(result.warnings[0]).toHaveProperty("reason");
  });

  it("GENERATING placeholder warning reason mentions 'GENERATING'", () => {
    const customFiles = [{ name: "loading.tsx", content: "GENERATING" }];
    const onlyGeneratingFn = (content: string) => content.trim().toUpperCase() === "GENERATING";

    const result = validateCustomFiles(customFiles, onlyGeneratingFn);

    expect(result.warnings[0].reason).toMatch(/GENERATING/i);
  });

  it("empty content warning reason mentions 'empty'", () => {
    const customFiles = [{ name: "blank.tsx", content: "" }];
    const onlyEmptyFn = (content: string) => content.trim() === "";

    const result = validateCustomFiles(customFiles, onlyEmptyFn);

    expect(result.warnings[0].reason).toMatch(/empty/i);
  });

  it("all files valid — warnings is empty array", () => {
    const customFiles = [
      { name: "a.tsx", content: "export const a = 1;" },
      { name: "b.tsx", content: "export const b = 2;" },
    ];

    const result = validateCustomFiles(customFiles, () => false);

    expect(result.warnings).toHaveLength(0);
    expect(result.valid).toHaveLength(2);
  });

  it("all files are placeholders — valid is empty array", () => {
    const customFiles = [
      { name: "a.tsx", content: "GENERATING" },
      { name: "b.tsx", content: "" },
    ];

    const result = validateCustomFiles(customFiles, isPlaceholderFn);

    expect(result.valid).toHaveLength(0);
    expect(result.warnings).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Edge case probes (Amy / Raptor Protocol)
// ---------------------------------------------------------------------------

describe("classifyFiles — edge cases", () => {
  it("throws (or behaves gracefully) when allFiles is null", () => {
    // null is not iterable; expect a TypeError to surface
    expect(() => classifyFiles(null as unknown as [], [])).toThrow();
  });

  it("throws (or behaves gracefully) when allFiles is undefined", () => {
    expect(() => classifyFiles(undefined as unknown as [], [])).toThrow();
  });

  it("throws when customFileNames is null", () => {
    expect(() => classifyFiles([{ name: "app.tsx", size: 100 }], null as unknown as string[])).toThrow(
      "customFileNames must be an array",
    );
  });

  it("throws when customFileNames is undefined", () => {
    expect(() => classifyFiles([{ name: "app.tsx", size: 100 }], undefined as unknown as string[])).toThrow(
      "customFileNames must be an array",
    );
  });

  it("is case-sensitive — 'App.tsx' does NOT match 'app.tsx' in customFileNames", () => {
    const allFiles = [{ name: "App.tsx", size: 100 }];
    const customFileNames = ["app.tsx"]; // different casing

    const result = classifyFiles(allFiles, customFileNames);

    // Case-sensitive lookup: "App.tsx" !== "app.tsx", so it should land in default
    expect(result.default).toHaveLength(1);
    expect(result.custom).toHaveLength(0);
  });

  it("handles duplicate entries in customFileNames without error", () => {
    const allFiles = [{ name: "app.tsx", size: 100 }];
    const customFileNames = ["app.tsx", "app.tsx", "app.tsx"];

    const result = classifyFiles(allFiles, customFileNames);

    // Set deduplicates; file should still be classified as custom exactly once
    expect(result.custom).toHaveLength(1);
    expect(result.default).toHaveLength(0);
  });

  it("handles empty string filename in allFiles matching empty string in customFileNames", () => {
    const allFiles = [{ name: "", size: 0 }];
    const customFileNames = [""];

    const result = classifyFiles(allFiles, customFileNames);

    expect(result.custom).toHaveLength(1);
    expect(result.custom[0].name).toBe("");
  });
});

describe("validateCustomFiles — edge cases", () => {
  it("throws (or behaves gracefully) when customFiles is null", () => {
    expect(() => validateCustomFiles(null as unknown as [], () => false)).toThrow();
  });

  it("throws (or behaves gracefully) when customFiles is undefined", () => {
    expect(() => validateCustomFiles(undefined as unknown as [], () => false)).toThrow();
  });

  it("propagates error thrown inside isPlaceholderFn", () => {
    const throwingFn = (_content: string): boolean => {
      throw new Error("predicate exploded");
    };
    const customFiles = [{ name: "app.tsx", content: "some content" }];

    expect(() => validateCustomFiles(customFiles, throwingFn)).toThrow("predicate exploded");
  });
});

describe("fetchCustomFileList — edge cases", () => {
  const versionId = "ver_abc123";
  const apiKey = "test-api-key";

  it("throws when resolvedChatId is null", async () => {
    const fetchMock = makeFetchMock({ status: 200, body: { files: [] } });

    await expect(
      fetchCustomFileList(null as unknown as string, versionId, apiKey, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow("resolvedChatId must be a string");
  });

  it("returns empty array (not throws) when API response has no files property", async () => {
    const fetchMock = makeFetchMock({
      status: 200,
      body: {}, // no `files` key
    });

    const result = await fetchCustomFileList("chat-123", versionId, apiKey, fetchMock as unknown as typeof fetch);

    expect(result).toEqual([]);
  });

  it("filters out files with neither name nor path (returns empty array)", async () => {
    const fetchMock = makeFetchMock({
      status: 200,
      body: {
        files: [{ size: 500 }], // neither name nor path
      },
    });

    const result = await fetchCustomFileList("chat-123", versionId, apiKey, fetchMock as unknown as typeof fetch);

    // Files without name or path are filtered out
    expect(result).toHaveLength(0);
  });
});
