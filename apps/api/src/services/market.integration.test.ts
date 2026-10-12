// Live market board: upstream quotes converted to LKR per karat, compared with
// the published board rate, sampled into snapshots for 24h change and history,
// and served from the last snapshot when the feed is down.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable } from "./sqlite-test-db";
import { liveMarket, marketHistory, PAWN_G, recordMarketSnapshot, resetMarketCache, TROY_OZ_G } from "./market";

const PRICES: Record<string, number> = { XAU: 4000, XAG: 50, XPT: 1600, XPD: 1100, HG: 6, BTC: 100000, ETH: 4000 };

function fakeFetch(prices: Record<string, number>, usdLkr: number | null): typeof fetch {
  return (async (url: string) => {
    if (url.includes("er-api")) {
      if (usdLkr == null) return new Response("down", { status: 503 });
      return Response.json({ result: "success", time_last_update_unix: 1, rates: { USD: 1, LKR: usdLkr, EUR: 0.9, AED: 3.6725 } });
    }
    const sym = url.split("/").pop()!;
    if (!(sym in prices)) return new Response("down", { status: 503 });
    return Response.json({ price: prices[sym], symbol: sym, updatedAt: "2026-10-11T00:00:00Z" });
  }) as typeof fetch;
}

describe.skipIf(!sqliteAvailable)("market rates over real SQLite", () => {
  let db: D1Database;
  let raw: ReturnType<typeof migratedDb>["raw"];
  const T0 = Date.UTC(2026, 9, 10, 0, 0, 0);

  beforeAll(() => {
    const m = migratedDb();
    db = m.db;
    raw = m.raw;
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO gold_rates (id, purity_id, rate_cents_per_g, effective_from, created_at, created_by)
        VALUES ('r1','purity-22k', 3500000, 0, 0, 'u1');
    `);
  });
  beforeEach(() => resetMarketCache());

  it("converts spot to LKR per karat and compares with the board rate", async () => {
    const m = await liveMarket(db, { fetcher: fakeFetch(PRICES, 300), now: T0 });
    expect(m.stale).toBe(false);
    expect(m.usdLkr).toBe(300);
    const fine = (4000 * 300) / TROY_OZ_G;
    const k24 = m.karats.find((k) => k.karat === "24K")!;
    expect(k24.lkrPerGram).toBeCloseTo(fine, 2);
    expect(k24.lkrPerPawn).toBeCloseTo(k24.lkrPerGram * PAWN_G, 1);
    const k22 = m.karats.find((k) => k.karat === "22K")!;
    expect(k22.lkrPerGram).toBeCloseTo(fine * 0.916, 1);
    expect(k22.boardRate).toBe(35000);
    expect(k22.boardDiffPct).toBeCloseTo(((35000 - k22.lkrPerGram) / k22.lkrPerGram) * 100, 1);
    expect(m.quotes.find((q) => q.symbol === "BTC")!.lkrPerGram).toBeNull();
    expect(m.fx.find((f) => f.code === "AED")!.lkrPer).toBeCloseTo(300 / 3.6725, 3);
    expect(m.rates).toMatchObject({ USD: 1, LKR: 300, EUR: 0.9, AED: 3.6725 });
    // Opening the board stored one snapshot per symbol.
    const n = raw.prepare("SELECT COUNT(*) AS n FROM market_snapshots").get() as { n: number };
    expect(n.n).toBe(7);
  });

  it("throttles snapshots and reports 24h change against the day-old one", async () => {
    expect(await recordMarketSnapshot(db, { fetcher: fakeFetch(PRICES, 300), now: T0 + 60_000 })).toBe(false);
    resetMarketCache();
    const m = await liveMarket(db, { fetcher: fakeFetch({ ...PRICES, XAU: 4200 }, 300), now: T0 + 86_400_000 });
    expect(m.quotes.find((q) => q.symbol === "XAU")!.change24hPct).toBe(5);
    expect(m.karats[0]!.change24hPct).toBe(5);
    const h = await marketHistory(db, "XAU", "7d", T0 + 86_400_000);
    expect(h.points.map((p) => p.priceUsd)).toEqual([4000, 4200]);
    expect(h.points[1]!.lkrPerGram).toBeCloseTo((4200 * 300) / TROY_OZ_G, 2);
  });

  it("falls back to the last snapshot when the feed is down", async () => {
    const m = await liveMarket(db, { fetcher: fakeFetch({ XAG: 55 }, null), now: T0 + 2 * 86_400_000 });
    expect(m.stale).toBe(true);
    expect(m.usdLkr).toBe(300);
    // Without the FX feed only the stored USD/LKR rate is known.
    expect(m.rates).toEqual({ USD: 1, LKR: 300 });
    const gold = m.quotes.find((q) => q.symbol === "XAU")!;
    expect(gold).toMatchObject({ priceUsd: 4200, stale: true });
    expect(m.quotes.find((q) => q.symbol === "XAG")).toMatchObject({ priceUsd: 55, stale: false });
  });

  it("refuses when there is neither a feed nor a snapshot", async () => {
    const empty = migratedDb().db;
    await expect(liveMarket(empty, { fetcher: fakeFetch({}, null), now: T0 })).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("rejects unknown symbols", async () => {
    await expect(marketHistory(db, "DOGE", "1d")).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
