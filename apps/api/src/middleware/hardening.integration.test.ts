// Request-level hardening over the real app and real SQLite: login
// throttling, sliding session expiry, and idempotent mutation replay.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "../services/sqlite-test-db";

describe.skipIf(!sqliteAvailable)("request hardening over real SQLite", () => {
  let raw: SqliteDb;
  let env: { DB: D1Database; R2: R2Bucket; WEB_ORIGIN: string };
  let app: (typeof import("../app"))["app"];
  const PASSWORD = "correct-horse-1";

  const login = (email: string, password: string, ip = "10.0.0.1") =>
    app.request(
      "/api/v1/auth/login",
      { method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ email, password }) },
      env
    );
  const cookieOf = (res: Response) => res.headers.get("set-cookie")?.match(/session=([^;]+)/)?.[1] ?? "";

  beforeAll(async () => {
    const m = migratedDb();
    raw = m.raw;
    env = { DB: m.db, R2: {} as R2Bucket, WEB_ORIGIN: "http://localhost:3000" };
    const { hashPassword } = await import("../services/hash");
    const hash = await hashPassword(PASSWORD);
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES
        ('u1','owner@shop.lk','Owner','${hash}',0,0),
        ('u2','cashier@shop.lk','Cashier','${hash}',0,0),
        ('u3','spray@shop.lk','Spray','${hash}',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner'), ('u2','owner'), ('u3','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO branch_members (user_id, branch_id) VALUES ('u1','b1'), ('u2','b1'), ('u3','b1');
    `);
    ({ app } = await import("../app"));
  });

  describe("login throttling", () => {
    it("locks an account after five bad passwords, even for the right password", async () => {
      for (let i = 0; i < 5; i++) expect((await login("cashier@shop.lk", "wrong-password")).status).toBe(401);
      const locked = await login("cashier@shop.lk", PASSWORD);
      expect(locked.status).toBe(429);
      expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await locked.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    });

    it("lets the account in again once the lock lapses, and forgives its failures", async () => {
      raw.exec("UPDATE login_attempts SET locked_until = 1, window_start = 1 WHERE key = 'email:cashier@shop.lk'");
      expect((await login("cashier@shop.lk", PASSWORD)).status).toBe(200);
      expect(raw.prepare("SELECT 1 FROM login_attempts WHERE key = 'email:cashier@shop.lk'").get()).toBeUndefined();
    });

    it("answers an unknown email exactly like a wrong password, and counts it", async () => {
      const res = await login("nobody@shop.lk", "wrong-password", "10.0.0.9");
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "UNAUTHORIZED", message: "Invalid credentials" } });
      expect(raw.prepare("SELECT failures FROM login_attempts WHERE key = 'ip:10.0.0.9'").get()).toMatchObject({ failures: 1 });
    });

    it("locks a client that sprays many accounts from one IP", async () => {
      for (let i = 0; i < 30; i++) await login(`guess${i}@shop.lk`, "wrong-password", "10.6.6.6");
      expect((await login("spray@shop.lk", PASSWORD, "10.6.6.6")).status).toBe(429);
      expect((await login("spray@shop.lk", PASSWORD, "10.7.7.7")).status).toBe(200);
    });
  });

  describe("sessions", () => {
    it("slides the idle deadline forward on activity, capped by the absolute limit", async () => {
      const sid = cookieOf(await login("owner@shop.lk", PASSWORD, "10.1.1.1"));
      const now = Date.now();
      raw.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(now + 60_000, sid);
      const me = await app.request("/api/v1/auth/me", { headers: { cookie: `session=${sid}` } }, env);
      expect(me.status).toBe(200);
      const after = raw.prepare("SELECT expires_at FROM sessions WHERE id = ?").get(sid) as { expires_at: number };
      expect(after.expires_at).toBeGreaterThan(now + 11 * 60 * 60 * 1000);

      raw.prepare("UPDATE sessions SET created_at = ?, expires_at = ? WHERE id = ?").run(now - 7 * 86_400_000 + 60_000, now + 30_000, sid);
      await app.request("/api/v1/auth/me", { headers: { cookie: `session=${sid}` } }, env);
      const capped = raw.prepare("SELECT expires_at, created_at FROM sessions WHERE id = ?").get(sid) as { expires_at: number; created_at: number };
      expect(capped.expires_at).toBeLessThanOrEqual(capped.created_at + 7 * 86_400_000);
    });
  });

  describe("idempotent writes", () => {
    let sid = "";
    const createCustomer = (body: object, key?: string) =>
      app.request(
        "/api/v1/customers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie: `session=${sid}`, ...(key ? { "Idempotency-Key": key } : {}) },
          body: JSON.stringify(body),
        },
        env
      );
    const count = (name: string) => (raw.prepare("SELECT COUNT(*) AS n FROM customers WHERE name = ?").get(name) as { n: number }).n;

    beforeAll(async () => {
      sid = cookieOf(await login("owner@shop.lk", PASSWORD, "10.2.2.2"));
    });

    it("replays the first response for a retried key instead of writing twice", async () => {
      const body = { name: "Retry Rani", branchId: "b1" };
      const first = await createCustomer(body, "key-retry-0001");
      const second = await createCustomer(body, "key-retry-0001");
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.headers.get("idempotent-replayed")).toBe("true");
      expect(await second.json()).toEqual(await first.json());
      expect(count("Retry Rani")).toBe(1);
    });

    it("refuses a key reused for a different request", async () => {
      await createCustomer({ name: "Key Owner", branchId: "b1" }, "key-reuse-0001");
      const res = await createCustomer({ name: "Someone Else", branchId: "b1" }, "key-reuse-0001");
      expect(res.status).toBe(422);
      expect(count("Someone Else")).toBe(0);
    });

    it("scopes keys to the session, and leaves key-less writes alone", async () => {
      const other = cookieOf(await login("cashier@shop.lk", PASSWORD, "10.3.3.3"));
      const body = { name: "Two Tills", branchId: "b1" };
      await createCustomer(body, "key-shared-0001");
      const res = await app.request(
        "/api/v1/customers",
        { method: "POST", headers: { "Content-Type": "application/json", cookie: `session=${other}`, "Idempotency-Key": "key-shared-0001" }, body: JSON.stringify(body) },
        env
      );
      expect(res.headers.get("idempotent-replayed")).toBeNull();
      await createCustomer(body);
      expect(count("Two Tills")).toBe(3);
    });

    it("stores a deterministic 4xx outcome so the retry sees the same answer", async () => {
      const bad = await createCustomer({ name: "", branchId: "b1" }, "key-invalid-01");
      expect(bad.status).toBe(400);
      const again = await createCustomer({ name: "", branchId: "b1" }, "key-invalid-01");
      expect(again.status).toBe(400);
      expect(again.headers.get("idempotent-replayed")).toBe("true");
    });
  });
});
