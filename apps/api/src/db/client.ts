import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Env = { DB: D1Database; R2: R2Bucket; WEB_ORIGIN?: string };

export function getDb(env: Env): DrizzleD1Database<typeof schema> {
  return drizzle(env.DB, { schema });
}
