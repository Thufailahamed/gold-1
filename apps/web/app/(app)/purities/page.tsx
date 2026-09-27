"use client";

import { MasterCrud } from "@/components/master-crud";

export default function PuritiesPage() {
  return (
    <MasterCrud
      title="Purities"
      subtitle="Karat definitions with default charges"
      endpoint="/api/v1/masters/purities"
      columns={[
        { key: "karat", label: "Karat" },
        { key: "purity", label: "Purity" },
        { key: "default_making_charge", label: "Making charge" },
        { key: "default_wastage_pct", label: "Wastage %" },
      ]}
      fields={[
        { name: "karat", label: "Karat (e.g. 22K)", type: "text", required: true },
        { name: "purity", label: "Purity decimal (e.g. 0.916)", type: "number", required: true },
        { name: "defaultMakingCharge", label: "Default making charge", type: "number" },
        { name: "defaultWastagePct", label: "Default wastage %", type: "number" },
      ]}
      deactivateEndpoint={(id) => `/api/v1/masters/purities/${id}/deactivate`}
      emptyHint="No purities yet."
    />
  );
}
