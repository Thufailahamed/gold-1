import { createMiddleware } from "hono/factory";
import type { Env } from "../db/client";

const SESSION_RE = /(?:^|;\s*)session=([^;]+)/;
const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
/** Replays are honoured for a day; an older key is treated as fresh. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STORED_BYTES = 256 * 1024;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}


/**
 * Safe retries for mutations. A client that sends `Idempotency-Key` on a
 * POST/PATCH/PUT/DELETE and then retries (flaky shop Wi-Fi, a POS that timed
 * out mid-sale) gets the first response replayed instead of a second sale,
 * payment or gold movement.
 *
 * - The key is scoped to the session cookie, so one user's key can never
 *   replay another user's response.
 * - The same key with a different method, path or body is refused (422): the
 *   client has a bug, and silently replaying the wrong response would hide it.
 * - A retry that arrives while the first attempt is still running gets 409.
 * - 5xx outcomes are not stored, so a retry after a crash runs again.
 * - Requests without the header, without a session, or with a non-JSON body
 *   (multipart uploads) pass straight through, unchanged.
 */
export const idempotency = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const method = c.req.method;
  const clientKey = c.req.header("idempotency-key");
  const sessionId = c.req.header("cookie")?.match(SESSION_RE)?.[1];
  const type = c.req.header("content-type") ?? "";
  if (
    !clientKey ||
    !sessionId ||
    !["POST", "PATCH", "PUT", "DELETE"].includes(method) ||
    (type !== "" && !type.startsWith("application/json"))
  ) {
    await next();
    return;
  }
  // Built on the context (not a bare Response) so CORS headers set upstream survive.
  const refuse = (code: "CONFLICT" | "VALIDATION", message: string) =>
    c.json({ success: false, error: { code, message } }, code === "CONFLICT" ? 409 : 422);
  if (!KEY_RE.test(clientKey)) {
    return refuse("VALIDATION", "Idempotency-Key must be 8-128 letters, digits, '-' or '_'");
  }
  const db = c.env.DB;
  const path = new URL(c.req.url).pathname;
  const key = await sha256Hex(`${sessionId}:${clientKey}`);
  const requestHash = await sha256Hex(`${method} ${path}\n${await c.req.text()}`);
  const now = Date.now();
  // Lapsed keys are cleared first so a reused key after the TTL starts fresh.
  await db.prepare("DELETE FROM idempotency_keys WHERE key = ? AND created_at < ?").bind(key, now - IDEMPOTENCY_TTL_MS).run();
  const claimed = await db
    .prepare(
      "INSERT INTO idempotency_keys (key, created_at, method, path, request_hash) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO NOTHING RETURNING key"
    )
    .bind(key, now, method, path, requestHash)
    .first<{ key: string }>();

  if (!claimed) {
    const prior = await db
      .prepare("SELECT request_hash, status, response_json FROM idempotency_keys WHERE key = ?")
      .bind(key)
      .first<{ request_hash: string | null; status: number | null; response_json: string | null }>();
    if (!prior) return refuse("CONFLICT", "Request is being retried; try again");
    if (prior.request_hash !== requestHash)
      return refuse("VALIDATION", "Idempotency-Key was already used for a different request");
    if (prior.status === null || prior.response_json === null)
      return refuse("CONFLICT", "The original request is still being processed");
    c.header("Idempotent-Replayed", "true");
    return c.body(prior.response_json, prior.status as 200, { "Content-Type": "application/json" });
  }

  let stored = false;
  try {
    await next();
    const res = c.res;
    if (res.status < 500 && (res.headers.get("content-type") ?? "").includes("application/json")) {
      const body = await res.clone().text();
      if (body.length <= MAX_STORED_BYTES) {
        await db
          .prepare("UPDATE idempotency_keys SET status = ?, response_json = ? WHERE key = ?")
          .bind(res.status, body, key)
          .run();
        stored = true;
      }
    }
  } finally {
    // Not replayable (crash, 5xx, oversized or non-JSON): release the key so a
    // retry executes instead of waiting on a response that will never exist.
    if (!stored) await db.prepare("DELETE FROM idempotency_keys WHERE key = ?").bind(key).run();
  }
});

/** Housekeeping: drops keys past the replay window. */
export async function purgeIdempotencyKeys(db: D1Database, now = Date.now()): Promise<void> {
  await db.prepare("DELETE FROM idempotency_keys WHERE created_at < ?").bind(now - IDEMPOTENCY_TTL_MS).run();
}
