"use client";

import { useState } from "react";
import { MasterCrud, type CrudColumn, type CrudField } from "@/components/master-crud";

const PARTY_COLUMNS: CrudColumn[] = [
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
  return (
    <MasterCrud
      title="Customers"
      subtitle="Retail and wholesale customers"
      endpoint="/api/v1/customers"
      columns={PARTY_COLUMNS}
      fields={PARTY_FIELDS}
      deactivateEndpoint={(id) => `/api/v1/customers/${id}`}
      deactivateBody={(reason) => ({ isActive: 0, reason })}
      defaults={defaults}
      emptyHint="No customers yet. Create the first one."
    />
  );
}
