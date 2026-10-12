import { shopDateTime } from "./time";

/**
 * What the model sees of a service result. The books store integer cents,
 * milligrams and epoch milliseconds; a model handed `balance_cents: 1234550`
 * will sooner or later report it as LKR 1,234,550. So every figure is
 * converted here, deterministically, into the exact string the answer should
 * quote: "LKR 12,345.50", "12.345 g", "2026-10-10 14:05".
 */

const lkrFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const gFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export function formatLkr(cents: number): string {
  return `LKR ${lkrFmt.format(cents / 100)}`;
}

export function formatGrams(mg: number): string {
  return `${gFmt.format(mg / 1000)} g`;
}

const CENTS_KEY = /cents/i;
const MG_KEY = /(^|_)mg($|_)|[a-z]Mg($|[A-Z])/;
const TIME_KEY = /(_at|At)$/;
const BP_KEY = /(_bp|Bp)$/;

function renameCents(k: string): string {
  return k.replace(/_cents/g, "_lkr").replace(/Cents/g, "Lkr").replace(/cents/g, "lkr");
}

function renameMg(k: string): string {
  return k.replace(/(^|_)mg($|_)/g, "$1g$2").replace(/([a-z])Mg($|[A-Z])/g, "$1G$2");
}

export type PresentOpts = { offsetMinutes: number };

/**
 * `inCents` marks the inside of an object whose own key says cents
 * (`totals_cents: { opening, closing }`, `aging_cents: { "0-30": … }`): every
 * plain number in it is money, though its own key does not say so.
 */
export function present(value: unknown, opts: PresentOpts, inCents = false): unknown {
  if (Array.isArray(value)) return value.map((v) => (inCents && typeof v === "number" ? formatLkr(v) : present(v, opts, inCents)));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v && typeof v === "object" && CENTS_KEY.test(k)) {
      out[renameCents(k)] = present(v, opts, true);
      continue;
    }
    if (typeof v === "number") {
      if (CENTS_KEY.test(k)) {
        out[renameCents(k)] = formatLkr(v);
        continue;
      }
      if (MG_KEY.test(k)) {
        out[renameMg(k)] = formatGrams(v);
        continue;
      }
      if (TIME_KEY.test(k) && v > 1e11) {
        out[k] = shopDateTime(v, opts.offsetMinutes);
        continue;
      }
      if (BP_KEY.test(k)) {
        out[k.replace(/_bp$/, "_percent").replace(/Bp$/, "Percent")] = `${(v / 100).toFixed(2)}%`;
        continue;
      }
      if (inCents) {
        out[k] = formatLkr(v);
        continue;
      }
    }
    out[k] = present(v, opts, inCents);
  }
  return out;
}

/** Keys whose value is cents but whose name does not say so. */
export function centsFields<T extends Record<string, unknown>>(obj: T, keys: (keyof T)[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number") {
      delete out[k as string];
      out[`${String(k)}Cents`] = v;
    }
  }
  return out;
}

/**
 * A list longer than the model can usefully read is cut, and the cut is
 * stated, so the model says "showing the first 50 of 312" instead of
 * presenting a partial list as the whole.
 */
export function capRows<T>(rows: T[], max: number): { rows: T[]; totalRows: number; truncated: boolean } {
  return { rows: rows.slice(0, max), totalRows: rows.length, truncated: rows.length > max };
}

export const MAX_TOOL_CHARS = 14_000;

export function toToolContent(value: unknown, opts: PresentOpts): string {
  const json = JSON.stringify(present(value, opts));
  if (json.length <= MAX_TOOL_CHARS) return json;
  return JSON.stringify({
    truncated: true,
    note: "The result was too large and was cut. Do not total or rank from it; ask again with a narrower filter (branch, dates, account or party).",
    partial: json.slice(0, MAX_TOOL_CHARS),
  });
}
