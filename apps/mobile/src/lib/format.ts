/**
 * Number, money, weight and date formatting. Money is always integer cents
 * (LKR) and weight integer milligrams on the wire — same as the web app.
 */

const nf = (min: number, max: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });
const nf0 = nf(0, 0);
const nf2 = nf(2, 2);
const nf3 = nf(3, 3);

/** Exact LKR with cents — the books must match to the cent. "1,250.50" */
export const lkr = (cents: number) => nf2.format(cents / 100);
/** Signed exact LKR: "−1,250.50" */
export const lkrSigned = (cents: number) => `${cents < 0 ? "−" : ""}${lkr(Math.abs(cents))}`;
/** Whole-rupee LKR for dashboards: "1,251" */
export const lkr0 = (cents: number) => nf0.format(Math.round(cents / 100));
/** "LKR 1,250.50" */
export const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : `LKR ${lkr(cents)}`);
/** "LKR 1,251" */
export const money0 = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : `LKR ${lkr0(cents)}`);
/** Compact: "1.2M" */
// Hand-rolled: Hermes ignores Intl's `notation: "compact"` and prints the full number.
export const compact = (n: number) => {
  const abs = Math.abs(n);
  const [div, suffix] = abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : abs >= 1e3 ? [1e3, "K"] : [1, ""];
  return `${nf(0, 1).format(n / div)}${suffix}`;
};

/** Milligrams → "12.345" grams (3 dp). */
export const grams = (mg: number) => nf3.format(mg / 1000);
/** Milligrams → "12.345 g" */
export const g = (mg: number | null | undefined) => (mg === null || mg === undefined ? "—" : `${grams(mg)} g`);
/** Milligrams → trimmed grams "12.3" */
export const gramsShort = (mg: number) => nf(0, 3).format(mg / 1000);

export const count = (n: number) => nf0.format(Math.round(n));
export const pct = (n: number, digits = 1) => `${n.toFixed(digits)}%`;

/**
 * "1,250.50" → 125050. Rounds through a string so float error never becomes
 * a missing cent. Returns NaN for anything unparseable.
 */
export function toCents(input: string): number {
  const clean = input.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return Number.NaN;
  const [whole = "0", frac = ""] = clean.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** "12.345" grams → 12345 mg. NaN when unparseable. */
export function toMg(input: string): number {
  const clean = input.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{0,3})?$/.test(clean)) return Number.NaN;
  const [whole = "0", frac = ""] = clean.split(".");
  return Number(whole) * 1000 + Number(frac.padEnd(3, "0"));
}

/** Cents → editable string "1250.50" (no grouping). */
export const centsInput = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : (cents / 100).toFixed(2));
/** Mg → editable string "12.345". */
export const mgInput = (mg: number | null | undefined) => (mg === null || mg === undefined ? "" : (mg / 1000).toFixed(3));

export const humanize = (s: string | null | undefined) =>
  (s ?? "").replace(/[._-]+/g, " ").toLowerCase().replace(/^\w/, (ch) => ch.toUpperCase());

/** "12 Sep 2026" from epoch ms. */
export const date = (ms: number | null | undefined) =>
  ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
/** "12 Sep 2026, 14:05" from epoch ms. */
export const dateTime = (ms: number | null | undefined) =>
  ms
    ? new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
export const time = (ms: number | null | undefined) =>
  ms ? new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—";

/** "Sat, 12 Sep 2026" from a YYYY-MM-DD business date. */
export const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** "12 Sep 2026" from a YYYY-MM-DD business date. */
export const shortDate = (d: string | null | undefined) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

export function ago(ts: number | null | undefined): string {
  if (!ts) return "—";
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** Business "today" (Sri Lanka, UTC+5:30) as YYYY-MM-DD. */
export const businessToday = (): string => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** YYYY-MM-DD for a local Date. */
export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Initials for an avatar. */
export const initials = (name: string | null | undefined, fallback = "?") => {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "")).toUpperCase();
};
