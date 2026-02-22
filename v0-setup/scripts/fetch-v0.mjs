#!/usr/bin/env node

/**
 * fetch-v0.mjs — Pull source files from a v0.dev chat via the Platform API
 *
 * Usage:
 *   node <skill-path>/scripts/fetch-v0.mjs <v0-url-or-chat-id> <feature-name> [--output-dir <path>]
 *
 * Requirements:
 *   - V0_API_KEY environment variable (get from v0.dev/chat/settings/keys)
 *
 * Options:
 *   --output-dir <path>  Base directory for designs/<feature-name>/
 *                         Defaults to process.cwd() if not provided
 *
 * Output:
 *   - Creates <output-dir>/designs/<feature-name>/ directory
 *   - Writes all v0 source files into it
 *   - Generates a manifest.json listing all files pulled
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const V0_API_BASE = "https://api.v0.dev/v1";

function parseArgs(argv) {
  const args = argv.slice(2);
  let inputArg = null;
  let customName = null;
  let outputDir = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output-dir" && i + 1 < args.length) {
      outputDir = args[i + 1];
      i++;
    } else if (!inputArg) {
      inputArg = args[i];
    } else if (!customName) {
      customName = args[i];
    }
  }

  return { inputArg, customName, outputDir: outputDir || process.cwd() };
}

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
  const { inputArg, customName, outputDir } = parseArgs(process.argv);

  if (!inputArg) {
    console.error("Usage: node fetch-v0.mjs <v0-url-or-chat-id> [feature-name] [--output-dir <path>]");
    console.error("");
    console.error("Options:");
    console.error("  --output-dir <path>  Base directory for designs/<feature-name>/");
    console.error("                       Defaults to current working directory");
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
  const designDir = join(outputDir, "designs", featureName);

  console.log(`Chat ID: ${chatId}`);
  console.log(`Feature: ${featureName}`);
  console.log(`Output:  ${designDir}\n`);

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
  mkdirSync(designDir, { recursive: true });

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

    const filePath = join(designDir, fileName);
    mkdirSync(dirname(filePath), { recursive: true });

    const content = file.content || "";
    writeFileSync(filePath, content, "utf-8");

    manifest.files.push({ name: fileName, size: content.length, locked: file.locked || false });
    console.log(`  ${fileName} (${content.length} bytes)`);
  }

  writeFileSync(join(designDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`  manifest.json\n`);
  console.log(`Done! ${files.length} files written to designs/${featureName}/\n`);
  console.log(`Next steps:`);
  console.log(`  1. Optionally create designs/${featureName}/notes.md`);
  console.log(`  2. Run: /v0-setup ${featureName}`);
}

main().catch((err) => { console.error("Fatal error:", err.message); process.exit(1); });
