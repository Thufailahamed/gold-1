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
import {
  Page,
  Hero,
  heroBtnPrimary,
  TableCard,
  TableSkeleton,
  Pager,
  StatusPill,
  EmptyBlock,
  Modal,
  controlClass,
} from "@/components/ui";
import { ArrowRightIcon, GemIcon, PlusIcon, SearchIcon } from "@/components/icons";

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
  const inputCls = controlClass;

  return (
    <Page>
      <Hero
        kicker="Catalog"
        title="Products"
        description="Unique pieces with barcodes, weights and live pricing."
        actions={
          <button onClick={() => setDialog(true)} className={heroBtnPrimary}>
            <PlusIcon size={15} />
            New product
            <ArrowRightIcon size={14} className="g-btn-arrow" />
          </button>
        }
        stats={[
          { label: "Pieces", value: list.isLoading ? "—" : (list.data?.total ?? 0).toLocaleString("en-US") },
          { label: "In stock (page)", value: list.isLoading ? "—" : rows.filter((r) => r.status === "IN_STOCK").length },
          { label: "Categories", value: cats.data?.total ?? "—" },
          { label: "Purities", value: purs.data?.total ?? "—" },
        ]}
        note="Every piece carries a unique barcode — print labels from the detail page"
      />

      <ScanField />

      <TableCard
        toolbar={
          <div className="flex flex-col gap-3">
            <div className="relative w-full max-w-sm">
              <SearchIcon
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"
              />
              <input
                placeholder="Search name, barcode, SKU…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className={`${inputCls} w-full pl-9`}
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
          </div>
        }
        footer={
          <Pager
            page={page}
            onChange={setPage}
            pageSize={20}
            count={rows.length}
            total={list.data?.total ?? 0}
            unit="products"
          />
        }
      >
        {list.isLoading ? (
          <TableSkeleton rows={6} cols={8} />
        ) : list.isError ? (
          <EmptyBlock
            title="Failed to load products"
            description="Check the API connection and retry."
          />
        ) : rows.length === 0 ? (
          <EmptyBlock
            title="No products found"
            description="No products match these filters. Adjust the search or create a new piece."
          />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Barcode</th>
                <th>SKU</th>
                <th>Name</th>
                <th>Category</th>
                <th>Karat</th>
                <th className="!text-right">Net g</th>
                <th className="!text-right">Fine g</th>
                <th className="!text-right">Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link
                      href={`/products/${r.id}`}
                      className="font-mono text-xs font-medium text-gold-dark transition-colors hover:text-ink"
                    >
                      {r.barcode}
                    </Link>
                  </td>
                  <td className="font-mono text-xs text-ink-4">{r.sku}</td>
                  <td>
                    <Link href={`/products/${r.id}`} className="group flex items-center gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-bone text-ink-4 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.06)] transition-colors group-hover:bg-ink group-hover:text-gold">
                        <GemIcon size={14} />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink group-hover:underline">
                          {r.name}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-ink-4">{r.category_name}</div>
                      </div>
                    </Link>
                  </td>
                  <td className="text-ink-3">{r.category_name}</td>
                  <td>{r.karat}</td>
                  <td className="num">{mgToG(r.net_mg)}</td>
                  <td className="num">{mgToG(r.fine_gold_mg)}</td>
                  <td className="num">
                    {r.selling_price_cents !== null
                      ? centsToLkr(r.selling_price_cents).toLocaleString("en-US")
                      : "—"}
                  </td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {dialog ? (
        <Modal title="New product" kicker="Catalog" onClose={() => setDialog(false)} footer={false} wide>
          <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">
                Name <span className="ml-0.5 text-gold-dark">*</span>
              </label>
              <input className={inputCls} {...register("name")} />
              {errors.name ? <p className="mt-1 text-xs text-rose-700">Required</p> : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">Category</label>
                <select className={inputCls} {...register("categoryId")}>
                  <option value="">Select…</option>
                  {(cats.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">Subcategory</label>
                <select className={inputCls} {...register("subcategoryId")}>
                  <option value="">None</option>
                  {(subcats.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">Design</label>
                <select className={inputCls} {...register("designId")}>
                  <option value="">None</option>
                  {(designs.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">Product type</label>
                <select className={inputCls} {...register("productTypeId")}>
                  <option value="">None</option>
                  {(ptypes.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">Metal</label>
                <select className={inputCls} {...register("metalTypeId")}>
                  <option value="">Select…</option>
                  {(metals.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">Stone</label>
                <select className={inputCls} {...register("stoneTypeId")}>
                  <option value="">None</option>
                  {(stones.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">Purity</label>
                <select className={inputCls} {...register("purityId")}>
                  <option value="">Select…</option>
                  {(purs.data?.rows ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.karat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">Branch ID</label>
                <input className={inputCls} {...register("branchId")} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">Gross g</label>
                <input type="number" step="any" className={inputCls} {...register("grossG")} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">Stone g</label>
                <input type="number" step="any" className={inputCls} {...register("stoneG")} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">Wastage g</label>
                <input type="number" step="any" className={inputCls} {...register("wastageG")} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">Making LKR</label>
                <input type="number" step="any" className={inputCls} {...register("makingLkr")} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">Cost LKR</label>
                <input type="number" step="any" className={inputCls} {...register("costLkr")} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">Price LKR</label>
                <input type="number" step="any" className={inputCls} {...register("sellingPriceLkr")} />
              </div>
            </div>
            {netPreview !== null ? (
              <p className="text-sm text-ink-4">
                Net weight: <span className="num-tabular text-ink">{netPreview}g</span>
              </p>
            ) : null}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">Location</label>
              <input className={inputCls} {...register("location")} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">Notes</label>
              <input className={inputCls} {...register("notes")} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">
                Images (≤5MB each)
              </label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(e) => setImages(Array.from(e.target.files ?? []))}
                className="w-full text-sm text-ink-4 file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-2 file:text-xs file:font-medium file:text-paper hover:file:bg-ink-2"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDialog(false)}
                className="g-btn g-btn-secondary h-10 px-4 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={create.isPending}
                className="g-btn g-btn-primary h-10 px-4 text-sm"
              >
                {create.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </Page>
  );
}
