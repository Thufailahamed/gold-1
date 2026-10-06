import { amountInWords } from "@/lib/barcode";
import { esc, printDoc } from "@/lib/print";

export type PrintDetail = {
  invoice: {
    number: string;
    status: string;
    customer_name: string | null;
    customer_code: string | null;
    customer_phone: string | null;
    customer_address: string | null;
    customer_nic: string | null;
    salesperson_name: string | null;
    cashier_name: string | null;
    branch_name: string | null;
    branch_code: string | null;
    branch_address: string | null;
    subtotal_cents: number;
    discount_cents: number;
    tax_cents?: number;
    tax_rate_bp?: number;
    total_cents: number;
    paid_cents: number;
    balance_cents: number;
    store_credit_cents?: number;
    tendered_cents?: number | null;
    notes?: string | null;
    created_at: number;
  };
  items: {
    barcode: string;
    sku: string;
    name: string;
    category_name: string | null;
    gross_mg: number;
    stone_mg: number;
    net_mg: number;
    karat: string;
    price_cents: number;
    discount_cents: number;
    tax_cents: number;
    making_cents: number;
  }[];
  payments: { method: string; amount_cents: number; bank_account_name: string | null }[];
  receipts: { number: string; receipt_date: string; method: string; status: string; amount_cents: number }[];
  returns: { number: string; type: string; refund_cents: number; credit_cents: number }[];
};

export type Profile = {
  shopName: string;
  header: string;
  footer: string;
  address: string;
  phone: string;
  email: string;
  terms: string;
  taxLabel: string;
  taxRegNo: string;
};

export const DEFAULT_PROFILE: Profile = { shopName: "GoldOS", header: "", footer: "", address: "", phone: "", email: "", terms: "", taxLabel: "VAT", taxRegNo: "" };

export const STATUS_LABEL: Record<string, string> = { PAID: "Paid", PARTIAL: "Part paid", UNPAID: "Unpaid · on credit", VOID: "Void" };
const STATUS_COLOR: Record<string, string> = { PAID: "#166534", PARTIAL: "#92400e", UNPAID: "#9f1239", VOID: "#57534e" };

export const fmt2 = (c: number) => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const grams3 = (mg: number) => (mg / 1000).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export function methodLabel(p: { method: string; bank_account_name?: string | null }) {
  const m = p.method === "credit" ? "On account" : p.method.charAt(0).toUpperCase() + p.method.slice(1);
  return p.bank_account_name ? `${m} · ${p.bank_account_name}` : m;
}

/** Sri Lankan mobiles are keyed as 07x…; WhatsApp wants 947x…. */
export function waNumber(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("0") ? `94${d.slice(1)}` : d;
}

export function derive(d: PrintDetail) {
  const { invoice, payments } = d;
  const cashPaid = payments.filter((p) => p.method === "cash").reduce((s, p) => s + p.amount_cents, 0);
  const change = invoice.tendered_cents != null && invoice.tendered_cents > cashPaid ? invoice.tendered_cents - cashPaid : 0;
  const balance = Math.max(0, invoice.balance_cents ?? invoice.total_cents - invoice.paid_cents);
  const totals = d.items.reduce((a, it) => ({ gross: a.gross + it.gross_mg, net: a.net + it.net_mg, making: a.making + it.making_cents }), { gross: 0, net: 0, making: 0 });
  const receipts = (d.receipts ?? []).filter((r) => r.status === "POSTED");
  const taxed = (invoice.tax_cents ?? 0) > 0;
  return { cashPaid, change, balance, totals, receipts, taxed };
}

const taxPct = (bp?: number) => ((bp ?? 0) / 100).toFixed(2).replace(/\.00$/, "");
const svgBox = (svg: string | null, w: number, h: number) =>
  svg ? `<div style="width:${w}px;height:${h}px">${svg.replace(/<svg /, `<svg width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" `)}</div>` : "";

/** The A4 bill — same layout and content as the web print page. */
export function a4Html(d: PrintDetail, shop: Profile, qrSvg: string | null, barSvg: string | null): string {
  const { invoice, items, payments } = d;
  const { cashPaid, change, balance, totals, receipts, taxed } = derive(d);
  const created = new Date(invoice.created_at);
  const returns = d.returns ?? [];
  const lines = items
    .map(
      (it, i) => `<tr>
      <td class="muted">${i + 1}</td>
      <td><b>${esc(it.name)}</b><div class="mono muted" style="font-size:10px">${esc(it.barcode)}${it.category_name ? ` · ${esc(it.category_name)}` : ""}${it.stone_mg > 0 ? ` · stone ${grams3(it.stone_mg)} g` : ""}</div></td>
      <td style="text-align:center"><b>${esc(it.karat)}</b></td>
      <td class="num">${grams3(it.gross_mg)}</td>
      <td class="num">${grams3(it.net_mg)}</td>
      <td class="num">${fmt2(it.making_cents)}</td>
      <td class="num"><b>${fmt2(it.price_cents)}</b></td>
      <td class="num">${it.discount_cents ? fmt2(it.discount_cents) : "—"}</td></tr>`
    )
    .join("");
  const payRows = [
    ...payments.map((p) => `<tr><td>${esc(methodLabel(p))}</td><td class="num">${fmt2(p.amount_cents)}</td></tr>`),
    ...(invoice.tendered_cents != null && cashPaid > 0
      ? [`<tr class="muted"><td style="padding-left:10px">Cash tendered</td><td class="num">${fmt2(invoice.tendered_cents)}</td></tr>`, `<tr class="muted"><td style="padding-left:10px">Change given</td><td class="num">${fmt2(change)}</td></tr>`]
      : []),
    ...((invoice.store_credit_cents ?? 0) > 0 ? [`<tr class="muted"><td>Settled from store credit</td><td class="num">${fmt2(invoice.store_credit_cents!)}</td></tr>`] : []),
    ...receipts.map((r) => `<tr class="muted"><td>Received ${esc(r.receipt_date)} · ${esc(r.number)}</td><td class="num">${fmt2(r.amount_cents)}</td></tr>`),
  ].join("");
  const body = `
  <div style="height:6px;background:linear-gradient(90deg,#8C6D1F,#C9A227,#E7C65A)"></div>
  <div class="row" style="padding:18px 0 14px">
    <div style="max-width:60%">
      <h1 style="font-size:26px">${esc(shop.shopName)}</h1>
      ${shop.header ? `<div class="gold" style="font-style:italic">${esc(shop.header)}</div>` : ""}
      <div class="muted" style="margin-top:6px;line-height:1.5">
        ${shop.address ? `<div style="white-space:pre-line">${esc(shop.address)}</div>` : ""}
        ${invoice.branch_name ? `<div>${esc(invoice.branch_name)} branch${invoice.branch_address ? ` · ${esc(invoice.branch_address)}` : ""}</div>` : ""}
        ${shop.phone || shop.email ? `<div>${[shop.phone && `Tel ${esc(shop.phone)}`, esc(shop.email)].filter(Boolean).join(" · ")}</div>` : ""}
        ${taxed && shop.taxRegNo ? `<div>${esc(shop.taxLabel)} Reg. No. ${esc(shop.taxRegNo)}</div>` : ""}
      </div>
    </div>
    <div style="display:flex;gap:14px;align-items:flex-start">
      <div style="text-align:right">
        <div class="gold" style="font-size:10px;font-weight:700;letter-spacing:.28em;text-transform:uppercase">${taxed ? "Tax invoice" : "Invoice"}</div>
        <div class="mono" style="font-size:19px;font-weight:700;margin-top:3px">${esc(invoice.number)}</div>
        <div class="muted">${created.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} · ${created.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</div>
        <div style="display:inline-block;margin-top:6px;padding:2px 9px;border-radius:99px;border:1px solid ${STATUS_COLOR[invoice.status] ?? "#166534"};color:${STATUS_COLOR[invoice.status] ?? "#166534"};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">${esc(STATUS_LABEL[invoice.status] ?? invoice.status)}</div>
      </div>
      ${svgBox(qrSvg, 84, 84)}
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#ddd;border:1px solid #ddd;border-radius:10px;overflow:hidden">
    <div style="background:#fafaf9;padding:12px 14px">
      <div class="muted" style="font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase">Bill to</div>
      <div style="font-size:14px;font-weight:700;margin-top:4px">${esc(invoice.customer_name ?? "Walk-in customer")}</div>
      <div class="muted" style="line-height:1.5">
        ${invoice.customer_code ? `<div class="mono">${esc(invoice.customer_code)}</div>` : ""}
        ${invoice.customer_phone ? `<div>${esc(invoice.customer_phone)}</div>` : ""}
        ${invoice.customer_address ? `<div style="white-space:pre-line">${esc(invoice.customer_address)}</div>` : ""}
        ${invoice.customer_nic ? `<div>NIC ${esc(invoice.customer_nic)}</div>` : ""}
      </div>
    </div>
    <div style="background:#fafaf9;padding:12px 14px">
      <div class="muted" style="font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase">Sale details</div>
      <table style="margin-top:4px"><tbody>
        <tr><td class="muted" style="border:none;padding:1px 8px 1px 0">Branch</td><td style="border:none;padding:1px 0">${esc(invoice.branch_name ?? "—")}${invoice.branch_code ? ` (${esc(invoice.branch_code)})` : ""}</td></tr>
        <tr><td class="muted" style="border:none;padding:1px 8px 1px 0">Sales person</td><td style="border:none;padding:1px 0">${esc(invoice.salesperson_name ?? "—")}</td></tr>
        ${invoice.cashier_name && invoice.cashier_name !== invoice.salesperson_name ? `<tr><td class="muted" style="border:none;padding:1px 8px 1px 0">Cashier</td><td style="border:none;padding:1px 0">${esc(invoice.cashier_name)}</td></tr>` : ""}
        <tr><td class="muted" style="border:none;padding:1px 8px 1px 0">Pieces</td><td style="border:none;padding:1px 0">${items.length} · ${grams3(totals.net)} g net</td></tr>
      </tbody></table>
    </div>
  </div>
  <table style="margin-top:16px">
    <thead><tr style="border-bottom:2px solid #111"><th>#</th><th>Description</th><th style="text-align:center">Purity</th><th class="num">Gross g</th><th class="num">Net g</th><th class="num">Making</th><th class="num">Amount</th><th class="num">Disc.</th></tr></thead>
    <tbody>${lines}</tbody>
    <tfoot><tr class="muted" style="font-weight:700"><td></td><td>Totals</td><td></td><td class="num">${grams3(totals.gross)}</td><td class="num">${grams3(totals.net)}</td><td class="num">${fmt2(totals.making)}</td><td class="num">${fmt2(invoice.subtotal_cents)}</td><td class="num">${invoice.discount_cents ? fmt2(invoice.discount_cents) : "—"}</td></tr></tfoot>
  </table>
  <div style="display:grid;grid-template-columns:1fr 260px;gap:26px;margin-top:12px">
    <div>
      <div class="muted" style="font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase">Amount in words</div>
      <div style="font-weight:600;margin-top:3px">${esc(amountInWords(invoice.total_cents))}</div>
      <div class="muted" style="font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;margin-top:12px">Payment received</div>
      <table style="margin-top:2px"><tbody>${payRows}</tbody></table>
      ${returns.length ? `<div style="margin-top:10px;padding:8px 10px;background:#fffbeb;border:1px solid #f3d38a;border-radius:8px;color:#78350f">Returns against this bill: ${returns.map((r) => `${esc(r.number)} (${esc(r.type.toLowerCase())})`).join(", ")}</div>` : ""}
      ${invoice.notes ? `<div class="muted" style="font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;margin-top:12px">Note</div><div style="white-space:pre-line">${esc(invoice.notes)}</div>` : ""}
    </div>
    <div>
      <div class="row muted"><span>Subtotal</span><span class="num">${fmt2(invoice.subtotal_cents)}</span></div>
      ${invoice.discount_cents ? `<div class="row muted"><span>Discount</span><span class="num">− ${fmt2(invoice.discount_cents)}</span></div>` : ""}
      ${taxed ? `<div class="row muted"><span>Taxable value</span><span class="num">${fmt2(invoice.subtotal_cents - invoice.discount_cents)}</span></div><div class="row muted"><span>${esc(shop.taxLabel)} @ ${taxPct(invoice.tax_rate_bp)}%</span><span class="num">${fmt2(invoice.tax_cents ?? 0)}</span></div>` : ""}
      <div class="row" style="margin-top:8px;background:#111;color:#fff;border-radius:10px;padding:10px 14px;align-items:baseline"><span style="color:#E7C65A;font-size:10px;font-weight:700;letter-spacing:.2em">TOTAL LKR</span><span class="num" style="font-size:20px;font-weight:800">${fmt2(invoice.total_cents)}</span></div>
      <div class="row" style="margin-top:8px"><span>Amount paid</span><span class="num"><b>${fmt2(invoice.paid_cents)}</b></span></div>
      <div class="row" style="${balance > 0 ? "background:#fff1f2;color:#9f1239;font-weight:700;" : "color:#166534;"}padding:3px 6px;border-radius:6px;margin:3px -6px 0"><span>${balance > 0 ? "Balance due" : "Balance"}</span><span class="num">${fmt2(balance)}</span></div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 150px 150px;gap:24px;align-items:end;margin-top:26px;padding-top:14px;border-top:1px solid #ddd;page-break-inside:avoid">
    <div class="muted" style="font-size:10.5px;line-height:1.5"><div style="font-weight:700;letter-spacing:.2em;text-transform:uppercase">Terms</div><div style="white-space:pre-line;margin-top:3px">${esc(shop.terms || "Keep this invoice for returns and exchanges. Gold weights are in grams.")}</div></div>
    <div class="muted" style="text-align:center;font-size:10.5px"><div style="height:36px;border-bottom:1px solid #888"></div>Customer signature</div>
    <div class="muted" style="text-align:center;font-size:10.5px"><div style="height:36px;border-bottom:1px solid #888"></div>Authorised signature</div>
  </div>
  <div class="row" style="margin-top:18px;background:#fafaf9;padding:10px 12px;align-items:center;page-break-inside:avoid">
    <span class="muted">${esc(shop.footer || "Thank you for shopping with us.")}</span>
    ${svgBox(barSvg, 200, 46)}
  </div>`;
  return printDoc(`Invoice ${invoice.number}`, body, "@page { size: A4; margin: 8mm; } body { margin: 0; }");
}

/** 80mm thermal slip — same content as the web ThermalReceipt. */
export function receiptHtml(d: PrintDetail, shop: Profile, qrSvg: string | null): string {
  const { invoice, items, payments } = d;
  const { change, balance, receipts, taxed } = derive(d);
  const row = (l: string, r: string, b = false) => `<div style="display:flex;justify-content:space-between;gap:6px;${b ? "font-weight:700;" : ""}"><span>${l}</span><span class="num">${r}</span></div>`;
  const dash = `<div style="border-top:1px dashed #555;margin:7px 0"></div>`;
  const created = new Date(invoice.created_at);
  const body = `
  <div style="font-family:Menlo,monospace;font-size:11px;line-height:1.35;width:72mm;margin:0 auto">
    <div style="text-align:center">
      <div style="font-family:-apple-system,Helvetica,sans-serif;font-size:16px;font-weight:800">${esc(shop.shopName)}</div>
      ${shop.header ? `<div style="font-size:10px">${esc(shop.header)}</div>` : ""}
      ${shop.address ? `<div style="font-size:10px;white-space:pre-line">${esc(shop.address)}</div>` : ""}
      ${shop.phone ? `<div style="font-size:10px">Tel ${esc(shop.phone)}</div>` : ""}
      ${taxed && shop.taxRegNo ? `<div style="font-size:10px">${esc(shop.taxLabel)} Reg ${esc(shop.taxRegNo)}</div>` : ""}
      <div style="font-size:10px;font-weight:700;letter-spacing:.2em;margin-top:4px">${taxed ? "TAX INVOICE" : "INVOICE"}</div>
    </div>
    ${dash}
    ${row(esc(invoice.number), created.toLocaleDateString("en-GB"), true)}
    ${row(esc(invoice.branch_name ?? ""), created.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }))}
    <div>Customer: ${esc(invoice.customer_name ?? "Walk-in")}</div>
    ${invoice.customer_phone ? `<div>Phone: ${esc(invoice.customer_phone)}</div>` : ""}
    ${dash}
    ${items
      .map(
        (it) => `<div style="margin-bottom:5px"><div style="font-family:-apple-system,Helvetica,sans-serif;font-weight:700">${esc(it.name)}</div>${row(`${esc(it.karat)} ${grams3(it.net_mg)}g · ${esc(it.barcode)}`, fmt2(it.price_cents))}${it.discount_cents ? row("&nbsp;&nbsp;discount", `-${fmt2(it.discount_cents)}`) : ""}</div>`
      )
      .join("")}
    ${dash}
    ${row("Subtotal", fmt2(invoice.subtotal_cents))}
    ${invoice.discount_cents ? row("Discount", `-${fmt2(invoice.discount_cents)}`) : ""}
    ${taxed ? row(`${esc(shop.taxLabel)} ${taxPct(invoice.tax_rate_bp)}%`, fmt2(invoice.tax_cents ?? 0)) : ""}
    <div style="border-top:1px solid #111;margin:4px 0"></div>
    <div style="display:flex;justify-content:space-between;font-family:-apple-system,Helvetica,sans-serif;font-size:15px;font-weight:800"><span>TOTAL LKR</span><span class="num">${fmt2(invoice.total_cents)}</span></div>
    <div style="border-top:1px solid #111;margin:4px 0"></div>
    ${payments.map((p) => row(esc(methodLabel(p)), fmt2(p.amount_cents))).join("")}
    ${invoice.tendered_cents != null && change >= 0 && payments.some((p) => p.method === "cash") ? row("Tendered", fmt2(invoice.tendered_cents)) + row("Change", fmt2(change), true) : ""}
    ${receipts.map((r) => row(`Rcpt ${esc(r.number)}`, fmt2(r.amount_cents))).join("")}
    ${balance > 0 ? row("BALANCE DUE", fmt2(balance), true) : ""}
    <div style="text-align:center;font-size:10px;text-transform:uppercase;margin-top:4px">${esc(STATUS_LABEL[invoice.status] ?? invoice.status)}</div>
    ${invoice.notes ? `<div style="font-size:10px;white-space:pre-line;margin-top:5px">Note: ${esc(invoice.notes)}</div>` : ""}
    ${dash}
    <div style="display:flex;justify-content:center">${svgBox(qrSvg, 96, 96)}</div>
    <div style="text-align:center;font-size:10px;margin-top:6px">${esc(shop.footer || "Thank you for shopping with us")}</div>
    ${shop.terms ? `<div style="text-align:center;font-size:9px;color:#555;margin-top:3px">${esc(shop.terms)}</div>` : ""}
  </div>`;
  return printDoc(`Receipt ${invoice.number}`, body, "@page { size: 80mm auto; margin: 3mm; } body { margin: 0; }");
}
