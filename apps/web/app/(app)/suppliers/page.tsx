"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MasterCrud, type CrudColumn, type CrudField } from "@/components/master-crud";
import { api } from "@/lib/api";
import { EmptyBlock, Skeleton } from "@/components/ui";
import { XIcon } from "@/components/icons";

const PARTY_COLUMNS: CrudColumn[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "nic", label: "NIC" },
  { key: "credit_limit", label: "Credit limit" },
];

const PARTY_FIELDS: CrudField[] = [
  { name: "name", label: "Name", type: "text", required: true },
  { name: "phone", label: "Phone", type: "text" },
  { name: "address", label: "Address", type: "text" },
  { name: "nic", label: "NIC", type: "text" },
  { name: "notes", label: "Notes", type: "text" },
  { name: "creditLimit", label: "Credit limit (LKR)", type: "number" },
  { name: "branchId", label: "Branch ID", type: "text", required: true },
];

function branchDefault(): Record<string, string> | undefined {
  if (typeof document === "undefined") return undefined;
  const saved = document.cookie
    .split("; ")
    .find((c) => c.startsWith("goldos_branch="))
    ?.split("=")[1];
  return saved ? { branchId: saved } : undefined;
}

type Ledger = {
  opening: number;
  debitSales: number;
  creditPayments: number;
  creditReturns: number;
  creditPurchases: number;
  debitPayments: number;
  debitReturns: number;
  closing: number;
  lines: {
    entryId: string;
    entryNo: string;
    entryDate: string;
    refEntity: string;
    refNo: string | null;
    memo: string | null;
    debitCents: number;
    creditCents: number;
  }[];
};

export function LedgerDrawer({
  endpoint,
  id,
  onClose,
}: {
  endpoint: string;
  id: string;
  onClose: () => void;
}) {
  const detail = useQuery({
    queryKey: [endpoint, id],
    queryFn: () =>
      api<{ code: string; name: string; phone: string | null; nic: string | null; notes: string | null }>(
        `${endpoint}/${id}`
      ),
  });
  const ledger = useQuery({
    queryKey: [endpoint, id, "ledger"],
    queryFn: () => api<Ledger>(`${endpoint}/${id}/ledger`),
  });
  const fmt = (c: number) => (c / 100).toLocaleString("en-US");
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="h-full w-full max-w-lg animate-slide-in space-y-5 overflow-y-auto border-l border-ink/10 bg-paper p-6 shadow-floating scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="g-kicker">Ledger</div>
            <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-ink">
              {detail.data ? detail.data.name : "Account ledger"}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-ink-4 transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <XIcon size={16} />
          </button>
        </div>
        {detail.data ? (
          <div className="g-surface space-y-1 rounded-xl p-4 text-sm">
            <p className="g-metric text-xs text-ink-4">{detail.data.code}</p>
            <p className="font-medium text-ink">{detail.data.name}</p>
            <p className="text-ink-3">{detail.data.phone ?? "—"} · {detail.data.nic ?? "no NIC"}</p>
            {detail.data.notes ? <p className="text-ink-2">{detail.data.notes}</p> : null}
          </div>
        ) : null}
        {ledger.data ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              {[
                ["Opening", fmt(ledger.data.opening)],
                ["Closing", fmt(ledger.data.closing)],
                ["Sales / Purchases", fmt(ledger.data.debitSales + ledger.data.creditPurchases)],
                ["Payments", fmt(ledger.data.creditPayments + ledger.data.debitPayments)],
                ["Returns", fmt(ledger.data.creditReturns + ledger.data.debitReturns)],
              ].map(([k, v]) => (
                <div key={k} className="g-surface rounded-xl p-3.5">
                  <p className="g-kicker !text-[10px]">{k}</p>
                  <p className="g-metric mt-1 text-base font-semibold text-ink">{v} <span className="text-xs font-normal text-ink-3">LKR</span></p>
                </div>
              ))}
            </div>
            {ledger.data.lines.length === 0 ? (
              <EmptyBlock
                title="No transactions yet"
                description="The ledger starts with the first purchase or payment."
              />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-ink/10">
                <table className="g-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Entry</th>
                      <th>Ref</th>
                      <th className="!text-right">DR</th>
                      <th className="!text-right">CR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.data.lines.map((l) => (
                      <tr key={l.entryId}>
                        <td className="text-xs text-ink-3">{l.entryDate}</td>
                        <td className="g-metric text-xs">{l.entryNo}</td>
                        <td className="text-xs text-ink-4">{l.refNo ?? l.refEntity}</td>
                        <td className="!text-right num-tabular">{l.debitCents ? fmt(l.debitCents) : "—"}</td>
                        <td className="!text-right num-tabular">{l.creditCents ? fmt(l.creditCents) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <Skeleton className="h-32" />
        )}
      </div>
    </div>
  );
}

export default function SuppliersPage() {
  const [defaults] = useState(branchDefault);
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  return (
    <>
      <MasterCrud
        title="Suppliers"
        subtitle="Gold and goods suppliers"
        endpoint="/api/v1/suppliers"
        columns={PARTY_COLUMNS}
        fields={PARTY_FIELDS}
        deactivateEndpoint={(id) => `/api/v1/suppliers/${id}/status`}
        deactivateBody={(reason) => ({ isActive: 0, reason })}
        defaults={defaults}
        emptyHint="No suppliers yet. Create the first one."
        note="Suppliers link to intake, purchasing and old-gold settlements"
        renderActions={(row, { onDeactivate }) => (
          <span className="flex justify-end gap-3">
            <button
              onClick={() => setLedgerId(String(row.id))}
              className="text-xs font-medium hover:underline"
            >
              Ledger
            </button>
            {row.is_active ? (
              <button
                onClick={() => onDeactivate(String(row.id))}
                className="text-xs font-medium text-rose-700 hover:underline"
              >
                Deactivate
              </button>
            ) : null}
          </span>
        )}
      />
      {ledgerId ? (
        <LedgerDrawer endpoint="/api/v1/suppliers" id={ledgerId} onClose={() => setLedgerId(null)} />
      ) : null}
    </>
  );
}
