import { extractScanCode, normalizeCode } from "@goldos/shared";

export { extractScanCode, normalizeCode };

/**
 * Where a scanned code should open. Product tags (JW-/PRD-) and SKUs go to the
 * product lookup; old-gold item numbers (OG-) to the vault lookup; sales
 * invoice numbers (SINV-, printed as a barcode and QR on the bill) to the
 * sale. Anything else falls through to products, which shows a clean
 * "not found". QR payloads (links, JSON) are unwrapped to their code first.
 */
export function lookupPath(raw: string): string | null {
  const code = extractScanCode(raw);
  if (!code) return null;
  if (code.startsWith("OG-")) return `/old-gold/items/barcode/${encodeURIComponent(code)}`;
  if (code.startsWith("SINV-")) return `/sales/invoices/lookup/${encodeURIComponent(code)}`;
  return `/products/barcode/${encodeURIComponent(code)}`;
}

/**
 * Does this look like something a scanner produced, rather than a name the
 * cashier typed? Scanners send a tag/SKU/invoice code, or a QR link or JSON.
 */
export function looksLikeCode(raw: string): boolean {
  const s = raw.trim();
  if (/^(https?:\/\/|\{)/i.test(s)) return true;
  return /^(JW|PRD|SKU|SINV|OG)-[A-Z0-9]+$/i.test(s.replace(/\s+/g, ""));
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r >= 20) parts.push(`${TENS[Math.floor(r / 10)]}${r % 10 ? `-${ONES[r % 10]}` : ""}`);
  else if (r) parts.push(ONES[r]!);
  return parts.join(" ");
}

/** "One Hundred Twenty-Five Thousand Rupees and Fifty Cents Only" — for the bill. */
export function amountInWords(cents: number, currency = "Rupees"): string {
  const whole = Math.floor(Math.abs(cents) / 100);
  const frac = Math.abs(cents) % 100;
  const scales: [number, string][] = [
    [1_000_000_000, "Billion"],
    [1_000_000, "Million"],
    [1_000, "Thousand"],
  ];
  let n = whole;
  const parts: string[] = [];
  for (const [size, name] of scales) {
    if (n >= size) {
      parts.push(`${below1000(Math.floor(n / size))} ${name}`);
      n %= size;
    }
  }
  if (n) parts.push(below1000(n));
  const words = parts.length ? parts.join(" ") : "Zero";
  return `${words} ${currency}${frac ? ` and ${below1000(frac)} Cents` : ""} Only`;
}
