const PLACEHOLDER_STRINGS = ["generating"];

function isPlaceholderContent(content) {
  if (content == null || typeof content !== "string") return true;
  const trimmed = content.trim();
  if (trimmed === "") return true;
  return PLACEHOLDER_STRINGS.includes(trimmed.toLowerCase());
}

function validateFiles(files) {
  const valid = [];
  const placeholders = [];
  if (files == null) return { valid, placeholders };
  for (const file of files) {
    const content = file == null ? null : file.content;
    if (isPlaceholderContent(content)) {
      placeholders.push(file);
    } else {
      valid.push(file);
    }
  }
  return { valid, placeholders };
}

export { isPlaceholderContent, validateFiles };
