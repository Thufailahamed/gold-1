/**
 * D1 over HTTPS for tenant databases that cannot be wrangler bindings.
 * Bindings need a redeploy per shop; the REST API lets one Worker serve an
 * unbounded fleet. The surface mirrors the D1 calls the codebase uses
 * (`prepare/bind/first/all/run`, `batch`) so service code is untouched —
 * it just receives this handle instead of a bound one.
 */
export const D1_API_BASE = "https://api.cloudflare.com/client/v4";

type QueryResult = {
  results?: Array<Record<string, unknown>>;
  success?: boolean;
  meta?: Record<string, unknown>;
};

type QueryResponse = {
  success: boolean;
  errors?: Array<{ message?: string }>;
  result?: QueryResult[];
};

export type RestStatement = {
  sql: string;
  params: unknown[];
  bind: (...v: unknown[]) => RestBound;
  first: <T>(col?: string) => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
  run: () => Promise<{ success: boolean; meta?: Record<string, unknown> }>;
};

export type RestBound = RestStatement & {
  first: <T>(col?: string) => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
  run: () => Promise<{ success: boolean; meta?: Record<string, unknown> }>;
};

export class RestD1 {
  private url: string;
  private token: string;
  private fetcher: typeof fetch;

  constructor(accountId: string, databaseId: string, token: string, fetcher: typeof fetch = fetch) {
    this.url = `${D1_API_BASE}/accounts/${accountId}/d1/database/${databaseId}`;
    this.token = token;
    this.fetcher = fetcher;
  }

  prepare(sql: string): RestStatement {
    const self = this;
    const bound = (...v: unknown[]): RestBound => {
      const params = v.map((x) => (x === undefined ? null : x));
      const query = async (): Promise<QueryResult> => {
        const res = await self.fetcher(`${self.url}/query`, {
          method: "POST",
          headers: { Authorization: `Bearer ${self.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ sql, params }),
        });
        const json = (await (res as Response).json()) as QueryResponse;
        if (!json.success || !json.result?.[0]) {
          throw new Error(json.errors?.[0]?.message ?? "D1 query failed");
        }
        return json.result[0];
      };
      return {
        sql,
        params,
        bind: (...inner: unknown[]) => self.prepare(sql).bind(...inner),
        first: async <T>(col?: string): Promise<T | null> => {
          const row = (await query()).results?.[0] ?? null;
          if (!row) return null;
          return (col ? row[col] : row) as T;
        },
        all: async <T>(): Promise<{ results: T[] }> => ({ results: ((await query()).results ?? []) as T[] }),
        run: async () => ({ success: true, meta: (await query()).meta }),
      };
    };
    // D1 allows prepare().first() with no bind; match that.
    const stmt: RestStatement = {
      sql,
      params: [],
      bind: bound,
      first: <T>(col?: string) => bound().first<T>(col),
      all: <T>() => bound().all<T>(),
      run: () => bound().run(),
    };
    return stmt;
  }

  /** One roundtrip for many writes — mirrors D1 batch semantics. */
  async batch(stmts: Array<{ sql: string; params: unknown[] }>): Promise<Array<{ success: boolean }>> {
    const res = await this.fetcher(`${this.url}/batch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ queries: stmts.map((s) => ({ sql: s.sql, params: s.params.map((x) => (x === undefined ? null : x)) })) }),
    });
    const json = (await (res as Response).json()) as QueryResponse;
    if (!json.success || !json.result) {
      throw new Error(json.errors?.[0]?.message ?? "D1 batch failed");
    }
    return json.result.map((r) => ({ success: r.success !== false }));
  }
}
