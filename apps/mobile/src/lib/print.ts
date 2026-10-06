import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";

/**
 * Printing replaces the web's print pages: build an HTML document and hand it
 * to AirPrint / Android print services, or render it to a PDF and share it.
 * Images in the HTML should be inline (data: URIs or public URLs) — the print
 * renderer does not carry the session cookie.
 */
export async function printHtml(html: string, opts?: { width?: number; height?: number }): Promise<void> {
  await Print.printAsync({ html, width: opts?.width, height: opts?.height });
}

/** Renders HTML to a PDF and opens the share sheet. */
export async function sharePdf(html: string, filename: string, opts?: { width?: number; height?: number }): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html, width: opts?.width, height: opts?.height });
  const name = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  // Give the file a human name before sharing.
  const src = new File(uri);
  const dest = new File(Paths.cache, name);
  if (dest.exists) dest.delete();
  src.move(dest);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(dest.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: name });
  }
}

/** Escapes text for interpolation into print HTML. */
export const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Shared print stylesheet: clean, black-on-white, system font, tabular numbers. */
export const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Roboto, Arial, sans-serif; color: #111; margin: 24px; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: -0.02em; }
  h2 { font-size: 14px; margin: 16px 0 6px; }
  .muted { color: #666; }
  .num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
  .mono { font-family: Menlo, monospace; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #666; border-bottom: 1px solid #ccc; padding: 6px 4px; }
  td { border-bottom: 1px solid #eee; padding: 6px 4px; vertical-align: top; }
  .total td { font-weight: 700; border-top: 1px solid #111; border-bottom: none; }
  .gold { color: #8C6D1F; }
  .row { display: flex; justify-content: space-between; gap: 16px; }
`;

/** Wraps a body in a full HTML document with the shared print CSS. */
export const printDoc = (title: string, body: string, extraCss = "") =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${PRINT_CSS}${extraCss}</style></head><body>${body}</body></html>`;
