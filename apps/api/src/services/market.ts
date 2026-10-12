// Live market reference rates: international spot metals and crypto from
// gold-api.com (free, keyless, USD) and FX from ExchangeRate-API's open
// endpoint (free, keyless, daily). Everything is converted to LKR so the
// board can be compared against the shop's published rates. Nothing here
// posts to the books; publishing a board rate still goes through
// createGoldRate and its approval rules.
import { centsToLkr } from "@goldos/shared";
import { currentGoldRatesCents } from "./rates";

export const TROY_OZ_G = 31.1034768;
const POUND_G = 453.59237;
/** Sri Lankan sovereign ("pawn"), the unit customers quote gold in. */
export const PAWN_G = 8;

const METALS_URL = "https://api.gold-api.com/price/";
const FX_URL = "https://open.er-api.com/v6/latest/USD";

export type MarketSymbol = {
  symbol: string;
  name: string;
  kind: "metal" | "crypto";
  /** Unit the upstream quotes in. */
  unit: "oz" | "lb" | "coin";
  /** Grams in one quoted unit; null when a per-gram price means nothing. */
  gramsPerUnit: number | null;
};

export const MARKET_SYMBOLS: MarketSymbol[] = [
  { symbol: "XAU", name: "Gold", kind: "metal", unit: "oz", gramsPerUnit: TROY_OZ_G },
  { symbol: "XAG", name: "Silver", kind: "metal", unit: "oz", gramsPerUnit: TROY_OZ_G },
  { symbol: "XPT", name: "Platinum", kind: "metal", unit: "oz", gramsPerUnit: TROY_OZ_G },
  { symbol: "XPD", name: "Palladium", kind: "metal", unit: "oz", gramsPerUnit: TROY_OZ_G },
  { symbol: "HG", name: "Copper", kind: "metal", unit: "lb", gramsPerUnit: POUND_G },
  { symbol: "BTC", name: "Bitcoin", kind: "crypto", unit: "coin", gramsPerUnit: null },
  { symbol: "ETH", name: "Ethereum", kind: "crypto", unit: "coin", gramsPerUnit: null },
];

/** Currencies shown on the FX board: majors plus the main remittance corridors. */
export const FX_CODES = ["USD", "EUR", "GBP", "INR", "AED", "SAR", "QAR", "KWD", "OMR", "AUD", "CAD", "SGD", "JPY", "CNY"];

const UPSTREAM_TTL_MS = 30_000;
/** Minimum spacing between stored snapshots, whatever triggers them. */
const SNAPSHOT_EVERY_MS = 10 * 60_000;
const SNAPSHOT_KEEP_MS = 400 * 86_400_000;
const DAY_MS = 86_400_000;

type Quote = { priceUsd: number; updatedAt: number };
type Upstream = {
  fetchedAt: number;
  quotes: Record<string, Quote>;
  fx: { rates: Record<string, number>; updatedAt: number } | null;
};

export type MarketOpts = { fetcher?: typeof fetch; now?: number };

// Per-isolate cache so a page polling every few seconds, or many staff on the
// board at once, costs the upstream one call per symbol per 30s.
let cached: Upstream | null = null;

export function resetMarketCache() {
  cached = null;
}

async function getJson(fetcher: typeof fetch, url: string): Promise<unknown> {
  const res = await fetcher(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function fetchUpstream(fetcher: typeof fetch, now: number): Promise<Upstream> {
  const [fxRes, ...quoteRes] = await Promise.allSettled([
    getJson(fetcher, FX_URL),
    ...MARKET_SYMBOLS.map((s) => getJson(fetcher, METALS_URL + s.symbol)),
  ]);
  const quotes: Record<string, Quote> = {};
  quoteRes.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const body = r.value as { price?: unknown; updatedAt?: unknown };
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) return;
    const at = typeof body.updatedAt === "string" ? Date.parse(body.updatedAt) : NaN;
    quotes[MARKET_SYMBOLS[i]!.symbol] = { priceUsd: price, updatedAt: Number.isFinite(at) ? at : now };
  });
  let fx: Upstream["fx"] = null;
  if (fxRes.status === "fulfilled") {
    const body = fxRes.value as { result?: string; rates?: Record<string, number>; time_last_update_unix?: number };
    if (body.result === "success" && body.rates && Number(body.rates.LKR) > 0)
      fx = { rates: body.rates, updatedAt: (body.time_last_update_unix ?? now / 1000) * 1000 };
  }
  return { fetchedAt: now, quotes, fx };
}

async function loadUpstream(opts: MarketOpts): Promise<Upstream> {
  const now = opts.now ?? Date.now();
  if (cached && now - cached.fetchedAt < UPSTREAM_TTL_MS) return cached;
  const fresh = await fetchUpstream(opts.fetcher ?? fetch, now);
  // Don't cache a total outage: the next request should try again.
  if (fresh.fx || Object.keys(fresh.quotes).length) cached = fresh;
  return fresh;
}

type SnapshotRow = { symbol: string; price_usd: number; usd_lkr: number; captured_at: number };

async function latestSnapshots(db: D1Database): Promise<Record<string, SnapshotRow>> {
  const { results } = await db
    .prepare(
      "SELECT s.symbol, s.price_usd, s.usd_lkr, s.captured_at FROM market_snapshots s WHERE s.captured_at = (SELECT MAX(captured_at) FROM market_snapshots WHERE symbol = s.symbol)"
    )
    .all<SnapshotRow>();
  return Object.fromEntries((results ?? []).map((r) => [r.symbol, r]));
}

/** The snapshot nearest to 24h ago, if one was taken between 18h and 30h ago. */
async function dayAgoSnapshots(db: D1Database, now: number): Promise<Record<string, SnapshotRow>> {
  const target = now - DAY_MS;
  const { results } = await db
    .prepare(
      "SELECT symbol, price_usd, usd_lkr, captured_at FROM market_snapshots WHERE captured_at BETWEEN ? AND ? ORDER BY ABS(captured_at - ?)"
    )
    .bind(now - 30 * 3_600_000, now - 18 * 3_600_000, target)
    .all<SnapshotRow>();
  const out: Record<string, SnapshotRow> = {};
  for (const r of results ?? []) out[r.symbol] ??= r;
  return out;
}

async function maybeRecord(db: D1Database, up: Upstream, now: number): Promise<boolean> {
  if (!up.fx) return false;
  const usdLkr = up.fx.rates.LKR!;
  const last = await db
    .prepare("SELECT MAX(captured_at) AS at FROM market_snapshots")
    .first<{ at: number | null }>();
  if (last?.at != null && now - last.at < SNAPSHOT_EVERY_MS) return false;
  const stmts = Object.entries(up.quotes).map(([symbol, q]) =>
    db
      .prepare("INSERT INTO market_snapshots (id, captured_at, symbol, price_usd, usd_lkr) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), now, symbol, q.priceUsd, usdLkr)
  );
  if (!stmts.length) return false;
  await db.batch(stmts);
  return true;
}

/** Cron entry: store a snapshot (at most every 10 min) and drop ones older than ~13 months. */
export async function recordMarketSnapshot(db: D1Database, opts: MarketOpts = {}): Promise<boolean> {
  const now = opts.now ?? Date.now();
  const up = await loadUpstream({ ...opts, now });
  const wrote = await maybeRecord(db, up, now);
  await db.prepare("DELETE FROM market_snapshots WHERE captured_at < ?").bind(now - SNAPSHOT_KEEP_MS).run();
  return wrote;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (now: number, then: number) => (then > 0 ? Math.round(((now - then) / then) * 10000) / 100 : null);

export type LiveMarket = {
  fetchedAt: number;
  /** True when any figure below comes from a stored snapshot because the upstream failed. */
  stale: boolean;
  usdLkr: number;
  fxUpdatedAt: number;
  sources: { name: string; url: string }[];
  quotes: {
    symbol: string;
    name: string;
    kind: MarketSymbol["kind"];
    unit: MarketSymbol["unit"];
    priceUsd: number;
    priceLkr: number;
    lkrPerGram: number | null;
    updatedAt: number;
    stale: boolean;
    change24hPct: number | null;
  }[];
  karats: {
    purityId: string;
    karat: string;
    purity: number;
    lkrPerGram: number;
    lkrPerPawn: number;
    change24hPct: number | null;
    boardRate: number | null;
    boardEffectiveFrom: number | null;
    /** Board vs market, % of market. Positive = board above market. */
    boardDiffPct: number | null;
  }[];
  fx: { code: string; perUsd: number; lkrPer: number }[];
  /** Every currency the feed quotes, units per 1 USD; lets the viewer show prices in any of them. */
  rates: Record<string, number>;
};

export async function liveMarket(db: D1Database, opts: MarketOpts = {}): Promise<LiveMarket> {
  const now = opts.now ?? Date.now();
  const up = await loadUpstream({ ...opts, now });
  const [latest, dayAgo] = await Promise.all([latestSnapshots(db), dayAgoSnapshots(db, now)]);
  const anyLatest = Object.values(latest).sort((a, b) => b.captured_at - a.captured_at)[0];

  const usdLkr = up.fx?.rates.LKR ?? anyLatest?.usd_lkr;
  if (!usdLkr)
    throw Object.assign(new Error("Market data is unavailable right now. Try again shortly."), { code: "UNAVAILABLE" });
  let stale = !up.fx;

  const quotes: LiveMarket["quotes"] = [];
  for (const s of MARKET_SYMBOLS) {
    const live = up.quotes[s.symbol];
    const snap = latest[s.symbol];
    const q = live ?? (snap ? { priceUsd: snap.price_usd, updatedAt: snap.captured_at } : null);
    if (!q) continue;
    if (!live) stale = true;
    const prev = dayAgo[s.symbol];
    quotes.push({
      symbol: s.symbol,
      name: s.name,
      kind: s.kind,
      unit: s.unit,
      priceUsd: q.priceUsd,
      priceLkr: r2(q.priceUsd * usdLkr),
      lkrPerGram: s.gramsPerUnit ? r2((q.priceUsd * usdLkr) / s.gramsPerUnit) : null,
      updatedAt: q.updatedAt,
      stale: !live,
      change24hPct: prev ? pct(q.priceUsd, prev.price_usd) : null,
    });
  }

  const gold = quotes.find((q) => q.symbol === "XAU");
  const karats: LiveMarket["karats"] = [];
  if (gold) {
    const goldPrev = dayAgo.XAU;
    const prevLkrG = goldPrev ? (goldPrev.price_usd * goldPrev.usd_lkr) / TROY_OZ_G : null;
    const fineLkrG = (gold.priceUsd * usdLkr) / TROY_OZ_G;
    const [{ results: purities }, board] = await Promise.all([
      db
        .prepare("SELECT id, karat, permille / 1000.0 AS purity FROM purities WHERE is_active = 1 ORDER BY permille DESC")
        .all<{ id: string; karat: string; purity: number }>(),
      currentGoldRatesCents(db),
    ]);
    const boardBy = new Map(board.map((b) => [b.purity_id, b]));
    for (const p of purities ?? []) {
      const lkrPerGram = r2(fineLkrG * p.purity);
      const b = boardBy.get(p.id);
      const boardRate = b ? centsToLkr(b.rate_cents_per_g) : null;
      karats.push({
        purityId: p.id,
        karat: p.karat,
        purity: p.purity,
        lkrPerGram,
        lkrPerPawn: r2(lkrPerGram * PAWN_G),
        change24hPct: prevLkrG ? pct(fineLkrG, prevLkrG) : null,
        boardRate,
        boardEffectiveFrom: b?.effective_from ?? null,
        boardDiffPct: boardRate != null ? pct(boardRate, lkrPerGram) : null,
      });
    }
  }

  const fx: LiveMarket["fx"] = up.fx
    ? FX_CODES.filter((c) => up.fx!.rates[c]! > 0).map((code) => {
        const perUsd = up.fx!.rates[code]!;
        return { code, perUsd, lkrPer: Math.round((usdLkr / perUsd) * 10000) / 10000 };
      })
    : [{ code: "USD", perUsd: 1, lkrPer: usdLkr }];

  // Opening the board doubles as a sampler between cron ticks; a failed write
  // must not cost the viewer their prices.
  await maybeRecord(db, up, now).catch((e) => console.error("market snapshot failed", e));

  return {
    fetchedAt: up.fetchedAt,
    stale,
    usdLkr,
    fxUpdatedAt: up.fx?.updatedAt ?? anyLatest?.captured_at ?? now,
    sources: [
      { name: "gold-api.com", url: "https://gold-api.com" },
      { name: "ExchangeRate-API", url: "https://www.exchangerate-api.com" },
    ],
    quotes,
    karats,
    fx,
    rates: up.fx
      ? Object.fromEntries(Object.entries(up.fx.rates).filter(([, v]) => Number(v) > 0))
      : { USD: 1, LKR: usdLkr },
  };
}

export const HISTORY_RANGES = { "1d": DAY_MS, "7d": 7 * DAY_MS, "30d": 30 * DAY_MS, "1y": 365 * DAY_MS } as const;
export type HistoryRange = keyof typeof HISTORY_RANGES;
/** Bucket width per range, so a year of hourly samples stays a few hundred points. */
const BUCKET_MS: Record<HistoryRange, number> = { "1d": 0, "7d": 3_600_000, "30d": 6 * 3_600_000, "1y": DAY_MS };

export type MarketHistory = {
  symbol: string;
  name: string;
  unit: MarketSymbol["unit"];
  range: HistoryRange;
  points: { t: number; priceUsd: number; priceLkr: number; lkrPerGram: number | null }[];
};

export async function marketHistory(
  db: D1Database,
  symbol: string,
  range: HistoryRange,
  now = Date.now()
): Promise<MarketHistory> {
  const meta = MARKET_SYMBOLS.find((s) => s.symbol === symbol);
  if (!meta) throw Object.assign(new Error("Unknown symbol"), { code: "VALIDATION" });
  const { results } = await db
    .prepare(
      "SELECT captured_at, price_usd, usd_lkr FROM market_snapshots WHERE symbol = ? AND captured_at >= ? ORDER BY captured_at"
    )
    .bind(symbol, now - HISTORY_RANGES[range])
    .all<{ captured_at: number; price_usd: number; usd_lkr: number }>();
  const bucket = BUCKET_MS[range];
  // Keep the last sample in each bucket (a close, not an average).
  const rows = bucket
    ? [...new Map((results ?? []).map((r) => [Math.floor(r.captured_at / bucket), r])).values()]
    : (results ?? []);
  return {
    symbol,
    name: meta.name,
    unit: meta.unit,
    range,
    points: rows.map((r) => {
      const lkr = r.price_usd * r.usd_lkr;
      return {
        t: r.captured_at,
        priceUsd: r.price_usd,
        priceLkr: r2(lkr),
        lkrPerGram: meta.gramsPerUnit ? r2(lkr / meta.gramsPerUnit) : null,
      };
    }),
  };
}
