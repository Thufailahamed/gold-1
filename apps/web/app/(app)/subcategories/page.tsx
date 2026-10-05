"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MasterCrud } from "@/components/master-crud";

export default function SubcategoriesPage() {
  const cats = useQuery({
    queryKey: ["categories-for-subcats"],
    queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/masters/categories?limit=100"),
  });

  const categoryOptions = (cats.data?.rows ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }));

  return (
    <MasterCrud
      title="Subcategories"
      subtitle="Detailed sub-classifications under main categories"
      endpoint="/api/v1/masters/subcategories"
      columns={[
        { key: "name", label: "Subcategory Name" },
        { key: "code", label: "Code" },
      ]}
      fields={[
        {
          name: "categoryId",
          label: "Parent Category",
          type: "select",
          options: categoryOptions,
          required: true,
        },
        { name: "name", label: "Subcategory Name", type: "text", required: true },
        { name: "code", label: "Code", type: "text", required: true },
      ]}
      emptyHint="No subcategories yet. Add specific items like Bridal Ring, Rope Chain, Jhumka, or Locket."
      note="Subcategories narrow down product search, tag layouts, and filtering"
    />
  );
}
