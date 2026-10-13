import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../db/client";
import { extractSessionId, requireAuth, type AppVariables } from "../middleware/auth";
import { cancelAction, confirmAction } from "../assistant/actions";
import { chat, loadActions, MAX_MESSAGE_CHARS } from "../assistant/agent";
import { ACCOUNTS_READ, buildContext, canAny } from "../assistant/context";
import { DEFAULT_FALLBACK_MODEL, DEFAULT_MODEL } from "../assistant/llm";
import { buildBrief, latestBrief, scopeBrief } from "../ai/brief";
import { branchScope } from "../services/branchAccess";
import { businessDateFor } from "../services/busdate";
import { PERMISSIONS } from "@goldos/shared";
import { pagination, serviceError } from "./http";
import { getShopDb } from "../platform/resolve";

const chatSchema = z.object({
  conversationId: z.string().min(1).max(64).optional(),
  message: z.string().min(1).max(MAX_MESSAGE_CHARS),
  branchId: z.string().min(1).max(64).optional(),
});

type Ctx = { Bindings: Env; Variables: AppVariables };

/** Answers in the route's own error envelope; adds the assistant's two extra codes. */
function assistantError(c: Parameters<typeof serviceError>[0], err: unknown) {
  const code = (err as { code?: string } | null)?.code;
  const message = err instanceof Error ? err.message : "Something went wrong";
  if (code === "RATE_LIMITED") return c.json({ success: false, error: { code, message } }, 429);
  if (code === "AI_UNAVAILABLE") {
    console.error("assistant model failure", err);
    return c.json({ success: false, error: { code, message: "The AI service is not responding right now. Please try again in a moment." } }, 503);
  }
  return serviceError(c, err);
}

export const assistant = new Hono<Ctx>()
  .use(requireAuth)
  .use(async (c, next) => {
    if (!canAny({ permissions: c.get("permissions") }, ACCOUNTS_READ))
      return c.json({ success: false, error: { code: "FORBIDDEN", message: "The accounts assistant needs accounts access" } }, 403);
    await next();
  })
  .get("/status", (c) =>
    c.json(
      {
        success: true,
        data: {
          configured: !!c.env.AI,
          model: c.env.ASSISTANT_MODEL || DEFAULT_MODEL,
          fallbackModel: c.env.ASSISTANT_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL,
          gateway: c.env.AI_GATEWAY_ID || "default",
        },
      },
      200
    )
  )
  // The end-of-day brief, limited to the branches this user may see.
  .get("/brief", async (c) => {
    const brief = await latestBrief(getShopDb(c));
    if (!brief) return c.json({ success: true, data: null }, 200);
    const scope = await branchScope(getShopDb(c), c.get("userId"), c.get("permissions"));
    return c.json({ success: true, data: scopeBrief(brief, scope) }, 200);
  })
  .post("/brief/refresh", async (c) => {
    if (!c.get("permissions").includes(PERMISSIONS.ACCOUNTS_MANAGE))
      return c.json({ success: false, error: { code: "FORBIDDEN", message: "Refreshing the brief needs accounts:manage" } }, 403);
    try {
      const existing = await latestBrief(getShopDb(c));
      // Each refresh runs the model once; a double click should not run it twice.
      if (existing && existing.source === "manual" && Date.now() - existing.generatedAt < 60_000 && existing.date === (await businessDateFor(getShopDb(c), Date.now())))
        return c.json({ success: true, data: scopeBrief(existing, await branchScope(getShopDb(c), c.get("userId"), c.get("permissions"))) }, 200);
      const brief = await buildBrief({ ...c.env, DB: getShopDb(c) }, Date.now(), "manual");
      return c.json({ success: true, data: scopeBrief(brief, await branchScope(getShopDb(c), c.get("userId"), c.get("permissions"))) }, 200);
    } catch (err) {
      return assistantError(c, err);
    }
  })
  .get("/conversations", async (c) => {
    const { page, limit } = pagination(c);
    const { results } = await getShopDb(c).prepare(
      "SELECT id, title, branch_id, created_at, updated_at FROM assistant_conversations WHERE user_id = ? AND archived = 0 ORDER BY updated_at DESC LIMIT ? OFFSET ?"
    )
      .bind(c.get("userId"), limit, (page - 1) * limit)
      .all();
    return c.json({ success: true, data: { rows: results ?? [] } }, 200);
  })
  .get("/conversations/:id", async (c) => {
    const id = c.req.param("id");
    const conv = await getShopDb(c).prepare("SELECT id, title, branch_id, created_at, updated_at FROM assistant_conversations WHERE id = ? AND user_id = ? AND archived = 0")
      .bind(id, c.get("userId"))
      .first();
    if (!conv) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Conversation not found" } }, 404);
    // The user sees their questions and the answers; tool traffic stays server-side.
    // Each answer also lists the tools its turn used (first-use order), so the
    // page can show what the figures came from.
    const { results } = await getShopDb(c).prepare(
      `SELECT id, role, content, created_at, tool_calls_json, tool_name FROM assistant_messages
       WHERE conversation_id = ? ORDER BY seq`
    )
      .bind(id)
      .all<{ id: string; role: string; content: string; created_at: number; tool_calls_json: string | null; tool_name: string | null }>();
    const messages: { id: string; role: string; content: string; created_at: number; tools?: string[] }[] = [];
    let turnTools: string[] = [];
    for (const r of results ?? []) {
      if (r.role === "user") {
        turnTools = [];
        messages.push({ id: r.id, role: r.role, content: r.content, created_at: r.created_at });
      } else if (r.role === "tool") {
        if (r.tool_name && !turnTools.includes(r.tool_name)) turnTools.push(r.tool_name);
      } else if (r.role === "assistant" && r.tool_calls_json === null && r.content !== "" && !r.content.startsWith("[Confirmation card ")) {
        messages.push({ id: r.id, role: r.role, content: r.content, created_at: r.created_at, tools: turnTools });
        turnTools = [];
      }
    }
    const actions = await loadActions(getShopDb(c), id, Date.now());
    return c.json({ success: true, data: { conversation: conv, messages, actions } }, 200);
  })
  .delete("/conversations/:id", async (c) => {
    const res = await getShopDb(c).prepare("UPDATE assistant_conversations SET archived = 1 WHERE id = ? AND user_id = ? RETURNING id")
      .bind(c.req.param("id"), c.get("userId"))
      .first<{ id: string }>();
    if (!res) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Conversation not found" } }, 404);
    await getShopDb(c).prepare("UPDATE assistant_actions SET status = 'CANCELLED' WHERE conversation_id = ? AND status = 'PENDING'").bind(c.req.param("id")).run();
    return c.json({ success: true, data: { id: c.req.param("id") } }, 200);
  })
  .post("/chat", async (c) => {
    const parsed = chatSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Send a message of up to 4000 characters" } }, 400);
    try {
      const ctx = await buildContext({ ...c.env, DB: getShopDb(c) }, {
        userId: c.get("userId"),
        permissions: c.get("permissions"),
        selectedBranchId: parsed.data.branchId,
      });
      const data = await chat(ctx, { conversationId: parsed.data.conversationId, message: parsed.data.message });
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return assistantError(c, err);
    }
  })
  .post("/actions/:id/confirm", async (c) => {
    const sessionId = extractSessionId(c);
    if (!sessionId) return c.json({ success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } }, 401);
    try {
      const data = await confirmAction({ ...c.env, DB: getShopDb(c) }, { id: c.req.param("id"), userId: c.get("userId"), sessionId });
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return assistantError(c, err);
    }
  })
  .post("/actions/:id/cancel", async (c) => {
    try {
      const data = await cancelAction({ ...c.env, DB: getShopDb(c) }, { id: c.req.param("id"), userId: c.get("userId") });
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return assistantError(c, err);
    }
  });
