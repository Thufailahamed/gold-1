"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MasterCrud, type CrudColumn, type CrudField } from "@/components/master-crud";
import { api } from "@/lib/api";

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
  { name: "openingBalance", label: "Opening balance (LKR)", type: "number" },
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
  debits: number;
  credits: number;
  balance: number;
  lines: {
    id: string;
    account_code: string;
    debit_cents: number;
    credit_cents: number;
    ref_entity: string;
    memo: string | null;
    created_at: number;
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
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30">
      <div className="w-full max-w-lg space-y-4 overflow-y-auto bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Ledger</h2>
          <button onClick={onClose} className="text-sm text-stone-500 hover:underline">
            Close
          </button>
        </div>
        {detail.data ? (
          <div className="space-y-1 text-sm">
            <p className="font-mono text-xs text-stone-500">{detail.data.code}</p>
            <p className="font-medium">{detail.data.name}</p>
            <p className="text-stone-500">{detail.data.phone ?? "—"} · {detail.data.nic ?? "no NIC"}</p>
            {detail.data.notes ? <p className="text-stone-600">{detail.data.notes}</p> : null}
          </div>
        ) : null}
        {ledger.data ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["Opening", fmt(ledger.data.opening)],
                ["Balance", fmt(ledger.data.balance)],
                ["Debits", fmt(ledger.data.debits)],
                ["Credits", fmt(ledger.data.credits)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-stone-200 p-3">
                  <p className="text-xs text-stone-500">{k}</p>
                  <p className="font-semibold">{v} LKR</p>
                </div>
              ))}
            </div>
            {ledger.data.lines.length === 0 ? (
              <p className="text-sm text-stone-500">No transactions yet — the ledger starts with the first purchase or payment.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
                    <th className="py-2">Account</th>
                    <th className="py-2">DR</th>
                    <th className="py-2">CR</th>
                    <th className="py-2">Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.data.lines.map((l) => (
                    <tr key={l.id} className="border-b border-stone-100 last:border-0">
                      <td className="py-2 font-mono text-xs">{l.account_code}</td>
                      <td className="py-2">{l.debit_cents ? fmt(l.debit_cents) : "—"}</td>
                      <td className="py-2">{l.credit_cents ? fmt(l.credit_cents) : "—"}</td>
                      <td className="py-2 text-xs text-stone-500">{l.ref_entity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <div className="h-32 animate-pulse rounded-lg bg-stone-200" />
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
