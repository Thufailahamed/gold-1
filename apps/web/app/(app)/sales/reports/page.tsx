"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";

type Summary = { invoices: number; value_cents: number; discount_cents: number; gold_mg: number };
type Row = { key: string; invoices: number; value_cents: number; gold_mg: number };

const GROUPS = ["category", "purity", "branch", "salesperson", "payment", "product"] as const;

export default function SalesReportsPage() {
  const [period, setPeriod] = useState("month");
  const [groupBy, setGroupBy] = useState<(typeof GROUPS)[number]>("category");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canExport = hasPermission(me.data?.permissions ?? [], "sales:export");

  const summary = useQuery({
    queryKey: ["sales-summary", period],
    queryFn: () => api<Summary>(`/api/v1/sales/reports/summary?period=${period}`),
  });
  const breakdown = useQuery({
    queryKey: ["sales-breakdown", period, groupBy],
    queryFn: () => api<Row[]>(`/api/v1/sales/reports/breakdown?period=${period}&groupBy=${groupBy}`),
  });

  const s = summary.data;
  const fmt = (c: number) => (c / 100).toLocaleString("en-US");

  function exportCsv() {
    const rows = breakdown.data ?? [];
    const csv = ["key,invoices,value_lkr,gold_g", ...rows.map((r) => `"${r.key}",${r.invoices},${r.value_cents / 100},${r.gold_mg / 1000}`)].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-${period}-${groupBy}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sales Reports</h1>
          <p className="text-sm text-stone-500">Returns excluded from items; refunds excluded from value</p>
        </div>
        {canExport ? (
          <button onClick={exportCsv} className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100">
            Export CSV
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {(["today", "month", "all"] as const).map((p) => (
          <button key={p} onClick={() => setPeriod(p)} className={`rounded-md px-3 py-1.5 text-sm ${period === p ? "bg-stone-900 text-white" : "border"}`}>
            {p}
          </button>
        ))}
        <span className="mx-1" />
        {GROUPS.map((g) => (
          <button key={g} onClick={() => setGroupBy(g)} className={`rounded-md px-3 py-1.5 text-sm ${groupBy === g ? "bg-stone-900 text-white" : "border"}`}>
            {g}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["Invoices", String(s?.invoices ?? "—")],
          ["Value", s ? `${fmt(s.value_cents)} LKR` : "—"],
          ["Gold", s ? `${(s.gold_mg / 1000).toLocaleString("en-US")} g` : "—"],
          ["Discounts", s ? `${fmt(s.discount_cents)} LKR` : "—"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-xs text-stone-500">{k}</p>
            <p className="mt-1 text-xl font-semibold">{v}</p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
              <th className="px-4 py-2">{groupBy}</th>
              <th className="px-4 py-2 text-right">Invoices</th>
              <th className="px-4 py-2 text-right">Value LKR</th>
              <th className="px-4 py-2 text-right">Gold g</th>
            </tr>
          </thead>
          <tbody>
            {(breakdown.data ?? []).map((r) => (
              <tr key={r.key} className="border-b border-stone-100 last:border-0">
                <td className="px-4 py-2">{r.key}</td>
                <td className="px-4 py-2 text-right">{r.invoices}</td>
                <td className="px-4 py-2 text-right">{fmt(r.value_cents)}</td>
                <td className="px-4 py-2 text-right">{(r.gold_mg / 1000).toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
