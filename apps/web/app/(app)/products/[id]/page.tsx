"use client";

import { use } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";

type Detail = {
  product: {
    id: string;
    barcode: string;
    name: string;
    category_name: string;
    karat: string;
    gross_weight: number;
    stone_weight: number;
    net_weight: number;
    making_charge: number;
    status: string;
    branch_id: string;
  };
  livePrice: { amount: number; ratePerGram: number; rateEffectiveFrom: number } | null;
  noRate: boolean;
};

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["product", id],
    queryFn: () => api<Detail>(`/api/v1/products/${id}`),
  });
  const labelUrl = `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787"}/api/v1/products/${id}/label`;

  const voidIt = useMutation({
    mutationFn: (reason: string) =>
      api(`/api/v1/products/${id}/void`, { method: "PATCH", body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      toast.success("Product voided");
      qc.invalidateQueries({ queryKey: ["product", id] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Void failed"),
  });

  function onVoid() {
    const reason = window.prompt("Reason for void (required):");
    if (!reason) return;
    voidIt.mutate(reason);
  }

  if (detail.isLoading) return <div className="h-64 animate-pulse rounded-xl bg-stone-200" />;
  if (detail.isError || !detail.data)
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Product not found. <button onClick={() => router.push("/products")} className="underline">Back to list</button>
      </div>
    );
  const { product, livePrice, noRate } = detail.data;

  return (
    <div className="space-y-4">
      <button onClick={() => router.push("/products")} className="text-sm text-stone-500 hover:underline">
        ← Products
      </button>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{product.name}</h1>
          <p className="font-mono text-sm text-stone-500">{product.barcode}</p>
        </div>
        {product.status === "in_stock" ? (
          <button onClick={onVoid} className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
            Void
          </button>
        ) : (
          <span className="rounded-md bg-stone-200 px-3 py-1.5 text-sm">{product.status}</span>
        )}
      </div>
      {noRate || !livePrice ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          No rate published for {product.karat} — price unavailable.
        </div>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-stone-500">Live price</p>
          <p className="text-3xl font-semibold">{livePrice.amount.toLocaleString("en-US")} LKR</p>
          <p className="mt-1 text-xs text-stone-400">
            {product.net_weight}g × {livePrice.ratePerGram.toLocaleString("en-US")} + {product.making_charge.toLocaleString("en-US")} making
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["Category", product.category_name],
          ["Karat", product.karat],
          ["Gross", `${product.gross_weight}g`],
          ["Stone", `${product.stone_weight}g`],
          ["Net", `${product.net_weight}g`],
          ["Making", `${product.making_charge.toLocaleString("en-US")} LKR`],
          ["Status", product.status],
          ["Branch", product.branch_id],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-xs text-stone-500">{k}</p>
            <p className="mt-1 font-medium">{v}</p>
          </div>
        ))}
      </div>
      <div className="print-area rounded-xl border border-stone-200 bg-white p-4">
        <p className="mb-2 text-sm font-medium">Barcode label</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={labelUrl} alt={`Label for ${product.barcode}`} className="max-w-sm" />
        <button
          onClick={() => window.print()}
          className="mt-3 rounded-md bg-stone-900 px-3 py-2 text-sm text-white print:hidden"
        >
          Print label
        </button>
      </div>
    </div>
  );
}
