"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { EmptyBlock, Hero, Page, TableCard, TableSkeleton, Toolbar, controlSmClass } from "@/components/ui";
import { TruckIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { lkr, useAccountsScope } from "@/lib/accounts";

type Aging = { "0-30": number; "31-60": number; "61-90": number; "90+": number };
type Payable = {
  supplierId: string;
  name: string;
  phone: string | null;
  balanceCents: number;
  openInvoices: number;
  oldestOpenDate: string | null;
  aging: Aging;
};
type OpenInvoice = { invoiceId: string; number: string; date: string; totalCents: number; paidCents: number; outstandingCents: number };

export default function PayablesPage() {
  const { branchId, setBranchId, ready, canShop, visibleBranches } = useAccountsScope();
  const [expanded, setExpanded] = useState<string | null>(null);
  const bq = branchId ? `branchId=${encodeURIComponent(branchId)}` : "";

  const payables = useQuery({
    enabled: ready,
    queryKey: ["payables", branchId],
    queryFn: () => api<{ asOf: string; rows: Payable[]; totalCents: number; aging: Aging }>(`/api/v1/accounts/payables?${bq}`),
  });
  const rows = payables.data?.rows ?? [];
  const aging = payables.data?.aging;

  return (
    <Page>
      <Hero
        kicker="Accounts"
        back={{ href: "/accounts", label: "Accounts dashboard" }}
        title="Supplier dues"
        description="What the shop owes each supplier, straight from the payables account, with the unpaid bills behind it aged."
        stats={[
          { label: "Owed to suppliers", value: payables.data ? lkr(payables.data.totalCents) : "—" },
          { label: "Suppliers owed", value: payables.data ? rows.length.toLocaleString("en-US") : "—" },
          { label: "Older than 60 days", value: aging ? lkr(aging["61-90"] + aging["90+"]) : "—" },
          { label: "Older than 90 days", value: aging ? lkr(aging["90+"]) : "—" },
        ]}
        note="Pay a bill from its purchase invoice — the payment posts to the ledger and clears it here"
      />

      <Toolbar
        actions={
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={controlSmClass} aria-label="Branch">
            {canShop ? <option value="">All branches</option> : null}
            {visibleBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        }
      >
        <span className="text-sm text-ink-3">{payables.data ? `As of ${payables.data.asOf}` : null}</span>
      </Toolbar>

      <TableCard title="Outstanding to suppliers" icon={<TruckIcon size={17} />} description="Largest balance first. Open a supplier to see the unpaid bills.">
        {payables.isLoading || !ready ? (
          <TableSkeleton rows={5} cols={6} />
        ) : payables.isError ? (
          <EmptyBlock title="Could not load supplier dues" description={(payables.error as Error).message} />
        ) : rows.length === 0 ? (
          <EmptyBlock icon={<TruckIcon size={22} />} title="Nothing owed to suppliers" description="Purchases received on credit will show here until they are paid." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Supplier</th>
                <th className="!text-right">Open bills</th>
                <th>Oldest bill</th>
                <th className="!text-right">0–30 d</th>
                <th className="!text-right">31–60 d</th>
                <th className="!text-right">61–90 d</th>
                <th className="!text-right">90+ d</th>
                <th className="!text-right">Owed</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <SupplierRows
                  key={r.supplierId}
                  row={r}
                  branchQuery={bq}
                  open={expanded === r.supplierId}
                  onToggle={() => setExpanded((x) => (x === r.supplierId ? null : r.supplierId))}
                />
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </Page>
  );
}

function SupplierRows({ row, branchQuery, open, onToggle }: { row: Payable; branchQuery: string; open: boolean; onToggle: () => void }) {
  const invoices = useQuery({
    enabled: open,
    queryKey: ["payables", "open", row.supplierId, branchQuery],
    queryFn: () => api<{ invoices: OpenInvoice[] }>(`/api/v1/accounts/payables/suppliers/${encodeURIComponent(row.supplierId)}/open?${branchQuery}`),
  });
  const cell = (c: number, tone = "text-ink-3") => <td className={`!text-right num-tabular ${tone}`}>{c ? lkr(c) : "—"}</td>;
  return (
    <>
      <tr>
        <td>
          <div className="font-medium text-ink">{row.name}</div>
          {row.phone ? <div className="text-xs text-ink-4">{row.phone}</div> : null}
        </td>
        <td className="!text-right num-tabular">{row.openInvoices}</td>
        <td className="text-ink-3">{row.oldestOpenDate ?? "—"}</td>
        {cell(row.aging["0-30"])}
        {cell(row.aging["31-60"])}
        {cell(row.aging["61-90"], "text-amber-700")}
        {cell(row.aging["90+"], "text-rose-700")}
        <td className="!text-right num-tabular font-semibold text-ink">{lkr(row.balanceCents)}</td>
        <td className="!text-right">
          <button type="button" onClick={onToggle} className="g-btn g-btn-secondary h-8 px-3 text-xs" aria-expanded={open}>
            {open ? "Hide bills" : "Bills"}
          </button>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={9} className="!bg-bone/50">
            {invoices.isLoading ? (
              <TableSkeleton rows={2} cols={4} />
            ) : (invoices.data?.invoices.length ?? 0) === 0 ? (
              <p className="py-2 text-xs text-ink-4">No open bills — this balance is an opening balance.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-4">
                    <th className="py-1 font-medium">Bill</th>
                    <th className="py-1 font-medium">Date</th>
                    <th className="py-1 text-right font-medium">Total</th>
                    <th className="py-1 text-right font-medium">Paid</th>
                    <th className="py-1 text-right font-medium">Unpaid</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {invoices.data!.invoices.map((i) => (
                    <tr key={i.invoiceId} className="border-t border-ink/[0.06]">
                      <td className="py-1.5 font-mono text-xs">{i.number}</td>
                      <td className="py-1.5 text-ink-3">{i.date}</td>
                      <td className="py-1.5 text-right num-tabular">{lkr(i.totalCents)}</td>
                      <td className="py-1.5 text-right num-tabular text-ink-3">{lkr(i.paidCents)}</td>
                      <td className="py-1.5 text-right num-tabular font-medium text-ink">{lkr(i.outstandingCents)}</td>
                      <td className="py-1.5 text-right">
                        <Link href={`/purchases/invoices/${i.invoiceId}`} className="text-xs font-medium text-gold-dark underline">
                          Pay
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}
