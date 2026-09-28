"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import {
  Page,
  Hero,
  TableCard,
  TableSkeleton,
  EmptyBlock,
  StatusPill,
  Tabs,
} from "@/components/ui";
import { HammerIcon } from "@/components/icons";

type Summary = {
  byStatus: { status: string; n: number }[];
  goldInMg: number;
  goldOutMg: number;
  lossMg: number;
  labourCents: number;
};
type WipRow = { id: string; number: string; status: string; allocatedMg: number; outputs: number };

type Period = "today" | "month" | "all";

const g = (mg: number) => (mg / 1000).toLocaleString("en-US");

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

  return (
    <Page>
      <Hero
        kicker="Workshop"
        title="Manufacturing reports"
        description="Throughput, gold balance, and work in progress."
        stats={[
          { label: "Orders", value: (s?.byStatus ?? []).reduce((n, r) => n + r.n, 0) },
          { label: "Gold in", value: s ? `${g(s.goldInMg)} g` : "—" },
          { label: "Gold out", value: s ? `${g(s.goldOutMg)} g` : "—" },
          { label: "Loss", value: s ? `${s.lossMg} mg` : "—" },
        ]}
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
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["Labour + making + stones", s ? `${(s.labourCents / 100).toLocaleString("en-US")} LKR` : "—"],
          ...((s?.byStatus ?? []).slice(0, 3).map((r) => [r.status, String(r.n)] as [string, string])),
        ].map(([k, v]) => (
          <div key={k} className="g-surface rounded-xl p-5">
            <p className="g-kicker !text-[10px]">{k}</p>
            <p className="g-metric mt-1.5 text-xl font-semibold text-ink">{v}</p>
          </div>
        ))}
      </div>
      <TableCard title="Work in progress" icon={<HammerIcon size={17} />} description={`${(wip.data ?? []).length} open orders`}>
        {wip.isLoading ? (
          <TableSkeleton rows={4} cols={4} />
        ) : (wip.data ?? []).length === 0 ? (
          <EmptyBlock title="No open orders" description="Nothing on the workshop floor right now." />
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
                  <td>
                    <Link href={`/manufacturing/orders/${w.id}`} className="g-metric font-medium text-ink hover:text-gold-700">
                      {w.number}
                    </Link>
                  </td>
                  <td><StatusPill status={w.status} /></td>
                  <td className="!text-right num-tabular">{g(w.allocatedMg)}</td>
                  <td className="!text-right num-tabular">{w.outputs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </Page>
  );
}
