"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ScanField } from "@/components/scan-field";

type Product = {
  id: string;
  barcode: string;
  name: string;
  category_name: string;
  karat: string;
  gross_weight: number;
  net_weight: number;
  status: string;
};

type Option = { id: string; name?: string; karat?: string };

const productSchema = z.object({
  name: z.string().min(1).max(100),
  categoryId: z.string().min(1),
  purityId: z.string().min(1),
  grossWeight: z.coerce.number().gt(0),
  stoneWeight: z.coerce.number().min(0).optional().default(0),
  makingCharge: z.coerce.number().min(0).optional().default(0),
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
  const gross = watch("grossWeight");
  const stone = watch("stoneWeight");

  const list = useQuery({
    queryKey: ["products", search, page],
    queryFn: () =>
      api<{ rows: Product[]; total: number }>(
        `/api/v1/products?search=${encodeURIComponent(search)}&page=${page}&limit=20`
      ),
  });
  const cats = useQuery({
    queryKey: ["categories-all"],
    queryFn: () => api<{ rows: Option[]; total: number }>("/api/v1/masters/categories?limit=100"),
  });
  const purs = useQuery({
    queryKey: ["purities-all"],
    queryFn: () => api<{ rows: Option[]; total: number }>("/api/v1/masters/purities?limit=100"),
  });
  const create = useMutation({
    mutationFn: (v: z.infer<typeof productSchema>) =>
      api("/api/v1/products", { method: "POST", body: JSON.stringify(v) }),
    onSuccess: () => {
      toast.success("Product created");
      setDialog(false);
      reset();
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  const rows = list.data?.rows ?? [];
  const netPreview =
    typeof gross === "number" && typeof stone === "number" ? gross - stone : null;

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
      <input
        placeholder="Search name or barcode…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        className="w-full max-w-sm rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
      />
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
          No products yet. Create the first piece.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
                <th className="px-4 py-2">Barcode</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Category</th>
                <th className="px-4 py-2">Karat</th>
                <th className="px-4 py-2">Net g</th>
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
                  <td className="px-4 py-2">{r.name}</td>
                  <td className="px-4 py-2">{r.category_name}</td>
                  <td className="px-4 py-2">{r.karat}</td>
                  <td className="px-4 py-2">{r.net_weight}</td>
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
            className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-xl bg-white p-6 shadow-lg"
          >
            <h2 className="font-semibold">New product</h2>
            <div>
              <label className="mb-1 block text-sm font-medium">Name</label>
              <input
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                {...register("name")}
              />
              {errors.name ? <p className="mt-1 text-xs text-red-600">Required</p> : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Category</label>
                <select
                  className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                  {...register("categoryId")}
                >
                  <option value="">Select…</option>
                  {(cats.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {errors.categoryId ? <p className="mt-1 text-xs text-red-600">Required</p> : null}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Purity</label>
                <select
                  className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                  {...register("purityId")}
                >
                  <option value="">Select…</option>
                  {(purs.data?.rows ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.karat}
                    </option>
                  ))}
                </select>
                {errors.purityId ? <p className="mt-1 text-xs text-red-600">Required</p> : null}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Gross g</label>
                <input
                  type="number"
                  step="any"
                  className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                  {...register("grossWeight")}
                />
                {errors.grossWeight ? <p className="mt-1 text-xs text-red-600">Above 0</p> : null}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Stone g</label>
                <input
                  type="number"
                  step="any"
                  className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                  {...register("stoneWeight")}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Making LKR</label>
                <input
                  type="number"
                  step="any"
                  className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                  {...register("makingCharge")}
                />
              </div>
            </div>
            {netPreview !== null ? (
              <p className="text-sm text-stone-500">Net weight: {netPreview}g</p>
            ) : null}
            <div>
              <label className="mb-1 block text-sm font-medium">Branch ID</label>
              <input
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                {...register("branchId")}
              />
              {errors.branchId ? <p className="mt-1 text-xs text-red-600">Required</p> : null}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(false)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={create.isPending}
                className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {create.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
