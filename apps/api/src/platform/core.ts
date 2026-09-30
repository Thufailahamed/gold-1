import { PLATFORM_SETTING_DEFAULTS, type PlatformSettings } from "@goldos/shared";
import type { Env } from "../db/client";

export type PlatformVariables = {
  adminId: string;
  adminName: string;
  adminRole: string;
  platformPermissions: string[];
  sessionId: string;
  pdb: D1Database;
};

export type PlatformEnv = { Bindings: Env; Variables: PlatformVariables };

export function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomToken(bytes = 32): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ------------------------------------------------------------------ Audit */

export type PlatformAuditEntry = {
  adminId: string | null;
  action: string;
  entity: string;
  entityId: string;
  tenantId?: string | null;
  prev?: unknown;
  next?: unknown;
  reason?: string | null;
  ip?: string | null;
};

/** Built as a statement so it lands in the same atomic batch as the change it records. */
export function buildPlatformAudit(db: D1Database, e: PlatformAuditEntry): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO platform_audit_logs (id, admin_id, action, entity, entity_id, tenant_id, prev_json, new_json, reason, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      crypto.randomUUID(),
      e.adminId,
      e.action,
      e.entity,
      e.entityId,
      e.tenantId ?? null,
      e.prev === undefined ? null : JSON.stringify(e.prev),
      e.next === undefined ? null : JSON.stringify(e.next),
      e.reason ?? null,
      e.ip ?? null,
      Date.now()
    );
}

/** Who did it and from where — threaded from the route into every service write. */
export type Actor = { id: string; ip?: string | null };

/* ------------------------------------------------------------------ Counters */

/**
 * Allocates the next number with one atomic UPDATE … RETURNING, outside the
 * caller's batch: a failed write leaves a gap, which is fine; two writes
 * sharing a number is not.
 */
export async function nextNumber(db: D1Database, name: "INV" | "TKT", prefix: string): Promise<string> {
  const row = await db
    .prepare("UPDATE platform_counters SET next = next + 1 WHERE name = ? RETURNING next - 1 AS allocated")
    .bind(name)
    .first<{ allocated: number }>();
  if (!row) fail("INTERNAL", `Counter ${name} missing`);
  return `${prefix}-${String(row.allocated).padStart(6, "0")}`;
}

/* ------------------------------------------------------------------ Settings */

export async function getPlatformSettings(db: D1Database): Promise<PlatformSettings> {
  const { results } = await db
    .prepare("SELECT key, value_json FROM platform_settings")
    .all<{ key: string; value_json: string }>();
  const out: Record<string, unknown> = { ...PLATFORM_SETTING_DEFAULTS };
  for (const r of results ?? []) {
    if (!(r.key in PLATFORM_SETTING_DEFAULTS)) continue;
    try {
      out[r.key] = JSON.parse(r.value_json);
    } catch {
      // A corrupt row falls back to the default rather than breaking every read.
    }
  }
  return out as PlatformSettings;
}

export function parseJsonArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
