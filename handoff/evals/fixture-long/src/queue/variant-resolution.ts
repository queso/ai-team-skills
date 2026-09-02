import { db } from "../db/client";
import type { OrderCreatedPayload, ResolvedVariant } from "./types";

/**
 * Resolves an incoming order line to a shop variant, creating the sync row if
 * this is the first time we have seen the external reference.
 *
 * Runs concurrently across 3 worker replicas.
 */
export async function resolveVariant(payload: OrderCreatedPayload): Promise<ResolvedVariant | undefined> {
  const existing = await db.selectOne("order_sync", { ref_external: payload.externalRef });
  if (existing) {
    return existing.status === "synced" ? existing.variant : undefined;
  }

  // Read-then-write. Two replicas can both miss above and both insert below.
  await db.insert("order_sync", {
    ref_external: payload.externalRef,
    ref_shop: payload.shopId,
    status: "pending_sync",
  });

  return undefined;
}

export async function markSynced(externalRef: string, variant: ResolvedVariant): Promise<void> {
  await db.update("order_sync", { ref_external: externalRef }, { status: "synced", variant });
}
