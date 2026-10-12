import type { Env } from "../db/client";
import { formatLkr } from "../assistant/present";
import { localDayBoundsMs, shopClock } from "../assistant/time";
import { tzOffsetMinutes } from "../services/busdate";
import { listUnclosedDays } from "../services/dayreports";
import { expenseThresholdsFor } from "../services/expenses";
import { listReceivables } from "../services/receipts";
import { getSetting } from "../services/settings";

/**
 * The daily brief. Every finding is computed from the books by code, with its
 * figures already formatted; the model only turns the list into a few plain
 * sentences. If it is unavailable, or its wording contains a number that is
 * not in the findings, the brief falls back to a rule-written summary, so a
 * brief never states a figure the ledger did not produce.
 */

export type Severity = "alert" | "warn" | "info";

export type Finding = {
  id: string;
  severity: Severity;
  branchId: string;
  branch: string;
  title: string;
  detail: string;
};

export type BranchDay = { branchId: string; branch: string; salesCents: number; invoices: number; expensesCents: number };

export type BriefData = { date: string; findings: Finding[]; days: BranchDay[] };

export type Brief = BriefData & { summary: string; model: string; source: "cron" | "manual"; generatedAt: number };

const all = async <T>(db: D1Database, sql: string, vals: unknown[]): Promise<T[]> =>
  ((await db.prepare(sql).bind(...vals).all<T>()).results ?? []) as T[];

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Compute the day's findings for every active branch. No model involved. */
export async function gatherBrief(env: Env, now: number): Promise<BriefData> {
  const db = env.DB;
  const offset = await tzOffsetMinutes(db);
  const today = shopClock(now, offset).date;
  const bounds = localDayBoundsMs(today, today, offset);
  const trailing = localDayBoundsMs(addDays(today, -30), addDays(today, -1), offset);
  const [branches, thresholds] = await Promise.all([
    all<{ id: string; name: string }>(db, "SELECT id, name FROM branches WHERE is_active = 1 ORDER BY name", []),
    expenseThresholdsFor(db),
  ]);

  const findings: Finding[] = [];
  const days: BranchDay[] = [];

  for (const b of branches) {
    const add = (f: Omit<Finding, "branchId" | "branch">) => findings.push({ ...f, branchId: b.id, branch: b.name });

    const [sales, trail, expenseToday, closing, unclosed, receivables, pending] = await Promise.all([
      db
        .prepare(
          `SELECT
             SUM(CASE WHEN status <> 'VOID' THEN 1 ELSE 0 END) AS invoices,
             SUM(CASE WHEN status = 'VOID' THEN 1 ELSE 0 END) AS voided,
             COALESCE(SUM(CASE WHEN status <> 'VOID' THEN total_cents ELSE 0 END), 0) AS gross,
             COALESCE(SUM(CASE WHEN status <> 'VOID' THEN discount_cents ELSE 0 END), 0) AS discount
           FROM sales_invoices WHERE branch_id = ? AND created_at >= ? AND created_at <= ?`
        )
        .bind(b.id, bounds.from, bounds.to)
        .first<{ invoices: number | null; voided: number | null; gross: number; discount: number }>(),
      db
        .prepare(
          `SELECT COALESCE(SUM(total_cents), 0) AS gross FROM sales_invoices
           WHERE branch_id = ? AND status <> 'VOID' AND created_at >= ? AND created_at <= ?`
        )
        .bind(b.id, trailing.from, trailing.to)
        .first<{ gross: number }>(),
      all<{ id: string; number: string; amount_cents: number; description: string; status: string }>(
        db,
        `SELECT id, number, amount_cents, description, status FROM expenses
         WHERE branch_id = ? AND incurred_on = ? AND status <> 'REJECTED'`,
        [b.id, today]
      ),
      db
        .prepare("SELECT difference_cents, difference_reason, status FROM day_closings WHERE branch_id = ? AND close_date = ?")
        .bind(b.id, addDays(today, -1))
        .first<{ difference_cents: number; difference_reason: string | null; status: string }>(),
      listUnclosedDays(db, { branchId: b.id, from: addDays(today, -7), to: addDays(today, -1) }),
      listReceivables(db, { branchId: b.id, asOf: today }),
      db
        .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents FROM expenses WHERE branch_id = ? AND status = 'PENDING_APPROVAL'")
        .bind(b.id)
        .first<{ n: number; cents: number }>(),
    ]);

    const invoices = sales?.invoices ?? 0;
    const expensesCents = expenseToday.filter((e) => e.status === "POSTED").reduce((s, e) => s + e.amount_cents, 0);
    days.push({ branchId: b.id, branch: b.name, salesCents: sales?.gross ?? 0, invoices, expensesCents });

    // Yesterday's cash.
    if (closing && closing.status === "CLOSED" && closing.difference_cents !== 0) {
      const short = closing.difference_cents < 0;
      const amount = formatLkr(Math.abs(closing.difference_cents));
      add({
        id: `cash-diff:${b.id}`,
        severity: Math.abs(closing.difference_cents) >= 100_000 ? "alert" : "warn",
        title: short ? `Cash was short yesterday by ${amount}` : `Cash was over yesterday by ${amount}`,
        detail: closing.difference_reason ? `Recorded reason: ${closing.difference_reason}` : "No reason was recorded for the difference.",
      });
    }

    // Days with activity that nobody closed.
    if (unclosed.length > 0) {
      add({
        id: `unclosed:${b.id}`,
        severity: unclosed.length >= 3 ? "alert" : "warn",
        title: `${plural(unclosed.length, "day")} in the last week ${unclosed.length === 1 ? "was" : "were"} never closed`,
        detail: unclosed.map((u) => u.date).join(", "),
      });
    }

    // Sales against the branch's own 30-day average.
    const average = Math.round((trail?.gross ?? 0) / 30);
    const hour = shopClock(now, offset).time;
    if (average >= 100_000 && hour >= "18:00" && (sales?.gross ?? 0) < average * 0.5) {
      add({
        id: `sales-low:${b.id}`,
        severity: "warn",
        title: "Sales are well below the usual day",
        detail: `${formatLkr(sales?.gross ?? 0)} today against a 30-day daily average of ${formatLkr(average)}.`,
      });
    }

    // Voids and discounts.
    if ((sales?.voided ?? 0) >= 2) {
      add({
        id: `voids:${b.id}`,
        severity: "warn",
        title: `${plural(sales?.voided ?? 0, "invoice")} voided today`,
        detail: "Check the reasons recorded on the voided invoices.",
      });
    }
    const listed = (sales?.gross ?? 0) + (sales?.discount ?? 0);
    if (listed > 0 && (sales?.discount ?? 0) / listed > 0.1) {
      add({
        id: `discounts:${b.id}`,
        severity: "warn",
        title: "Discounts are high today",
        detail: `${formatLkr(sales?.discount ?? 0)} given on ${formatLkr(listed)} of sales (${(((sales?.discount ?? 0) / listed) * 100).toFixed(1)}%).`,
      });
    }

    // Large and held expenses.
    const large = expenseToday.filter((e) => e.amount_cents > thresholds.approvalCents);
    for (const e of large)
      add({
        id: `big-expense:${e.id}`,
        severity: "info",
        title: `Large expense ${e.number}: ${formatLkr(e.amount_cents)}`,
        detail: e.description,
      });
    if ((pending?.n ?? 0) > 0)
      add({
        id: `pending-expenses:${b.id}`,
        severity: "warn",
        title: `${plural(pending?.n ?? 0, "expense")} waiting for approval`,
        detail: `${formatLkr(pending?.cents ?? 0)} in total. Until approved, the ledger has not seen it and cash reads high by that amount.`,
      });

    // Customers who have not paid in a long time.
    const over90 = receivables.aging["90+"];
    if (over90 > 0) {
      const names = receivables.rows
        .filter((r) => r.aging["90+"] > 0)
        .sort((x, y) => y.aging["90+"] - x.aging["90+"])
        .slice(0, 3)
        .map((r) => `${r.name} (${formatLkr(r.aging["90+"])})`);
      add({
        id: `overdue90:${b.id}`,
        severity: over90 >= 500_000 ? "alert" : "warn",
        title: `${formatLkr(over90)} owed for more than 90 days`,
        detail: `Largest: ${names.join(", ")}.`,
      });
    }
  }

  const rank: Record<Severity, number> = { alert: 0, warn: 1, info: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { date: today, findings, days };
}

/** The summary written without a model: always correct, a little plain. */
export function ruleSummary(data: BriefData): string {
  const sales = data.days.reduce((s, d) => s + d.salesCents, 0);
  const invoices = data.days.reduce((s, d) => s + d.invoices, 0);
  const spent = data.days.reduce((s, d) => s + d.expensesCents, 0);
  const alerts = data.findings.filter((f) => f.severity === "alert").length;
  const warns = data.findings.filter((f) => f.severity === "warn").length;
  const head = `${data.date}: ${plural(invoices, "sale")} for ${formatLkr(sales)}, ${formatLkr(spent)} spent.`;
  if (data.findings.length === 0) return `${head} Nothing needs attention.`;
  const attention = [alerts && plural(alerts, "alert"), warns && plural(warns, "warning")].filter(Boolean).join(" and ");
  const top = data.findings[0];
  return `${head} ${attention ? `${attention} to look at. ` : ""}Most important: ${top?.title}.`;
}

/** Every figure the model may quote: whatever the findings and day totals contain. */
function allowedNumbers(data: BriefData): Set<string> {
  const text = [
    data.date,
    ...data.findings.flatMap((f) => [f.title, f.detail, f.branch]),
    ...data.days.flatMap((d) => [formatLkr(d.salesCents), formatLkr(d.expensesCents), String(d.invoices), d.branch]),
    formatLkr(data.days.reduce((s, d) => s + d.salesCents, 0)),
    formatLkr(data.days.reduce((s, d) => s + d.expensesCents, 0)),
    String(data.days.reduce((s, d) => s + d.invoices, 0)),
    String(data.findings.length),
    String(data.findings.filter((f) => f.severity === "alert").length),
    String(data.findings.filter((f) => f.severity === "warn").length),
  ].join(" ");
  return new Set(text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []);
}

/** True when every figure in the model's wording appears in the findings. */
export function numbersAreGrounded(summary: string, data: BriefData): boolean {
  const allowed = allowedNumbers(data);
  const quoted = summary.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  // Small counts the model may legitimately write ("two branches") are digits too; allow 0-9 as words of counting.
  return quoted.every((n) => allowed.has(n) || /^\d$/.test(n));
}

const SYSTEM = `You write the end-of-day brief for the owner of a jewellery shop.
You are given a JSON list of findings the accounting system has already computed.
Write 2 to 4 short plain sentences: what the day looked like, then what needs attention first.
Rules: use ONLY figures that appear in the JSON, copied exactly as written; never add, subtract or estimate a figure; never invent a cause; do not give advice about anything not in the findings. No markdown, no bullet points, no greeting.`;

async function wordIt(env: Env, data: BriefData): Promise<{ text: string; model: string } | null> {
  if (!env.AI) return null;
  const model = env.ASSISTANT_MODEL || "@cf/zai-org/glm-5.3-flash";
  const payload = {
    date: data.date,
    totals: {
      sales: formatLkr(data.days.reduce((s, d) => s + d.salesCents, 0)),
      invoices: data.days.reduce((s, d) => s + d.invoices, 0),
      expenses: formatLkr(data.days.reduce((s, d) => s + d.expensesCents, 0)),
    },
    findings: data.findings.slice(0, 12).map((f) => ({ severity: f.severity, branch: f.branch, title: f.title, detail: f.detail })),
  };
  try {
    const raw = (await env.AI.run(
      model,
      {
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: JSON.stringify(payload) },
        ],
        temperature: 0.1,
        max_completion_tokens: 400,
      },
      { gateway: { id: env.AI_GATEWAY_ID || "default", skipCache: true, metadata: { app: "goldos-brief" }, requestTimeoutMs: 60_000 } }
    )) as { choices?: { message?: { content?: string } }[]; response?: string };
    const text = (raw.choices?.[0]?.message?.content ?? raw.response ?? "")
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/[*#`]/g, "")
      .trim();
    return text ? { text, model } : null;
  } catch (err) {
    console.error("brief wording failed", err);
    return null;
  }
}

export async function buildBrief(env: Env, now: number, source: "cron" | "manual"): Promise<Brief> {
  const data = await gatherBrief(env, now);
  const worded = await wordIt(env, data);
  const grounded = worded && numbersAreGrounded(worded.text, data);
  const brief: Brief = {
    ...data,
    summary: grounded ? worded.text : ruleSummary(data),
    model: grounded ? worded.model : "rules",
    source,
    generatedAt: now,
  };
  await env.DB
    .prepare(
      `INSERT INTO ai_briefs (brief_date, findings_json, summary, model, source, generated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(brief_date) DO UPDATE SET findings_json = excluded.findings_json, summary = excluded.summary,
         model = excluded.model, source = excluded.source, generated_at = excluded.generated_at`
    )
    .bind(brief.date, JSON.stringify({ findings: brief.findings, days: brief.days }), brief.summary, brief.model, source, now)
    .run();
  return brief;
}

type BriefRow = { brief_date: string; findings_json: string; summary: string; model: string; source: "cron" | "manual"; generated_at: number };

export async function latestBrief(db: D1Database): Promise<Brief | null> {
  const row = await db.prepare("SELECT * FROM ai_briefs ORDER BY brief_date DESC LIMIT 1").first<BriefRow>();
  if (!row) return null;
  const parsed = JSON.parse(row.findings_json) as { findings: Finding[]; days: BranchDay[] };
  return { date: row.brief_date, ...parsed, summary: row.summary, model: row.model, source: row.source, generatedAt: row.generated_at };
}

/** A user limited to some branches sees only those; the model's shop-wide wording is replaced. */
export function scopeBrief(brief: Brief, scope: string[] | null): Brief {
  if (scope === null) return brief;
  const scoped: BriefData = {
    date: brief.date,
    findings: brief.findings.filter((f) => scope.includes(f.branchId)),
    days: brief.days.filter((d) => scope.includes(d.branchId)),
  };
  return { ...brief, ...scoped, summary: ruleSummary(scoped), model: "rules" };
}

/**
 * Hourly cron: once the shop-local hour reaches the configured one, write the
 * day's brief if there is not one yet.
 */
export async function maybeRunBrief(env: Env, now = Date.now()): Promise<void> {
  const db = env.DB;
  const [enabled, hourSetting, offset] = await Promise.all([getSetting(db, "brief_enabled"), getSetting(db, "brief_hour"), tzOffsetMinutes(db)]);
  if (enabled?.value === false) return;
  const hour = typeof hourSetting?.value === "number" ? hourSetting.value : 21;
  const clock = shopClock(now, offset);
  if (Number(clock.time.slice(0, 2)) < hour) return;
  const have = await db.prepare("SELECT 1 AS x FROM ai_briefs WHERE brief_date = ?").bind(clock.date).first();
  if (have) return;
  await buildBrief(env, now, "cron");
}

