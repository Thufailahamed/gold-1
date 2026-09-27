"use client";

import { useState } from "react";
import { MasterCrud, type CrudColumn, type CrudField } from "@/components/master-crud";
import { LedgerDrawer } from "../suppliers/page";

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

export default function CustomersPage() {
  const [defaults] = useState(branchDefault);
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  return (
    <>
      <MasterCrud
        title="Customers"
        subtitle="Retail and wholesale customers"
        endpoint="/api/v1/customers"
        columns={PARTY_COLUMNS}
        fields={PARTY_FIELDS}
        deactivateEndpoint={(id) => `/api/v1/customers/${id}/status`}
        deactivateBody={(reason) => ({ isActive: 0, reason })}
        defaults={defaults}
        emptyHint="No customers yet. Create the first one."
        note="Customers attach to sales, credit limits and ledgers"
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
        <LedgerDrawer endpoint="/api/v1/customers" id={ledgerId} onClose={() => setLedgerId(null)} />
      ) : null}
    </>
  );
}
