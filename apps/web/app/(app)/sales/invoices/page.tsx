"use client";

import { useEffect, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page } from "@/components/ui";
import { AlertCircleIcon, ArrowLeftIcon, ArrowRightIcon, CreditCardIcon, PrinterIcon, ScanBarcodeIcon, SearchIcon, XIcon } from "@/components/icons";
import {
  Card,
  CardHead,
  Empty,
  FilterPills,
  GoldHero,
  HeroBadge,
  INVOICE_META,
  INVOICE_STATUSES,
  InvChip,
  MiniStats,
  RowsSkeleton,
  Settlement,
  ago,
  heroGhost,
  heroGold,
  inputCls,
  lkr,
  stamp,
  th,
  thead,
  tr,
} from "../kit";

type Invoice = {
  id: string;
  number: string;
  customer_name: string | null;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  status: string;
  created_at: number;
};
type Paged = { rows: Invoice[]; total: number };

const STATUSES: readonly string[] = INVOICE_STATUSES;
const PAGE_SIZE = 20;

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? "";
}

export default function SalesInvoicesPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [fStatus, setFStatus] = useState("");
  // Scope the list to the shop the user is working in (the branch switcher's
  // choice) so another shop's invoices never appear here. Switch shops from
  // the branch switcher to see their invoices instead.
  const [branchId] = useState(branchDefault);

  // The sales dashboard links here with ?status= to open a settlement state.
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("status");
    if (s && STATUSES.includes(s)) setFStatus(s);
  }, []);

  const list = useQuery({
    queryKey: ["sales", search, page, fStatus, branchId],
    queryFn: () =>
      api<Paged>(`/api/v1/sales/invoices?search=${encodeURIComponent(search)}&page=${page}&limit=${PAGE_SIZE}${fStatus ? `&status=${fStatus}` : ""}${branchId ? `&branchId=${branchId}` : ""}`),
  });

  // Same cache keys as the sales overview: the credit states carry rows so the open balance can be summed.
  const stateQueries = useQueries({
    queries: INVOICE_STATUSES.map((s) => {
      const credit = s === "PARTIAL" || s === "UNPAID";
      return {
        retry: false,
        staleTime: 30_000,
        queryKey: ["sales-dash", "state", s, branchId],
        queryFn: () => api<Paged>(`/api/v1/sales/invoices?status=${s}&limit=${credit ? 100 : 1}${branchId ? `&branchId=${branchId}` : ""}`),
      };
    }),
  });
  const counts = stateQueries.map((q) => q.data?.total);
  const statesLoading = stateQueries.some((q) => q.isLoading);
  const allCount = counts.reduce<number>((a, c) => a + (c ?? 0), 0);
  const creditRows = stateQueries.slice(1, 3).flatMap((q) => q.data?.rows ?? []);
  const creditCount = (counts[1] ?? 0) + (counts[2] ?? 0);
  const owed = creditRows.reduce((s, r) => s + Math.max(0, r.total_cents - r.paid_cents), 0);

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const live = rows.filter((r) => r.status !== "VOID");
  const value = live.reduce((n, r) => n + r.total_cents, 0);
  const due = live.reduce((n, r) => n + Math.max(0, r.balance_cents ?? 0), 0);
  const collected = Math.max(0, value - due);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = rows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;

  const setFilter = (k: string) => {
    setFStatus(k);
    setPage(1);
  };

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={CreditCardIcon}
        title="Sales invoices,"
        accent="piece by piece"
        back={{ href: "/sales", label: "Sales" }}
        badge={statesLoading ? null : creditCount ? <HeroBadge tone="warn">{creditCount} with a balance</HeroBadge> : <HeroBadge tone="good">All settled</HeroBadge>}
        sub="Completed counter sales, every line linked to a physical piece. Credit balances sit on the customer ledger until settled."
        actions={
          <>
            <Link href="/pos" className={heroGold}>
              <ScanBarcodeIcon size={13} /> New sale
            </Link>
            <Link href="/sales/returns" className={heroGhost}>
              Returns
            </Link>
          </>
        }
        stats={[
          { label: "On file", value: statesLoading ? undefined : allCount, loading: statesLoading, sub: "All statuses" },
          ...INVOICE_STATUSES.map((s, i) => ({
            label: INVOICE_META[s]!.label,
            value: counts[i],
            loading: statesLoading,
            tone: (s === "PAID" ? "good" : s === "UNPAID" && counts[i] ? "warn" : undefined) as "good" | "warn" | undefined,
            sub: INVOICE_META[s]!.hint,
          })),
          {
            label: "Owed",
            value: statesLoading ? undefined : owed,
            format: lkr,
            unit: "LKR",
            accent: true,
            loading: statesLoading,
            sub: creditCount ? `${creditCount} open invoice${creditCount === 1 ? "" : "s"}` : "Nothing owed",
          },
        ]}
      />

      <Card>
        <CardHead
          icon={CreditCardIcon}
          title="Invoices"
          sub={list.data ? `${total.toLocaleString("en-US")} ${fStatus ? INVOICE_META[fStatus]?.label.toLowerCase() : ""} · newest first`.replace(/\s+/g, " ") : "Newest first"}
          action={
            <label className="relative">
              <span className="sr-only">Search invoices</span>
              <SearchIcon size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-5" />
              <input
                id="invoice-search"
                type="search"
                autoComplete="off"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by number…"
                className={cn(inputCls, "w-56 pl-7 pr-7 [&::-webkit-search-cancel-button]:hidden")}
              />
              {search ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setSearch("");
                    setPage(1);
                  }}
                  className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-ink-4 hover:bg-ink/5 hover:text-ink"
                >
                  <XIcon size={11} />
                </button>
              ) : null}
            </label>
          }
        />
        <div className="-mx-px overflow-x-auto border-b border-ink/[0.06] px-4 py-2 scrollbar-thin">
          <FilterPills
            value={fStatus}
            onChange={setFilter}
            items={[
              { key: "", label: "All", count: statesLoading ? undefined : allCount },
              ...INVOICE_STATUSES.map((s, i) => ({ key: s as string, label: INVOICE_META[s]!.label, dot: INVOICE_META[s]!.dot, count: counts[i] })),
            ]}
          />
        </div>
        {list.data && rows.length > 0 ? (
          <MiniStats
            items={[
              { k: "Page value", v: `${lkr(value)} LKR` },
              { k: "Collected", v: `${lkr(collected)} LKR`, tone: "text-emerald-700" },
              { k: "Due", v: `${lkr(due)} LKR`, tone: due > 0 ? "text-amber-700" : "text-ink" },
              { k: "Settled share", v: value > 0 ? `${Math.round((collected / value) * 100)}%` : "—" },
            ]}
          />
        ) : null}

        {list.isLoading ? (
          <RowsSkeleton rows={8} />
        ) : list.isError ? (
          <Empty
            icon={AlertCircleIcon}
            title="Couldn't load invoices"
            desc="Check the API connection, then retry."
            action={
              <button type="button" onClick={() => void list.refetch()} className="g-btn g-btn-secondary h-8 rounded-lg px-3 text-[12px]">
                Retry
              </button>
            }
          />
        ) : rows.length === 0 ? (
          <Empty
            icon={CreditCardIcon}
            title={search || fStatus ? "No matching invoices" : "No invoices yet"}
            desc={search || fStatus ? "Try another number or clear the status filter." : "Counter sales appear here once posted from the POS."}
            action={
              search || fStatus ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setFilter("");
                  }}
                  className="g-btn g-btn-secondary h-8 rounded-lg px-3 text-[12px]"
                >
                  Clear filters
                </button>
              ) : (
                <Link href="/pos" className="g-btn g-btn-primary h-8 rounded-lg px-3 text-[12px]">
                  <ScanBarcodeIcon size={12} /> Open POS
                </Link>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[760px] text-[12.5px]">
              <thead className={thead}>
                <tr>
                  <th className={cn(th, "pl-4")}>Invoice</th>
                  <th className={th}>Customer</th>
                  <th className={cn(th, "text-right")}>Total LKR</th>
                  <th className={cn(th, "text-right")}>Paid LKR</th>
                  <th className={th}>Settlement</th>
                  <th className={th}>Status</th>
                  <th className={cn(th, "text-right")}>Date</th>
                  <th className={cn(th, "w-16 pr-4")}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isVoid = r.status === "VOID";
                  const href = `/sales/invoices/${r.id}`;
                  return (
                    <tr key={r.id} className={cn(tr, "group cursor-pointer", isVoid && "opacity-60")} onClick={() => router.push(href)}>
                      <td className="py-1.5 pl-4 pr-2">
                        <Link href={href} onClick={(e) => e.stopPropagation()} className={cn("g-metric font-semibold text-ink group-hover:text-gold-deep", isVoid && "line-through")}>
                          {r.number}
                        </Link>
                      </td>
                      <td className="max-w-[14rem] truncate px-2 py-1.5">{r.customer_name ? <span className="font-medium text-ink">{r.customer_name}</span> : <span className="text-ink-4">Walk-in</span>}</td>
                      <td className="g-metric px-2 py-1.5 text-right font-medium text-ink">{lkr(r.total_cents)}</td>
                      <td className="g-metric px-2 py-1.5 text-right text-ink-3">{isVoid ? "—" : lkr(r.total_cents - Math.max(0, r.balance_cents))}</td>
                      <td className="px-2 py-1.5">
                        <Settlement total={r.total_cents} balance={r.balance_cents} isVoid={isVoid} />
                      </td>
                      <td className="px-2 py-1.5">
                        <InvChip status={r.status} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right text-[11px] text-ink-4" title={stamp(r.created_at)}>
                        {ago(r.created_at)}
                      </td>
                      <td className="py-1.5 pl-2 pr-4">
                        <span className="flex items-center justify-end gap-1">
                          <Link
                            href={`/sales/invoices/${r.id}/print`}
                            onClick={(e) => e.stopPropagation()}
                            title={`Print ${r.number}`}
                            aria-label={`Print ${r.number}`}
                            className="flex size-6 items-center justify-center rounded-md text-ink-4 ring-1 ring-inset ring-ink/10 transition-colors hover:bg-gold-pale hover:text-gold-deep"
                          >
                            <PrinterIcon size={12} />
                          </Link>
                          <ArrowRightIcon size={12} className="text-ink-5 transition-all group-hover:translate-x-0.5 group-hover:text-gold-dark" />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink/[0.06] bg-bone/40 px-4 py-2 text-[11.5px] text-ink-4">
            <span>
              Showing{" "}
              <span className="g-metric font-medium text-ink">
                {from}–{from + rows.length - 1}
              </span>{" "}
              of <span className="g-metric font-medium text-ink">{total.toLocaleString("en-US")}</span>
              {list.isFetching && !list.isLoading ? <span className="ml-2 inline-block size-3 animate-spin rounded-full border-2 border-gold/30 border-t-gold align-middle" /> : null}
            </span>
            <span className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="inline-flex h-7 items-center gap-1 rounded-lg px-2.5 font-medium text-ink ring-1 ring-inset ring-ink/10 hover:bg-void hover:text-paper disabled:pointer-events-none disabled:opacity-40"
              >
                <ArrowLeftIcon size={11} /> Prev
              </button>
              <span className="g-metric px-1.5 text-ink-3">
                {page} / {pages}
              </span>
              <button
                type="button"
                disabled={rows.length < PAGE_SIZE}
                onClick={() => setPage(page + 1)}
                className="inline-flex h-7 items-center gap-1 rounded-lg px-2.5 font-medium text-ink ring-1 ring-inset ring-ink/10 hover:bg-void hover:text-paper disabled:pointer-events-none disabled:opacity-40"
              >
                Next <ArrowRightIcon size={11} />
              </button>
            </span>
          </div>
        ) : null}
      </Card>
    </Page>
  );
}
