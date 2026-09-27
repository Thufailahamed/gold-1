"use client";

import { MasterCrud } from "@/components/master-crud";

export default function CategoriesPage() {
  return (
    <MasterCrud
      title="Categories"
      subtitle="Product categories for the catalog"
      endpoint="/api/v1/masters/categories"
      columns={[
        { key: "name", label: "Name" },
        { key: "code", label: "Code" },
        { key: "description", label: "Description" },
      ]}
      fields={[
        { name: "name", label: "Name", type: "text", required: true },
        { name: "code", label: "Code", type: "text", required: true },
        { name: "description", label: "Description", type: "text" },
      ]}
      deactivateEndpoint={(id) => `/api/v1/masters/categories/${id}/deactivate`}
      emptyHint="No categories yet. Create the first one."
      note="Categories group pieces for reporting, filters and pricing"
    />
  );
}
