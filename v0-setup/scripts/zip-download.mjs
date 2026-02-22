import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { unzipSync } from "fflate";

const V0_API_BASE = "https://api.v0.dev/v1";

/**
 * Downloads a zip archive for a specific chat version from the v0 API.
 *
 * @param {string} resolvedChatId - The chat ID
 * @param {string} versionId - The version ID
 * @param {string} apiKey - The API key for authorization
 * @param {typeof fetch} [fetchImpl] - Optional fetch implementation (defaults to global fetch)
 * @returns {Promise<ArrayBuffer>} The raw zip data as an ArrayBuffer
 */
export async function downloadVersionZip(resolvedChatId, versionId, apiKey, fetchImpl = fetch) {
  const url = `${V0_API_BASE}/chats/${resolvedChatId}/versions/${versionId}/download`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/zip",
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 401) {
      throw new Error(`Unauthorized: failed to download zip (status ${status})`);
    }
    if (status === 404) {
      throw new Error(`Not found: version or chat not found (status ${status})`);
    }
    throw new Error(`Failed to download zip: HTTP ${status} ${response.statusText}`);
  }

  return response.arrayBuffer();
}

/**
 * Extracts a zip buffer to the given target directory.
 *
 * @param {ArrayBuffer} zipBuffer - The zip data
 * @param {string} targetDir - The directory to extract files into
 * @returns {Promise<Array<{name: string, size: number, content: string}>>} Array of extracted file info
 */
export async function extractZipToDirectory(zipBuffer, targetDir) {
  const uint8 = new Uint8Array(zipBuffer);
  const unzipped = unzipSync(uint8);
  const files = [];

  const resolvedTarget = resolve(targetDir);
  for (const [name, data] of Object.entries(unzipped)) {
    const filePath = resolve(targetDir, name);
    if (!filePath.startsWith(resolvedTarget)) {
      throw new Error(`Zip Slip detected: "${name}" resolves outside target directory`);
    }
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, data);
    const content = new TextDecoder().decode(data);
    files.push({ name, size: data.byteLength, content });
  }

  return files;
}

/**
 * Downloads and extracts a zip archive for a specific chat version.
 *
 * @param {string} resolvedChatId - The chat ID
 * @param {string} versionId - The version ID
 * @param {string} apiKey - The API key for authorization
 * @param {string} targetDir - The directory to extract files into
 * @param {typeof fetch} [fetchImpl] - Optional fetch implementation (defaults to global fetch)
 * @returns {Promise<Array<{name: string, size: number, content: string}>>} Array of extracted file info
 */
export async function downloadAndExtract(resolvedChatId, versionId, apiKey, targetDir, fetchImpl = fetch) {
  const zipBuffer = await downloadVersionZip(resolvedChatId, versionId, apiKey, fetchImpl);
  return extractZipToDirectory(zipBuffer, targetDir);
}
