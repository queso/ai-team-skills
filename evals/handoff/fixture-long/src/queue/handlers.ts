import { db } from "../db/client";
import type { OrderCreatedPayload } from "./types";

/**
 * Issues the charge for a newly created order.
 */
export async function handleOrderCreated(payload: OrderCreatedPayload): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert("charges", {
      ref_order: payload.orderId,
      ref_customer: payload.customerId,
      amount_cents: payload.amountCents,
      status: "captured",
    });
  });
}
