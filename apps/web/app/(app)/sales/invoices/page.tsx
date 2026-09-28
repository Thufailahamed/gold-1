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
  Pager,
  EmptyBlock,
  StatusPill,
  controlClass,
} from "@/components/ui";
import { CreditCardIcon } from "@/components/icons";

type Invoice = {
  id: string;
  number: string;
  customer_name: string | null;
  total_cents: number;
  paid_cents: number;
  status: string;
  created_at: number;
};

const STATUSES = ["PAID", "PARTIAL", "UNPAID", "VOID"];
const fmt = (c: number) => (c / 100).toLocaleString("en-US");

export default function SalesInvoicesPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [fStatus, setFStatus] = useState("");

  const list = useQuery({
    queryKey: ["sales", search, page, fStatus],
    queryFn: () =>
      api<{ rows: Invoice[]; total: number }>(
        `/api/v1/sales/invoices?search=${encodeURIComponent(search)}&page=${page}&limit=20${fStatus ? `&status=${fStatus}` : ""}`
      ),
  });

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const value = rows.reduce((n, r) => n + (r.status === "VOID" ? 0 : r.total_cents), 0);

  return (
    <Page>
      <Hero
        kicker="Sales"
        title="Sales invoices"
        description="Completed counter sales — every line linked to a physical piece."
        note="Credit balances sit on the customer ledger until fully settled."
        stats={[
          { label: "Invoices", value: total },
          { label: "On this page", value: rows.length },
          { label: "Page value", value: `${fmt(value)} LKR` },
        ]}
      />
      <div className="flex flex-wrap gap-2">
        <input
          placeholder="Search by number…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className={controlClass}
        />
        <select value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(1); }} className={controlClass}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <TableCard
        title="Invoices"
        icon={<CreditCardIcon size={17} />}
        actions={<span className="g-metric text-[11px] font-medium uppercase tracking-[0.14em] text-ink-4">{String(total).padStart(2, "0")} on file</span>}
        footer={<Pager page={page} onChange={setPage} pageSize={20} count={rows.length} total={total} unit="invoices" />}
      >
        {list.isLoading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : list.isError ? (
          <EmptyBlock title="Failed to load" description="Check the API connection and retry." />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No invoices" description="Counter sales appear here once posted." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Customer</th>
                <th className="!text-right">Total</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/sales/invoices/${r.id}`} className="g-metric font-medium text-ink hover:text-gold-700">
                      {r.number}
                    </Link>
                  </td>
                  <td>{r.customer_name ?? <span className="text-ink-4">Walk-in</span>}</td>
                  <td className="!text-right num-tabular font-medium text-ink">{fmt(r.total_cents)}</td>
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
