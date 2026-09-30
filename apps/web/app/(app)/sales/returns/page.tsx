"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { hasPermission, normalizeCode } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { CameraScanButton } from "@/components/camera-scan";
import {
  Page,
  Hero,
  Panel,
  TableCard,
  TableSkeleton,
  EmptyBlock,
  StatusPill,
  Pill,
  controlClass,
} from "@/components/ui";
import { RotateCcwIcon, ScanBarcodeIcon } from "@/components/icons";

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

const fmt = (c: number) => (c / 100).toLocaleString("en-US");

export default function ReturnsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [scan, setScan] = useState("");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCancel = hasPermission(me.data?.permissions ?? [], "sales:cancel");

  const list = useQuery({
    queryKey: ["returns", search],
    queryFn: () =>
      api<{ rows: Ret[]; total: number }>(
        `/api/v1/sales/returns?limit=30${search ? `&search=${encodeURIComponent(search)}` : ""}`
      ),
  });

  // The customer hands back a piece or a bill: either finds the sale.
  const find = useMutation({
    mutationFn: (code: string) =>
      api<{ invoiceId: string; number: string }>(`/api/v1/sales/lookup/${encodeURIComponent(code)}`),
    onSuccess: (d) => router.push(`/sales/invoices/${d.invoiceId}`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "No sale found"),
  });
  function lookup(raw: string) {
    const code = normalizeCode(raw);
    setScan("");
    if (code) find.mutate(code);
  }

  const rows = list.data?.rows ?? [];
  const refunds = rows.reduce((n, r) => n + r.refund_cents + (r.credit_cents ?? 0), 0);

  return (
    <Page>
      <Hero
        kicker="Sales"
        title="Returns"
        description={`Scan the returned piece or the bill to open its sale${canCancel ? ", then record the return there." : " — view only."}`}
        note="Refunds post to the customer ledger and reverse the gold movement."
        stats={[
          { label: "Returns", value: list.data?.total ?? rows.length },
          { label: "On this page", value: rows.length },
          { label: "Refunded", value: `${fmt(refunds)} LKR` },
        ]}
      />
      <Panel title="Start a return" icon={<ScanBarcodeIcon size={16} />} description="Product tag, SKU or SINV- invoice number">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            lookup(scan);
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <input
            autoFocus
            placeholder="Scan tag or bill + Enter"
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            autoComplete="off"
            className={`${controlClass} w-full font-mono sm:max-w-sm`}
          />
          <CameraScanButton onDetected={lookup} className="h-10" />
          <button type="submit" disabled={find.isPending} className="g-btn g-btn-secondary h-10 px-4 text-sm">
            {find.isPending ? "Finding…" : "Find sale"}
          </button>
        </form>
      </Panel>
      <div className="flex flex-wrap gap-2">
        <input
          placeholder="Filter by return or invoice number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={controlClass}
        />
      </div>
      <TableCard
        title="Return register"
        icon={<RotateCcwIcon size={17} />}
        actions={<span className="g-metric text-[11px] font-medium uppercase tracking-[0.14em] text-ink-4">{String(list.data?.total ?? rows.length).padStart(2, "0")} on file</span>}
      >
        {list.isLoading ? (
          <TableSkeleton rows={5} cols={7} />
        ) : list.isError ? (
          <EmptyBlock title="Failed to load" description="Check the API connection and retry." />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No returns recorded" description="Returns recorded against invoices appear here." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Invoice</th>
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
                  <td>
                    <Link href={`/sales/invoices/${r.invoice_id}`} className="g-metric text-xs text-ink hover:text-gold-700">
                      {r.invoice_number}
                    </Link>
                  </td>
                  <td>
                    <Pill tone="neutral">{r.type}</Pill>
                    {r.type === "EXCHANGE" && !r.exchange_sale_id ? (
                      <span className="ml-2 text-xs text-amber-700">no replacement yet</span>
                    ) : null}
                  </td>
                  <td className="max-w-64 truncate text-ink-3" title={r.reason}>{r.reason}</td>
                  <td className="!text-right num-tabular font-medium text-ink">
                    {fmt(r.refund_cents + (r.credit_cents ?? 0))}
                    {r.credit_cents ? <span className="ml-1 text-xs font-normal text-ink-4">credit</span> : null}
                  </td>
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
