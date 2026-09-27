"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { toast } from "sonner";
import { centsToLkr, mgToG } from "@goldos/shared";
import { api } from "@/lib/api";
import { ScanField } from "@/components/scan-field";

type Product = {
  id: string;
  barcode: string;
  sku: string;
  name: string;
  category_name: string;
  karat: string;
  net_mg: number;
  fine_gold_mg: number;
  selling_price_cents: number | null;
  status: string;
};

type Option = { id: string; name?: string; karat?: string; code?: string };

const STATUSES = [
  "IN_STOCK",
  "RESERVED",
  "SOLD",
  "RETURNED",
  "IN_REPAIR",
  "IN_MANUFACTURING",
  "TRANSFER_PENDING",
  "MELTING",
  "MELTED",
  "LOST",
  "VOID",
];

const productSchema = z.object({
  name: z.string().min(1).max(100),
  categoryId: z.string().min(1),
  subcategoryId: z.string().optional(),
  designId: z.string().optional(),
  productTypeId: z.string().optional(),
  metalTypeId: z.string().min(1),
  stoneTypeId: z.string().optional(),
  purityId: z.string().min(1),
  grossG: z.coerce.number().gt(0),
  stoneG: z.coerce.number().min(0).optional().default(0),
  makingLkr: z.coerce.number().min(0).optional().default(0),
  wastageG: z.coerce.number().min(0).optional().default(0),
  costLkr: z.coerce.number().min(0).optional(),
  sellingPriceLkr: z.coerce.number().min(0).optional(),
  location: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  branchId: z.string().min(1),
});

function branchDefault(): Record<string, string> | undefined {
  if (typeof document === "undefined") return undefined;
  const saved = document.cookie
    .split("; ")
    .find((c) => c.startsWith("goldos_branch="))
    ?.split("=")[1];
  return saved ? { branchId: saved } : undefined;
}

export default function ProductsPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [fCat, setFCat] = useState("");
  const [fPur, setFPur] = useState("");
  const [fBranch, setFBranch] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fMinG, setFMinG] = useState("");
  const [fMaxG, setFMaxG] = useState("");
  const [fMinP, setFMinP] = useState("");
  const [fMaxP, setFMaxP] = useState("");
  const [dialog, setDialog] = useState(false);
  const [defaults] = useState(branchDefault);
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<z.infer<typeof productSchema>>({
    resolver: zodResolver(productSchema),
    defaultValues: defaults as z.infer<typeof productSchema> | undefined,
  });
  const gross = watch("grossG");
  const stone = watch("stoneG");

  function query(): string {
    const p = new URLSearchParams({
      search,
      page: String(page),
      limit: "20",
    });
    if (fCat) p.set("categoryId", fCat);
    if (fPur) p.set("purityId", fPur);
    if (fBranch) p.set("branchId", fBranch);
    if (fStatus) p.set("status", fStatus);
    if (fMinG) p.set("minG", fMinG);
    if (fMaxG) p.set("maxG", fMaxG);
    if (fMinP) p.set("minPriceLkr", fMinP);
    if (fMaxP) p.set("maxPriceLkr", fMaxP);
    return `/api/v1/products?${p.toString()}`;
  }

  const list = useQuery({
    queryKey: ["products", search, page, fCat, fPur, fBranch, fStatus, fMinG, fMaxG, fMinP, fMaxP],
    queryFn: () => api<{ rows: Product[]; total: number }>(query()),
  });
  const cats = useQuery({
    queryKey: ["categories-all"],
    queryFn: () => api<{ rows: Option[]; total: number }>("/api/v1/masters/categories?limit=100"),
  });
  const purs = useQuery({
    queryKey: ["purities-all"],
    queryFn: () => api<{ rows: Option[]; total: number }>("/api/v1/masters/purities?limit=100"),
  });
  const metals = useQuery({
    queryKey: ["metals-all"],
    queryFn: () =>
      api<{ rows: Option[]; total: number }>("/api/v1/masters/metal-types?limit=100"),
  });
  const stones = useQuery({
    queryKey: ["stones-all"],
    queryFn: () =>
      api<{ rows: Option[]; total: number }>("/api/v1/masters/stone-types?limit=100"),
  });
  const designs = useQuery({
    queryKey: ["designs-all"],
    queryFn: () => api<{ rows: Option[]; total: number }>("/api/v1/masters/designs?limit=100"),
  });
  const ptypes = useQuery({
    queryKey: ["ptypes-all"],
    queryFn: () =>
      api<{ rows: Option[]; total: number }>("/api/v1/masters/product-types?limit=100"),
  });
  const subcats = useQuery({
    queryKey: ["subcats-all"],
    queryFn: () =>
      api<{ rows: Option[]; total: number }>("/api/v1/masters/subcategories?limit=100"),
  });
  const [images, setImages] = useState<File[]>([]);
  const create = useMutation({
    mutationFn: async (v: z.infer<typeof productSchema>) => {
      const created = await api<{ id: string }>("/api/v1/products", {
        method: "POST",
        body: JSON.stringify(v),
      });
      for (const f of images.slice(0, 10)) {
        const form = new FormData();
        form.append("file", f);
        await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787"}/api/v1/products/${created.id}/images`,
          { method: "POST", body: form, credentials: "include" }
        );
      }
      return created;
    },
    onSuccess: () => {
      toast.success("Product created");
      setDialog(false);
      reset();
      setImages([]);
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  const rows = list.data?.rows ?? [];
  const netPreview =
    typeof gross === "number" && typeof stone === "number" ? gross - stone : null;
  const inputCls =
    "w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Products</h1>
          <p className="text-sm text-stone-500">Unique pieces with barcodes</p>
        </div>
        <button
          onClick={() => setDialog(true)}
          className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
        >
          New
        </button>
      </div>
      <ScanField />
      <div className="flex flex-wrap gap-2">
        <input
          placeholder="Search name, barcode, SKU…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="w-full max-w-sm rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <select value={fCat} onChange={(e) => { setFCat(e.target.value); setPage(1); }} className={inputCls}>
          <option value="">All categories</option>
          {(cats.data?.rows ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={fPur} onChange={(e) => { setFPur(e.target.value); setPage(1); }} className={inputCls}>
          <option value="">All purities</option>
          {(purs.data?.rows ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.karat}</option>
          ))}
        </select>
        <select value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(1); }} className={inputCls}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input placeholder="Branch ID" value={fBranch} onChange={(e) => { setFBranch(e.target.value); setPage(1); }} className={inputCls} />
        <input placeholder="Min grams" type="number" step="any" value={fMinG} onChange={(e) => { setFMinG(e.target.value); setPage(1); }} className={inputCls} />
        <input placeholder="Max grams" type="number" step="any" value={fMaxG} onChange={(e) => { setFMaxG(e.target.value); setPage(1); }} className={inputCls} />
        <input placeholder="Min price LKR" type="number" step="any" value={fMinP} onChange={(e) => { setFMinP(e.target.value); setPage(1); }} className={inputCls} />
        <input placeholder="Max price LKR" type="number" step="any" value={fMaxP} onChange={(e) => { setFMaxP(e.target.value); setPage(1); }} className={inputCls} />
      </div>
      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-stone-200" />
          ))}
        </div>
      ) : list.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load. Check the API connection and retry.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
          No products match these filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
                <th className="px-4 py-2">Barcode</th>
                <th className="px-4 py-2">SKU</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Category</th>
                <th className="px-4 py-2">Karat</th>
                <th className="px-4 py-2">Net g</th>
                <th className="px-4 py-2">Fine g</th>
                <th className="px-4 py-2">Price</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-2 font-mono">
                    <Link href={`/products/${r.id}`} className="hover:underline">
                      {r.barcode}
                    </Link>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{r.sku}</td>
                  <td className="px-4 py-2">{r.name}</td>
                  <td className="px-4 py-2">{r.category_name}</td>
                  <td className="px-4 py-2">{r.karat}</td>
                  <td className="px-4 py-2">{mgToG(r.net_mg)}</td>
                  <td className="px-4 py-2">{mgToG(r.fine_gold_mg)}</td>
                  <td className="px-4 py-2">
                    {r.selling_price_cents !== null
                      ? centsToLkr(r.selling_price_cents).toLocaleString("en-US")
                      : "—"}
                  </td>
                  <td className="px-4 py-2">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog ? (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
          <form
            onSubmit={handleSubmit((v) => create.mutate(v))}
            className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl bg-white p-6 shadow-lg"
          >
            <h2 className="font-semibold">New product</h2>
            <div>
              <label className="mb-1 block text-sm font-medium">Name</label>
              <input className={inputCls} {...register("name")} />
              {errors.name ? <p className="mt-1 text-xs text-red-600">Required</p> : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Category</label>
                <select className={inputCls} {...register("categoryId")}>
                  <option value="">Select…</option>
                  {(cats.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Subcategory</label>
                <select className={inputCls} {...register("subcategoryId")}>
                  <option value="">None</option>
                  {(subcats.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Design</label>
                <select className={inputCls} {...register("designId")}>
                  <option value="">None</option>
                  {(designs.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Product type</label>
                <select className={inputCls} {...register("productTypeId")}>
                  <option value="">None</option>
                  {(ptypes.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Metal</label>
                <select className={inputCls} {...register("metalTypeId")}>
                  <option value="">Select…</option>
                  {(metals.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Stone</label>
                <select className={inputCls} {...register("stoneTypeId")}>
                  <option value="">None</option>
                  {(stones.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Purity</label>
                <select className={inputCls} {...register("purityId")}>
                  <option value="">Select…</option>
                  {(purs.data?.rows ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.karat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Branch ID</label>
                <input className={inputCls} {...register("branchId")} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Gross g</label>
                <input type="number" step="any" className={inputCls} {...register("grossG")} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Stone g</label>
                <input type="number" step="any" className={inputCls} {...register("stoneG")} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Wastage g</label>
                <input type="number" step="any" className={inputCls} {...register("wastageG")} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Making LKR</label>
                <input type="number" step="any" className={inputCls} {...register("makingLkr")} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Cost LKR</label>
                <input type="number" step="any" className={inputCls} {...register("costLkr")} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Price LKR</label>
                <input type="number" step="any" className={inputCls} {...register("sellingPriceLkr")} />
              </div>
            </div>
            {netPreview !== null ? (
              <p className="text-sm text-stone-500">Net weight: {netPreview}g</p>
            ) : null}
            <div>
              <label className="mb-1 block text-sm font-medium">Location</label>
              <input className={inputCls} {...register("location")} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Notes</label>
              <input className={inputCls} {...register("notes")} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Images (≤5MB each)</label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(e) => setImages(Array.from(e.target.files ?? []))}
                className="w-full text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDialog(false)} className="rounded-md border px-3 py-2 text-sm">
                Cancel
              </button>
              <button type="submit" disabled={create.isPending} className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50">
                {create.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}