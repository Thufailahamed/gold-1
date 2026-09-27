import { buildAuditStmt } from "../middleware/audit";

const TYPES = ["string", "number", "boolean", "json"] as const;

export async function getSetting(
  db: D1Database,
  key: string
): Promise<{ key: string; value: unknown; type: string } | null> {
  const row = await db
    .prepare("SELECT key, value_json, type FROM settings WHERE key = ?")
    .bind(key)
    .first<{ key: string; value_json: string; type: string }>();
  if (!row) return null;
  return { key: row.key, value: JSON.parse(row.value_json) as unknown, type: row.type };
}

export async function putSetting(
  db: D1Database,
  key: string,
  value: unknown,
  type: string,
  actorId: string
): Promise<void> {
  if (!TYPES.includes(type as (typeof TYPES)[number]))
    throw Object.assign(new Error("Invalid setting type"), { code: "VALIDATION" });
  const prev = await getSetting(db, key);
  await db.batch([
    db
      .prepare(
        "INSERT INTO settings (key, value_json, type) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, type = excluded.type"
      )
      .bind(key, JSON.stringify(value), type),
    buildAuditStmt(db, {
      userId: actorId,
      action: "setting.upsert",
      entity: "setting",
      entityId: key,
      prev: prev?.value,
      next: value,
    }),
  ]);
}
