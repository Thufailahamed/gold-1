import type { Env } from "../db/client";
import { actionView, type ActionView } from "./agent";

/**
 * Confirming a proposed posting. The stored request is sent to the real route
 * through the app itself, carrying the confirming user's own session, so the
 * route does everything it would for a click on its own screen: permission,
 * validation, approval thresholds, day/year locks, the atomic batch and the
 * audit row. The idempotency key is derived from the action, so a double
 * click or a retried confirm cannot post twice.
 */

export type Dispatch = (req: Request, env: Env) => Promise<Response>;

let dispatcher: Dispatch | null = null;

/** app.ts registers its own fetch here; the assistant router cannot import the app that mounts it. */
export function bindAssistantDispatch(d: Dispatch): void {
  dispatcher = d;
}

type ActionRow = {
  id: string;
  conversation_id: string;
  user_id: string;
  title: string;
  summary_json: string;
  method: string;
  path: string;
  body_json: string;
  status: string;
  result_json: string | null;
  expires_at: number;
  message_id: string | null;
};

const fail = (code: string, message: string): never => {
  throw Object.assign(new Error(message), { code });
};

async function load(db: D1Database, id: string, userId: string): Promise<ActionRow> {
  const row = await db.prepare("SELECT * FROM assistant_actions WHERE id = ? AND user_id = ?").bind(id, userId).first<ActionRow>();
  if (!row) fail("NOT_FOUND", "Action not found");
  return row as ActionRow;
}

/** A short line in the conversation, so the next question knows what happened to the card. */
async function note(db: D1Database, row: ActionRow, text: string): Promise<void> {
  // seq is taken inside the INSERT so a chat turn writing at the same moment
  // cannot collide on UNIQUE (conversation_id, seq). The note is a courtesy:
  // failing to write it must never turn a posted confirm into an error.
  try {
    await db
      .prepare(
        `INSERT INTO assistant_messages (id, conversation_id, seq, role, content, created_at)
         VALUES (?1, ?2, (SELECT COALESCE(MAX(seq), 0) + 1 FROM assistant_messages WHERE conversation_id = ?2), 'assistant', ?3, ?4)`
      )
      .bind(crypto.randomUUID(), row.conversation_id, `[Confirmation card "${row.title}"] ${text}`, Date.now())
      .run();
  } catch (err) {
    console.error("assistant confirmation note failed", err);
  }
}

function describe(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as Record<string, unknown>;
  const ref = d.number ?? d.entryNo ?? d.entry_no ?? d.id;
  return typeof ref === "string" ? ` Reference: ${ref}.` : "";
}

export async function confirmAction(env: Env, input: { id: string; userId: string; sessionId: string }): Promise<ActionView> {
  if (!dispatcher) fail("INTERNAL", "Assistant dispatch is not bound");
  const db = env.DB;
  const now = Date.now();
  // The claim is one conditional UPDATE: of two simultaneous confirms, exactly
  // one gets a row back. A claim is never re-taken: the idempotency key is
  // scoped to the session, so a retry from a new login could post twice. A
  // claim left RUNNING by a request that died is reported as unknown instead
  // (see loadActions) and the user checks the source screen.
  const claimed = await db
    .prepare(
      "UPDATE assistant_actions SET status = 'RUNNING', decided_at = ? WHERE id = ? AND user_id = ? AND status = 'PENDING' AND expires_at > ? RETURNING id"
    )
    .bind(now, input.id, input.userId, now)
    .first<{ id: string }>();
  if (!claimed) {
    const row = await load(db, input.id, input.userId);
    if (row.status === "PENDING" && row.expires_at <= now) {
      await db.prepare("UPDATE assistant_actions SET status = 'EXPIRED' WHERE id = ? AND status = 'PENDING'").bind(row.id).run();
      fail("CONFLICT", "This confirmation has expired. Ask the assistant to prepare it again.");
    }
    fail("CONFLICT", `This action is already ${row.status.toLowerCase().replace(/_/g, " ")}.`);
  }
  const row = await load(db, input.id, input.userId);

  let status: string;
  let result: Record<string, unknown>;
  try {
    const res = await (dispatcher as Dispatch)(
      new Request(`https://assistant.internal${row.path}`, {
        method: row.method,
        headers: {
          "content-type": "application/json",
          cookie: `session=${input.sessionId}`,
          "idempotency-key": `assistant-${row.id}`,
        },
        body: row.body_json,
      }),
      env
    );
    const json = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown; error?: { code?: string; message?: string; approvalId?: string } } | null;
    if (res.status === 202 && json?.error?.code === "PENDING") {
      status = "SENT_FOR_APPROVAL";
      result = { message: json.error.message ?? "Sent for approval", approvalId: json.error.approvalId };
    } else if (res.ok && json?.success && (json.data as { status?: unknown } | undefined)?.status === "PENDING_APPROVAL") {
      // An expense above the threshold is saved but not posted: it waits for a
      // second person. Calling that "Recorded" would have the model say it posted.
      status = "SENT_FOR_APPROVAL";
      result = { message: "Saved and waiting for approval; it is not in the ledger yet.", data: json.data };
    } else if (res.ok && json?.success) {
      status = "DONE";
      result = { message: "Recorded", data: json.data };
    } else {
      status = "FAILED";
      result = { message: json?.error?.message ?? `The request failed (HTTP ${res.status})`, code: json?.error?.code };
    }
  } catch (err) {
    status = "FAILED";
    result = { message: err instanceof Error ? err.message : "The request failed" };
  }

  await db
    .prepare("UPDATE assistant_actions SET status = ?, result_json = ? WHERE id = ?")
    .bind(status, JSON.stringify(result), row.id)
    .run();
  await note(
    db,
    row,
    status === "DONE"
      ? `The user confirmed it and it was recorded.${describe(result.data)}`
      : status === "SENT_FOR_APPROVAL"
        ? `The user confirmed it; it was sent for approval and has not posted yet.${describe(result.data)}`
        : `The user confirmed it but it was refused: ${String(result.message)}`
  );
  return actionView({ ...row, status, result_json: JSON.stringify(result) });
}

export async function cancelAction(env: Env, input: { id: string; userId: string }): Promise<ActionView> {
  const db = env.DB;
  const res = await db
    .prepare("UPDATE assistant_actions SET status = 'CANCELLED', decided_at = ? WHERE id = ? AND user_id = ? AND status = 'PENDING' RETURNING id")
    .bind(Date.now(), input.id, input.userId)
    .first<{ id: string }>();
  const row = await load(db, input.id, input.userId);
  if (!res) fail("CONFLICT", `This action is already ${row.status.toLowerCase().replace(/_/g, " ")}.`);
  await note(db, row, "The user cancelled it; nothing was recorded.");
  return actionView(row);
}
