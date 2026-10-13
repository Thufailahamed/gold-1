import { Hono } from "hono";
import {
  publicSignupSchema,
  SAAS_SLUG_BLOCKLIST,
  type PublicSignupInput,
} from "@goldos/shared";
import type { Env } from "../db/client";
import type { AppVariables } from "../middleware/auth";
import { writeAudit } from "../middleware/audit";
import { createSession, SESSION_ABSOLUTE_MS } from "../services/session";
import { sessionCookie } from "./auth";
import { getPlatformSettings } from "../platform/core";
import { createTenant } from "../platform/services/tenants";
import { resolveShopDb, tenantCookie, TenantResolveError } from "../platform/resolve";
import { checkPublicThrottle, resetPublicThrottle } from "../platform/publicThrottle";
import type { Provisioner } from "../platform/provision";
import { serviceError } from "./http";

export type { Provisioner };
export { resetPublicThrottle };

const SIGNUP_WINDOW_MS = 3600_000;
const SIGNUP_LIMIT = 5;

type PublicEnv = { Bindings: Env; Variables: AppVariables };

/**
 * Self-serve SaaS routes. The provisioner is injected (Task 4 provides the
 * Cloudflare implementation; tests use an in-memory fake), so signup,
 * trial clock and auto-login are testable without the network.
 */
export function createPublicRoutes(deps: { provision: Provisioner }) {
  return (
    new Hono<PublicEnv>()
      .get("/plans", async (c) => {
        if (!c.env.PLATFORM_DB) return c.json({ success: true, data: { plans: [] } }, 200);
        const { results } = await c.env.PLATFORM_DB.prepare(
          `SELECT code, name, description, price_monthly_cents, price_yearly_cents, currency,
                  trial_days, max_users, max_branches, max_products, max_storage_mb, features_json
           FROM plans WHERE is_public = 1 AND is_active = 1 ORDER BY sort_order`
        ).all<{
          code: string; name: string; description: string; price_monthly_cents: number; price_yearly_cents: number;
          currency: string; trial_days: number; max_users: number | null; max_branches: number | null;
          max_products: number | null; max_storage_mb: number | null; features_json: string;
        }>();
        return c.json(
          {
            success: true,
            data: {
              plans: (results ?? []).map((p) => ({
                ...p,
                features: JSON.parse(p.features_json) as string[],
                features_json: undefined,
              })),
            },
          },
          200
        );
      })
      .post("/signup", async (c) => {
        const pdb = c.env.PLATFORM_DB;
        if (!pdb)
          return c.json({ success: false, error: { code: "UNAVAILABLE", message: "Signup is not available on this deployment" } }, 503);
        const raw = (await c.req.json().catch(() => null)) as (Record<string, unknown> & { company_website?: unknown }) | null;
        // Honeypot: bots fill it, people never see it. Answer success and do nothing.
        if (raw && typeof raw.company_website === "string" && raw.company_website.trim() !== "") {
          const slug = typeof raw.slug === "string" && raw.slug ? raw.slug : "shop";
          return c.json({ success: true, data: { slug, loginUrl: `/login?shop=${slug}` } }, 201);
        }
        const ip = c.req.header("cf-connecting-ip") ?? undefined;
        if (!(await checkPublicThrottle(pdb, `signup:${ip ?? "unknown"}`, SIGNUP_LIMIT, SIGNUP_WINDOW_MS))) {
          c.header("Retry-After", "3600");
          return c.json({ success: false, error: { code: "RATE_LIMITED", message: "Too many signups. Try again in a little while." } }, 429);
        }
        const parsed = publicSignupSchema.safeParse(raw);
        if (!parsed.success)
          return c.json({ success: false, error: { code: "VALIDATION", message: "Check the shop details and try again" } }, 400);
        const input = parsed.data as PublicSignupInput;
        if ((SAAS_SLUG_BLOCKLIST as readonly string[]).includes(input.slug))
          return c.json({ success: false, error: { code: "VALIDATION", message: "That shop address is not available" } }, 400);
        const settings = await getPlatformSettings(pdb);
        if (!settings.signup_enabled)
          return c.json({ success: false, error: { code: "SIGNUP_DISABLED", message: "Signup is currently closed. Contact us for an account." } }, 503);
        const plan = await pdb.prepare("SELECT id FROM plans WHERE id = ? AND is_public = 1 AND is_active = 1").bind(input.planId).first<{ id: string }>();
        if (!plan)
          return c.json({ success: false, error: { code: "VALIDATION", message: "That plan is not available" } }, 400);
        const taken = await pdb.prepare("SELECT id FROM tenants WHERE slug = ?").bind(input.slug).first();
        // Generic wording: must not reveal the owner's email.
        if (taken)
          return c.json({ success: false, error: { code: "CONFLICT", message: "That shop address is taken" } }, 409);
        const actor = { id: "public-signup", ip: ip ?? null };
        let tenantId: string;
        try {
          ({ id: tenantId } = await createTenant(
            pdb,
            {
              name: input.shopName,
              slug: input.slug,
              ownerName: input.ownerName,
              ownerEmail: input.ownerEmail,
              phone: input.phone,
              country: input.country,
              currency: input.currency,
              timezone: input.timezone,
              region: "apac",
              planId: input.planId,
              interval: input.interval,
              tags: [],
            },
            actor
          ));
        } catch (e) {
          return serviceError(c, e);
        }
        const jobId = crypto.randomUUID();
        const now = Date.now();
        await pdb.prepare("INSERT INTO job_runs (id, job, trigger, status, started_at, triggered_by) VALUES (?, 'provision', 'manual', 'RUNNING', ?, ?)").bind(jobId, now, null).run();
        try {
          await deps.provision(c.env, pdb, {
            tenantId,
            slug: input.slug,
            shopName: input.shopName,
            ownerName: input.ownerName,
            ownerEmail: input.ownerEmail,
            password: input.password,
            country: input.country,
            currency: input.currency,
            timezone: input.timezone,
          });
        } catch (e) {
          await pdb.prepare("UPDATE job_runs SET status = 'FAILED', error = ?, finished_at = ? WHERE id = ?").bind(e instanceof Error ? e.message : String(e), Date.now(), jobId).run();
          await pdb.prepare("INSERT INTO tenant_notes (id, tenant_id, body, pinned, created_at, created_by) VALUES (?, ?, ?, 0, ?, NULL)").bind(crypto.randomUUID(), tenantId, `Provisioning failed: ${e instanceof Error ? e.message : String(e)}`, Date.now()).run();
          const code = (e as { code?: string } | null)?.code;
          const status = (e as { status?: number } | null)?.status ?? 503;
          return c.json({ success: false, error: { code: typeof code === "string" ? code : "PROVISIONING", message: "Your shop is being prepared. Try signing in shortly." } }, status as 503);
        }
        await pdb.prepare("UPDATE job_runs SET status = 'OK', finished_at = ? WHERE id = ?").bind(Date.now(), jobId).run();
        await pdb.prepare("INSERT INTO tenant_members (tenant_id, email, created_at) VALUES (?, ?, ?) ON CONFLICT (tenant_id, email) DO NOTHING").bind(tenantId, input.ownerEmail.toLowerCase(), Date.now()).run();
        // Auto-login as the owner in the brand-new shop.
        try {
          const { db } = await resolveShopDb(c.env, input.slug);
          const owner = await db.prepare("SELECT id, email, name FROM users WHERE email = ? AND is_active = 1").bind(input.ownerEmail.toLowerCase()).first<{ id: string; email: string; name: string }>();
          if (!owner) throw new Error("Owner user missing after provisioning");
          const session = await createSession(db, owner.id);
          await writeAudit(db, { userId: owner.id, action: "auth.signup", entity: "session", entityId: session.id, ip });
          c.header("Set-Cookie", sessionCookie(session.id, SESSION_ABSOLUTE_MS / 1000));
          c.header("Set-Cookie", tenantCookie(input.slug), { append: true });
          c.header("X-Session-Id", session.id);
          return c.json({ success: true, data: { slug: input.slug, loginUrl: `/login?shop=${input.slug}`, user: { id: owner.id, email: owner.email, name: owner.name }, token: session.id, sessionId: session.id } }, 201);
        } catch (e) {
          if (e instanceof TenantResolveError)
            return c.json({ success: false, error: { code: e.code, message: e.message } }, e.status as 503);
          throw e;
        }
      })
      .get("/provisioning/:slug", async (c) => {
        const pdb = c.env.PLATFORM_DB;
        if (!pdb) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
        const tenant = await pdb.prepare("SELECT id, slug FROM tenants WHERE slug = ?").bind(c.req.param("slug")).first<{ id: string; slug: string }>();
        if (!tenant) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
        const db = await pdb.prepare("SELECT d1_id FROM tenant_databases WHERE tenant_id = ?").bind(tenant.id).first();
        return c.json({ success: true, data: { status: db ? "ready" : "pending", tenantId: tenant.id } }, 200);
      })
  );
}
