"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { hasPermission, normalizeCode } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { CameraScanButton } from "@/components/camera-scan";
import { Page } from "@/components/ui";
import { AlertCircleIcon, ArrowLeftRightIcon, ArrowRightIcon, CoinsIcon, RotateCcwIcon, ScanBarcodeIcon, SearchIcon, XIcon } from "@/components/icons";
import {
  Card,
  CardHead,
  Empty,
  FilterPills,
  GoldHero,
  HeroBadge,
  RETURN_META,
  ReturnChip,
  RowsSkeleton,
  ShareBar,
  ago,
  heroGhost,
  inputCls,
  lkr,

  stamp,
  th,
  thead,
  tr,
} from "../kit";

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

const TYPES = ["FULL", "PARTIAL", "EXCHANGE"] as const;

export default function ReturnsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [scan, setScan] = useState("");
  const [type, setType] = useState("");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCancel = hasPermission(me.data?.permissions ?? [], "sales:cancel");

  const list = useQuery({
    queryKey: ["returns", search],
    queryFn: () => api<{ rows: Ret[]; total: number }>(`/api/v1/sales/returns?limit=30${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  });

  // The customer hands back a piece or a bill: either finds the sale.
  const find = useMutation({
    mutationFn: (code: string) => api<{ invoiceId: string; number: string }>(`/api/v1/sales/lookup/${encodeURIComponent(code)}`),
    onSuccess: (d) => router.push(`/sales/invoices/${d.invoiceId}`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "No sale found"),
  });
  function lookup(raw: string) {
    const code = normalizeCode(raw);
    setScan("");
    if (code) find.mutate(code);
  }

  const all = list.data?.rows ?? [];
  const rows = type ? all.filter((r) => r.type === type) : all;
  const total = list.data?.total ?? all.length;
  const refunded = all.reduce((n, r) => n + r.refund_cents, 0);
  const credited = all.reduce((n, r) => n + (r.credit_cents ?? 0), 0);
  const pendingExchanges = all.filter((r) => r.type === "EXCHANGE" && !r.exchange_sale_id).length;
  const byType = (t: string) => all.filter((r) => r.type === t).length;
  const avg = all.length ? (refunded + credited) / all.length : 0;

  // Reasons, most frequent first: what keeps coming back.
  const reasons = [...all.reduce((m, r) => {
    const k = r.reason.trim().toLowerCase() || "unspecified";
    const cur = m.get(k) ?? { label: r.reason.trim() || "Unspecified", n: 0, cents: 0 };
    return m.set(k, { ...cur, n: cur.n + 1, cents: cur.cents + r.refund_cents + (r.credit_cents ?? 0) });
  }, new Map<string, { label: string; n: number; cents: number }>()).values()].sort((a, b) => b.n - a.n).slice(0, 6);
  const maxReason = Math.max(1, ...reasons.map((r) => r.n));
  const loading = list.isLoading;

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={RotateCcwIcon}
        title="Returns,"
        accent="handled cleanly"
        back={{ href: "/sales", label: "Sales" }}
        badge={!canCancel && me.data ? <HeroBadge tone="muted">View only</HeroBadge> : pendingExchanges ? <HeroBadge tone="warn">{pendingExchanges} exchange{pendingExchanges === 1 ? "" : "s"} open</HeroBadge> : null}
        sub="Scan the returned piece or the bill to open its sale, then record the return there. Refunds post to the customer ledger and reverse the gold movement."
        actions={
          <Link href="/sales/invoices" className={heroGhost}>
            Invoices
          </Link>
        }
        stats={[
          { label: "Returns", value: list.data ? total : null, loading, sub: `${all.length} shown${search ? " · filtered" : ""}` },
          { label: "Refunded", value: list.data ? refunded : null, format: lkr, unit: "LKR", accent: true, loading, sub: "Money back" },
          { label: "Store credit", value: list.data ? credited : null, format: lkr, unit: "LKR", loading, sub: "Held for customers" },
          { label: "Average", value: list.data ? avg : null, format: lkr, unit: "LKR", loading, sub: "Per return" },
          { label: "Full · partial", value: list.data ? byType("FULL") : null, loading, sub: `${byType("PARTIAL")} partial` },
          { label: "Exchanges open", value: list.data ? pendingExchanges : null, tone: pendingExchanges ? "warn" : undefined, loading, sub: `${byType("EXCHANGE")} exchanges in all` },
        ]}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            lookup(scan);
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <label htmlFor="return-scan" className="sr-only">
            Product tag, SKU or invoice number
          </label>
          <span className="relative flex-1">
            <ScanBarcodeIcon size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gold" />
            <input
              id="return-scan"
              autoFocus
              placeholder="Scan a tag or bill, or type SINV-… and press Enter"
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-full rounded-xl bg-paper/10 pl-10 pr-3 font-mono text-[14px] text-paper shadow-[inset_0_0_0_1px_rgba(205,168,83,0.45)] placeholder:font-sans placeholder:text-[13px] placeholder:text-paper/35 focus:outline-none focus:shadow-[inset_0_0_0_2px_#CDA853,0_0_0_4px_rgba(205,168,83,0.2)]"
            />
          </span>
          <span className="flex gap-2">
            <CameraScanButton onDetected={lookup} tone="dark" className="h-10 rounded-xl" />
            <button type="submit" disabled={find.isPending || !scan.trim()} className="home-btn-gold h-10 flex-1 px-4 text-[13px] disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none">
              {find.isPending ? "Finding…" : "Find sale"}
              <ArrowRightIcon size={13} />
            </button>
          </span>
        </form>
      </GoldHero>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <CardHead
            icon={RotateCcwIcon}
            title="Return register"
            sub={list.data ? `${rows.length} of ${total.toLocaleString("en-US")} · newest first` : "Refunds and exchanges, newest first"}
            action={
              <label className="relative">
                <span className="sr-only">Filter returns</span>
                <SearchIcon size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-5" />
                <input
                  id="return-search"
                  type="search"
                  autoComplete="off"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Return or invoice number…"
                  className={cn(inputCls, "w-56 pl-7 pr-7 [&::-webkit-search-cancel-button]:hidden")}
                />
                {search ? (
                  <button
                    type="button"
                    aria-label="Clear filter"
                    onClick={() => setSearch("")}
                    className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-ink-4 hover:bg-ink/5 hover:text-ink"
                  >
                    <XIcon size={11} />
                  </button>
                ) : null}
              </label>
            }
          />
          <div className="border-b border-ink/[0.06] px-4 py-2">
            <FilterPills
              value={type}
              onChange={setType}
              items={[
                { key: "", label: "All", count: list.data ? all.length : undefined },
                ...TYPES.map((t) => ({ key: t as string, label: RETURN_META[t]!.label, dot: RETURN_META[t]!.dot, count: list.data ? byType(t) : undefined })),
              ]}
            />
          </div>

          {loading ? (
            <RowsSkeleton rows={6} />
          ) : list.isError ? (
            <Empty
              icon={AlertCircleIcon}
              title="Couldn't load returns"
              desc="Check the API connection, then retry."
              action={
                <button type="button" onClick={() => void list.refetch()} className="g-btn g-btn-secondary h-8 rounded-lg px-3 text-[12px]">
                  Retry
                </button>
              }
            />
          ) : rows.length === 0 ? (
            <Empty
              icon={RotateCcwIcon}
              title={search || type ? "No matching returns" : "No returns recorded"}
              desc={search || type ? "Try another number or type." : "Returns recorded against an invoice will appear here."}
              action={
                search || type ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setType("");
                    }}
                    className="g-btn g-btn-secondary h-8 rounded-lg px-3 text-[12px]"
                  >
                    Clear filters
                  </button>
                ) : (
                  <button type="button" onClick={() => document.getElementById("return-scan")?.focus()} className="g-btn g-btn-primary h-8 rounded-lg px-3 text-[12px]">
                    <ScanBarcodeIcon size={12} /> Scan a piece
                  </button>
                )
              }
            />
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[720px] text-[12.5px]">
                <thead className={thead}>
                  <tr>
                    <th className={cn(th, "pl-4")}>Return</th>
                    <th className={th}>Invoice</th>
                    <th className={th}>Type</th>
                    <th className={th}>Reason</th>
                    <th className={cn(th, "text-right")}>Refund</th>
                    <th className={cn(th, "text-right")}>Credit</th>
                    <th className={th}>Status</th>
                    <th className={cn(th, "pr-4 text-right")}>When</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const waiting = r.type === "EXCHANGE" && !r.exchange_sale_id;
                    return (
                      <tr key={r.id} className={tr}>
                        <td className="relative whitespace-nowrap py-1.5 pl-4 pr-2">
                          {waiting ? <span aria-hidden className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-amber-400" /> : null}
                          <span className="g-metric font-semibold text-ink">{r.number}</span>
                        </td>
                        <td className="px-2 py-1.5">
                          <Link href={`/sales/invoices/${r.invoice_id}`} className="g-metric text-[11.5px] text-ink-3 hover:text-gold-dark">
                            {r.invoice_number}
                          </Link>
                        </td>
                        <td className="px-2 py-1.5">
                          <ReturnChip status={r.type} />
                        </td>
                        <td className="max-w-[16rem] px-2 py-1.5">
                          <span className="line-clamp-1 text-ink-3" title={r.reason}>
                            {r.reason}
                          </span>
                          {r.type === "EXCHANGE" ? (
                            r.exchange_sale_id ? (
                              <Link href={`/sales/invoices/${r.exchange_sale_id}`} className="inline-flex items-center gap-1 text-[10.5px] font-medium text-sky-700 hover:underline">
                                <ArrowLeftRightIcon size={10} /> Replacement sale
                              </Link>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-amber-700">
                                <AlertCircleIcon size={10} /> No replacement yet
                              </span>
                            )
                          ) : null}
                        </td>
                        <td className="g-metric px-2 py-1.5 text-right text-ink">{r.refund_cents ? lkr(r.refund_cents) : "—"}</td>
                        <td className="g-metric px-2 py-1.5 text-right text-ink-3">{r.credit_cents ? lkr(r.credit_cents) : "—"}</td>
                        <td className="px-2 py-1.5">
                          <ReturnChip status={r.status} />
                        </td>
                        <td className="whitespace-nowrap py-1.5 pl-2 pr-4 text-right text-[11px] text-ink-4" title={stamp(r.created_at)}>
                          {ago(r.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-bone/70">
                  <tr className="border-t border-ink/10 text-[12px] font-semibold">
                    <td colSpan={4} className="py-1.5 pl-4 text-[9.5px] uppercase tracking-[0.14em] text-gold-dark">
                      Total · {rows.length} shown
                    </td>
                    <td className="g-metric px-2 py-1.5 text-right text-ink">{lkr(rows.reduce((n, r) => n + r.refund_cents, 0))}</td>
                    <td className="g-metric px-2 py-1.5 text-right text-ink">{lkr(rows.reduce((n, r) => n + (r.credit_cents ?? 0), 0))}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHead icon={CoinsIcon} title="Where the money went" sub={`${lkr(refunded + credited)} LKR across ${all.length} returns`} />
            <div className="space-y-2.5 p-4">
              {[
                ["Refunded", refunded, "bg-gradient-to-r from-sky-600 to-sky-400"],
                ["Store credit", credited, "bg-gradient-to-r from-gold-deep to-gold-light"],
              ].map(([k, v, c]) => {
                const share = refunded + credited > 0 ? ((v as number) / (refunded + credited)) * 100 : 0;
                return (
                  <div key={k as string}>
                    <div className="flex items-baseline justify-between text-[12px]">
                      <span className="font-medium text-ink">{k as string}</span>
                      <span className="g-metric text-ink">
                        {lkr(v as number)} <span className="text-[10px] text-ink-5">{share.toFixed(0)}%</span>
                      </span>
                    </div>
                    <ShareBar value={share} className="mt-1" color={c as string} />
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardHead icon={AlertCircleIcon} title="Why pieces come back" sub="Most frequent reasons, shown returns" />
            {loading ? (
              <RowsSkeleton rows={3} />
            ) : reasons.length === 0 ? (
              <Empty icon={RotateCcwIcon} title="No reasons yet" desc="Reasons appear once returns are recorded." />
            ) : (
              <ul className="space-y-2 p-4">
                {reasons.map((r) => (
                  <li key={r.label}>
                    <div className="flex items-baseline justify-between gap-2 text-[12px]">
                      <span className="min-w-0 truncate text-ink-2">{r.label}</span>
                      <span className="g-metric shrink-0 text-ink">
                        {r.n} <span className="text-[10px] text-ink-5">· {lkr(r.cents)}</span>
                      </span>
                    </div>
                    <ShareBar value={(r.n / maxReason) * 100} className="mt-1 h-1" />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHead icon={ScanBarcodeIcon} title="How a return works" />
            <ol className="divide-y divide-ink/[0.05] text-[12px]">
              {["Scan the piece or the bill", "Open its sale", canCancel ? "Record the return there" : "Review the sale (view only)"].map((s, i) => (
                <li key={s} className="flex items-center gap-2.5 px-4 py-1.5">
                  <span className="g-metric flex size-5 shrink-0 items-center justify-center rounded-full bg-void text-[10px] text-gold-light">{i + 1}</span>
                  <span className="text-ink-3">{s}</span>
                </li>
              ))}
            </ol>
            {rows[0] ? <p className="border-t border-ink/[0.06] bg-bone/40 px-4 py-1.5 text-[10.5px] text-ink-4">Last return {ago(rows[0].created_at)}</p> : null}
          </Card>
        </div>
      </div>
    </Page>
  );
}
