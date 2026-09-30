import bwipjs from "bwip-js";

export type LabelProduct = {
  barcode: string;
  name: string;
  gross_weight: number;
  net_weight: number;
  karat: string;
};

export type LabelPrice = {
  amount: number;
  ratePerGram: number;
  rateEffectiveFrom: number;
} | null;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Barcode box inside the 400x260 label. The symbol is scaled into it with
// its own viewBox so the stop pattern and quiet zones are never clipped —
// a Code128 missing either edge will not scan.
const BOX = { x: 20, y: 62, w: 360, h: 104 };
// With a QR alongside, the bars take the left and the QR a square on the
// right. Both carry the same bare code, so a laser gun reads the bars and a
// phone camera or 2D scanner reads the QR.
const BOX_WITH_QR = { x: 14, y: 62, w: 270, h: 104 };
const QR_BOX = { x: 292, y: 62, w: 100, h: 100 };

function nested(svg: string, box: { x: number; y: number; w: number; h: number }): string {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
  if (!viewBox) throw new Error("Barcode renderer returned no viewBox");
  const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  return `<svg x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
}

export function buildLabelSvg(product: LabelProduct, price: LabelPrice, opts: { qr?: boolean } = {}): string {
  const bars = bwipjs.toSVG({
    bcid: "code128",
    text: product.barcode,
    scale: 3,
    height: 12,
    paddingwidth: 10,
  });
  const withQr = opts.qr ?? false;
  const box = withQr ? BOX_WITH_QR : BOX;
  const qr = withQr
    ? nested(bwipjs.toSVG({ bcid: "qrcode", text: product.barcode, scale: 3, eclevel: "M", paddingwidth: 2, paddingheight: 2 }), QR_BOX)
    : "";
  const codeX = withQr ? box.x + box.w / 2 : 200;
  const priceLine = price ? `${price.amount.toLocaleString("en-US")} LKR` : "NO RATE";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260" viewBox="0 0 400 260">` +
    `<rect width="400" height="260" fill="#ffffff"/>` +
    `<text x="200" y="28" text-anchor="middle" font-size="20" font-family="sans-serif">${esc(product.name)}</text>` +
    `<text x="200" y="52" text-anchor="middle" font-size="14" font-family="sans-serif">${esc(product.karat)} · Gross ${product.gross_weight}g · Net ${product.net_weight}g</text>` +
    nested(bars, box) +
    qr +
    `<text x="${codeX}" y="190" text-anchor="middle" font-size="16" letter-spacing="2" font-family="monospace">${esc(product.barcode)}</text>` +
    `<text x="200" y="232" text-anchor="middle" font-size="22" font-weight="bold" font-family="sans-serif">${esc(priceLine)}</text>` +
    `</svg>`
  );
}

/**
 * A bare Code128 symbol for a document number (a sales invoice), so the
 * printed bill can be scanned back at the counter for a return.
 */
export function buildCodeSvg(text: string): string {
  return bwipjs.toSVG({
    bcid: "code128",
    text,
    scale: 2,
    height: 10,
    paddingwidth: 10,
    includetext: true,
    textxalign: "center",
  });
}

/** A QR symbol carrying `text` — the invoice number on a bill, a tag on a label. */
export function buildQrSvg(text: string): string {
  return bwipjs.toSVG({ bcid: "qrcode", text, scale: 4, eclevel: "M", paddingwidth: 2, paddingheight: 2 });
}
