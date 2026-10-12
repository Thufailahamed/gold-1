"use client";

import { useState } from "react";
import { MasterCrud, type CrudColumn, type CrudField } from "@/components/master-crud";
import { LedgerDrawer } from "@/components/party-ledger";
import { BookOpenIcon, TruckIcon } from "@/components/icons";

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

export default function SuppliersPage() {
  const [defaults] = useState(branchDefault);
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  return (
    <>
      <MasterCrud
        icon={TruckIcon}
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
          <span className="flex justify-end gap-1">
            <button
              onClick={() => setLedgerId(String(row.id))}
              className="inline-flex items-center gap-1 rounded-md bg-void px-2 py-1 text-[11px] font-semibold text-gold-light transition-colors hover:bg-void/85"
            >
              <BookOpenIcon size={11} />
              Ledger
            </button>
            {row.is_active ? (
              <button
                onClick={() => onDeactivate(String(row.id))}
                className="rounded-md px-2 py-1 text-[11px] font-semibold text-rose-700 transition-colors hover:bg-rose-500/10"
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
