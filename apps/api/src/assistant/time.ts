import { addDays, businessDate, fiscalYearFor, isBusinessDate, monthBounds } from "@goldos/shared";

/**
 * Dates and times for the assistant. The model is never trusted to know what
 * day it is or to do calendar arithmetic: "today" is the shop's business date
 * from the server clock and the shop's own offset, and every named period
 * ("last month", "this financial year") is resolved here into exact dates.
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type ShopClock = {
  /** Shop-local business date, YYYY-MM-DD. */
  date: string;
  /** Shop-local wall time, HH:MM. */
  time: string;
  weekday: string;
  /** UTC offset as written, e.g. "+05:30". */
  utcOffset: string;
};

export function utcOffsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export function shopClock(epochMs: number, offsetMinutes: number): ShopClock {
  const local = new Date(epochMs + offsetMinutes * 60_000);
  return {
    date: businessDate(epochMs, offsetMinutes),
    time: local.toISOString().slice(11, 16),
    weekday: WEEKDAYS[local.getUTCDay()] ?? "",
    utcOffset: utcOffsetLabel(offsetMinutes),
  };
}

/** Shop-local "YYYY-MM-DD HH:MM" for an epoch-ms timestamp. */
export function shopDateTime(epochMs: number, offsetMinutes: number): string {
  return new Date(epochMs + offsetMinutes * 60_000).toISOString().slice(0, 16).replace("T", " ");
}

/**
 * Epoch-ms bounds of shop-local days, for the tables keyed by created_at:
 * from local midnight of `from` to the last millisecond of `to`.
 */
export function localDayBoundsMs(from: string, to: string, offsetMinutes: number): { from: number; to: number } {
  const start = Date.parse(`${from}T00:00:00Z`) - offsetMinutes * 60_000;
  const end = Date.parse(`${addDays(to, 1)}T00:00:00Z`) - offsetMinutes * 60_000 - 1;
  return { from: start, to: end };
}

export const PERIODS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "last_year",
  "this_fiscal_year",
  "last_fiscal_year",
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "month",
  "quarter",
  "fiscal_year_of",
] as const;
export type Period = (typeof PERIODS)[number];

export type ResolvedPeriod = { from: string; to: string; label: string; days: number };

const dayCount = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
const done = (from: string, to: string, label: string): ResolvedPeriod => ({ from, to, label, days: dayCount(from, to) });

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Weeks run Monday to Sunday. */
function mondayOf(date: string): string {
  return addDays(date, -((weekday(date) + 6) % 7));
}

function quarterOf(date: string): { year: number; q: number } {
  return { year: Number(date.slice(0, 4)), q: Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1 };
}

function quarterBounds(year: number, q: number): { from: string; to: string } {
  const startMonth = (q - 1) * 3 + 1;
  return { from: monthBounds(year, startMonth).from, to: monthBounds(year, startMonth + 2).to };
}

export function resolvePeriod(
  period: Period,
  today: string,
  fiscalStartMonth: number,
  opts: { year?: number; month?: number; quarter?: number; date?: string } = {}
): ResolvedPeriod {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  switch (period) {
    case "today":
      return done(today, today, `Today (${today})`);
    case "yesterday": {
      const d = addDays(today, -1);
      return done(d, d, `Yesterday (${d})`);
    }
    case "this_week": {
      const from = mondayOf(today);
      return done(from, today, `This week to date (${from} to ${today})`);
    }
    case "last_week": {
      const from = addDays(mondayOf(today), -7);
      const to = addDays(from, 6);
      return done(from, to, `Last week (${from} to ${to})`);
    }
    case "this_month": {
      const from = monthBounds(y, m).from;
      return done(from, today, `This month to date (${from} to ${today})`);
    }
    case "last_month": {
      const b = m === 1 ? monthBounds(y - 1, 12) : monthBounds(y, m - 1);
      return done(b.from, b.to, `Last month (${b.from} to ${b.to})`);
    }
    case "this_quarter": {
      const { year, q } = quarterOf(today);
      const b = quarterBounds(year, q);
      return done(b.from, today, `Q${q} ${year} to date (${b.from} to ${today})`);
    }
    case "last_quarter": {
      const cur = quarterOf(today);
      const year = cur.q === 1 ? cur.year - 1 : cur.year;
      const q = cur.q === 1 ? 4 : cur.q - 1;
      const b = quarterBounds(year, q);
      return done(b.from, b.to, `Q${q} ${year} (${b.from} to ${b.to})`);
    }
    case "this_year":
      return done(`${y}-01-01`, today, `Calendar year ${y} to date (${y}-01-01 to ${today})`);
    case "last_year":
      return done(`${y - 1}-01-01`, `${y - 1}-12-31`, `Calendar year ${y - 1} (${y - 1}-01-01 to ${y - 1}-12-31)`);
    case "this_fiscal_year": {
      const fy = fiscalYearFor(today, fiscalStartMonth);
      return done(fy.start, today, `Financial year ${fy.label} to date (${fy.start} to ${today})`);
    }
    case "last_fiscal_year": {
      const cur = fiscalYearFor(today, fiscalStartMonth);
      const fy = fiscalYearFor(addDays(cur.start, -1), fiscalStartMonth);
      return done(fy.start, fy.end, `Financial year ${fy.label} (${fy.start} to ${fy.end})`);
    }
    case "last_7_days":
    case "last_30_days":
    case "last_90_days": {
      const n = Number(period.split("_")[1]);
      const from = addDays(today, -(n - 1));
      return done(from, today, `Last ${n} days (${from} to ${today})`);
    }
    case "month": {
      if (!opts.month) throw Object.assign(new Error("month is required for period 'month'"), { code: "VALIDATION" });
      const year = opts.year ?? (opts.month > m ? y - 1 : y);
      const b = monthBounds(year, opts.month);
      const to = b.to > today ? today : b.to;
      if (b.from > today) throw Object.assign(new Error(`${b.label} has not started yet`), { code: "VALIDATION" });
      return done(b.from, to, to === b.to ? `Month ${b.label} (${b.from} to ${to})` : `Month ${b.label} to date (${b.from} to ${to})`);
    }
    case "quarter": {
      const q = opts.quarter;
      if (!q || q < 1 || q > 4) throw Object.assign(new Error("quarter (1-4) is required for period 'quarter'"), { code: "VALIDATION" });
      const cur = quarterOf(today);
      // A bare quarter is the most recent one that has started.
      const year = opts.year ?? (q > cur.q ? cur.year - 1 : cur.year);
      const b = quarterBounds(year, q);
      if (b.from > today) throw Object.assign(new Error(`Q${q} ${year} has not started yet`), { code: "VALIDATION" });
      const to = b.to > today ? today : b.to;
      return done(b.from, to, to === b.to ? `Q${q} ${year} (${b.from} to ${to})` : `Q${q} ${year} to date (${b.from} to ${to})`);
    }
    case "fiscal_year_of": {
      const date = opts.date;
      if (!date || !isBusinessDate(date))
        throw Object.assign(new Error("date (YYYY-MM-DD) is required for period 'fiscal_year_of'"), { code: "VALIDATION" });
      const fy = fiscalYearFor(date, fiscalStartMonth);
      if (fy.start > today) throw Object.assign(new Error(`Financial year ${fy.label} has not started yet`), { code: "VALIDATION" });
      const to = fy.end > today ? today : fy.end;
      return done(fy.start, to, to === fy.end ? `Financial year ${fy.label} (${fy.start} to ${to})` : `Financial year ${fy.label} to date (${fy.start} to ${to})`);
    }
  }
}
