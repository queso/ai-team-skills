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

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const args = argv.slice(2);
  let inputArg = null;
  let customName = null;
  let outputDir = null;
  let versionId = null;
  let listVersions = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output-dir" && i + 1 < args.length) {
      outputDir = args[i + 1];
      i++;
    } else if (args[i] === "--version") {
      const next = args[i + 1];
      if (next !== undefined && next !== "" && !next.startsWith("--")) {
        versionId = next;
        i++;
      }
    } else if (args[i] === "--list-versions") {
      listVersions = true;
    } else if (!inputArg) {
      inputArg = args[i];
    } else if (!customName) {
      customName = args[i];
    }
  }

  return { inputArg, customName, outputDir: outputDir || process.cwd(), versionId, listVersions };
}

function isHashSegment(segment) {
  return /^[a-zA-Z0-9]{6,}$/.test(segment) && !/^[a-z]+$/.test(segment) && !/^\d+$/.test(segment);
}

function extractChatId(input) {
  if (input == null) {
    throw new Error(`extractChatId: input must be a string, got ${input}`);
  }
  const trimmed = input.trim();
  if (trimmed === "") {
    return { slug: "", hashId: "", featureName: "" };
  }

  const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  if (isUrl) {
    if (!/^https?:\/\//i.test(trimmed)) {
      throw new Error(`extractChatId: unsupported URL protocol — only http/https URLs are supported: ${trimmed}`);
    }
    const v0Match = trimmed.match(/v0\.(?:app|dev)\/chat\/([a-zA-Z0-9_-]+)/);
    if (!v0Match) {
      throw new Error(`extractChatId: unsupported URL host — only v0.app and v0.dev URLs are supported: ${trimmed}`);
    }
    const slug = v0Match[1];
    return resolveSlug(slug);
  }

  return resolveSlug(trimmed);
}

function resolveSlug(slug) {
  const parts = slug.split("-");
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (isHashSegment(last)) {
      return {
        slug,
        hashId: last,
        featureName: parts.slice(0, -1).join("-"),
      };
    }
  }
  return { slug, hashId: slug, featureName: slug };
}

function deriveFeatureName(slug) {
  return extractChatId(slug).featureName;
}

/**
 * Format the version list table for --list-versions output.
 */
function formatVersionList(hashId, versions, bestVersion) {
  const total = versions.length;
  const lines = [`Versions for chat ${hashId} (${total} total):`];

  for (let i = 0; i < versions.length; i++) {
    const v = versions[i];
    const index = total - i;
    const marker = bestVersion && v.id === bestVersion.id ? "  (selected)" : "";
    lines.push(`  #${index}  ${v.id}  ${v.status}  ${v.createdAt}${marker}`);
  }

  return lines.join("\n");
}

/**
 * Find the next older completed version after the selected one in the list.
 */
function findNextOlderCompleted(versions, selectedVersionId) {
  let foundSelected = false;
  for (const v of versions) {
    if (v.id === selectedVersionId) {
      foundSelected = true;
      continue;
    }
    if (foundSelected && v.status === "completed") {
      return v;
    }
  }
  return null;
}

/**
 * Orchestrate the full fetch pipeline with injected dependencies.
 *
 * @param {object} options - Pipeline options
 * @param {object} deps - Injected dependencies for testability
 * @returns {Promise<object>} Pipeline result
 */
async function runPipeline(options, deps) {
  const { inputArg, customName, outputDir, apiKey, versionId, listVersions } = options;

  // Step 1: Extract chat identity from the input
  const { slug, hashId, featureName: derivedFeatureName } = extractChatId(inputArg);
  const effectiveFeatureName = customName || derivedFeatureName;

  // Sanitize featureName to prevent path traversal
  if (
    effectiveFeatureName.includes("..") ||
    effectiveFeatureName.includes("/") ||
    effectiveFeatureName.includes("\\")
  ) {
    throw new Error(`Invalid feature name: "${effectiveFeatureName}" contains path traversal characters`);
  }

  // Step 2: Fetch the version list
  const { versions, resolvedChatId } = await deps.fetchVersionList(slug, hashId, apiKey);

  // Step 3: Handle --list-versions flag (early return, no download)
  if (listVersions) {
    const bestVersion = deps.selectBestVersion(versions);
    const listVersionsOutput = formatVersionList(hashId, versions, bestVersion);

    return {
      featureName: effectiveFeatureName,
      designDir: undefined,
      versionId: bestVersion ? bestVersion.id : null,
      resolvedChatId,
      totalFiles: 0,
      customFileCount: 0,
      defaultFileCount: 0,
      warnings: [],
      listVersionsOutput,
    };
  }

  // Step 4: Select the version to download
  let selectedVersionId;
  if (versionId) {
    selectedVersionId = versionId;
  } else {
    const bestVersion = deps.selectBestVersion(versions);
    if (!bestVersion) {
      throw new Error("No suitable version found. The version list may be empty.");
    }
    selectedVersionId = bestVersion.id;
  }

  // Step 5: Build the output directory path
  const designDir = join(outputDir, "designs", effectiveFeatureName, "v0-source");
  deps.mkdirSync(designDir, { recursive: true });

  // Step 6: Download and extract files
  const extractedFiles = await deps.downloadAndExtract(resolvedChatId, selectedVersionId, apiKey, designDir);

  // Step 7: Fetch custom file names and classify
  const customFileNames = await deps.fetchCustomFileList(resolvedChatId, selectedVersionId, apiKey);
  const classified = deps.classifyFiles(extractedFiles, customFileNames);

  // Step 8: Validate custom files for placeholder content
  const validationResult = deps.validateCustomFiles(classified.custom, deps.isPlaceholderContent);

  // Step 9: Handle placeholder warnings
  if (validationResult.warnings.length > 0) {
    for (const warning of validationResult.warnings) {
      deps.console.error(`Warning: ${warning.name} — ${warning.reason}`);
    }

    const olderVersion = findNextOlderCompleted(versions, selectedVersionId);
    if (olderVersion) {
      deps.console.error(`Try: --version ${olderVersion.id}`);
    }
  }

  // Step 10: Build and write manifest
  const customSet = new Set(customFileNames);
  const manifest = {
    chatId: resolvedChatId,
    featureName: effectiveFeatureName,
    fetchedAt: new Date().toISOString(),
    sourceUrl: `https://v0.app/chat/${resolvedChatId}`,
    versionId: selectedVersionId,
    versionSelectedFrom: versions.length,
    customFileCount: classified.custom.length,
    defaultFileCount: classified.default.length,
    warnings: validationResult.warnings,
    files: extractedFiles.map((f) => ({
      name: f.name,
      size: f.size,
      isCustom: customSet.has(f.name),
    })),
  };

  deps.writeFileSync(join(designDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // Step 11: Log summary
  deps.console.log(
    `Done! ${extractedFiles.length} files (${classified.custom.length} custom, ${classified.default.length} default) written to ${designDir}`,
  );

  return {
    featureName: effectiveFeatureName,
    designDir,
    versionId: selectedVersionId,
    resolvedChatId,
    totalFiles: extractedFiles.length,
    customFileCount: classified.custom.length,
    defaultFileCount: classified.default.length,
    warnings: validationResult.warnings,
  };
}

async function main() {
  const { inputArg, customName, outputDir, versionId, listVersions } = parseArgs(process.argv);

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

  const { fetchVersionList, selectBestVersion } = await import("./version-list.mjs");
  const { downloadAndExtract } = await import("./zip-download.mjs");
  const { fetchCustomFileList, classifyFiles, validateCustomFiles } = await import("./file-filter.mjs");
  const { isPlaceholderContent } = await import("./placeholder-detection.mjs");

  const result = await runPipeline(
    { inputArg, customName, outputDir, apiKey, versionId, listVersions },
    {
      fetchVersionList,
      selectBestVersion,
      downloadAndExtract,
      fetchCustomFileList,
      classifyFiles,
      validateCustomFiles,
      isPlaceholderContent,
      writeFileSync,
      mkdirSync,
      console,
    },
  );

  if (result.listVersionsOutput) {
    console.log(result.listVersionsOutput);
  }
}

export { extractChatId, deriveFeatureName, parseArgs, runPipeline };

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("fetch-v0.mjs")) {
  main().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}
