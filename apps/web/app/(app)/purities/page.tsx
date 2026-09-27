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
        { key: "permille", label: "Permille" },
        { key: "default_making_cents", label: "Making (cents)" },
        { key: "default_wastage_mg", label: "Wastage (mg)" },
      ]}
      fields={[
        { name: "karat", label: "Karat (e.g. 22K)", type: "text", required: true },
        { name: "permille", label: "Permille (e.g. 916)", type: "number", required: true },
        { name: "defaultMakingLkr", label: "Default making LKR", type: "number" },
        { name: "defaultWastageMg", label: "Default wastage mg", type: "number" },
      ]}
      deactivateEndpoint={(id) => `/api/v1/masters/purities/${id}/deactivate`}
      emptyHint="No purities yet."
      note="Purities drive board rates and fine-gold calculations"
    />
  );
}
