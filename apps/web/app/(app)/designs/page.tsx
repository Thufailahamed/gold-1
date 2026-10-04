"use client";

import { MasterCrud } from "@/components/master-crud";

export default function DesignsPage() {
  return (
    <MasterCrud
      title="Designs"
      subtitle="Jewellery pattern, style and design masters"
      endpoint="/api/v1/masters/designs"
      columns={[
        { key: "name", label: "Design Name" },
        { key: "code", label: "Code" },
      ]}
      fields={[
        { name: "name", label: "Design Name", type: "text", required: true },
        { name: "code", label: "Code", type: "text", required: true },
      ]}
      emptyHint="No designs created yet. Add designs like Traditional, Modern, Filigree, Antique, or Floral."
      note="Designs categorize stylistic attributes of pieces across the catalog"
    />
  );
}
