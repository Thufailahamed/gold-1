/**
 * Login throttling. Two independent keys per attempt:
 *   email:<addr> — 5 failures in 15 min locks that account's login for 15 min
 *                  (stops password guessing against one user);
 *   ip:<addr>    — 30 failures in 15 min locks that client for 15 min
 *                  (stops one client spraying many accounts).
 * Locked keys are refused before the password is checked, so a locked-out
 * attacker learns nothing and burns no scrypt time.
 */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;
export const MAX_EMAIL_FAILURES = 5;
export const MAX_IP_FAILURES = 30;

export type ThrottleKey = { key: string; max: number };

export function loginKeys(email: string, ip: string | undefined): ThrottleKey[] {
  const keys: ThrottleKey[] = [{ key: `email:${email.trim().toLowerCase()}`, max: MAX_EMAIL_FAILURES }];
  if (ip) keys.push({ key: `ip:${ip}`, max: MAX_IP_FAILURES });
  return keys;
}

/** Milliseconds until the longest active lock among `keys` lapses; 0 when none is locked. */
export async function lockedFor(db: D1Database, keys: ThrottleKey[], now = Date.now()): Promise<number> {
  let wait = 0;
  for (const { key } of keys) {
    const row = await db
      .prepare("SELECT locked_until FROM login_attempts WHERE key = ?")
      .bind(key)
      .first<{ locked_until: number | null }>();
    if (row?.locked_until && row.locked_until > now) wait = Math.max(wait, row.locked_until - now);
  }
  return wait;
}

/**
 * Counts one failure against every key in one atomic upsert each. SQLite
 * evaluates SET expressions against the pre-update row, so a lapsed window
 * restarts at 1 and the lock is decided on the new count.
 */
export async function recordFailure(db: D1Database, keys: ThrottleKey[], now = Date.now()): Promise<void> {
  const cutoff = now - LOGIN_WINDOW_MS;
  await db.batch(
    keys.map(({ key, max }) =>
      db
        .prepare(
          `INSERT INTO login_attempts (key, failures, window_start, locked_until) VALUES (?, 1, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             failures = CASE WHEN window_start < ? THEN 1 ELSE failures + 1 END,
             window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END,
             locked_until = CASE WHEN (CASE WHEN window_start < ? THEN 1 ELSE failures + 1 END) >= ? THEN ? ELSE locked_until END`
        )
        .bind(key, now, max <= 1 ? now + LOGIN_LOCK_MS : null, cutoff, cutoff, now, cutoff, max, now + LOGIN_LOCK_MS)
    )
  );
}

/** A successful login forgives the account's failures; the IP key keeps counting. */
export async function clearFailures(db: D1Database, email: string): Promise<void> {
  await db.prepare("DELETE FROM login_attempts WHERE key = ?").bind(`email:${email.trim().toLowerCase()}`).run();
}
