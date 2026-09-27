"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { centsToLkr, mgToG } from "@goldos/shared";
import { api } from "@/lib/api";

type Detail = {
  product: {
    id: string;
    barcode: string;
    sku: string;
    name: string;
    category_name: string;
    karat: string;
    permille: number;
    gross_mg: number;
    stone_mg: number;
    net_mg: number;
    fine_gold_mg: number;
    making_cents: number;
    wastage_mg: number;
    cost_cents: number | null;
    selling_price_cents: number | null;
    location: string | null;
    notes: string | null;
    image_keys: string[];
    status: string;
    branch_id: string;
  };
  livePrice: { amount_cents: number; rate_cents_per_g: number; rate_effective_from: number } | null;
  noRate: boolean;
};

type Movement = {
  id: string;
  type: string;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  created_at: number;
};

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"specs" | "moves">("specs");
  const [editing, setEditing] = useState(false);
  const detail = useQuery({
    queryKey: ["product", id],
    queryFn: () => api<Detail>(`/api/v1/products/${id}`),
  });
  const moves = useQuery({
    queryKey: ["product-moves", id],
    queryFn: () =>
      api<{ rows: Movement[]; total: number }>(`/api/v1/inventory/movements?productId=${id}&limit=50`),
    enabled: tab === "moves",
  });
  const labelUrl = `${API}/api/v1/products/${id}/label`;

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
          <p className="font-mono text-sm text-stone-500">{product.barcode} · {product.sku}</p>
        </div>
        <div className="flex gap-2">
          {product.status !== "VOID" ? (
            <button onClick={() => setEditing(true)} className="rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100">
              Edit
            </button>
          ) : null}
          {product.status === "IN_STOCK" ? (
            <button onClick={onVoid} className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
              Void
            </button>
          ) : (
            <span className="rounded-md bg-stone-200 px-3 py-1.5 text-sm">{product.status}</span>
          )}
        </div>
      </div>
      {noRate || !livePrice ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          No rate published for {product.karat} — price unavailable.
        </div>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-stone-500">Live price</p>
          <p className="text-3xl font-semibold">{centsToLkr(livePrice.amount_cents).toLocaleString("en-US")} LKR</p>
          <p className="mt-1 text-xs text-stone-400">
            {mgToG(product.net_mg)}g × {centsToLkr(livePrice.rate_cents_per_g).toLocaleString("en-US")} + {centsToLkr(product.making_cents).toLocaleString("en-US")} making
          </p>
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={() => setTab("specs")} className={`rounded-md px-3 py-1.5 text-sm ${tab === "specs" ? "bg-stone-900 text-white" : "border"}`}>Specs</button>
        <button onClick={() => setTab("moves")} className={`rounded-md px-3 py-1.5 text-sm ${tab === "moves" ? "bg-stone-900 text-white" : "border"}`}>Movements</button>
      </div>
      {tab === "specs" ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            ["Category", product.category_name],
            ["Karat", `${product.karat} (${product.permille})`],
            ["Gross", `${mgToG(product.gross_mg)}g`],
            ["Stone", `${mgToG(product.stone_mg)}g`],
            ["Net", `${mgToG(product.net_mg)}g`],
            ["Fine gold", `${mgToG(product.fine_gold_mg)}g`],
            ["Wastage", `${mgToG(product.wastage_mg)}g`],
            ["Making", `${centsToLkr(product.making_cents).toLocaleString("en-US")} LKR`],
            ["Cost", product.cost_cents !== null ? `${centsToLkr(product.cost_cents).toLocaleString("en-US")} LKR` : "—"],
            ["Selling", product.selling_price_cents !== null ? `${centsToLkr(product.selling_price_cents).toLocaleString("en-US")} LKR` : "—"],
            ["Location", product.location ?? "—"],
            ["Status", product.status],
            ["Branch", product.branch_id],
            ["Notes", product.notes ?? "—"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-stone-200 bg-white p-4">
              <p className="text-xs text-stone-500">{k}</p>
              <p className="mt-1 font-medium">{v}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">From → To</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {(moves.data?.rows ?? []).map((m) => (
                <tr key={m.id} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{m.type}</td>
                  <td className="px-4 py-2">{m.from_status ?? "—"} → {m.to_status}</td>
                  <td className="px-4 py-2">{m.reason ?? "—"}</td>
                  <td className="px-4 py-2">{new Date(m.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {product.image_keys.length > 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="mb-2 text-sm font-medium">Images</p>
          <div className="flex flex-wrap gap-2">
            {product.image_keys.map((k) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={k}
                src={`${API}/api/v1/products/${id}/images/${k.split("/").pop()}`}
                alt={product.barcode}
                className="h-32 w-32 rounded-md border object-cover"
              />
            ))}
          </div>
        </div>
      ) : null}
      <div className="print-area rounded-xl border border-stone-200 bg-white p-4">
        <p className="mb-2 text-sm font-medium">Barcode label</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={labelUrl} alt={`Label for ${product.barcode}`} className="max-w-sm" />
        <div className="mt-3 flex gap-2 print:hidden">
          <button
            onClick={() => router.push(`/products/${id}/print`)}
            className="rounded-md border px-3 py-2 text-sm hover:bg-stone-100"
          >
            Print view
          </button>
          <button
            onClick={() => window.print()}
            className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white"
          >
            Print label
          </button>
        </div>
      </div>
      {editing ? (
        <EditDialog
          id={id}
          onClose={() => {
            setEditing(false);
            qc.invalidateQueries({ queryKey: ["product", id] });
            qc.invalidateQueries({ queryKey: ["products"] });
          }}
        />
      ) : null}
    </div>
  );
}

function EditDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [makingLkr, setMakingLkr] = useState("");
  const [wastageG, setWastageG] = useState("");
  const [costLkr, setCostLkr] = useState("");
  const [sellingPriceLkr, setSellingPriceLkr] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    const body: Record<string, unknown> = {};
    if (makingLkr !== "") body.makingLkr = Number(makingLkr);
    if (wastageG !== "") body.wastageG = Number(wastageG);
    if (costLkr !== "") body.costLkr = Number(costLkr);
    if (sellingPriceLkr !== "") body.sellingPriceLkr = Number(sellingPriceLkr);
    if (location !== "") body.location = location;
    if (notes !== "") body.notes = notes;
    try {
      if (Object.keys(body).length > 0) {
        await api(`/api/v1/products/${id}`, { method: "PATCH", body: JSON.stringify(body) });
        toast.success("Product updated");
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setPending(false);
    }
  }

  const cls = "w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold";
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-lg">
        <h2 className="font-semibold">Edit product (weights locked)</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Making LKR</label>
            <input type="number" step="any" value={makingLkr} onChange={(e) => setMakingLkr(e.target.value)} className={cls} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Wastage g</label>
            <input type="number" step="any" value={wastageG} onChange={(e) => setWastageG(e.target.value)} className={cls} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Cost LKR</label>
            <input type="number" step="any" value={costLkr} onChange={(e) => setCostLkr(e.target.value)} className={cls} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Selling LKR</label>
            <input type="number" step="any" value={sellingPriceLkr} onChange={(e) => setSellingPriceLkr(e.target.value)} className={cls} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Location</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} className={cls} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={cls} />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-2 text-sm">Cancel</button>
          <button onClick={save} disabled={pending} className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
