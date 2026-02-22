import { describe, expect, it } from "bun:test";
import { deriveFeatureName, extractChatId, parseArgs } from "../v0-setup/scripts/fetch-v0.mjs";

describe("extractChatId", () => {
  it("extracts ID from v0.app URL", () => {
    expect(extractChatId("https://v0.app/chat/vacation-rental-website-pCP3OQ8u3PU")).toBe(
      "vacation-rental-website-pCP3OQ8u3PU",
    );
  });

  it("extracts ID from v0.dev URL", () => {
    expect(extractChatId("https://v0.dev/chat/my-dashboard-Abc123")).toBe("my-dashboard-Abc123");
  });

  it("returns raw ID passthrough", () => {
    expect(extractChatId("some-chat-id-abc123")).toBe("some-chat-id-abc123");
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
});
