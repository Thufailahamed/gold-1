import { describe, expect, it } from "vitest";
import { RestD1 } from "./rest-d1";

function mockFetch(handler: (url: string, init: RequestInit) => unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, json: async () => handler(url, init) } as Response;
  };
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

const BASE = "https://api.cloudflare.com/client/v4";

describe("RestD1 transport", () => {
  it("reads one row with the account token", async () => {
    const { fetcher, calls } = mockFetch(() => ({
      success: true,
      result: [{ results: [{ id: "u-1", email: "o@x.lk" }], success: true, meta: {} }],
    }));
    const db = new RestD1("acct-1", "d1-1", "tok", fetcher);
    const row = await db.prepare("SELECT id, email FROM users WHERE id = ?").bind("u-1").first<{ id: string }>();
    expect(row?.id).toBe("u-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE}/accounts/acct-1/d1/database/d1-1/query`);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const body = JSON.parse(calls[0]!.init.body as string) as { sql: string; params: unknown[] };
    expect(body.sql).toMatch(/FROM users/);
    expect(body.params).toEqual(["u-1"]);
  });

  it("plucks a single column and lists many rows", async () => {
    const { fetcher } = mockFetch(() => ({
      success: true,
      result: [{ results: [{ n: 3 }], success: true, meta: {} }],
    }));
    const db = new RestD1("acct-1", "d1-1", "tok", fetcher);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM users").first<number>("n")).toBe(3);
    const { fetcher: f2 } = mockFetch(() => ({
      success: true,
      result: [{ results: [{ branch_id: "b1" }, { branch_id: "b2" }], success: true, meta: {} }],
    }));
    const db2 = new RestD1("acct-1", "d1-1", "tok", f2);
    const { results } = await db2.prepare("SELECT branch_id FROM branch_members WHERE user_id = ?").bind("u").all<{ branch_id: string }>();
    expect(results.map((r) => r.branch_id)).toEqual(["b1", "b2"]);
  });

  it("runs writes and batches in one call", async () => {
    const seen: string[] = [];
    const { fetcher, calls } = mockFetch((url) => {
      seen.push(url);
      return url.endsWith("/batch")
        ? { success: true, result: [{ success: true, meta: {} }, { success: true, meta: {} }] }
        : { success: true, result: [{ success: true, meta: { changes: 1 } }] };
    });
    const db = new RestD1("acct-1", "d1-1", "tok", fetcher);
    const r = await db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(9, "s").run();
    expect(r.success).toBe(true);
    await db.batch([
      db.prepare("INSERT INTO a (id) VALUES (?)").bind("1"),
      db.prepare("INSERT INTO a (id) VALUES (?)").bind("2"),
    ]);
    expect(calls).toHaveLength(2);
    expect(seen[1]).toBe(`${BASE}/accounts/acct-1/d1/database/d1-1/batch`);
  });

  it("surfaces API errors instead of inventing rows", async () => {
    const { fetcher } = mockFetch(() => ({ success: false, errors: [{ message: "no such table" }] }));
    const db = new RestD1("acct-1", "d1-1", "tok", fetcher);
    await expect(db.prepare("SELECT 1").first()).rejects.toThrow(/no such table/);
  });

  it("resolves the global fetch per call (Workers-safe, no captured reference)", async () => {
    const db = new RestD1("acct-1", "d1-1", "tok");
    const seen: string[] = [];
    const realFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = (async (url: string) => {
      seen.push(String(url));
      return { ok: true, json: async () => ({ success: true, result: [{ results: [{ n: 1 }], success: true, meta: {} }] }) } as Response;
    }) as typeof fetch;
    try {
      // Stub installed AFTER construction: a captured reference would miss it.
      expect(await db.prepare("SELECT 1").first<{ n: number }>("n")).toBe(1);
      expect(seen[0]).toContain("/accounts/acct-1/d1/database/d1-1/query");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
