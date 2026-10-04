"use client";

import { MasterCrud } from "@/components/master-crud";

export default function ProductTypesPage() {
  return (
    <MasterCrud
      title="Product Types"
      subtitle="Production and inventory piece classifications"
      endpoint="/api/v1/masters/product-types"
      columns={[
        { key: "name", label: "Type Name" },
        { key: "code", label: "Code" },
      ]}
      fields={[
        { name: "name", label: "Type Name", type: "text", required: true },
        { name: "code", label: "Code", type: "text", required: true },
      ]}
      emptyHint="No product types yet. Add classifications like Finished Jewellery, Plain Gold, Mount, or Studded."
      note="Product types define the commercial or production classification of inventory items"
    />
  );
}
