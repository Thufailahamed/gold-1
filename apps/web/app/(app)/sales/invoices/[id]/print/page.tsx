"use client";

import { use, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api, assetUrl } from "@/lib/api";
import { amountInWords } from "@/lib/barcode";
import { Page, Skeleton, Callout } from "@/components/ui";
import { ArrowLeftIcon, PrinterIcon, FileDownIcon } from "@/components/icons";

type Detail = {
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

type Profile = {
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

const fmt = (c: number) =>
  (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const grams = (mg: number) => (mg / 1000).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const STATUS: Record<string, { label: string; cls: string }> = {
  PAID: { label: "Paid", cls: "bg-emerald-50 text-emerald-800 ring-emerald-600/25" },
  PARTIAL: { label: "Part paid", cls: "bg-amber-50 text-amber-800 ring-amber-600/25" },
  UNPAID: { label: "Unpaid · on credit", cls: "bg-rose-50 text-rose-800 ring-rose-600/25" },
  VOID: { label: "Void", cls: "bg-ink/[0.05] text-ink-3 ring-ink/15" },
};

function methodLabel(p: { method: string; bank_account_name?: string | null }) {
  const m = p.method === "credit" ? "On account" : p.method.charAt(0).toUpperCase() + p.method.slice(1);
  return p.bank_account_name ? `${m} · ${p.bank_account_name}` : m;
}

/** Sri Lankan mobiles are keyed as 07x…; WhatsApp wants 947x…. */
function waNumber(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("0") ? `94${d.slice(1)}` : d;
}

export default function SalePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  // ?format=receipt prints an 80mm thermal slip; the default is the A4 bill.
  // ?auto=1 opens the print dialog as soon as the bill has rendered.
  const [receipt, setReceipt] = useState(false);
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setReceipt(q.get("format") === "receipt");
    setAuto(q.get("auto") === "1");
  }, []);
  const detail = useQuery({
    queryKey: ["sale-print", id],
    queryFn: () => api<Detail>(`/api/v1/sales/invoices/${id}`),
  });
  const profile = useQuery({
    queryKey: ["invoice-profile"],
    queryFn: () => api<Profile>(`/api/v1/sales/invoice-profile`),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const ready = Boolean(detail.data) && !profile.isLoading;
  useEffect(() => {
    if (!auto || !ready) return;
    // Give the QR and barcode images a moment to paint before the dialog.
    const t = setTimeout(() => window.print(), 700);
    setAuto(false);
    return () => clearTimeout(t);
  }, [auto, ready]);

  if (detail.isLoading) {
    return (
      <Page>
        <Skeleton className="mx-auto h-[48rem] max-w-[210mm]" />
      </Page>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Page>
        <Callout tone="danger" title="Invoice not found">
          This sales invoice does not exist or could not be loaded.
        </Callout>
      </Page>
    );
  }
  const { invoice, items, payments } = detail.data;
  const receipts = (detail.data.receipts ?? []).filter((r) => r.status === "POSTED");
  const returns = detail.data.returns ?? [];
  const shop: Profile = profile.data ?? {
    shopName: "GoldOS",
    header: "",
    footer: "",
    address: "",
    phone: "",
    email: "",
    terms: "",
    taxLabel: "VAT",
    taxRegNo: "",
  };
  const taxed = (invoice.tax_cents ?? 0) > 0;
  const cashPaid = payments.filter((p) => p.method === "cash").reduce((s, p) => s + p.amount_cents, 0);
  const change = invoice.tendered_cents != null && invoice.tendered_cents > cashPaid ? invoice.tendered_cents - cashPaid : 0;
  const created = new Date(invoice.created_at);
  const status = STATUS[invoice.status] ?? STATUS.PAID!;
  const totals = items.reduce(
    (a, it) => ({ gross: a.gross + it.gross_mg, net: a.net + it.net_mg, making: a.making + it.making_cents }),
    { gross: 0, net: 0, making: 0 }
  );
  const balance = Math.max(0, invoice.balance_cents ?? invoice.total_cents - invoice.paid_cents);
  const shareText = `${shop.shopName} — Invoice ${invoice.number}\nTotal: LKR ${fmt(invoice.total_cents)}${balance > 0 ? `\nBalance due: LKR ${fmt(balance)}` : "\nPaid in full"}\nThank you!`;

  return (
    <Page>
      <style>{receipt ? `@media print { @page { size: 80mm auto; margin: 3mm; } }` : `@media print { @page { size: A4; margin: 8mm; } }`}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button onClick={() => router.back()} className="g-btn g-btn-secondary h-10 px-4 text-sm">
          <ArrowLeftIcon size={15} /> Back
        </button>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-lg bg-ink/[0.05] p-0.5 text-sm">
            {[
              { k: false, label: "A4 invoice" },
              { k: true, label: "Receipt 80mm" },
            ].map((o) => (
              <button
                key={o.label}
                onClick={() => setReceipt(o.k)}
                className={cn("rounded-md px-3 py-1.5", receipt === o.k ? "bg-paper font-medium text-ink shadow-sm" : "text-ink-3")}
              >
                {o.label}
              </button>
            ))}
          </div>
          {invoice.customer_phone ? (
            <a
              href={`https://wa.me/${waNumber(invoice.customer_phone)}?text=${encodeURIComponent(shareText)}`}
              target="_blank"
              rel="noreferrer"
              className="g-btn g-btn-secondary h-10 px-4 text-sm"
            >
              WhatsApp
            </a>
          ) : null}
          <button onClick={() => window.print()} className="g-btn g-btn-secondary h-10 px-4 text-sm" title="Choose “Save as PDF” in the print dialog">
            <FileDownIcon size={15} /> PDF
          </button>
          <button onClick={() => window.print()} className="g-btn g-btn-primary h-10 px-4 text-sm">
            <PrinterIcon size={15} /> Print
          </button>
        </div>
      </div>

      {receipt ? (
        <ThermalReceipt
          id={id}
          shop={shop}
          invoice={invoice}
          items={items}
          payments={payments}
          receipts={receipts}
          change={change}
          balance={balance}
          status={status.label}
        />
      ) : (
        <article className="print-area invoice-sheet mx-auto w-full max-w-[210mm] animate-fade-in overflow-hidden rounded-2xl bg-paper text-ink shadow-elevated ring-1 ring-ink/10 print:max-w-none print:rounded-none print:shadow-none print:ring-0">
          {/* Letterhead */}
          <div className="h-1.5 bg-gradient-to-r from-gold-deep via-gold to-gold-light" />
          <header className="flex flex-wrap items-start justify-between gap-6 px-10 pb-6 pt-8 print:px-2 print:pb-4 print:pt-4">
            <div className="min-w-0 max-w-[60%]">
              <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight text-ink">{shop.shopName}</h1>
              {shop.header ? <p className="mt-0.5 text-sm italic text-gold-deep">{shop.header}</p> : null}
              <div className="mt-2 space-y-0.5 text-[12.5px] leading-relaxed text-ink-3">
                {shop.address ? <p className="whitespace-pre-line">{shop.address}</p> : null}
                {invoice.branch_name ? (
                  <p>
                    {invoice.branch_name} branch{invoice.branch_address ? ` · ${invoice.branch_address}` : ""}
                  </p>
                ) : null}
                {shop.phone || shop.email ? (
                  <p>{[shop.phone && `Tel ${shop.phone}`, shop.email].filter(Boolean).join(" · ")}</p>
                ) : null}
                {taxed && shop.taxRegNo ? <p>{shop.taxLabel} Reg. No. {shop.taxRegNo}</p> : null}
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-gold-deep">{taxed ? "Tax invoice" : "Invoice"}</p>
                <p className="mt-1 font-mono text-xl font-bold tracking-tight text-ink">{invoice.number}</p>
                <p className="mt-1 text-[12.5px] text-ink-3">
                  {created.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} ·{" "}
                  {created.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                </p>
                <span className={cn("mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ring-1", status.cls)}>
                  {status.label}
                </span>
              </div>
              {/* Scanned back at the counter to find this sale for a return. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assetUrl(`/api/v1/sales/invoices/${id}/qr`)} alt={`QR ${invoice.number}`} className="size-[84px] shrink-0" />
            </div>
          </header>

          {/* Parties */}
          <section className="mx-10 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-ink/10 ring-1 ring-ink/10 print:mx-2">
            <div className="bg-bone px-5 py-4">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-ink-4">Bill to</p>
              <p className="mt-1.5 text-[15px] font-semibold text-ink">{invoice.customer_name ?? "Walk-in customer"}</p>
              <div className="mt-1 space-y-0.5 text-[12.5px] text-ink-3">
                {invoice.customer_code ? <p className="font-mono">{invoice.customer_code}</p> : null}
                {invoice.customer_phone ? <p>{invoice.customer_phone}</p> : null}
                {invoice.customer_address ? <p className="whitespace-pre-line">{invoice.customer_address}</p> : null}
                {invoice.customer_nic ? <p>NIC {invoice.customer_nic}</p> : null}
              </div>
            </div>
            <div className="bg-bone px-5 py-4">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-ink-4">Sale details</p>
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[12.5px]">
                <dt className="text-ink-4">Branch</dt>
                <dd className="text-ink">{invoice.branch_name ?? "—"}{invoice.branch_code ? ` (${invoice.branch_code})` : ""}</dd>
                <dt className="text-ink-4">Sales person</dt>
                <dd className="text-ink">{invoice.salesperson_name ?? "—"}</dd>
                {invoice.cashier_name && invoice.cashier_name !== invoice.salesperson_name ? (
                  <>
                    <dt className="text-ink-4">Cashier</dt>
                    <dd className="text-ink">{invoice.cashier_name}</dd>
                  </>
                ) : null}
                <dt className="text-ink-4">Pieces</dt>
                <dd className="text-ink num-tabular">{items.length} · {grams(totals.net)} g net</dd>
              </dl>
            </div>
          </section>

          {/* Lines */}
          <section className="px-10 pt-6 print:px-2 print:pt-4">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b-2 border-ink text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                  <th className="w-7 py-2 pr-2">#</th>
                  <th className="py-2 pr-2">Description</th>
                  <th className="py-2 pr-2 text-center">Purity</th>
                  <th className="py-2 pr-2 text-right">Gross g</th>
                  <th className="py-2 pr-2 text-right">Net g</th>
                  <th className="py-2 pr-2 text-right">Making</th>
                  <th className="py-2 pr-2 text-right">Amount</th>
                  <th className="py-2 text-right">Disc.</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-ink/10 align-top">
                    <td className="py-2.5 pr-2 text-ink-4 num-tabular">{i + 1}</td>
                    <td className="py-2.5 pr-2">
                      <p className="font-medium text-ink">{it.name}</p>
                      <p className="font-mono text-[10.5px] text-ink-4">
                        {it.barcode}{it.category_name ? ` · ${it.category_name}` : ""}
                        {it.stone_mg > 0 ? ` · stone ${grams(it.stone_mg)} g` : ""}
                      </p>
                    </td>
                    <td className="py-2.5 pr-2 text-center font-medium">{it.karat}</td>
                    <td className="py-2.5 pr-2 text-right num-tabular text-ink-2">{grams(it.gross_mg)}</td>
                    <td className="py-2.5 pr-2 text-right num-tabular text-ink-2">{grams(it.net_mg)}</td>
                    <td className="py-2.5 pr-2 text-right num-tabular text-ink-2">{fmt(it.making_cents)}</td>
                    <td className="py-2.5 pr-2 text-right num-tabular font-medium">{fmt(it.price_cents)}</td>
                    <td className="py-2.5 text-right num-tabular text-ink-2">{it.discount_cents ? fmt(it.discount_cents) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-[11.5px] font-semibold text-ink-3">
                  <td />
                  <td className="py-2 pr-2">Totals</td>
                  <td />
                  <td className="py-2 pr-2 text-right num-tabular">{grams(totals.gross)}</td>
                  <td className="py-2 pr-2 text-right num-tabular">{grams(totals.net)}</td>
                  <td className="py-2 pr-2 text-right num-tabular">{fmt(totals.making)}</td>
                  <td className="py-2 pr-2 text-right num-tabular">{fmt(invoice.subtotal_cents)}</td>
                  <td className="py-2 text-right num-tabular">{invoice.discount_cents ? fmt(invoice.discount_cents) : "—"}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          {/* Money */}
          <section className="grid grid-cols-[1fr_minmax(0,19rem)] gap-8 px-10 pt-4 print:px-2">
            <div className="space-y-4 text-[12.5px]">
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-ink-4">Amount in words</p>
                <p className="mt-1 font-medium text-ink">{amountInWords(invoice.total_cents)}</p>
              </div>
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-ink-4">Payment received</p>
                <table className="mt-1 w-full">
                  <tbody>
                    {payments.map((p, i) => (
                      <tr key={i}>
                        <td className="py-0.5 text-ink-2">{methodLabel(p)}</td>
                        <td className="py-0.5 text-right num-tabular text-ink">{fmt(p.amount_cents)}</td>
                      </tr>
                    ))}
                    {invoice.tendered_cents != null && cashPaid > 0 ? (
                      <>
                        <tr className="text-ink-4">
                          <td className="py-0.5 pl-3">Cash tendered</td>
                          <td className="py-0.5 text-right num-tabular">{fmt(invoice.tendered_cents)}</td>
                        </tr>
                        <tr className="text-ink-4">
                          <td className="py-0.5 pl-3">Change given</td>
                          <td className="py-0.5 text-right num-tabular">{fmt(change)}</td>
                        </tr>
                      </>
                    ) : null}
                    {(invoice.store_credit_cents ?? 0) > 0 ? (
                      <tr className="text-ink-4">
                        <td className="py-0.5">Settled from store credit</td>
                        <td className="py-0.5 text-right num-tabular">{fmt(invoice.store_credit_cents!)}</td>
                      </tr>
                    ) : null}
                    {receipts.map((r) => (
                      <tr key={r.number} className="text-ink-3">
                        <td className="whitespace-nowrap py-0.5">Received {r.receipt_date} · {r.number}</td>
                        <td className="py-0.5 text-right num-tabular">{fmt(r.amount_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {returns.length > 0 ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900 ring-1 ring-amber-600/20">
                  Returns against this bill: {returns.map((r) => `${r.number} (${r.type.toLowerCase()})`).join(", ")}
                </p>
              ) : null}
              {invoice.notes ? (
                <div>
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-ink-4">Note</p>
                  <p className="mt-1 whitespace-pre-line text-ink-2">{invoice.notes}</p>
                </div>
              ) : null}
            </div>
            <div>
              <dl className="space-y-1.5 text-[13px] num-tabular">
                <div className="flex justify-between text-ink-3">
                  <dt>Subtotal</dt>
                  <dd>{fmt(invoice.subtotal_cents)}</dd>
                </div>
                {invoice.discount_cents ? (
                  <div className="flex justify-between text-ink-3">
                    <dt>Discount</dt>
                    <dd>− {fmt(invoice.discount_cents)}</dd>
                  </div>
                ) : null}
                {taxed ? (
                  <>
                    <div className="flex justify-between text-ink-3">
                      <dt>Taxable value</dt>
                      <dd>{fmt(invoice.subtotal_cents - invoice.discount_cents)}</dd>
                    </div>
                    <div className="flex justify-between text-ink-3">
                      <dt>{shop.taxLabel} @ {((invoice.tax_rate_bp ?? 0) / 100).toFixed(2).replace(/\.00$/, "")}%</dt>
                      <dd>{fmt(invoice.tax_cents ?? 0)}</dd>
                    </div>
                  </>
                ) : null}
              </dl>
              <div className="mt-3 flex items-baseline justify-between rounded-xl bg-ink px-4 py-3 text-paper print:bg-ink">
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-light">Total LKR</span>
                <span className="font-display text-2xl font-bold num-tabular">{fmt(invoice.total_cents)}</span>
              </div>
              <dl className="mt-3 space-y-1.5 text-[13px] num-tabular">
                <div className="flex justify-between text-ink-2">
                  <dt>Amount paid</dt>
                  <dd className="font-medium">{fmt(invoice.paid_cents)}</dd>
                </div>
                <div className={cn("flex justify-between rounded-lg px-2 py-1 -mx-2", balance > 0 ? "bg-rose-50 font-semibold text-rose-800" : "text-emerald-800")}>
                  <dt>{balance > 0 ? "Balance due" : "Balance"}</dt>
                  <dd>{fmt(balance)}</dd>
                </div>
              </dl>
            </div>
          </section>

          {/* Terms & signatures */}
          <section className="mt-8 grid grid-cols-[1fr_auto_auto] items-end gap-8 border-t border-ink/10 px-10 pt-5 print:mt-4 print:break-inside-avoid print:px-2 print:pt-3">
            <div className="text-[11px] leading-relaxed text-ink-4">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-ink-4">Terms</p>
              <p className="mt-1 whitespace-pre-line">
                {shop.terms || "Keep this invoice for returns and exchanges. Gold weights are in grams."}
              </p>
            </div>
            <div className="w-40 text-center text-[11px] text-ink-4">
              <div className="h-10 border-b border-ink/40" />
              <p className="mt-1">Customer signature</p>
            </div>
            <div className="w-40 text-center text-[11px] text-ink-4">
              <div className="h-10 border-b border-ink/40" />
              <p className="mt-1">Authorised signature</p>
            </div>
          </section>

          <footer className="mt-6 flex items-center justify-between gap-4 bg-bone px-10 py-4 print:mt-3 print:break-inside-avoid print:bg-transparent print:px-2 print:py-2">
            <p className="text-[12px] text-ink-3">{shop.footer || "Thank you for shopping with us."}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assetUrl(`/api/v1/sales/invoices/${id}/barcode`)} alt={`Barcode ${invoice.number}`} className="h-12" />
          </footer>
        </article>
      )}
    </Page>
  );
}

function ThermalReceipt({
  id,
  shop,
  invoice,
  items,
  payments,
  receipts,
  change,
  balance,
  status,
}: {
  id: string;
  shop: Profile;
  invoice: Detail["invoice"];
  items: Detail["items"];
  payments: Detail["payments"];
  receipts: Detail["receipts"];
  change: number;
  balance: number;
  status: string;
}) {
  const taxed = (invoice.tax_cents ?? 0) > 0;
  const Row = ({ l, r, b }: { l: React.ReactNode; r: React.ReactNode; b?: boolean }) => (
    <p className={cn("flex justify-between gap-2", b && "font-bold")}>
      <span>{l}</span>
      <span className="num-tabular">{r}</span>
    </p>
  );
  return (
    <div className="print-area mx-auto w-full max-w-[80mm] animate-fade-in rounded-md bg-paper p-3 font-mono text-[11.5px] leading-snug text-ink shadow-elevated ring-1 ring-ink/10 print:max-w-none print:rounded-none print:p-0 print:shadow-none print:ring-0">
      <div className="text-center">
        <p className="font-sans text-lg font-bold">{shop.shopName}</p>
        {shop.header ? <p className="text-[10.5px]">{shop.header}</p> : null}
        {shop.address ? <p className="whitespace-pre-line text-[10.5px]">{shop.address}</p> : null}
        {shop.phone ? <p className="text-[10.5px]">Tel {shop.phone}</p> : null}
        {taxed && shop.taxRegNo ? <p className="text-[10.5px]">{shop.taxLabel} Reg {shop.taxRegNo}</p> : null}
        <p className="mt-1.5 text-[10.5px] font-semibold uppercase tracking-widest">{taxed ? "Tax invoice" : "Invoice"}</p>
      </div>
      <div className="my-2 border-t border-dashed border-ink/50" />
      <Row l={invoice.number} r={new Date(invoice.created_at).toLocaleDateString("en-GB")} b />
      <Row l={invoice.branch_name ?? ""} r={new Date(invoice.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} />
      <p>Customer: {invoice.customer_name ?? "Walk-in"}</p>
      {invoice.customer_phone ? <p>Phone: {invoice.customer_phone}</p> : null}
      <div className="my-2 border-t border-dashed border-ink/50" />
      {items.map((it, i) => (
        <div key={i} className="mb-1.5">
          <p className="font-sans font-semibold">{it.name}</p>
          <Row l={`${it.karat} ${grams(it.net_mg)}g · ${it.barcode}`} r={fmt(it.price_cents)} />
          {it.discount_cents ? <Row l="  discount" r={`-${fmt(it.discount_cents)}`} /> : null}
        </div>
      ))}
      <div className="my-2 border-t border-dashed border-ink/50" />
      <Row l="Subtotal" r={fmt(invoice.subtotal_cents)} />
      {invoice.discount_cents ? <Row l="Discount" r={`-${fmt(invoice.discount_cents)}`} /> : null}
      {taxed ? <Row l={`${shop.taxLabel} ${((invoice.tax_rate_bp ?? 0) / 100).toFixed(2).replace(/\.00$/, "")}%`} r={fmt(invoice.tax_cents ?? 0)} /> : null}
      <div className="my-1 border-t border-ink" />
      <p className="flex justify-between font-sans text-base font-bold">
        <span>TOTAL LKR</span>
        <span className="num-tabular">{fmt(invoice.total_cents)}</span>
      </p>
      <div className="my-1 border-t border-ink" />
      {payments.map((p, i) => (
        <Row key={i} l={methodLabel(p)} r={fmt(p.amount_cents)} />
      ))}
      {invoice.tendered_cents != null && change >= 0 && payments.some((p) => p.method === "cash") ? (
        <>
          <Row l="Tendered" r={fmt(invoice.tendered_cents)} />
          <Row l="Change" r={fmt(change)} b />
        </>
      ) : null}
      {receipts.map((r) => (
        <Row key={r.number} l={`Rcpt ${r.number}`} r={fmt(r.amount_cents)} />
      ))}
      {balance > 0 ? <Row l="BALANCE DUE" r={fmt(balance)} b /> : null}
      <p className="mt-1 text-center text-[10.5px] uppercase">{status}</p>
      {invoice.notes ? <p className="mt-1.5 whitespace-pre-line text-[10.5px]">Note: {invoice.notes}</p> : null}
      <div className="my-2 border-t border-dashed border-ink/50" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={assetUrl(`/api/v1/sales/invoices/${id}/qr`)} alt={`QR ${invoice.number}`} className="mx-auto size-24" />
      <p className="mt-2 text-center text-[10.5px]">{shop.footer || "Thank you for shopping with us"}</p>
      {shop.terms ? <p className="mt-1 text-center text-[9.5px] text-ink-3">{shop.terms}</p> : null}
    </div>
  );
}
