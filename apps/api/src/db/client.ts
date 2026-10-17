import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Env = {
  DB: D1Database;
  R2: R2Bucket;
  WEB_ORIGIN?: string;
  /** Control-plane database (accounts, plans, billing). Absent = unmanaged single-shop deploy. */
  PLATFORM_DB?: D1Database;
  /** Legacy single-shop pin: the platform tenant id this worker serves. Falls back to `DB` for old deploys. */
  TENANT_ID?: string;
  /** Per-shop Durable Object storage. Present = new shops are created here instead of as D1 databases. */
  SHOP?: DurableObjectNamespace;
  /** D1 REST credentials for auto-created tenant databases (wrangler secrets, never in repo). */
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_D1_API_TOKEN?: string;
  /** One-time secret that authorises creating the first platform super admin. */
  PLATFORM_BOOTSTRAP_TOKEN?: string;
  /** Workers AI binding. Every assistant call is routed through AI Gateway. */
  AI?: AiRunner;
  /** AI Gateway id the assistant routes through ("default" when unset). */
  AI_GATEWAY_ID?: string;
  /** Primary and fallback Workers AI models for the accounts assistant. */
  ASSISTANT_MODEL?: string;
  ASSISTANT_FALLBACK_MODEL?: string;
  /** Reasoning effort for the primary model: low | high | max. */
  ASSISTANT_REASONING_EFFORT?: string;
  /** Workers AI vision model that reads photographed bills. */
  ASSISTANT_VISION_MODEL?: string;
};

/**
 * The slice of the Workers AI binding the assistant uses. Typed here rather
 * than as `Ai` so a model id newer than the installed type list is accepted,
 * and so tests can supply a fake.
 */
export type AiRunner = {
  run(model: string, inputs: Record<string, unknown>, options?: { gateway?: GatewayOptions }): Promise<unknown>;
};

export function getDb(env: Env): DrizzleD1Database<typeof schema> {
  return drizzle(env.DB, { schema });
}
