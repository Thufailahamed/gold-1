import type { Env } from "../db/client";
import { ScanUnavailableError } from "./billscan";
import { DEFAULT_SHEET_MODEL, moneyCents } from "./daysheet-scan";

/**
 * Reads a photographed handwritten SALE bill (the counter's carbon bill book)
 * with a Workers AI vision model. The reading is only a draft for the till:
 * services/salebill.ts matches its lines to stock, and the cashier checks it
 * and takes payment through the normal POS, so every sale rule still applies.
 * Nothing the model says is trusted: weights, amounts and payment methods are
 * re-parsed here, the printed total is checked against the lines, and every
 * doubt comes back as a warning.
 */

export const SALEBILL_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const SALEBILL_MAX_BYTES = 6 * 1024 * 1024;

export type BillPayMethod = "cash" | "card" | "bank" | "cheque" | "credit";

export type BillLine = {
  line: number;
  /** The first column: a product barcode (BAN-AA-0001), "New" for a piece from old gold, or an old tag number. */
  ref: string | null;
  /** True when the first column says "New": the piece comes from old gold stock, not a tagged product. */
  fromOldGold: boolean;
  description: string | null;
  weightText: string | null;
  weightMg: number | null;
  amountCents: number | null;
};

export type SaleBillReading = {
  date: string | null;
  billNo: string | null;
  customer: { name: string | null; place: string | null; phone: string | null };
  lines: BillLine[];
  totalCents: number | null;
  payments: { method: BillPayMethod; amountCents: number; label: string | null }[];
  warnings: string[];
  model: string;
};

function base64(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(out);
}

const instruction = (today: string) =>
  `You transcribe a photographed handwritten SALE BILL from a gold jewellery shop in Sri Lanka.
The top of the bill has the customer's name, often a place under it, the date (day/month/year) and a phone number such as 0776328343. A printed bill-book number may be stamped near the bottom.
Each item line has four parts, left to right:
1. REF — a short mark in the left margin: a product barcode such as "BAN-AA-0001", the word "New", or an old number such as "815". "New" is a small handwritten word with a line under it; write it as "New". "" if there is none.
2. DESCRIPTION — the item, e.g. "Turky Bangle", "Lotust chain", "Necklas".
3. WEIGHT — the gold weight in grams. It is often written with an "x" in place of the decimal point: "12x130" means 12.130 g, "1x150" means 1.150 g. Copy it EXACTLY as written, including the "x". One piece rarely weighs over 50 g; the part before the "x" is one or two digits.
4. AMOUNT — the price in rupees, e.g. "546000".
Under the items: the TOTAL, then the payments, each with a label on its left: "Cash", "Card", "Bank", "Chq". Lines with no label between them are running balances; skip those. The last line is usually "B/L" (the balance left owing) with its amount.

Reply with ONE JSON object and nothing else:
{"customer": {"name": string|null, "place": string|null, "phone": string|null}, "date": "YYYY-MM-DD"|null, "billNo": string|null, "lines": [{"ref": string, "description": string, "weight": string, "amount": string}], "total": string, "payments": [{"label": string, "amount": string}], "balance": string}
Rules:
- One object per item line, top to bottom. Copy numbers exactly as written: no commas, no currency. Never invent, round or add up values.
- "total" is the total written under the item amounts. "payments" are the labelled payments only (Cash, Card, Bank, Chq…). "balance" is the B/L amount, "" if there is none.
- Ignore anything crossed out. If a value was crossed out and rewritten, use the rewritten value.
- Today is ${today}. Dates are written day/month/year. null if there is no date.
- If the image is not such a bill, return {"customer": {"name": null, "place": null, "phone": null}, "date": null, "billNo": null, "lines": [], "total": "", "payments": [], "balance": ""}.`;

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function parseJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return asRecord(JSON.parse(cleaned.slice(start, end + 1)));
  } catch {
    return null;
  }
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
};

/**
 * A bill weight in milligrams. The counter writes the decimal point as an
 * "x": "12x130" is 12.130 g, "1x150" is 1.150 g. Plain "12.130", "12.130g"
 * and a number of grams read too.
 */
export function billWeightMg(v: unknown): number | null {
  let g: number;
  if (typeof v === "number") g = v;
  else if (typeof v === "string") {
    const s = v.trim().replace(/\s*(?:g|gm|grams?)$/i, "");
    const m = /^(\d{1,4})\s*(?:[x×*.,]\s*(\d{1,3}))?$/i.exec(s);
    if (!m) return null;
    g = Number(m[1]) + (m[2] ? Number(`0.${m[2]}`) : 0);
  } else return null;
  // One piece of jewellery: above 2 kg is a misread.
  return Number.isFinite(g) && g > 0 && g < 2000 ? Math.round(g * 1000) : null;
}

/** "Cash", "Card", "B/L"… → how it was paid. "B/L" and "A/C" are the balance left on the customer's account. */
export function billPayMethod(label: unknown): BillPayMethod | null {
  if (typeof label !== "string") return null;
  const s = label.trim().toLowerCase();
  if (/\b(b\s*\/?\s*l|bal(ance)?|credit|cr|a\s*\/\s*c|account)\b/.test(s)) return "credit";
  if (/\bcash\b/.test(s)) return "cash";
  // A hurried "Card" often reads as "Carl".
  if (/\b(car[dl]|visa|master|amex)\b/.test(s)) return "card";
  if (/\b(chq|cheque|check)\b/.test(s)) return "cheque";
  if (/\b(bank|online|transfer|tt|deposit)\b/.test(s)) return "bank";
  return null;
}

/** "New", "NEW", "new." — the piece was taken from old gold. */
const isNew = (ref: string | null) => !!ref && /^n[eo]w\.?$/i.test(ref.trim());

/** A Sri Lankan number (077 632 8343, +94 77 632 8343) as written on the books: 0776328343. */
export function billPhone(v: unknown): string | null {
  const s = text(v, 40);
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("94")) return `0${digits.slice(2)}`;
  if (digits.length === 9 && digits.startsWith("7")) return `0${digits}`;
  return digits.length === 10 && digits.startsWith("0") ? digits : null;
}

const isRealDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

const rupees = (cents: number) => (cents / 100).toLocaleString("en-US");

/** What a re-read should look at again: a total the lines miss, lines whose price per gram is off. */
type Reading = { bill: SaleBillReading; doubts: string[]; parsed: Record<string, unknown> };

function readingOf(raw: unknown, today: string, model: string): Reading {
  const r = asRecord(raw) ?? {};
  const warnings: string[] = [];

  const lines: BillLine[] = [];
  for (const item of Array.isArray(r.lines) ? r.lines : []) {
    const x = asRecord(item);
    if (!x) continue;
    const ref = text(x.ref, 40);
    const description = text(x.description, 120);
    const weightText = text(x.weight, 30);
    const amountCents = moneyCents(x.amount);
    if (!ref && !description && !weightText && amountCents === null) continue;
    const l: BillLine = { line: lines.length + 1, ref: isNew(ref) ? null : ref, fromOldGold: isNew(ref), description, weightText, weightMg: billWeightMg(weightText), amountCents };
    if (weightText && l.weightMg === null) warnings.push(`Line ${l.line}: the weight "${weightText}" could not be read as grams.`);
    if (l.amountCents === null) warnings.push(`Line ${l.line}: the amount could not be read.`);
    lines.push(l);
  }

  // A line whose rupees per gram is far from the others usually has a misread weight or amount.
  const doubts: string[] = [];
  const perGram = lines.filter((l) => l.weightMg && l.amountCents).map((l) => l.amountCents! / l.weightMg!);
  if (perGram.length >= 3) {
    const median = [...perGram].sort((a, b) => a - b)[Math.floor(perGram.length / 2)]!;
    for (const l of lines) {
      if (!l.weightMg || !l.amountCents) continue;
      const ratio = l.amountCents / l.weightMg / median;
      if (ratio > 1.6 || ratio < 0.6) {
        doubts.push(`line ${l.line} (${l.weightText} for ${l.amountCents / 100}) has a price per gram far from the other lines, so its weight or amount is probably misread`);
        warnings.push(`Line ${l.line}: ${rupees(l.amountCents)} for ${(l.weightMg / 1000).toFixed(3)} g is far from the other lines' price per gram. Check the weight and amount.`);
      }
    }
  }

  const totalCents = moneyCents(r.total);
  const summed = lines.reduce((s, l) => s + (l.amountCents ?? 0), 0);
  const gap = totalCents !== null && summed !== totalCents;
  if (gap) doubts.unshift(`the item amounts add up to ${rupees(summed)}, but the total written is ${rupees(totalCents!)}`);
  if (gap) warnings.push(`The total written on the bill is ${rupees(totalCents!)}, but the lines read add up to ${rupees(summed)}. A line was probably misread.`);
  if (totalCents === null && lines.length) warnings.push("The bill total could not be read; the lines were added up instead.");

  const payments: SaleBillReading["payments"] = [];
  for (const item of Array.isArray(r.payments) ? r.payments : []) {
    const x = asRecord(item);
    const amountCents = moneyCents(x?.amount);
    if (!x || amountCents === null) continue;
    const label = text(x.label, 30);
    const method = billPayMethod(label);
    if (!method) warnings.push(`A payment of ${rupees(amountCents)} is labelled "${label ?? ""}", which is not a known method. It was taken as cash.`);
    payments.push({ method: method ?? "cash", amountCents, label });
  }
  // B/L is what the customer still owes: it goes on their account.
  const balance = moneyCents(r.balance);
  if (balance !== null && !payments.some((p) => p.method === "credit")) payments.push({ method: "credit", amountCents: balance, label: "B/L" });
  const due = totalCents ?? summed;
  const paid = payments.reduce((s, p) => s + p.amountCents, 0);
  if (payments.length && paid !== due) warnings.push(`The payments add up to ${rupees(paid)}, but the bill total is ${rupees(due)}. Check the payments before charging.`);

  const c = asRecord(r.customer) ?? {};
  const phoneText = text(c.phone, 40);
  const phone = billPhone(phoneText);
  if (phoneText && !phone) warnings.push(`The phone number "${phoneText}" is not a full Sri Lankan number.`);

  let date = text(r.date, 10);
  if (date && !isRealDate(date)) date = null;
  // A hurried "2026" reads as "2006": a bill years away from today is this year's.
  if (date && Math.abs(Number(date.slice(0, 4)) - Number(today.slice(0, 4))) >= 2) {
    const thisYear = `${today.slice(0, 4)}${date.slice(4)}`;
    date = isRealDate(thisYear) ? thisYear : null;
  }
  if (date && date > today) warnings.push(`The bill is dated ${date}, which is in the future.`);
  else if (date && date !== today) warnings.push(`The bill is dated ${date}; the sale will be recorded today, ${today}.`);

  if (lines.length === 0) warnings.push("No item lines could be read from the photo. Try a clearer, straight-on photo in good light.");

  return {
    bill: {
      date,
      billNo: text(r.billNo, 20),
      customer: { name: text(c.name, 100), place: text(c.place, 100), phone },
      lines,
      totalCents,
      payments,
      warnings,
      model,
    },
    doubts,
    parsed: r,
  };
}

/** Turns the model's JSON into a validated reading. Pure, so it is unit-tested directly. */
export function interpretSaleBill(raw: unknown, today: string, model: string): SaleBillReading {
  return readingOf(raw, today, model).bill;
}

async function readOnce(env: Env, model: string, image: { bytes: Uint8Array; type: string }, today: string, recheck?: string): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await env.AI!.run(
      model,
      {
        messages: [
          { role: "system", content: instruction(today) },
          {
            role: "user",
            content: [
              { type: "text", text: recheck ? `Transcribe this sale bill.\n\n${recheck}` : "Transcribe this sale bill." },
              { type: "image_url", image_url: { url: `data:${image.type};base64,${base64(image.bytes)}` } },
            ],
          },
        ],
        temperature: 0,
        max_completion_tokens: 3000,
      },
      { gateway: { id: env.AI_GATEWAY_ID || "default", skipCache: true, metadata: { app: "goldos-salebill" }, requestTimeoutMs: 90_000 } }
    );
  } catch (err) {
    throw new ScanUnavailableError(`The vision model failed: ${String(err)}`);
  }
  const r = asRecord(raw);
  const choice = Array.isArray(r?.choices) ? asRecord((r?.choices as unknown[])[0]) : null;
  const content = asRecord(choice?.message)?.content ?? r?.response;
  const parsed = typeof content === "string" ? parseJson(content) : asRecord(content);
  if (!parsed) throw new ScanUnavailableError("The model did not return a readable answer. Try a clearer photo.");
  return parsed;
}

/**
 * Reads one photo of a sale bill. The written total and the lines' price per
 * gram are checks on the reading: when one fails, the photo is read once more
 * with the first reading and its doubts shown to the model, and the reading
 * with fewer doubts is kept.
 */
export async function scanSaleBill(env: Env, image: { bytes: Uint8Array; type: string }, today: string): Promise<SaleBillReading> {
  if (!env.AI) throw new ScanUnavailableError("The AI binding is not configured");
  const model = env.SALEBILL_VISION_MODEL || env.DAYSHEET_VISION_MODEL || DEFAULT_SHEET_MODEL;
  const first = readingOf(await readOnce(env, model, image, today), today, model);
  if (first.doubts.length === 0) return first.bill;
  const recheck =
    `Your first reading of this photo is below. It looks wrong: ${first.doubts.join("; ")}. ` +
    "Read the photo again, line by line, looking closely at each weight and amount, and reply with the complete JSON object in the same format.\n" +
    `First reading: ${JSON.stringify(first.parsed)}`;
  try {
    const second = readingOf(await readOnce(env, model, image, today, recheck), today, model);
    return second.doubts.length < first.doubts.length ? second.bill : first.bill;
  } catch (err) {
    console.error("sale bill re-read failed; keeping the first reading", err);
    return first.bill;
  }
}
