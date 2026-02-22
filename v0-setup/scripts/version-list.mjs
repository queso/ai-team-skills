const V0_API_BASE = "https://api.v0.dev/v1";

/**
 * Generic helper that calls buildUrl(slug), falls back to buildUrl(hashId) on 404.
 * Returns { response, resolvedChatId }.
 * Throws on non-404 errors.
 *
 * @param {string} slug
 * @param {string} hashId
 * @param {string} apiKey
 * @param {(id: string) => string} buildUrl
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ response: Response, resolvedChatId: string }>}
 */
export async function fetchWithChatIdFallback(slug, hashId, apiKey, buildUrl, fetchImpl = fetch) {
  if (slug == null) {
    throw new Error("fetchWithChatIdFallback: slug must be a string");
  }
  const headers = { Authorization: `Bearer ${apiKey}` };

  const slugUrl = buildUrl(slug);
  const slugResponse = await fetchImpl(slugUrl, { headers });

  if (slugResponse.ok) {
    return { response: slugResponse, resolvedChatId: slug };
  }

  if (slugResponse.status === 404) {
    const hashUrl = buildUrl(hashId);
    const hashResponse = await fetchImpl(hashUrl, { headers });

    if (hashResponse.ok) {
      return { response: hashResponse, resolvedChatId: hashId };
    }

    throw new Error(`Request failed with status ${hashResponse.status} for hashId ${hashId}`);
  }

  throw new Error(`Request failed with status ${slugResponse.status} for slug ${slug}`);
}

/**
 * Fetches the version list for a chat, handling pagination and slug/hashId fallback.
 *
 * @param {string} slug
 * @param {string} hashId
 * @param {string} apiKey
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ versions: Array<{id: string, status: string, createdAt: string}>, resolvedChatId: string }>}
 */
export async function fetchVersionList(slug, hashId, apiKey, fetchImpl = fetch) {
  const allVersions = [];
  let resolvedChatId = null;
  let cursor = null;
  let isFirstPage = true;

  while (true) {
    const buildUrl = (id) => {
      const params = new URLSearchParams({ limit: "100" });
      if (cursor) params.set("cursor", cursor);
      return `${V0_API_BASE}/chats/${id}/versions?${params}`;
    };

    if (isFirstPage) {
      const { response, resolvedChatId: rid } = await fetchWithChatIdFallback(
        slug,
        hashId,
        apiKey,
        buildUrl,
        fetchImpl,
      );
      resolvedChatId = rid;
      isFirstPage = false;

      const data = await response.json();
      if (Array.isArray(data.versions)) {
        allVersions.push(...data.versions);
      }

      if (!data.cursor) break;
      cursor = data.cursor;
    } else {
      // Subsequent pages use the resolved chat ID directly
      const url = buildUrl(resolvedChatId);
      const headers = { Authorization: `Bearer ${apiKey}` };
      const response = await fetchImpl(url, { headers });

      if (!response.ok) {
        throw new Error(`Pagination request failed with status ${response.status}`);
      }

      const data = await response.json();
      if (Array.isArray(data.versions)) {
        allVersions.push(...data.versions);
      }

      if (!data.cursor) break;
      cursor = data.cursor;
    }
  }

  // Sort newest-first by createdAt
  allVersions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { versions: allVersions, resolvedChatId };
}

/**
 * Picks the best version to download from a newest-first sorted list.
 * Prefers completed versions; falls back to most recent if none completed.
 *
 * @param {Array<{id: string, status: string, createdAt: string}>} versions
 * @returns {{ id: string, status: string, createdAt: string } | null}
 */
export function selectBestVersion(versions) {
  if (!versions || versions.length === 0) return null;

  // Find the most recent completed version (list is already newest-first)
  const completed = versions.find((v) => v != null && v.status === "completed");

  if (completed) {
    console.log(`Selected version ${completed.id} (status: completed, createdAt: ${completed.createdAt})`);
    return completed;
  }

  // Fall back to most recent non-null
  const fallback = versions.find((v) => v != null) ?? null;
  if (!fallback) return null;
  console.log(
    `Selected version ${fallback.id} (status: ${fallback.status}, createdAt: ${fallback.createdAt}) — no completed version found`,
  );
  return fallback;
}
