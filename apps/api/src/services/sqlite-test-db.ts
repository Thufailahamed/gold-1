// Test-only: a real SQLite database with every migration applied, behind
// just enough of the D1 surface the services use. Needs node:sqlite (Node
// 22.5+); `available` is false on older Node so suites can skip.
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...v: unknown[]): unknown;
    all(...v: unknown[]): unknown[];
    run(...v: unknown[]): unknown;
  };
};

let DatabaseSync: (new (path: string) => SqliteDb) | null = null;
try {
  DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync;
} catch {
  DatabaseSync = null;
}

export const sqliteAvailable = DatabaseSync !== null;

const norm = (v: unknown[]) => v.map((x) => (x === undefined ? null : typeof x === "boolean" ? (x ? 1 : 0) : x));

function d1(raw: SqliteDb): D1Database {
  const stmt = (sql: string, vals: unknown[] = []) => ({
    sql,
    vals,
    bind: (...v: unknown[]) => stmt(sql, norm(v)),
    first: async <T>(col?: string) => {
      const row = (raw.prepare(sql).get(...vals) ?? null) as Record<string, unknown> | null;
      return (col && row ? row[col] : row) as T;
    },
    all: async <T>() => ({ results: raw.prepare(sql).all(...vals) as T[] }),
    run: async () => {
      raw.prepare(sql).run(...vals);
      return { success: true };
    },
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: { sql: string; vals: unknown[] }[]) => {
      raw.exec("BEGIN");
      try {
        for (const s of stmts) raw.prepare(s.sql).run(...s.vals);
        raw.exec("COMMIT");
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
      return [];
    },
  } as unknown as D1Database;
}

/** `migrations` is the folder under apps/api: "drizzle" (a shop) or "drizzle-platform" (the control plane). */
export function migratedDb(migrations = "drizzle"): { db: D1Database; raw: SqliteDb } {
  if (!DatabaseSync) throw new Error("node:sqlite unavailable");
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = OFF");
  const dir = join(__dirname, "..", "..", migrations);
  for (const f of readdirSync(dir).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
    try {
      raw.exec(readFileSync(join(dir, f), "utf8"));
    } catch (e) {
      throw new Error(`${f}: ${(e as Error).message}`);
    }
  }
  raw.exec("PRAGMA foreign_keys = ON");
  return { db: d1(raw), raw };
}
