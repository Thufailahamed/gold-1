export type AuditEntry = {
  userId: string | null;
  action: string;
  entity: string;
  entityId: string;
  prev?: unknown;
  next?: unknown;
  reason?: string;
  branchId?: string;
  ip?: string;
};

export async function writeAudit(db: D1Database, entry: AuditEntry): Promise<void> {
  await db
    .prepare(
      "INSERT INTO audit_logs (id, user_id, action, entity, entity_id, prev_json, new_json, reason, ip, branch_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      crypto.randomUUID(),
      entry.userId,
      entry.action,
      entry.entity,
      entry.entityId,
      entry.prev ? JSON.stringify(entry.prev) : null,
      entry.next ? JSON.stringify(entry.next) : null,
      entry.reason ?? null,
      entry.ip ?? null,
      entry.branchId ?? null,
      Date.now()
    )
    .run();
}
