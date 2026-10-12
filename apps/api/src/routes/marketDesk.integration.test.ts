// Rate desk over HTTP, through the real app and SQLite: permissions,
// validation, and each endpoint's shape. Upstream feeds are stubbed.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "../services/sqlite-test-db";

const PRICES: Record<string, number> = { XAU: 4000, XAG: 50, XPT: 1600, XPD: 1100, HG: 6, BTC: 100000, ETH: 4000 };

describe.skipIf(!sqliteAvailable)("market desk over HTTP", () => {
  let raw: SqliteDb;
  let env: { DB: D1Database; R2: R2Bucket; WEB_ORIGIN: string };
  let app: (typeof import("../app"))["app"];
  let owner = "";
  let viewer = "";
  const PASSWORD = "correct-horse-1";

  const login = async (email: string) => {
    const res = await app.request(
      "/api/v1/auth/login",
      { method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": "10.0.0.2" }, body: JSON.stringify({ email, password: PASSWORD }) },
      env
    );
    expect(res.status).toBe(200);
    return res.headers.get("set-cookie")?.match(/session=([^;]+)/)?.[1] ?? "";
  };
  const call = (method: string, path: string, body?: unknown, sid = owner) =>
    app.request(
      path,
      {
        method,
        headers: { cookie: `session=${sid}`, origin: "http://localhost:3000", "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env
    );
  const json = async <T = any>(res: Response | Promise<Response>): Promise<T> => ((await res).json() as Promise<T>);

  beforeAll(async () => {
    vi.stubGlobal("fetch", (async (url: string) => {
      if (url.includes("er-api")) return Response.json({ result: "success", time_last_update_unix: 1, rates: { USD: 1, LKR: 300, AED: 3.6725 } });
      if (url.includes("gold-api")) {
        const sym = url.split("/").pop()!;
        return Response.json({ price: PRICES[sym], symbol: sym, updatedAt: "2026-10-11T00:00:00Z" });
      }
      return new Response("offline", { status: 503 });
    }) as typeof fetch);
    const m = migratedDb();
    raw = m.raw;
    env = { DB: m.db, R2: {} as R2Bucket, WEB_ORIGIN: "http://localhost:3000" };
    const { hashPassword } = await import("../services/hash");
    const hash = await hashPassword(PASSWORD);
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES
        ('u1','owner@shop.lk','Owner','${hash}',0,0), ('u2','acct@shop.lk','Accounts','${hash}',0,0);
      INSERT INTO roles (id, name) VALUES ('viewer','viewer');
      INSERT INTO role_permissions (role_id, permission_id) VALUES ('viewer','accounts:view');
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner'), ('u2','viewer');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO branch_members (user_id, branch_id) VALUES ('u1','b1'), ('u2','b1');
      INSERT INTO gold_rates (id, purity_id, rate_cents_per_g, effective_from, created_at, created_by) VALUES ('r1','purity-22k', 3500000, 0, 0, 'u1');
    `);
    ({ app } = await import("../app"));
    owner = await login("owner@shop.lk");
    viewer = await login("acct@shop.lk");
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("refuses staff without rate permissions", async () => {
    expect((await call("GET", "/api/v1/market-desk/settings", undefined, viewer)).status).toBe(403);
    expect((await call("GET", "/api/v1/market-desk/position", undefined, viewer)).status).toBe(403);
    expect((await call("POST", "/api/v1/market-desk/alerts", { kind: "MOVE_PCT", symbol: "XAU", threshold: 1 }, viewer)).status).toBe(403);
  });

  it("reads and saves the pricing policy, validating input", async () => {
    const s = await json(call("GET", "/api/v1/market-desk/settings"));
    expect(s.data.policy).toMatchObject({ defaultMarginPct: 0, roundTo: 50, orderPermille: 916 });
    const bad = await call("PUT", "/api/v1/market-desk/policy", { ...s.data.policy, roundMode: "sideways" });
    expect(bad.status).toBe(400);
    const ok = await call("PUT", "/api/v1/market-desk/policy", { ...s.data.policy, defaultMarginPct: 3, roundTo: 100 });
    expect(ok.status).toBe(200);
    const sug = await json(call("GET", "/api/v1/market-desk/suggest"));
    const k22 = sug.data.rows.find((r: { karat: string }) => r.karat === "22K");
    expect(k22.marginPct).toBe(3);
    expect(k22.suggestedPerG % 100).toBe(0);
  });

  it("serves import parity, position and gains", async () => {
    expect((await call("PUT", "/api/v1/market-desk/import-costs", { premiumUsdPerOz: 5, bankFeePct: 0.5, dutyPct: 0, ssclPct: 0, vatPct: 0, otherLkrPerG: 0 })).status).toBe(200);
    const p = await json(call("GET", "/api/v1/market-desk/import-parity"));
    expect(p.data.landedPerG).toBeGreaterThan(p.data.steps[0].v);
    const pos = await call("GET", "/api/v1/market-desk/position");
    expect(pos.status).toBe(200);
    expect((await json(pos)).data).toMatchObject({ longMg: 0, owedMg: 0, netMg: 0 });
    expect((await call("GET", "/api/v1/market-desk/gains")).status).toBe(200);
  });

  it("records, lists and deletes competitor rates", async () => {
    const bad = await call("POST", "/api/v1/market-desk/competitors", { shop: "", purityId: "purity-22k", side: "SELL", ratePerGram: 1 });
    expect(bad.status).toBe(400);
    const res = await call("POST", "/api/v1/market-desk/competitors", { shop: "Pettah A", purityId: "purity-22k", side: "SELL", ratePerGram: 34800 });
    expect(res.status).toBe(201);
    const { id } = (await json(res)).data;
    const list = await json(call("GET", "/api/v1/market-desk/competitors?days=7"));
    expect(list.data.summary[0]).toMatchObject({ karat: "22K", avg: 34800, ours: 35000 });
    expect((await call("DELETE", `/api/v1/market-desk/competitors/${id}`)).status).toBe(200);
    expect((await call("DELETE", `/api/v1/market-desk/competitors/${id}`)).status).toBe(404);
  });

  it("creates alerts, fires them on check and marks them read", async () => {
    const res = await call("POST", "/api/v1/market-desk/alerts", { kind: "PRICE_ABOVE", symbol: "XAU", threshold: 3900 });
    expect(res.status).toBe(201);
    const list = await json(call("GET", "/api/v1/market-desk/alerts"));
    expect(list.data.alerts[0]).toMatchObject({ kind: "PRICE_ABOVE", isTripped: true });
    expect(list.data.unseen).toBe(1);
    expect((await call("POST", "/api/v1/market-desk/alerts/seen", {})).status).toBe(200);
    expect((await json(call("GET", "/api/v1/market-desk/alerts"))).data.unseen).toBe(0);
    const id = list.data.alerts[0].id;
    expect((await call("PATCH", `/api/v1/market-desk/alerts/${id}`, { isActive: false })).status).toBe(200);
    expect((await call("DELETE", `/api/v1/market-desk/alerts/${id}`)).status).toBe(200);
  });

  it("keeps the shop's own calendar dates and exports the rate log", async () => {
    expect((await call("PUT", "/api/v1/market-desk/events", { events: [{ id: "e1", date: "12/12/2030", title: "x", kind: "shop" }] })).status).toBe(400);
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    expect((await call("PUT", "/api/v1/market-desk/events", { events: [{ id: "e1", date: future, title: "Wedding season", kind: "shop" }] })).status).toBe(200);
    const cal = await json(call("GET", "/api/v1/market-desk/events"));
    expect(cal.data.events.some((e: { title: string }) => e.title === "Wedding season")).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    const csv = await call("GET", `/api/v1/market-desk/rate-log?from=${today}&to=${today}&purityId=purity-22k&format=csv`);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain("Board open");
  });
});
