"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { ItemEditor, type ItemDraft } from "@/components/purchase-items";

type Invoice = {
  id: string;
  number: string;
  supplier_name: string;
  total_cents: number;
  paid_cents: number;
  status: string;
  created_at: number;
};
type Supplier = { id: string; name: string; code: string };

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return (
    document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? ""
  );
}

const STATUSES = ["UNPAID", "PARTIAL", "PAID", "VOID"];

export default function InvoicesPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [fStatus, setFStatus] = useState("");
  const [dialog, setDialog] = useState(false);
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCreate = hasPermission(me.data?.permissions ?? [], "purchases:create");

  const list = useQuery({
    queryKey: ["invoices", search, page, fStatus],
    queryFn: () =>
      api<{ rows: Invoice[]; total: number }>(
        `/api/v1/purchases/invoices?search=${encodeURIComponent(search)}&page=${page}&limit=20${fStatus ? `&status=${fStatus}` : ""}`
      ),
  });
  const suppliers = useQuery({
    queryKey: ["suppliers-all"],
    queryFn: () => api<{ rows: Supplier[]; total: number }>("/api/v1/suppliers?limit=100"),
  });

  const [supplierId, setSupplierId] = useState("");
  const [charges, setCharges] = useState("");
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState("cash");
  const [items, setItems] = useState<ItemDraft[]>([]);
  const create = useMutation({
    mutationFn: () =>
      api("/api/v1/purchases/invoices", {
        method: "POST",
        body: JSON.stringify({
          supplierId,
          branchId: branchDefault(),
          chargesLkr: charges === "" ? 0 : Number(charges),
          paidLkr: paid === "" ? 0 : Number(paid),
          paidMethod: paid === "" ? undefined : method,
          items: items.map((it) => ({
            categoryId: it.categoryId,
            metalTypeId: it.metalTypeId,
            purityId: it.purityId,
            name: it.name,
            grossG: Number(it.grossG),
            costLkr: Number(it.costLkr),
          })),
        }),
      }),
    onSuccess: () => {
      toast.success("Invoice created");
      setDialog(false);
      setSupplierId("");
      setCharges("");
      setPaid("");
      setItems([]);
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  const inputCls =
    "w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Purchase Invoices</h1>
          <p className="text-sm text-stone-500">Stock, ledger and journal post atomically</p>
        </div>
        {canCreate ? (
          <button
            onClick={() => setDialog(true)}
            className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
          >
            New invoice
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          placeholder="Search by number…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="w-full max-w-sm rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
        />
        <select value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(1); }} className="rounded-md border border-stone-300 px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
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
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2 text-right">Paid</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(list.data?.rows ?? []).map((r) => (
                <tr key={r.id} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-2 font-mono">
                    <Link href={`/purchases/invoices/${r.id}`} className="hover:underline">
                      {r.number}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{r.supplier_name}</td>
                  <td className="px-4 py-2 text-right">{(r.total_cents / 100).toLocaleString("en-US")}</td>
                  <td className="px-4 py-2 text-right">{(r.paid_cents / 100).toLocaleString("en-US")}</td>
                  <td className="px-4 py-2">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog ? (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
            <h2 className="font-semibold">New invoice (direct intake)</h2>
            <div>
              <label className="mb-1 block text-sm font-medium">Supplier</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputCls}>
                <option value="">Select…</option>
                {(suppliers.data?.rows ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                ))}
              </select>
            </div>
            <ItemEditor items={items} onChange={setItems} />
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Charges LKR</label>
                <input type="number" step="any" value={charges} onChange={(e) => setCharges(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Paid LKR</label>
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
              <button onClick={() => setDialog(false)} className="rounded-md border px-3 py-2 text-sm">
                Cancel
              </button>
              <button
                onClick={() => create.mutate()}
                disabled={create.isPending || !supplierId || items.length === 0}
                className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                Post invoice
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
