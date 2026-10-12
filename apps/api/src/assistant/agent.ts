import type { Env } from "../db/client";
import { getSetting } from "../services/settings";
import type { AssistantContext } from "./context";
import { chatCompletion, type ChatMessage, type ToolCall } from "./llm";
import { systemPrompt } from "./prompt";
import { runTool, toolSpecsFor } from "./tools";
import type { ActionDraft } from "./tools/kit";

/**
 * One user turn: load the conversation, let the model call tools until it
 * answers, keep every step. Reads run immediately; a write becomes a PENDING
 * action for the user to confirm.
 */

export const MAX_STEPS = 8;
export const MAX_MESSAGE_CHARS = 4000;
const HISTORY_ROWS = 60;
const OLD_TOOL_CHARS = 1500;
export const ACTION_TTL_MS = 30 * 60 * 1000;
const STALE_RUNNING_MS = 5 * 60 * 1000;
const DEFAULT_DAILY_LIMIT = 200;

type MessageRow = {
  id: string;
  seq: number;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls_json: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
};

export type ActionView = {
  id: string;
  title: string;
  lines: string[];
  status: string;
  result: unknown;
  expiresAt: number;
  messageId: string | null;
};

export type ChatResult = {
  conversationId: string;
  messageId: string;
  reply: string;
  actions: ActionView[];
  toolsUsed: string[];
  model: string;
};

const fail = (code: string, message: string): never => {
  throw Object.assign(new Error(message), { code });
};

/** Rebuilds the model's view of past turns, dropping any half-written step. */
export function historyToMessages(rows: MessageRow[]): ChatMessage[] {
  const start = rows.findIndex((r) => r.role === "user");
  if (start < 0) return [];
  const kept = rows.slice(start);
  const answered = new Set(kept.filter((r) => r.role === "tool" && r.tool_call_id).map((r) => r.tool_call_id as string));
  const lastUser = kept.map((r) => r.role).lastIndexOf("user");
  const out: ChatMessage[] = [];
  const asked = new Set<string>();
  kept.forEach((r, i) => {
    if (r.role === "user") out.push({ role: "user", content: r.content });
    else if (r.role === "assistant") {
      const calls = (r.tool_calls_json ? (JSON.parse(r.tool_calls_json) as ToolCall[]) : []).filter((c) => answered.has(c.id));
      for (const c of calls) asked.add(c.id);
      if (!calls.length && !r.content.trim()) return;
      out.push(calls.length ? { role: "assistant", content: r.content, tool_calls: calls } : { role: "assistant", content: r.content });
    } else if (r.tool_call_id && asked.has(r.tool_call_id)) {
      // Earlier turns' raw results are shortened: the answer built from them is
      // already in the transcript, and a fresh question should re-query anyway.
      const content =
        i < lastUser && r.content.length > OLD_TOOL_CHARS
          ? `${r.content.slice(0, OLD_TOOL_CHARS)}… [older result shortened — call the tool again for current, complete figures]`
          : r.content;
      out.push({ role: "tool", content, tool_call_id: r.tool_call_id, name: r.tool_name ?? "" });
    }
  });
  return out;
}

export async function checkQuota(env: Env, userId: string, day: string): Promise<void> {
  const [enabled, limit, used] = await Promise.all([
    getSetting(env.DB, "assistant_enabled"),
    getSetting(env.DB, "assistant_daily_request_limit"),
    env.DB.prepare("SELECT requests FROM assistant_usage WHERE user_id = ? AND day = ?").bind(userId, day).first<{ requests: number }>(),
  ]);
  if (enabled?.value === false) fail("FORBIDDEN", "The assistant is turned off for this shop.");
  const max = typeof limit?.value === "number" && limit.value > 0 ? limit.value : DEFAULT_DAILY_LIMIT;
  if ((used?.requests ?? 0) >= max) fail("RATE_LIMITED", `Daily assistant limit of ${max} questions reached. It resets tomorrow.`);
}

export async function loadActions(db: D1Database, conversationId: string, now: number): Promise<ActionView[]> {
  await db.batch([
    db
      .prepare("UPDATE assistant_actions SET status = 'EXPIRED' WHERE conversation_id = ? AND status = 'PENDING' AND expires_at <= ?")
      .bind(conversationId, now),
    // A confirm whose request never reported back. It may or may not have
    // posted; saying so is honest, and retrying blind could post twice.
    db
      .prepare(
        "UPDATE assistant_actions SET status = 'FAILED', result_json = ? WHERE conversation_id = ? AND status = 'RUNNING' AND decided_at <= ?"
      )
      .bind(
        JSON.stringify({ message: "The outcome could not be confirmed. Check the source screen before preparing it again.", code: "UNKNOWN" }),
        conversationId,
        now - STALE_RUNNING_MS
      ),
  ]);
  const { results } = await db
    .prepare("SELECT id, title, summary_json, status, result_json, expires_at, message_id FROM assistant_actions WHERE conversation_id = ? ORDER BY created_at")
    .bind(conversationId)
    .all<{ id: string; title: string; summary_json: string; status: string; result_json: string | null; expires_at: number; message_id: string | null }>();
  return (results ?? []).map(actionView);
}

export function actionView(r: { id: string; title: string; summary_json: string; status: string; result_json: string | null; expires_at: number; message_id: string | null }): ActionView {
  return {
    id: r.id,
    title: r.title,
    lines: JSON.parse(r.summary_json) as string[],
    status: r.status,
    result: r.result_json ? (JSON.parse(r.result_json) as unknown) : null,
    expiresAt: r.expires_at,
    messageId: r.message_id,
  };
}

export async function chat(ctx: AssistantContext, input: { conversationId?: string; message: string }): Promise<ChatResult> {
  const { db, env, userId, now } = ctx;
  const message = input.message.trim();
  if (!message) fail("VALIDATION", "Message is empty");
  if (message.length > MAX_MESSAGE_CHARS) fail("VALIDATION", `Message is longer than ${MAX_MESSAGE_CHARS} characters`);
  await checkQuota(env, userId, ctx.today);

  let conversationId = input.conversationId;
  let rows: MessageRow[] = [];
  if (conversationId) {
    const conv = await db
      .prepare("SELECT id FROM assistant_conversations WHERE id = ? AND user_id = ? AND archived = 0")
      .bind(conversationId, userId)
      .first<{ id: string }>();
    if (!conv) fail("NOT_FOUND", "Conversation not found");
    const res = await db
      .prepare(
        `SELECT * FROM (SELECT id, seq, role, content, tool_calls_json, tool_call_id, tool_name FROM assistant_messages
         WHERE conversation_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq`
      )
      .bind(conversationId, HISTORY_ROWS)
      .all<MessageRow>();
    rows = res.results ?? [];
  } else {
    conversationId = crypto.randomUUID();
    const title = message.length > 60 ? `${message.slice(0, 57)}…` : message;
    await db
      .prepare("INSERT INTO assistant_conversations (id, user_id, title, branch_id, archived, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)")
      .bind(conversationId, userId, title, ctx.selectedBranchId, now, now)
      .run();
  }
  const convId = conversationId as string;

  // seq is taken inside each INSERT, not counted here: a confirm note (actions.ts)
  // or a second tab can write to this conversation while the turn runs, and a
  // locally counted seq would then hit UNIQUE (conversation_id, seq) and lose the turn.
  const insert = (m: {
    role: "user" | "assistant" | "tool";
    content: string;
    toolCalls?: ToolCall[];
    toolCallId?: string;
    toolName?: string;
    model?: string;
    promptTokens?: number | null;
    completionTokens?: number | null;
  }) => {
    const id = crypto.randomUUID();
    return {
      id,
      stmt: db
        .prepare(
          `INSERT INTO assistant_messages (id, conversation_id, seq, role, content, tool_calls_json, tool_call_id, tool_name, model, prompt_tokens, completion_tokens, created_at)
           VALUES (?1, ?2, (SELECT COALESCE(MAX(seq), 0) + 1 FROM assistant_messages WHERE conversation_id = ?2), ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
        )
        .bind(
          id,
          convId,
          m.role,
          m.content,
          m.toolCalls?.length ? JSON.stringify(m.toolCalls) : null,
          m.toolCallId ?? null,
          m.toolName ?? null,
          m.model ?? null,
          m.promptTokens ?? null,
          m.completionTokens ?? null,
          Date.now()
        ),
    };
  };

  await insert({ role: "user", content: message }).stmt.run();
  const history: ChatMessage[] = [...historyToMessages(rows), { role: "user", content: message }];
  const tools = toolSpecsFor(ctx);
  const system: ChatMessage = { role: "system", content: systemPrompt(ctx) };
  const metadata = { userId, conversationId: convId };

  let promptTokens = 0;
  let completionTokens = 0;
  const toolsUsed: string[] = [];
  const actionIds: string[] = [];
  let reply = "";
  let model = "";

  for (let step = 0; step <= MAX_STEPS; step++) {
    // Out of steps: one last call with no tools forces a plain answer from what was found.
    const finalStep = step === MAX_STEPS;
    const out = await chatCompletion(env, { messages: [system, ...history], tools: finalStep ? [] : tools, metadata });
    model = out.model;
    promptTokens += out.promptTokens ?? 0;
    completionTokens += out.completionTokens ?? 0;
    const calls = finalStep ? [] : out.toolCalls.slice(0, 8);

    if (calls.length === 0) {
      reply = out.content || "I could not produce an answer. Please try rephrasing the question.";
      break;
    }

    const assistantRow = insert({ role: "assistant", content: out.content, toolCalls: calls, model: out.model, promptTokens: out.promptTokens, completionTokens: out.completionTokens });
    history.push({ role: "assistant", content: out.content, tool_calls: calls });

    const outcomes = await Promise.all(calls.map((c) => runTool(ctx, c.name, c.arguments)));
    const stmts = [assistantRow.stmt];
    outcomes.forEach((o, i) => {
      const call = calls[i] as ToolCall;
      toolsUsed.push(call.name);
      let content: string;
      if (o.kind === "draft") {
        const actionId = crypto.randomUUID();
        actionIds.push(actionId);
        stmts.push(insertAction(db, { id: actionId, conversationId: convId, userId, tool: call.name, draft: o.draft, now: Date.now() }));
        content = JSON.stringify({
          status: "awaiting_user_confirmation",
          title: o.draft.title,
          details: o.draft.lines,
          instruction: "A confirmation card is now shown to the user. Tell them to review it and press Confirm. Nothing has been saved yet.",
        });
      } else content = o.content;
      history.push({ role: "tool", content, tool_call_id: call.id, name: call.name });
      stmts.push(insert({ role: "tool", content, toolCallId: call.id, toolName: call.name }).stmt);
    });
    await db.batch(stmts);
  }

  const final = insert({ role: "assistant", content: reply, model, promptTokens, completionTokens });
  const finish: D1PreparedStatement[] = [
    final.stmt,
    db.prepare("UPDATE assistant_conversations SET updated_at = ? WHERE id = ?").bind(Date.now(), convId),
    db
      .prepare(
        `INSERT INTO assistant_usage (user_id, day, requests, prompt_tokens, completion_tokens) VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(user_id, day) DO UPDATE SET requests = requests + 1, prompt_tokens = prompt_tokens + excluded.prompt_tokens,
           completion_tokens = completion_tokens + excluded.completion_tokens`
      )
      .bind(userId, ctx.today, promptTokens, completionTokens),
  ];
  for (const id of actionIds)
    finish.push(db.prepare("UPDATE assistant_actions SET message_id = ? WHERE id = ?").bind(final.id, id));
  await db.batch(finish);

  const actions = (await loadActions(db, convId, Date.now())).filter((a) => actionIds.includes(a.id));
  return { conversationId: convId, messageId: final.id, reply, actions, toolsUsed, model };
}

function insertAction(
  db: D1Database,
  a: { id: string; conversationId: string; userId: string; tool: string; draft: ActionDraft; now: number }
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO assistant_actions (id, conversation_id, user_id, tool, title, summary_json, method, path, body_json, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`
    )
    .bind(
      a.id,
      a.conversationId,
      a.userId,
      a.tool,
      a.draft.title,
      JSON.stringify(a.draft.lines),
      a.draft.method,
      a.draft.path,
      JSON.stringify(a.draft.body),
      a.now,
      a.now + ACTION_TTL_MS
    );
}

/** Counts one non-chat AI request (a bill scan) against the user's daily limit. */
export async function bumpUsage(db: D1Database, userId: string, day: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO assistant_usage (user_id, day, requests) VALUES (?, ?, 1)
       ON CONFLICT(user_id, day) DO UPDATE SET requests = requests + 1`
    )
    .bind(userId, day)
    .run();
}
