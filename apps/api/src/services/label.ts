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
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildLabelSvg(product: LabelProduct, price: LabelPrice): string {
  const bars = bwipjs.toSVG({
    bcid: "code128",
    text: product.barcode,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: "center",
  });
  const inner = bars.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const priceLine = price ? `${price.amount.toLocaleString("en-US")} LKR` : "NO RATE";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260" viewBox="0 0 400 260">` +
    `<text x="200" y="28" text-anchor="middle" font-size="20" font-family="sans-serif">${esc(product.name)}</text>` +
    `<text x="200" y="52" text-anchor="middle" font-size="14" font-family="sans-serif">${esc(product.karat)} · Gross ${product.gross_weight}g · Net ${product.net_weight}g</text>` +
    `<svg x="40" y="65" width="320" height="110" viewBox="0 0 320 110">${inner}</svg>` +
    `<text x="200" y="210" text-anchor="middle" font-size="22" font-weight="bold" font-family="sans-serif">${esc(priceLine)}</text>` +
    `<text x="200" y="234" text-anchor="middle" font-size="12" font-family="sans-serif">${esc(product.barcode)}</text>` +
    `</svg>`
  );
}
