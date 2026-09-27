"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { centsToLkr, mgToG } from "@goldos/shared";
import { api } from "@/lib/api";

type StockRow = { key: string; pieces: number; net_mg: number; fine_mg: number; value_cents: number | null };
type Movement = {
  id: string; product_id: string; barcode: string | null; type: string;
  from_status: string | null; to_status: string; from_branch: string | null;
  to_branch: string | null; weight_mg: number; reason: string | null; created_at: number;
};

const STATUSES = ["IN_STOCK", "RETURNED", "LOST", "VOID", "TRANSFER_PENDING"];

export default function InventoryPage() {
  const [groupBy, setGroupBy] = useState<"branch" | "purity" | "product">("branch");
  const [mType, setMType] = useState("");
  const [mBranch, setMBranch] = useState("");
  const qc = useQueryClient();

  const stock = useQuery({
    queryKey: ["stock", groupBy],
    queryFn: () => api<StockRow[]>(`/api/v1/inventory/stock?groupBy=${groupBy}`),
  });
  const moves = useQuery({
    queryKey: ["moves", mType, mBranch],
    queryFn: () =>
      api<{ rows: Movement[]; total: number }>(
        `/api/v1/inventory/movements?limit=30${mType ? `&type=${mType}` : ""}${mBranch ? `&branchId=${mBranch}` : ""}`
      ),
  });

  const [barcode, setBarcode] = useState("");
  const [toStatus, setToStatus] = useState("RETURNED");
  const [toBranch, setToBranch] = useState("");
  const [reason, setReason] = useState("");
  const move = useMutation({
    mutationFn: async () => {
      const found = await api<{ product: { id: string } }>(
        `/api/v1/products/barcode/${encodeURIComponent(barcode.trim())}`
      );
      return api("/api/v1/inventory/movements", {
        method: "POST",
        body: JSON.stringify({
          productId: found.product.id,
          toStatus,
          toBranchId: toBranch || undefined,
          reason: reason || undefined,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Movement recorded");
      setBarcode("");
      setReason("");
      qc.invalidateQueries({ queryKey: ["moves"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Movement failed"),
  });

  const inputCls = "rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Inventory</h1>
        <p className="text-sm text-stone-500">Stock on hand and movement history</p>
      </div>
      <div className="flex gap-2">
        {(["branch", "purity", "product"] as const).map((g) => (
          <button
            key={g}
            onClick={() => setGroupBy(g)}
            className={`rounded-md px-3 py-1.5 text-sm ${groupBy === g ? "bg-stone-900 text-white" : "border"}`}
          >
            By {g}
          </button>
        ))}
      </div>
      {stock.isLoading ? (
        <div className="h-32 animate-pulse rounded-xl bg-stone-200" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
                <th className="px-4 py-2">{groupBy}</th>
                <th className="px-4 py-2">Pieces</th>
                <th className="px-4 py-2">Net g</th>
                <th className="px-4 py-2">Fine g</th>
                <th className="px-4 py-2">Value</th>
              </tr>
            </thead>
            <tbody>
              {(stock.data ?? []).map((r) => (
                <tr key={r.key} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{r.key}</td>
                  <td className="px-4 py-2">{r.pieces}</td>
                  <td className="px-4 py-2">{mgToG(r.net_mg).toLocaleString("en-US")}</td>
                  <td className="px-4 py-2">{mgToG(r.fine_mg).toLocaleString("en-US")}</td>
                  <td className="px-4 py-2">
                    {r.value_cents !== null ? `${centsToLkr(r.value_cents).toLocaleString("en-US")} LKR` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="font-medium">Record movement</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
          <input placeholder="Barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} className={inputCls} />
          <select value={toStatus} onChange={(e) => setToStatus(e.target.value)} className={inputCls}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input placeholder="To branch (transfer)" value={toBranch} onChange={(e) => setToBranch(e.target.value)} className={inputCls} />
          <input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
          <button
            onClick={() => move.mutate()}
            disabled={move.isPending || !barcode.trim()}
            className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            Record
          </button>
        </div>
      </div>
      <div className="flex gap-2">
        <select value={mType} onChange={(e) => setMType(e.target.value)} className={inputCls}>
          <option value="">All types</option>
          {["INTAKE", "TRANSFER_OUT", "TRANSFER_IN", "RETURN", "LOSS", "VOID"].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input placeholder="Branch filter" value={mBranch} onChange={(e) => setMBranch(e.target.value)} className={inputCls} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Barcode</th>
              <th className="px-4 py-2">From → To</th>
              <th className="px-4 py-2">Weight g</th>
              <th className="px-4 py-2">Reason</th>
              <th className="px-4 py-2">Time</th>
            </tr>
          </thead>
          <tbody>
            {(moves.data?.rows ?? []).map((m) => (
              <tr key={m.id} className="border-b border-stone-100 last:border-0">
                <td className="px-4 py-2 font-mono text-xs">{m.type}</td>
                <td className="px-4 py-2 font-mono text-xs">{m.barcode ?? m.product_id.slice(0, 8)}</td>
                <td className="px-4 py-2 text-xs">{m.from_status ?? "—"} → {m.to_status}</td>
                <td className="px-4 py-2">{mgToG(m.weight_mg)}</td>
                <td className="px-4 py-2">{m.reason ?? "—"}</td>
                <td className="px-4 py-2">{new Date(m.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
