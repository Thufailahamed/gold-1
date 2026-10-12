import { canAny, type AssistantContext } from "../context";
import type { ToolSpec } from "../llm";
import { toToolContent } from "../present";
import type { ActionDraft, AnyTool } from "./kit";
import { readTools } from "./read";
import { writeTools } from "./write";

export const ALL_TOOLS: AnyTool[] = [...readTools, ...writeTools];
const BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t]));

const allowed = (ctx: AssistantContext, t: AnyTool) => t.perms.length === 0 || canAny(ctx, t.perms);

/** The model is only shown tools this user could use — it cannot ask for what it cannot see. */
export function toolSpecsFor(ctx: AssistantContext): ToolSpec[] {
  return ALL_TOOLS.filter((t) => allowed(ctx, t)).map((t) => ({ name: t.name, description: t.description, parameters: t.params.json }));
}

export type ToolOutcome =
  | { kind: "result"; content: string; ok: true }
  | { kind: "error"; content: string; ok: false }
  | { kind: "draft"; draft: ActionDraft; ok: true };

/** Codes a tool raises on purpose; their message is written for the model to act on. */
const EXPECTED = new Set(["VALIDATION", "NOT_FOUND", "AMBIGUOUS", "FORBIDDEN", "CONFLICT", "PENDING"]);

export async function runTool(ctx: AssistantContext, name: string, rawArgs: string): Promise<ToolOutcome> {
  const tool = BY_NAME.get(name);
  if (!tool) return { kind: "error", ok: false, content: JSON.stringify({ error: `Unknown tool "${name}".` }) };
  if (!allowed(ctx, tool))
    return { kind: "error", ok: false, content: JSON.stringify({ error: "This user does not have permission for that. Tell them so." }) };

  let args: unknown;
  try {
    args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    return { kind: "error", ok: false, content: JSON.stringify({ error: "Arguments were not valid JSON. Call the tool again with a JSON object." }) };
  }
  const parsed = tool.params.zod.safeParse(args ?? {});
  if (!parsed.success)
    return {
      kind: "error",
      ok: false,
      content: JSON.stringify({
        error: "Invalid arguments",
        issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(arguments)"}: ${i.message}`),
      }),
    };

  try {
    const out = await tool.run(ctx, parsed.data);
    if (tool.kind === "write") return { kind: "draft", ok: true, draft: out as ActionDraft };
    return { kind: "result", ok: true, content: toToolContent(out, { offsetMinutes: ctx.offsetMinutes }) };
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    const message = err instanceof Error ? err.message : String(err);
    if (code && EXPECTED.has(code)) return { kind: "error", ok: false, content: JSON.stringify({ error: message, code }) };
    console.error(`assistant tool ${name} failed`, err);
    return {
      kind: "error",
      ok: false,
      content: JSON.stringify({ error: "The lookup failed on the server. Tell the user this figure could not be retrieved; do not estimate it." }),
    };
  }
}
