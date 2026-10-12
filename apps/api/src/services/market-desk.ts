// Rate desk: the decisions a jeweller makes from the market board.
//   - pricing policy → suggested board rate per karat, drift since publish
//   - import cost of a 24K bar landed in Sri Lanka, vs the board
//   - gold position (stock vs gold owed) and stock gains at today's price
//   - daily board/market log, competitor rates, price alerts
//   - what moves gold (dollar, yields, oil, equities) and an events calendar
// Nothing here posts to the books. Publishing a suggested rate still goes
// through createGoldRate and its approval rules.
import { businessDate, centsToLkr, lkrToCents } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import { tzOffsetMinutes } from "./busdate";
import { cachedChart, type Candle } from "./market-asset";
import { liveMarket, TROY_OZ_G, type LiveMarket, type MarketOpts } from "./market";
import { goldStock } from "./gold";
import { getSetting, putSetting } from "./settings";

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (now: number, then: number) => (then > 0 ? r2(((now - then) / then) * 100) : null);
const err = (message: string, code: string) => Object.assign(new Error(message), { code });

/* ================================================================ settings */

export type BoardPolicy = {
  /** Margin over the market per gram, % of market. */
  defaultMarginPct: number;
  /** Board rates are quoted in whole steps of this many rupees. */
  roundTo: number;
  roundMode: "nearest" | "up" | "down";
  /** Flag the board once the market has moved this % since it was published. */
  driftAlertPct: number;
  /** Purity assumed for custom-order gold, which is recorded as a weight only. */
  orderPermille: number;
  perKarat: Record<string, { marginPct?: number; roundTo?: number }>;
};
export const DEFAULT_POLICY: BoardPolicy = {
  defaultMarginPct: 0,
  roundTo: 50,
  roundMode: "nearest",
  driftAlertPct: 1,
  orderPermille: 916,
  perKarat: {},
};

export type ImportCosts = {
  /** Dealer/bank premium over spot, USD per troy ounce. */
  premiumUsdPerOz: number;
  /** Freight, insurance and bank charges, % of the bar's value. */
  bankFeePct: number;
  dutyPct: number;
  ssclPct: number;
  vatPct: number;
  /** Anything else per gram: assay, clearing, transport. */
  otherLkrPerG: number;
};
export const DEFAULT_IMPORT: ImportCosts = { premiumUsdPerOz: 0, bankFeePct: 0, dutyPct: 0, ssclPct: 0, vatPct: 0, otherLkrPerG: 0 };

export type UserEvent = { id: string; date: string; title: string; kind: "local" | "macro" | "shop"; note?: string };

const KEYS = { policy: "market.board_policy", imports: "market.import_costs", events: "market.events" } as const;

async function readJson<T extends object>(db: D1Database, key: string, fallback: T): Promise<T> {
  const s = await getSetting(db, key);
  if (!s || typeof s.value !== "object" || s.value === null) return fallback;
  return { ...fallback, ...(s.value as Partial<T>) };
}

export const readPolicy = (db: D1Database) => readJson(db, KEYS.policy, DEFAULT_POLICY);
export const readImportCosts = (db: D1Database) => readJson(db, KEYS.imports, DEFAULT_IMPORT);
export async function readEvents(db: D1Database): Promise<UserEvent[]> {
  const s = await getSetting(db, KEYS.events);
  return Array.isArray(s?.value) ? (s!.value as UserEvent[]) : [];
}

export async function savePolicy(db: D1Database, p: BoardPolicy, actorId: string) {
  await putSetting(db, KEYS.policy, p, "json", actorId);
}
export async function saveImportCosts(db: D1Database, c: ImportCosts, actorId: string) {
  await putSetting(db, KEYS.imports, c, "json", actorId);
}
export async function saveEvents(db: D1Database, events: UserEvent[], actorId: string) {
  const clean = [...events].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 200);
  await putSetting(db, KEYS.events, clean, "json", actorId);
}

export async function deskSettings(db: D1Database) {
  const [policy, importCosts, events, shop] = await Promise.all([readPolicy(db), readImportCosts(db), readEvents(db), getSetting(db, "shop_name")]);
  return { policy, importCosts, events, shopName: typeof shop?.value === "string" ? shop.value : "" };
}

/* ================================================================ suggested board */

export function roundRate(v: number, step: number, mode: BoardPolicy["roundMode"]) {
  if (!(step > 0)) return r2(v);
  const q = v / step;
  const n = mode === "up" ? Math.ceil(q - 1e-9) : mode === "down" ? Math.floor(q + 1e-9) : Math.round(q);
  return n * step;
}

/** Gold's LKR per fine gram at a moment, from the stored snapshot nearest to it (within 6h). */
async function fineLkrAt(db: D1Database, at: number): Promise<{ lkrPerG: number; at: number } | null> {
  const row = await db
    .prepare(
      "SELECT price_usd, usd_lkr, captured_at FROM market_snapshots WHERE symbol = 'XAU' AND captured_at BETWEEN ? AND ? ORDER BY ABS(captured_at - ?) LIMIT 1"
    )
    .bind(at - 6 * 3_600_000, at + 6 * 3_600_000, at)
    .first<{ price_usd: number; usd_lkr: number; captured_at: number }>();
  return row ? { lkrPerG: (row.price_usd * row.usd_lkr) / TROY_OZ_G, at: row.captured_at } : null;
}

export type Suggestion = {
  purityId: string;
  karat: string;
  purity: number;
  marketPerG: number;
  marginPct: number;
  roundTo: number;
  suggestedPerG: number;
  suggestedPerPawn: number;
  boardPerG: number | null;
  boardEffectiveFrom: number | null;
  /** Board vs suggested, % of suggested. */
  boardVsSuggestedPct: number | null;
  /** Market per gram of this karat when the board was published. */
  marketAtPublish: number | null;
  /** How far the market has moved since the board was published. */
  driftPct: number | null;
  stale: boolean;
};

export async function suggestBoard(db: D1Database, opts: MarketOpts = {}) {
  const [live, policy] = await Promise.all([liveMarket(db, opts), readPolicy(db)]);
  const rows: Suggestion[] = [];
  for (const k of live.karats) {
    const own = policy.perKarat[k.purityId] ?? {};
    const marginPct = own.marginPct ?? policy.defaultMarginPct;
    const roundTo = own.roundTo ?? policy.roundTo;
    const suggested = roundRate(k.lkrPerGram * (1 + marginPct / 100), roundTo, policy.roundMode);
    const then = k.boardEffectiveFrom ? await fineLkrAt(db, k.boardEffectiveFrom) : null;
    const marketAtPublish = then ? r2(then.lkrPerG * k.purity) : null;
    const driftPct = marketAtPublish ? pct(k.lkrPerGram, marketAtPublish) : null;
    rows.push({
      purityId: k.purityId,
      karat: k.karat,
      purity: k.purity,
      marketPerG: k.lkrPerGram,
      marginPct,
      roundTo,
      suggestedPerG: suggested,
      suggestedPerPawn: r2(suggested * 8),
      boardPerG: k.boardRate,
      boardEffectiveFrom: k.boardEffectiveFrom,
      boardVsSuggestedPct: k.boardRate != null ? pct(k.boardRate, suggested) : null,
      marketAtPublish,
      driftPct,
      stale: driftPct != null && Math.abs(driftPct) >= policy.driftAlertPct,
    });
  }
  return { policy, usdLkr: live.usdLkr, stale: live.stale, fetchedAt: live.fetchedAt, rows };
}

/* ================================================================ import parity */

export async function importParity(db: D1Database, opts: MarketOpts = {}) {
  const [live, c] = await Promise.all([liveMarket(db, opts), readImportCosts(db)]);
  const gold = live.quotes.find((q) => q.symbol === "XAU");
  if (!gold) throw err("Gold price is unavailable right now.", "UNAVAILABLE");
  const fx = live.usdLkr;
  // Per fine gram, step by step. Duty and SSCL are charged on the landed
  // (CIF) value; VAT on CIF plus those levies — the usual customs order.
  const spot = (gold.priceUsd * fx) / TROY_OZ_G;
  const premium = (c.premiumUsdPerOz * fx) / TROY_OZ_G;
  const bank = ((spot + premium) * c.bankFeePct) / 100;
  const cif = spot + premium + bank;
  const duty = (cif * c.dutyPct) / 100;
  const sscl = (cif * c.ssclPct) / 100;
  const vat = ((cif + duty + sscl) * c.vatPct) / 100;
  const other = c.otherLkrPerG;
  const landed = cif + duty + sscl + vat + other;
  const steps = [
    { k: "Spot", v: r2(spot) },
    { k: "Premium", v: r2(premium) },
    { k: "Freight, insurance & bank", v: r2(bank) },
    { k: "Import duty", v: r2(duty) },
    { k: "SSCL", v: r2(sscl) },
    { k: "VAT", v: r2(vat) },
    { k: "Other costs", v: r2(other) },
  ];
  return {
    costs: c,
    usdLkr: fx,
    spotUsd: gold.priceUsd,
    steps,
    landedPerG: r2(landed),
    landedPerPawn: r2(landed * 8),
    landedUsdPerOz: r2((landed * TROY_OZ_G) / fx),
    markupOverSpotPct: pct(landed, spot),
    karats: live.karats.map((k) => {
      const landedK = landed * k.purity;
      return {
        purityId: k.purityId,
        karat: k.karat,
        purity: k.purity,
        landedPerG: r2(landedK),
        boardPerG: k.boardRate,
        /** Board over landed cost, % of landed. */
        boardMarginPct: k.boardRate != null ? pct(k.boardRate, landedK) : null,
      };
    }),
  };
}

/* ================================================================ position */

export async function goldPosition(db: D1Database, opts: MarketOpts = {}) {
  const [live, policy, stage, purity] = await Promise.all([
    liveMarket(db, opts),
    readPolicy(db),
    goldStock(db, "stage") as Promise<{ stages: Record<string, number> }>,
    goldStock(db, "purity") as Promise<{ byPurity: { permille: number; fine_mg: number }[] }>,
  ]);
  const fineLkrG = live.karats.find((k) => k.purity >= 0.999)?.lkrPerGram ?? (live.quotes.find((q) => q.symbol === "XAU")?.lkrPerGram ?? 0);

  // Customer gold we have valued at a fixed price but not yet paid for.
  const committed = await db
    .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(fine_mg), 0) AS fine, COALESCE(SUM(purchase_value_cents), 0) AS value FROM old_gold_items WHERE status = 'VALUED'")
    .first<{ n: number; fine: number; value: number }>();
  // Customer gold in our hands but not ours (received / under test).
  const custody = await db
    .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(fine_mg), 0) AS fine FROM old_gold_items WHERE status IN ('RECEIVED', 'TESTED')")
    .first<{ n: number; fine: number }>();
  // Open custom orders priced up front with the shop supplying gold: we owe
  // that gold at today's quote, whatever it costs us later.
  const { results: orders } = await db
    .prepare(
      `SELECT o.id, o.number, o.branch_id, o.gold_source, o.gold_req_mg, o.quote_cents, o.advance_cents, o.status, o.created_at,
              COALESCE((SELECT SUM(g.fine_mg) FROM custom_order_gold g WHERE g.order_id = o.id AND g.kind = 'CUSTOMER_OLDGOLD'), 0) AS customer_fine
         FROM custom_orders o
        WHERE o.status IN ('QUOTE', 'ADVANCED', 'IN_PRODUCTION', 'READY') AND o.gold_source IN ('SHOP', 'MIXED')
        ORDER BY o.created_at`
    )
    .all<{ id: string; number: string; branch_id: string; gold_source: string; gold_req_mg: number; quote_cents: number; advance_cents: number; status: string; created_at: number; customer_fine: number }>();
  const owed = (orders ?? []).map((o) => {
    const fine = Math.max(0, Math.round((o.gold_req_mg * policy.orderPermille) / 1000) - o.customer_fine);
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      source: o.gold_source,
      fineMg: fine,
      quoteLkr: centsToLkr(o.quote_cents),
      advanceLkr: centsToLkr(o.advance_cents),
      createdAt: o.created_at,
      valueLkr: r2((fine / 1000) * fineLkrG),
    };
  });
  const stages = stage.stages;
  const longMg = (stages.old_gold_mg ?? 0) + (stages.melting_mg ?? 0) + (stages.refined_mg ?? 0) + (stages.for_sale_mg ?? 0);
  const owedMg = owed.reduce((s, o) => s + o.fineMg, 0);
  const committedMg = committed?.fine ?? 0;
  const netMg = longMg + committedMg - owedMg;
  const netValue = (netMg / 1000) * fineLkrG;
  const gold = live.quotes.find((q) => q.symbol === "XAU");
  return {
    fineLkrPerG: r2(fineLkrG),
    usdLkr: live.usdLkr,
    spotUsd: gold?.priceUsd ?? null,
    orderPermille: policy.orderPermille,
    stages: {
      oldGoldMg: stages.old_gold_mg ?? 0,
      meltingMg: stages.melting_mg ?? 0,
      refinedMg: stages.refined_mg ?? 0,
      forSaleMg: stages.for_sale_mg ?? 0,
    },
    byPurity: (purity.byPurity ?? []).map((p) => ({ permille: p.permille, fineMg: p.fine_mg, valueLkr: r2((p.fine_mg / 1000) * fineLkrG) })),
    longMg,
    committed: { count: committed?.n ?? 0, fineMg: committedMg, valueLkr: centsToLkr(committed?.value ?? 0) },
    custody: { count: custody?.n ?? 0, fineMg: custody?.fine ?? 0 },
    owed,
    owedMg,
    netMg,
    netValueLkr: r2(netValue),
    /** LKR gained (lost if negative) for a 1% rise in gold. */
    perPctLkr: r2(netValue / 100),
    /** LKR change for a USD 10/oz move at today's exchange rate. */
    perTenUsdLkr: r2(((netMg / 1000) * 10 * live.usdLkr) / TROY_OZ_G),
  };
}

/* ================================================================ stock gains */

export async function stockGains(db: D1Database, opts: MarketOpts = {}) {
  const live = await liveMarket(db, opts);
  const fineLkrG = live.karats.find((k) => k.purity >= 0.999)?.lkrPerGram ?? (live.quotes.find((q) => q.symbol === "XAU")?.lkrPerGram ?? 0);
  const { results: prod } = await db
    .prepare(
      `SELECT p.branch_id, b.name AS branch, pu.karat, pu.permille,
              COUNT(*) AS n,
              SUM(CASE WHEN p.cost_cents IS NOT NULL THEN 1 ELSE 0 END) AS costed,
              SUM(CASE WHEN p.cost_cents IS NOT NULL THEN p.fine_gold_mg ELSE 0 END) AS costed_fine,
              SUM(CASE WHEN p.cost_cents IS NOT NULL THEN MAX(p.cost_cents - p.making_cents, 0) ELSE 0 END) AS metal_cost,
              SUM(p.fine_gold_mg) AS fine
         FROM products p JOIN purities pu ON pu.id = p.purity_id LEFT JOIN branches b ON b.id = p.branch_id
        WHERE p.status IN ('IN_STOCK', 'RESERVED')
        GROUP BY p.branch_id, pu.karat, pu.permille`
    )
    .all<{ branch_id: string; branch: string | null; karat: string; permille: number; n: number; costed: number; costed_fine: number; metal_cost: number; fine: number }>();
  const { results: og } = await db
    .prepare(
      `SELECT o.branch_id, b.name AS branch, COUNT(*) AS n, SUM(o.fine_mg) AS fine, SUM(COALESCE(o.purchase_value_cents, o.paid_cents)) AS cost
         FROM old_gold_items o LEFT JOIN branches b ON b.id = o.branch_id
        WHERE o.status IN ('PURCHASED', 'AVAILABLE')
        GROUP BY o.branch_id`
    )
    .all<{ branch_id: string; branch: string | null; n: number; fine: number; cost: number }>();

  type Line = { key: string; label: string; branch: string; kind: "products" | "old_gold"; karat: string | null; count: number; costed: number; fineMg: number; costedFineMg: number; costLkr: number; valueLkr: number; gainLkr: number; gainPct: number | null };
  const lines: Line[] = [];
  for (const r of prod ?? []) {
    const value = (r.costed_fine / 1000) * fineLkrG;
    const cost = centsToLkr(r.metal_cost);
    lines.push({
      key: `p:${r.branch_id}:${r.karat}`,
      label: `${r.karat} jewellery`,
      branch: r.branch ?? r.branch_id,
      kind: "products",
      karat: r.karat,
      count: r.n,
      costed: r.costed,
      fineMg: r.fine,
      costedFineMg: r.costed_fine,
      costLkr: cost,
      valueLkr: r2(value),
      gainLkr: r2(value - cost),
      gainPct: cost > 0 ? pct(value, cost) : null,
    });
  }
  for (const r of og ?? []) {
    const value = (r.fine / 1000) * fineLkrG;
    const cost = centsToLkr(r.cost ?? 0);
    lines.push({
      key: `o:${r.branch_id}`,
      label: "Old gold bought",
      branch: r.branch ?? r.branch_id,
      kind: "old_gold",
      karat: null,
      count: r.n,
      costed: r.n,
      fineMg: r.fine,
      costedFineMg: r.fine,
      costLkr: cost,
      valueLkr: r2(value),
      gainLkr: r2(value - cost),
      gainPct: cost > 0 ? pct(value, cost) : null,
    });
  }
  lines.sort((a, b) => b.valueLkr - a.valueLkr);
  const sum = (f: (l: Line) => number) => r2(lines.reduce((s, l) => s + f(l), 0));
  const cost = sum((l) => l.costLkr);
  const value = sum((l) => l.valueLkr);
  return {
    fineLkrPerG: r2(fineLkrG),
    lines,
    totals: {
      costLkr: cost,
      valueLkr: value,
      gainLkr: r2(value - cost),
      gainPct: cost > 0 ? pct(value, cost) : null,
      items: lines.reduce((s, l) => s + l.count, 0),
      uncosted: lines.reduce((s, l) => s + (l.count - l.costed), 0),
      uncostedFineMg: lines.reduce((s, l) => s + (l.fineMg - l.costedFineMg), 0),
    },
  };
}

/* ================================================================ daily rate log */

export async function rateLog(db: D1Database, input: { from: string; to: string; purityId?: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to) || input.from > input.to)
    throw err("Invalid date range", "VALIDATION");
  const off = await tzOffsetMinutes(db);
  const dayStart = (d: string) => Date.parse(`${d}T00:00:00Z`) - off * 60_000;
  const fromMs = dayStart(input.from);
  const toMs = dayStart(input.to) + 86_400_000;
  if (toMs - fromMs > 400 * 86_400_000) throw err("Range is limited to 400 days", "VALIDATION");

  const { results: purities } = await db
    .prepare("SELECT id, karat, permille FROM purities WHERE is_active = 1 ORDER BY permille DESC")
    .all<{ id: string; karat: string; permille: number }>();
  const purity = (purities ?? []).find((p) => p.id === input.purityId) ?? (purities ?? [])[0];
  if (!purity) return { purity: null, purities: [], days: [] };

  // Board rate in force at the start of the range, then every change inside it.
  const opening = await db
    .prepare("SELECT rate_cents_per_g, effective_from FROM gold_rates WHERE purity_id = ? AND effective_from < ? ORDER BY effective_from DESC LIMIT 1")
    .bind(purity.id, fromMs)
    .first<{ rate_cents_per_g: number; effective_from: number }>();
  const { results: changes } = await db
    .prepare("SELECT rate_cents_per_g, effective_from FROM gold_rates WHERE purity_id = ? AND effective_from >= ? AND effective_from < ? ORDER BY effective_from")
    .bind(purity.id, fromMs, toMs)
    .all<{ rate_cents_per_g: number; effective_from: number }>();
  const { results: snaps } = await db
    .prepare("SELECT captured_at, price_usd, usd_lkr FROM market_snapshots WHERE symbol = 'XAU' AND captured_at >= ? AND captured_at < ? ORDER BY captured_at")
    .bind(fromMs, toMs)
    .all<{ captured_at: number; price_usd: number; usd_lkr: number }>();

  const p = purity.permille / 1000;
  type Day = {
    date: string;
    board: { open: number | null; close: number | null; high: number | null; low: number | null; changes: number };
    market: { open: number | null; close: number | null; high: number | null; low: number | null; samples: number };
    gapPct: number | null;
  };
  const days = new Map<string, Day>();
  const day = (d: string): Day => {
    let x = days.get(d);
    if (!x) {
      x = { date: d, board: { open: null, close: null, high: null, low: null, changes: 0 }, market: { open: null, close: null, high: null, low: null, samples: 0 }, gapPct: null };
      days.set(d, x);
    }
    return x;
  };
  for (let t = fromMs; t < toMs; t += 86_400_000) day(businessDate(t + 60_000, off));

  // Walk each day carrying the rate forward.
  let current = opening ? centsToLkr(opening.rate_cents_per_g) : null;
  const ch = changes ?? [];
  let ci = 0;
  for (const d of [...days.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    const end = dayStart(d.date) + 86_400_000;
    d.board.open = current;
    let hi = current;
    let lo = current;
    while (ci < ch.length && ch[ci]!.effective_from < end) {
      current = centsToLkr(ch[ci]!.rate_cents_per_g);
      hi = hi == null ? current : Math.max(hi, current);
      lo = lo == null ? current : Math.min(lo, current);
      d.board.changes++;
      ci++;
    }
    d.board.close = current;
    d.board.high = hi;
    d.board.low = lo;
  }
  for (const s of snaps ?? []) {
    const v = r2(((s.price_usd * s.usd_lkr) / TROY_OZ_G) * p);
    const d = day(businessDate(s.captured_at, off));
    d.market.open ??= v;
    d.market.close = v;
    d.market.high = d.market.high == null ? v : Math.max(d.market.high, v);
    d.market.low = d.market.low == null ? v : Math.min(d.market.low, v);
    d.market.samples++;
  }
  for (const d of days.values()) d.gapPct = d.board.close != null && d.market.close ? pct(d.board.close, d.market.close) : null;
  return {
    purity: { id: purity.id, karat: purity.karat, permille: purity.permille },
    purities: (purities ?? []).map((x) => ({ id: x.id, karat: x.karat })),
    days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)),
  };
}

export function rateLogCsv(log: Awaited<ReturnType<typeof rateLog>>) {
  const q = (v: unknown) => (v == null ? "" : String(v));
  const head = ["Date", "Karat", "Board open", "Board high", "Board low", "Board close", "Board changes", "Market open", "Market high", "Market low", "Market close", "Board vs market %"];
  const rows = log.days.map((d) =>
    [d.date, log.purity?.karat, d.board.open, d.board.high, d.board.low, d.board.close, d.board.changes, d.market.open, d.market.high, d.market.low, d.market.close, d.gapPct].map(q).join(",")
  );
  return [head.join(","), ...rows].join("\n");
}

/* ================================================================ competitor rates */

export type CompetitorInput = { shop: string; area?: string; purityId: string; side: "SELL" | "BUY"; ratePerGram: number; observedAt?: number; notes?: string; branchId?: string };

export async function addCompetitorRate(db: D1Database, input: CompetitorInput, actorId: string) {
  const purity = await db.prepare("SELECT id FROM purities WHERE id = ? AND is_active = 1").bind(input.purityId).first();
  if (!purity) throw err("Purity not found", "NOT_FOUND");
  const id = crypto.randomUUID();
  const now = Date.now();
  const observed = input.observedAt && input.observedAt <= now + 60_000 ? input.observedAt : now;
  await db.batch([
    db
      .prepare(
        "INSERT INTO competitor_rates (id, shop, area, purity_id, side, rate_cents_per_g, observed_at, notes, branch_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(id, input.shop.trim(), input.area?.trim() || null, input.purityId, input.side, lkrToCents(input.ratePerGram), observed, input.notes?.trim() || null, input.branchId ?? null, now, actorId),
    buildAuditStmt(db, { userId: actorId, action: "competitor_rate.create", entity: "competitor_rate", entityId: id, next: input }),
  ]);
  return { id };
}

export async function deleteCompetitorRate(db: D1Database, id: string, actorId: string) {
  const row = await db.prepare("SELECT id, shop FROM competitor_rates WHERE id = ?").bind(id).first<{ id: string; shop: string }>();
  if (!row) throw err("Entry not found", "NOT_FOUND");
  await db.batch([
    db.prepare("DELETE FROM competitor_rates WHERE id = ?").bind(id),
    buildAuditStmt(db, { userId: actorId, action: "competitor_rate.delete", entity: "competitor_rate", entityId: id, prev: row }),
  ]);
}

export async function competitorBoard(db: D1Database, days = 30, opts: MarketOpts = {}) {
  const since = Date.now() - Math.min(Math.max(days, 1), 365) * 86_400_000;
  const [{ results }, live] = await Promise.all([
    db
      .prepare(
        `SELECT c.id, c.shop, c.area, c.purity_id, p.karat, p.permille, c.side, c.rate_cents_per_g, c.observed_at, c.notes, u.name AS by_name
           FROM competitor_rates c JOIN purities p ON p.id = c.purity_id LEFT JOIN users u ON u.id = c.created_by
          WHERE c.observed_at >= ? ORDER BY c.observed_at DESC LIMIT 500`
      )
      .bind(since)
      .all<{ id: string; shop: string; area: string | null; purity_id: string; karat: string; permille: number; side: string; rate_cents_per_g: number; observed_at: number; notes: string | null; by_name: string | null }>(),
    liveMarket(db, opts).catch(() => null),
  ]);
  const entries = (results ?? []).map((r) => ({
    id: r.id,
    shop: r.shop,
    area: r.area,
    purityId: r.purity_id,
    karat: r.karat,
    permille: r.permille,
    side: r.side as "SELL" | "BUY",
    ratePerG: centsToLkr(r.rate_cents_per_g),
    observedAt: r.observed_at,
    notes: r.notes,
    by: r.by_name,
  }));
  // Latest quote per shop, karat and side, compared with our board and the market.
  const latest = new Map<string, (typeof entries)[number]>();
  for (const e of entries) {
    const k = `${e.shop.toLowerCase()}|${e.purityId}|${e.side}`;
    if (!latest.has(k)) latest.set(k, e);
  }
  const byKarat = new Map<string, { purityId: string; karat: string; permille: number; side: "SELL" | "BUY"; quotes: (typeof entries)[number][] }>();
  for (const e of latest.values()) {
    const k = `${e.purityId}|${e.side}`;
    const g = byKarat.get(k) ?? { purityId: e.purityId, karat: e.karat, permille: e.permille, side: e.side, quotes: [] };
    g.quotes.push(e);
    byKarat.set(k, g);
  }
  const summary = [...byKarat.values()]
    .map((g) => {
      const rates = g.quotes.map((q) => q.ratePerG);
      const avg = rates.reduce((s, v) => s + v, 0) / rates.length;
      const lk = live?.karats.find((k) => k.purityId === g.purityId);
      const ours = g.side === "SELL" ? (lk?.boardRate ?? null) : null;
      return {
        purityId: g.purityId,
        karat: g.karat,
        permille: g.permille,
        side: g.side,
        shops: g.quotes.length,
        low: Math.min(...rates),
        high: Math.max(...rates),
        avg: r2(avg),
        ours,
        oursVsAvgPct: ours != null ? pct(ours, avg) : null,
        market: lk?.lkrPerGram ?? null,
        quotes: g.quotes.sort((a, b) => a.ratePerG - b.ratePerG),
      };
    })
    .sort((a, b) => b.permille - a.permille || a.side.localeCompare(b.side));
  return { days, entries, summary };
}

/* ================================================================ alerts */

export type AlertKind = "PRICE_ABOVE" | "PRICE_BELOW" | "MOVE_PCT" | "BOARD_GAP";
export type AlertInput = { kind: AlertKind; symbol?: string; purityId?: string; threshold: number; note?: string };

export async function createAlert(db: D1Database, input: AlertInput, actorId: string) {
  if (!(input.threshold > 0)) throw err("Threshold must be positive", "VALIDATION");
  if (input.kind === "BOARD_GAP" && !input.purityId) throw err("Pick a karat for a board-gap alert", "VALIDATION");
  if (!input.symbol && !input.purityId) throw err("Pick a market or a karat", "VALIDATION");
  if (input.purityId) {
    const p = await db.prepare("SELECT id FROM purities WHERE id = ?").bind(input.purityId).first();
    if (!p) throw err("Purity not found", "NOT_FOUND");
  }
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare("INSERT INTO market_alerts (id, kind, symbol, purity_id, threshold, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, input.kind, input.purityId ? null : (input.symbol ?? "XAU").toUpperCase(), input.purityId ?? null, input.threshold, input.note?.trim() || null, Date.now(), actorId),
    buildAuditStmt(db, { userId: actorId, action: "market_alert.create", entity: "market_alert", entityId: id, next: input }),
  ]);
  return { id };
}

export async function updateAlert(db: D1Database, id: string, patch: { isActive?: boolean; threshold?: number; note?: string }, actorId: string) {
  const row = await db.prepare("SELECT id FROM market_alerts WHERE id = ?").bind(id).first();
  if (!row) throw err("Alert not found", "NOT_FOUND");
  if (patch.threshold != null && !(patch.threshold > 0)) throw err("Threshold must be positive", "VALIDATION");
  await db.batch([
    db
      .prepare(
        "UPDATE market_alerts SET is_active = COALESCE(?, is_active), threshold = COALESCE(?, threshold), note = COALESCE(?, note), is_tripped = CASE WHEN ? IS NOT NULL THEN 0 ELSE is_tripped END WHERE id = ?"
      )
      .bind(patch.isActive == null ? null : patch.isActive ? 1 : 0, patch.threshold ?? null, patch.note ?? null, patch.threshold ?? null, id),
    buildAuditStmt(db, { userId: actorId, action: "market_alert.update", entity: "market_alert", entityId: id, next: patch }),
  ]);
}

export async function deleteAlert(db: D1Database, id: string, actorId: string) {
  const row = await db.prepare("SELECT id FROM market_alerts WHERE id = ?").bind(id).first();
  if (!row) throw err("Alert not found", "NOT_FOUND");
  await db.batch([
    db.prepare("DELETE FROM market_alert_events WHERE alert_id = ?").bind(id),
    db.prepare("DELETE FROM market_alerts WHERE id = ?").bind(id),
    buildAuditStmt(db, { userId: actorId, action: "market_alert.delete", entity: "market_alert", entityId: id }),
  ]);
}

type AlertRow = { id: string; kind: AlertKind; symbol: string | null; purity_id: string | null; threshold: number; note: string | null; is_active: number; is_tripped: number; last_value: number | null; last_checked_at: number | null; last_fired_at: number | null; created_at: number; karat: string | null };

/** The value an alert watches and whether its condition holds right now. */
function measure(a: AlertRow, live: LiveMarket): { value: number; hit: boolean; label: string; unit: string } | null {
  const k = a.purity_id ? live.karats.find((x) => x.purityId === a.purity_id) : null;
  const q = a.symbol ? live.quotes.find((x) => x.symbol === a.symbol) : null;
  const name = k ? `${k.karat} gold` : (q?.name ?? a.symbol ?? "");
  if (a.kind === "PRICE_ABOVE" || a.kind === "PRICE_BELOW") {
    const value = k ? k.lkrPerGram : q?.priceUsd;
    if (value == null) return null;
    const unit = k ? "LKR/g" : q?.unit === "coin" ? "USD" : `USD/${q?.unit ?? "oz"}`;
    return { value, hit: a.kind === "PRICE_ABOVE" ? value >= a.threshold : value <= a.threshold, label: name, unit };
  }
  if (a.kind === "MOVE_PCT") {
    const c = k ? k.change24hPct : q?.change24hPct;
    if (c == null) return null;
    return { value: c, hit: Math.abs(c) >= a.threshold, label: name, unit: "%" };
  }
  if (!k || k.boardDiffPct == null) return null;
  return { value: k.boardDiffPct, hit: Math.abs(k.boardDiffPct) >= a.threshold, label: name, unit: "%" };
}

function message(a: AlertRow, m: { value: number; label: string; unit: string }) {
  const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  switch (a.kind) {
    case "PRICE_ABOVE":
      return `${m.label} rose to ${n(m.value)} ${m.unit} (alert at ${n(a.threshold)})`;
    case "PRICE_BELOW":
      return `${m.label} fell to ${n(m.value)} ${m.unit} (alert at ${n(a.threshold)})`;
    case "MOVE_PCT":
      return `${m.label} moved ${m.value > 0 ? "+" : ""}${n(m.value)}% in 24h (alert at ±${n(a.threshold)}%)`;
    default:
      return `${m.label} board is ${m.value > 0 ? "+" : ""}${n(m.value)}% vs market (alert at ±${n(a.threshold)}%)`;
  }
}

let lastEval = 0;
/**
 * Checks every active alert against the live board. Fires an event when a
 * condition turns true and re-arms when it turns false. Called by the cron and
 * (throttled to once per 2 min per isolate) whenever the board is opened.
 */
export async function evaluateAlerts(db: D1Database, live?: LiveMarket, opts: MarketOpts & { force?: boolean } = {}) {
  const now = opts.now ?? Date.now();
  if (!opts.force && now - lastEval < 120_000) return { checked: 0, fired: 0 };
  lastEval = now;
  const { results } = await db
    .prepare("SELECT a.*, p.karat FROM market_alerts a LEFT JOIN purities p ON p.id = a.purity_id WHERE a.is_active = 1")
    .all<AlertRow>();
  if (!results?.length) return { checked: 0, fired: 0 };
  const board = live ?? (await liveMarket(db, opts));
  const stmts: D1PreparedStatement[] = [];
  let fired = 0;
  for (const a of results) {
    const m = measure(a, board);
    if (!m) continue;
    if (m.hit && !a.is_tripped) {
      fired++;
      stmts.push(
        db.prepare("UPDATE market_alerts SET is_tripped = 1, last_value = ?, last_checked_at = ?, last_fired_at = ? WHERE id = ?").bind(m.value, now, now, a.id),
        db.prepare("INSERT INTO market_alert_events (id, alert_id, fired_at, value, message) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), a.id, now, m.value, message(a, m))
      );
    } else {
      stmts.push(db.prepare("UPDATE market_alerts SET is_tripped = ?, last_value = ?, last_checked_at = ? WHERE id = ?").bind(m.hit ? 1 : 0, m.value, now, a.id));
    }
  }
  if (stmts.length) await db.batch(stmts);
  return { checked: results.length, fired };
}

export async function listAlerts(db: D1Database) {
  const [{ results: alerts }, { results: events }, unseen] = await Promise.all([
    db
      .prepare("SELECT a.*, p.karat FROM market_alerts a LEFT JOIN purities p ON p.id = a.purity_id ORDER BY a.created_at DESC")
      .all<AlertRow>(),
    db
      .prepare(
        "SELECT e.id, e.alert_id, e.fired_at, e.value, e.message, e.seen_at, a.kind, a.symbol, p.karat FROM market_alert_events e JOIN market_alerts a ON a.id = e.alert_id LEFT JOIN purities p ON p.id = a.purity_id ORDER BY e.fired_at DESC LIMIT 50"
      )
      .all<{ id: string; alert_id: string; fired_at: number; value: number; message: string; seen_at: number | null; kind: string; symbol: string | null; karat: string | null }>(),
    db.prepare("SELECT COUNT(*) AS n FROM market_alert_events WHERE seen_at IS NULL").first<{ n: number }>(),
  ]);
  return {
    alerts: (alerts ?? []).map((a) => ({
      id: a.id,
      kind: a.kind,
      symbol: a.symbol,
      purityId: a.purity_id,
      karat: a.karat,
      threshold: a.threshold,
      note: a.note,
      isActive: !!a.is_active,
      isTripped: !!a.is_tripped,
      lastValue: a.last_value,
      lastCheckedAt: a.last_checked_at,
      lastFiredAt: a.last_fired_at,
      createdAt: a.created_at,
    })),
    events: (events ?? []).map((e) => ({
      id: e.id,
      alertId: e.alert_id,
      firedAt: e.fired_at,
      value: e.value,
      message: e.message,
      seen: e.seen_at != null,
      kind: e.kind,
      target: e.karat ?? e.symbol,
    })),
    unseen: unseen?.n ?? 0,
  };
}

export async function markAlertsSeen(db: D1Database, actorId: string) {
  await db.prepare("UPDATE market_alert_events SET seen_at = ?, seen_by = ? WHERE seen_at IS NULL").bind(Date.now(), actorId).run();
}

/* ================================================================ drivers */

const DRIVERS = [
  { ticker: "DX-Y.NYB", name: "US dollar index", short: "DXY", unit: "", why: "Gold is priced in dollars; a stronger dollar usually weighs on it." },
  { ticker: "^TNX", name: "US 10-year yield", short: "10Y", unit: "%", why: "Higher yields raise the cost of holding gold, which pays no interest." },
  { ticker: "CL=F", name: "Crude oil (WTI)", short: "Oil", unit: "$", why: "Oil feeds inflation expectations, which gold buyers hedge." },
  { ticker: "^GSPC", name: "S&P 500", short: "SPX", unit: "", why: "Risk appetite: sharp equity sell-offs often send money to gold." },
  { ticker: "^VIX", name: "Volatility index", short: "VIX", unit: "", why: "Fear gauge; spikes tend to coincide with safe-haven buying." },
  { ticker: "LKR=X", name: "USD / LKR", short: "USDLKR", unit: "Rs", why: "A weaker rupee raises local gold prices even if spot is flat." },
];

const dayKey = (t: number) => Math.floor(t / 86_400_000);
function pairCorr(a: Candle[], b: Candle[]) {
  const ra = new Map<number, number>();
  for (let i = 1; i < a.length; i++) ra.set(dayKey(a[i]!.t), Math.log(a[i]!.c / a[i - 1]!.c));
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 1; i < b.length; i++) {
    const g = ra.get(dayKey(b[i]!.t));
    if (g != null) {
      x.push(g);
      y.push(Math.log(b[i]!.c / b[i - 1]!.c));
    }
  }
  if (x.length < 20) return null;
  const mx = x.reduce((s, v) => s + v, 0) / x.length;
  const my = y.reduce((s, v) => s + v, 0) / y.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
    syy += (y[i]! - my) ** 2;
  }
  return sxx && syy ? r2(sxy / Math.sqrt(sxx * syy)) : null;
}

export async function marketDrivers(opts: MarketOpts = {}) {
  const f = opts.fetcher ?? fetch;
  const safe = <T>(p: Promise<T>) => p.catch(() => null);
  const [gold, ...rows] = await Promise.all([
    safe(cachedChart(f, "GC=F", "1y", "1d")),
    ...DRIVERS.map((d) => Promise.all([safe(cachedChart(f, d.ticker, "1y", "1d")), safe(cachedChart(f, d.ticker, "1d", "5m"))])),
  ]);
  const gc = gold?.candles ?? [];
  const goldChg = gc.length > 1 ? pct(gc[gc.length - 1]!.c, gc[gc.length - 2]!.c) : null;
  return {
    gold: { last: gc[gc.length - 1]?.c ?? null, changePct: goldChg, spark: gc.slice(-90).map((c) => c.c) },
    drivers: DRIVERS.map((d, i) => {
      const [daily, intraday] = rows[i]!;
      const cs = daily?.candles ?? [];
      const last = intraday?.meta.regularMarketPrice ?? cs[cs.length - 1]?.c ?? null;
      const prev = intraday?.meta.previousClose ?? intraday?.meta.chartPreviousClose ?? (cs.length > 1 ? cs[cs.length - 2]!.c : null);
      const m1 = cs.length > 22 ? cs[cs.length - 22]!.c : null;
      return {
        ...d,
        last,
        changePct: last != null && prev ? pct(last, prev) : null,
        change1mPct: last != null && m1 ? pct(last, m1) : null,
        corr1y: gc.length && cs.length ? pairCorr(gc, cs) : null,
        spark: cs.slice(-90).map((c) => c.c),
      };
    }),
  };
}

/* ================================================================ events calendar */

/** US Federal Reserve rate decisions, 2026 (published FOMC calendar, second day). */
const FOMC_2026 = ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09"];

function firstFriday(y: number, m: number) {
  const d = new Date(Date.UTC(y, m, 1));
  const add = (5 - d.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(y, m, 1 + add)).toISOString().slice(0, 10);
}

export type CalendarEvent = { id: string; date: string; title: string; kind: "macro" | "local" | "shop"; note?: string; builtIn: boolean };

export async function eventsCalendar(db: D1Database, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const horizon = new Date(now + 400 * 86_400_000).toISOString().slice(0, 10);
  const y = new Date(now).getUTCFullYear();
  const built: CalendarEvent[] = [];
  for (const d of FOMC_2026) built.push({ id: `fomc-${d}`, date: d, title: "US Fed rate decision", kind: "macro", note: "Rate moves and guidance swing gold sharply.", builtIn: true });
  for (let i = 0; i < 13; i++) {
    const dt = new Date(Date.UTC(y, new Date(now).getUTCMonth() + i, 1));
    const d = firstFriday(dt.getUTCFullYear(), dt.getUTCMonth());
    built.push({ id: `nfp-${d}`, date: d, title: "US jobs report (usual date)", kind: "macro", note: "Usually the first Friday; confirm on bls.gov.", builtIn: true });
  }
  for (const yy of [y, y + 1]) {
    built.push({ id: `avurudu-${yy}`, date: `${yy}-04-13`, title: "Sinhala & Tamil New Year", kind: "local", note: "Peak jewellery buying in the weeks before.", builtIn: true });
    built.push({ id: `xmas-${yy}`, date: `${yy}-12-25`, title: "Christmas", kind: "local", note: "Gift season through December.", builtIn: true });
  }
  built.push({ id: "deepavali-2026", date: "2026-11-08", title: "Deepavali", kind: "local", note: "Gold buying is customary.", builtIn: true });
  built.push({ id: "eid-fitr-2027", date: "2027-03-10", title: "Eid al-Fitr (approx.)", kind: "local", note: "Depends on the moon sighting.", builtIn: true });
  const own = (await readEvents(db)).map((e) => ({ ...e, builtIn: false }));
  const all = [...built, ...own].filter((e) => e.date >= today && e.date <= horizon).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  return { today, events: all, own };
}
