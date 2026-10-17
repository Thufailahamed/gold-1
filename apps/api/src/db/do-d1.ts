import type { ShopRequest, StmtResult } from "./shop-do";

/**
 * A D1-shaped handle over a shop's Durable Object. It mirrors the slice of the
 * D1 API this codebase uses (the same one RestD1 covers), so every service
 * keeps receiving `prepare/bind/first/all/run` and `batch` unchanged.
 */
export type ShopTransport = (req: ShopRequest) => Promise<StmtResult[]>;

type Stmt = {
  sql: string;
  params: unknown[];
  bind: (...v: unknown[]) => Stmt;
  first: <T>(col?: string) => Promise<T | null>;
  all: <T>() => Promise<{ results: T[]; meta: StmtResult["meta"]; success: true }>;
  run: () => Promise<{ success: true; meta: StmtResult["meta"]; results: unknown[] }>;
};

export class DoD1 {
  constructor(private transport: ShopTransport) {}

  prepare(sql: string): Stmt {
    const exec = async (params: unknown[]) => (await this.transport({ stmts: [{ sql, params }] }))[0]!;
    const make = (params: unknown[]): Stmt => ({
      sql,
      params,
      bind: (...v) => make(v.map((x) => (x === undefined ? null : x))),
      first: async <T>(col?: string) => {
        const row = (await exec(params)).results[0];
        if (!row) return null;
        return (col ? row[col] : row) as T;
      },
      all: async <T>() => {
        const r = await exec(params);
        return { results: r.results as T[], meta: r.meta, success: true as const };
      },
      run: async () => {
        const r = await exec(params);
        return { success: true as const, meta: r.meta, results: r.results };
      },
    });
    return make([]);
  }

  /** One transaction: any failure rolls the whole batch back. */
  async batch(stmts: Array<{ sql: string; params: unknown[] }>): Promise<Array<{ success: true; results: unknown[]; meta: StmtResult["meta"] }>> {
    if (stmts.length === 0) return [];
    const out = await this.transport({ stmts: stmts.map((s) => ({ sql: s.sql, params: s.params.map((x) => (x === undefined ? null : x)) })) });
    return out.map((r) => ({ success: true as const, results: r.results, meta: r.meta }));
  }
}

/** Transport to one shop's Durable Object, addressed by name. */
export function doTransport(ns: DurableObjectNamespace, name: string): ShopTransport {
  // The stub is made per call, never held: handles are cached across requests,
  // and Workers forbid using an object created in one request from another.
  return async (req) => {
    const stub = ns.get(ns.idFromName(name));
    const res = await stub.fetch("https://shop.internal/query", { method: "POST", body: JSON.stringify(req) });
    const body = (await res.json()) as { ok: boolean; results?: StmtResult[]; error?: string };
    if (!body.ok) throw new Error(body.error ?? "Shop database error");
    return body.results ?? [];
  };
}

export async function destroyShopDo(ns: DurableObjectNamespace, name: string): Promise<void> {
  await ns.get(ns.idFromName(name)).fetch("https://shop.internal/destroy", { method: "POST" });
}
