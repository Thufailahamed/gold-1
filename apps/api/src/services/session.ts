export const SESSION_IDLE_MS = 1000 * 60 * 60 * 12; // 12h idle
export const SESSION_ABSOLUTE_MS = 1000 * 60 * 60 * 24 * 7; // 7d absolute
export const SESSION_TOUCH_MS = 1000 * 60 * 5; // idle deadline refreshed at most every 5 min

export async function createSession(
  db: D1Database,
  userId: string
): Promise<{ id: string; expiresAt: number }> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + SESSION_IDLE_MS;
  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, userId, expiresAt, now)
    .run();
  return { id, expiresAt };
}

export async function destroySession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}
