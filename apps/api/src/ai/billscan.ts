import type { Env } from "../db/client";

/**
 * Reads a photographed bill with a Workers AI vision model (through AI
 * Gateway) and returns what it found as a SUGGESTION for the expense form.
 * Nothing is posted: the person reviews the fields and records the expense
 * through the normal screen, so every approval and lock rule still applies.
 * The model is never trusted: dates, amounts and the category are validated
 * here, and anything doubtful comes back as a warning.
 */

export const DEFAULT_VISION_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
export const SCAN_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const SCAN_MAX_BYTES = 4 * 1024 * 1024;

export type ScanCategory = { id: string; name: string };

export type BillScan = {
  vendor: string | null;
  date: string | null;
  amountLkr: number | null;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  currency: string | null;
  warnings: string[];
  model: string;
};

export class ScanUnavailableError extends Error {
  code = "AI_UNAVAILABLE";
}

function base64(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(out);
}

const instruction = (categories: ScanCategory[], today: string) =>
  `You read photographs of shop bills and receipts. Reply with ONE JSON object and nothing else:
{"vendor": string|null, "date": "YYYY-MM-DD"|null, "total": number|null, "currency": string|null, "description": string|null, "category": string|null}
- vendor: the shop or company that issued the bill.
- date: the bill date. Today is ${today}. If the year is missing, use the current year. null if unreadable.
- total: the final amount payable including tax, as a plain number (no currency symbol, no thousands separators). null if you cannot read it. Never add up lines yourself; copy the printed total.
- currency: the ISO code or symbol printed (e.g. "LKR", "Rs", "USD"), null if none.
- description: at most 12 words saying what was bought.
- category: the single best match from this list, copied exactly, or null if none fits: ${categories.map((c) => `"${c.name}"`).join(", ")}.
If the image is not a bill, return all fields null.`;

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function parseJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return asRecord(JSON.parse(cleaned.slice(start, end + 1)));
  } catch {
    return null;
  }
}

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** "Rs. 12,500.00" / 12500 / "12 500" → 12500, or null. */
function money(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
  if (typeof v !== "string") return null;
  const m = /\d[\d,\s]*(?:\.\d+)?/.exec(v);
  const n = m ? Number(m[0].replace(/[,\s]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** A real calendar date written YYYY-MM-DD (rejects 2026-02-30). */
function isRealDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Turn the model's JSON into a validated suggestion. Pure, so it is unit-tested directly. */
export function interpretScan(raw: unknown, categories: ScanCategory[], today: string, model: string): BillScan {
  const r = asRecord(raw) ?? {};
  const warnings: string[] = [];

  const vendor = text(r.vendor, 100);
  const description = text(r.description, 200);
  const currency = text(r.currency, 10);
  let amountLkr = money(r.total);
  let date = text(r.date, 10);

  if (date && !isRealDate(date)) date = null;
  if (!date) warnings.push("The date could not be read. Check it before recording.");
  else if (date > today) {
    warnings.push(`The bill is dated ${date}, which is in the future. Today is ${today}.`);
    date = null;
  } else if (date < `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`) warnings.push(`The bill is dated ${date}, over a year ago.`);

  if (amountLkr === null) warnings.push("The total could not be read. Enter it from the bill.");
  const cur = currency ? norm(currency) : "";
  if (cur && !["lkr", "rs", "rs.", "lk", "rupees", "රු", "රු."].includes(cur) && !cur.startsWith("rs")) {
    warnings.push(`The bill shows ${currency}, not rupees. The amount was left blank.`);
    amountLkr = null;
  }

  let categoryId: string | null = null;
  let categoryName: string | null = null;
  const wanted = text(r.category, 100);
  if (wanted) {
    const hit = categories.find((c) => norm(c.name) === norm(wanted));
    if (hit) {
      categoryId = hit.id;
      categoryName = hit.name;
    }
  }

  return { vendor, date, amountLkr, description, categoryId, categoryName, currency, warnings, model };
}

export async function scanBill(
  env: Env,
  image: { bytes: Uint8Array; type: string },
  categories: ScanCategory[],
  today: string
): Promise<BillScan> {
  if (!env.AI) throw new ScanUnavailableError("The AI binding is not configured");
  const model = env.ASSISTANT_VISION_MODEL || DEFAULT_VISION_MODEL;
  let raw: unknown;
  try {
    raw = await env.AI.run(
      model,
      {
        messages: [
          { role: "system", content: instruction(categories, today) },
          {
            role: "user",
            content: [
              { type: "text", text: "Read this bill." },
              { type: "image_url", image_url: { url: `data:${image.type};base64,${base64(image.bytes)}` } },
            ],
          },
        ],
        temperature: 0,
        max_completion_tokens: 600,
      },
      { gateway: { id: env.AI_GATEWAY_ID || "default", skipCache: true, metadata: { app: "goldos-billscan" }, requestTimeoutMs: 60_000 } }
    );
  } catch (err) {
    throw new ScanUnavailableError(`The vision model failed: ${String(err)}`);
  }
  const r = asRecord(raw);
  const choice = Array.isArray(r?.choices) ? asRecord((r?.choices as unknown[])[0]) : null;
  const content = asRecord(choice?.message)?.content ?? r?.response;
  const parsed = typeof content === "string" ? parseJson(content) : asRecord(content);
  if (!parsed) throw new ScanUnavailableError("The model did not return a readable answer. Try a clearer photo.");
  return interpretScan(parsed, categories, today, model);
}
