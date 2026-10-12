import type { Env } from "../db/client";

/**
 * The model client. Every call is a Workers AI run routed through AI Gateway
 * (logging, analytics, rate limits and spend controls live there), using the
 * OpenAI-style chat shape the current Workers AI chat models accept.
 *
 * A primary model answers; the fallback runs only when the primary throws or
 * returns nothing usable. Both go through the same gateway.
 */

export const DEFAULT_MODEL = "@cf/zai-org/glm-5.3-flash";
export const DEFAULT_FALLBACK_MODEL = "@cf/zai-org/glm-4.7-flash";
const REASONING = new Set(["low", "high", "max"]);

export type ToolCall = { id: string; name: string; arguments: string };

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string; name: string };

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

export type Completion = {
  content: string;
  toolCalls: ToolCall[];
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
};

export class AssistantUnavailableError extends Error {
  code = "AI_UNAVAILABLE";
}

/** Wire format: OpenAI chat-completions messages and tools. */
function toWireMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === "assistant" && m.tool_calls?.length)
      return {
        role: "assistant",
        content: m.content || "",
        tool_calls: m.tool_calls.map((t) => ({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: t.arguments },
        })),
      };
    if (m.role === "tool") return { role: "tool", content: m.content, tool_call_id: m.tool_call_id, name: m.name };
    return { role: m.role, content: m.content };
  });
}

function toWireTools(tools: ToolSpec[]): Record<string, unknown>[] {
  return tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const argString = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v ?? {}));

let synthetic = 0;
const callId = () => `call_${Date.now().toString(36)}_${(synthetic++).toString(36)}`;

/**
 * Some open models, when their tool-call parser misses, write the call into
 * the text as `<tool_call>{"name":…,"arguments":…}</tool_call>`. Recovering it
 * is better than showing the user raw JSON or silently dropping the lookup.
 */
function toolCallsInText(text: string): { calls: ToolCall[]; rest: string } {
  const calls: ToolCall[] = [];
  const rest = text.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (whole, body: string) => {
    try {
      const parsed = asRecord(JSON.parse(body));
      const name = parsed?.name;
      if (typeof name === "string") {
        calls.push({ id: callId(), name, arguments: argString(parsed?.arguments ?? parsed?.parameters) });
        return "";
      }
    } catch {
      /* not a call — leave the text as written */
    }
    return whole;
  });
  return { calls, rest: rest.trim() };
}

/** Strip any reasoning the model leaked into its visible answer. */
function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/^[\s\S]*?<\/think>/, "")
    // Reasoning cut off by the token limit never closes.
    .replace(/<think>[\s\S]*$/, "")
    .trim();
}

/**
 * Accepts both response shapes Workers AI returns: OpenAI-style `choices`, and
 * the older `{ response, tool_calls: [{ name, arguments }] }`.
 */
export function normalizeCompletion(raw: unknown, model: string): Completion {
  const r = asRecord(raw) ?? {};
  let content = "";
  let calls: ToolCall[] = [];

  const choice = Array.isArray(r.choices) ? asRecord(r.choices[0]) : null;
  const message = choice ? asRecord(choice.message) : null;
  if (message) {
    content = typeof message.content === "string" ? message.content : "";
    if (Array.isArray(message.tool_calls))
      for (const t of message.tool_calls) {
        const tc = asRecord(t);
        const fn = asRecord(tc?.function);
        const name = fn?.name ?? tc?.name;
        if (typeof name !== "string") continue;
        calls.push({
          id: typeof tc?.id === "string" && tc.id ? tc.id : callId(),
          name,
          arguments: argString(fn?.arguments ?? tc?.arguments),
        });
      }
  } else {
    content = typeof r.response === "string" ? r.response : "";
    if (Array.isArray(r.tool_calls))
      for (const t of r.tool_calls) {
        const tc = asRecord(t);
        if (typeof tc?.name !== "string") continue;
        calls.push({ id: typeof tc.id === "string" && tc.id ? tc.id : callId(), name: tc.name, arguments: argString(tc.arguments) });
      }
  }

  content = stripThinking(content);
  if (calls.length === 0 && content.includes("<tool_call>")) {
    const found = toolCallsInText(content);
    calls = found.calls;
    content = found.rest;
  }
  // Some models number calls per response ("call_0", "call_1"…) or repeat an
  // id. Each tool result is paired with its call by id, so ids must be unique.
  const seen = new Set<string>();
  calls = calls.map((c) => {
    const id = seen.has(c.id) ? callId() : c.id;
    seen.add(id);
    return id === c.id ? c : { ...c, id };
  });

  const usage = asRecord(r.usage);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    content,
    toolCalls: calls,
    model,
    promptTokens: num(usage?.prompt_tokens),
    completionTokens: num(usage?.completion_tokens),
  };
}

export type ChatRequest = {
  messages: ChatMessage[];
  tools: ToolSpec[];
  /** Gateway log metadata: who asked, for spend attribution. */
  metadata: Record<string, string>;
};

async function runOnce(env: Env, model: string, req: ChatRequest, primary: boolean): Promise<Completion> {
  if (!env.AI) throw new AssistantUnavailableError("The AI binding is not configured");
  const effort = env.ASSISTANT_REASONING_EFFORT;
  const inputs: Record<string, unknown> = {
    messages: toWireMessages(req.messages),
    temperature: 0.1,
    max_completion_tokens: 4096,
  };
  // An empty tool list with tool_choice "auto" is rejected by some models; with
  // no tools (the forced final answer) neither field is sent.
  if (req.tools.length) {
    inputs.tools = toWireTools(req.tools);
    inputs.tool_choice = "auto";
  }
  if (primary && effort && REASONING.has(effort)) inputs.reasoning_effort = effort;
  const raw = await env.AI.run(model, inputs, {
    gateway: {
      id: env.AI_GATEWAY_ID || "default",
      // Books change by the minute. A cached answer is a wrong answer.
      skipCache: true,
      metadata: { app: "goldos-assistant", ...req.metadata },
      requestTimeoutMs: 90_000,
    },
  });
  return normalizeCompletion(raw, model);
}

const usable = (c: Completion) => c.toolCalls.length > 0 || c.content.trim().length > 0;

export async function chatCompletion(env: Env, req: ChatRequest): Promise<Completion> {
  const primary = env.ASSISTANT_MODEL || DEFAULT_MODEL;
  const fallback = env.ASSISTANT_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;
  let firstError: unknown = null;
  try {
    const out = await runOnce(env, primary, req, true);
    if (usable(out) || fallback === primary) return out;
  } catch (err) {
    if (err instanceof AssistantUnavailableError) throw err;
    firstError = err;
    if (fallback === primary) throw new AssistantUnavailableError(`The AI model failed: ${String(err)}`);
  }
  try {
    return await runOnce(env, fallback, req, false);
  } catch (err) {
    throw new AssistantUnavailableError(
      `Both AI models failed (${String(firstError ?? "empty answer")}; ${String(err)})`
    );
  }
}
