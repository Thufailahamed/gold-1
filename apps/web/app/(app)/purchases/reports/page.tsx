"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import {
  Page,
  Hero,
  TableCard,
  TableSkeleton,
  EmptyBlock,
  Tabs,
  heroBtnGhost,
} from "@/components/ui";
import { FileDownIcon } from "@/components/icons";

type Summary = { invoices: number; value_cents: number; paid_cents: number; outstanding_cents: number; gold_mg: number };
type Row = { key: string; invoices: number; value_cents: number; gold_mg: number };

type Period = "today" | "month" | "all";
type Group = "supplier" | "purity" | "category";

export default function ReportsPage() {
  const [period, setPeriod] = useState<Period>("month");
  const [groupBy, setGroupBy] = useState<Group>("supplier");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canExport = hasPermission(me.data?.permissions ?? [], "purchases:export");

  const summary = useQuery({
    queryKey: ["rep-summary", period],
    queryFn: () => api<Summary>(`/api/v1/purchases/reports/summary?period=${period}`),
  });
  const breakdown = useQuery({
    queryKey: ["rep-breakdown", period, groupBy],
    queryFn: () => api<Row[]>(`/api/v1/purchases/reports/breakdown?period=${period}&groupBy=${groupBy}`),
  });

  const s = summary.data;
  const fmt = (c: number) => (c / 100).toLocaleString("en-US");
  const g = (mg: number) => (mg / 1000).toLocaleString("en-US");

  function exportCsv() {
    const rows = breakdown.data ?? [];
    const csv = ["key,invoices,value_lkr,gold_g", ...rows.map((r) => `"${r.key}",${r.invoices},${r.value_cents / 100},${r.gold_mg / 1000}`)].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchases-${period}-${groupBy}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Page>
      <Hero
        kicker="Purchases"
        title="Purchase reports"
        description="Spend, gold intake and supplier balances — void invoices excluded."
        stats={[
          { label: "Invoices", value: s?.invoices ?? "—" },
          { label: "Value", value: s ? `${fmt(s.value_cents)} LKR` : "—" },
          { label: "Gold in", value: s ? `${g(s.gold_mg)} g` : "—" },
          { label: "Outstanding", value: s ? `${fmt(s.outstanding_cents)} LKR` : "—" },
        ]}
        actions={
          canExport ? (
            <button onClick={exportCsv} className={heroBtnGhost}>
              <FileDownIcon size={15} /> Export CSV
            </button>
          ) : null
        }
      />
      <Tabs<Period>
        ariaLabel="Period"
        items={[
          { key: "today", label: "Today" },
          { key: "month", label: "This month" },
          { key: "all", label: "All time" },
        ]}
        value={period}
        onChange={setPeriod}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="g-kicker">Group by</span>
        {(["supplier", "purity", "category"] as const).map((x) => (
          <button
            key={x}
            onClick={() => setGroupBy(x)}
            className={`g-btn h-9 px-3.5 text-xs capitalize ${groupBy === x ? "g-btn-primary" : "g-btn-secondary"}`}
          >
            {x}
          </button>
        ))}
      </div>
      <TableCard title={`By ${groupBy}`} description={`${(breakdown.data ?? []).length} groups`}>
        {breakdown.isLoading ? (
          <TableSkeleton rows={5} cols={4} />
        ) : (breakdown.data ?? []).length === 0 ? (
          <EmptyBlock title="Nothing in this period" description="Try widening the period or a different grouping." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th className="capitalize">{groupBy}</th>
                <th className="!text-right">Invoices</th>
                <th className="!text-right">Value LKR</th>
                <th className="!text-right">Gold g</th>
              </tr>
            </thead>
            <tbody>
              {(breakdown.data ?? []).map((r) => (
                <tr key={r.key}>
                  <td className="font-medium text-ink">{r.key}</td>
                  <td className="!text-right num-tabular">{r.invoices}</td>
                  <td className="!text-right num-tabular">{fmt(r.value_cents)}</td>
                  <td className="!text-right num-tabular">{g(r.gold_mg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </Page>
  );
}
