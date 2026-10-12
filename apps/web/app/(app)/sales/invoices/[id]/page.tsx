"use client";

import { use, useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { extractScanCode, hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, StatusPill, Skeleton, Callout } from "@/components/ui";
import { Select } from "@/components/select";
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
  StoreIcon,
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
  payments: { id: string; amount_cents: number; method: string; created_at: number; account_code: string | null; bank_account_name: string | null }[];
  receipts: { id: string; number: string; receipt_date: string; method: string; status: string; amount_cents: number }[];
  journal: { id: string; account_code: string; account_name: string | null; debit_cents: number; credit_cents: number; memo: string | null; entry_no: string | null }[];
  returns: { id: string; number: string; type: string; refund_cents: number; credit_cents: number; exchange_sale_id: string | null; status: string }[];
  returnedItemIds: string[];
  exchangeOf: { id: string; number: string; invoice_id: string; invoice_number: string } | null;
};

const STATUS_LABEL: Record<string, string> = {
  PAID: "Paid",
  PARTIAL: "Part paid",
  UNPAID: "Unpaid · on credit",
  VOID: "Void",
};
const STATUS_TONE: Record<string, string> = {
  PAID: "bg-emerald-400/15 text-emerald-200 ring-emerald-300/30",
  PARTIAL: "bg-amber-400/15 text-amber-200 ring-amber-300/30",
  UNPAID: "bg-rose-400/15 text-rose-200 ring-rose-300/30",
  VOID: "bg-paper/10 text-paper/60 ring-paper/20",
};
const STATUS_DOT: Record<string, string> = {
  PAID: "bg-emerald-400",
  PARTIAL: "bg-amber-400",
  UNPAID: "bg-rose-400",
  VOID: "bg-paper/40",
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

const cardShadow =
  "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

const inputCls =
  "h-11 w-full rounded-xl bg-paper px-3.5 text-sm text-ink placeholder:text-ink-5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12),0_1px_2px_rgba(16,32,27,0.04)] transition-shadow hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.26)] focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)]";

/* ------------------------------------------------------------------ shells */

function Card({
  title,
  description,
  icon,
  actions,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  icon: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("relative overflow-hidden rounded-[22px] bg-paper", cardShadow, className)}>
      <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
      <div className="flex items-center justify-between gap-3 border-b border-ink/[0.06] px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)]">
            {icon}
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-sans text-[15px] font-semibold tracking-normal text-ink">{title}</h2>
            {description ? <p className="truncate text-xs text-ink-4">{description}</p> : null}
          </div>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="m-5 flex flex-col items-center rounded-2xl border border-dashed border-ink/15 bg-bone/40 px-6 py-8 text-center sm:m-6">
      <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-paper text-ink-5 ring-1 ring-ink/[0.08]">
        <FileTextIcon size={17} />
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-[16rem] text-xs text-ink-4">{body}</p>
    </div>
  );
}

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
      <Page className="space-y-6">
        <Skeleton className="h-64 rounded-[28px]" />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-80 rounded-[22px]" />
          <Skeleton className="h-80 rounded-[22px]" />
        </div>
      </Page>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Page>
        <div className="relative flex flex-col items-center overflow-hidden rounded-[28px] border border-dashed border-ink/15 bg-paper/70 px-6 py-16 text-center">
          <span className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-void text-gold-light shadow-4">
            <AlertCircleIcon size={26} />
          </span>
          <h2 className="g-display text-2xl text-ink">Sale not found</h2>
          <p className="mt-2 max-w-sm text-sm text-ink-4">This invoice does not exist or could not be loaded.</p>
          <button
            type="button"
            onClick={() => router.push("/sales/invoices")}
            className="g-btn g-btn-primary mt-6 h-10 rounded-xl px-4 text-sm"
          >
            <ArrowLeftIcon size={14} /> Back to invoices
          </button>
        </div>
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
  const netG = items.reduce((s, it) => s + it.net_mg, 0) / 1000;
  const debit = journal.reduce((s, j) => s + j.debit_cents, 0);
  const credit = journal.reduce((s, j) => s + j.credit_cents, 0);
  const balanced = journal.length > 0 && debit === credit;
  const created = new Date(invoice.created_at);

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

  const stats: { label: string; value: string; sub: string; icon: ReactNode; gold?: boolean; bar?: number; warn?: boolean }[] = [
    {
      label: "Total",
      value: `LKR ${fmt(invoice.total_cents)}`,
      sub: invoice.discount_cents ? `After LKR ${fmt(invoice.discount_cents)} discount` : "No discount",
      icon: <CreditCardIcon size={16} />,
      gold: true,
    },
    {
      label: "Paid",
      value: `LKR ${fmt(invoice.paid_cents)}`,
      sub: `${Math.round(paidShare * 100)}% settled`,
      icon: <BanknoteIcon size={16} />,
      bar: paidShare,
    },
    {
      label: "Balance due",
      value: `LKR ${fmt(balance)}`,
      sub: balance > 0 ? "On the customer ledger" : "Settled in full",
      icon: balance > 0 ? <AlertCircleIcon size={16} /> : <CheckCircleIcon size={16} />,
      warn: balance > 0,
    },
    {
      label: "Items",
      value: String(items.length),
      sub: `${netG.toLocaleString("en-US", { maximumFractionDigits: 3 })} g net${returned.size ? ` · ${returned.size} returned` : ""}`,
      icon: <PackageIcon size={16} />,
    },
  ];

  return (
    <Page className="space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[28px] bg-void text-paper shadow-5 ring-1 ring-gold/10">
        <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div className="home-drift pointer-events-none absolute -right-24 -top-32 size-[22rem] rounded-full bg-gold/20 blur-[120px]" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 -left-24 size-80 rounded-full bg-emerald-400/10 blur-[110px]" aria-hidden />
        <div className="home-noise pointer-events-none absolute inset-0" aria-hidden />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" aria-hidden />

        <div className="relative flex flex-col gap-6 px-5 py-6 sm:px-7 lg:flex-row lg:items-end lg:justify-between lg:px-8 lg:py-7">
          <div className="min-w-0">
            <Link
              href="/sales/invoices"
              className="group inline-flex items-center gap-1.5 text-xs font-medium text-paper/55 transition-colors hover:text-gold-light"
            >
              <ArrowLeftIcon size={13} className="transition-transform group-hover:-translate-x-0.5" />
              Sales invoices
            </Link>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
                <FileTextIcon size={11} />
                Sales invoice
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ring-1",
                  STATUS_TONE[invoice.status] ?? STATUS_TONE.VOID
                )}
              >
                <span className={cn("size-1.5 rounded-full", STATUS_DOT[invoice.status] ?? "bg-paper/40")} />
                {STATUS_LABEL[invoice.status] ?? invoice.status}
              </span>
              {exchangeOf ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-400/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-200 ring-1 ring-sky-300/25">
                  <ArrowLeftRightIcon size={11} /> Exchange
                </span>
              ) : null}
            </div>
            <h1 className={cn("g-display mt-3.5 text-4xl text-paper sm:text-5xl", invoice.status === "VOID" && "line-through decoration-paper/40")}>
              {invoice.number}
            </h1>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {invoice.customer_id ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-paper/[0.06] py-1 pl-1 pr-3 text-sm text-paper ring-1 ring-paper/10">
                  <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-b from-gold-light to-gold text-[10px] font-bold text-void">
                    {initials(invoice.customer_name ?? "C")}
                  </span>
                  <span className="max-w-[14rem] truncate font-medium">{invoice.customer_name ?? "Customer"}</span>
                  {invoice.customer_code ? <span className="g-metric text-[11px] text-paper/45">{invoice.customer_code}</span> : null}
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-full bg-paper/[0.06] py-1 pl-1 pr-3 text-sm text-paper/80 ring-1 ring-paper/10">
                  <span className="flex size-7 items-center justify-center rounded-full bg-paper/10 text-[10px] font-bold text-paper/60">W</span>
                  Walk-in
                </span>
              )}
              {[
                { icon: <FileTextIcon size={12} />, text: `${created.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · ${created.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` },
                invoice.salesperson_name ? { icon: <UsersIcon size={12} />, text: invoice.salesperson_name } : null,
                invoice.branch_name ? { icon: <StoreIcon size={12} />, text: invoice.branch_name } : null,
              ]
                .filter(Boolean)
                .map((m) => (
                  <span key={m!.text} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs text-paper/60 ring-1 ring-paper/10">
                    <span className="text-gold-light">{m!.icon}</span>
                    {m!.text}
                  </span>
                ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5 lg:justify-end">
            <Link href={`/sales/invoices/${id}/print`} className="home-btn-ghost h-11 px-4 text-sm">
              <PrinterIcon size={15} /> A4 invoice
            </Link>
            <Link href={`/sales/invoices/${id}/print?format=receipt`} className="home-btn-ghost h-11 px-4 text-sm">
              <PrinterIcon size={15} /> Receipt
            </Link>
            {balance > 0 && canCollect && invoice.customer_id ? (
              <Link href={`/accounts/receivables?collect=${encodeURIComponent(invoice.customer_id)}`} className="home-btn-gold h-11 px-5 text-sm">
                <BanknoteIcon size={15} /> Collect payment
              </Link>
            ) : null}
            {canCancel && returnable.length > 0 ? (
              <button type="button" onClick={() => setRetOpen(true)} className="home-btn-gold h-11 px-5 text-sm">
                <RotateCcwIcon size={15} /> Record return
              </button>
            ) : null}
          </div>
        </div>

        <div className="relative grid grid-cols-2 gap-px border-t border-paper/[0.08] bg-paper/[0.06] lg:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.label}
              className={cn(
                "group flex min-w-0 items-center gap-3.5 bg-void/95 px-4 py-4 transition-colors hover:bg-void/80 sm:px-6",
                s.gold && "bg-gradient-to-br from-void/95 to-[#0d3a2c]/95"
              )}
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 transition-colors",
                  s.gold
                    ? "bg-gradient-to-b from-gold-light to-gold text-void ring-gold/40"
                    : s.warn
                      ? "bg-rose-400/15 text-rose-200 ring-rose-300/25"
                      : "bg-gradient-to-b from-paper/[0.09] to-paper/[0.03] text-gold-light ring-paper/[0.09] group-hover:text-gold"
                )}
              >
                {s.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">{s.label}</span>
                <span
                  className={cn(
                    "g-metric mt-0.5 block truncate text-xl leading-tight",
                    s.gold ? "text-gold-light" : s.warn ? "text-rose-200" : "text-paper"
                  )}
                >
                  {s.value}
                </span>
                {s.bar !== undefined ? (
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-paper/10">
                    <span
                      className="block h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-[width] duration-700 ease-brand"
                      style={{ width: `${Math.round(s.bar * 100)}%` }}
                    />
                  </span>
                ) : null}
                <span className="mt-1 block truncate text-[10px] text-paper/35">{s.sub}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {exchangeOf ? (
        <div className="flex items-start gap-3.5 rounded-[22px] bg-gradient-to-r from-sky-50 to-paper p-4 ring-1 ring-sky-600/15 sm:p-5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700 ring-1 ring-sky-600/15">
            <ArrowLeftRightIcon size={17} />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-ink">Exchange for return {exchangeOf.number}</p>
            <p className="mt-0.5 text-ink-3">
              Replacement for pieces returned from{" "}
              <Link href={`/sales/invoices/${exchangeOf.invoice_id}`} className="font-medium text-gold-deep underline decoration-gold/40 underline-offset-4 hover:decoration-gold">
                {exchangeOf.invoice_number}
              </Link>
              .
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]">
        {/* Left column */}
        <div className="min-w-0 space-y-5">
          <Card
            title="Items sold"
            icon={<PackageIcon size={17} />}
            description={`${items.length} piece${items.length === 1 ? "" : "s"} · every line linked to a physical piece`}
          >
            {items.length === 0 ? (
              <Empty title="No items" body="This invoice has no line items." />
            ) : (
              <ul className="divide-y divide-ink/[0.06]">
                {items.map((it) => {
                  const isReturned = returned.has(it.id);
                  return (
                    <li key={it.id} className={cn("group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-gold-pale/30 sm:px-6", isReturned && "opacity-60")}>
                      <span className="g-metric flex h-12 min-w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold px-2 text-sm font-bold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_8px_18px_-10px_rgba(205,168,83,0.7)]">
                        {it.karat}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/products/${it.product_id}`}
                            className={cn("truncate text-sm font-semibold text-ink transition-colors hover:text-gold-deep", isReturned && "line-through")}
                          >
                            {it.name}
                          </Link>
                          {isReturned ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-bone px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-4 ring-1 ring-ink/[0.08]">
                              <RotateCcwIcon size={10} /> Returned
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-4">
                          <Link
                            href={`/products/${it.product_id}`}
                            className="inline-flex items-center gap-1 rounded-md bg-bone px-1.5 py-0.5 font-mono font-medium text-ink-3 ring-1 ring-ink/[0.06] transition-colors hover:bg-void hover:text-gold-light hover:ring-transparent"
                          >
                            <ScanBarcodeIcon size={10} />
                            {it.barcode}
                          </Link>
                          <span className="g-metric rounded-md bg-bone px-1.5 py-0.5 ring-1 ring-ink/[0.06]">
                            {(it.net_mg / 1000).toLocaleString("en-US")} g net
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="g-metric text-[15px] text-ink">
                          <span className="mr-1 text-[10px] text-ink-4">LKR</span>
                          {fmt(it.price_cents)}
                        </div>
                        {it.discount_cents ? (
                          <div className="g-metric mt-0.5 text-[11px] text-emerald-700">− {fmt(it.discount_cents)} off</div>
                        ) : (
                          <div className="mt-0.5 text-[11px] text-ink-5">No discount</div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {returns.length > 0 ? (
            <Card title="Returns" icon={<RotateCcwIcon size={17} />} description={`${returns.length} recorded`}>
              <ul className="divide-y divide-ink/[0.06]">
                {returns.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 sm:px-6">
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-bone text-ink-3 ring-1 ring-ink/[0.06]">
                        {r.type === "EXCHANGE" ? <ArrowLeftRightIcon size={15} /> : <RotateCcwIcon size={15} />}
                      </span>
                      <span className="min-w-0">
                        <span className="g-metric block text-sm font-semibold text-ink">{r.number}</span>
                        <span className="block text-[11px] capitalize text-ink-4">{r.type.toLowerCase()} return</span>
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2.5">
                      {r.type === "EXCHANGE" ? (
                        r.exchange_sale_id ? (
                          <Link
                            href={`/sales/invoices/${r.exchange_sale_id}`}
                            className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 ring-1 ring-sky-600/15 hover:bg-sky-100"
                          >
                            <ArrowLeftRightIcon size={12} /> Replacement sale
                          </Link>
                        ) : (
                          <Link href={exchangeHref(r)} className="g-btn g-btn-primary h-8 rounded-lg px-3 text-xs">
                            <ArrowLeftRightIcon size={12} /> Start replacement sale
                          </Link>
                        )
                      ) : null}
                      <span className="g-metric text-sm text-ink">
                        <span className="mr-1 text-[10px] text-ink-4">LKR</span>
                        {fmt(r.refund_cents + (r.credit_cents ?? 0))}
                      </span>
                      {r.credit_cents ? (
                        <span className="rounded-full bg-gold-pale px-2 py-0.5 text-[10px] font-semibold text-gold-deep ring-1 ring-gold-dark/15">
                          Store credit
                        </span>
                      ) : null}
                      <StatusPill status={r.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card
            title="Ledger postings"
            icon={<BookOpenIcon size={17} />}
            description={journal.length > 0 ? `${journal.length} line${journal.length === 1 ? "" : "s"}` : "Double-entry journal"}
            actions={
              journal.length > 0 ? (
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ring-1",
                    balanced ? "bg-emerald-50 text-emerald-700 ring-emerald-600/15" : "bg-rose-50 text-rose-700 ring-rose-600/15"
                  )}
                >
                  {balanced ? <CheckCircleIcon size={11} /> : <AlertCircleIcon size={11} />}
                  {balanced ? "Balanced" : "Out of balance"}
                </span>
              ) : null
            }
          >
            {journal.length === 0 ? (
              <Empty title="No postings" body="Journal entries appear after posting." />
            ) : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-bone/50 text-left text-[10.5px] uppercase tracking-[0.12em] text-ink-4">
                      <th className="px-5 py-2.5 font-semibold sm:px-6">Account</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Debit</th>
                      <th className="px-5 py-2.5 text-right font-semibold sm:px-6">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journal.map((j) => (
                      <tr key={j.id} className="border-t border-ink/[0.06] transition-colors hover:bg-gold-pale/30">
                        <td className="px-5 py-2.5 sm:px-6">
                          <span className="flex items-center gap-2.5">
                            <span className="g-metric rounded-md bg-bone px-1.5 py-0.5 text-[11px] text-ink-3 ring-1 ring-ink/[0.06]">{j.account_code}</span>
                            <span className="truncate text-ink-2">{j.account_name ?? ""}</span>
                            {j.memo && !j.memo.startsWith("Sale ") ? <span className="truncate text-xs text-ink-4">· {j.memo}</span> : null}
                          </span>
                        </td>
                        <td className="g-metric px-3 py-2.5 text-right text-ink">{j.debit_cents ? fmt(j.debit_cents) : <span className="text-ink-6">—</span>}</td>
                        <td className="g-metric px-5 py-2.5 text-right text-ink sm:px-6">{j.credit_cents ? fmt(j.credit_cents) : <span className="text-ink-6">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-ink/10 bg-bone/50 text-xs font-semibold">
                      <td className="px-5 py-2.5 uppercase tracking-[0.12em] text-ink-4 sm:px-6">Totals</td>
                      <td className="g-metric px-3 py-2.5 text-right text-ink">{fmt(debit)}</td>
                      <td className="g-metric px-5 py-2.5 text-right text-ink sm:px-6">{fmt(credit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Right column */}
        <div className="min-w-0 space-y-5 lg:sticky lg:top-24">
          {/* Totals receipt */}
          <section className="relative overflow-hidden rounded-[22px] bg-void p-5 text-paper shadow-5 ring-1 ring-gold/10 sm:p-6">
            <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-40" aria-hidden />
            <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-gold/20 blur-[80px]" aria-hidden />
            <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" aria-hidden />
            <div className="relative flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold-deep text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
                <CreditCardIcon size={17} />
              </span>
              <div>
                <h2 className="font-sans text-[15px] font-semibold tracking-normal text-paper">Summary</h2>
                <p className="text-xs text-paper/45">All amounts in LKR</p>
              </div>
            </div>
            <dl className="relative mt-5 space-y-2.5 text-sm">
              {[
                ["Subtotal", fmt(invoice.subtotal_cents), ""],
                ...(invoice.discount_cents ? [["Discount", `− ${fmt(invoice.discount_cents)}`, "text-emerald-300"]] : []),
                ...(invoice.tax_cents ? [[`Tax ${(invoice.tax_rate_bp ?? 0) / 100}%`, fmt(invoice.tax_cents), ""]] : []),
              ].map(([k, v, c]) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <dt className="text-paper/55">{k}</dt>
                  <dd className={cn("g-metric text-paper", c)}>{v}</dd>
                </div>
              ))}
              <div className="!mt-4 flex items-end justify-between gap-3 border-t border-dashed border-paper/15 pt-4">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/45">Total</dt>
                <dd className="g-metric text-2xl leading-none text-gold-light">{fmt(invoice.total_cents)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 pt-1">
                <dt className="text-paper/55">Paid</dt>
                <dd className="g-metric text-paper">{fmt(invoice.paid_cents)}</dd>
              </div>
              {invoice.tendered_cents ? (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-paper/55">Tendered</dt>
                  <dd className="g-metric text-paper/80">{fmt(invoice.tendered_cents)}</dd>
                </div>
              ) : null}
            </dl>
            <div
              className={cn(
                "relative mt-4 flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 ring-1",
                balance > 0 ? "bg-rose-400/10 ring-rose-300/25" : "bg-emerald-400/10 ring-emerald-300/25"
              )}
            >
              <span className={cn("flex items-center gap-2 text-xs font-semibold", balance > 0 ? "text-rose-200" : "text-emerald-200")}>
                {balance > 0 ? <AlertCircleIcon size={14} /> : <CheckCircleIcon size={14} />}
                {balance > 0 ? "Balance due" : "Settled in full"}
              </span>
              <span className={cn("g-metric text-base", balance > 0 ? "text-rose-100" : "text-emerald-100")}>{fmt(balance)}</span>
            </div>
          </section>

          {/* Payments */}
          <Card
            title="Payments"
            icon={<BanknoteIcon size={17} />}
            description={creditCents > 0 ? `${fmt(creditCents)} LKR on the customer's account` : `${payments.length + receipts.length} recorded`}
          >
            {payments.length === 0 && receipts.length === 0 && invoice.store_credit_cents <= 0 ? (
              <Empty title="No payments" body="No payments recorded on this invoice." />
            ) : (
              <ol className="relative space-y-3 px-5 py-5 sm:px-6">
                <span aria-hidden className="absolute bottom-7 left-[2.35rem] top-7 w-px bg-ink/[0.08] sm:left-[2.6rem]" />
                {payments.map((p) => (
                  <li key={p.id} className="relative flex items-start gap-3">
                    <span
                      className={cn(
                        "relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-paper",
                        p.method === "credit" ? "bg-amber-100 text-amber-700" : "bg-void text-gold-light"
                      )}
                    >
                      {p.method === "credit" ? <UsersIcon size={13} /> : p.method === "bank" || p.method === "card" ? <CreditCardIcon size={13} /> : <BanknoteIcon size={13} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium capitalize text-ink">
                          {p.method === "credit" ? "On account" : p.method}
                        </span>
                        <span className="g-metric shrink-0 text-sm text-ink">{fmt(p.amount_cents)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-ink-4">
                        {p.bank_account_name ? `${p.bank_account_name} · ` : ""}
                        {p.account_code ? `${p.account_code} · ` : ""}
                        {new Date(p.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </span>
                  </li>
                ))}
                {invoice.store_credit_cents > 0 ? (
                  <li className="relative flex items-start gap-3">
                    <span className="relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full bg-gold-pale text-gold-deep ring-4 ring-paper">
                      <CoinsIcon size={13} />
                    </span>
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink">Store credit</span>
                      <span className="g-metric text-sm text-ink">{fmt(invoice.store_credit_cents)}</span>
                    </span>
                  </li>
                ) : null}
                {receipts.map((r) => (
                  <li key={r.id} className={cn("relative flex items-start gap-3", r.status === "VOID" && "opacity-50")}>
                    <span className="relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-4 ring-paper">
                      <FileTextIcon size={13} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={cn("g-metric truncate text-sm font-medium text-ink", r.status === "VOID" && "line-through")}>
                          Receipt {r.number}
                        </span>
                        <span className={cn("g-metric shrink-0 text-sm text-ink", r.status === "VOID" && "line-through")}>{fmt(r.amount_cents)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] capitalize text-ink-4">
                        {r.receipt_date} · {r.method}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {invoice.notes ? (
              <div className="mx-5 mb-5 flex items-start gap-2 rounded-xl bg-gold-pale/60 px-3.5 py-2.5 text-sm text-ink-2 ring-1 ring-gold-dark/15 sm:mx-6">
                <FileTextIcon size={14} className="mt-0.5 shrink-0 text-gold-deep" />
                <span>{invoice.notes}</span>
              </div>
            ) : null}
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
