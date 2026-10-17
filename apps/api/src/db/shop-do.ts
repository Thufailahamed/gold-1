/**
 * One shop = one Durable Object with its own SQLite storage. Queries run next
 * to the data in microseconds, instead of crossing the public D1 REST API
 * (~0.5 s each). No per-shop D1, no Cloudflare API token, no database cap.
 *
 * The protocol is deliberately tiny: a request is a list of statements, run
 * in order; more than one runs as a single transaction (D1 batch semantics),
 * optionally with foreign keys deferred to commit. `runShopRequest` is pure
 * over a `SqlRunner`, so tests drive the exact production logic over node:sqlite.
 */
export type SqlStatement = { sql: string; params: unknown[] };
export type ShopRequest = { stmts: SqlStatement[]; deferFk?: boolean };
export type StmtResult = { results: Array<Record<string, unknown>>; meta: { changes: number; last_row_id: number } };

export interface SqlRunner {
  /** Runs one statement; rows for anything that returns them. */
  query(sql: string, params: unknown[]): Array<Record<string, unknown>>;
  transaction<T>(fn: () => T): T;
}

const READS = /^\s*(select|with|pragma|explain)\b/i;

export function runShopRequest(runner: SqlRunner, req: ShopRequest): StmtResult[] {
  const one = (s: SqlStatement): StmtResult => {
    const results = runner.query(s.sql, s.params);
    if (READS.test(s.sql)) return { results, meta: { changes: 0, last_row_id: 0 } };
    const m = runner.query("SELECT changes() AS c, last_insert_rowid() AS r", [])[0] ?? {};
    return { results, meta: { changes: Number(m.c ?? 0), last_row_id: Number(m.r ?? 0) } };
  };
  if (req.stmts.length === 1 && !req.deferFk) return [one(req.stmts[0]!)];
  return runner.transaction(() => {
    if (req.deferFk) runner.query("PRAGMA defer_foreign_keys = on", []);
    return req.stmts.map(one);
  });
}

type DoState = {
  storage: {
    sql: { exec(sql: string, ...params: unknown[]): { toArray(): Array<Record<string, unknown>> } };
    transactionSync<T>(fn: () => T): T;
    deleteAll(): Promise<void>;
  };
};

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

export class ShopDatabase {
  private runner: SqlRunner;
  constructor(ctx: DoState, _env: unknown) {
    this.runner = {
      query: (sql, params) => ctx.storage.sql.exec(sql, ...params).toArray(),
      transaction: (fn) => ctx.storage.transactionSync(fn),
    };
    this.ctx = ctx;
  }
  private ctx: DoState;

  async fetch(req: Request): Promise<Response> {
    if (new URL(req.url).pathname === "/destroy") {
      await this.ctx.storage.deleteAll();
      return json({ ok: true });
    }
    try {
      return json({ ok: true, results: runShopRequest(this.runner, (await req.json()) as ShopRequest) });
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
}
