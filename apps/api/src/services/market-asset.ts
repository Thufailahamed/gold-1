// One market in depth, for the per-asset page under Live Rates. Spot and the
// LKR rate still come from liveMarket (gold-api.com + ExchangeRate-API); this
// adds what those feeds can't give, all from free keyless sources:
//   - Yahoo Finance chart API: OHLC + volume, previous close, day and 52-week
//     range, long history (metals are COMEX/NYMEX front-month futures)
//   - Yahoo Finance RSS: headlines per instrument
//   - Wikipedia REST summary: the "About" paragraph
// Responses are cached per isolate so a busy page costs the upstreams little.
import { MARKET_SYMBOLS, PAWN_G, liveMarket, type MarketOpts } from "./market";

const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const NEWS_URL = "https://feeds.finance.yahoo.com/rss/2.0/headline?region=US&lang=en-US&s=";
const WIKI_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; GoldOS/1.0)", Accept: "application/json, application/xml, text/xml" };

/** Yahoo instrument behind each board symbol, and what it is. */
const YAHOO: Record<string, { ticker: string; venue: string; instrument: string; wiki: string; topic: RegExp }> = {
  XAU: { ticker: "GC=F", venue: "COMEX", instrument: "Gold futures (front month)", wiki: "Gold", topic: /gold|bullion|precious/i },
  XAG: { ticker: "SI=F", venue: "COMEX", instrument: "Silver futures (front month)", wiki: "Silver", topic: /silver|precious|bullion/i },
  XPT: { ticker: "PL=F", venue: "NYMEX", instrument: "Platinum futures (front month)", wiki: "Platinum", topic: /platinum|precious|pgm/i },
  XPD: { ticker: "PA=F", venue: "NYMEX", instrument: "Palladium futures (front month)", wiki: "Palladium", topic: /palladium|precious|pgm/i },
  HG: { ticker: "HG=F", venue: "COMEX", instrument: "Copper futures (front month)", wiki: "Copper", topic: /copper|metals?\b|mining/i },
  BTC: { ticker: "BTC-USD", venue: "CCC", instrument: "Bitcoin / US dollar", wiki: "Bitcoin", topic: /bitcoin|btc|crypto/i },
  ETH: { ticker: "ETH-USD", venue: "CCC", instrument: "Ether / US dollar", wiki: "Ethereum", topic: /ether|eth\b|crypto/i },
};
const LKR_TICKER = "LKR=X";

/** Reference facts that no free feed serves cleanly; stable enough to ship. */
const FACTS: Record<string, { k: string; v: string }[]> = {
  XAU: [
    { k: "Element", v: "Au · atomic no. 79" },
    { k: "Density", v: "19.32 g/cm³" },
    { k: "Melting point", v: "1,064 °C" },
    { k: "Top producers", v: "China, Russia, Australia" },
    { k: "Main demand", v: "Jewellery, central banks, bars & coins" },
    { k: "Trading hours", v: "~23h a day, Sun–Fri (CME Globex)" },
  ],
  XAG: [
    { k: "Element", v: "Ag · atomic no. 47" },
    { k: "Density", v: "10.49 g/cm³" },
    { k: "Melting point", v: "962 °C" },
    { k: "Top producers", v: "Mexico, China, Peru" },
    { k: "Main demand", v: "Industry (solar, electronics), jewellery" },
    { k: "In jewellery", v: "Alloyed into white and yellow karat gold" },
  ],
  XPT: [
    { k: "Element", v: "Pt · atomic no. 78" },
    { k: "Density", v: "21.45 g/cm³" },
    { k: "Melting point", v: "1,768 °C" },
    { k: "Top producers", v: "South Africa, Russia, Zimbabwe" },
    { k: "Main demand", v: "Autocatalysts, jewellery, industry" },
    { k: "Hallmarks", v: "Pt950 / Pt900 common in jewellery" },
  ],
  XPD: [
    { k: "Element", v: "Pd · atomic no. 46" },
    { k: "Density", v: "12.02 g/cm³" },
    { k: "Melting point", v: "1,555 °C" },
    { k: "Top producers", v: "Russia, South Africa" },
    { k: "Main demand", v: "Petrol-engine catalytic converters" },
    { k: "In jewellery", v: "Whitening alloy for nickel-free white gold" },
  ],
  HG: [
    { k: "Element", v: "Cu · atomic no. 29" },
    { k: "Density", v: "8.96 g/cm³" },
    { k: "Melting point", v: "1,085 °C" },
    { k: "Top producers", v: "Chile, DR Congo, Peru" },
    { k: "Main demand", v: "Wiring, construction, EVs, grids" },
    { k: "In jewellery", v: "The main alloy in 22K/18K yellow & rose gold" },
  ],
  BTC: [
    { k: "Launched", v: "January 2009" },
    { k: "Max supply", v: "21,000,000 BTC" },
    { k: "Consensus", v: "Proof of work" },
    { k: "Block time", v: "~10 minutes" },
    { k: "Smallest unit", v: "1 satoshi = 0.00000001 BTC" },
    { k: "Trading hours", v: "24/7" },
  ],
  ETH: [
    { k: "Launched", v: "July 2015" },
    { k: "Max supply", v: "No fixed cap" },
    { k: "Consensus", v: "Proof of stake (since 2022)" },
    { k: "Block time", v: "~12 seconds" },
    { k: "Smallest unit", v: "1 wei = 10⁻¹⁸ ETH" },
    { k: "Trading hours", v: "24/7" },
  ],
};

export const ASSET_RANGES = {
  "1d": { range: "1d", interval: "5m" },
  "7d": { range: "5d", interval: "30m" },
  "1m": { range: "1mo", interval: "90m" },
  "3m": { range: "3mo", interval: "1d" },
  "1y": { range: "1y", interval: "1d" },
  "5y": { range: "5y", interval: "1wk" },
  max: { range: "max", interval: "1mo" },
} as const;
export type AssetRange = keyof typeof ASSET_RANGES;

/* ---------------------------------------------------------------- cache */

const cache = new Map<string, { at: number; data: unknown }>();
async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data as T;
  const data = await load();
  cache.set(key, { at: Date.now(), data });
  return data;
}

/* ---------------------------------------------------------------- upstreams */

type ChartMeta = {
  currency?: string;
  exchangeName?: string;
  fullExchangeName?: string;
  shortName?: string;
  regularMarketPrice?: number;
  regularMarketTime?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  firstTradeDate?: number;
};
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
type Chart = { meta: ChartMeta; candles: Candle[] };

async function chart(fetcher: typeof fetch, ticker: string, range: string, interval: string): Promise<Chart> {
  const url = `${CHART_URL}${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`;
  const res = await fetcher(url, { headers: UA, signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`chart ${ticker} → ${res.status}`);
  const body = (await res.json()) as {
    chart?: { result?: { meta: ChartMeta; timestamp?: number[]; indicators?: { quote?: Record<string, (number | null)[]>[] } }[] };
  };
  const r = body.chart?.result?.[0];
  if (!r) throw new Error(`chart ${ticker} → empty`);
  const q = r.indicators?.quote?.[0] ?? {};
  const candles: Candle[] = [];
  (r.timestamp ?? []).forEach((ts, i) => {
    const c = q.close?.[i];
    if (c == null || !Number.isFinite(c)) return;
    const o = q.open?.[i] ?? c;
    candles.push({
      t: ts * 1000,
      o,
      h: Math.max(q.high?.[i] ?? c, o, c),
      l: Math.min(q.low?.[i] ?? c, o, c),
      c,
      v: q.volume?.[i] ?? 0,
    });
  });
  return { meta: r.meta, candles };
}

export const cachedChart = (f: typeof fetch, ticker: string, range: string, interval: string) =>
  cached(`c:${ticker}:${range}:${interval}`, interval.endsWith("m") ? 60_000 : 15 * 60_000, () => chart(f, ticker, range, interval));

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();

export type NewsItem = { title: string; link: string; source: string; at: number; summary: string };

async function news(fetcher: typeof fetch, ticker: string): Promise<NewsItem[]> {
  const res = await fetcher(NEWS_URL + encodeURIComponent(ticker), { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`news ${ticker} → ${res.status}`);
  const xml = await res.text();
  const tag = (block: string, name: string) => decode(block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "");
  const out: NewsItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1]!;
    const link = tag(b, "link").replace(/\?\.tsrc=rss$/, "");
    if (!/^https?:\/\//.test(link)) continue;
    let source = "";
    try {
      source = new URL(link).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    out.push({ title: tag(b, "title"), link, source, at: Date.parse(tag(b, "pubDate")) || 0, summary: tag(b, "description").slice(0, 280) });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 12);
}

export type About = { extract: string; url: string; image: string | null };

async function about(fetcher: typeof fetch, page: string): Promise<About> {
  const res = await fetcher(WIKI_URL + encodeURIComponent(page), { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`wiki ${page} → ${res.status}`);
  const b = (await res.json()) as { extract?: string; content_urls?: { desktop?: { page?: string } }; thumbnail?: { source?: string } };
  return {
    extract: b.extract ?? "",
    url: b.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${page}`,
    image: b.thumbnail?.source ?? null,
  };
}

const settle = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch (e) {
    console.error("market asset upstream", (e as Error).message);
    return null;
  }
};

/* ---------------------------------------------------------------- maths */

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const chg = (now: number, then: number | undefined) => (then && then > 0 ? r2(((now - then) / then) * 100) : null);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const logReturns = (cs: number[]) => cs.slice(1).map((c, i) => Math.log(c / cs[i]!));
const sma = (cs: number[], n: number) => (cs.length >= n ? mean(cs.slice(-n)) : null);

function rsi(cs: number[], n = 14): number | null {
  if (cs.length <= n) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = cs[i]! - cs[i - 1]!;
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < cs.length; i++) {
    const d = cs[i]! - cs[i - 1]!;
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  return loss === 0 ? 100 : r2(100 - 100 / (1 + gain / loss));
}

function corr(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 20) return null;
  const x = a.slice(-n);
  const y = b.slice(-n);
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
    syy += (y[i]! - my) ** 2;
  }
  return sxx && syy ? r2(sxy / Math.sqrt(sxx * syy)) : null;
}

/** Close on or before `t` (series sorted by time). */
function closeAt(cs: Candle[], t: number): number | undefined {
  let lo = 0;
  let hi = cs.length - 1;
  let found: number | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cs[mid]!.t <= t) {
      found = cs[mid]!.c;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Daily returns keyed by UTC day, so two markets can be paired day by day. */
const dayReturns = (cs: Candle[]) => {
  const m = new Map<number, number>();
  for (let i = 1; i < cs.length; i++) m.set(Math.floor(cs[i]!.t / 86_400_000), Math.log(cs[i]!.c / cs[i - 1]!.c));
  return m;
};

/* ---------------------------------------------------------------- the page */

export type MarketAsset = {
  symbol: string;
  name: string;
  kind: "metal" | "crypto";
  unit: "oz" | "lb" | "coin";
  gramsPerUnit: number | null;
  instrument: { ticker: string; venue: string; name: string; exchange: string; currency: string; since: number | null };
  usdLkr: number;
  stale: boolean;
  fetchedAt: number;
  /** Spot from the board feed; futures/markets figures below come from Yahoo. */
  spot: { priceUsd: number; priceLkr: number; lkrPerGram: number | null; lkrPerPawn: number | null; updatedAt: number; change24hPct: number | null } | null;
  quote: {
    price: number;
    prevClose: number | null;
    open: number | null;
    dayHigh: number | null;
    dayLow: number | null;
    volume: number | null;
    avgVolume30d: number | null;
    high52: number | null;
    low52: number | null;
    change: number | null;
    changePct: number | null;
    marketTime: number | null;
    /** Futures minus spot, % of spot (metals only). */
    basisPct: number | null;
  } | null;
  range: AssetRange;
  candles: (Candle & { lkr: number })[];
  performance: { key: string; label: string; pct: number | null }[];
  stats: {
    athUsd: number | null;
    athAt: number | null;
    fromAthPct: number | null;
    atlUsd: number | null;
    atlAt: number | null;
    vol30d: number | null;
    vol1y: number | null;
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
    rsi14: number | null;
    maxDrawdown1yPct: number | null;
    bestDay: { at: number; pct: number } | null;
    worstDay: { at: number; pct: number } | null;
    upDays1y: number;
    downDays1y: number;
  };
  /** Average % change per calendar month across the long history (seasonality). */
  seasonality: { month: number; avgPct: number; upYears: number; years: number }[];
  /** Year-end returns from the long history. */
  yearly: { year: number; pct: number }[];
  related: { symbol: string; name: string; priceUsd: number | null; changePct: number | null; corr1y: number | null; spark: number[] }[];
  karats: { karat: string; purity: number; lkrPerGram: number; lkrPerPawn: number; boardRate: number | null; boardDiffPct: number | null }[];
  facts: { k: string; v: string }[];
  about: About | null;
  news: NewsItem[];
  sources: { name: string; url: string; what: string }[];
};

export async function marketAsset(db: D1Database, symbol: string, range: AssetRange, opts: MarketOpts = {}): Promise<MarketAsset> {
  const meta = MARKET_SYMBOLS.find((s) => s.symbol === symbol);
  const y = YAHOO[symbol];
  if (!meta || !y) throw Object.assign(new Error("Unknown symbol"), { code: "VALIDATION" });
  const f = opts.fetcher ?? fetch;
  const { range: yr, interval } = ASSET_RANGES[range];

  const [live, intraday, main, lkr, daily5y, monthly, newsItems, wiki, ...peers] = await Promise.all([
    settle(liveMarket(db, opts)),
    settle(cachedChart(f, y.ticker, "1d", "5m")),
    settle(cachedChart(f, y.ticker, yr, interval)),
    settle(cachedChart(f, LKR_TICKER, yr, interval)),
    settle(cachedChart(f, y.ticker, "5y", "1d")),
    settle(cachedChart(f, y.ticker, "max", "1mo")),
    settle(cached(`n:${y.ticker}`, 10 * 60_000, () => news(f, y.ticker))),
    settle(cached(`w:${y.wiki}`, 24 * 3_600_000, () => about(f, y.wiki))),
    ...MARKET_SYMBOLS.filter((s) => s.symbol !== symbol).map((s) => settle(cachedChart(f, YAHOO[s.symbol]!.ticker, "1y", "1d"))),
  ]);

  if (!live && !main && !intraday)
    throw Object.assign(new Error("Market data is unavailable right now. Try again shortly."), { code: "UNAVAILABLE" });

  const usdLkr = live?.usdLkr ?? lkr?.meta.regularMarketPrice ?? 0;
  const spotQ = live?.quotes.find((q) => q.symbol === symbol);
  const spot = spotQ
    ? {
        priceUsd: spotQ.priceUsd,
        priceLkr: spotQ.priceLkr,
        lkrPerGram: spotQ.lkrPerGram,
        lkrPerPawn: spotQ.lkrPerGram != null ? r2(spotQ.lkrPerGram * PAWN_G) : null,
        updatedAt: spotQ.updatedAt,
        change24hPct: spotQ.change24hPct,
      }
    : null;

  // Candles in the selected range, each with its LKR value at that moment.
  const lkrCs = lkr?.candles ?? [];
  const candles = (main?.candles ?? []).map((c) => ({ ...c, lkr: r2(c.c * (closeAt(lkrCs, c.t) ?? lkrCs[0]?.c ?? usdLkr)) }));

  // Daily closes over five years drive every derived figure.
  const d = daily5y?.candles ?? [];
  const closes = d.map((c) => c.c);
  // The intraday request carries the session figures; a long range's
  // chartPreviousClose is the close before the range, not yesterday's.
  const qm = intraday?.meta ?? main?.meta;
  const last = qm?.regularMarketPrice ?? closes[closes.length - 1] ?? spot?.priceUsd ?? 0;
  const lastT = d[d.length - 1]?.t ?? Date.now();
  const back = (days: number) => closeAt(d, lastT - days * 86_400_000);
  const ytdStart = closeAt(d, Date.UTC(new Date(lastT).getUTCFullYear(), 0, 1) - 1);
  const prevClose = intraday?.meta.previousClose ?? intraday?.meta.chartPreviousClose ?? (closes.length > 1 ? closes[closes.length - 2]! : null);

  const performance = [
    { key: "1d", label: "24h", pct: prevClose ? chg(last, prevClose) : null },
    { key: "7d", label: "7 days", pct: chg(last, back(7)) },
    { key: "1m", label: "1 month", pct: chg(last, back(30)) },
    { key: "3m", label: "3 months", pct: chg(last, back(91)) },
    { key: "6m", label: "6 months", pct: chg(last, back(182)) },
    { key: "ytd", label: "Year to date", pct: chg(last, ytdStart) },
    { key: "1y", label: "1 year", pct: chg(last, back(365)) },
    { key: "3y", label: "3 years", pct: chg(last, back(3 * 365)) },
    { key: "5y", label: "5 years", pct: d.length ? chg(last, d[0]!.c) : null },
  ];

  // All-time figures from the monthly history (and the daily tail for precision).
  const longCs = [...(monthly?.candles ?? []), ...d];
  let ath: Candle | null = null;
  let atl: Candle | null = null;
  for (const c of longCs) {
    if (!ath || c.h > ath.h) ath = c;
    if (!atl || c.l < atl.l) atl = c;
  }

  const year = d.filter((c) => c.t >= lastT - 365 * 86_400_000);
  const yCloses = year.map((c) => c.c);
  const rets = logReturns(yCloses);
  const annual = meta.kind === "crypto" ? Math.sqrt(365) : Math.sqrt(252);
  let peak = 0;
  let dd = 0;
  for (const c of yCloses) {
    peak = Math.max(peak, c);
    dd = Math.min(dd, peak ? (c - peak) / peak : 0);
  }
  let best: { at: number; pct: number } | null = null;
  let worst: { at: number; pct: number } | null = null;
  let up = 0;
  let down = 0;
  for (let i = 1; i < year.length; i++) {
    const p = ((year[i]!.c - year[i - 1]!.c) / year[i - 1]!.c) * 100;
    if (p > 0) up++;
    else if (p < 0) down++;
    if (!best || p > best.pct) best = { at: year[i]!.t, pct: r2(p) };
    if (!worst || p < worst.pct) worst = { at: year[i]!.t, pct: r2(p) };
  }
  const vols = d.slice(-30).map((c) => c.v).filter((v) => v > 0);

  // Seasonality and calendar-year returns from monthly closes.
  const mc = monthly?.candles ?? [];
  const byMonth = Array.from({ length: 12 }, () => [] as number[]);
  for (let i = 1; i < mc.length; i++) {
    const p = ((mc[i]!.c - mc[i - 1]!.c) / mc[i - 1]!.c) * 100;
    if (Number.isFinite(p)) byMonth[new Date(mc[i]!.t).getUTCMonth()]!.push(p);
  }
  const yearEnd = new Map<number, number>();
  for (const c of mc) yearEnd.set(new Date(c.t).getUTCFullYear(), c.c);
  const years = [...yearEnd.keys()].sort();
  const yearly = years
    .slice(1)
    .map((yy, i) => ({ year: yy, pct: r2(((yearEnd.get(yy)! - yearEnd.get(years[i]!)!) / yearEnd.get(years[i]!)!) * 100) }))
    .slice(-12);

  // Peers: last price, 1y daily correlation and a 3-month sparkline.
  const mine = dayReturns(year);
  const others = MARKET_SYMBOLS.filter((s) => s.symbol !== symbol);
  const related = others.map((s, i) => {
    const pc = peers[i]?.candles ?? [];
    const theirs = dayReturns(pc);
    const a: number[] = [];
    const b: number[] = [];
    for (const [day, r] of mine) {
      const o = theirs.get(day);
      if (o != null) {
        a.push(r);
        b.push(o);
      }
    }
    const q = live?.quotes.find((x) => x.symbol === s.symbol);
    const lastPeer = pc[pc.length - 1]?.c;
    return {
      symbol: s.symbol,
      name: s.name,
      priceUsd: q?.priceUsd ?? lastPeer ?? null,
      changePct: q?.change24hPct ?? (pc.length > 1 ? chg(lastPeer!, pc[pc.length - 2]!.c) : null),
      corr1y: corr(a, b),
      spark: pc.slice(-90).map((c) => r4(c.c)),
    };
  });

  const futures = qm?.regularMarketPrice ?? null;
  // Headlines about this market first; the feed mixes in general finance.
  const allNews = newsItems ?? [];
  const onTopic = allNews.filter((n) => y.topic.test(`${n.title} ${n.summary}`));
  const shownNews = onTopic.length >= 4 ? onTopic : [...onTopic, ...allNews.filter((n) => !onTopic.includes(n))].slice(0, 8);
  return {
    symbol,
    name: meta.name,
    kind: meta.kind,
    unit: meta.unit,
    gramsPerUnit: meta.gramsPerUnit,
    instrument: {
      ticker: y.ticker,
      venue: y.venue,
      name: qm?.shortName ?? y.instrument,
      exchange: qm?.fullExchangeName ?? y.venue,
      currency: qm?.currency ?? "USD",
      since: qm?.firstTradeDate ? qm.firstTradeDate * 1000 : null,
    },
    usdLkr,
    stale: live?.stale ?? true,
    fetchedAt: Date.now(),
    spot,
    quote: futures
      ? {
          price: futures,
          prevClose,
          open: intraday?.candles[0]?.o ?? d[d.length - 1]?.o ?? null,
          dayHigh: qm?.regularMarketDayHigh ?? null,
          dayLow: qm?.regularMarketDayLow ?? null,
          volume: qm?.regularMarketVolume ?? null,
          avgVolume30d: vols.length ? Math.round(mean(vols)) : null,
          high52: qm?.fiftyTwoWeekHigh ?? null,
          low52: qm?.fiftyTwoWeekLow ?? null,
          change: prevClose ? r4(futures - prevClose) : null,
          changePct: prevClose ? chg(futures, prevClose) : null,
          marketTime: qm?.regularMarketTime ? qm.regularMarketTime * 1000 : null,
          basisPct: meta.kind === "metal" && spot ? chg(futures, spot.priceUsd) : null,
        }
      : null,
    range,
    candles,
    performance,
    stats: {
      athUsd: ath?.h ?? null,
      athAt: ath?.t ?? null,
      fromAthPct: ath ? chg(spot?.priceUsd ?? last, ath.h) : null,
      atlUsd: atl?.l ?? null,
      atlAt: atl?.t ?? null,
      vol30d: closes.length > 31 ? r2(sd(logReturns(closes.slice(-31))) * annual * 100) : null,
      vol1y: rets.length > 20 ? r2(sd(rets) * annual * 100) : null,
      sma20: sma(closes, 20),
      sma50: sma(closes, 50),
      sma200: sma(closes, 200),
      rsi14: rsi(closes.slice(-120)),
      maxDrawdown1yPct: yCloses.length ? r2(dd * 100) : null,
      bestDay: best,
      worstDay: worst,
      upDays1y: up,
      downDays1y: down,
    },
    seasonality: byMonth.map((xs, month) => ({ month, avgPct: r2(mean(xs)), upYears: xs.filter((x) => x > 0).length, years: xs.length })),
    yearly,
    related,
    karats:
      symbol === "XAU"
        ? (live?.karats ?? []).map((k) => ({
            karat: k.karat,
            purity: k.purity,
            lkrPerGram: k.lkrPerGram,
            lkrPerPawn: k.lkrPerPawn,
            boardRate: k.boardRate,
            boardDiffPct: k.boardDiffPct,
          }))
        : [],
    facts: FACTS[symbol] ?? [],
    about: wiki,
    news: shownNews,
    sources: [
      { name: "gold-api.com", url: "https://gold-api.com", what: "Spot price" },
      { name: "ExchangeRate-API", url: "https://www.exchangerate-api.com", what: "USD → LKR" },
      { name: "Yahoo Finance", url: `https://finance.yahoo.com/quote/${encodeURIComponent(y.ticker)}`, what: "Chart, volume, ranges, news" },
      { name: "Wikipedia", url: wiki?.url ?? "https://en.wikipedia.org", what: "About (CC BY-SA)" },
    ],
  };
}


/* ---------------------------------------------------------------- long history */

const LONG_RANGES = {
  "1d": { range: "1d", interval: "5m" },
  "7d": { range: "5d", interval: "30m" },
  "30d": { range: "1mo", interval: "90m" },
  "1y": { range: "1y", interval: "1d" },
} as const;
export type LongRange = keyof typeof LONG_RANGES;
export const isLongRange = (r: string): r is LongRange => r in LONG_RANGES;

/**
 * Price history for the board's charts when our own snapshots are too young
 * to cover the range. Yahoo's series (futures for metals) is scaled by the
 * current spot/futures ratio so the line ends exactly on the spot price the
 * cards show; each point is converted at that moment's USD/LKR.
 */
export async function longHistory(db: D1Database, symbol: string, range: LongRange, opts: MarketOpts = {}) {
  const meta = MARKET_SYMBOLS.find((s) => s.symbol === symbol);
  const y = YAHOO[symbol];
  if (!meta || !y) throw Object.assign(new Error("Unknown symbol"), { code: "VALIDATION" });
  const f = opts.fetcher ?? fetch;
  const { range: yr, interval } = LONG_RANGES[range];
  const [live, main, lkr] = await Promise.all([
    settle(liveMarket(db, opts)),
    settle(cachedChart(f, y.ticker, yr, interval)),
    settle(cachedChart(f, LKR_TICKER, yr, interval)),
  ]);
  const cs = main?.candles ?? [];
  if (cs.length < 2) throw Object.assign(new Error("History is unavailable right now."), { code: "UNAVAILABLE" });
  const spot = live?.quotes.find((q) => q.symbol === symbol)?.priceUsd;
  const lastFut = cs[cs.length - 1]!.c;
  const basis = spot && lastFut > 0 ? spot / lastFut : 1;
  const usdLkr = live?.usdLkr ?? lkr?.meta.regularMarketPrice ?? 0;
  const fx = lkr?.candles ?? [];
  const point = (t: number, usd: number, rate: number) => {
    const lkrV = usd * rate;
    return { t, priceUsd: r4(usd), priceLkr: r2(lkrV), lkrPerGram: meta.gramsPerUnit ? r2(lkrV / meta.gramsPerUnit) : null };
  };
  const points = cs.map((c) => point(c.t, c.c * basis, closeAt(fx, c.t) ?? fx[0]?.c ?? usdLkr));
  // End on the live quote, so the line finishes where the price cards are.
  const q = live?.quotes.find((x) => x.symbol === symbol);
  if (q && live && q.updatedAt > points[points.length - 1]!.t) points.push(point(q.updatedAt, q.priceUsd, live.usdLkr));
  return { symbol, name: meta.name, unit: meta.unit, range, source: "yahoo" as const, basisAdjustPct: r2((basis - 1) * 100), points };
}
