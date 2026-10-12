// Rate desk over real SQLite: suggested board rates, import cost, gold
// position, stock gains, the daily rate log, competitor quotes and alerts.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable } from "./sqlite-test-db";
import { resetMarketCache, TROY_OZ_G } from "./market";
import {
  addCompetitorRate,
  competitorBoard,
  createAlert,
  evaluateAlerts,
  goldPosition,
  importParity,
  listAlerts,
  markAlertsSeen,
  rateLog,
  rateLogCsv,
  roundRate,
  saveImportCosts,
  savePolicy,
  stockGains,
  suggestBoard,
  DEFAULT_POLICY,
} from "./market-desk";

const PRICES: Record<string, number> = { XAU: 4000, XAG: 50, XPT: 1600, XPD: 1100, HG: 6, BTC: 100000, ETH: 4000 };

function fakeFetch(prices: Record<string, number>, usdLkr: number): typeof fetch {
  return (async (url: string) => {
    if (url.includes("er-api")) return Response.json({ result: "success", time_last_update_unix: 1, rates: { USD: 1, LKR: usdLkr, AED: 3.6725 } });
    const sym = url.split("/").pop()!;
    return Response.json({ price: prices[sym], symbol: sym, updatedAt: "2026-10-11T00:00:00Z" });
  }) as typeof fetch;
}

const FINE = (4000 * 300) / TROY_OZ_G; // LKR per fine gram at the test prices

describe("roundRate", () => {
  it("rounds to the step in the chosen direction", () => {
    expect(roundRate(35_024, 50, "nearest")).toBe(35_000);
    expect(roundRate(35_026, 50, "nearest")).toBe(35_050);
    expect(roundRate(35_001, 50, "up")).toBe(35_050);
    expect(roundRate(35_049, 50, "down")).toBe(35_000);
    expect(roundRate(35_050, 50, "up")).toBe(35_050);
    expect(roundRate(1234.567, 0, "nearest")).toBe(1234.57);
  });
});

describe.skipIf(!sqliteAvailable)("rate desk over real SQLite", () => {
  let db: D1Database;
  let raw: ReturnType<typeof migratedDb>["raw"];
  const T0 = Date.now() - 2 * 3_600_000;
  const opts = () => ({ fetcher: fakeFetch(PRICES, 300) });

  beforeAll(() => {
    const m = migratedDb();
    db = m.db;
    raw = m.raw;
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO customers (id, code, name, branch_id, created_at) VALUES ('c1','C1','Cust','b1',0);
      INSERT INTO gold_rates (id, purity_id, rate_cents_per_g, effective_from, created_at, created_by)
        VALUES ('r1','purity-22k', 3500000, ${T0}, 0, 'u1');
      -- market when the board was published: gold at 3960
      INSERT INTO market_snapshots (id, captured_at, symbol, price_usd, usd_lkr) VALUES ('s1', ${T0}, 'XAU', 3960, 300);
    `);
  });
  beforeEach(() => resetMarketCache());

  it("suggests a board rate from market + margin, rounded, and flags drift since publish", async () => {
    await savePolicy(db, { ...DEFAULT_POLICY, defaultMarginPct: 2, roundTo: 100, roundMode: "up", driftAlertPct: 0.5, perKarat: { "purity-24k": { marginPct: 1 } } }, "u1");
    const s = await suggestBoard(db, opts());
    const k22 = s.rows.find((r) => r.karat === "22K")!;
    expect(k22.marketPerG).toBeCloseTo(FINE * 0.916, 1);
    expect(k22.suggestedPerG).toBe(Math.ceil((k22.marketPerG * 1.02) / 100) * 100);
    expect(k22.boardPerG).toBe(35000);
    expect(k22.marketAtPublish).toBeCloseTo(((3960 * 300) / TROY_OZ_G) * 0.916, 1);
    expect(k22.driftPct).toBeCloseTo(((4000 - 3960) / 3960) * 100, 1);
    expect(k22.stale).toBe(true);
    const k24 = s.rows.find((r) => r.karat === "24K")!;
    expect(k24.marginPct).toBe(1);
    expect(k24.boardPerG).toBeNull();
    expect(k24.driftPct).toBeNull();
  });

  it("builds the landed cost of a bar step by step", async () => {
    await saveImportCosts(db, { premiumUsdPerOz: 10, bankFeePct: 1, dutyPct: 5, ssclPct: 2.5, vatPct: 18, otherLkrPerG: 100 }, "u1");
    const p = await importParity(db, opts());
    const spot = FINE;
    const prem = (10 * 300) / TROY_OZ_G;
    const cif = (spot + prem) * 1.01;
    const landed = cif * (1 + 0.05 + 0.025) * 1.18 + 100;
    expect(p.landedPerG).toBeCloseTo(landed, 1);
    expect(p.steps.reduce((s, x) => s + x.v, 0)).toBeCloseTo(landed, 0);
    const k22 = p.karats.find((k) => k.karat === "22K")!;
    expect(k22.landedPerG).toBeCloseTo(landed * 0.916, 1);
    expect(k22.boardMarginPct).toBeCloseTo(((35000 - landed * 0.916) / (landed * 0.916)) * 100, 1);
  });

  it("nets stock against gold owed on fixed-price custom orders", async () => {
    raw.exec(`
      INSERT INTO products (id, barcode, category_id, purity_id, name, branch_id, created_at, status, gross_mg, net_mg, fine_gold_mg, cost_cents, making_cents)
        VALUES ('p1','B1','cat-ring','purity-22k','Ring','b1',0,'IN_STOCK',10000,10000,9160, 30000000, 2000000);
      INSERT INTO products (id, barcode, category_id, purity_id, name, branch_id, created_at, status, gross_mg, net_mg, fine_gold_mg)
        VALUES ('p2','B2','cat-ring','purity-22k','Chain','b1',0,'IN_STOCK',5000,5000,4580);
      INSERT INTO custom_orders (id, number, customer_id, branch_id, design, gold_req_mg, gold_source, quote_cents, status, created_at)
        VALUES ('o1','CORD1','c1','b1','Necklace', 20000, 'SHOP', 90000000, 'ADVANCED', 0),
               ('o2','CORD2','c1','b1','Ring', 8000, 'CUSTOMER', 10000000, 'QUOTE', 0),
               ('o3','CORD3','c1','b1','Bangle', 8000, 'SHOP', 10000000, 'DELIVERED', 0);
    `);
    const pos = await goldPosition(db, opts());
    expect(pos.longMg).toBe(9160 + 4580);
    // Only the open SHOP order counts, at the assumed 916 purity.
    expect(pos.owed.map((o) => o.number)).toEqual(["CORD1"]);
    expect(pos.owedMg).toBe(18320);
    expect(pos.netMg).toBe(9160 + 4580 - 18320);
    expect(pos.netValueLkr).toBeCloseTo(((9160 + 4580 - 18320) / 1000) * FINE, 0);
    expect(pos.perPctLkr).toBeCloseTo(pos.netValueLkr / 100, 1);
  });

  it("values costed stock at today's price, excluding making", async () => {
    const g = await stockGains(db, opts());
    const line = g.lines.find((l) => l.karat === "22K")!;
    expect(line.count).toBe(2);
    expect(line.costed).toBe(1);
    expect(line.costLkr).toBe(280000);
    expect(line.valueLkr).toBeCloseTo(9.16 * FINE, 0);
    expect(line.gainLkr).toBeCloseTo(9.16 * FINE - 280000, 0);
    expect(g.totals.uncosted).toBe(1);
    expect(g.totals.uncostedFineMg).toBe(4580);
  });

  it("logs board and market per day and exports CSV", async () => {
    const d = new Date(T0 + 330 * 60_000).toISOString().slice(0, 10);
    const log = await rateLog(db, { from: d, to: d, purityId: "purity-22k" });
    expect(log.days).toHaveLength(1);
    expect(log.days[0]!.board.close).toBe(35000);
    expect(log.days[0]!.board.changes).toBe(1);
    expect(log.days[0]!.market.close).toBeGreaterThan(0);
    expect(rateLogCsv(log).split("\n")[1]).toContain(`${d},22K`);
    await expect(rateLog(db, { from: "2026-02-01", to: "2026-01-01" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("keeps the latest quote per shop and compares with our board", async () => {
    await addCompetitorRate(db, { shop: "Pettah A", purityId: "purity-22k", side: "SELL", ratePerGram: 34000, observedAt: Date.now() - 60_000 }, "u1");
    await addCompetitorRate(db, { shop: "pettah a", purityId: "purity-22k", side: "SELL", ratePerGram: 34500 }, "u1");
    await addCompetitorRate(db, { shop: "Shop B", purityId: "purity-22k", side: "SELL", ratePerGram: 35500 }, "u1");
    await addCompetitorRate(db, { shop: "Shop B", purityId: "purity-22k", side: "BUY", ratePerGram: 32000 }, "u1");
    resetMarketCache();
    const b = await competitorBoard(db, 30, opts());
    const sell = b.summary.find((s) => s.side === "SELL")!;
    expect(sell.shops).toBe(2);
    expect(sell.low).toBe(34500);
    expect(sell.avg).toBe(35000);
    expect(sell.ours).toBe(35000);
    expect(sell.oursVsAvgPct).toBe(0);
    expect(b.summary.find((s) => s.side === "BUY")!.ours).toBeNull();
  });

  it("fires an alert once, re-arms when the condition clears", async () => {
    await createAlert(db, { kind: "PRICE_ABOVE", symbol: "XAU", threshold: 4100 }, "u1");
    await createAlert(db, { kind: "BOARD_GAP", purityId: "purity-22k", threshold: 0.5 }, "u1");
    const hi = { fetcher: fakeFetch({ ...PRICES, XAU: 4150 }, 300), force: true };
    expect((await evaluateAlerts(db, undefined, hi)).fired).toBe(2);
    resetMarketCache();
    expect((await evaluateAlerts(db, undefined, hi)).fired).toBe(0);
    let l = await listAlerts(db);
    expect(l.unseen).toBe(2);
    expect(l.events.some((e) => e.message.includes("Gold rose to 4,150"))).toBe(true);
    resetMarketCache();
    await evaluateAlerts(db, undefined, { fetcher: fakeFetch(PRICES, 300), force: true });
    l = await listAlerts(db);
    expect(l.alerts.find((a) => a.kind === "PRICE_ABOVE")!.isTripped).toBe(false);
    resetMarketCache();
    expect((await evaluateAlerts(db, undefined, hi)).fired).toBe(1);
    await markAlertsSeen(db, "u1");
    expect((await listAlerts(db)).unseen).toBe(0);
    await expect(createAlert(db, { kind: "BOARD_GAP", symbol: "XAU", threshold: 1 }, "u1")).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe.skipIf(!sqliteAvailable)("long history for the board charts", () => {
  it("scales futures to end on spot and converts at each point's USD/LKR", async () => {
    const { longHistory } = await import("./market-asset");
    const { db } = migratedDb();
    resetMarketCache();
    const t0 = Date.UTC(2026, 9, 1);
    const chart = (closes: number[]) =>
      Response.json({ chart: { result: [{ meta: { regularMarketPrice: closes[closes.length - 1] }, timestamp: closes.map((_, i) => (t0 + i * 86_400_000) / 1000), indicators: { quote: [{ open: closes, high: closes, low: closes, close: closes, volume: closes.map(() => 1) }] } }] } });
    const fetcher = (async (url: string) => {
      if (url.includes("er-api")) return Response.json({ result: "success", time_last_update_unix: 1, rates: { USD: 1, LKR: 300 } });
      if (url.includes("gold-api")) return Response.json({ price: 4000, updatedAt: "2020-01-01T00:00:00Z" });
      if (url.includes("LKR%3DX")) return chart([290, 295, 300]);
      if (url.includes("GC%3DF")) return chart([3960, 3980, 4020]);
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    const h = await longHistory(db, "XAU", "30d", { fetcher });
    const k = 4000 / 4020;
    expect(h.basisAdjustPct).toBeCloseTo((k - 1) * 100, 2);
    expect(h.points).toHaveLength(3);
    expect(h.points[0]!.priceUsd).toBeCloseTo(3960 * k, 3);
    expect(h.points[0]!.priceLkr).toBeCloseTo(3960 * k * 290, 0);
    expect(h.points[2]!.priceUsd).toBeCloseTo(4000, 3);
    expect(h.points[2]!.lkrPerGram).toBeCloseTo((4000 * 300) / TROY_OZ_G, 1);
    await expect(longHistory(db, "DOGE", "1d", { fetcher })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
