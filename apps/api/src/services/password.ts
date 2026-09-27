import { buildAuditStmt } from "../middleware/audit";
import { hashPassword, verifyPassword } from "./hash";

const RESET_TTL_MS = 15 * 60 * 1000;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function changePassword(
  db: D1Database,
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = await db
    .prepare("SELECT id, password_hash FROM users WHERE id = ? AND is_active = 1")
    .bind(userId)
    .first<{ id: string; password_hash: string }>();
  if (!user) throw Object.assign(new Error("User not found"), { code: "NOT_FOUND" });
  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok)
    throw Object.assign(new Error("Current password is incorrect"), { code: "UNAUTHORIZED" });
  const now = Date.now();
  await db.batch([
    db
      .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
      .bind(await hashPassword(newPassword), now, userId),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    buildAuditStmt(db, {
      userId,
      action: "auth.password_change",
      entity: "user",
      entityId: userId,
    }),
  ]);
}

export async function requestReset(
  db: D1Database,
  email: string,
  actorId: string
): Promise<{ token: string; userId: string }> {
  const user = await db
    .prepare("SELECT id, is_active FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; is_active: number }>();
  if (!user || !user.is_active)
    throw Object.assign(new Error("User not found or inactive"), { code: "NOT_FOUND" });
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(id, user.id, await sha256Hex(token), now + RESET_TTL_MS, now, actorId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "auth.reset_request",
      entity: "user",
      entityId: user.id,
    }),
  ]);
  return { token, userId: user.id };
}

export async function confirmReset(
  db: D1Database,
  token: string,
  newPassword: string
): Promise<void> {
  const row = await db
    .prepare("SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .first<{ id: string; user_id: string; expires_at: number; used_at: number | null }>();
  if (!row || row.used_at || row.expires_at < Date.now())
    throw Object.assign(new Error("Invalid or expired reset token"), { code: "UNAUTHORIZED" });
  const now = Date.now();
  await db.batch([
    db
      .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
      .bind(await hashPassword(newPassword), now, row.user_id),
    db.prepare("UPDATE password_resets SET used_at = ? WHERE id = ?").bind(now, row.id),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.user_id),
    buildAuditStmt(db, {
      userId: row.user_id,
      action: "auth.reset_confirm",
      entity: "user",
      entityId: row.user_id,
    }),
  ]);
}
