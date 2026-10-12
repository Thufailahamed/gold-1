import { isBusinessDate } from "@goldos/shared";
import { z, type ZodTypeAny } from "zod";
import type { AssistantContext } from "../context";
import { toolError } from "../context";
import { PERIODS, resolvePeriod, type Period, type ResolvedPeriod } from "../time";

/**
 * One definition per parameter yields both halves a tool needs: the JSON
 * schema the model is shown, and the zod schema its arguments are checked
 * against. Open models send "1500" for 1500 and null for "not given", so
 * numbers coerce and empty values read as absent.
 */

export type Field<T> = { json: Record<string, unknown>; zod: z.ZodType<T, z.ZodTypeDef, unknown>; optional: boolean };

const blankToUndefined = (v: unknown) => (v === null || v === "" ? undefined : v);

export const p = {
  str: (description: string, max = 500): Field<string> => ({
    json: { type: "string", description },
    zod: z.string().trim().min(1, "must not be empty").max(max),
    optional: false,
  }),
  num: (description: string): Field<number> => ({
    json: { type: "number", description },
    zod: z.coerce.number().finite(),
    optional: false,
  }),
  int: (description: string, min: number, max: number): Field<number> => ({
    json: { type: "integer", description, minimum: min, maximum: max },
    zod: z.coerce.number().int().min(min).max(max),
    optional: false,
  }),
  bool: (description: string): Field<boolean> => ({
    json: { type: "boolean", description },
    zod: z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()),
    optional: false,
  }),
  enm: <const T extends readonly [string, ...string[]]>(values: T, description: string): Field<T[number]> => ({
    json: { type: "string", enum: [...values], description },
    zod: z.enum(values as unknown as [T[number], ...T[number][]]),
    optional: false,
  }),
  date: (description: string): Field<string> => ({
    json: { type: "string", description: `${description} Format YYYY-MM-DD.`, pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    zod: z.string().trim().refine(isBusinessDate, "must be a real date written YYYY-MM-DD"),
    optional: false,
  }),
  /** Money the user speaks in: rupees, at most two decimals. */
  lkr: (description: string): Field<number> => ({
    json: { type: "number", description: `${description} In LKR (rupees, not cents), e.g. 12500.50.` },
    zod: z.coerce
      .number()
      .finite()
      .positive("must be more than zero")
      .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "may have at most two decimal places"),
    optional: false,
  }),
  opt: <T>(f: Field<T>): Field<T | undefined> => ({
    json: f.json,
    zod: z.preprocess(blankToUndefined, f.zod.optional()) as z.ZodType<T | undefined, z.ZodTypeDef, unknown>,
    optional: true,
  }),
};

type Shape = Record<string, Field<unknown>>;
type Infer<S extends Shape> = { [K in keyof S]: S[K] extends Field<infer T> ? T : never };

export type Params<A> = { json: Record<string, unknown>; zod: z.ZodType<A, z.ZodTypeDef, unknown> };

export function params<S extends Shape>(shape: S): Params<Infer<S>> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const zshape: Record<string, ZodTypeAny> = {};
  for (const [k, f] of Object.entries(shape)) {
    properties[k] = f.json;
    if (!f.optional) required.push(k);
    zshape[k] = f.zod;
  }
  return {
    json: { type: "object", properties, required, additionalProperties: false },
    zod: z.object(zshape) as unknown as z.ZodType<Infer<S>, z.ZodTypeDef, unknown>,
  };
}

/** The common date-window parameters every period report takes. */
export const periodFields = {
  period: p.opt(
    p.enm(
      PERIODS,
      "A named period, resolved to exact dates by the server. Use this for any relative period ('last month', 'this financial year'). 'month' needs month (and optionally year); 'quarter' needs quarter (calendar, 1 = Jan-Mar; optionally year); 'fiscal_year_of' needs date."
    )
  ),
  from: p.opt(p.date("Start date, inclusive. Use with 'to' for an explicit range instead of 'period'.")),
  to: p.opt(p.date("End date, inclusive.")),
  month: p.opt(p.int("Month number 1-12, with period 'month'.", 1, 12)),
  quarter: p.opt(p.int("Calendar quarter 1-4, with period 'quarter'.", 1, 4)),
  year: p.opt(p.int("Year, with period 'month' or 'quarter'.", 2000, 2100)),
  date: p.opt(p.date("A date inside the financial year, with period 'fiscal_year_of'.")),
};

export type PeriodArgs = {
  period?: Period;
  from?: string;
  to?: string;
  month?: number;
  quarter?: number;
  year?: number;
  date?: string;
};

export function rangeOf(ctx: AssistantContext, a: PeriodArgs, fallback: Period = "this_month"): ResolvedPeriod {
  if (a.from || a.to) {
    const from = a.from ?? a.to ?? ctx.today;
    const to = a.to ?? ctx.today;
    if (from > to) toolError("VALIDATION", `'from' (${from}) is after 'to' (${to})`);
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    return { from, to, label: from === to ? from : `${from} to ${to}`, days };
  }
  // A month or date sent without its period would otherwise be dropped and
  // the default period reported in its place.
  let period = a.period;
  if (!period && a.month) period = "month";
  if (!period && a.quarter) period = "quarter";
  if (!period && a.year)
    toolError("VALIDATION", `'year' is only used with a month or quarter. For the whole year pass from ${a.year}-01-01 and to ${a.year}-12-31.`);
  if (!period && a.date)
    toolError("VALIDATION", "'date' is only used with period 'fiscal_year_of'. For a single day pass from and to as that date.");
  return resolvePeriod(period ?? fallback, ctx.today, ctx.fiscalStartMonth, { month: a.month, quarter: a.quarter, year: a.year, date: a.date });
}

/** A single as-of date; defaults to today and refuses the future. */
export function asOfDate(ctx: AssistantContext, d: string | undefined): string {
  const date = d ?? ctx.today;
  if (date > ctx.today) toolError("VALIDATION", `${date} is in the future; today is ${ctx.today}`);
  return date;
}

export const toCents = (lkr: number) => Math.round(lkr * 100);

export const branchField = p.opt(
  p.str("Branch name, code or id. Leave out for the default described in the system prompt; 'all' for the whole shop.", 100)
);

export type ActionDraft = {
  title: string;
  /** Plain lines shown on the confirm card, figures already formatted. */
  lines: string[];
  method: "POST" | "PATCH" | "PUT";
  path: string;
  body: Record<string, unknown>;
};

export type ToolDef<A = Record<string, unknown>> = {
  name: string;
  description: string;
  kind: "read" | "write";
  /** The user needs at least one of these. */
  perms: readonly string[];
  params: Params<A>;
  run(ctx: AssistantContext, args: A): Promise<unknown>;
};

/** A tool with its argument type erased, so tools of different shapes share one list. */
export type AnyTool = {
  name: string;
  description: string;
  kind: "read" | "write";
  perms: readonly string[];
  params: { json: Record<string, unknown>; zod: ZodTypeAny };
  run(ctx: AssistantContext, args: unknown): Promise<unknown>;
};

/** Typed where it is written; the registry validates args with `params.zod` before `run`. */
export function defineTool<A>(t: ToolDef<A>): AnyTool {
  return t as unknown as AnyTool;
}

/** Parse body against the route's own schema so a bad proposal never reaches the confirm card. */
export function checkBody(schema: z.ZodTypeAny, body: Record<string, unknown>): Record<string, unknown> {
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    toolError(
      "VALIDATION",
      `The request would be rejected: ${parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")}`
    );
  return body;
}
