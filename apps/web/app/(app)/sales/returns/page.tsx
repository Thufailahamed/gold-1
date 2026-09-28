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
  StatusPill,
  Pill,
  controlClass,
} from "@/components/ui";
import { RotateCcwIcon } from "@/components/icons";

type Ret = { id: string; number: string; type: string; reason: string; refund_cents: number; status: string; created_at: number };

const fmt = (c: number) => (c / 100).toLocaleString("en-US");

export default function ReturnsPage() {
  const [invoiceId, setInvoiceId] = useState("");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCancel = hasPermission(me.data?.permissions ?? [], "sales:cancel");

  const list = useQuery({
    queryKey: ["returns", invoiceId],
    queryFn: () =>
      api<{ rows: Ret[]; total: number }>(
        `/api/v1/sales/returns?limit=30${invoiceId ? `&invoiceId=${invoiceId}` : ""}`
      ),
  });

  const rows = list.data?.rows ?? [];
  const refunds = rows.reduce((n, r) => n + r.refund_cents, 0);

  return (
    <Page>
      <Hero
        kicker="Sales"
        title="Returns"
        description={`Record returns from the invoice detail page${canCancel ? "." : " — view only."}`}
        note="Refunds post to the customer ledger and reverse the gold movement."
        stats={[
          { label: "Returns", value: list.data?.total ?? rows.length },
          { label: "On this page", value: rows.length },
          { label: "Refunded", value: `${fmt(refunds)} LKR` },
        ]}
      />
      <div className="flex flex-wrap gap-2">
        <input
          placeholder="Filter by invoice ID…"
          value={invoiceId}
          onChange={(e) => setInvoiceId(e.target.value)}
          className={controlClass}
        />
      </div>
      <TableCard
        title="Return register"
        icon={<RotateCcwIcon size={17} />}
        actions={<span className="g-metric text-[11px] font-medium uppercase tracking-[0.14em] text-ink-4">{String(list.data?.total ?? rows.length).padStart(2, "0")} on file</span>}
      >
        {list.isLoading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : list.isError ? (
          <EmptyBlock title="Failed to load" description="Check the API connection and retry." />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No returns recorded" description="Returns recorded against invoices appear here." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Type</th>
                <th>Reason</th>
                <th className="!text-right">Refund</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="g-metric font-medium text-ink">{r.number}</td>
                  <td><Pill tone="neutral">{r.type}</Pill></td>
                  <td className="max-w-64 truncate text-ink-3" title={r.reason}>{r.reason}</td>
                  <td className="!text-right num-tabular font-medium text-ink">{fmt(r.refund_cents)}</td>
                  <td><StatusPill status={r.status} /></td>
                  <td className="whitespace-nowrap text-ink-3">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </Page>
  );
}
