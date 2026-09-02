import type { QueueMessage } from "./types";

const BASE_DELAY_MS = 250;
const MAX_ATTEMPTS = 6;

/**
 * Exponential backoff with full jitter. Investigated during the pending_sync
 * work and cleared — the backoff is not the cause.
 */
export function nextDelayMs(attempt: number): number {
  const capped = Math.min(attempt, MAX_ATTEMPTS);
  const ceiling = BASE_DELAY_MS * 2 ** capped;
  return Math.floor(Math.random() * ceiling);
}

export async function withRetry<T>(fn: () => Promise<T>, onGiveUp: (e: unknown) => void): Promise<T | undefined> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, nextDelayMs(attempt)));
    }
  }
  onGiveUp(lastError);
  return undefined;
}

export function shouldRetry(message: QueueMessage): boolean {
  return message.attempts < MAX_ATTEMPTS && message.type !== "order.cancelled";
}
