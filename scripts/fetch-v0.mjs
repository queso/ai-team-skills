#!/usr/bin/env node

/**
 * fetch-v0.mjs — Pull source files from a v0.dev chat via the Platform API
 *
 * Usage:
 *   node scripts/fetch-v0.mjs <v0-url-or-chat-id> <feature-name>
 *
 * Requirements:
 *   - V0_API_KEY environment variable (get from v0.dev/chat/settings/keys)
 *
 * Output:
 *   - Creates designs/<feature-name>/ directory
 *   - Writes all v0 source files into it
 *   - Generates a manifest.json listing all files pulled
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const V0_API_BASE = "https://api.v0.dev/v1";

function extractChatId(input) {
  const urlMatch = input.match(/v0\.(?:app|dev)\/chat\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  return input;
}

function deriveFeatureName(chatId) {
  const parts = chatId.split("-");
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (/^[a-zA-Z0-9]{6,}$/.test(last) && !/^[a-z]+$/.test(last)) {
      return parts.slice(0, -1).join("-");
    }
  }
  return chatId;
}

async function fetchChat(chatId, apiKey) {
  const response = await fetch(`${V0_API_BASE}/chats/${chatId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`v0 API error (${response.status}): ${error}`);
  }
  return response.json();
}

async function fetchVersion(chatId, versionId, apiKey) {
  const url = `${V0_API_BASE}/chats/${chatId}/versions/${versionId}?includeDefaultFiles=false`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`v0 API version fetch error (${response.status}): ${error}`);
  }
  return response.json();
}

async function main() {
  const [, , inputArg, customName] = process.argv;

  if (!inputArg) {
    console.error("Usage: node scripts/fetch-v0.mjs <v0-url-or-chat-id> [feature-name]");
    process.exit(1);
  }

  const apiKey = process.env.V0_API_KEY;
  if (!apiKey) {
    console.error("Error: V0_API_KEY environment variable is not set.");
    console.error("Get your API key from: https://v0.dev/chat/settings/keys");
    process.exit(1);
  }

  const chatId = extractChatId(inputArg);
  const featureName = customName || deriveFeatureName(chatId);
  const outputDir = join(process.cwd(), "designs", featureName);

  console.log(`Chat ID: ${chatId}`);
  console.log(`Feature: ${featureName}`);
  console.log(`Output:  ${outputDir}\n`);

  console.log("Fetching chat metadata...");
  const chat = await fetchChat(chatId, apiKey);

  const latestVersion = chat.latestVersion;
  if (!latestVersion) {
    console.error("Error: No version found for this chat.");
    process.exit(1);
  }

  console.log(`Latest version: ${latestVersion.id} (status: ${latestVersion.status})`);

  let files = latestVersion.files;
  if (files && files.length > 0 && !files[0].content) {
    console.log("Fetching full version with file contents...");
    const fullVersion = await fetchVersion(chatId, latestVersion.id, apiKey);
    files = fullVersion.files;
  }

  if (!files || files.length === 0) {
    console.error("Error: No files found in the latest version.");
    process.exit(1);
  }

  console.log(`Found ${files.length} files\n`);
  mkdirSync(outputDir, { recursive: true });

  const manifest = {
    chatId,
    featureName,
    fetchedAt: new Date().toISOString(),
    sourceUrl: `https://v0.app/chat/${chatId}`,
    versionId: latestVersion.id,
    files: [],
  };

  for (const file of files) {
    const fileName = file.name || file.path;
    if (!fileName) { console.warn("Skipping file with no name/path"); continue; }

    const filePath = join(outputDir, fileName);
    mkdirSync(dirname(filePath), { recursive: true });

    const content = file.content || "";
    writeFileSync(filePath, content, "utf-8");

    manifest.files.push({ name: fileName, size: content.length, locked: file.locked || false });
    console.log(`  ✓ ${fileName} (${content.length} bytes)`);
  }

  writeFileSync(join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`  ✓ manifest.json\n`);
  console.log(`Done! ${files.length} files written to designs/${featureName}/\n`);
  console.log(`Next steps:`);
  console.log(`  1. Optionally create designs/${featureName}/notes.md`);
  console.log(`  2. Run: /adapt-v0 ${featureName}`);
}

main().catch((err) => { console.error("Fatal error:", err.message); process.exit(1); });
