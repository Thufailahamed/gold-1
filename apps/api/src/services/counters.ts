type NumberedTable =
  | "purchase_invoices"
  | "purchase_orders"
  | "sales_invoices"
  | "sales_returns"
  | "old_gold_items"
  | "melting_batches"
  | "manufacturing_orders"
  | "repairs"
  | "custom_orders";

/**
 * Allocates the next document number for `name` in one atomic UPDATE.
 *
 * The old read-then-write pattern (SELECT next, then UPDATE next = n + 1 in
 * the caller's batch) let two concurrent submissions read the same value and
 * collide on the UNIQUE number. Here D1 serializes the increment, so every
 * caller gets its own value. A write that fails afterwards leaves a gap,
 * which is fine; a counter that has fallen behind the table (restored
 * backup, hand edit) is stepped past taken numbers instead of 500ing.
 */
export async function allocateNumber(
  db: D1Database,
  name: string,
  prefix: string,
  pad: number,
  table?: NumberedTable
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const row = await db
      .prepare("UPDATE counters SET next = next + 1 WHERE name = ? RETURNING next - 1 AS allocated")
      .bind(name)
      .first<{ allocated: number }>();
    if (!row) throw Object.assign(new Error(`Counter ${name} missing`), { code: "INTERNAL" });
    const no = `${prefix}-${String(row.allocated).padStart(pad, "0")}`;
    if (!table) return no;
    const taken = await db.prepare(`SELECT 1 AS x FROM ${table} WHERE number = ?`).bind(no).first();
    if (!taken) return no;
  }
  throw Object.assign(new Error(`Counter ${name} is out of step; repair it`), { code: "INTERNAL" });
}
