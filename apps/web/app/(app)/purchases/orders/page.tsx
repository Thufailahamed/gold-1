"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { ItemEditor, usePurchaseOptions, type ItemDraft } from "@/components/purchase-items";

type Order = { id: string; number: string; supplier_name: string; status: string; items: number; created_at: number };
type Supplier = { id: string; name: string; code: string };

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return (
    document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? ""
  );
}

export default function OrdersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(false);
  const [receiveId, setReceiveId] = useState<string | null>(null);
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCreate = hasPermission(me.data?.permissions ?? [], "purchases:create");
  const canCancel = hasPermission(me.data?.permissions ?? [], "purchases:cancel");

  const list = useQuery({
    queryKey: ["orders", search, page],
    queryFn: () =>
      api<{ rows: Order[]; total: number }>(
        `/api/v1/purchases/orders?search=${encodeURIComponent(search)}&page=${page}&limit=20`
      ),
  });
  const suppliers = useQuery({
    queryKey: ["suppliers-all"],
    queryFn: () => api<{ rows: Supplier[]; total: number }>("/api/v1/suppliers?limit=100"),
  });

  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([]);
  const create = useMutation({
    mutationFn: () =>
      api("/api/v1/purchases/orders", {
        method: "POST",
        body: JSON.stringify({
          supplierId,
          branchId: branchDefault(),
          notes: notes || undefined,
          items: items.map((it) => ({
            categoryId: it.categoryId,
            metalTypeId: it.metalTypeId || undefined,
            purityId: it.purityId,
            name: it.name || undefined,
            grossG: Number(it.grossG),
            estCostLkr: Number(it.costLkr),
            notes: undefined,
          })),
        }),
      }),
    onSuccess: () => {
      toast.success("Order created");
      setDialog(false);
      setSupplierId("");
      setNotes("");
      setItems([]);
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  async function cancel(id: string) {
    const reason = window.prompt("Reason to cancel (required):");
    if (!reason) return;
    try {
      await api(`/api/v1/purchases/orders/${id}/cancel`, {
        method: "PATCH",
        body: JSON.stringify({ reason }),
      });
      toast.success("Order cancelled");
      qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  const inputCls =
    "w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Purchase Orders</h1>
          <p className="text-sm text-stone-500">Drafts — receiving posts stock, ledger and journal</p>
        </div>
        {canCreate ? (
          <button
            onClick={() => setDialog(true)}
            className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
          >
            New order
          </button>
        ) : null}
      </div>
      <input
        placeholder="Search by number…"
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
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
                <th className="px-4 py-2">Number</th>
                <th className="px-4 py-2">Supplier</th>
                <th className="px-4 py-2">Items</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {(list.data?.rows ?? []).map((o) => (
                <tr key={o.id} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-2 font-mono">{o.number}</td>
                  <td className="px-4 py-2">{o.supplier_name}</td>
                  <td className="px-4 py-2">{o.items}</td>
                  <td className="px-4 py-2">{o.status}</td>
                  <td className="px-4 py-2 text-right">
                    {(o.status === "DRAFT" || o.status === "SENT") && canCreate ? (
                      <button onClick={() => setReceiveId(o.id)} className="mr-3 text-xs hover:underline">
                        Receive
                      </button>
                    ) : null}
                    {(o.status === "DRAFT" || o.status === "SENT") && canCancel ? (
                      <button onClick={() => cancel(o.id)} className="text-xs text-red-600 hover:underline">
                        Cancel
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog ? (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
            <h2 className="font-semibold">New purchase order</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Supplier</label>
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputCls}>
                  <option value="">Select…</option>
                  {(suppliers.data?.rows ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Notes</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
              </div>
            </div>
            <ItemEditor items={items} onChange={setItems} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setDialog(false)} className="rounded-md border px-3 py-2 text-sm">
                Cancel
              </button>
              <button
                onClick={() => create.mutate()}
                disabled={create.isPending || !supplierId || items.length === 0}
                className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                Save draft
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {receiveId ? <ReceiveDialog id={receiveId} onClose={() => setReceiveId(null)} /> : null}
    </div>
  );
}

function ReceiveDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [charges, setCharges] = useState("");
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState("cash");
  const [pending, setPending] = useState(false);

  async function receive() {
    setPending(true);
    try {
      const body: Record<string, unknown> = {};
      if (charges !== "") body.chargesLkr = Number(charges);
      if (paid !== "") {
        body.paidLkr = Number(paid);
        body.paidMethod = method;
      }
      const res = await api<{ number: string }>(`/api/v1/purchases/orders/${id}/receive`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      toast.success(`Received as ${res.number}`);
      qc.invalidateQueries({ queryKey: ["orders"] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Receive failed");
    } finally {
      setPending(false);
    }
  }

  const inputCls =
    "w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold";
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-lg">
        <h2 className="font-semibold">Receive order</h2>
        <p className="text-sm text-stone-500">Creates products, stock, ledger and journal entries atomically.</p>
        <div>
          <label className="mb-1 block text-sm font-medium">Additional charges LKR</label>
          <input type="number" step="any" value={charges} onChange={(e) => setCharges(e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Paid now LKR</label>
            <input type="number" step="any" value={paid} onChange={(e) => setPaid(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-2 text-sm">Cancel</button>
          <button onClick={receive} disabled={pending} className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50">
            Receive
          </button>
        </div>
      </div>
    </div>
  );
}
