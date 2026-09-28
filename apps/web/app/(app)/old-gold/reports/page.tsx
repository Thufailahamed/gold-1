"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

type Summary = { items: number; gross_mg: number; fine_mg: number; value_cents: number; paid_cents: number; outstanding_cents: number };
type Row = { key: string; items: number; value_cents: number; fine_mg: number };
type Pending = { id: string; number: string; description: string; fine_mg: number; purchase_value_cents: number; status: string; customer_name: string | null };

const GROUPS = ["purity", "customer", "branch"] as const;

export default function OldGoldReportsPage() {
  const [period, setPeriod] = useState("month");
  const [groupBy, setGroupBy] = useState<(typeof GROUPS)[number]>("purity");

  const summary = useQuery({
    queryKey: ["og-summary", period],
    queryFn: () => api<Summary>(`/api/v1/oldgold/reports/summary?period=${period}`),
  });
  const breakdown = useQuery({
    queryKey: ["og-breakdown", period, groupBy],
    queryFn: () => api<Row[]>(`/api/v1/oldgold/reports/breakdown?period=${period}&groupBy=${groupBy}`),
  });
  const pending = useQuery({
    queryKey: ["og-pending"],
    queryFn: () => api<Pending[]>(`/api/v1/oldgold/reports/pending`),
  });

  const s = summary.data;
  const fmt = (c: number) => (c / 100).toLocaleString("en-US");
  const g = (mg: number) => (mg / 1000).toLocaleString("en-US");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Old Gold Reports</h1>
        <p className="text-sm text-stone-500">Void items excluded</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["today", "month", "all"] as const).map((p) => (
          <button key={p} onClick={() => setPeriod(p)} className={`rounded-md px-3 py-1.5 text-sm ${period === p ? "bg-stone-900 text-white" : "border"}`}>{p}</button>
        ))}
        <span className="mx-1" />
        {GROUPS.map((x) => (
          <button key={x} onClick={() => setGroupBy(x)} className={`rounded-md px-3 py-1.5 text-sm ${groupBy === x ? "bg-stone-900 text-white" : "border"}`}>{x}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["Items", String(s?.items ?? "—")],
          ["Gross", s ? `${g(s.gross_mg)} g` : "—"],
          ["Fine gold", s ? `${g(s.fine_mg)} g` : "—"],
          ["Value", s ? `${fmt(s.value_cents)} LKR` : "—"],
          ["Paid", s ? `${fmt(s.paid_cents)} LKR` : "—"],
          ["Outstanding", s ? `${fmt(s.outstanding_cents)} LKR` : "—"],
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
              <th className="px-4 py-2 text-right">Items</th>
              <th className="px-4 py-2 text-right">Fine g</th>
              <th className="px-4 py-2 text-right">Value LKR</th>
            </tr>
          </thead>
          <tbody>
            {(breakdown.data ?? []).map((r) => (
              <tr key={r.key} className="border-b border-stone-100 last:border-0">
                <td className="px-4 py-2">{r.key}</td>
                <td className="px-4 py-2 text-right">{r.items}</td>
                <td className="px-4 py-2 text-right">{g(r.fine_mg)}</td>
                <td className="px-4 py-2 text-right">{fmt(r.value_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="font-medium">Pending processing ({(pending.data ?? []).length})</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {(pending.data ?? []).map((p) => (
            <li key={p.id} className="flex justify-between">
              <span className="font-mono text-xs">{p.number} · {p.description} · {p.customer_name ?? "—"}</span>
              <span>{p.status} · {g(p.fine_mg)}g</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
