"use client";

import { MasterCrud } from "@/components/master-crud";
import { GemIcon } from "@/components/icons";

export default function StoneTypesPage() {
  return (
    <MasterCrud
        icon={GemIcon}
      title="Stone Types"
      subtitle="Gemstone, diamond, and stone classification masters"
      endpoint="/api/v1/masters/stone-types"
      columns={[
        { key: "name", label: "Stone Name" },
        { key: "code", label: "Code" },
      ]}
      fields={[
        { name: "name", label: "Stone Name", type: "text", required: true },
        { name: "code", label: "Code", type: "text", required: true },
      ]}
      emptyHint="No stone types found. Standard types include None, Diamond, Ruby, Sapphire, Emerald, Pearl."
      note="Stone types categorize gem and non-metal weights across products"
    />
  );
}
