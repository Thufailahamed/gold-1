import { Hono } from "hono";
import type { Env } from "../db/client";
import { requirePlatformDb } from "./auth";
import type { PlatformEnv } from "./core";
import { platformAuth } from "./routes/auth";
import { platformBilling } from "./routes/billing";
import { platformAnnouncements, platformFlags, platformPlans } from "./routes/catalog";
import { platformAudit, platformImpersonations, platformOverviewRoutes, platformSystem, platformTeam } from "./routes/admin";
import { platformSearch } from "./routes/search";
import { platformSupport } from "./routes/support";
import { platformTenants } from "./routes/tenants";
import { runBillingCycle } from "./services/billing";
import { runFleetMigrations } from "./services/fleet";
import { fleetStatus } from "./services/fleet";
import { collectAllUsage, housekeeping, runJob } from "./services/ops";

function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** The control-plane API, mounted at /platform/v1. */
export const platform = new Hono<PlatformEnv>()
  .use(requirePlatformDb)
  .get("/", (c) => c.json({ success: true, data: { service: "goldos-platform", version: "v1" } }, 200))
  // Deploy-time fleet migration for scripts/migrate-all.sh: authenticated by
  // the FLEET_MIGRATE_TOKEN secret instead of an admin session. Unset secret =
  // endpoint disabled. Idempotent, and each shop migrates atomically.
  .post("/migrate-fleet", async (c) => {
    const want = c.env.FLEET_MIGRATE_TOKEN;
    const got = c.req.header("x-migrate-token") ?? "";
    if (!want || want.length < 24 || !timingSafeEqual(got, want))
      return c.json({ success: false, error: { code: "UNAUTHORIZED", message: "Not allowed" } }, 401);
    const pdb = c.get("pdb");
    const result = await runJob(pdb, "migrate_fleet", "manual", null, () => runFleetMigrations(c.env, pdb));
    return c.json({ success: true, data: { result, fleet: await fleetStatus(pdb) } }, 200);
  })
  .route("/auth", platformAuth)
  .route("/overview", platformOverviewRoutes)
  .route("/search", platformSearch)
  .route("/tenants", platformTenants)
  .route("/billing", platformBilling)
  .route("/plans", platformPlans)
  .route("/flags", platformFlags)
  .route("/announcements", platformAnnouncements)
  .route("/support", platformSupport)
  .route("/team", platformTeam)
  .route("/audit", platformAudit)
  .route("/impersonations", platformImpersonations)
  .route("/system", platformSystem);

/**
 * Cron entry. wrangler.toml schedules an hourly tick (billing + housekeeping)
 * and a nightly one (usage collection); the cron string tells them apart.
 * Each job records itself in job_runs, and one failing does not skip the rest.
 */
export async function platformScheduled(event: { cron: string }, env: Env): Promise<void> {
  const pdb = env.PLATFORM_DB;
  if (!pdb) return;
  const nightly = event.cron === "15 2 * * *";
  const jobs: Array<() => Promise<unknown>> = nightly
    ? [() => runJob(pdb, "collect_usage", "cron", null, () => collectAllUsage(pdb, env))]
    : [
        () => runJob(pdb, "billing_cycle", "cron", null, () => runBillingCycle(pdb, null)),
        () => runJob(pdb, "housekeeping", "cron", null, () => housekeeping(pdb)),
        () => runJob(pdb, "migrate_fleet", "cron", null, () => runFleetMigrations(env, pdb)),
      ];
  for (const job of jobs) {
    try {
      await job();
    } catch (e) {
      console.error("platform job failed", e);
    }
  }
}
