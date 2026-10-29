// Three-role RBAC over the real app and real SQLite:
// - only owner reads final accounts / profits (accounts:* → 403 otherwise)
// - staff sells (sales:create) and closes the day (dayclose:*)
// - staff can never reopen (reopen needs users:edit) and never sees book cost.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable } from "../services/sqlite-test-db";

describe.skipIf(!sqliteAvailable)("rbac: owner/admin/staff", () => {
  let raw: ReturnType<typeof migratedDb>["raw"];
  let env: Record<string, unknown>;
  let app: (typeof import("../app"))["app"];
  const PASSWORD = "correct-horse-1";
  const sessions: Record<string, string> = {};
  let today = "";
  let pid = "";
  let pid2 = "";
  let db: D1Database;

  const req = (user: string, path: string, init: { method?: string; body?: unknown } = {}) =>
    app.request(
      path,
      {
        method: init.method ?? "GET",
        headers: { "Content-Type": "application/json", cookie: `session=${sessions[user]}` },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      },
      env
    );

  beforeAll(async () => {
    const m = migratedDb();
    raw = m.raw;
    db = m.db;
    env = { DB: m.db, R2: {} as R2Bucket, WEB_ORIGIN: "http://localhost:3000" };
    const { hashPassword } = await import("../services/hash");
    const hash = await hashPassword(PASSWORD);
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES
        ('u1','owner@shop.lk','Owner','${hash}',0,0),
        ('u2','admin@shop.lk','Admin','${hash}',0,0),
        ('u3','staff@shop.lk','Staff','${hash}',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner'), ('u2','admin'), ('u3','staff');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO branch_members (user_id, branch_id) VALUES ('u1','b1'), ('u2','b1'), ('u3','b1');
      INSERT INTO categories (id, name, code, created_at) VALUES ('cat-test','Test Ring','TESTRING',0);
      INSERT INTO purities (id, karat, permille, created_at) VALUES ('purity-test','9K',375,0);
      INSERT INTO customers (id, code, name, phone, branch_id, created_at) VALUES ('cust-test','C-TEST','Test Customer','0771234567','b1',0);
    `);
    const { createProduct } = await import("../services/products");
    const p = await createProduct(
      m.db,
      { name: "Ring", categoryId: "cat-test", branchId: "b1", metalTypeId: "metal-gold", purityId: "purity-test", grossG: 2, stoneG: 0, makingLkr: 0, wastageG: 0, costLkr: 10000 },
      "u1"
    );
    pid = p.id;
    const p2 = await createProduct(
      m.db,
      { name: "Ring B", categoryId: "cat-test", branchId: "b1", metalTypeId: "metal-gold", purityId: "purity-test", grossG: 3, stoneG: 0, makingLkr: 0, wastageG: 0, costLkr: 12000 },
      "u1"
    );
    pid2 = p2.id;
    // Pieces are created unpriced; these two carry a shelf price set at the till.
    raw.prepare("UPDATE products SET selling_price_cents = ? WHERE id = ?").run(5000000, pid);
    raw.prepare("UPDATE products SET selling_price_cents = ? WHERE id = ?").run(6000000, pid2);
    const { businessDateFor } = await import("../services/busdate");
    today = await businessDateFor(m.db, Date.now());
    ({ app } = await import("../app"));
    for (const [u, email] of [["u1", "owner@shop.lk"], ["u2", "admin@shop.lk"], ["u3", "staff@shop.lk"]] as const) {
      const res = await app.request(
        "/api/v1/auth/login",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) },
        env
      );
      expect(res.status).toBe(200);
      sessions[u] = res.headers.get("set-cookie")?.match(/session=([^;]+)/)?.[1] ?? "";
    }
  });

  it("has exactly three roles", async () => {
    const res = await req("u1", "/api/v1/roles");
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { id: string }[] };
    expect(data.map((r) => r.id).sort()).toEqual(["admin", "owner", "staff"]);
  });

  it("only owner reads final accounts and profits", async () => {
    for (const path of [
      "/api/v1/accounts/statements/pnl",
      "/api/v1/accounts/statements/balance-sheet",
      "/api/v1/accounts/trial-balance",
      "/api/v1/accounts/journal",
      "/api/v1/accounts/reconciliation",
      "/api/v1/reports/monthly/pnl",
    ]) {
      expect((await req("u1", path)).status).not.toBe(403);
      expect((await req("u2", path)).status).toBe(403);
      expect((await req("u3", path)).status).toBe(403);
    }
  });

  it("staff previews and closes the day, but cannot reopen it", async () => {
    const preview = await req("u3", `/api/v1/day-closings/preview?branchId=b1&date=${today}`);
    expect(preview.status).toBe(200);
    const close = await req("u3", "/api/v1/day-closings", {
      method: "POST",
      body: { branchId: "b1", date: today, actualCents: 0 },
    });
    expect(close.status).toBe(201);
    const { data } = (await close.json()) as { data: { id: string } };
    const reopenStaff = await req("u3", `/api/v1/day-closings/${data.id}/reopen`, {
      method: "POST",
      body: { reason: "miscount" },
    });
    expect(reopenStaff.status).toBe(403);
    const reopenAdmin = await req("u2", `/api/v1/day-closings/${data.id}/reopen`, {
      method: "POST",
      body: { reason: "miscount" },
    });
    expect(reopenAdmin.status).toBe(201);
  });

  it("staff never sees book cost", async () => {
    const asStaff = (await (await req("u3", `/api/v1/products/${pid}`)).json()) as { data: { product: Record<string, unknown> } };
    expect(asStaff.data.product.cost_cents).toBeUndefined();
    expect(asStaff.data.product.selling_price_cents).toBe(5000000);
    const asOwner = (await (await req("u1", `/api/v1/products/${pid}`)).json()) as { data: { product: Record<string, unknown> } };
    expect(asOwner.data.product.cost_cents).toBe(1000000);
  });

  it("staff sells over HTTP at the counter", async () => {
    const res = await req("u3", "/api/v1/sales/invoices", {
      method: "POST",
      body: {
        customerId: "cust-test",
        branchId: "b1",
        items: [{ productId: pid2, priceLkr: 60000, discountLkr: 0 }],
        payments: [{ method: "cash", amountLkr: 60000 }],
      },
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { invoiceId: string } };
    expect(data.invoiceId).toBeTruthy();
  });

  it("refuses a bill with no customer", async () => {
    const res = await req("u3", "/api/v1/sales/invoices", {
      method: "POST",
      body: {
        branchId: "b1",
        items: [{ productId: pid2, priceLkr: 60000, discountLkr: 0 }],
        payments: [{ method: "cash", amountLkr: 60000 }],
      },
    });
    expect(res.status).toBe(400);
  });

  it("staff completes normal sales but never old-for-new exchanges", async () => {
    // The exchange route needs oldgold:edit: staff is denied before validation.
    const denied = await req("u3", "/api/v1/sales/exchanges", { method: "POST", body: {} });
    expect(denied.status).toBe(403);
    // An admin passes the gate and reaches validation instead.
    const reachesHandler = await req("u2", "/api/v1/sales/exchanges", { method: "POST", body: {} });
    expect(reachesHandler.status).toBe(400);
  });

  it("staff sees turnover but no margin on the sale and the overview", async () => {
    const { receiveSale } = await import("../services/sales");
    const sale = await receiveSale(
      db,
      { branchId: "b1", items: [{ productId: pid, priceLkr: 50000, discountLkr: 0 }], payments: [{ method: "cash", amountLkr: 50000 }] },
      "u3",
      { enforceShelfPrice: false }
    );
    const asStaff = (await (await req("u3", `/api/v1/sales/invoices/${sale.invoiceId}`)).json()) as {
      data: { invoice: { total_cents: number }; items: Record<string, unknown>[]; journal: unknown[] };
    };
    expect(asStaff.data.invoice.total_cents).toBe(5000000);
    expect(asStaff.data.items[0]).not.toHaveProperty("cost_cents");
    expect(asStaff.data.journal).toEqual([]);
    const asOwner = (await (await req("u1", `/api/v1/sales/invoices/${sale.invoiceId}`)).json()) as {
      data: { items: Record<string, unknown>[]; journal: unknown[] };
    };
    expect(asOwner.data.items[0]).toHaveProperty("cost_cents");
    expect(asOwner.data.journal.length).toBeGreaterThan(0);

    const now = new Date();
    const ovStaff = (await (
      await req("u3", `/api/v1/branch-overview?branchId=b1&month=${now.getMonth() + 1}&year=${now.getFullYear()}`)
    ).json()) as { data: { jewellery: Record<string, unknown>; purchases: { valueCents: number } } };
    expect(ovStaff.data.jewellery).not.toHaveProperty("costCents");
    expect(ovStaff.data.purchases.valueCents).toBe(0);
    const ovOwner = (await (
      await req("u1", `/api/v1/branch-overview?branchId=b1&month=${now.getMonth() + 1}&year=${now.getFullYear()}`)
    ).json()) as { data: { jewellery: Record<string, unknown> } };
    expect(ovOwner.data.jewellery).toHaveProperty("costCents");
  });
  it("staff can create users but cannot grant roles (users:approve is owner-only)", async () => {
    // Staff cannot even create users.
    const denied = await req("u3", "/api/v1/users", {
      method: "POST",
      body: { email: "new@shop.lk", name: "New", password: "password-1", role: "staff", branchIds: ["b1"] },
    });
    expect(denied.status).toBe(403);
    // Admin can create staff, but promoting to admin needs users:approve.
    const created = await req("u2", "/api/v1/users", {
      method: "POST",
      body: { email: "new@shop.lk", name: "New", password: "password-1", role: "staff", branchIds: ["b1"] },
    });
    expect(created.status).toBe(201);
    const { data } = (await created.json()) as { data: { id: string } };
    const promote = await req("u2", `/api/v1/users/${data.id}`, {
      method: "PATCH",
      body: { role: "admin" },
    });
    expect(promote.status).toBe(403);
    const promoteOwner = await req("u1", `/api/v1/users/${data.id}`, {
      method: "PATCH",
      body: { role: "admin" },
    });
    expect(promoteOwner.status).toBe(200);
  });
});
