import type { Env } from "../../db/client";
import { SHOP_MIGRATIONS } from "../../db/shop-migrations";
import { LATEST_MIGRATION, routedCfClient, SCHEMA_MIGRATIONS_DDL, splitMigration, type CfClient, type CfQuery } from "../provision";
import { shopHandleFor } from "./ops";

/**
 * Fleet migrations: brings every shop database up to the bundled schema.
 *
 * Each shop records what it has applied in `schema_migrations`. One shop's
 * pending migrations go to D1 as a single atomic batch with foreign keys
 * deferred (see CfClient.applySql), so a failure rolls the shop back to its
 * previous version instead of leaving it half-migrated. The migration marker
 * is a plain INSERT in the same batch: two runners racing on one shop collide
 * on the primary key and the loser rolls back.
 */

/** Shops provisioned before tracking existed were created with every migration up to here. */
export const FLEET_BASELINE = "0047_rbac_three_roles.sql";

/** Cap per run so one cron tick stays well inside its time budget; the rest go next tick. */
const MAX_MIGRATED_PER_RUN = 25;

export type FleetShopResult = {
  tenantId: string;
  slug: string;
  status: "up_to_date" | "migrated" | "failed" | "unreachable" | "deferred";
  applied: string[];
  error?: string;
};

export type FleetRunSummary = {
  latest: string;
  shops: number;
  migrated: number;
  upToDate: number;
  failed: number;
  unreachable: number;
  deferred: number;
  results: FleetShopResult[];
};

/** Names already applied, or null when the shop predates tracking. */
export async function appliedMigrations(shop: D1Database): Promise<Set<string> | null> {
  try {
    const { results } = await shop.prepare("SELECT name FROM schema_migrations").all<{ name: string }>();
    return new Set((results ?? []).map((r) => r.name));
  } catch (e) {
    if (/no such table/i.test(e instanceof Error ? e.message : String(e))) return null;
    throw e;
  }
}

/** The statements that bring a shop from `applied` (null = untracked) to the bundled schema. */
export function planShopMigration(
  applied: Set<string> | null,
  now = Date.now(),
  migrations: ReadonlyArray<{ name: string; sql: string }> = SHOP_MIGRATIONS
): { pending: string[]; queries: CfQuery[] } {
  const queries: CfQuery[] = [{ sql: SCHEMA_MIGRATIONS_DDL }];
  const have = new Set(applied ?? []);
  if (applied === null) {
    for (const m of migrations) {
      if (m.name <= FLEET_BASELINE) {
        have.add(m.name);
        queries.push({ sql: "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)", params: [m.name, now] });
      }
    }
  }
  const pending: string[] = [];
  for (const m of migrations) {
    if (have.has(m.name)) continue;
    pending.push(m.name);
    for (const sql of splitMigration(m.sql)) queries.push({ sql });
    queries.push({ sql: "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)", params: [m.name, now] });
  }
  return { pending, queries };
}

function clientFor(env: Env): CfClient | null {
  return routedCfClient(env);
}

export async function runFleetMigrations(
  env: Env,
  pdb: D1Database,
  opts: { client?: CfClient; tenantId?: string; migrations?: ReadonlyArray<{ name: string; sql: string }> } = {}
): Promise<FleetRunSummary> {
  const cf = opts.client ?? clientFor(env);
  const { results } = await pdb
    .prepare(
      `SELECT t.id AS id, t.slug AS slug, d.d1_id AS d1_id
       FROM tenants t JOIN tenant_databases d ON d.tenant_id = t.id
       WHERE t.status != 'ARCHIVED' ${opts.tenantId ? "AND t.id = ?" : ""} ORDER BY t.created_at`
    )
    .bind(...(opts.tenantId ? [opts.tenantId] : []))
    .all<{ id: string; slug: string; d1_id: string }>();
  const latest = opts.migrations ? opts.migrations[opts.migrations.length - 1]!.name : LATEST_MIGRATION;
  const out: FleetShopResult[] = [];
  let migrated = 0;
  for (const t of results ?? []) {
    const record = async (r: FleetShopResult, version: string | null) => {
      out.push(r);
      await pdb
        .prepare("UPDATE tenant_databases SET schema_version = COALESCE(?, schema_version), schema_checked_at = ?, schema_error = ? WHERE tenant_id = ?")
        .bind(version, Date.now(), r.error ?? null, t.id)
        .run();
    };
    const base = { tenantId: t.id, slug: t.slug, applied: [] as string[] };
    const shop = shopHandleFor(env, t.d1_id);
    if (!shop || !cf) {
      await record({ ...base, status: "unreachable", error: "Shop database credentials are not configured" }, null);
      continue;
    }
    try {
      const applied = await appliedMigrations(shop);
      const plan = planShopMigration(applied, Date.now(), opts.migrations);
      if (plan.pending.length === 0 && applied !== null) {
        await record({ ...base, status: "up_to_date" }, latest);
        continue;
      }
      if (migrated >= MAX_MIGRATED_PER_RUN) {
        out.push({ ...base, status: "deferred" });
        continue;
      }
      await cf.applySql(t.d1_id, plan.queries, { atomic: true });
      migrated++;
      await record({ ...base, status: "migrated", applied: plan.pending }, latest);
    } catch (e) {
      await record({ ...base, status: "failed", error: e instanceof Error ? e.message : String(e) }, null);
    }
  }
  const count = (s: FleetShopResult["status"]) => out.filter((r) => r.status === s).length;
  return {
    latest,
    shops: out.length,
    migrated: count("migrated"),
    upToDate: count("up_to_date"),
    failed: count("failed"),
    unreachable: count("unreachable"),
    deferred: count("deferred"),
    results: out.filter((r) => r.status !== "up_to_date"),
  };
}

export async function fleetStatus(pdb: D1Database) {
  const { results } = await pdb
    .prepare(
      `SELECT t.id AS tenant_id, t.slug, t.name, t.status, d.d1_name, d.schema_version, d.schema_checked_at, d.schema_error
       FROM tenants t JOIN tenant_databases d ON d.tenant_id = t.id WHERE t.status != 'ARCHIVED' ORDER BY t.created_at`
    )
    .all<{ tenant_id: string; slug: string; name: string; status: string; d1_name: string; schema_version: string | null; schema_checked_at: number | null; schema_error: string | null }>();
  const shops = (results ?? []).map((r) => ({ ...r, behind: r.schema_version !== LATEST_MIGRATION }));
  return { latest: LATEST_MIGRATION, total: shops.length, behind: shops.filter((s) => s.behind).length, shops };
}
