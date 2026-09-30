import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Env = {
  DB: D1Database;
  R2: R2Bucket;
  WEB_ORIGIN?: string;
  /** Control-plane database (accounts, plans, billing). Absent = unmanaged single-shop deploy. */
  PLATFORM_DB?: D1Database;
  /** The platform tenant id this data plane serves. */
  TENANT_ID?: string;
  /** One-time secret that authorises creating the first platform super admin. */
  PLATFORM_BOOTSTRAP_TOKEN?: string;
};

export function getDb(env: Env): DrizzleD1Database<typeof schema> {
  return drizzle(env.DB, { schema });
}
