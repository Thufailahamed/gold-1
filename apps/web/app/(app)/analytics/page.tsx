"use client";

import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { api, type MeData } from "@/lib/api";
import { last12Months, type MonthlySummary } from "@/lib/monthly";
import { Page, Hero, StatGrid, StatCard, Panel, Pill, EmptyBlock } from "@/components/ui";

const lkr = (c: number) => (c / 100).toLocaleString("en-US");

export default function AnalyticsPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const [branchId, setBranchId] = useState("");
  const allowed = hasPermission(me.data?.permissions ?? [], "branches:manage") && hasPermission(me.data?.permissions ?? [], "accounts:view");
  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/branches?limit=100"),
    enabled: allowed,
  });
  const months = last12Months(new Date());
  const trends = useQueries({
    queries: months.map((m) => ({
      queryKey: ["trend", m.year, m.month, branchId],
      queryFn: () => api<MonthlySummary>(`/api/v1/reports/monthly?month=${m.month}&year=${m.year}${branchId ? `&branchId=${branchId}` : ""}`),
      staleTime: 5 * 60_000,
      retry: false,
    })),
  });
  const current = trends[trends.length - 1]?.data;
  const missing = trends.filter((t) => t.isError || !t.data).length;
  const revenue = trends.map((t, i) => ({
    month: months[i]?.label ?? "",
    revenue: t.data ? t.data.profit.revenueCents / 100 : null,
    net: t.data ? t.data.profit.netProfitCents / 100 : null,
  }));
  const cash = trends.map((t, i) => ({
    month: months[i]?.label ?? "",
    in: t.data ? t.data.cashflow.inflowsCents / 100 : null,
    out: t.data ? t.data.cashflow.outflowsCents / 100 : null,
  }));
  const gold = trends.map((t, i) => ({
    month: months[i]?.label ?? "",
    in: t.data ? t.data.gold.inFineMg / 1000 : null,
    out: t.data ? t.data.gold.outFineMg / 1000 : null,
  }));
  const aging = current ? Object.entries(current.receivables.aging).map(([k, v]) => ({ bucket: k, value: v / 100 })) : [];
  const purity = (current?.inventory.byPurity ?? []).slice(0, 6).map((p) => ({ name: p.key, value: p.cents / 100 }));

  if (!allowed && !me.isLoading) {
    return (
      <Page>
        <EmptyBlock title="Not permitted" description="Analytics needs branch management and accounts view." />
      </Page>
    );
  }

  return (
    <Page>
      <Hero
        kicker="Reports · Owner"
        title="Analytics"
        description="Twelve-month ledger trends with the current month in focus."
        stats={[
          { label: "Net sales", value: current ? `${lkr(current.sales.netCents)} LKR` : "—" },
          { label: "Net profit", value: current ? `${lkr(current.profit.netProfitCents)} LKR` : "—" },
          { label: "Closing cash", value: current ? `${lkr(current.cashflow.closingCents)} LKR` : "—" },
          { label: "Gold closing", value: current ? `${(current.gold.closingFineMg / 1000).toLocaleString("en-US")} g` : "—" },
        ]}
        note={missing > 0 ? `${missing} of 12 months unavailable — gaps shown, never interpolated` : "Ledger-posted · estimates separate"}
      />
      <div className="no-print flex flex-wrap items-center gap-2">
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="g-btn h-9 px-3 text-xs" aria-label="Branch">
          <option value="">All branches</option>
          {(branches.data?.rows ?? []).map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <Pill tone="ghost">Ledger</Pill>
      </div>
      {trends.every((t) => !t.data) && trends.every((t) => !t.isLoading) ? (
        <EmptyBlock title="No data yet" description="Post sales or purchases to see trends." />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Revenue vs net profit" description="LKR · 12 months">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={revenue}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" connectNulls={false} dot={false} />
                  <Line type="monotone" dataKey="net" connectNulls={false} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Panel>
            <Panel title="Cash in vs out" description="LKR · 12 months">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={cash}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="in" />
                  <Bar dataKey="out" />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
            <Panel title="Gold in vs out" description="grams · 12 months">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={gold}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="in" />
                  <Bar dataKey="out" />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
            <Panel title="Inventory by purity" description="Book cost LKR">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={purity} dataKey="value" nameKey="name" outerRadius={90} label />
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </Panel>
          </div>
          <Panel title="Receivables aging" description="LKR by bucket">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={aging} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="bucket" tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="value" />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
          <Panel title="Estimates" description="Not in profit">
            {(current?.estimates ?? []).map((e) => (
              <div key={e.label} className="flex items-center gap-2 text-sm"><Pill tone="warning">Estimate</Pill><span>{e.label} — {e.note}</span></div>
            ))}
          </Panel>
          <StatGrid cols={4}>
            <StatCard label="Receivables" value={current ? `${lkr(current.receivables.totalCents)} LKR` : "—"} sub="Ledger" />
            <StatCard label="Jewellery stock" value={current ? `${lkr(current.inventory.jewelleryCents)} LKR` : "—"} sub="Book cost" />
            <StatCard label="Gold stock" value={current ? `${lkr(current.inventory.goldCents)} LKR` : "—"} sub="Book cost" />
            <StatCard label="Invoices" value={current ? current.sales.invoiceCount : "—"} sub="This month" />
          </StatGrid>
        </>
      )}
    </Page>
  );
}
