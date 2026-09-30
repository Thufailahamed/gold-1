import { Hono } from "hono";
import type { Env } from "../db/client";
import { requirePlatformDb } from "./auth";
import type { PlatformEnv } from "./core";
import { platformAuth } from "./routes/auth";
import { platformBilling } from "./routes/billing";
import { platformAnnouncements, platformFlags, platformPlans } from "./routes/catalog";
import { platformAudit, platformOverviewRoutes, platformSystem, platformTeam } from "./routes/admin";
import { platformSupport } from "./routes/support";
import { platformTenants } from "./routes/tenants";
import { runBillingCycle } from "./services/billing";
import { collectAllUsage, housekeeping, runJob } from "./services/ops";

/** The control-plane API, mounted at /platform/v1. */
export const platform = new Hono<PlatformEnv>()
  .use(requirePlatformDb)
  .get("/", (c) => c.json({ success: true, data: { service: "goldos-platform", version: "v1" } }, 200))
  .route("/auth", platformAuth)
  .route("/overview", platformOverviewRoutes)
  .route("/tenants", platformTenants)
  .route("/billing", platformBilling)
  .route("/plans", platformPlans)
  .route("/flags", platformFlags)
  .route("/announcements", platformAnnouncements)
  .route("/support", platformSupport)
  .route("/team", platformTeam)
  .route("/audit", platformAudit)
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
      ];
  for (const job of jobs) {
    try {
      await job();
    } catch (e) {
      console.error("platform job failed", e);
    }
  }
}
