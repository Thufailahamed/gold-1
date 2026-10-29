import type { Env } from "../db/client";
import { ScanUnavailableError } from "./billscan";
import type { Method, SheetRowInput } from "../services/daysheet";

/**
 * Reads a photographed day sheet (the counter's five-column paper record)
 * with a Workers AI vision model and returns the rows as a DRAFT. Nothing is
 * trusted: amounts, weights and methods are re-parsed here, the column totals
 * the sheet itself prints are checked against the rows, and every doubt comes
 * back as a warning for the person reviewing it.
 */

/**
 * Mistral Small reads the handwritten columns far better than the general
 * vision models on the same photo (checked against a sample sheet with the
 * live model: every amount right, where Llama 4 Scout dropped one and put
 * others in the wrong column). Set DAYSHEET_VISION_MODEL to change it.
 */
export const DEFAULT_SHEET_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";
export const SHEET_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const SHEET_MAX_BYTES = 6 * 1024 * 1024;
export const SHEET_MAX_IMAGES = 4;

export type SheetScan = {
  date: string | null;
  rows: SheetRowInput[];
  warnings: string[];
  model: string;
};

function base64(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(out);
}

const instruction = (expectedDate: string) =>
  `You transcribe a photographed handwritten DAY SHEET from a gold jewellery shop in Sri Lanka. It is a table with these five columns, left to right:
1. CUSTOMER / BILL — the customer's name, a bill or reference number (e.g. "CB-481", "SINV-12", "481"), a phone number (e.g. 0774086201) and short notes (item, place, "Rings", "Bags"…). On the printed form this column is split into a narrow "Bill No" box and a wide "Name · phone · details" box.
2. GOLD WEIGHT — the weight of gold in grams (e.g. "8.450", "12.3"). It may be written as a count and weight such as "2x720" or "1 x 9.10".
3. AMOUNT RECEIVED — rupees the shop received from the customer.
4. AMOUNT GIVEN — rupees the shop paid out or gave back.
5. OLD GOLD AMOUNT — rupee value of old gold the shop took from the customer.
A note beside an amount says how it was paid: "(Bank)", "(B)", "(AC)", "(Online)" mean bank; "(Card)", "(C)" mean card; "(Chq)", "(Q)" mean cheque; "(Cr)" means on credit. No note means cash.

Reply with ONE JSON object and nothing else:
{"date": "YYYY-MM-DD"|null, "rows": [{"line": number, "refNo": string|null, "name": string|null, "phone": string|null, "details": string|null, "cells": [string, string, string, string]}], "totals": {"received": string, "given": string, "oldGold": string}}
Rules:
- One object per written line, top to bottom, in the order they appear. Use the printed line number for "line" if there is one.
- "cells" ALWAYS has exactly four strings, one per column 2 to 5, left to right: [gold weight, amount received, amount given, old gold amount]. Copy each cell exactly as written, including any note like "(Bank)". Use "" for an empty cell.
- Decide the column of every number by WHERE it sits between the vertical ruled lines, never by its order on the line. Many lines leave columns empty: a number in the rightmost column is OLD GOLD even when columns 3 and 4 are empty; a number in column 4 is GIVEN even when column 3 is empty.
- A transaction may span two physical lines (a name on one, a phone or note under it); merge them into one row when the amounts sit only on one of them.
- Copy numbers exactly as written: no commas, no currency. "58000/-" is 58000. Never invent, round or add up values.
- Ignore anything crossed out or struck through. If a value was crossed out and rewritten, use the rewritten value.
- refNo is a bill/reference number such as "CB-481"; name is the person; phone is a phone number; details is everything else in column 1.
- "totals" is the TOTAL row at the bottom of the sheet: the printed total under AMOUNT RECEIVED, AMOUNT GIVEN and OLD GOLD AMOUNT, copied exactly. Use "" for any total that is not printed. Match each total by its column, not by its position: the TOTAL row often has no gold weight.
- The sheet is expected to be for ${expectedDate}. Read the date written at the top (dates are written day/month/year); null if there is none.
- Skip blank lines and the printed header. If the image is not such a sheet, return {"date": null, "rows": [], "totals": {"received": "", "given": "", "oldGold": ""}}.`;

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

/** "58,000/-", 58000, "Rs. 1,300.50" → cents, or null. */
export function moneyCents(v: unknown): number | null {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const m = /\d[\d,\s]*(?:\.\d{1,2})?/.exec(v);
    n = m ? Number(m[0].replace(/[,\s]/g, "")) : NaN;
  } else return null;
  return Number.isFinite(n) && n > 0 && n < 1e10 ? Math.round(n * 100) : null;
}

/** Grams to milligrams. Accepts 8.45, "8.450g", "8.450 g". */
export function gramsMg(v: unknown): number | null {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const m = /^\s*(\d+(?:\.\d+)?)\s*(?:g|gm|grams?)?\s*$/i.exec(v);
    n = m ? Number(m[1]) : NaN;
  } else return null;
  // A day sheet line is a piece or a few pieces: above 5 kg is a misread.
  return Number.isFinite(n) && n > 0 && n < 5000 ? Math.round(n * 1000) : null;
}

const METHOD_WORDS: [RegExp, Method][] = [
  [/\b(bank|b|ac|a\/c|online|transfer|tt)\b/i, "bank"],
  [/\b(card|c|visa|master)\b/i, "card"],
  [/\b(chq|cheque|check|q)\b/i, "cheque"],
  [/\b(cr|credit)\b/i, "credit"],
  [/\b(cash)\b/i, "cash"],
];

export function methodOf(v: unknown, raw?: unknown): Method | null {
  for (const src of [v, raw]) {
    if (typeof src !== "string") continue;
    const s = src.trim().toLowerCase();
    if (["cash", "bank", "card", "cheque", "credit"].includes(s)) return s as Method;
    const paren = /\(([^)]*)\)/.exec(s)?.[1] ?? s;
    for (const [re, m] of METHOD_WORDS) if (re.test(paren)) return m;
  }
  return null;
}

/** A Sri Lankan number (077 408 6201, +94 77 408 6201) written into a name or note. */
const PHONE = /(?<!\d)(?:\+?94[\s-]?|0)\d(?:[\s-]?\d){8}(?!\d)/;

/** The number as it is written on the books: 0774086201. */
const phoneIn = (s: string | null): string | null => {
  const m = s ? PHONE.exec(s) : null;
  if (!m) return null;
  const digits = m[0].replace(/\D/g, "");
  return digits.startsWith("94") && digits.length === 11 ? `0${digits.slice(2)}` : digits;
};

const isRealDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** A printed total the lines do not add up to. */
type Gap = { label: string; printed: number; summed: number };
type Reading = { scan: SheetScan; gaps: Gap[]; parsed: Record<string, unknown> };

const rupees = (cents: number) => (cents / 100).toLocaleString("en-US");

/** Turns the model's JSON into validated draft rows and the totals that disagree with them. Pure. */
function readingOf(raw: unknown, expectedDate: string, model: string): Reading {
  const r = asRecord(raw) ?? {};
  const warnings: string[] = [];
  const list = Array.isArray(r.rows) ? r.rows : [];
  const rows: SheetRowInput[] = [];
  for (const item of list) {
    const x = asRecord(item);
    if (!x) continue;
    // The positional shape (four cells, columns 2–5) is what the prompt asks
    // for; named fields are accepted too, so a model that answers the other
    // way still reads.
    const cells = Array.isArray(x.cells) ? x.cells : null;
    const cell = (i: number, named: unknown) => (cells ? cells[i] : named);
    // A phone the reader wrote into the name is moved to the phone field.
    const ownPhone = text(x.phone, 30);
    const nameText = text(x.name, 120);
    const phone = ownPhone ?? phoneIn(nameText) ?? phoneIn(text(x.details, 300));
    const name = nameText && !ownPhone && phoneIn(nameText) ? nameText.replace(PHONE, "").replace(/\s+/g, " ").trim() || null : nameText;
    const details = text(x.details, 300);
    const goldText = text(cell(0, x.goldText), 40);
    const received = cell(1, x.received);
    const given = cell(2, x.given);
    const oldGold = cell(3, x.oldGold);
    const row: SheetRowInput = {
      refNo: text(x.refNo, 40),
      name,
      phone,
      details,
      goldText,
      goldMg: gramsMg(x.goldGrams) ?? gramsMg(goldText),
      receivedCents: moneyCents(received),
      receivedMethod: null,
      givenCents: moneyCents(given),
      givenMethod: null,
      oldGoldCents: moneyCents(oldGold),
    };
    row.receivedMethod = row.receivedCents ? (methodOf(x.receivedMethod, received) ?? "cash") : null;
    row.givenMethod = row.givenCents ? (methodOf(x.givenMethod, given) ?? "cash") : null;
    const hasAnything = row.refNo || row.name || row.phone || row.details || row.goldText || row.receivedCents || row.givenCents || row.oldGoldCents;
    if (!hasAnything) continue;
    const line = rows.length + 1;
    if ((row.receivedCents || row.givenCents || row.oldGoldCents) && !row.name && !row.refNo && !row.details)
      warnings.push(`Line ${line}: an amount with no name or bill number. Check who it belongs to.`);
    if (goldText && row.goldMg === null) warnings.push(`Line ${line}: the gold weight "${goldText}" is not a plain gram figure. Enter it in grams.`);
    rows.push(row);
  }

  let date = text(r.date, 10);
  if (date && !isRealDate(date)) date = null;
  if (date && date !== expectedDate) warnings.push(`The sheet is dated ${date}, but you are checking ${expectedDate}.`);

  const t = Array.isArray(r.totals) ? { received: r.totals[1], given: r.totals[2], oldGold: r.totals[3] } : (asRecord(r.totals) ?? {});
  const checks: [string, unknown, (x: SheetRowInput) => number | null | undefined][] = [
    ["received", t.received, (x) => x.receivedCents],
    ["given", t.given, (x) => x.givenCents],
    ["old gold", t.oldGold, (x) => x.oldGoldCents],
  ];
  const gaps: Gap[] = [];
  for (const [label, written, pick] of checks) {
    const want = moneyCents(written);
    if (want === null) continue;
    const got = rows.reduce((s, x) => s + (pick(x) ?? 0), 0);
    if (got === want) continue;
    gaps.push({ label, printed: want, summed: got });
    warnings.push(`The ${label} total written on the sheet is ${rupees(want)}, but the lines read add up to ${rupees(got)}. A line was probably misread.`);
  }
  if (rows.length === 0) warnings.push("No lines could be read from the photo. Try a clearer, straight-on photo in good light, or type the lines in.");
  return { scan: { date, rows, warnings, model }, gaps, parsed: r };
}

/** Turns the model's JSON into validated draft rows. Pure, so it is unit-tested directly. */
export function interpretSheet(raw: unknown, expectedDate: string, model: string): SheetScan {
  return readingOf(raw, expectedDate, model).scan;
}

async function readOne(
  env: Env,
  model: string,
  image: { bytes: Uint8Array; type: string },
  expectedDate: string,
  page: number,
  pages: number,
  recheck?: string
): Promise<Record<string, unknown>> {
  let raw: unknown;
  const pageText = pages > 1 ? `Transcribe this day sheet (photo ${page} of ${pages}).` : "Transcribe this day sheet.";
  try {
    raw = await env.AI!.run(
      model,
      {
        messages: [
          { role: "system", content: instruction(expectedDate) },
          {
            role: "user",
            content: [
              { type: "text", text: recheck ? `${pageText}\n\n${recheck}` : pageText },
              { type: "image_url", image_url: { url: `data:${image.type};base64,${base64(image.bytes)}` } },
            ],
          },
        ],
        temperature: 0,
        max_completion_tokens: 6000,
      },
      { gateway: { id: env.AI_GATEWAY_ID || "default", skipCache: true, metadata: { app: "goldos-daysheet" }, requestTimeoutMs: 120_000 } }
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
 * Reads one photo. The printed TOTAL row is a checksum on the lines: when they
 * do not add up, the photo is read once more with the first reading and the
 * gap shown to the model, and the reading with fewer gaps is kept. A second
 * read that fails leaves the first in place.
 */
async function readPhoto(env: Env, model: string, image: { bytes: Uint8Array; type: string }, expectedDate: string, page: number, pages: number): Promise<SheetScan> {
  const first = readingOf(await readOne(env, model, image, expectedDate, page, pages), expectedDate, model);
  if (first.gaps.length === 0) return first.scan;
  const shown = first.gaps.map((g) => `${g.label}: the sheet prints ${rupees(g.printed)}, the lines add up to ${rupees(g.summed)}`).join("; ");
  const recheck =
    `Your first reading of this photo is below. Its lines do not add up to the TOTAL row printed on the sheet (${shown}). ` +
    "An amount was probably missed, or written in the wrong column. Read the photo again, line by line, top to bottom, checking every amount against its column, and reply with the complete JSON object in the same format.\n" +
    `First reading: ${JSON.stringify(first.parsed)}`;
  try {
    const second = readingOf(await readOne(env, model, image, expectedDate, page, pages, recheck), expectedDate, model);
    return second.gaps.length < first.gaps.length ? second.scan : first.scan;
  } catch (err) {
    console.error("day sheet re-read failed; keeping the first reading", err);
    return first.scan;
  }
}

/** Reads one or more photos of the same day's sheet (a long day can run over a page) into one list of rows. */
export async function scanDaySheet(env: Env, images: { bytes: Uint8Array; type: string }[], expectedDate: string): Promise<SheetScan> {
  if (!env.AI) throw new ScanUnavailableError("The AI binding is not configured");
  const model = env.DAYSHEET_VISION_MODEL || DEFAULT_SHEET_MODEL;
  const merged: SheetScan = { date: null, rows: [], warnings: [], model };
  for (let i = 0; i < images.length; i++) {
    const one = await readPhoto(env, model, images[i]!, expectedDate, i + 1, images.length);
    merged.date ??= one.date;
    merged.rows.push(...one.rows);
    const prefix = images.length > 1 ? `Photo ${i + 1}: ` : "";
    merged.warnings.push(...one.warnings.map((w) => prefix + w));
  }
  return merged;
}
