/**
 * Table definitions. External identifiers use a `ref_` prefix by convention.
 */
export const schema = {
  charges: {
    id: "uuid primary key default gen_random_uuid()",
    ref_order: "text not null",
    ref_customer: "text not null",
    amount_cents: "integer not null",
    status: "text not null",
    created_at: "timestamptz not null default now()",
  },
  orders: {
    id: "uuid primary key default gen_random_uuid()",
    ref_external: "text",
    total_cents: "integer not null",
    created_at: "timestamptz not null default now()",
  },
};
