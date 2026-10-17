import type { Env } from "./client";
import { DoD1, doTransport } from "./do-d1";
import { RestD1 } from "./rest-d1";

/** A shop database reference: `do:<name>` is a Durable Object, anything else a legacy D1 id. */
export const DO_PREFIX = "do:";
export const isDoRef = (ref: string) => ref.startsWith(DO_PREFIX);
export const doName = (ref: string) => ref.slice(DO_PREFIX.length);

/**
 * The handle for a shop database reference. Tests inject handles through the
 * `TEST_HANDLES` seam; Durable Object shops need only the SHOP binding; legacy
 * D1 shops need the REST credentials. Null = unreachable from here.
 */
export function shopDbFor(env: Env, ref: string): D1Database | null {
  const injected = (env as unknown as { TEST_HANDLES?: Record<string, D1Database> }).TEST_HANDLES?.[ref];
  if (injected) return injected;
  if (isDoRef(ref)) return env.SHOP ? (new DoD1(doTransport(env.SHOP, doName(ref))) as unknown as D1Database) : null;
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_D1_API_TOKEN) return null;
  return new RestD1(env.CLOUDFLARE_ACCOUNT_ID, ref, env.CLOUDFLARE_D1_API_TOKEN) as unknown as D1Database;
}
