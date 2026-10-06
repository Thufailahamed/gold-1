import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MasterCrud, type CrudColumn, type CrudField } from "./MasterCrud";

const simple = (title: string, subtitle: string, path: string, noun: string, emptyHint: string, note: string, deactivate = false) =>
  function SimpleMaster() {
    return (
      <MasterCrud
        title={title}
        subtitle={subtitle}
        endpoint={`/api/v1/masters/${path}`}
        columns={[
          { key: "name", label: noun },
          { key: "code", label: "Code" },
          ...(path === "categories" ? [{ key: "description", label: "Description" }] : []),
        ]}
        fields={[
          { name: "name", label: noun, type: "text", required: true },
          { name: "code", label: "Code", type: "text", required: true },
          ...(path === "categories" ? [{ name: "description", label: "Description", type: "text" as const }] : []),
        ]}
        deactivateEndpoint={deactivate ? (id) => `/api/v1/masters/${path}/${id}/deactivate` : undefined}
        emptyHint={emptyHint}
        note={note}
      />
    );
  };

export const CategoriesScreen = simple("Categories", "Product categories for the catalog", "categories", "Name", "No categories yet. Create the first one.", "Categories group pieces for reporting, filters and pricing", true);
export const DesignsScreen = simple("Designs", "Jewellery pattern, style and design masters", "designs", "Design name", "No designs created yet. Add designs like Traditional, Modern, Filigree, Antique, or Floral.", "Designs categorize stylistic attributes of pieces across the catalog");
export const ProductTypesScreen = simple("Product Types", "Production and inventory piece classifications", "product-types", "Type name", "No product types yet. Add classifications like Finished Jewellery, Plain Gold, Mount, or Studded.", "Product types define the commercial or production classification of inventory items");
export const MetalTypesScreen = simple("Metal Types", "Precious metal types across gold, silver, platinum, etc.", "metal-types", "Metal name", "No metal types found. Standard types include Gold, Silver, Platinum.", "Metal types define base materials for catalog pieces and vault inventories");
export const StoneTypesScreen = simple("Stone Types", "Gemstone, diamond, and stone classification masters", "stone-types", "Stone name", "No stone types found. Standard types include None, Diamond, Ruby, Sapphire, Emerald, Pearl.", "Stone types categorize gem and non-metal weights across products");

export function SubcategoriesScreen() {
  const cats = useQuery({ queryKey: ["master-all", "categories"], queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/masters/categories?limit=100") });
  return (
    <MasterCrud
      title="Subcategories"
      subtitle="Detailed sub-classifications under main categories"
      endpoint="/api/v1/masters/subcategories"
      columns={[
        { key: "name", label: "Subcategory" },
        { key: "code", label: "Code" },
      ]}
      fields={[
        { name: "categoryId", label: "Parent category", type: "select", options: (cats.data?.rows ?? []).map((c) => ({ value: c.id, label: c.name })), required: true },
        { name: "name", label: "Subcategory name", type: "text", required: true },
        { name: "code", label: "Code", type: "text", required: true },
      ]}
      emptyHint="No subcategories yet. Add specific items like Bridal Ring, Rope Chain, Jhumka, or Locket."
      note="Subcategories narrow down product search, tag layouts, and filtering"
    />
  );
}

export function PuritiesScreen() {
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

const PARTY_COLUMNS: CrudColumn[] = [
  { key: "name", label: "Name" },
  { key: "code", label: "Code" },
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
  { name: "branchId", label: "Branch", type: "branch", required: true },
];

export function CustomersScreen() {
  return (
    <MasterCrud
      title="Customers"
      subtitle="Retail and wholesale customers"
      endpoint="/api/v1/customers"
      columns={PARTY_COLUMNS}
      fields={PARTY_FIELDS}
      deactivateEndpoint={(id) => `/api/v1/customers/${id}/status`}
      deactivateBody={(reason) => ({ isActive: 0, reason })}
      emptyHint="No customers yet. Create the first one."
      note="Customers attach to sales, credit limits and ledgers"
      ledger
    />
  );
}

export function SuppliersScreen() {
  return (
    <MasterCrud
      title="Suppliers"
      subtitle="Gold and goods suppliers"
      endpoint="/api/v1/suppliers"
      columns={PARTY_COLUMNS}
      fields={PARTY_FIELDS}
      deactivateEndpoint={(id) => `/api/v1/suppliers/${id}/status`}
      deactivateBody={(reason) => ({ isActive: 0, reason })}
      emptyHint="No suppliers yet. Create the first one."
      note="Suppliers link to intake, purchasing and old-gold settlements"
      ledger
    />
  );
}
