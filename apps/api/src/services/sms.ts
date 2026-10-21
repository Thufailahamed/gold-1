import { centsToLkr } from "@goldos/shared";
import { shopClock } from "../assistant/time";
import { buildAuditStmt } from "../middleware/audit";
import type { Env } from "../db/client";
import { shopDbFor } from "../db/shop-handle";
import { tzOffsetMinutes } from "./busdate";
import { customerOpenInvoices, listReceivables } from "./receipts";
import { getSetting } from "./settings";

/**
 * Credit reminders over the SMSlenz gateway (https://smslenz.lk/developers/api).
 * Each shop brings its own gateway account: user id, API key and an approved
 * sender id. The key is write-only through the API — reads return it masked.
 */

const GATEWAY = "https://smslenz.lk/api";
const SEND_TIMEOUT_MS = 15_000;
/** Most reminders one automatic run will send for one shop. */
const AUTO_MAX_PER_RUN = 100;
/** A failed automatic attempt is not retried for this long. */
const AUTO_RETRY_COOLDOWN_MS = 6 * 3_600_000;

export const DEFAULT_TEMPLATE =
  "Dear {name}, a balance of LKR {amount} is pending at {shop}. Please settle it at your earliest convenience. Thank you.";

export type SmsConfig = {
  userId: string;
  apiKey: string;
  senderId: string;
  shopName: string;
  template: string;
  autoEnabled: boolean;
  autoAfterDays: number;
  repeatDays: number;
  sendHour: number;
  minAmountCents: number;
};

const fail = (code: string, message: string): never => {
  throw Object.assign(new Error(message), { code });
};

/* ------------------------------------------------------------ pure helpers */

/** Sri Lankan numbers in any common spelling → +94XXXXXXXXX, or null. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("94") && d.length === 11) return `+${d}`;
  if (d.startsWith("0") && d.length === 10) return `+94${d.slice(1)}`;
  if (/^7\d{8}$/.test(d)) return `+94${d}`;
  return null;
}

export function renderTemplate(
  template: string,
  vars: { name: string; amountCents: number; shop: string; bills: number; oldest: string | null }
): string {
  const amount = centsToLkr(vars.amountCents).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const map: Record<string, string> = {
    name: vars.name,
    amount,
    shop: vars.shop,
    bills: String(vars.bills),
    oldest: vars.oldest ?? "",
  };
  return (template.trim() || DEFAULT_TEMPLATE).replace(/\{(\w+)\}/g, (m, k: string) => map[k] ?? m).slice(0, 1500);
}

/** Whole days from one business date to a later one. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/* ---------------------------------------------------------------- settings */

type Row = {
  user_id: string;
  api_key: string;
  sender_id: string;
  shop_name: string;
  template: string;
  auto_enabled: number;
  auto_after_days: number;
  repeat_days: number;
  send_hour: number;
  min_amount_cents: number;
};

export async function loadConfig(db: D1Database): Promise<SmsConfig> {
  const row = await db.prepare("SELECT * FROM sms_settings WHERE id = 1").first<Row>();
  const shop = await getSetting(db, "shop_name");
  const shopDefault = typeof shop?.value === "string" && shop.value ? shop.value : "our shop";
  return {
    userId: row?.user_id ?? "",
    apiKey: row?.api_key ?? "",
    senderId: row?.sender_id ?? "",
    shopName: row?.shop_name || shopDefault,
    template: row?.template || DEFAULT_TEMPLATE,
    autoEnabled: row?.auto_enabled === 1,
    autoAfterDays: row?.auto_after_days ?? 7,
    repeatDays: row?.repeat_days ?? 7,
    sendHour: row?.send_hour ?? 10,
    minAmountCents: row?.min_amount_cents ?? 0,
  };
}

export const isConfigured = (c: SmsConfig) => Boolean(c.userId && c.apiKey && c.senderId);

const mask = (key: string) => (key ? `${"•".repeat(Math.max(4, key.length - 4))}${key.slice(-4)}` : "");

export async function getPublicConfig(db: D1Database) {
  const c = await loadConfig(db);
  return {
    configured: isConfigured(c),
    userId: c.userId,
    apiKeyMasked: mask(c.apiKey),
    hasApiKey: Boolean(c.apiKey),
    senderId: c.senderId,
    shopName: c.shopName,
    template: c.template,
    autoEnabled: c.autoEnabled,
    autoAfterDays: c.autoAfterDays,
    repeatDays: c.repeatDays,
    sendHour: c.sendHour,
    minAmountLkr: centsToLkr(c.minAmountCents),
  };
}

export type SmsSettingsInput = {
  userId: string;
  /** Blank keeps the stored key. */
  apiKey?: string;
  senderId: string;
  shopName: string;
  template: string;
  autoEnabled: boolean;
  autoAfterDays: number;
  repeatDays: number;
  sendHour: number;
  minAmountLkr: number;
};

export async function saveConfig(db: D1Database, input: SmsSettingsInput, actorId: string): Promise<void> {
  const prev = await loadConfig(db);
  const apiKey = input.apiKey?.trim() ? input.apiKey.trim() : prev.apiKey;
  if (input.autoEnabled && !(input.userId.trim() && apiKey && input.senderId.trim()))
    fail("VALIDATION", "Enter the SMSlenz user id, API key and sender id before turning on automatic reminders");
  const template = input.template.trim() || DEFAULT_TEMPLATE;
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO sms_settings (id, user_id, api_key, sender_id, shop_name, template, auto_enabled, auto_after_days, repeat_days, send_hour, min_amount_cents, updated_at, updated_by)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, api_key = excluded.api_key, sender_id = excluded.sender_id,
           shop_name = excluded.shop_name, template = excluded.template, auto_enabled = excluded.auto_enabled,
           auto_after_days = excluded.auto_after_days, repeat_days = excluded.repeat_days, send_hour = excluded.send_hour,
           min_amount_cents = excluded.min_amount_cents, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      )
      .bind(
        input.userId.trim(),
        apiKey,
        input.senderId.trim(),
        input.shopName.trim(),
        template,
        input.autoEnabled ? 1 : 0,
        input.autoAfterDays,
        input.repeatDays,
        input.sendHour,
        Math.round(input.minAmountLkr * 100),
        now,
        actorId
      ),
    buildAuditStmt(db, {
      userId: actorId,
      action: "sms.settings",
      entity: "sms_settings",
      entityId: "1",
      // The key itself never enters the audit trail.
      next: { ...input, apiKey: input.apiKey?.trim() ? "(changed)" : undefined },
    }),
  ]);
}

/* ----------------------------------------------------------------- gateway */

export type SendResult = { ok: true; pages: number | null; ref: string | null } | { ok: false; error: string };
type Fetch = typeof fetch;

export async function sendSms(cfg: SmsConfig, phone: string, message: string, f: Fetch = fetch): Promise<SendResult> {
  if (!isConfigured(cfg)) return { ok: false, error: "SMS gateway is not set up" };
  try {
    const res = await f(`${GATEWAY}/send-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        user_id: cfg.userId,
        api_key: cfg.apiKey,
        sender_id: cfg.senderId,
        contact: phone,
        message,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const text = await res.text();
    let body: { success?: boolean; message?: string; data?: { pages?: number; campaign_id?: number | string } } = {};
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON error page from the gateway.
    }
    if (res.ok && body.success === true)
      return { ok: true, pages: body.data?.pages ?? null, ref: body.data?.campaign_id != null ? String(body.data.campaign_id) : null };
    return { ok: false, error: (body.message || text || `Gateway returned ${res.status}`).slice(0, 300) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach the SMS gateway" };
  }
}

/** Balance and account state from SMSlenz, to prove the credentials work. */
export async function gatewayStatus(cfg: SmsConfig, f: Fetch = fetch): Promise<Record<string, unknown>> {
  if (!cfg.userId || !cfg.apiKey) return fail("VALIDATION", "Enter the SMSlenz user id and API key first");
  let res: Response;
  try {
    res = await f(`${GATEWAY}/account-status`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ user_id: cfg.userId, api_key: cfg.apiKey }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {
    return fail("VALIDATION", "Could not reach the SMS gateway");
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body) return fail("VALIDATION", String(body?.message ?? "SMSlenz rejected the user id or API key"));
  return body;
}

/* --------------------------------------------------------------------- log */

async function logSms(
  db: D1Database,
  row: { customerId: string | null; phone: string; message: string; kind: "MANUAL" | "AUTO" | "TEST"; result: SendResult; amountCents: number | null; actorId: string | null; at?: number }
) {
  await db
    .prepare(
      "INSERT INTO sms_log (id, customer_id, phone, message, kind, status, error, pages, provider_ref, amount_cents, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      crypto.randomUUID(),
      row.customerId,
      row.phone,
      row.message,
      row.kind,
      row.result.ok ? "SENT" : "FAILED",
      row.result.ok ? null : row.result.error,
      row.result.ok ? row.result.pages : null,
      row.result.ok ? row.result.ref : null,
      row.amountCents,
      row.at ?? Date.now(),
      row.actorId
    )
    .run();
}

export async function listSmsLog(db: D1Database, opts: { customerId?: string; page: number; limit: number }) {
  const where = opts.customerId ? "WHERE l.customer_id = ?" : "";
  const vals = opts.customerId ? [opts.customerId] : [];
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM sms_log l ${where}`).bind(...vals).first<{ n: number }>();
  const { results } = await db
    .prepare(
      `SELECT l.id, l.customer_id, c.name AS customer_name, l.phone, l.message, l.kind, l.status, l.error, l.pages, l.amount_cents, l.created_at
       FROM sms_log l LEFT JOIN customers c ON c.id = l.customer_id ${where} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...vals, opts.limit, (opts.page - 1) * opts.limit)
    .all();
  return { rows: results ?? [], total: total?.n ?? 0 };
}

/* --------------------------------------------------------------- reminders */

type Due = { customerId: string; name: string; phone: string | null; balanceCents: number; bills: number; oldest: string | null };

async function customerDue(db: D1Database, customerId: string): Promise<Due> {
  const c = await db.prepare("SELECT id, name, phone FROM customers WHERE id = ?").bind(customerId).first<{ id: string; name: string; phone: string | null }>();
  if (!c) return fail("NOT_FOUND", "Customer not found");
  const bal = await db
    .prepare("SELECT COALESCE(SUM(debit_cents - credit_cents), 0) AS n FROM journal_lines WHERE account_code = '1200' AND party_type = 'customer' AND party_id = ?")
    .bind(customerId)
    .first<{ n: number }>();
  const open = await customerOpenInvoices(db, customerId);
  return { customerId, name: c.name, phone: c.phone, balanceCents: bal?.n ?? 0, bills: open.invoices.length, oldest: open.invoices[0]?.date ?? null };
}

const varsOf = (d: Due, cfg: SmsConfig) => ({ name: d.name, amountCents: d.balanceCents, shop: cfg.shopName, bills: d.bills, oldest: d.oldest });

export async function previewReminder(db: D1Database, customerId: string) {
  const cfg = await loadConfig(db);
  const d = await customerDue(db, customerId);
  return { message: renderTemplate(cfg.template, varsOf(d, cfg)), phone: normalizePhone(d.phone), rawPhone: d.phone, balanceCents: d.balanceCents };
}

export type ReminderOutcome = { customerId: string; name: string; status: "SENT" | "FAILED" | "SKIPPED"; detail?: string };

/** Manual reminders: one SMS per customer, each with their own balance. */
export async function sendReminders(
  db: D1Database,
  customerIds: string[],
  opts: { message?: string; actorId: string },
  f: Fetch = fetch
): Promise<ReminderOutcome[]> {
  const cfg = await loadConfig(db);
  if (!isConfigured(cfg)) return fail("VALIDATION", "Set up the SMS gateway first (user id, API key, sender id)");
  const out: ReminderOutcome[] = [];
  for (const id of [...new Set(customerIds)].slice(0, 50)) {
    let d: Due;
    try {
      d = await customerDue(db, id);
    } catch (e) {
      out.push({ customerId: id, name: id, status: "SKIPPED", detail: e instanceof Error ? e.message : "Customer not found" });
      continue;
    }
    if (d.balanceCents <= 0) {
      out.push({ customerId: id, name: d.name, status: "SKIPPED", detail: "Owes nothing" });
      continue;
    }
    const phone = normalizePhone(d.phone);
    if (!phone) {
      out.push({ customerId: id, name: d.name, status: "SKIPPED", detail: d.phone ? "Phone number is not a valid Sri Lankan mobile" : "No phone number on file" });
      continue;
    }
    const message = opts.message?.trim() ? renderTemplate(opts.message, varsOf(d, cfg)) : renderTemplate(cfg.template, varsOf(d, cfg));
    const result = await sendSms(cfg, phone, message, f);
    await logSms(db, { customerId: id, phone, message, kind: "MANUAL", result, amountCents: d.balanceCents, actorId: opts.actorId });
    out.push({ customerId: id, name: d.name, status: result.ok ? "SENT" : "FAILED", detail: result.ok ? undefined : result.error });
  }
  return out;
}

export async function sendTest(db: D1Database, rawPhone: string, actorId: string, f: Fetch = fetch): Promise<void> {
  const cfg = await loadConfig(db);
  if (!isConfigured(cfg)) return fail("VALIDATION", "Set up the SMS gateway first (user id, API key, sender id)");
  const phone = normalizePhone(rawPhone);
  if (!phone) return fail("VALIDATION", "Enter a Sri Lankan mobile number, e.g. 0771234567");
  const message = `${cfg.shopName}: SMS reminders are connected.`;
  const result = await sendSms(cfg, phone, message, f);
  await logSms(db, { customerId: null, phone, message, kind: "TEST", result, amountCents: null, actorId });
  if (!result.ok) fail("VALIDATION", result.error);
}

/**
 * Automatic reminders for one shop. Runs hourly but is idempotent: after the
 * configured local hour, a customer is texted only when their oldest open bill
 * is old enough, they owe at least the minimum, and they were not texted
 * within the repeat window (or failed within the cool-down).
 */
export async function runAutoReminders(
  db: D1Database,
  now = Date.now(),
  f: Fetch = fetch
): Promise<{ sent: number; failed: number; skipped: number }> {
  const stats = { sent: 0, failed: 0, skipped: 0 };
  const cfg = await loadConfig(db);
  if (!cfg.autoEnabled || !isConfigured(cfg)) return stats;
  const offset = await tzOffsetMinutes(db);
  const clock = shopClock(now, offset);
  if (Number(clock.time.slice(0, 2)) < cfg.sendHour) return stats;

  const { rows } = await listReceivables(db, { asOf: clock.date });
  let consecutiveFailures = 0;
  for (const r of rows) {
    if (stats.sent + stats.failed >= AUTO_MAX_PER_RUN || consecutiveFailures >= 3) break;
    const phone = normalizePhone(r.phone);
    if (
      !phone ||
      r.balanceCents < Math.max(1, cfg.minAmountCents) ||
      !r.oldestOpenDate ||
      daysBetween(r.oldestOpenDate, clock.date) < cfg.autoAfterDays
    ) {
      stats.skipped++;
      continue;
    }
    const last = await db
      .prepare("SELECT MAX(CASE WHEN status = 'SENT' THEN created_at END) AS sent, MAX(CASE WHEN status = 'FAILED' AND kind = 'AUTO' THEN created_at END) AS failed FROM sms_log WHERE customer_id = ? AND kind <> 'TEST'")
      .bind(r.customerId)
      .first<{ sent: number | null; failed: number | null }>();
    const sentDay = last?.sent ? shopClock(last.sent, offset).date : null;
    if ((sentDay && daysBetween(sentDay, clock.date) < Math.max(1, cfg.repeatDays)) || (last?.failed && now - last.failed < AUTO_RETRY_COOLDOWN_MS)) {
      stats.skipped++;
      continue;
    }
    const message = renderTemplate(cfg.template, {
      name: r.name,
      amountCents: r.balanceCents,
      shop: cfg.shopName,
      bills: r.openInvoices,
      oldest: r.oldestOpenDate,
    });
    const result = await sendSms(cfg, phone, message, f);
    await logSms(db, { customerId: r.customerId, phone, message, kind: "AUTO", result, amountCents: r.balanceCents, actorId: null, at: now });
    if (result.ok) {
      stats.sent++;
      consecutiveFailures = 0;
    } else {
      stats.failed++;
      consecutiveFailures++;
    }
  }
  return stats;
}

/** Cron entry: every active shop (and the pinned default database). */
export async function runAutoRemindersAll(env: Env, now = Date.now()): Promise<void> {
  const dbs: { label: string; db: D1Database }[] = [{ label: "default", db: env.DB }];
  if (env.PLATFORM_DB) {
    const { results } = await env.PLATFORM_DB
      .prepare(
        "SELECT t.slug AS slug, d.d1_id AS d1_id FROM tenants t JOIN tenant_databases d ON d.tenant_id = t.id WHERE t.status NOT IN ('SUSPENDED','ARCHIVED')"
      )
      .all<{ slug: string; d1_id: string }>();
    for (const t of results ?? []) {
      const db = shopDbFor(env, t.d1_id);
      if (db) dbs.push({ label: t.slug, db });
    }
  }
  for (const { label, db } of dbs) {
    try {
      await runAutoReminders(db, now);
    } catch (e) {
      // A shop without the SMS tables yet (migration pending) is simply skipped.
      console.error(`sms reminders failed for ${label}`, e);
    }
  }
}
