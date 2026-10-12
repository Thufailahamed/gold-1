"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page } from "@/components/ui";
import { CheckCircleIcon, HammerIcon, ScaleIcon, TrendingUpIcon } from "@/components/icons";
import {
  Card,
  CardHead,
  Empty,
  GoldHero,
  ORDER_META,
  ORDER_STATUSES,
  OrderChip,
  RowsSkeleton,
  ShareBar,
  grams,
  lkrFromCents,
  th,
  thead,
  tr,
} from "../kit";

type Summary = {
  byStatus: { status: string; n: number }[];
  goldInMg: number;
  goldOutMg: number;
  lossMg: number;
  labourCents: number;
};
type WipRow = { id: string; number: string; status: string; allocatedMg: number; outputs: number };
type Period = "today" | "month" | "all";

const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
];

export default function MfgReportsPage() {
  const [period, setPeriod] = useState<Period>("month");
  const summary = useQuery({
    queryKey: ["mfg-summary", period],
    queryFn: () => api<Summary>(`/api/v1/manufacturing/reports/summary?period=${period}`),
  });
  const wip = useQuery({
    queryKey: ["mfg-wip"],
    queryFn: () => api<WipRow[]>(`/api/v1/manufacturing/reports/wip`),
  });
  const s = summary.data;
  const by = new Map((s?.byStatus ?? []).map((r) => [r.status, r.n]));
  const orders = (s?.byStatus ?? []).reduce((n, r) => n + r.n, 0);
  const statusMax = Math.max(1, ...(s?.byStatus ?? []).map((r) => r.n));
  const outPct = s && s.goldInMg > 0 ? (s.goldOutMg / s.goldInMg) * 100 : undefined;
  const lossPct = s && s.goldInMg > 0 ? (s.lossMg / s.goldInMg) * 100 : undefined;
  const benchMg = s ? Math.max(0, s.goldInMg - s.goldOutMg - s.lossMg) : 0;
  const wipRows = wip.data ?? [];
  const wipGold = wipRows.reduce((n, w) => n + w.allocatedMg, 0);
  const wipPieces = wipRows.reduce((n, w) => n + w.outputs, 0);
  const completed = by.get("COMPLETE") ?? 0;
  const label = PERIODS.find((p) => p.key === period)!.label.toLowerCase();

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={TrendingUpIcon}
        title="Workshop"
        accent="reports"
        sub={`Throughput, gold balance and work in progress · ${label}`}
        actions={
          <div role="tablist" aria-label="Period" className="inline-flex rounded-lg bg-paper/[0.06] p-0.5 ring-1 ring-inset ring-paper/15">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                role="tab"
                aria-selected={period === p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "h-7 rounded-md px-3 text-[12px] font-medium transition-all",
                  period === p.key ? "bg-gold text-void shadow-[0_6px_16px_-8px_rgba(205,168,83,0.8)]" : "text-paper/60 hover:text-paper"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
        stats={[
          { label: "Orders", value: s ? orders : undefined, accent: true, loading: summary.isLoading, sub: `${completed} completed` },
          { label: "Gold in", value: s?.goldInMg, format: grams, unit: "g", loading: summary.isLoading, sub: "Issued to orders" },
          { label: "Gold out", value: s?.goldOutMg, format: grams, unit: "g", tone: "good", loading: summary.isLoading, sub: outPct !== undefined ? `${outPct.toFixed(1)}% of issued` : "In finished pieces" },
          { label: "Loss", value: s?.lossMg, format: grams, unit: "g", tone: s && s.lossMg > 0 ? "bad" : undefined, loading: summary.isLoading, sub: lossPct !== undefined ? `${lossPct.toFixed(2)}% of issued` : "—" },
          { label: "Labour & making", value: s?.labourCents, format: lkrFromCents, unit: "LKR", loading: summary.isLoading, sub: "Including stones" },
          { label: "Bench now", value: wip.data ? wipRows.length : undefined, unit: "orders", loading: wip.isLoading, sub: `${grams(wipGold)} g fine allocated` },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-5">
          <CardHead icon={HammerIcon} title="Orders by status" sub={`${orders} order${orders === 1 ? "" : "s"} · ${label}`} />
          {summary.isLoading ? (
            <RowsSkeleton />
          ) : orders === 0 ? (
            <Empty icon={HammerIcon} title="No orders" desc={`No orders were briefed ${label === "all time" ? "yet" : label}.`} />
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Status</th>
                  <th className={cn(th, "w-[45%]")}>Share</th>
                  <th className={cn(th, "pr-4 text-right")}>Orders</th>
                </tr>
              </thead>
              <tbody>
                {ORDER_STATUSES.map((st) => {
                  const n = by.get(st) ?? 0;
                  return (
                    <tr key={st} className={tr}>
                      <td className="py-1.5 pl-4 pr-2">
                        <Link href={`/manufacturing/orders?status=${st}`} className="hover:opacity-80">
                          <OrderChip status={st} />
                        </Link>
                      </td>
                      <td className="px-2">
                        <div className="flex items-center gap-2">
                          <ShareBar value={(n / statusMax) * 100} className="flex-1" color={ORDER_META[st]!.dot} />
                          <span className="g-metric w-10 text-right text-[10.5px] text-ink-5">{orders ? `${((n / orders) * 100).toFixed(0)}%` : "—"}</span>
                        </div>
                      </td>
                      <td className="g-metric py-1.5 pl-2 pr-4 text-right font-semibold text-ink">{n}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="xl:col-span-7">
          <CardHead icon={ScaleIcon} title="Gold balance" sub={`Fine gold issued against fine gold in finished pieces · ${label}`} />
          <div className="flex-1 p-4">
            {summary.isLoading ? (
              <RowsSkeleton rows={3} />
            ) : !s || s.goldInMg === 0 ? (
              <Empty icon={ScaleIcon} title="No gold issued" desc="Allocate refined gold to an order to see the balance." />
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-ink/[0.06] sm:grid-cols-4">
                  {[
                    { k: "Issued", v: s.goldInMg, tone: "text-ink" },
                    { k: "Finished", v: s.goldOutMg, tone: "text-emerald-700" },
                    { k: "Still on bench", v: benchMg, tone: "text-amber-700" },
                    { k: "Lost", v: s.lossMg, tone: s.lossMg > 0 ? "text-rose-700" : "text-ink" },
                  ].map((x) => (
                    <div key={x.k} className="bg-bone/70 px-3 py-2.5">
                      <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{x.k}</div>
                      <div className={cn("g-metric mt-0.5 text-[17px] leading-none", x.tone)}>
                        {grams(x.v)} <span className="text-[10px] text-ink-5">g</span>
                      </div>
                      <div className="g-metric mt-1 text-[10px] text-ink-5">{((x.v / s.goldInMg) * 100).toFixed(x.k === "Lost" ? 2 : 1)}%</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="flex h-3 overflow-hidden rounded-full bg-ink/[0.06]">
                    <span className="h-full bg-gradient-to-r from-gold-deep to-gold-light" style={{ width: `${(s.goldOutMg / s.goldInMg) * 100}%` }} />
                    <span className="h-full bg-amber-300/70" style={{ width: `${(benchMg / s.goldInMg) * 100}%` }} />
                    <span className="h-full bg-rose-500" style={{ width: `${(s.lossMg / s.goldInMg) * 100}%` }} />
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-4">
                    Issued gold either ends up in finished pieces, is still on the bench, or is recorded as loss. Orders are counted by the period they were
                    created in.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-ink/[0.06] text-center text-[11px]">
                  {[
                    ["Yield", outPct !== undefined ? `${outPct.toFixed(2)}%` : "—"],
                    ["Labour / g out", s.goldOutMg ? `${lkrFromCents((s.labourCents / s.goldOutMg) * 1000)} LKR` : "—"],
                    ["Labour / order", orders ? `${lkrFromCents(s.labourCents / orders)} LKR` : "—"],
                  ].map(([k, v]) => (
                    <div key={k} className="bg-paper px-2 py-2">
                      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-5">{k}</div>
                      <div className="g-metric text-[13px] text-ink">{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHead
          icon={HammerIcon}
          title="Work in progress"
          sub={wip.data ? `${wipRows.length} open orders · ${grams(wipGold)} g fine · ${wipPieces} piece${wipPieces === 1 ? "" : "s"} made so far` : "Open orders on the workshop floor"}
        />
        {wip.isLoading ? (
          <RowsSkeleton />
        ) : wipRows.length === 0 ? (
          <Empty icon={CheckCircleIcon} title="No open orders" desc="Nothing on the workshop floor right now." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Order</th>
                  <th className={th}>Status</th>
                  <th className={cn(th, "w-[35%]")}>Share of bench gold</th>
                  <th className={cn(th, "text-right")}>Allocated fine g</th>
                  <th className={cn(th, "pr-4 text-right")}>Pieces</th>
                </tr>
              </thead>
              <tbody>
                {[...wipRows]
                  .sort((a, b) => b.allocatedMg - a.allocatedMg)
                  .map((w) => (
                    <tr key={w.id} className={cn(tr, w.status === "QC_FAILED" && "bg-rose-50/40")}>
                      <td className="py-1.5 pl-4 pr-2">
                        <Link href={`/manufacturing/orders/${w.id}`} className="g-metric font-semibold text-ink hover:text-gold-dark">
                          {w.number}
                        </Link>
                      </td>
                      <td className="px-2">
                        <OrderChip status={w.status} />
                      </td>
                      <td className="px-2">
                        <div className="flex items-center gap-2">
                          <ShareBar value={wipGold ? (w.allocatedMg / wipGold) * 100 : 0} className="flex-1" />
                          <span className="g-metric w-10 text-right text-[10.5px] text-ink-5">{wipGold ? `${((w.allocatedMg / wipGold) * 100).toFixed(0)}%` : "—"}</span>
                        </div>
                      </td>
                      <td className="g-metric px-2 text-right text-ink">{grams(w.allocatedMg)}</td>
                      <td className="g-metric py-1.5 pl-2 pr-4 text-right text-ink-3">{w.outputs}</td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-ink/[0.1] bg-bone text-[12px] font-semibold text-ink">
                  <td className="py-1.5 pl-4" colSpan={3}>
                    Total on the bench
                  </td>
                  <td className="g-metric px-2 text-right">{grams(wipGold)}</td>
                  <td className="g-metric py-1.5 pr-4 text-right">{wipPieces}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
