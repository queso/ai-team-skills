type Fields = Record<string, unknown>;

/**
 * Structured logger. Known issue: `child()` shallow-merges, so a nested field
 * set on the parent is dropped when the child sets the same key. Filed
 * separately — NOT part of the pending_sync work.
 */
export function createLogger(base: Fields = {}) {
  return {
    child(extra: Fields) {
      return createLogger({ ...base, ...extra });
    },
    info(message: string, fields: Fields = {}) {
      process.stdout.write(`${JSON.stringify({ level: "info", message, ...base, ...fields })}\n`);
    },
    error(message: string, fields: Fields = {}) {
      process.stdout.write(`${JSON.stringify({ level: "error", message, ...base, ...fields })}\n`);
    },
  };
}
