import { DAY_MS, mrrMovement } from "@goldos/shared";
import { mrrOf, type SubRow } from "./subcore";

function monthKey(at: number): string {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function lastMonths(n: number, now: number): string[] {
  const d = new Date(now);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(monthKey(m.getTime()));
  }
  return out;
}

/**
 * Everything the platform dashboard needs, in one call. MRR comes from the
 * live subscriptions table; the trend is rebuilt from the append-only event
 * deltas, anchored so the final month equals the live figure exactly.
 */
export async function platformOverview(db: D1Database, now = Date.now()) {
  const { results: subs } = await db
    .prepare(
      `SELECT s.*, p.name AS plan_name, p.code AS plan_code, t.status AS tenant_status
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN tenants t ON t.id = s.tenant_id`
    )
    .all<SubRow & { plan_name: string; plan_code: string; tenant_status: string }>();
  const all = subs ?? [];
  const mrr = all.reduce((sum, s) => sum + mrrOf(s), 0);
  const paying = all.filter((s) => mrrOf(s) > 0).length;

  const { results: tenantStatus } = await db
    .prepare("SELECT status, COUNT(*) AS n FROM tenants GROUP BY status")
    .all<{ status: string; n: number }>();
  const tenantCounts = Object.fromEntries((tenantStatus ?? []).map((r) => [r.status, r.n]));
  const subCounts: Record<string, number> = {};
  for (const s of all) subCounts[s.status] = (subCounts[s.status] ?? 0) + 1;

  const since30 = now - 30 * DAY_MS;
  const newTenants = await db.prepare("SELECT COUNT(*) AS n FROM tenants WHERE created_at >= ?").bind(since30).first<{ n: number }>();
  const { results: events30 } = await db
    .prepare("SELECT type, mrr_before_cents, mrr_after_cents FROM subscription_events WHERE created_at >= ?")
    .bind(since30)
    .all<{ type: string; mrr_before_cents: number; mrr_after_cents: number }>();
  const movement = { new: 0, expansion: 0, contraction: 0, churn: 0 };
  let churnedAccounts = 0;
  for (const e of events30 ?? []) {
    const kind = mrrMovement(e.mrr_before_cents, e.mrr_after_cents);
    if (kind === "none") continue;
    movement[kind] += Math.abs(e.mrr_after_cents - e.mrr_before_cents);
    if (e.type === "CANCELED") churnedAccounts++;
  }
  // Churn rate against the MRR at the start of the window.
  const netNew = movement.new + movement.expansion - movement.contraction - movement.churn;
  const startMrr = mrr - netNew;
  const revenueChurnPct = startMrr > 0 ? Math.round(((movement.churn + movement.contraction) / startMrr) * 1000) / 10 : 0;

  // MRR trend: walk back from today's live MRR by each month's net delta.
  const months = lastMonths(12, now);
  const since12 = Date.UTC(Number(months[0]!.slice(0, 4)), Number(months[0]!.slice(5)) - 1, 1);
  const { results: deltas } = await db
    .prepare("SELECT created_at, mrr_delta_cents FROM subscription_events WHERE created_at >= ?")
    .bind(since12)
    .all<{ created_at: number; mrr_delta_cents: number }>();
  const byMonth = new Map<string, number>();
  for (const d of deltas ?? []) byMonth.set(monthKey(d.created_at), (byMonth.get(monthKey(d.created_at)) ?? 0) + d.mrr_delta_cents);
  const trend: Array<{ month: string; mrr_cents: number; net_new_cents: number }> = [];
  let running = mrr;
  for (let i = months.length - 1; i >= 0; i--) {
    const m = months[i]!;
    const delta = byMonth.get(m) ?? 0;
    trend.unshift({ month: m, mrr_cents: running, net_new_cents: delta });
    running -= delta;
  }

  const { results: collected } = await db
    .prepare("SELECT received_at, amount_cents FROM payments WHERE received_at >= ?")
    .bind(since12)
    .all<{ received_at: number; amount_cents: number }>();
  const cashByMonth = new Map<string, number>();
  for (const p of collected ?? []) cashByMonth.set(monthKey(p.received_at), (cashByMonth.get(monthKey(p.received_at)) ?? 0) + p.amount_cents);
  const cash = months.map((m) => ({ month: m, collected_cents: cashByMonth.get(m) ?? 0 }));

  const receivables = await db
    .prepare(
      `SELECT COALESCE(SUM(total_cents - amount_paid_cents), 0) AS open_cents,
              COALESCE(SUM(CASE WHEN due_at < ? THEN total_cents - amount_paid_cents ELSE 0 END), 0) AS overdue_cents,
              COALESCE(SUM(CASE WHEN due_at < ? THEN 1 ELSE 0 END), 0) AS overdue_count
       FROM invoices WHERE status = 'OPEN'`
    )
    .bind(now, now)
    .first<{ open_cents: number; overdue_cents: number; overdue_count: number }>();
  const collected30 = (collected ?? []).filter((p) => p.received_at >= since30).reduce((s, p) => s + p.amount_cents, 0);

  const planMix = new Map<string, { plan: string; code: string; accounts: number; mrr_cents: number }>();
  for (const s of all) {
    if (s.status === "CANCELED") continue;
    const cur = planMix.get(s.plan_id) ?? { plan: s.plan_name, code: s.plan_code, accounts: 0, mrr_cents: 0 };
    cur.accounts++;
    cur.mrr_cents += mrrOf(s);
    planMix.set(s.plan_id, cur);
  }

  const { results: trialsEnding } = await db
    .prepare(
      `SELECT t.id, t.name, t.slug, s.trial_ends_at, p.name AS plan_name FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id JOIN plans p ON p.id = s.plan_id
       WHERE s.status = 'TRIALING' AND s.trial_ends_at <= ? ORDER BY s.trial_ends_at LIMIT 8`
    )
    .bind(now + 7 * DAY_MS)
    .all();
  const { results: atRisk } = await db
    .prepare(
      `SELECT t.id, t.name, t.slug, t.status, s.status AS sub_status, s.past_due_since,
              COALESCE((SELECT SUM(i.total_cents - i.amount_paid_cents) FROM invoices i WHERE i.tenant_id = t.id AND i.status = 'OPEN'), 0) AS open_cents
       FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id
       WHERE s.status = 'PAST_DUE' OR (t.status = 'SUSPENDED') OR s.cancel_at_period_end = 1
       ORDER BY open_cents DESC LIMIT 8`
    )
    .all();
  const tickets = await db
    .prepare(
      `SELECT SUM(CASE WHEN status IN ('OPEN','PENDING') THEN 1 ELSE 0 END) AS open,
              SUM(CASE WHEN status = 'OPEN' AND priority IN ('HIGH','URGENT') THEN 1 ELSE 0 END) AS urgent,
              SUM(CASE WHEN status = 'OPEN' AND first_response_at IS NULL THEN 1 ELSE 0 END) AS unanswered
       FROM support_tickets`
    )
    .first<{ open: number | null; urgent: number | null; unanswered: number | null }>();
  const { results: activity } = await db
    .prepare(
      `SELECT l.id, l.action, l.entity, l.entity_id, l.tenant_id, l.reason, l.created_at, a.name AS admin_name, t.name AS tenant_name
       FROM platform_audit_logs l LEFT JOIN platform_admins a ON a.id = l.admin_id LEFT JOIN tenants t ON t.id = l.tenant_id
       WHERE l.action NOT LIKE 'auth.%' ORDER BY l.created_at DESC LIMIT 12`
    )
    .all();
  const { results: signups } = await db
    .prepare("SELECT created_at FROM tenants WHERE created_at >= ?")
    .bind(since12)
    .all<{ created_at: number }>();
  const signupsByMonth = new Map<string, number>();
  for (const s of signups ?? []) signupsByMonth.set(monthKey(s.created_at), (signupsByMonth.get(monthKey(s.created_at)) ?? 0) + 1);

  return {
    kpis: {
      mrr_cents: mrr,
      arr_cents: mrr * 12,
      arpa_cents: paying > 0 ? Math.round(mrr / paying) : 0,
      paying_accounts: paying,
      total_accounts: all.length,
      new_accounts_30d: newTenants?.n ?? 0,
      churned_accounts_30d: churnedAccounts,
      revenue_churn_pct_30d: revenueChurnPct,
      net_new_mrr_30d: netNew,
      collected_30d_cents: collected30,
      open_receivables_cents: receivables?.open_cents ?? 0,
      overdue_cents: receivables?.overdue_cents ?? 0,
      overdue_invoices: receivables?.overdue_count ?? 0,
      open_tickets: tickets?.open ?? 0,
      urgent_tickets: tickets?.urgent ?? 0,
      unanswered_tickets: tickets?.unanswered ?? 0,
    },
    tenantCounts,
    subCounts,
    movement30d: movement,
    trend: trend.map((t, i) => ({ ...t, collected_cents: cash[i]?.collected_cents ?? 0, signups: signupsByMonth.get(t.month) ?? 0 })),
    planMix: [...planMix.values()].sort((a, b) => b.mrr_cents - a.mrr_cents),
    trialsEnding: trialsEnding ?? [],
    atRisk: atRisk ?? [],
    activity: activity ?? [],
  };
}
