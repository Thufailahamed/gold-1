"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import {
  Page,
  Hero,
  Panel,
  TableCard,
  TableSkeleton,
  EmptyBlock,
  Pill,
  type PillTone,
  Tabs,
} from "@/components/ui";

type Summary = { items: number; gross_mg: number; fine_mg: number; value_cents: number; paid_cents: number; outstanding_cents: number };
type Row = { key: string; items: number; value_cents: number; fine_mg: number };
type Pending = { id: string; number: string; description: string; fine_mg: number; purchase_value_cents: number; status: string; customer_name: string | null };

const GROUPS = ["purity", "customer", "branch"] as const;
type Period = "today" | "month" | "all";
type Group = (typeof GROUPS)[number];

const PENDING_TONES: Record<string, PillTone> = {
  PURCHASED: "brand",
  VALUED: "info",
  TESTED: "info",
  RECEIVED: "warning",
};

export default function OldGoldReportsPage() {
  const [period, setPeriod] = useState<Period>("month");
  const [groupBy, setGroupBy] = useState<Group>("purity");

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
    <Page>
      <Hero
        kicker="Old gold"
        title="Old gold reports"
        description="Buy-ins, fine gold recovered, and outstanding payables — void items excluded."
        stats={[
          { label: "Items", value: s?.items ?? "—" },
          { label: "Fine gold", value: s ? `${g(s.fine_mg)} g` : "—" },
          { label: "Value", value: s ? `${fmt(s.value_cents)} LKR` : "—" },
          { label: "Outstanding", value: s ? `${fmt(s.outstanding_cents)} LKR` : "—" },
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
      <div className="flex flex-wrap items-center gap-2">
        <span className="g-kicker">Group by</span>
        {GROUPS.map((x) => (
          <button
            key={x}
            onClick={() => setGroupBy(x)}
            className={`g-btn h-9 px-3.5 text-xs capitalize ${groupBy === x ? "g-btn-primary" : "g-btn-secondary"}`}
          >
            {x}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["Gross", s ? `${g(s.gross_mg)} g` : "—"],
          ["Paid", s ? `${fmt(s.paid_cents)} LKR` : "—"],
        ].map(([k, v]) => (
          <div key={k} className="g-surface rounded-xl p-5">
            <p className="g-kicker !text-[10px]">{k}</p>
            <p className="g-metric mt-1.5 text-xl font-semibold text-ink">{v}</p>
          </div>
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
                <th className="!text-right">Items</th>
                <th className="!text-right">Fine g</th>
                <th className="!text-right">Value LKR</th>
              </tr>
            </thead>
            <tbody>
              {(breakdown.data ?? []).map((r) => (
                <tr key={r.key}>
                  <td className="font-medium text-ink">{r.key}</td>
                  <td className="!text-right num-tabular">{r.items}</td>
                  <td className="!text-right num-tabular">{g(r.fine_mg)}</td>
                  <td className="!text-right num-tabular">{fmt(r.value_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      <Panel title="Pending processing" description={`${(pending.data ?? []).length} items awaiting settlement or melt`}>
        {(pending.data ?? []).length === 0 ? (
          <EmptyBlock title="All clear" description="No old-gold items pending processing." />
        ) : (
          <ul className="space-y-2.5 text-sm">
            {(pending.data ?? []).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-ink-2">
                  <Link href={`/old-gold/items/${p.id}`} className="g-metric text-xs text-ink hover:text-gold-700">{p.number}</Link>
                  {" "}· {p.description} · {p.customer_name ?? "—"}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="num-tabular text-ink-3">{g(p.fine_mg)}g</span>
                  <Pill tone={PENDING_TONES[p.status] ?? "neutral"} dot>{p.status.replace(/_/g, " ")}</Pill>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Page>
  );
}
