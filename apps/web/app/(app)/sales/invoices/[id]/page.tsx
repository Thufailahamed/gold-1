"use client";

import { use, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { extractScanCode, hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, Skeleton } from "@/components/ui";
import { Select } from "@/components/select";
import { Card, CardHead, Empty, GoldHero, HeroBadge, INVOICE_META, ReturnChip, grams, heroGhost, heroGold, lkr, stamp, th, thead, tr } from "../../kit";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowLeftRightIcon,
  ArrowRightIcon,
  BanknoteIcon,
  BookOpenIcon,
  CheckCircleIcon,
  CheckIcon,
  CoinsIcon,
  CreditCardIcon,
  FileTextIcon,
  PackageIcon,
  PrinterIcon,
  RotateCcwIcon,
  ScanBarcodeIcon,
  UsersIcon,
  XIcon,
} from "@/components/icons";

type Detail = {
  invoice: {
    id: string;
    number: string;
    customer_id: string | null;
    customer_name: string | null;
    customer_code: string | null;
    salesperson_name: string | null;
    subtotal_cents: number;
    discount_cents: number;
    tax_cents?: number;
    tax_rate_bp?: number;
    total_cents: number;
    paid_cents: number;
    balance_cents: number;
    status: string;
    created_at: number;
    branch_id: string;
    branch_name: string | null;
    customer_phone: string | null;
    tendered_cents: number | null;
    store_credit_cents: number;
    notes: string | null;
  };
  items: { id: string; product_id: string; barcode: string; sku: string; name: string; gross_mg: number; net_mg: number; karat: string; price_cents: number; discount_cents: number }[];
  payments: { id: string; amount_cents: number; method: string; created_at: number; account_code: string | null; bank_account_name: string | null; cheque_no?: string | null; cheque_bank?: string | null }[];
  receipts: { id: string; number: string; receipt_date: string; method: string; status: string; amount_cents: number }[];
  journal: { id: string; account_code: string; account_name: string | null; debit_cents: number; credit_cents: number; memo: string | null; entry_no: string | null }[];
  returns: { id: string; number: string; type: string; refund_cents: number; credit_cents: number; exchange_sale_id: string | null; status: string }[];
  returnedItemIds: string[];
  exchangeOf: { id: string; number: string; invoice_id: string; invoice_number: string } | null;
};

const RETURN_TYPES = [
  { key: "PARTIAL", title: "Partial", body: "Some pieces back", icon: <RotateCcwIcon size={16} /> },
  { key: "FULL", title: "Full", body: "Every remaining piece", icon: <PackageIcon size={16} /> },
  { key: "EXCHANGE", title: "Exchange", body: "Swap for another piece", icon: <ArrowLeftRightIcon size={16} /> },
] as const;

const REFUND_METHODS = [
  { key: "original", label: "Original methods", icon: <ArrowLeftRightIcon size={13} /> },
  { key: "cash", label: "Cash", icon: <BanknoteIcon size={13} /> },
  { key: "bank", label: "Bank", icon: <CreditCardIcon size={13} /> },
  { key: "credit", label: "Store credit", icon: <CoinsIcon size={13} /> },
] as const;

const inputCls =
  "h-11 w-full rounded-xl bg-paper px-3.5 text-sm text-ink placeholder:text-ink-5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12),0_1px_2px_rgba(16,32,27,0.04)] transition-shadow hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.26)] focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)]";

const td = "px-2 py-1.5";

/* ------------------------------------------------------------------ page */

export default function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [retOpen, setRetOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [type, setType] = useState("PARTIAL");
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState("original");
  const [refundBank, setRefundBank] = useState("");
  const [retScan, setRetScan] = useState("");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCancel = hasPermission(me.data?.permissions ?? [], "sales:cancel");
  const canCollect = hasPermission(me.data?.permissions ?? [], "accounts:manage");
  const banks = useQuery({
    queryKey: ["pos-bank-accounts", "all"],
    queryFn: () => api<{ id: string; name: string; bank_name: string | null }[]>("/api/v1/sales/bank-accounts"),
    enabled: retOpen && refundMethod === "bank",
    retry: false,
  });

  const detail = useQuery({
    queryKey: ["sale", id],
    queryFn: () => api<Detail>(`/api/v1/sales/invoices/${id}`),
  });

  const ret = useMutation({
    mutationFn: () =>
      api<{ returnId: string; number: string }>("/api/v1/sales/returns", {
        method: "POST",
        body: JSON.stringify({
          invoiceId: id,
          itemIds: type === "FULL" ? undefined : selected,
          type,
          reason,
          refundMethod,
          refundBankAccountId: refundMethod === "bank" && refundBank ? refundBank : undefined,
        }),
      }),
    onSuccess: (d) => {
      toast.success(`Return ${d.number} recorded`);
      setRetOpen(false);
      setSelected([]);
      setReason("");
      qc.invalidateQueries({ queryKey: ["sale", id] });
      qc.invalidateQueries({ queryKey: ["sale-print", id] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Return failed");
    },
  });

  const fmt = (c: number) => (c / 100).toLocaleString("en-US");

  if (detail.isLoading) {
    return (
      <Page className="space-y-4">
        <Skeleton className="h-44 rounded-[20px]" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </Page>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Page>
        <Card>
          <Empty
            icon={AlertCircleIcon}
            title="Sale not found"
            desc="This invoice does not exist or could not be loaded."
            action={
              <button type="button" onClick={() => router.push("/sales/invoices")} className="g-btn g-btn-primary h-8 rounded-lg px-3 text-[12px]">
                <ArrowLeftIcon size={12} /> Back to invoices
              </button>
            }
          />
        </Card>
      </Page>
    );
  }
  const { invoice, items, payments, journal, returns, exchangeOf } = detail.data;
  const returned = new Set(detail.data.returnedItemIds ?? []);
  const returnable = items.filter((it) => !returned.has(it.id));
  const creditCents = payments.filter((p) => p.method === "credit").reduce((s, p) => s + p.amount_cents, 0);
  const balance = Math.max(0, invoice.balance_cents ?? invoice.total_cents - invoice.paid_cents);
  const receipts = detail.data.receipts ?? [];
  const paidShare = invoice.total_cents > 0 ? Math.min(Math.max((invoice.total_cents - balance) / invoice.total_cents, 0), 1) : 0;
  const netMg = items.reduce((s, it) => s + it.net_mg, 0);
  const grossMg = items.reduce((s, it) => s + it.gross_mg, 0);
  const debit = journal.reduce((s, j) => s + j.debit_cents, 0);
  const credit = journal.reduce((s, j) => s + j.credit_cents, 0);
  const balanced = journal.length > 0 && debit === credit;
  const refundedTotal = returns.reduce((s, r) => s + r.refund_cents + (r.credit_cents ?? 0), 0);
  const perGram = netMg > 0 ? (invoice.total_cents / netMg) * 1000 : 0;
  const isVoid = invoice.status === "VOID";

  // Scan the piece the customer brought back to tick its line.
  function scanReturn() {
    const code = extractScanCode(retScan);
    setRetScan("");
    if (!code) return;
    const it = items.find((x) => x.barcode === code || x.sku === code);
    if (!it) return toast.error(`${code} is not on ${invoice.number}`);
    if (returned.has(it.id)) return toast.error(`${code} was already returned`);
    setSelected((s) => (s.includes(it.id) ? s : [...s, it.id]));
  }

  const exchangeHref = (r: { id: string; number: string }) => {
    const q = new URLSearchParams({ exchange: r.id, exchangeNo: r.number });
    if (invoice.customer_id) {
      q.set("customerId", invoice.customer_id);
      q.set("customerName", invoice.customer_name ?? "Customer");
      q.set("customerCode", invoice.customer_code ?? "");
    }
    return `/pos?${q.toString()}`;
  };

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={FileTextIcon}
        title={<span className={cn(isVoid && "line-through decoration-paper/40")}>{invoice.number}</span>}
        back={{ href: "/sales/invoices", label: "Sales invoices" }}
        badge={
          <>
            <HeroBadge tone={invoice.status === "PAID" ? "good" : invoice.status === "VOID" ? "muted" : "warn"}>
              {INVOICE_META[invoice.status]?.label ?? invoice.status}
              {invoice.status === "UNPAID" ? " · on credit" : ""}
            </HeroBadge>
            {exchangeOf ? <HeroBadge tone="muted">Exchange</HeroBadge> : null}
          </>
        }
        sub={
          <>
            {invoice.customer_id ? `${invoice.customer_name ?? "Customer"}${invoice.customer_code ? ` (${invoice.customer_code})` : ""}` : "Walk-in"} · {stamp(invoice.created_at)}
            {invoice.salesperson_name ? ` · sold by ${invoice.salesperson_name}` : ""}
            {invoice.branch_name ? ` · ${invoice.branch_name}` : ""}
          </>
        }
        actions={
          <>
            {balance > 0 && canCollect && invoice.customer_id ? (
              <Link href={`/accounts/receivables?collect=${encodeURIComponent(invoice.customer_id)}`} className={heroGold}>
                <BanknoteIcon size={13} /> Collect payment
              </Link>
            ) : null}
            {canCancel && returnable.length > 0 ? (
              <button type="button" onClick={() => setRetOpen(true)} className={balance > 0 && canCollect && invoice.customer_id ? heroGhost : heroGold}>
                <RotateCcwIcon size={13} /> Record return
              </button>
            ) : null}
            <Link href={`/sales/invoices/${id}/print`} className={heroGhost}>
              <PrinterIcon size={13} /> A4
            </Link>
            <Link href={`/sales/invoices/${id}/print?format=receipt`} className={heroGhost}>
              <PrinterIcon size={13} /> Receipt
            </Link>
          </>
        }
        stats={[
          { label: "Total", value: invoice.total_cents, format: lkr, unit: "LKR", accent: true, sub: invoice.discount_cents ? `After ${fmt(invoice.discount_cents)} off` : "No discount" },
          { label: "Paid", value: invoice.paid_cents, format: lkr, unit: "LKR", tone: "good", sub: `${Math.round(paidShare * 100)}% settled` },
          { label: "Balance due", value: balance, format: lkr, unit: "LKR", tone: balance > 0 ? "warn" : undefined, sub: balance > 0 ? "On the customer ledger" : "Settled in full" },
          { label: "Pieces", value: items.length, sub: returned.size ? `${returned.size} returned` : "All kept" },
          { label: "Net weight", value: netMg, format: grams, unit: "g", sub: `${grams(grossMg)} g gross` },
          { label: "Price / g", value: perGram, format: lkr, unit: "LKR", sub: "Total ÷ net weight" },
          { label: "Returned", value: refundedTotal, format: lkr, unit: "LKR", tone: refundedTotal ? "bad" : undefined, sub: returns.length ? `${returns.length} return${returns.length === 1 ? "" : "s"}` : "None" },
        ]}
      >
        <div className="flex items-center gap-3">
          <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-paper/10">
            <span
              className={cn("block h-full rounded-full transition-[width] duration-700 ease-brand", paidShare >= 1 ? "bg-gradient-to-r from-emerald-500 to-emerald-300" : "bg-gradient-to-r from-gold-dark to-gold-light")}
              style={{ width: `${paidShare * 100}%` }}
            />
          </span>
          <span className="g-metric shrink-0 text-[11px] text-paper/55">
            {fmt(invoice.paid_cents)} / {fmt(invoice.total_cents)} LKR paid
          </span>
        </div>
      </GoldHero>

      {exchangeOf ? (
        <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-sky-50 to-paper px-4 py-2.5 ring-1 ring-sky-600/15">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
            <ArrowLeftRightIcon size={14} />
          </span>
          <p className="min-w-0 text-[12.5px] text-ink-3">
            <span className="font-semibold text-ink">Exchange for return {exchangeOf.number}</span> · replacement for pieces returned from{" "}
            <Link href={`/sales/invoices/${exchangeOf.invoice_id}`} className="font-medium text-gold-deep underline decoration-gold/40 underline-offset-4 hover:decoration-gold">
              {exchangeOf.invoice_number}
            </Link>
          </p>
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHead icon={PackageIcon} title="Items sold" sub={`${items.length} piece${items.length === 1 ? "" : "s"} · every line linked to a physical piece`} />
            {items.length === 0 ? (
              <Empty icon={PackageIcon} title="No items" desc="This invoice has no line items." />
            ) : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full min-w-[640px] text-[12.5px]">
                  <thead className={thead}>
                    <tr>
                      <th className={cn(th, "pl-4")}>Piece</th>
                      <th className={th}>Barcode</th>
                      <th className={th}>Karat</th>
                      <th className={cn(th, "text-right")}>Net g</th>
                      <th className={cn(th, "text-right")}>Price</th>
                      <th className={cn(th, "text-right")}>Discount</th>
                      <th className={cn(th, "pr-4 text-right")}>Line LKR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => {
                      const isReturned = returned.has(it.id);
                      return (
                        <tr key={it.id} className={cn(tr, isReturned && "opacity-60")}>
                          <td className="py-1.5 pl-4 pr-2">
                            <span className="flex items-center gap-1.5">
                              <Link href={`/products/${it.product_id}`} className={cn("max-w-[14rem] truncate font-medium text-ink hover:text-gold-deep", isReturned && "line-through")}>
                                {it.name}
                              </Link>
                              {isReturned ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-ink/[0.05] px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.1em] text-ink-4">
                                  <RotateCcwIcon size={9} /> Returned
                                </span>
                              ) : null}
                            </span>
                          </td>
                          <td className={cn(td, "font-mono text-[11px] text-ink-3")}>{it.barcode}</td>
                          <td className={td}>
                            <span className="g-metric rounded bg-gold-pale px-1.5 py-px text-[10.5px] font-semibold text-gold-deep ring-1 ring-gold-dark/15">{it.karat}</span>
                          </td>
                          <td className={cn(td, "g-metric text-right text-ink-3")}>{grams(it.net_mg)}</td>
                          <td className={cn(td, "g-metric text-right text-ink-3")}>{fmt(it.price_cents)}</td>
                          <td className={cn(td, "g-metric text-right", it.discount_cents ? "text-emerald-700" : "text-ink-5")}>{it.discount_cents ? `−${fmt(it.discount_cents)}` : "—"}</td>
                          <td className="g-metric py-1.5 pl-2 pr-4 text-right font-medium text-ink">{fmt(it.price_cents - it.discount_cents)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-bone/70">
                    <tr className="border-t border-ink/10 text-[12px] font-semibold">
                      <td colSpan={3} className="py-1.5 pl-4 text-[9.5px] uppercase tracking-[0.14em] text-gold-dark">
                        Total · {items.length} pieces
                      </td>
                      <td className="g-metric px-2 py-1.5 text-right text-ink">{grams(netMg)}</td>
                      <td className="g-metric px-2 py-1.5 text-right text-ink">{fmt(items.reduce((n, it) => n + it.price_cents, 0))}</td>
                      <td className="g-metric px-2 py-1.5 text-right text-emerald-700">−{fmt(items.reduce((n, it) => n + it.discount_cents, 0))}</td>
                      <td className="g-metric py-1.5 pl-2 pr-4 text-right text-gold-deep">{fmt(items.reduce((n, it) => n + it.price_cents - it.discount_cents, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>

          {returns.length > 0 ? (
            <Card>
              <CardHead icon={RotateCcwIcon} title="Returns" sub={`${returns.length} recorded · ${fmt(refundedTotal)} LKR back`} />
              <table className="w-full text-[12.5px]">
                <thead className={thead}>
                  <tr>
                    <th className={cn(th, "pl-4")}>Return</th>
                    <th className={th}>Type</th>
                    <th className={cn(th, "text-right")}>Refund</th>
                    <th className={cn(th, "text-right")}>Credit</th>
                    <th className={th}>Status</th>
                    <th className={cn(th, "pr-4 text-right")}>Exchange</th>
                  </tr>
                </thead>
                <tbody>
                  {returns.map((r) => (
                    <tr key={r.id} className={tr}>
                      <td className="g-metric py-1.5 pl-4 pr-2 font-semibold text-ink">{r.number}</td>
                      <td className={td}>
                        <ReturnChip status={r.type} />
                      </td>
                      <td className={cn(td, "g-metric text-right text-ink")}>{r.refund_cents ? fmt(r.refund_cents) : "—"}</td>
                      <td className={cn(td, "g-metric text-right text-ink-3")}>{r.credit_cents ? fmt(r.credit_cents) : "—"}</td>
                      <td className={td}>
                        <ReturnChip status={r.status} />
                      </td>
                      <td className="py-1.5 pl-2 pr-4 text-right">
                        {r.type === "EXCHANGE" ? (
                          r.exchange_sale_id ? (
                            <Link href={`/sales/invoices/${r.exchange_sale_id}`} className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 hover:underline">
                              <ArrowLeftRightIcon size={11} /> Replacement
                            </Link>
                          ) : (
                            <Link href={exchangeHref(r)} className="g-btn g-btn-primary h-6 rounded-md px-2 text-[11px]">
                              <ArrowLeftRightIcon size={11} /> Start sale
                            </Link>
                          )
                        ) : (
                          <span className="text-ink-5">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}

          <Card>
            <CardHead
              icon={BookOpenIcon}
              title="Ledger postings"
              sub={journal.length > 0 ? `${journal.length} line${journal.length === 1 ? "" : "s"} · double entry` : "Double-entry journal"}
              action={
                journal.length > 0 ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset",
                      balanced ? "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25" : "bg-rose-500/10 text-rose-800 ring-rose-500/25"
                    )}
                  >
                    {balanced ? <CheckCircleIcon size={10} /> : <AlertCircleIcon size={10} />}
                    {balanced ? "Balanced" : "Out of balance"}
                  </span>
                ) : null
              }
            />
            {journal.length === 0 ? (
              <Empty icon={BookOpenIcon} title="No postings" desc="Journal entries appear after posting." />
            ) : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-[12.5px]">
                  <thead className={thead}>
                    <tr>
                      <th className={cn(th, "pl-4")}>Account</th>
                      <th className={cn(th, "text-right")}>Debit</th>
                      <th className={cn(th, "pr-4 text-right")}>Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journal.map((j) => (
                      <tr key={j.id} className={tr}>
                        <td className="py-1.5 pl-4 pr-2">
                          <span className="flex items-center gap-2">
                            <span className="g-metric rounded bg-bone px-1.5 py-px text-[10.5px] text-ink-3 ring-1 ring-ink/[0.06]">{j.account_code}</span>
                            <span className="truncate text-ink-2">{j.account_name ?? ""}</span>
                            {j.memo && !j.memo.startsWith("Sale ") ? <span className="truncate text-[11px] text-ink-4">· {j.memo}</span> : null}
                          </span>
                        </td>
                        <td className={cn(td, "g-metric text-right text-ink")}>{j.debit_cents ? fmt(j.debit_cents) : <span className="text-ink-5">—</span>}</td>
                        <td className="g-metric py-1.5 pl-2 pr-4 text-right text-ink">{j.credit_cents ? fmt(j.credit_cents) : <span className="text-ink-5">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-bone/70">
                    <tr className="border-t border-ink/10 text-[12px] font-semibold">
                      <td className="py-1.5 pl-4 text-[9.5px] uppercase tracking-[0.14em] text-gold-dark">Totals</td>
                      <td className="g-metric px-2 py-1.5 text-right text-ink">{fmt(debit)}</td>
                      <td className="g-metric py-1.5 pl-2 pr-4 text-right text-ink">{fmt(credit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-4 lg:sticky lg:top-24">
          <Card>
            <CardHead icon={CreditCardIcon} title="Summary" sub="All amounts in LKR" />
            <dl className="divide-y divide-ink/[0.05] text-[12.5px]">
              {[
                ["Subtotal", fmt(invoice.subtotal_cents), "text-ink"],
                ...(invoice.discount_cents ? [["Discount", `− ${fmt(invoice.discount_cents)}`, "text-emerald-700"]] : []),
                ...(invoice.tax_cents ? [[`Tax ${(invoice.tax_rate_bp ?? 0) / 100}%`, fmt(invoice.tax_cents), "text-ink"]] : []),
              ].map(([k, v, c]) => (
                <div key={k} className="flex items-center justify-between gap-3 px-4 py-1.5">
                  <dt className="text-ink-4">{k}</dt>
                  <dd className={cn("g-metric", c)}>{v}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 bg-gold-pale/40 px-4 py-2">
                <dt className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-gold-dark">Total</dt>
                <dd className="g-metric text-[17px] text-gold-deep">{fmt(invoice.total_cents)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-1.5">
                <dt className="text-ink-4">Paid</dt>
                <dd className="g-metric text-ink">{fmt(invoice.paid_cents)}</dd>
              </div>
              {invoice.tendered_cents ? (
                <div className="flex items-center justify-between gap-3 px-4 py-1.5">
                  <dt className="text-ink-4">Tendered</dt>
                  <dd className="g-metric text-ink-3">{fmt(invoice.tendered_cents)}</dd>
                </div>
              ) : null}
              <div className={cn("flex items-center justify-between gap-3 px-4 py-2", balance > 0 ? "bg-amber-500/[0.07]" : "bg-emerald-600/[0.06]")}>
                <dt className={cn("flex items-center gap-1.5 text-[12px] font-semibold", balance > 0 ? "text-amber-800" : "text-emerald-800")}>
                  {balance > 0 ? <AlertCircleIcon size={12} /> : <CheckCircleIcon size={12} />}
                  {balance > 0 ? "Balance due" : "Settled in full"}
                </dt>
                <dd className={cn("g-metric text-[14px]", balance > 0 ? "text-amber-800" : "text-emerald-800")}>{fmt(balance)}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHead
              icon={BanknoteIcon}
              title="Payments"
              sub={creditCents > 0 ? `${fmt(creditCents)} LKR on the customer's account` : `${payments.length + receipts.length} recorded`}
            />
            {payments.length === 0 && receipts.length === 0 && invoice.store_credit_cents <= 0 ? (
              <Empty icon={BanknoteIcon} title="No payments" desc="No payments recorded on this invoice." />
            ) : (
              <ul className="divide-y divide-ink/[0.05] text-[12.5px]">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center gap-2.5 px-4 py-1.5">
                    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md", p.method === "credit" ? "bg-amber-500/10 text-amber-700" : "bg-void text-gold-light")}>
                      {p.method === "credit" ? <UsersIcon size={11} /> : p.method === "bank" || p.method === "card" ? <CreditCardIcon size={11} /> : <BanknoteIcon size={11} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium capitalize text-ink">{p.method === "credit" ? "On account" : p.method}</span>
                      <span className="block truncate text-[10.5px] text-ink-4">
                        {p.bank_account_name ? `${p.bank_account_name} · ` : ""}
                        {p.method === "cheque" ? `${[p.cheque_no ? `#${p.cheque_no}` : null, p.cheque_bank].filter(Boolean).join(" ")}${p.cheque_no || p.cheque_bank ? " · " : ""}` : ""}
                        {p.account_code ? `${p.account_code} · ` : ""}
                        {stamp(p.created_at)}
                      </span>
                    </span>
                    <span className="g-metric shrink-0 text-ink">{fmt(p.amount_cents)}</span>
                  </li>
                ))}
                {invoice.store_credit_cents > 0 ? (
                  <li className="flex items-center gap-2.5 px-4 py-1.5">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gold-pale text-gold-deep">
                      <CoinsIcon size={11} />
                    </span>
                    <span className="flex-1 font-medium text-ink">Store credit</span>
                    <span className="g-metric text-ink">{fmt(invoice.store_credit_cents)}</span>
                  </li>
                ) : null}
                {receipts.map((r) => (
                  <li key={r.id} className={cn("flex items-center gap-2.5 px-4 py-1.5", r.status === "VOID" && "opacity-50")}>
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-emerald-600/10 text-emerald-700">
                      <FileTextIcon size={11} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("g-metric block truncate font-medium text-ink", r.status === "VOID" && "line-through")}>Receipt {r.number}</span>
                      <span className="block truncate text-[10.5px] capitalize text-ink-4">
                        {r.receipt_date} · {r.method}
                      </span>
                    </span>
                    <span className={cn("g-metric shrink-0 text-ink", r.status === "VOID" && "line-through")}>{fmt(r.amount_cents)}</span>
                  </li>
                ))}
              </ul>
            )}
            {invoice.notes ? (
              <div className="flex items-start gap-2 border-t border-ink/[0.06] bg-gold-pale/40 px-4 py-2 text-[12px] text-ink-2">
                <FileTextIcon size={12} className="mt-0.5 shrink-0 text-gold-deep" />
                <span>{invoice.notes}</span>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHead icon={UsersIcon} title="Sale details" />
            <dl className="divide-y divide-ink/[0.05] text-[12px]">
              {[
                ["Customer", invoice.customer_name ?? "Walk-in"],
                ["Customer code", invoice.customer_code ?? "—"],
                ["Phone", invoice.customer_phone ?? "—"],
                ["Salesperson", invoice.salesperson_name ?? "—"],
                ["Branch", invoice.branch_name ?? "—"],
                ["Rung up", stamp(invoice.created_at)],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 px-4 py-1.5">
                  <dt className="text-ink-4">{k}</dt>
                  <dd className="truncate font-medium text-ink">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>

      {retOpen ? (
        <ReturnDialog
          invoiceNumber={invoice.number}
          returnable={returnable}
          selected={selected}
          setSelected={setSelected}
          type={type}
          setType={setType}
          reason={reason}
          setReason={setReason}
          refundMethod={refundMethod}
          setRefundMethod={setRefundMethod}
          refundBank={refundBank}
          setRefundBank={setRefundBank}
          banks={banks.data ?? []}
          retScan={retScan}
          setRetScan={setRetScan}
          onScan={scanReturn}
          creditCents={creditCents}
          pending={ret.isPending}
          onSubmit={() => ret.mutate()}
          onClose={() => setRetOpen(false)}
          fmt={fmt}
        />
      ) : null}
    </Page>
  );
}

/* ------------------------------------------------------------------ return dialog */

function ReturnDialog({
  invoiceNumber,
  returnable,
  selected,
  setSelected,
  type,
  setType,
  reason,
  setReason,
  refundMethod,
  setRefundMethod,
  refundBank,
  setRefundBank,
  banks,
  retScan,
  setRetScan,
  onScan,
  creditCents,
  pending,
  onSubmit,
  onClose,
  fmt,
}: {
  invoiceNumber: string;
  returnable: Detail["items"];
  selected: string[];
  setSelected: (fn: (s: string[]) => string[]) => void;
  type: string;
  setType: (v: string) => void;
  reason: string;
  setReason: (v: string) => void;
  refundMethod: string;
  setRefundMethod: (v: string) => void;
  refundBank: string;
  setRefundBank: (v: string) => void;
  banks: { id: string; name: string; bank_name: string | null }[];
  retScan: string;
  setRetScan: (v: string) => void;
  onScan: () => void;
  creditCents: number;
  pending: boolean;
  onSubmit: () => void;
  onClose: () => void;
  fmt: (c: number) => string;
}) {
  const disabled = !reason || (type !== "FULL" && selected.length === 0);
  const pieces = type === "FULL" ? returnable : returnable.filter((it) => selected.includes(it.id));

  // Escape closes the dialog, unless an open dropdown inside it already handled the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  return (
    // The overlay scrolls rather than the dialog body, so the bank dropdown is never clipped.
    <div
      className="fixed inset-0 z-50 flex animate-fade-in justify-center overflow-y-auto bg-void/60 p-4 backdrop-blur-md"
      onClick={pending ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="return-title"
        onClick={(e) => e.stopPropagation()}
        className="my-auto flex w-full max-w-xl animate-pop-in flex-col rounded-[24px] bg-paper shadow-5 ring-1 ring-ink/[0.06]"
      >
        {/* Header */}
        <div className="relative shrink-0 overflow-hidden rounded-t-[24px] bg-void px-6 pb-5 pt-6 text-paper">
          <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-50" aria-hidden />
          <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-gold/20 blur-[80px]" aria-hidden />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
            className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-lg text-paper/50 transition-colors hover:bg-paper/10 hover:text-paper"
          >
            <XIcon size={16} />
          </button>
          <div className="relative flex items-center gap-3.5">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_10px_22px_-10px_rgba(205,168,83,0.7)]">
              <RotateCcwIcon size={20} />
            </span>
            <div className="min-w-0 pr-8">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">Sales · {invoiceNumber}</div>
              <h2 id="return-title" className="g-display mt-1 text-xl text-paper">
                Record return
              </h2>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-6">
          <div>
            <span className="mb-2 block text-[12.5px] font-medium text-ink-2">Type</span>
            <div role="radiogroup" aria-label="Return type" className="grid gap-2 sm:grid-cols-3">
              {RETURN_TYPES.map((t) => {
                const on = t.key === type;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setType(t.key)}
                    className={cn(
                      "relative flex items-center gap-2.5 rounded-2xl p-3 text-left ring-1 transition-all duration-200 ease-brand",
                      on
                        ? "bg-void text-paper shadow-[0_14px_28px_-16px_rgba(6,42,34,0.9)] ring-gold/40"
                        : "bg-paper text-ink ring-ink/10 hover:-translate-y-px hover:bg-gold-pale/40 hover:ring-gold-dark/30"
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                        on ? "bg-gradient-to-b from-gold-light to-gold text-void" : "bg-bone text-ink-3"
                      )}
                    >
                      {t.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{t.title}</span>
                      <span className={cn("block truncate text-[11px]", on ? "text-paper/55" : "text-ink-4")}>{t.body}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {type !== "FULL" ? (
            <div>
              <span className="mb-2 flex items-center justify-between text-[12.5px] font-medium text-ink-2">
                Pieces coming back
                <span className="g-metric text-[11px] text-ink-4">
                  {selected.length}/{returnable.length} selected
                </span>
              </span>
              <div className="group relative">
                <ScanBarcodeIcon size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-5 group-focus-within:text-gold-dark" />
                <input
                  autoFocus
                  placeholder="Scan returned piece + Enter"
                  value={retScan}
                  onChange={(e) => setRetScan(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onScan();
                    }
                  }}
                  autoComplete="off"
                  className={cn(inputCls, "pl-10 pr-12 font-mono placeholder:font-sans")}
                />
                <kbd className="pointer-events-none absolute right-3 top-1/2 flex h-6 min-w-6 -translate-y-1/2 items-center justify-center rounded-md bg-paper px-1.5 font-mono text-[11px] text-ink-4 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12),0_1px_0_rgba(16,32,27,0.08)]">
                  ⏎
                </kbd>
              </div>
              <ul className="mt-2.5 max-h-56 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
                {returnable.map((it) => {
                  const on = selected.includes(it.id);
                  return (
                    <li key={it.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => setSelected((s) => (on ? s.filter((x) => x !== it.id) : [...s, it.id]))}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ring-1 transition-all duration-200",
                          on ? "bg-gold-pale/70 ring-gold-dark/35" : "bg-paper ring-ink/[0.08] hover:bg-bone/60 hover:ring-ink/15"
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded-md transition-colors",
                            on ? "bg-void text-gold-light" : "bg-paper ring-1 ring-ink/20"
                          )}
                        >
                          {on ? <CheckIcon size={12} /> : null}
                        </span>
                        <span className="g-metric shrink-0 rounded-md bg-gradient-to-b from-gold-light to-gold px-1.5 py-0.5 text-[10px] font-bold text-void">
                          {it.karat}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{it.name}</span>
                          <span className="block font-mono text-[11px] text-ink-4">{it.barcode}</span>
                        </span>
                        <span className="g-metric shrink-0 text-xs text-ink-3">{fmt(it.price_cents)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="rounded-2xl bg-bone/60 p-3.5 ring-1 ring-ink/[0.06]">
              <p className="text-xs font-medium text-ink-3">Returns every remaining piece:</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {returnable.map((it) => (
                  <span key={it.id} className="rounded-md bg-paper px-1.5 py-0.5 font-mono text-[11px] text-ink-2 ring-1 ring-ink/[0.08]">
                    {it.barcode}
                  </span>
                ))}
              </div>
            </div>
          )}

          <label className="block">
            <span className="mb-2 flex items-center justify-between text-[12.5px] font-medium text-ink-2">
              Reason
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Required</span>
            </span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is the customer returning it?"
              className={inputCls}
            />
          </label>

          <div>
            <span className="mb-2 block text-[12.5px] font-medium text-ink-2">Refund method</span>
            <div role="radiogroup" aria-label="Refund method" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {REFUND_METHODS.map((m) => {
                const on = m.key === refundMethod;
                return (
                  <button
                    key={m.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setRefundMethod(m.key)}
                    className={cn(
                      "inline-flex h-10 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-medium ring-1 transition-all duration-200",
                      on
                        ? "bg-void text-paper ring-gold/40 shadow-[0_10px_20px_-12px_rgba(6,42,34,0.8)]"
                        : "bg-paper text-ink-3 ring-ink/10 hover:-translate-y-px hover:bg-gold-pale/40 hover:text-ink"
                    )}
                  >
                    <span className={on ? "text-gold-light" : "text-ink-5"}>{m.icon}</span>
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {refundMethod === "bank" && banks.length > 1 ? (
            <div className="animate-fade-in">
              <span className="mb-2 block text-[12.5px] font-medium text-ink-2">Refund from bank account</span>
              <Select
                ariaLabel="Refund from bank account"
                value={refundBank}
                onChange={setRefundBank}
                icon={<CreditCardIcon size={13} />}
                options={[
                  { value: "", label: "Default bank (1010)" },
                  ...banks.map((b) => ({ value: b.id, label: b.name, hint: b.bank_name ?? undefined })),
                ]}
              />
            </div>
          ) : null}

          {refundMethod === "original" && creditCents > 0 ? (
            <p className="flex items-start gap-2 rounded-xl bg-gold-pale/60 px-3.5 py-2.5 text-xs leading-relaxed text-ink-3 ring-1 ring-gold-dark/15">
              <AlertCircleIcon size={13} className="mt-0.5 shrink-0 text-gold-deep" />
              The part bought on credit comes off what the customer owes; only money actually paid is refunded.
            </p>
          ) : null}
          {type === "EXCHANGE" ? (
            <p className="flex items-start gap-2 rounded-xl bg-sky-50 px-3.5 py-2.5 text-xs leading-relaxed text-ink-3 ring-1 ring-sky-600/15">
              <ArrowLeftRightIcon size={13} className="mt-0.5 shrink-0 text-sky-700" />
              <span>
                After recording, start the replacement sale from the Returns panel — pick <b>Store credit</b> to carry the
                refund into it.
              </span>
            </p>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-col-reverse gap-3 rounded-b-[24px] border-t border-ink/[0.06] bg-bone/50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-4">
            {pieces.length > 0 ? (
              <>
                <span className="g-metric font-medium text-ink">{pieces.length}</span> piece{pieces.length === 1 ? "" : "s"} coming back
              </>
            ) : (
              "Select the pieces coming back"
            )}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="g-btn h-11 rounded-xl px-4 text-sm text-ink-3 hover:bg-paper hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={pending || disabled}
              className="g-btn g-btn-primary h-11 rounded-xl px-5 text-sm"
            >
              {pending ? (
                <>
                  <span className="size-3.5 animate-spin rounded-full border-2 border-gold-light/30 border-t-gold-light" />
                  Recording…
                </>
              ) : (
                <>
                  Record return
                  <ArrowRightIcon size={14} className="g-btn-arrow text-gold-light" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
