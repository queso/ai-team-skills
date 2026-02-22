import { describe, expect, it, mock } from "bun:test";
import { fetchVersionList, fetchWithChatIdFallback, selectBestVersion } from "../v0-setup/scripts/version-list.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVersion(id: string, status: string, createdAt: string, extra: Record<string, unknown> = {}) {
  return { id, status, createdAt, ...extra };
}

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
// fetchWithChatIdFallback
// ---------------------------------------------------------------------------

describe("fetchWithChatIdFallback", () => {
  const slug = "my-chat-Abc123";
  const hashId = "Abc123";
  const apiKey = "test-api-key";

  it("returns response and resolvedChatId=slug when first request succeeds (200)", async () => {
    const fetchMock = makeFetchMock({ status: 200, body: { data: "ok" } });
    const urlsVisited: string[] = [];
    const buildUrl = (id: string) => {
      const url = `https://api.v0.dev/v1/chats/${id}/versions`;
      urlsVisited.push(url);
      return url;
    };

    const result = await fetchWithChatIdFallback(slug, hashId, apiKey, buildUrl, fetchMock as unknown as typeof fetch);

    expect(result.resolvedChatId).toBe(slug);
    expect(urlsVisited).toHaveLength(1);
    expect(urlsVisited[0]).toContain(slug);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to hashId when slug returns 404, then succeeds", async () => {
    const fetchMock = makeFetchMock(
      { status: 404, body: { error: "not found" } },
      { status: 200, body: { data: "ok" } },
    );
    const urlsVisited: string[] = [];
    const buildUrl = (id: string) => {
      const url = `https://api.v0.dev/v1/chats/${id}/versions`;
      urlsVisited.push(url);
      return url;
    };

    const result = await fetchWithChatIdFallback(slug, hashId, apiKey, buildUrl, fetchMock as unknown as typeof fetch);

    expect(result.resolvedChatId).toBe(hashId);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urlsVisited[0]).toContain(slug);
    expect(urlsVisited[1]).toContain(hashId);
  });

  it("throws on 401 without attempting fallback", async () => {
    const fetchMock = makeFetchMock({ status: 401, body: { error: "unauthorized" } });
    const buildUrl = (id: string) => `https://api.v0.dev/v1/chats/${id}/versions`;

    await expect(
      fetchWithChatIdFallback(slug, hashId, apiKey, buildUrl, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws on 500 without attempting fallback", async () => {
    const fetchMock = makeFetchMock({ status: 500, body: { error: "server error" } });
    const buildUrl = (id: string) => `https://api.v0.dev/v1/chats/${id}/versions`;

    await expect(
      fetchWithChatIdFallback(slug, hashId, apiKey, buildUrl, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("calls buildUrl with slug on first attempt", async () => {
    const fetchMock = makeFetchMock({ status: 200, body: {} });
    const buildUrlCalls: string[] = [];
    const buildUrl = (id: string) => {
      buildUrlCalls.push(id);
      return `https://api.v0.dev/v1/chats/${id}/versions`;
    };

    await fetchWithChatIdFallback(slug, hashId, apiKey, buildUrl, fetchMock as unknown as typeof fetch);

    expect(buildUrlCalls[0]).toBe(slug);
  });

  it("calls buildUrl with hashId on fallback attempt", async () => {
    const fetchMock = makeFetchMock({ status: 404, body: {} }, { status: 200, body: {} });
    const buildUrlCalls: string[] = [];
    const buildUrl = (id: string) => {
      buildUrlCalls.push(id);
      return `https://api.v0.dev/v1/chats/${id}/versions`;
    };

    await fetchWithChatIdFallback(slug, hashId, apiKey, buildUrl, fetchMock as unknown as typeof fetch);

    expect(buildUrlCalls).toHaveLength(2);
    expect(buildUrlCalls[1]).toBe(hashId);
  });

  it("throws with descriptive message on non-404 error", async () => {
    const fetchMock = makeFetchMock({ status: 403, body: { error: "forbidden" } });
    const buildUrl = (id: string) => `https://api.v0.dev/v1/chats/${id}/versions`;

    const promise = fetchWithChatIdFallback(slug, hashId, apiKey, buildUrl, fetchMock as unknown as typeof fetch);
    await expect(promise).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// fetchVersionList
// ---------------------------------------------------------------------------

describe("fetchVersionList", () => {
  const slug = "my-chat-Abc123";
  const hashId = "Abc123";
  const apiKey = "test-api-key";

  const v1 = makeVersion("v1", "completed", "2024-01-01T10:00:00Z");
  const v2 = makeVersion("v2", "completed", "2024-01-02T10:00:00Z");
  const v3 = makeVersion("v3", "generating", "2024-01-03T10:00:00Z");

  it("returns versions sorted newest-first for a single-page response", async () => {
    // versions come back in oldest-first order from the API
    const fetchMock = makeFetchMock({
      status: 200,
      body: { versions: [v1, v2, v3] },
    });

    const result = await fetchVersionList(slug, hashId, apiKey, fetchMock as unknown as typeof fetch);

    expect(result.versions).toHaveLength(3);
    // newest (v3 - 2024-01-03) should be first
    expect(result.versions[0].id).toBe("v3");
    expect(result.versions[1].id).toBe("v2");
    expect(result.versions[2].id).toBe("v1");
  });

  it("returns resolvedChatId when slug resolves without fallback", async () => {
    const fetchMock = makeFetchMock({
      status: 200,
      body: { versions: [v1] },
    });

    const result = await fetchVersionList(slug, hashId, apiKey, fetchMock as unknown as typeof fetch);

    expect(result.resolvedChatId).toBe(slug);
  });

  it("returns resolvedChatId=hashId when fallback is needed", async () => {
    const fetchMock = makeFetchMock({ status: 404, body: {} }, { status: 200, body: { versions: [v1] } });

    const result = await fetchVersionList(slug, hashId, apiKey, fetchMock as unknown as typeof fetch);

    expect(result.resolvedChatId).toBe(hashId);
  });

  it("handles single-page response without pagination metadata (no cursor)", async () => {
    const fetchMock = makeFetchMock({
      status: 200,
      body: { versions: [v1, v2] },
      // no cursor or pagination metadata
    });

    const result = await fetchVersionList(slug, hashId, apiKey, fetchMock as unknown as typeof fetch);

    expect(result.versions).toHaveLength(2);
    // should NOT attempt a second request
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("handles paginated responses by fetching all pages", async () => {
    const page1Body = {
      versions: [v1, v2],
      cursor: "page2-cursor",
    };
    const page2Body = {
      versions: [v3],
      // no cursor means last page
    };

    const fetchMock = makeFetchMock({ status: 200, body: page1Body }, { status: 200, body: page2Body });

    const result = await fetchVersionList(slug, hashId, apiKey, fetchMock as unknown as typeof fetch);

    // Should have combined all versions from both pages
    expect(result.versions).toHaveLength(3);
    // Sorted newest-first
    expect(result.versions[0].id).toBe("v3");
    // Two fetch calls: one per page (plus possibly the cursor)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns empty versions array for an empty response", async () => {
    const fetchMock = makeFetchMock({
      status: 200,
      body: { versions: [] },
    });

    const result = await fetchVersionList(slug, hashId, apiKey, fetchMock as unknown as typeof fetch);

    expect(result.versions).toHaveLength(0);
    expect(Array.isArray(result.versions)).toBe(true);
  });

  it("each version includes id, status, and createdAt at minimum", async () => {
    const fetchMock = makeFetchMock({
      status: 200,
      body: { versions: [v1, v2, v3] },
    });

    const result = await fetchVersionList(slug, hashId, apiKey, fetchMock as unknown as typeof fetch);

    for (const v of result.versions) {
      expect(v).toHaveProperty("id");
      expect(v).toHaveProperty("status");
      expect(v).toHaveProperty("createdAt");
    }
  });

  it("versions are sorted newest-first regardless of API order", async () => {
    // API returns them in random order
    const scrambled = [v2, v1, v3]; // v2 (Jan 2), v1 (Jan 1), v3 (Jan 3)
    const fetchMock = makeFetchMock({
      status: 200,
      body: { versions: scrambled },
    });

    const result = await fetchVersionList(slug, hashId, apiKey, fetchMock as unknown as typeof fetch);

    expect(result.versions[0].id).toBe("v3"); // Jan 3 — newest
    expect(result.versions[1].id).toBe("v2"); // Jan 2
    expect(result.versions[2].id).toBe("v1"); // Jan 1 — oldest
  });
});

// ---------------------------------------------------------------------------
// selectBestVersion
// ---------------------------------------------------------------------------

describe("selectBestVersion", () => {
  it("picks the most recent completed version from a mixed list", () => {
    const versions = [
      makeVersion("v3", "generating", "2024-01-03T10:00:00Z"), // most recent, not completed
      makeVersion("v2", "completed", "2024-01-02T10:00:00Z"), // most recent completed
      makeVersion("v1", "completed", "2024-01-01T10:00:00Z"), // older completed
    ];

    const result = selectBestVersion(versions);

    expect(result).not.toBeNull();
    expect(result?.id).toBe("v2");
  });

  it("picks the most recent version when all are completed", () => {
    const versions = [
      makeVersion("v3", "completed", "2024-01-03T10:00:00Z"),
      makeVersion("v2", "completed", "2024-01-02T10:00:00Z"),
      makeVersion("v1", "completed", "2024-01-01T10:00:00Z"),
    ];

    const result = selectBestVersion(versions);

    expect(result?.id).toBe("v3");
  });

  it("falls back to the most recent version when none are completed", () => {
    const versions = [
      makeVersion("v3", "generating", "2024-01-03T10:00:00Z"), // most recent
      makeVersion("v2", "failed", "2024-01-02T10:00:00Z"),
      makeVersion("v1", "pending", "2024-01-01T10:00:00Z"),
    ];

    const result = selectBestVersion(versions);

    // Should pick the first in the sorted (newest-first) list
    expect(result).not.toBeNull();
    expect(result?.id).toBe("v3");
  });

  it("returns null or undefined for an empty array", () => {
    const result = selectBestVersion([]);

    // Either null or undefined is acceptable
    expect(result == null).toBe(true);
  });

  it("returns the single version when given a one-element array", () => {
    const versions = [makeVersion("v1", "completed", "2024-01-01T10:00:00Z")];

    const result = selectBestVersion(versions);

    expect(result?.id).toBe("v1");
  });

  it("returns the single non-completed version when given a one-element array (no fallback needed)", () => {
    const versions = [makeVersion("v1", "generating", "2024-01-01T10:00:00Z")];

    const result = selectBestVersion(versions);

    expect(result?.id).toBe("v1");
  });

  it("prefers most recent completed over older completed versions", () => {
    const versions = [
      makeVersion("v5", "generating", "2024-01-05T10:00:00Z"),
      makeVersion("v4", "generating", "2024-01-04T10:00:00Z"),
      makeVersion("v3", "completed", "2024-01-03T10:00:00Z"), // should pick this one
      makeVersion("v2", "completed", "2024-01-02T10:00:00Z"),
      makeVersion("v1", "completed", "2024-01-01T10:00:00Z"),
    ];

    const result = selectBestVersion(versions);

    expect(result?.id).toBe("v3");
  });

  it("handles versions array with mixed statuses including only one completed", () => {
    const versions = [
      makeVersion("v3", "generating", "2024-01-03T10:00:00Z"),
      makeVersion("v2", "failed", "2024-01-02T10:00:00Z"),
      makeVersion("v1", "completed", "2024-01-01T10:00:00Z"), // only completed
    ];

    const result = selectBestVersion(versions);

    expect(result?.id).toBe("v1");
  });

  it("assumes input is already sorted newest-first (as returned by fetchVersionList)", () => {
    // When the list is newest-first, the first completed version encountered is the best
    const versions = [
      makeVersion("v3", "completed", "2024-01-03T10:00:00Z"), // should be picked
      makeVersion("v2", "completed", "2024-01-02T10:00:00Z"),
    ];

    const result = selectBestVersion(versions);

    expect(result?.id).toBe("v3");
  });
});

// ---------------------------------------------------------------------------
// Amy's edge case probes (Raptor Protocol)
// ---------------------------------------------------------------------------

describe("fetchWithChatIdFallback — edge cases", () => {
  const apiKey = "test-api-key";

  it("slug === hashId: makes two requests when first 404s (duplicate URL)", async () => {
    // When slug and hashId are the same value, a 404 will trigger a second
    // identical request. This is wasteful but should not error.
    const fetchMock = makeFetchMock(
      { status: 404, body: { error: "not found" } },
      { status: 200, body: { data: "ok" } },
    );
    const sameId = "Abc123";
    const buildUrl = (id: string) => `https://api.v0.dev/v1/chats/${id}/versions`;

    const result = await fetchWithChatIdFallback(
      sameId,
      sameId,
      apiKey,
      buildUrl,
      fetchMock as unknown as typeof fetch,
    );

    // Falls back and resolves with hashId (same value)
    expect(result.resolvedChatId).toBe(sameId);
    // Two requests are made — implementation doesn't optimise same-slug-as-hashId
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("double 404: slug 404 then hashId 404 throws an error", async () => {
    const fetchMock = makeFetchMock(
      { status: 404, body: { error: "not found" } },
      { status: 404, body: { error: "not found either" } },
    );
    const buildUrl = (id: string) => `https://api.v0.dev/v1/chats/${id}/versions`;

    await expect(
      fetchWithChatIdFallback("my-chat-Abc123", "Abc123", apiKey, buildUrl, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("null slug: throws a descriptive error", async () => {
    const fetchMock = makeFetchMock({ status: 200, body: { data: "ok" } });
    const buildUrl = (id: string) => `https://api.v0.dev/v1/chats/${id}/versions`;

    await expect(
      fetchWithChatIdFallback(
        null as unknown as string,
        "Abc123",
        apiKey,
        buildUrl,
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toThrow("slug must be a string");
  });

  it("buildUrl throwing propagates the error", async () => {
    const fetchMock = makeFetchMock({ status: 200, body: {} });
    const buildUrl = (_id: string): string => {
      throw new Error("URL builder exploded");
    };

    await expect(
      fetchWithChatIdFallback("slug", "hash", apiKey, buildUrl, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow("URL builder exploded");
  });
});

describe("fetchVersionList — edge cases", () => {
  const slug = "my-chat-Abc123";
  const hashId = "Abc123";
  const apiKey = "test-api-key";

  it("network error (fetch throws) propagates without wrapping", async () => {
    const networkError = new TypeError("Failed to fetch");
    const fetchMock = mock((_url: string) => Promise.reject(networkError));

    await expect(fetchVersionList(slug, hashId, apiKey, fetchMock as unknown as typeof fetch)).rejects.toThrow(
      "Failed to fetch",
    );
  });

  it("non-JSON response causes json() to throw and propagates", async () => {
    const fetchMock = mock((_url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON")),
      } as unknown as Response),
    );

    await expect(fetchVersionList(slug, hashId, apiKey, fetchMock as unknown as typeof fetch)).rejects.toThrow();
  });

  it("missing versions field in API response returns empty array (silent skip)", async () => {
    // data.versions is undefined; Array.isArray(undefined) === false, so allVersions stays []
    const fetchMock = makeFetchMock({ status: 200, body: { something_else: true } });

    const result = await fetchVersionList(slug, hashId, apiKey, fetchMock as unknown as typeof fetch);

    expect(result.versions).toHaveLength(0);
    expect(Array.isArray(result.versions)).toBe(true);
  });
});

describe("selectBestVersion — edge cases", () => {
  it("version with missing status field is not treated as completed (falls back)", () => {
    const versions = [
      { id: "v2", createdAt: "2024-01-02T10:00:00Z" } as unknown as ReturnType<typeof makeVersion>,
      makeVersion("v1", "completed", "2024-01-01T10:00:00Z"),
    ];

    const result = selectBestVersion(versions);

    // v2 has no status; it's not "completed", so v1 (completed) should be preferred
    // But v2 comes first (newest-first order), so selectBestVersion would find v1 via .find()
    expect(result?.id).toBe("v1");
  });

  it("null element in versions array is skipped (finds completed version)", () => {
    const versions = [null, makeVersion("v1", "completed", "2024-01-01T10:00:00Z")] as unknown[];

    const result = selectBestVersion(versions as Parameters<typeof selectBestVersion>[0]);
    expect(result?.id).toBe("v1");
  });
});
