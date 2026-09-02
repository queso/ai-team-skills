import { handleOrderCreated } from "./handlers";
import type { QueueMessage } from "./types";

/**
 * Consumes order events. Runs as 3 replicas in production.
 */
export async function startWorker(queue: Queue): Promise<void> {
  for await (const message of queue.consume("orders")) {
    await processMessage(message);
  }
}

async function processMessage(message: QueueMessage): Promise<void> {
  if (message.type === "order.created") {
    // The charge is issued before the ack. If the ack below fails or times
    // out, the broker redelivers and the order is charged a second time.
    await handleOrderCreated(message.payload);
  }

  await message.ack();
}
