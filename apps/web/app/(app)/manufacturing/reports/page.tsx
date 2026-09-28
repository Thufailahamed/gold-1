"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Page, Hero, Panel } from "@/components/ui";

type Summary = {
  byStatus: { status: string; n: number }[];
  goldInMg: number;
  goldOutMg: number;
  lossMg: number;
  labourCents: number;
};
type WipRow = { id: string; number: string; status: string; allocatedMg: number; outputs: number };

const g = (mg: number) => (mg / 1000).toLocaleString("en-US");

export default function MfgReportsPage() {
  const [period, setPeriod] = useState("month");
  const summary = useQuery({
    queryKey: ["mfg-summary", period],
    queryFn: () => api<Summary>(`/api/v1/manufacturing/reports/summary?period=${period}`),
  });
  const wip = useQuery({
    queryKey: ["mfg-wip"],
    queryFn: () => api<WipRow[]>(`/api/v1/manufacturing/reports/wip`),
  });
  const s = summary.data;

  return (
    <Page>
      <Hero kicker="Manufacturing" title="Reports" description="Throughput, gold balance, and work in progress." />
      <div className="flex gap-2">
        {(["today", "month", "all"] as const).map((p) => (
          <button key={p} onClick={() => setPeriod(p)} className={`rounded-md px-3 py-1.5 text-sm ${period === p ? "bg-stone-900 text-white" : "border"}`}>
            {p}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["Orders", String((s?.byStatus ?? []).reduce((n, r) => n + r.n, 0))],
          ["Gold in", s ? `${g(s.goldInMg)} g` : "—"],
          ["Gold out", s ? `${g(s.goldOutMg)} g` : "—"],
          ["Loss", s ? `${s.lossMg} mg` : "—"],
          ["Labour+making+stones", s ? `${(s.labourCents / 100).toLocaleString("en-US")} LKR` : "—"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-xs text-stone-500">{k}</p>
            <p className="mt-1 text-xl font-semibold">{v}</p>
          </div>
        ))}
      </div>
      <Panel title={`Work in progress (${(wip.data ?? []).length})`}>
        {(wip.data ?? []).length === 0 ? (
          <p className="text-sm text-stone-500">No open orders.</p>
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Status</th>
                <th className="!text-right">Allocated fine g</th>
                <th className="!text-right">Outputs</th>
              </tr>
            </thead>
            <tbody>
              {(wip.data ?? []).map((w) => (
                <tr key={w.id}>
                  <td className="font-mono"><a href={`/manufacturing/orders/${w.id}`} className="hover:underline">{w.number}</a></td>
                  <td>{w.status}</td>
                  <td className="!text-right">{g(w.allocatedMg)}</td>
                  <td className="!text-right">{w.outputs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </Page>
  );
}
