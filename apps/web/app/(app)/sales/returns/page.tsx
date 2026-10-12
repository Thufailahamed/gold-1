"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { hasPermission, normalizeCode } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { CameraScanButton } from "@/components/camera-scan";
import { Page, Skeleton, StatusPill } from "@/components/ui";
import {
  AlertCircleIcon,
  ArrowLeftRightIcon,
  ArrowRightIcon,
  BanknoteIcon,
  CoinsIcon,
  FileTextIcon,
  PackageIcon,
  RotateCcwIcon,
  ScanBarcodeIcon,
  SearchIcon,
  XIcon,
} from "@/components/icons";

type Ret = {
  id: string;
  number: string;
  invoice_id: string;
  invoice_number: string;
  type: string;
  reason: string;
  refund_cents: number;
  credit_cents: number;
  exchange_sale_id: string | null;
  status: string;
  created_at: number;
};

const fmt = (c: number) => (c / 100).toLocaleString("en-US");
const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const time = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const TYPE_META: Record<string, { label: string; icon: ReactNode; cls: string }> = {
  PARTIAL: { label: "Partial", icon: <RotateCcwIcon size={11} />, cls: "bg-bone text-ink-3 ring-ink/[0.08]" },
  FULL: { label: "Full", icon: <PackageIcon size={11} />, cls: "bg-gold-pale text-gold-deep ring-gold-dark/20" },
  EXCHANGE: { label: "Exchange", icon: <ArrowLeftRightIcon size={11} />, cls: "bg-sky-50 text-sky-700 ring-sky-600/15" },
};

const cardShadow =
  "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]";

export default function ReturnsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [scan, setScan] = useState("");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCancel = hasPermission(me.data?.permissions ?? [], "sales:cancel");

  const list = useQuery({
    queryKey: ["returns", search],
    queryFn: () =>
      api<{ rows: Ret[]; total: number }>(
        `/api/v1/sales/returns?limit=30${search ? `&search=${encodeURIComponent(search)}` : ""}`
      ),
  });

  // The customer hands back a piece or a bill: either finds the sale.
  const find = useMutation({
    mutationFn: (code: string) =>
      api<{ invoiceId: string; number: string }>(`/api/v1/sales/lookup/${encodeURIComponent(code)}`),
    onSuccess: (d) => router.push(`/sales/invoices/${d.invoiceId}`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "No sale found"),
  });
  function lookup(raw: string) {
    const code = normalizeCode(raw);
    setScan("");
    if (code) find.mutate(code);
  }

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? rows.length;
  const refunded = rows.reduce((n, r) => n + r.refund_cents, 0);
  const credited = rows.reduce((n, r) => n + (r.credit_cents ?? 0), 0);
  const pendingExchanges = rows.filter((r) => r.type === "EXCHANGE" && !r.exchange_sale_id).length;

  const stats: { label: string; value: string; sub: string; icon: ReactNode; gold?: boolean; warn?: boolean }[] = [
    {
      label: "Returns",
      value: list.data ? total.toLocaleString("en-US") : "—",
      sub: `${rows.length} shown${search ? " · filtered" : ""}`,
      icon: <RotateCcwIcon size={16} />,
    },
    {
      label: "Refunded",
      value: list.data ? `LKR ${fmt(refunded)}` : "—",
      sub: "Money back, shown returns",
      icon: <BanknoteIcon size={16} />,
      gold: true,
    },
    {
      label: "Store credit",
      value: list.data ? `LKR ${fmt(credited)}` : "—",
      sub: "Held for the customer",
      icon: <CoinsIcon size={16} />,
    },
    {
      label: "Exchanges open",
      value: list.data ? String(pendingExchanges) : "—",
      sub: pendingExchanges ? "Awaiting a replacement sale" : "None waiting",
      icon: <ArrowLeftRightIcon size={16} />,
      warn: pendingExchanges > 0,
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

        <div className="relative px-5 py-6 sm:px-7 lg:px-8 lg:py-7">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
              <span className="size-1.5 animate-pulse-soft rounded-full bg-gold" />
              Sales
            </span>
            {!canCancel && me.data ? (
              <span className="rounded-full bg-paper/[0.06] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-paper/60 ring-1 ring-paper/10">
                View only
              </span>
            ) : null}
          </div>
          <h1 className="g-display mt-3.5 text-3xl text-paper sm:text-[2.6rem]">
            Returns, <span className="home-gold-text">handled cleanly.</span>
          </h1>
          <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-paper/60">
            Scan the returned piece or the bill to open its sale
            {canCancel ? ", then record the return there." : ". You have view-only access."}
          </p>

          {/* Scan console */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              lookup(scan);
            }}
            className="group mt-6 rounded-[20px] bg-gradient-to-b from-paper/[0.08] to-paper/[0.03] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 ring-gold/20 transition-shadow focus-within:ring-gold/50 focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_0_4px_rgba(205,168,83,0.12)]"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label htmlFor="return-scan" className="sr-only">
                Product tag, SKU or invoice number
              </label>
              <span className="relative flex-1">
                <span className="pointer-events-none absolute left-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
                  <ScanBarcodeIcon size={17} />
                </span>
                <input
                  id="return-scan"
                  autoFocus
                  placeholder="Scan a tag or bill, or type SINV-… and press Enter"
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-[3.25rem] w-full rounded-2xl bg-black/20 pl-14 pr-3 font-mono text-[15px] tracking-wide text-paper shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] placeholder:font-sans placeholder:text-sm placeholder:tracking-normal placeholder:text-paper/35 focus:bg-black/30 focus:outline-none"
                />
              </span>
              <div className="flex gap-2">
                <CameraScanButton onDetected={lookup} tone="dark" className="h-[3.25rem] rounded-2xl px-4 ring-1 ring-paper/10" />
                <button
                  type="submit"
                  disabled={find.isPending || !scan.trim()}
                  className="home-btn-gold h-[3.25rem] flex-1 px-6 text-sm disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
                >
                  {find.isPending ? (
                    <>
                      <span className="size-3.5 animate-spin rounded-full border-2 border-void/30 border-t-void" />
                      Finding…
                    </>
                  ) : (
                    <>
                      Find sale
                      <ArrowRightIcon size={14} />
                    </>
                  )}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pb-1 pt-2.5 text-[11px] text-paper/45">
              {[
                ["1", "Scan the piece or bill"],
                ["2", "Open its sale"],
                ["3", canCancel ? "Record the return" : "Review the sale"],
              ].map(([n, t], i) => (
                <span key={n} className="inline-flex items-center gap-1.5">
                  {i > 0 ? <ArrowRightIcon size={10} className="text-paper/25" /> : null}
                  <span className="g-metric flex size-4 items-center justify-center rounded-full bg-paper/10 text-[9px] text-gold-light">{n}</span>
                  {t}
                </span>
              ))}
            </div>
          </form>
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
                      ? "bg-amber-400/15 text-amber-200 ring-amber-300/25"
                      : "bg-gradient-to-b from-paper/[0.09] to-paper/[0.03] text-gold-light ring-paper/[0.09] group-hover:text-gold"
                )}
              >
                {s.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">{s.label}</span>
                {list.isLoading ? (
                  <Skeleton className="mt-1 h-6 w-20 bg-paper/10" />
                ) : (
                  <span
                    className={cn(
                      "g-metric mt-0.5 block truncate text-xl leading-tight",
                      s.gold ? "text-gold-light" : s.warn ? "text-amber-200" : "text-paper"
                    )}
                  >
                    {s.value}
                  </span>
                )}
                <span className="mt-1 block truncate text-[10px] text-paper/35">{s.sub}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="relative flex items-center gap-2 border-t border-paper/[0.08] px-5 py-3 text-xs text-paper/50 sm:px-7 lg:px-8">
          <span className="size-1.5 shrink-0 rounded-full bg-gold" />
          Refunds post to the customer ledger and reverse the gold movement.
        </div>
      </section>

      {/* Register */}
      <section className={cn("relative overflow-hidden rounded-[22px] bg-paper", cardShadow)}>
        <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
        <div className="flex flex-col gap-4 border-b border-ink/[0.06] px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)]">
              <RotateCcwIcon size={17} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-sans text-[15px] font-semibold tracking-normal text-ink">Return register</h2>
              <p className="truncate text-xs text-ink-4">Refunds and exchanges, newest first</p>
            </div>
            <span className="g-metric ml-1 hidden shrink-0 items-center gap-1.5 rounded-full bg-bone px-3 py-1 text-[11px] text-ink-3 ring-1 ring-ink/[0.06] sm:inline-flex">
              <span className="font-semibold text-ink">{total.toLocaleString("en-US")}</span> on file
              {list.isFetching && !list.isLoading ? (
                <span className="ml-0.5 size-3 animate-spin rounded-full border-2 border-gold/30 border-t-gold" aria-label="Refreshing" />
              ) : null}
            </span>
          </div>
          <label className="group relative block w-full lg:max-w-sm">
            <span className="sr-only">Filter returns</span>
            <SearchIcon size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-5 transition-colors group-focus-within:text-gold-dark" />
            <input
              id="return-search"
              type="search"
              autoComplete="off"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by return or invoice number…"
              className="h-11 w-full rounded-xl bg-bone/60 pl-10 pr-9 text-sm text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.08)] transition-all duration-200 placeholder:text-ink-5 hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)] focus:bg-paper focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)] [&::-webkit-search-cancel-button]:hidden"
            />
            {search ? (
              <button
                type="button"
                aria-label="Clear filter"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-ink-4 hover:bg-ink/5 hover:text-ink"
              >
                <XIcon size={13} />
              </button>
            ) : null}
          </label>
        </div>

        {list.isLoading ? (
          <div className="space-y-2.5 p-5 sm:p-6">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[4.5rem] rounded-2xl" />
            ))}
          </div>
        ) : list.isError ? (
          <Empty
            icon={<AlertCircleIcon size={24} />}
            title="Couldn't load returns"
            body="Check the API connection, then refresh the page."
            action={
              <button type="button" onClick={() => void list.refetch()} className="g-btn g-btn-secondary h-10 rounded-xl px-4 text-sm">
                Retry
              </button>
            }
          />
        ) : rows.length === 0 ? (
          <Empty
            icon={<RotateCcwIcon size={24} />}
            title={search ? "No matching returns" : "No returns recorded"}
            body={search ? "Try another return or invoice number." : "Returns recorded against an invoice will appear here."}
            action={
              search ? (
                <button type="button" onClick={() => setSearch("")} className="g-btn g-btn-secondary h-10 rounded-xl px-4 text-sm">
                  Clear filter
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => document.getElementById("return-scan")?.focus()}
                  className="g-btn g-btn-primary h-10 rounded-xl px-4 text-sm"
                >
                  <ScanBarcodeIcon size={14} /> Scan a piece
                </button>
              )
            }
          />
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {rows.map((r, i) => {
              const meta = TYPE_META[r.type] ?? {
                label: r.type.charAt(0) + r.type.slice(1).toLowerCase().replace(/_/g, " "),
                icon: <RotateCcwIcon size={11} />,
                cls: "bg-bone text-ink-3 ring-ink/[0.08]",
              };
              const waiting = r.type === "EXCHANGE" && !r.exchange_sale_id;
              return (
                <li
                  key={r.id}
                  className="group relative grid animate-fade-in items-center gap-x-5 gap-y-3 px-5 py-4 transition-colors hover:bg-gold-pale/30 sm:px-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_auto]"
                  style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
                >
                  {waiting ? <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-amber-400" /> : null}

                  {/* Return + invoice */}
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)]">
                      {r.type === "EXCHANGE" ? <ArrowLeftRightIcon size={17} /> : <RotateCcwIcon size={17} />}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="g-metric text-sm font-semibold text-ink">{r.number}</span>
                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ring-1", meta.cls)}>
                          {meta.icon}
                          {meta.label}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-4">
                        <Link
                          href={`/sales/invoices/${r.invoice_id}`}
                          className="g-metric inline-flex items-center gap-1 rounded-md bg-bone px-1.5 py-0.5 text-ink-3 ring-1 ring-ink/[0.06] transition-colors hover:bg-void hover:text-gold-light hover:ring-transparent"
                        >
                          <FileTextIcon size={10} />
                          {r.invoice_number}
                        </Link>
                        <span>
                          {day(r.created_at)} · {time(r.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Reason */}
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-[13px] leading-snug text-ink-3" title={r.reason}>
                      <span className="mr-1 text-gold-dark">“</span>
                      {r.reason}
                      <span className="ml-0.5 text-gold-dark">”</span>
                    </p>
                    {r.type === "EXCHANGE" ? (
                      r.exchange_sale_id ? (
                        <Link
                          href={`/sales/invoices/${r.exchange_sale_id}`}
                          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 hover:underline"
                        >
                          <ArrowLeftRightIcon size={11} /> Replacement sale
                        </Link>
                      ) : (
                        <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-600/15">
                          <AlertCircleIcon size={10} /> No replacement yet
                        </span>
                      )
                    ) : null}
                  </div>

                  {/* Money + status */}
                  <div className="flex items-center justify-between gap-4 md:justify-end">
                    <div className="text-right">
                      <div className="g-metric text-[15px] text-ink">
                        <span className="mr-1 text-[10px] text-ink-4">LKR</span>
                        {fmt(r.refund_cents + (r.credit_cents ?? 0))}
                      </div>
                      <div className="mt-0.5 text-[11px] text-ink-4">
                        {r.credit_cents && r.refund_cents
                          ? `${fmt(r.refund_cents)} refund · ${fmt(r.credit_cents)} credit`
                          : r.credit_cents
                            ? "As store credit"
                            : "Refunded"}
                      </div>
                    </div>
                    <StatusPill status={r.status} />
                    <Link
                      href={`/sales/invoices/${r.invoice_id}`}
                      aria-label={`Open ${r.invoice_number}`}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)] transition-all group-hover:bg-void group-hover:text-gold-light group-hover:shadow-none"
                    >
                      <ArrowRightIcon size={13} />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Page>
  );
}

function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="p-5 sm:p-6">
      <div className="relative flex flex-col items-center overflow-hidden rounded-[22px] border border-dashed border-ink/15 bg-gradient-to-b from-bone/70 to-paper px-6 py-14 text-center">
        <div className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-gold/10 blur-[80px]" aria-hidden />
        <span className="relative mb-5 flex size-16 items-center justify-center rounded-2xl bg-void text-gold-light shadow-4">
          <span className="absolute inset-0 animate-pulse-soft rounded-2xl ring-4 ring-gold/20" aria-hidden />
          {icon}
        </span>
        <h3 className="relative font-sans text-lg font-semibold tracking-normal text-ink">{title}</h3>
        <p className="relative mt-1.5 max-w-sm text-sm text-ink-4">{body}</p>
        {action ? <div className="relative mt-6">{action}</div> : null}
      </div>
    </div>
  );
}
