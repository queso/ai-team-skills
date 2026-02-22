const V0_API_BASE = "https://api.v0.dev/v1";

/**
 * Fetches the list of custom (non-default) filenames for a given chat version.
 *
 * @param {string} resolvedChatId
 * @param {string} versionId
 * @param {string} apiKey
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string[]>}
 */
export async function fetchCustomFileList(resolvedChatId, versionId, apiKey, fetchImpl) {
  if (resolvedChatId == null) {
    throw new Error("fetchCustomFileList: resolvedChatId must be a string");
  }
  const _fetch = fetchImpl ?? fetch;
  const url = `${V0_API_BASE}/chats/${resolvedChatId}/versions/${versionId}?includeDefaultFiles=false`;
  const response = await _fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error ${response.status} fetching custom file list`);
  }

  const data = await response.json();
  return (data.files ?? []).map((f) => f.name ?? f.path).filter((name) => name != null);
}

/**
 * Classifies files as custom or default based on a list of custom file names.
 *
 * @param {Array<{name: string, size: number}>} allFiles
 * @param {string[]} customFileNames
 * @returns {{ custom: Array<{name: string, size: number, isCustom: true}>, default: Array<{name: string, size: number, isCustom: false}> }}
 */
export function classifyFiles(allFiles, customFileNames) {
  if (customFileNames == null) {
    throw new Error("classifyFiles: customFileNames must be an array");
  }
  const customSet = new Set(customFileNames);
  const custom = [];
  const defaultFiles = [];

  for (const file of allFiles) {
    if (customSet.has(file.name)) {
      custom.push({ ...file, isCustom: true });
    } else {
      defaultFiles.push({ ...file, isCustom: false });
    }
  }

  return { custom, default: defaultFiles };
}

/**
 * Validates custom files using the provided placeholder predicate.
 *
 * @param {Array<{name: string, content: string}>} customFiles
 * @param {(content: string) => boolean} isPlaceholderFn
 * @returns {{ valid: Array<{name: string, content: string}>, warnings: Array<{name: string, reason: string}> }}
 */
export function validateCustomFiles(customFiles, isPlaceholderFn) {
  const valid = [];
  const warnings = [];

  for (const file of customFiles) {
    if (isPlaceholderFn(file.content)) {
      const reason = deriveReason(file.content);
      warnings.push({ name: file.name, reason });
    } else {
      valid.push(file);
    }
  }

  return { valid, warnings };
}

/**
 * Derives a human-readable reason string from placeholder content.
 *
 * @param {string} content
 * @returns {string}
 */
function deriveReason(content) {
  if (content.trim().toUpperCase() === "GENERATING") {
    return "File content is a GENERATING placeholder — generation may still be in progress";
  }
  if (content.trim() === "") {
    return "File content is empty — skipping empty file";
  }
  return "File content appears to be a placeholder";
}
