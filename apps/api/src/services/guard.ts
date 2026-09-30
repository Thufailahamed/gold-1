const STALE = "stale-state-guard";

/**
 * Aborts the enclosing batch when the statement just before it changed no
 * rows. Pair it with a state-guarded UPDATE (`... WHERE id = ? AND status = ?`)
 * so a request that lost a race rolls back its journal, events and audit
 * instead of posting them against a row someone else already moved.
 *
 * `json()` on malformed text raises, but only for rows that pass the WHERE,
 * so the guard is a no-op whenever the UPDATE matched.
 */
export function staleGuard(db: D1Database): D1PreparedStatement {
  return db.prepare(`SELECT json('${STALE}') WHERE changes() = 0`);
}

/** Runs `stmts`; if the batch lost a race (guard fired), throws CONFLICT instead of a raw 500. */
export async function batchOrConflict(db: D1Database, stmts: D1PreparedStatement[], message: string): Promise<void> {
  try {
    await db.batch(stmts);
  } catch (err) {
    if (/malformed JSON/i.test((err as Error)?.message ?? ""))
      throw Object.assign(new Error(message), { code: "CONFLICT" });
    throw err;
  }
}
