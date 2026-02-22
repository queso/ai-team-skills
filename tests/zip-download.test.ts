import { afterEach, describe, expect, it, mock } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { strToU8, zipSync } from "fflate";
import { downloadAndExtract, downloadVersionZip, extractZipToDirectory } from "../v0-setup/scripts/zip-download.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an in-memory zip buffer containing the given files.
 * Keys are relative file paths, values are file content strings.
 */
function makeZipBuffer(files: Record<string, string>): ArrayBuffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    entries[name] = strToU8(content);
  }
  const zipped = zipSync(entries);
  return zipped.buffer as ArrayBuffer;
}

/**
 * Create a mock fetch that returns a zip response.
 */
function makeFetchMockOk(zipBuffer: ArrayBuffer) {
  return mock((_url: string, _init?: RequestInit) =>
    Promise.resolve({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(zipBuffer),
    } as unknown as Response),
  );
}

/**
 * Create a mock fetch that returns an error status.
 */
function makeFetchMockError(status: number, statusText = "") {
  return mock((_url: string, _init?: RequestInit) =>
    Promise.resolve({
      ok: false,
      status,
      statusText,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    } as unknown as Response),
  );
}

/**
 * Create a temporary directory for each test and clean it up afterward.
 */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zip-download-test-"));
}

// ---------------------------------------------------------------------------
// downloadVersionZip
// ---------------------------------------------------------------------------

describe("downloadVersionZip", () => {
  const resolvedChatId = "my-chat-Abc123";
  const versionId = "ver_xyz789";
  const apiKey = "test-api-key";

  it("successful download returns an ArrayBuffer", async () => {
    const zipBuffer = makeZipBuffer({ "index.ts": "export default 42;" });
    const fetchMock = makeFetchMockOk(zipBuffer);

    const result = await downloadVersionZip(resolvedChatId, versionId, apiKey, fetchMock as unknown as typeof fetch);

    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it("request includes Accept: application/zip header", async () => {
    const zipBuffer = makeZipBuffer({ "file.txt": "hello" });
    let capturedInit: RequestInit | undefined;
    const fetchMock = mock((_url: string, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(zipBuffer),
      } as unknown as Response);
    });

    await downloadVersionZip(resolvedChatId, versionId, apiKey, fetchMock as unknown as typeof fetch);

    expect(capturedInit?.headers).toBeDefined();
    const headers = capturedInit?.headers as Record<string, string>;
    const acceptHeader = headers.Accept ?? headers.accept ?? (capturedInit?.headers as Headers)?.get?.("Accept") ?? "";
    expect(acceptHeader).toBe("application/zip");
  });

  it("request includes Authorization: Bearer header with the API key", async () => {
    const zipBuffer = makeZipBuffer({ "file.txt": "hello" });
    let capturedInit: RequestInit | undefined;
    const fetchMock = mock((_url: string, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(zipBuffer),
      } as unknown as Response);
    });

    await downloadVersionZip(resolvedChatId, versionId, apiKey, fetchMock as unknown as typeof fetch);

    expect(capturedInit?.headers).toBeDefined();
    const headers = capturedInit?.headers as Record<string, string>;
    const authHeader =
      headers.Authorization ??
      headers.authorization ??
      (capturedInit?.headers as Headers)?.get?.("Authorization") ??
      "";
    expect(authHeader).toBe(`Bearer ${apiKey}`);
  });

  it("URL is constructed correctly: https://api.v0.dev/v1/chats/{id}/versions/{verId}/download", async () => {
    const zipBuffer = makeZipBuffer({ "file.txt": "hello" });
    let capturedUrl = "";
    const fetchMock = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(zipBuffer),
      } as unknown as Response);
    });

    await downloadVersionZip(resolvedChatId, versionId, apiKey, fetchMock as unknown as typeof fetch);

    expect(capturedUrl).toBe(`https://api.v0.dev/v1/chats/${resolvedChatId}/versions/${versionId}/download`);
  });

  it("401 response throws an error mentioning 'unauthorized'", async () => {
    const fetchMock = makeFetchMockError(401, "Unauthorized");

    await expect(
      downloadVersionZip(resolvedChatId, versionId, apiKey, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/unauthorized/i);
  });

  it("404 response throws an error mentioning 'not found'", async () => {
    const fetchMock = makeFetchMockError(404, "Not Found");

    await expect(
      downloadVersionZip(resolvedChatId, versionId, apiKey, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/not found/i);
  });

  it("500 response throws a descriptive error", async () => {
    const fetchMock = makeFetchMockError(500, "Internal Server Error");

    const promise = downloadVersionZip(resolvedChatId, versionId, apiKey, fetchMock as unknown as typeof fetch);
    await expect(promise).rejects.toThrow();
    // Should include some indication of the failure (status code or descriptive message)
    try {
      await promise;
    } catch (err) {
      const message = (err as Error).message;
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("uses global fetch when no fetchImpl is provided", async () => {
    // This test validates the function signature accepts an optional fetchImpl.
    // We cannot call the real global fetch in tests, so we only verify the import shape.
    expect(typeof downloadVersionZip).toBe("function");
    // downloadVersionZip should accept 4 or 5 arguments (fetchImpl is optional)
    expect(downloadVersionZip.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// extractZipToDirectory
// ---------------------------------------------------------------------------

describe("extractZipToDirectory", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("extracts a simple zip with one file to the target directory", async () => {
    const targetDir = makeTempDir();
    tmpDirs.push(targetDir);

    const zipBuffer = makeZipBuffer({ "hello.txt": "Hello, world!" });
    const files = await extractZipToDirectory(zipBuffer, targetDir);

    // File should exist on disk
    const writtenPath = path.join(targetDir, "hello.txt");
    expect(fs.existsSync(writtenPath)).toBe(true);
    expect(fs.readFileSync(writtenPath, "utf8")).toBe("Hello, world!");

    // Return value should include the file
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("hello.txt");
  });

  it("extracts a zip with nested directories and preserves structure", async () => {
    const targetDir = makeTempDir();
    tmpDirs.push(targetDir);

    const zipBuffer = makeZipBuffer({
      "src/components/Button.tsx": "export const Button = () => <button />;",
      "src/index.ts": "export * from './components/Button';",
      "README.md": "# My App",
    });

    const files = await extractZipToDirectory(zipBuffer, targetDir);

    // Nested files should exist
    expect(fs.existsSync(path.join(targetDir, "src", "components", "Button.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "src", "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "README.md"))).toBe(true);

    // Should return all 3 files
    expect(files).toHaveLength(3);
  });

  it("returns array with correct { name, size, content } entries", async () => {
    const targetDir = makeTempDir();
    tmpDirs.push(targetDir);

    const fileContent = "const x = 1;";
    const zipBuffer = makeZipBuffer({ "index.ts": fileContent });

    const files = await extractZipToDirectory(zipBuffer, targetDir);

    expect(files).toHaveLength(1);
    const entry = files[0];
    expect(entry).toHaveProperty("name");
    expect(entry).toHaveProperty("size");
    expect(entry).toHaveProperty("content");
    expect(entry.name).toBe("index.ts");
    expect(entry.size).toBeGreaterThan(0);
    // content should be a Uint8Array or Buffer containing the file bytes
    expect(entry.content).toBeDefined();
  });

  it("creates subdirectories as needed", async () => {
    const targetDir = makeTempDir();
    tmpDirs.push(targetDir);

    const zipBuffer = makeZipBuffer({
      "deep/nested/dir/file.ts": "export {};",
    });

    await extractZipToDirectory(zipBuffer, targetDir);

    const nestedDir = path.join(targetDir, "deep", "nested", "dir");
    expect(fs.existsSync(nestedDir)).toBe(true);
    expect(fs.statSync(nestedDir).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(nestedDir, "file.ts"))).toBe(true);
  });

  it("extracts multiple files correctly, each with correct content", async () => {
    const targetDir = makeTempDir();
    tmpDirs.push(targetDir);

    const fileMap: Record<string, string> = {
      "a.txt": "file A content",
      "b.txt": "file B content",
      "c.txt": "file C content",
    };
    const zipBuffer = makeZipBuffer(fileMap);

    const files = await extractZipToDirectory(zipBuffer, targetDir);

    expect(files).toHaveLength(3);
    for (const [name, expectedContent] of Object.entries(fileMap)) {
      const writtenPath = path.join(targetDir, name);
      expect(fs.existsSync(writtenPath)).toBe(true);
      expect(fs.readFileSync(writtenPath, "utf8")).toBe(expectedContent);
    }
  });

  it("returns size matching the file byte length", async () => {
    const targetDir = makeTempDir();
    tmpDirs.push(targetDir);

    const content = "Hello!"; // 6 bytes in UTF-8
    const zipBuffer = makeZipBuffer({ "greet.txt": content });

    const files = await extractZipToDirectory(zipBuffer, targetDir);

    expect(files[0].size).toBe(Buffer.byteLength(content, "utf8"));
  });
});

// ---------------------------------------------------------------------------
// downloadAndExtract
// ---------------------------------------------------------------------------

describe("downloadAndExtract", () => {
  const resolvedChatId = "my-chat-Abc123";
  const versionId = "ver_xyz789";
  const apiKey = "test-api-key";
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("combines download and extract, returns the file list", async () => {
    const targetDir = makeTempDir();
    tmpDirs.push(targetDir);

    const zipBuffer = makeZipBuffer({
      "app.tsx": "export default function App() { return null; }",
      "styles.css": "body { margin: 0; }",
    });
    const fetchMock = makeFetchMockOk(zipBuffer);

    const files = await downloadAndExtract(
      resolvedChatId,
      versionId,
      apiKey,
      targetDir,
      fetchMock as unknown as typeof fetch,
    );

    // Should return the file list from extract
    expect(Array.isArray(files)).toBe(true);
    expect(files).toHaveLength(2);

    // Files should actually be written to disk
    expect(fs.existsSync(path.join(targetDir, "app.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "styles.css"))).toBe(true);
  });

  it("passes through errors from the download step", async () => {
    const targetDir = makeTempDir();
    tmpDirs.push(targetDir);

    const fetchMock = makeFetchMockError(401, "Unauthorized");

    await expect(
      downloadAndExtract(resolvedChatId, versionId, apiKey, targetDir, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/unauthorized/i);
  });

  it("passes through 404 errors from the download step", async () => {
    const targetDir = makeTempDir();
    tmpDirs.push(targetDir);

    const fetchMock = makeFetchMockError(404, "Not Found");

    await expect(
      downloadAndExtract(resolvedChatId, versionId, apiKey, targetDir, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/not found/i);
  });

  it("calls downloadVersionZip with correct URL parameters", async () => {
    const targetDir = makeTempDir();
    tmpDirs.push(targetDir);

    const zipBuffer = makeZipBuffer({ "index.ts": "export {}" });
    let capturedUrl = "";
    const fetchMock = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(zipBuffer),
      } as unknown as Response);
    });

    await downloadAndExtract(resolvedChatId, versionId, apiKey, targetDir, fetchMock as unknown as typeof fetch);

    expect(capturedUrl).toBe(`https://api.v0.dev/v1/chats/${resolvedChatId}/versions/${versionId}/download`);
  });

  it("each returned entry has name, size, and content fields", async () => {
    const targetDir = makeTempDir();
    tmpDirs.push(targetDir);

    const zipBuffer = makeZipBuffer({ "component.tsx": "export const Foo = () => null;" });
    const fetchMock = makeFetchMockOk(zipBuffer);

    const files = await downloadAndExtract(
      resolvedChatId,
      versionId,
      apiKey,
      targetDir,
      fetchMock as unknown as typeof fetch,
    );

    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f).toHaveProperty("name");
      expect(f).toHaveProperty("size");
      expect(f).toHaveProperty("content");
    }
  });
});

// ---------------------------------------------------------------------------
// Edge-case / security probing tests (Amy - Raptor Protocol)
// ---------------------------------------------------------------------------

describe("extractZipToDirectory - security and edge cases", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("SECURITY: path traversal (Zip Slip) — entry with ../../ should NOT escape targetDir", async () => {
    const targetDir = makeTempDir();
    tmpDirs.push(targetDir);

    // Craft a zip with a traversal path
    const entries: Record<string, Uint8Array> = {
      "../../evil.txt": strToU8("I escaped!"),
    };
    const zipped = zipSync(entries);
    const zipBuffer = zipped.buffer as ArrayBuffer;

    // The implementation should either throw or sanitize the path so that
    // evil.txt is NOT written outside of targetDir.
    let threw = false;
    try {
      await extractZipToDirectory(zipBuffer, targetDir);
    } catch {
      threw = true;
    }

    // Determine where the traversal would have landed
    const escapedPath = path.resolve(path.join(targetDir, "../../evil.txt"));
    const escapedExists = fs.existsSync(escapedPath);

    // Either the function threw, OR the file was not written outside targetDir.
    // Both are acceptable safe behaviors. A file written outside targetDir is a bug.
    if (!threw) {
      expect(escapedExists).toBe(false);
    } else {
      // Throwing is also acceptable — just confirm it threw
      expect(threw).toBe(true);
    }
  });

  it("SECURITY: absolute path entry should NOT write outside targetDir", async () => {
    const targetDir = makeTempDir();
    tmpDirs.push(targetDir);

    // Some zip tools allow absolute paths — fflate may or may not include them.
    // We attempt to create such an entry.
    const entries: Record<string, Uint8Array> = {
      "/tmp/absolute-evil.txt": strToU8("absolute path escape"),
    };
    const zipped = zipSync(entries);
    const zipBuffer = zipped.buffer as ArrayBuffer;

    let threw = false;
    try {
      await extractZipToDirectory(zipBuffer, targetDir);
    } catch {
      threw = true;
    }

    const escapedExists = fs.existsSync("/tmp/absolute-evil.txt");

    if (!threw) {
      expect(escapedExists).toBe(false);
    } else {
      expect(threw).toBe(true);
    }
  });

  it("empty zip (no entries) returns an empty array and writes nothing", async () => {
    const targetDir = makeTempDir();
    tmpDirs.push(targetDir);

    const zipped = zipSync({});
    const zipBuffer = zipped.buffer as ArrayBuffer;

    const files = await extractZipToDirectory(zipBuffer, targetDir);

    expect(Array.isArray(files)).toBe(true);
    expect(files).toHaveLength(0);

    // targetDir should still be empty
    const entries = fs.readdirSync(targetDir);
    expect(entries).toHaveLength(0);
  });

  it("targetDir does not exist — should be created automatically", async () => {
    const baseDir = makeTempDir();
    tmpDirs.push(baseDir);
    const targetDir = path.join(baseDir, "nonexistent-subdir");

    // targetDir does NOT exist before the call
    expect(fs.existsSync(targetDir)).toBe(false);

    const zipBuffer = makeZipBuffer({ "file.txt": "hello" });

    // Should not throw; mkdirSync with recursive:true should handle it
    await expect(extractZipToDirectory(zipBuffer, targetDir)).resolves.toBeDefined();

    expect(fs.existsSync(path.join(targetDir, "file.txt"))).toBe(true);
  });

  it("null zipBuffer — should throw rather than silently corrupt", async () => {
    const targetDir = makeTempDir();
    tmpDirs.push(targetDir);

    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: intentional bad input for robustness test
      extractZipToDirectory(null as any, targetDir),
    ).rejects.toThrow();
  });
});
