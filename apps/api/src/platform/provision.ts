import type { Env } from "../db/client";
import { SHOP_MIGRATIONS } from "../db/shop-migrations";
import { hashPassword } from "../services/hash";
import { loadTenant, purgeTenant } from "./services/tenants";
import type { Actor } from "./core";

/**
 * In-worker tenant provisioning: one D1 per shop, created over the Cloudflare
 * API. Migrations are bundled at build time (scripts/bundle-migrations.mjs);
 * roles, permissions, chart and settings come from them, so the per-shop seed
 * is only the owner, their owner grant, and the HQ branch.
 */
export type ProvisionInput = {
  tenantId: string;
  slug: string;
  shopName: string;
  ownerName: string;
  ownerEmail: string;
  /** Plaintext owner password — hashed into the seed, never stored. */
  password: string;
  country: string;
  currency: string;
  timezone: string;
};

export type ProvisionResult = { d1Id: string; d1Name: string };

export type Provisioner = (env: Env, pdb: D1Database, input: ProvisionInput) => Promise<ProvisionResult>;

export type CfQuery = { sql: string; params?: unknown[] };

export type CfClient = {
  createDatabase: (name: string) => Promise<{ id: string; name: string }>;
  applySql: (d1Id: string, queries: CfQuery[]) => Promise<void>;
  deleteDatabase: (d1Id: string) => Promise<void>;
};

const CF_BASE = "https://api.cloudflare.com/client/v4";

/** Live Cloudflare client. Tests inject a sqlite-backed fake instead. */
export function restCfClient(accountId: string, token: string, fetchFn?: typeof fetch): CfClient {
  // Same Workers rule as RestD1: never capture the global fetch.
  const call = fetchFn ?? ((...args: Parameters<typeof fetch>) => (globalThis.fetch as typeof fetch)(...args));
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const fail = async (res: Response, what: string): Promise<never> => {
    let message = `${what} failed`;
    try {
      const json = (await (res as Response).json()) as { success?: boolean; errors?: Array<{ message?: string; code?: number }> };
      const first = json.errors?.[0];
      const err = Object.assign(new Error(first?.message ?? message), { status: (res as Response).status, code: first?.code });
      throw err;
    } catch (e) {
      if (e instanceof Error && (e as { status?: number }).status !== undefined) throw e;
      throw new Error(message);
    }
  };
  return {
    async createDatabase(name: string) {
      const res = (await call(`${CF_BASE}/accounts/${accountId}/d1/database`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name }),
      })) as Response;
      if (!res.ok) await fail(res, "D1 create");
      const json = (await res.json()) as { success: boolean; result: { uuid: string; name: string } };
      if (!json.success) await fail(res, "D1 create");
      return { id: json.result.uuid, name: json.result.name };
    },
    async applySql(d1Id: string, queries: CfQuery[]) {
      // Batches go to /query with {batch: [...]} — there is no /batch path.
      for (const chunk of chunks(queries, 25)) {
        const res = (await call(`${CF_BASE}/accounts/${accountId}/d1/database/${d1Id}/query`, {
          method: "POST",
          headers,
          body: JSON.stringify({ batch: chunk.map((q) => ({ sql: q.sql, params: q.params ?? [] })) }),
        })) as Response;
        if (!res.ok) await fail(res, "D1 migrate");
        const json = (await res.json()) as { success: boolean };
        if (!json.success) await fail(res, "D1 migrate");
      }
    },
    async deleteDatabase(d1Id: string) {
      const res = (await call(`${CF_BASE}/accounts/${accountId}/d1/database/${d1Id}`, {
        method: "DELETE",
        headers,
      })) as Response;
      if (!res.ok && res.status !== 404) await fail(res, "D1 delete");
    },
  };
}

/**
 * SQLite files hold many statements; the query API wants one per call.
 * Splits on semicolons outside `--` line comments and `'...'` literals
 * (migrations contain both — e.g. 0015's comments — but no triggers/views,
 * verified by the bundle test applying every statement).
 */
export function splitMigration(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      cur += sql.slice(i, end === -1 ? n : end);
      i = end === -1 ? n : end;
      continue;
    }
    if (ch === "'") {
      const end = sql.indexOf("'", i + 1);
      if (end === -1) {
        cur += sql.slice(i);
        break;
      }
      // '' is an escaped quote inside the literal.
      let j = end;
      while (sql[j + 1] === "'") {
        const next = sql.indexOf("'", j + 2);
        if (next === -1) break;
        j = next;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === ";") {
      if (cur.trim().length > 0) out.push(cur.trim());
      cur = "";
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  if (cur.trim().length > 0) out.push(cur.trim());
  return out;
}

function isNameClash(e: unknown): boolean {
  const status = (e as { status?: number } | null)?.status;
  if (status === 409) return true;
  return /already exists|exists|duplicate|conflict/i.test(e instanceof Error ? e.message : String(e));
}

export async function provisionShop(
  env: Env,
  pdb: D1Database,
  input: ProvisionInput,
  client?: CfClient
): Promise<ProvisionResult> {
  const cf =
    client ??
    ((!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_D1_API_TOKEN)
      ? (() => {
          throw Object.assign(new Error("Provisioning is not configured"), { code: "PROVISIONING", status: 503 });
        })()
      : restCfClient(env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_D1_API_TOKEN));
  const shortid = () => crypto.randomUUID().slice(0, 8);
  let name = `goldos-${input.slug}-${shortid()}`;
  let created: { id: string; name: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      created = await cf.createDatabase(name);
      break;
    } catch (e) {
      if (isNameClash(e) && attempt < 2) {
        name = `goldos-${input.slug}-${shortid()}`;
        continue;
      }
      throw e;
    }
  }
  if (!created) throw new Error("D1 create failed");
  try {
    const migrationQueries: CfQuery[] = SHOP_MIGRATIONS.flatMap((m) =>
      splitMigration(m.sql).map((sql) => ({ sql }))
    );
    await cf.applySql(created.id, migrationQueries);
    const now = Date.now();
    const ownerId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    const hash = await hashPassword(input.password);
    const email = input.ownerEmail.toLowerCase();
    await cf.applySql(created.id, [
      { sql: "INSERT INTO users (id, email, name, password_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)", params: [ownerId, email, input.ownerName, hash, now, now] },
      { sql: "INSERT INTO user_roles (user_id, role_id) VALUES (?, 'owner')", params: [ownerId] },
      { sql: "INSERT INTO branches (id, name, code, is_active, created_at, created_by) VALUES (?, 'Main Branch', 'MAIN', 1, ?, ?)", params: [branchId, now, ownerId] },
      { sql: "INSERT INTO branch_members (user_id, branch_id) VALUES (?, ?)", params: [ownerId, branchId] },
    ]);
    await pdb.batch([
      pdb.prepare("INSERT INTO tenant_databases (tenant_id, d1_id, d1_name, created_at) VALUES (?, ?, ?, ?)").bind(input.tenantId, created.id, created.name, Date.now()),
      pdb.prepare("INSERT INTO tenant_members (tenant_id, email, created_at) VALUES (?, ?, ?) ON CONFLICT (tenant_id, email) DO NOTHING").bind(input.tenantId, input.ownerEmail.toLowerCase(), Date.now()),
      pdb.prepare("UPDATE tenants SET data_plane = ?, updated_at = ? WHERE id = ?").bind(created.id, Date.now(), input.tenantId),
    ]);
  } catch (e) {
    // Half-migrated databases are unsafe to resume (migrations are not
    // idempotent), and a database without bookkeeping rows is orphaned
    // either way: remove it so a retry starts clean.
    await cf.deleteDatabase(created.id).catch(() => undefined);
    throw e;
  }
  return { d1Id: created.id, d1Name: created.name };
}

/**
 * Staff retry after a failed provisioning: destroys whatever half exists and
 * provisions fresh. Needs a temp password because the original is never stored.
 */
export async function retryProvision(
  env: Env,
  pdb: D1Database,
  tenantId: string,
  creds: { ownerEmail: string; tempPassword: string },
  client?: CfClient
): Promise<ProvisionResult> {
  const tenant = await loadTenant(pdb, tenantId);
  const existing = await pdb.prepare("SELECT d1_id FROM tenant_databases WHERE tenant_id = ?").bind(tenantId).first<{ d1_id: string }>();
  // A live shop must never be wiped through this endpoint: failed provisions
  // leave no mapping row, so a present row on an ACTIVE account means a shop
  // that serves traffic. Suspend first (reversible) if its database is gone.
  if (existing && tenant.status === "ACTIVE") {
    throw Object.assign(new Error("This shop already has a database. Suspend the account first if its database is actually gone, then retry."), { code: "CONFLICT", status: 409 });
  }
  const cf =
    client ??
    ((!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_D1_API_TOKEN)
      ? (() => {
          throw Object.assign(new Error("Provisioning is not configured"), { code: "PROVISIONING", status: 503 });
        })()
      : restCfClient(env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_D1_API_TOKEN));
  const old = existing;
  if (old) {
    await cf.deleteDatabase(old.d1_id).catch(() => undefined);
    await pdb.prepare("DELETE FROM tenant_databases WHERE tenant_id = ?").bind(tenantId).run();
  }
  return provisionShop(env, pdb, {
    tenantId,
    slug: tenant.slug,
    shopName: tenant.name,
    ownerName: tenant.owner_name,
    ownerEmail: creds.ownerEmail,
    password: creds.tempPassword,
    country: tenant.country,
    currency: tenant.currency,
    timezone: tenant.timezone,
  }, cf);
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Full erasure of an ARCHIVED account: the shop D1 is deleted first (so a
 * failed delete aborts before any row is touched), then the control-plane
 * rows via purgeTenant. Accounts without a shop database only purge rows.
 */
export async function purgeTenantWithDatabase(
  env: Env,
  pdb: D1Database,
  tenantId: string,
  reason: string,
  actor: Actor,
  client?: CfClient
): Promise<{ purged: string; d1Deleted: boolean }> {
  const mapping = await pdb.prepare("SELECT d1_id FROM tenant_databases WHERE tenant_id = ?").bind(tenantId).first<{ d1_id: string }>();
  let d1Deleted = false;
  if (mapping) {
    const cf =
      client ??
      ((!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_D1_API_TOKEN)
        ? (() => {
            throw Object.assign(new Error("Shop database credentials are not configured; delete the D1 in the Cloudflare dashboard, remove its tenant_databases row, and purge again"), { code: "CONFLICT", status: 409 });
          })()
        : restCfClient(env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_D1_API_TOKEN));
    await cf.deleteDatabase(mapping.d1_id);
    d1Deleted = true;
  }
  await purgeTenant(pdb, tenantId, reason, actor);
  return { purged: tenantId, d1Deleted };
}
