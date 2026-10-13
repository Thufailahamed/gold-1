import { createMiddleware } from "hono/factory";
import type { Env } from "../db/client";
import { RestD1 } from "../db/rest-d1";
import type { AppVariables } from "../middleware/auth";

/** Cookie (and header/query fallback) naming the shop on a single-domain deploy. */
export const TENANT_COOKIE = "goldos_tenant";

/** Readable picker cookie. Matches the session cookie's cross-site posture. */
export function tenantCookie(slug: string): string {
  return `${TENANT_COOKIE}=${slug}; Path=/; Max-Age=2592000; Secure; SameSite=None`;
}

export type ResolvedTenant = {
  id: string;
  slug: string;
  status: string;
  suspended_reason: string | null;
};

/** Thrown when a workspace cannot serve requests; middleware turns it into JSON. */
export class TenantResolveError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type SlugSource = {
  req: {
    header: (name: string) => string | undefined;
    query?: (key: string) => string | undefined;
  };
};

const COOKIE_RE = /(?:^|;\s*)goldos_tenant=([^;]+)/;

/** Cookie first, then `X-Shop-Slug` header, then `?shop=`. */
export function extractTenantSlug(c: SlugSource): string | undefined {
  const cookie = c.req.header("cookie");
  if (cookie) {
    const matches = [...cookie.matchAll(new RegExp(COOKIE_RE.source, "g"))];
    const last = matches[matches.length - 1]?.[1]?.trim();
    if (last) return last;
  }
  const header = c.req.header("x-shop-slug")?.trim();
  if (header) return header;
  try {
    const q = c.req.query?.("shop")?.trim();
    if (q) return q;
  } catch {
    // Query parsing is best-effort outside a real request.
  }
  return undefined;
}

type CacheEntry = { at: number; tenant: ResolvedTenant | null; d1Id: string | null };
const RESOLVE_TTL_MS = 30_000;
const resolveCache = new Map<string, CacheEntry>();
const handleCache = new Map<string, D1Database>();

/** For tests: drop the per-isolate resolution and handle caches. */
export function resetResolveCache(): void {
  resolveCache.clear();
  handleCache.clear();
}

/**
 * Maps one workspace slug (or tenant id) to its shop database. Tenant DBs are
 * reached over the D1 REST API; tests inject handles via the `TEST_HANDLES`
 * env seam (d1_id → handle) so no test touches the network. Unmanaged
 * deploys (no PLATFORM_DB) resolve to the single `DB` with no tenant.
 */
export async function resolveShopDb(
  env: Env,
  slugOrId: string
): Promise<{ db: D1Database; tenant: ResolvedTenant | null }> {
  if (!env.PLATFORM_DB) return { db: env.DB, tenant: null };
  const key = slugOrId.trim().toLowerCase();
  const now = Date.now();
  const cached = resolveCache.get(key);
  let tenant: ResolvedTenant | null;
  let d1Id: string | null;
  if (cached && now - cached.at < RESOLVE_TTL_MS) {
    ({ tenant, d1Id } = { tenant: cached.tenant, d1Id: cached.d1Id });
  } else {
    tenant = await env.PLATFORM_DB.prepare(
      "SELECT id, slug, status, suspended_reason FROM tenants WHERE slug = ? OR id = ?"
    )
      .bind(slugOrId, slugOrId)
      .first<ResolvedTenant>();
    if (!tenant) throw new TenantResolveError(404, "NOT_FOUND", "Unknown workspace");
    if (tenant.status === "SUSPENDED")
      throw new TenantResolveError(403, "TENANT_SUSPENDED", "This workspace is suspended. Contact support to restore access.");
    if (tenant.status === "ARCHIVED")
      throw new TenantResolveError(403, "TENANT_ARCHIVED", "This workspace has been closed.");
    d1Id = (
      await env.PLATFORM_DB.prepare("SELECT d1_id FROM tenant_databases WHERE tenant_id = ?")
        .bind(tenant.id)
        .first<{ d1_id: string }>()
    )?.d1_id ?? null;
    resolveCache.set(key, { at: now, tenant, d1Id });
  }
  if (!d1Id) throw new TenantResolveError(503, "PROVISIONING", "This workspace is being prepared. Try again in a minute.");
  const injected = (env as unknown as { TEST_HANDLES?: Record<string, D1Database> }).TEST_HANDLES?.[d1Id];
  if (injected) return { db: injected, tenant };
  const cachedHandle = handleCache.get(d1Id);
  if (cachedHandle) return { db: cachedHandle, tenant };
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_D1_API_TOKEN)
    throw new TenantResolveError(503, "PROVISIONING", "This workspace is being prepared. Try again in a minute.");
  const handle = new RestD1(env.CLOUDFLARE_ACCOUNT_ID, d1Id, env.CLOUDFLARE_D1_API_TOKEN) as unknown as D1Database;
  handleCache.set(d1Id, handle);
  return { db: handle, tenant };
}

/**
 * Per-request tenant scope for every `/api/v1/*` call. Sets `tenantId`,
 * `tenantSlug` and `shopDb`; downstream `requireAuth`, `tenantGate` and plan
 * limits read these instead of the deploy-pinned `TENANT_ID`. Never blocks:
 * requests without a workspace resolve to the legacy default (unmanaged
 * deploys, or old pinned deploys via `TENANT_ID`); only an explicit slug
 * that cannot serve fails here.
 */
export const resolveTenant = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(async (c, next) => {
  if (!c.env.PLATFORM_DB) {
    c.set("shopDb", c.env.DB);
    return next();
  }
  const slug = extractTenantSlug(c);
  if (!slug) {
    // Legacy pinned deploy: the worker serves one account from the default DB.
    if (c.env.TENANT_ID) {
      c.set("tenantId", c.env.TENANT_ID);
      c.set("shopDb", c.env.DB);
    } else {
      c.set("shopDb", c.env.DB);
    }
    return next();
  }
  try {
    const { db, tenant } = await resolveShopDb(c.env, slug);
    c.set("tenantId", tenant?.id);
    c.set("tenantSlug", tenant?.slug ?? slug);
    c.set("shopDb", db);
  } catch (e) {
    if (e instanceof TenantResolveError)
      return c.json({ success: false, error: { code: e.code, message: e.message } }, e.status as 401);
    throw e;
  }
  await next();
});

/** The shop database for this request — resolved per tenant, legacy DB as fallback. */
export function getShopDb(c: { get: (key: any) => unknown; env: Env }): D1Database {
  const db = c.get("shopDb");
  return isD1Like(db) ? (db as D1Database) : c.env.DB;
}

/** The resolved platform tenant id, if this request is tenant-scoped. */
export function getTenantId(c: { get: (key: any) => unknown; env: Env }): string | undefined {
  const id = c.get("tenantId");
  if (typeof id === "string" && id) return id;
  return c.env.TENANT_ID;
}

function isD1Like(x: unknown): boolean {
  if (typeof x === "object" && x !== null) {
    const p = (x as { prepare?: unknown }).prepare;
    if (typeof p === "function") return true;
    // RestD1 instances carry the same surface via prototype.
    if (x instanceof RestD1) return true;
  }
  return false;
}
