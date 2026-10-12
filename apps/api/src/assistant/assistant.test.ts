import { describe, expect, it } from "vitest";
import { historyToMessages } from "./agent";
import { evaluate } from "./calc";
import { chatCompletion, normalizeCompletion } from "./llm";
import { formatGrams, formatLkr, present } from "./present";
import { localDayBoundsMs, resolvePeriod, shopClock } from "./time";
import type { Env } from "../db/client";

describe("shop clock", () => {
  it("rolls to the next business day at local midnight, not UTC midnight", () => {
    // 2026-10-10 19:00 UTC is 00:30 on the 11th in Colombo (UTC+05:30).
    const c = shopClock(Date.UTC(2026, 9, 10, 19, 0), 330);
    expect(c).toEqual({ date: "2026-10-11", time: "00:30", weekday: "Sunday", utcOffset: "+05:30" });
  });

  it("gives epoch bounds of whole local days", () => {
    const b = localDayBoundsMs("2026-10-10", "2026-10-10", 330);
    expect(new Date(b.from).toISOString()).toBe("2026-10-09T18:30:00.000Z");
    expect(new Date(b.to).toISOString()).toBe("2026-10-10T18:29:59.999Z");
  });
});

describe("resolvePeriod", () => {
  const today = "2026-10-10"; // a Saturday; financial year starts in April
  const r = (period: Parameters<typeof resolvePeriod>[0], opts = {}) => resolvePeriod(period, today, 4, opts);

  it("resolves the everyday periods", () => {
    expect(r("today")).toMatchObject({ from: today, to: today, days: 1 });
    expect(r("yesterday")).toMatchObject({ from: "2026-10-09", to: "2026-10-09" });
    expect(r("this_week")).toMatchObject({ from: "2026-10-05", to: today });
    expect(r("last_week")).toMatchObject({ from: "2026-09-28", to: "2026-10-04", days: 7 });
    expect(r("this_month")).toMatchObject({ from: "2026-10-01", to: today });
    expect(r("last_month")).toMatchObject({ from: "2026-09-01", to: "2026-09-30", days: 30 });
    expect(r("last_7_days")).toMatchObject({ from: "2026-10-04", to: today, days: 7 });
  });

  it("crosses the year for last month in January and last quarter in Q1", () => {
    expect(resolvePeriod("last_month", "2026-01-15", 4)).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(resolvePeriod("last_quarter", "2026-02-01", 4)).toMatchObject({ from: "2025-10-01", to: "2025-12-31" });
  });

  it("uses the shop's financial year", () => {
    expect(r("this_fiscal_year")).toMatchObject({ from: "2026-04-01", to: today });
    expect(r("last_fiscal_year")).toMatchObject({ from: "2025-04-01", to: "2026-03-31" });
    expect(resolvePeriod("this_fiscal_year", "2026-02-10", 4)).toMatchObject({ from: "2025-04-01" });
    expect(r("fiscal_year_of", { date: "2024-06-01" })).toMatchObject({ from: "2024-04-01", to: "2025-03-31" });
  });

  it("reads a bare month as the most recent one and clips the current month to today", () => {
    expect(r("month", { month: 12 })).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(r("month", { month: 10 })).toMatchObject({ from: "2026-10-01", to: today });
    expect(r("month", { month: 2, year: 2024 })).toMatchObject({ to: "2024-02-29" });
    expect(() => r("month", { month: 11, year: 2026 })).toThrow(/not started/);
  });

  it("resolves a named calendar quarter and refuses a future financial year", () => {
    expect(r("quarter", { quarter: 2 })).toMatchObject({ from: "2026-04-01", to: "2026-06-30", days: 91 });
    expect(r("quarter", { quarter: 4 })).toMatchObject({ from: "2026-10-01", to: today });
    expect(resolvePeriod("quarter", "2026-02-10", 4, { quarter: 3 })).toMatchObject({ from: "2025-07-01", to: "2025-09-30" });
    expect(() => resolvePeriod("quarter", "2026-02-10", 4, { quarter: 3, year: 2026 })).toThrow(/not started/);
    expect(() => r("quarter", {})).toThrow(/quarter/);
    expect(() => r("fiscal_year_of", { date: "2027-06-01" })).toThrow(/not started/);
    expect(r("fiscal_year_of", { date: "2026-06-01" })).toMatchObject({ from: "2026-04-01", to: today, label: expect.stringMatching(/to date/) });
  });

  it("handles a January financial year and leap years", () => {
    expect(resolvePeriod("last_fiscal_year", "2025-03-01", 1)).toMatchObject({ from: "2024-01-01", to: "2024-12-31", days: 366 });
    expect(resolvePeriod("last_month", "2024-03-15", 4)).toMatchObject({ from: "2024-02-01", to: "2024-02-29", days: 29 });
  });
});

describe("calculate", () => {
  it("does arithmetic with precedence and functions", () => {
    expect(evaluate("2 + 3 * 4")).toBe(14);
    expect(evaluate("(2 + 3) * 4")).toBe(20);
    expect(evaluate("-5 + 2")).toBe(-3);
    expect(evaluate("sum(1, 2, 3.5)")).toBe(6.5);
    expect(evaluate("round(10 / 3, 2)")).toBe(3.33);
    expect(evaluate("0.1 + 0.2")).toBe(0.3);
  });

  it("accepts amounts pasted from tool output", () => {
    expect(evaluate("LKR 1,234,567.50 - LKR 1,000,000.00")).toBe(234567.5);
    expect(evaluate("Rs. 2,500 * 2")).toBe(5000);
    expect(evaluate("sum(LKR 1,234.50, LKR 2,000.00)")).toBe(3234.5);
    expect(evaluate("LKR -1,000.00 + 1")).toBe(-999);
  });

  it("never reads function arguments as one grouped number", () => {
    // Was 100200300: the commas were stripped as thousands separators.
    expect(evaluate("sum(100, 200, 300)")).toBe(600);
    expect(() => evaluate("sum(100,200,300)")).toThrow(/ambiguous/);
    expect(evaluate("max(1500,2500)")).toBe(2500);
  });

  it("refuses anything that is not arithmetic", () => {
    expect(() => evaluate("1 / 0")).toThrow(/Division by zero/);
    expect(() => evaluate("process.exit()")).toThrow();
    expect(() => evaluate("2 +")).toThrow();
    expect(() => evaluate("alert(1)")).toThrow(/Unknown function/);
  });
});

describe("present", () => {
  it("turns cents, milligrams, timestamps and basis points into what the answer should say", () => {
    const out = present(
      {
        balance_cents: 123456789,
        totalRevenueCents: -500,
        fine_mg: 12345,
        goldBalance: { openingMg: 1000 },
        created_at: Date.UTC(2026, 9, 10, 8, 35),
        tax_rate_bp: 1800,
        rows: [{ amountCents: 5 }],
        name: "Cash",
      },
      { offsetMinutes: 330 }
    );
    expect(out).toEqual({
      balance_lkr: "LKR 1,234,567.89",
      totalRevenueLkr: "LKR -5.00",
      fine_g: "12.345 g",
      goldBalance: { openingG: "1.000 g" },
      created_at: "2026-10-10 14:05",
      tax_rate_percent: "18.00%",
      rows: [{ amountLkr: "LKR 0.05" }],
      name: "Cash",
    });
    expect(formatLkr(0)).toBe("LKR 0.00");
    expect(formatGrams(1)).toBe("0.001 g");
  });

  it("formats every number inside an object keyed as cents, exactly once", () => {
    const out = present(
      { totals_cents: { opening: 100, closing: 250050 }, aging_cents: { "0-30": 5, "90+": 0 }, closing_lkr_note: "x", count: 3 },
      { offsetMinutes: 330 }
    );
    expect(out).toEqual({
      totals_lkr: { opening: "LKR 1.00", closing: "LKR 2,500.50" },
      aging_lkr: { "0-30": "LKR 0.05", "90+": "LKR 0.00" },
      closing_lkr_note: "x",
      count: 3,
    });
  });
});

describe("normalizeCompletion", () => {
  it("reads OpenAI-style tool calls with string arguments", () => {
    const c = normalizeCompletion(
      {
        choices: [{ message: { content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "trial_balance", arguments: '{"date":"2026-10-10"}' } }] } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      },
      "m"
    );
    expect(c.toolCalls).toEqual([{ id: "c1", name: "trial_balance", arguments: '{"date":"2026-10-10"}' }]);
    expect(c.promptTokens).toBe(100);
  });

  it("reads the older Workers AI shape with object arguments", () => {
    const c = normalizeCompletion({ response: "", tool_calls: [{ name: "cash_position", arguments: { branch: "Main" } }] }, "m");
    expect(c.toolCalls[0]).toMatchObject({ name: "cash_position", arguments: '{"branch":"Main"}' });
    expect(c.toolCalls[0]?.id).toMatch(/^call_/);
  });

  it("recovers a tool call written into the text, and strips leaked reasoning", () => {
    const c = normalizeCompletion(
      { choices: [{ message: { content: '<think>hmm</think>Checking.<tool_call>{"name":"payables","arguments":{}}</tool_call>' } }] },
      "m"
    );
    expect(c.toolCalls.map((t) => t.name)).toEqual(["payables"]);
    expect(c.content).toBe("Checking.");
  });

  it("makes repeated call ids unique, so each result pairs with one call", () => {
    const tc = (name: string) => ({ id: "call_0", type: "function", function: { name, arguments: "{}" } });
    const c = normalizeCompletion({ choices: [{ message: { content: null, tool_calls: [tc("a"), tc("b")] } }] }, "m");
    expect(c.toolCalls[0]?.id).toBe("call_0");
    expect(c.toolCalls[1]?.id).not.toBe("call_0");
  });

  it("drops reasoning cut off before it closed", () => {
    expect(normalizeCompletion({ response: "<think>the cash is probably" }, "m").content).toBe("");
  });
});

describe("chatCompletion", () => {
  const req = { messages: [{ role: "user" as const, content: "hi" }], tools: [], metadata: { userId: "u1" } };

  it("routes through the configured gateway, never cached", async () => {
    const seen: { model: string; opts: unknown; inputs: Record<string, unknown> }[] = [];
    const env = {
      AI_GATEWAY_ID: "goldos",
      ASSISTANT_REASONING_EFFORT: "high",
      AI: {
        run: async (model: string, inputs: Record<string, unknown>, opts: unknown) => {
          seen.push({ model, opts, inputs });
          return { choices: [{ message: { content: "hello" } }] };
        },
      },
    } as unknown as Env;
    const out = await chatCompletion(env, req);
    expect(out).toMatchObject({ content: "hello", model: "@cf/zai-org/glm-5.3-flash" });
    expect(seen[0]?.opts).toMatchObject({ gateway: { id: "goldos", skipCache: true, metadata: { app: "goldos-assistant", userId: "u1" } } });
    expect(seen[0]?.inputs.reasoning_effort).toBe("high");
    // No tools: neither an empty list nor tool_choice is sent.
    expect(seen[0]?.inputs).not.toHaveProperty("tools");
    expect(seen[0]?.inputs).not.toHaveProperty("tool_choice");
    await chatCompletion(env, { ...req, tools: [{ name: "t", description: "d", parameters: {} }] });
    expect(seen[1]?.inputs).toMatchObject({ tool_choice: "auto", tools: [{ type: "function", function: { name: "t" } }] });
  });

  it("falls back to the second model when the first fails, without the primary-only options", async () => {
    const seen: string[] = [];
    let fallbackInputs: Record<string, unknown> = {};
    const env = {
      ASSISTANT_REASONING_EFFORT: "high",
      AI: {
        run: async (model: string, inputs: Record<string, unknown>) => {
          seen.push(model);
          if (model.includes("5.3")) throw new Error("upstream 500");
          fallbackInputs = inputs;
          return { choices: [{ message: { content: "from fallback" } }] };
        },
      },
    } as unknown as Env;
    const out = await chatCompletion(env, req);
    expect(seen).toEqual(["@cf/zai-org/glm-5.3-flash", "@cf/zai-org/glm-4.7-flash"]);
    expect(out.content).toBe("from fallback");
    expect(fallbackInputs.reasoning_effort).toBeUndefined();
  });

  it("falls back when the first answer is empty, and reports when both fail", async () => {
    const empty = { AI: { run: async (m: string) => (m.includes("5.3") ? { choices: [{ message: { content: "" } }] } : { response: "ok" }) } } as unknown as Env;
    expect((await chatCompletion(empty, req)).content).toBe("ok");
    const broken = { AI: { run: async () => Promise.reject(new Error("down")) } } as unknown as Env;
    await expect(chatCompletion(broken, req)).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  });
});

describe("historyToMessages", () => {
  const row = (seq: number, role: "user" | "assistant" | "tool", content: string, extra: Partial<{ tool_calls_json: string; tool_call_id: string; tool_name: string }> = {}) => ({
    id: String(seq),
    seq,
    role,
    content,
    tool_calls_json: extra.tool_calls_json ?? null,
    tool_call_id: extra.tool_call_id ?? null,
    tool_name: extra.tool_name ?? null,
  });

  it("starts at a user turn and drops a tool call whose result was never written", () => {
    const msgs = historyToMessages([
      row(1, "tool", "orphan", { tool_call_id: "x", tool_name: "t" }),
      row(2, "user", "q1"),
      row(3, "assistant", "", { tool_calls_json: JSON.stringify([{ id: "a", name: "t", arguments: "{}" }, { id: "b", name: "t", arguments: "{}" }]) }),
      row(4, "tool", "result a", { tool_call_id: "a", tool_name: "t" }),
      row(5, "assistant", "answer 1"),
      row(6, "user", "q2"),
    ]);
    expect(msgs).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "", tool_calls: [{ id: "a", name: "t", arguments: "{}" }] },
      { role: "tool", content: "result a", tool_call_id: "a", name: "t" },
      { role: "assistant", content: "answer 1" },
      { role: "user", content: "q2" },
    ]);
  });

  it("shortens raw tool results from earlier turns", () => {
    const big = "x".repeat(5000);
    const msgs = historyToMessages([
      row(1, "user", "q1"),
      row(2, "assistant", "", { tool_calls_json: JSON.stringify([{ id: "a", name: "t", arguments: "{}" }]) }),
      row(3, "tool", big, { tool_call_id: "a", tool_name: "t" }),
      row(4, "assistant", "answer"),
      row(5, "user", "q2"),
    ]);
    const tool = msgs.find((m) => m.role === "tool");
    expect(tool?.content.length).toBeLessThan(1700);
    expect(tool?.content).toMatch(/call the tool again/);
  });
});
