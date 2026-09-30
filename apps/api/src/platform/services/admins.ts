import {
  base32Encode,
  platformPermissionsFor,
  verifyTotp,
  type PlatformRole,
} from "@goldos/shared";
import { hashPassword, verifyPassword } from "../../services/hash";
import { PSESSION_IDLE_MS } from "../auth";
import { buildPlatformAudit, fail, randomToken, sha256Hex, type Actor } from "../core";

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
// Verifying against a throwaway hash when the email is unknown keeps the
// response time flat, so timing cannot reveal which staff emails exist.
const DUMMY_HASH =
  "00000000000000000000000000000000:" + "0".repeat(128);

export type AdminRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: number;
  mfa_enabled: number;
  last_login_at: number | null;
  last_login_ip: string | null;
  locked_until: number | null;
  created_at: number;
};

const ADMIN_COLS =
  "id, email, name, role, is_active, mfa_enabled, last_login_at, last_login_ip, locked_until, created_at";

async function createSessionStmt(
  db: D1Database,
  adminId: string,
  mfaPending: boolean,
  ip: string | null,
  ua: string | null
): Promise<{ token: string; sessionId: string; stmt: D1PreparedStatement }> {
  const token = randomToken();
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const stmt = db
    .prepare(
      "INSERT INTO platform_sessions (id, token_hash, admin_id, mfa_pending, ip, user_agent, expires_at, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(sessionId, await sha256Hex(token), adminId, mfaPending ? 1 : 0, ip, ua?.slice(0, 300) ?? null, now + PSESSION_IDLE_MS, now, now);
  return { token, sessionId, stmt };
}

export async function login(
  db: D1Database,
  email: string,
  password: string,
  ip: string | null,
  ua: string | null
): Promise<{ token: string; mfaRequired: boolean; admin: { id: string; name: string; email: string } }> {
  const admin = await db
    .prepare("SELECT id, email, name, password_hash, is_active, mfa_enabled, failed_attempts, locked_until FROM platform_admins WHERE email = ?")
    .bind(email.toLowerCase())
    .first<{ id: string; email: string; name: string; password_hash: string; is_active: number; mfa_enabled: number; failed_attempts: number; locked_until: number | null }>();
  const now = Date.now();
  if (!admin) {
    await verifyPassword(password, DUMMY_HASH).catch(() => false);
    fail("UNAUTHORIZED", "Invalid credentials");
  }
  if (admin.locked_until && admin.locked_until > now)
    fail("UNAUTHORIZED", "Too many failed attempts. Try again in a few minutes.");
  const ok = await verifyPassword(password, admin.password_hash);
  if (!ok || !admin.is_active) {
    const attempts = admin.failed_attempts + 1;
    const lock = attempts >= MAX_FAILED ? now + LOCK_MS : null;
    await db.batch([
      db
        .prepare("UPDATE platform_admins SET failed_attempts = ?, locked_until = ? WHERE id = ?")
        .bind(lock ? 0 : attempts, lock, admin.id),
      buildPlatformAudit(db, {
        adminId: admin.id,
        action: lock ? "auth.locked" : "auth.login_failed",
        entity: "platform_admin",
        entityId: admin.id,
        ip,
      }),
    ]);
    fail("UNAUTHORIZED", "Invalid credentials");
  }
  const mfaRequired = admin.mfa_enabled === 1;
  const session = await createSessionStmt(db, admin.id, mfaRequired, ip, ua);
  await db.batch([
    session.stmt,
    db
      .prepare(
        mfaRequired
          ? "UPDATE platform_admins SET failed_attempts = 0, locked_until = NULL WHERE id = ?"
          : "UPDATE platform_admins SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, last_login_ip = ? WHERE id = ?"
      )
      .bind(...(mfaRequired ? [admin.id] : [now, ip, admin.id])),
    buildPlatformAudit(db, {
      adminId: admin.id,
      action: mfaRequired ? "auth.password_ok" : "auth.login",
      entity: "platform_session",
      entityId: session.sessionId,
      ip,
    }),
  ]);
  return { token: session.token, mfaRequired, admin: { id: admin.id, name: admin.name, email: admin.email } };
}

export async function completeMfa(db: D1Database, sessionId: string, adminId: string, code: string, ip: string | null): Promise<void> {
  const admin = await db
    .prepare("SELECT mfa_secret, mfa_enabled, failed_attempts FROM platform_admins WHERE id = ?")
    .bind(adminId)
    .first<{ mfa_secret: string | null; mfa_enabled: number; failed_attempts: number }>();
  if (!admin?.mfa_enabled || !admin.mfa_secret) fail("CONFLICT", "Two-factor is not enabled");
  if (!(await verifyTotp(admin.mfa_secret, code, Date.now()))) {
    const attempts = admin.failed_attempts + 1;
    // Burning the half-open session after repeated misses forces a fresh password step.
    const stmts: D1PreparedStatement[] = [
      db.prepare("UPDATE platform_admins SET failed_attempts = ? WHERE id = ?").bind(attempts >= MAX_FAILED ? 0 : attempts, adminId),
      buildPlatformAudit(db, { adminId, action: "auth.mfa_failed", entity: "platform_admin", entityId: adminId, ip }),
    ];
    if (attempts >= MAX_FAILED) stmts.push(db.prepare("DELETE FROM platform_sessions WHERE id = ?").bind(sessionId));
    await db.batch(stmts);
    fail("UNAUTHORIZED", "Invalid code");
  }
  const now = Date.now();
  await db.batch([
    db.prepare("UPDATE platform_sessions SET mfa_pending = 0 WHERE id = ?").bind(sessionId),
    db
      .prepare("UPDATE platform_admins SET failed_attempts = 0, last_login_at = ?, last_login_ip = ? WHERE id = ?")
      .bind(now, ip, adminId),
    buildPlatformAudit(db, { adminId, action: "auth.login", entity: "platform_session", entityId: sessionId, ip }),
  ]);
}

export async function logout(db: D1Database, sessionId: string, adminId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM platform_sessions WHERE id = ?").bind(sessionId),
    buildPlatformAudit(db, { adminId, action: "auth.logout", entity: "platform_session", entityId: sessionId }),
  ]);
}

export async function bootstrapStatus(db: D1Database): Promise<{ needsBootstrap: boolean }> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM platform_admins").first<{ n: number }>();
  return { needsBootstrap: (row?.n ?? 0) === 0 };
}

/**
 * Creates the first super admin. Works only while the staff table is empty
 * AND the caller holds the deploy-time PLATFORM_BOOTSTRAP_TOKEN secret, so a
 * fresh deployment cannot be claimed by whoever finds it first.
 */
export async function bootstrap(
  db: D1Database,
  expectedToken: string | undefined,
  input: { token: string; email: string; name: string; password: string },
  ip: string | null
): Promise<{ id: string }> {
  if (!expectedToken || expectedToken.length < 16) fail("FORBIDDEN", "Bootstrap is disabled on this deployment");
  const a = new TextEncoder().encode(await sha256Hex(input.token));
  const b = new TextEncoder().encode(await sha256Hex(expectedToken));
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  if (diff !== 0) fail("FORBIDDEN", "Invalid bootstrap token");
  if (!(await bootstrapStatus(db)).needsBootstrap) fail("CONFLICT", "Platform already has administrators");
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO platform_admins (id, email, name, password_hash, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 'super_admin', 1, ?, ?)"
      )
      .bind(id, input.email.toLowerCase(), input.name, await hashPassword(input.password), now, now),
    buildPlatformAudit(db, { adminId: id, action: "admin.bootstrap", entity: "platform_admin", entityId: id, next: { email: input.email }, ip }),
  ]);
  return { id };
}

export async function getMe(db: D1Database, adminId: string) {
  const a = await db
    .prepare(`SELECT ${ADMIN_COLS} FROM platform_admins WHERE id = ?`)
    .bind(adminId)
    .first<AdminRow>();
  if (!a) fail("NOT_FOUND", "Admin not found");
  return { ...a, permissions: platformPermissionsFor(a.role) };
}

export async function listAdmins(db: D1Database): Promise<AdminRow[]> {
  const { results } = await db
    .prepare(`SELECT ${ADMIN_COLS} FROM platform_admins ORDER BY is_active DESC, created_at ASC`)
    .all<AdminRow>();
  return results ?? [];
}

async function activeSuperAdmins(db: D1Database): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM platform_admins WHERE role = 'super_admin' AND is_active = 1")
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export async function createAdmin(
  db: D1Database,
  input: { email: string; name: string; password: string; role: PlatformRole },
  actor: Actor
): Promise<{ id: string }> {
  const email = input.email.toLowerCase();
  const exists = await db.prepare("SELECT id FROM platform_admins WHERE email = ?").bind(email).first();
  if (exists) fail("CONFLICT", "Email already in use");
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO platform_admins (id, email, name, password_hash, role, is_active, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)"
      )
      .bind(id, email, input.name, await hashPassword(input.password), input.role, now, now, actor.id),
    buildPlatformAudit(db, {
      adminId: actor.id,
      action: "admin.create",
      entity: "platform_admin",
      entityId: id,
      next: { email, name: input.name, role: input.role },
      ip: actor.ip,
    }),
  ]);
  return { id };
}

export async function editAdmin(
  db: D1Database,
  id: string,
  patch: { name?: string; role?: PlatformRole },
  actor: Actor
): Promise<void> {
  const prev = await db.prepare("SELECT name, role, is_active FROM platform_admins WHERE id = ?").bind(id).first<{ name: string; role: string; is_active: number }>();
  if (!prev) fail("NOT_FOUND", "Admin not found");
  if (patch.role && id === actor.id) fail("CONFLICT", "You cannot change your own role");
  if (patch.role && prev.role === "super_admin" && patch.role !== "super_admin" && prev.is_active && (await activeSuperAdmins(db)) <= 1)
    fail("CONFLICT", "The platform must keep at least one active super admin");
  const name = patch.name ?? prev.name;
  const role = patch.role ?? prev.role;
  const stmts: D1PreparedStatement[] = [
    db.prepare("UPDATE platform_admins SET name = ?, role = ?, updated_at = ? WHERE id = ?").bind(name, role, Date.now(), id),
    buildPlatformAudit(db, {
      adminId: actor.id,
      action: "admin.edit",
      entity: "platform_admin",
      entityId: id,
      prev: { name: prev.name, role: prev.role },
      next: { name, role },
      ip: actor.ip,
    }),
  ];
  // A role change revokes live sessions so the new permission set applies immediately.
  if (patch.role && patch.role !== prev.role) stmts.push(db.prepare("DELETE FROM platform_sessions WHERE admin_id = ?").bind(id));
  await db.batch(stmts);
}

export async function setAdminActive(db: D1Database, id: string, active: boolean, reason: string, actor: Actor): Promise<void> {
  if (id === actor.id) fail("CONFLICT", "You cannot change your own activation");
  const prev = await db.prepare("SELECT role, is_active FROM platform_admins WHERE id = ?").bind(id).first<{ role: string; is_active: number }>();
  if (!prev) fail("NOT_FOUND", "Admin not found");
  if (!active && prev.role === "super_admin" && prev.is_active && (await activeSuperAdmins(db)) <= 1)
    fail("CONFLICT", "The platform must keep at least one active super admin");
  const stmts: D1PreparedStatement[] = [
    db
      .prepare("UPDATE platform_admins SET is_active = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?")
      .bind(active ? 1 : 0, Date.now(), id),
    buildPlatformAudit(db, {
      adminId: actor.id,
      action: active ? "admin.activate" : "admin.deactivate",
      entity: "platform_admin",
      entityId: id,
      prev: { is_active: prev.is_active },
      next: { is_active: active ? 1 : 0 },
      reason,
      ip: actor.ip,
    }),
  ];
  if (!active) stmts.push(db.prepare("DELETE FROM platform_sessions WHERE admin_id = ?").bind(id));
  await db.batch(stmts);
}

export async function resetAdminPassword(db: D1Database, id: string, newPassword: string, actor: Actor): Promise<void> {
  const prev = await db.prepare("SELECT id FROM platform_admins WHERE id = ?").bind(id).first();
  if (!prev) fail("NOT_FOUND", "Admin not found");
  await db.batch([
    db
      .prepare("UPDATE platform_admins SET password_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?")
      .bind(await hashPassword(newPassword), Date.now(), id),
    db.prepare("DELETE FROM platform_sessions WHERE admin_id = ?").bind(id),
    buildPlatformAudit(db, { adminId: actor.id, action: "admin.password_reset", entity: "platform_admin", entityId: id, ip: actor.ip }),
  ]);
}

export async function resetAdminMfa(db: D1Database, id: string, reason: string, actor: Actor): Promise<void> {
  const prev = await db.prepare("SELECT mfa_enabled FROM platform_admins WHERE id = ?").bind(id).first<{ mfa_enabled: number }>();
  if (!prev) fail("NOT_FOUND", "Admin not found");
  await db.batch([
    db.prepare("UPDATE platform_admins SET mfa_enabled = 0, mfa_secret = NULL, updated_at = ? WHERE id = ?").bind(Date.now(), id),
    db.prepare("DELETE FROM platform_sessions WHERE admin_id = ?").bind(id),
    buildPlatformAudit(db, { adminId: actor.id, action: "admin.mfa_reset", entity: "platform_admin", entityId: id, reason, ip: actor.ip }),
  ]);
}

export async function changeOwnPassword(db: D1Database, adminId: string, current: string, next: string, keepSessionId: string): Promise<void> {
  const a = await db.prepare("SELECT password_hash FROM platform_admins WHERE id = ?").bind(adminId).first<{ password_hash: string }>();
  if (!a) fail("NOT_FOUND", "Admin not found");
  if (!(await verifyPassword(current, a.password_hash))) fail("UNAUTHORIZED", "Current password is incorrect");
  await db.batch([
    db.prepare("UPDATE platform_admins SET password_hash = ?, updated_at = ? WHERE id = ?").bind(await hashPassword(next), Date.now(), adminId),
    // Every other device is signed out; this one stays.
    db.prepare("DELETE FROM platform_sessions WHERE admin_id = ? AND id != ?").bind(adminId, keepSessionId),
    buildPlatformAudit(db, { adminId, action: "auth.password_change", entity: "platform_admin", entityId: adminId }),
  ]);
}

/* ------------------------------------------------------------------ MFA enrolment */

export async function beginMfaEnrolment(db: D1Database, adminId: string, issuer: string): Promise<{ secret: string; otpauthUri: string }> {
  const a = await db.prepare("SELECT email, mfa_enabled FROM platform_admins WHERE id = ?").bind(adminId).first<{ email: string; mfa_enabled: number }>();
  if (!a) fail("NOT_FOUND", "Admin not found");
  if (a.mfa_enabled) fail("CONFLICT", "Two-factor is already enabled");
  const secret = base32Encode(crypto.getRandomValues(new Uint8Array(20)));
  await db.prepare("UPDATE platform_admins SET mfa_secret = ?, updated_at = ? WHERE id = ?").bind(secret, Date.now(), adminId).run();
  const label = encodeURIComponent(`${issuer}:${a.email}`);
  return {
    secret,
    otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`,
  };
}

export async function confirmMfaEnrolment(db: D1Database, adminId: string, code: string): Promise<void> {
  const a = await db.prepare("SELECT mfa_secret, mfa_enabled FROM platform_admins WHERE id = ?").bind(adminId).first<{ mfa_secret: string | null; mfa_enabled: number }>();
  if (!a?.mfa_secret) fail("CONFLICT", "Start enrolment first");
  if (a.mfa_enabled) fail("CONFLICT", "Two-factor is already enabled");
  if (!(await verifyTotp(a.mfa_secret, code, Date.now()))) fail("VALIDATION", "Invalid code — check your device clock");
  await db.batch([
    db.prepare("UPDATE platform_admins SET mfa_enabled = 1, updated_at = ? WHERE id = ?").bind(Date.now(), adminId),
    buildPlatformAudit(db, { adminId, action: "auth.mfa_enabled", entity: "platform_admin", entityId: adminId }),
  ]);
}

export async function disableOwnMfa(db: D1Database, adminId: string, code: string): Promise<void> {
  const a = await db.prepare("SELECT mfa_secret, mfa_enabled FROM platform_admins WHERE id = ?").bind(adminId).first<{ mfa_secret: string | null; mfa_enabled: number }>();
  if (!a?.mfa_enabled || !a.mfa_secret) fail("CONFLICT", "Two-factor is not enabled");
  if (!(await verifyTotp(a.mfa_secret, code, Date.now()))) fail("VALIDATION", "Invalid code");
  await db.batch([
    db.prepare("UPDATE platform_admins SET mfa_enabled = 0, mfa_secret = NULL, updated_at = ? WHERE id = ?").bind(Date.now(), adminId),
    buildPlatformAudit(db, { adminId, action: "auth.mfa_disabled", entity: "platform_admin", entityId: adminId }),
  ]);
}

/* ------------------------------------------------------------------ Sessions */

export async function listSessions(db: D1Database, adminId: string) {
  const { results } = await db
    .prepare(
      "SELECT id, ip, user_agent, mfa_pending, created_at, last_seen_at, expires_at FROM platform_sessions WHERE admin_id = ? AND expires_at > ? ORDER BY last_seen_at DESC"
    )
    .bind(adminId, Date.now())
    .all<{ id: string; ip: string | null; user_agent: string | null; mfa_pending: number; created_at: number; last_seen_at: number; expires_at: number }>();
  return results ?? [];
}

export async function revokeSession(db: D1Database, adminId: string, sessionId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM platform_sessions WHERE id = ? AND admin_id = ?").bind(sessionId, adminId),
    buildPlatformAudit(db, { adminId, action: "auth.session_revoke", entity: "platform_session", entityId: sessionId }),
  ]);
}

export async function revokeAllSessions(db: D1Database, targetId: string, actor: Actor): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM platform_sessions WHERE admin_id = ?").bind(targetId),
    buildPlatformAudit(db, { adminId: actor.id, action: "admin.sessions_revoke", entity: "platform_admin", entityId: targetId, ip: actor.ip }),
  ]);
}
