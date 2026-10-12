"use client";

import { MasterCrud } from "@/components/master-crud";
import { LayersIcon } from "@/components/icons";

export default function MetalTypesPage() {
  return (
    <MasterCrud
        icon={LayersIcon}
      title="Metal Types"
      subtitle="Precious metal types across gold, silver, platinum, etc."
      endpoint="/api/v1/masters/metal-types"
      columns={[
        { key: "name", label: "Metal Name" },
        { key: "code", label: "Code" },
      ]}
      fields={[
        { name: "name", label: "Metal Name", type: "text", required: true },
        { name: "code", label: "Code", type: "text", required: true },
      ]}
      emptyHint="No metal types found. Standard types include Gold, Silver, Platinum."
      note="Metal types define base materials for catalog pieces and vault inventories"
    />
  );
}
