"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";

type Detail = {
  invoice: {
    id: string;
    number: string;
    supplier_id: string;
    subtotal_cents: number;
    charges_cents: number;
    total_cents: number;
    paid_cents: number;
    status: string;
  };
  items: { id: string; product_id: string; barcode: string; sku: string; name: string; net_mg: number; cost_cents: number }[];
  payments: { id: string; amount_cents: number; method: string; created_at: number }[];
  journal: { id: string; account_code: string; debit_cents: number; credit_cents: number; memo: string | null }[];
};

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canEdit = hasPermission(me.data?.permissions ?? [], "purchases:edit");
  const canCancel = hasPermission(me.data?.permissions ?? [], "purchases:cancel");

  const detail = useQuery({
    queryKey: ["invoice", id],
    queryFn: () => api<Detail>(`/api/v1/purchases/invoices/${id}`),
  });

  const pay = useMutation({
    mutationFn: () =>
      api(`/api/v1/purchases/invoices/${id}/payments`, {
        method: "POST",
        body: JSON.stringify({ amountLkr: Number(amount), method }),
      }),
    onSuccess: () => {
      toast.success("Payment recorded");
      setPayOpen(false);
      setAmount("");
      qc.invalidateQueries({ queryKey: ["invoice", id] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Payment failed"),
  });

  async function voidIt() {
    const reason = window.prompt("Reason to void (required):");
    if (!reason) return;
    try {
      await api(`/api/v1/purchases/invoices/${id}/void`, {
        method: "PATCH",
        body: JSON.stringify({ reason }),
      });
      toast.success("Invoice voided with reversal");
      qc.invalidateQueries({ queryKey: ["invoice", id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Void failed");
    }
  }

  if (detail.isLoading) return <div className="h-64 animate-pulse rounded-xl bg-stone-200" />;
  if (detail.isError || !detail.data)
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Invoice not found. <button onClick={() => router.push("/purchases/invoices")} className="underline">Back</button>
      </div>
    );
  const { invoice, items, payments, journal } = detail.data;
  const fmt = (c: number) => (c / 100).toLocaleString("en-US");
  const outstanding = invoice.total_cents - invoice.paid_cents;

  return (
    <div className="space-y-4">
      <button onClick={() => router.push("/purchases/invoices")} className="text-sm text-stone-500 hover:underline">
        ← Invoices
      </button>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-mono text-xl font-semibold">{invoice.number}</h1>
          <p className="text-sm text-stone-500">
            Total {fmt(invoice.total_cents)} · Paid {fmt(invoice.paid_cents)} · Outstanding {fmt(outstanding)} · {invoice.status}
          </p>
        </div>
        <div className="flex gap-2">
          {invoice.status !== "PAID" && invoice.status !== "VOID" && canEdit ? (
            <button onClick={() => setPayOpen(true)} className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white">
              Pay
            </button>
          ) : null}
          {invoice.status !== "VOID" && canCancel ? (
            <button onClick={voidIt} className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
              Void
            </button>
          ) : null}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
              <th className="px-4 py-2">Barcode</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2 text-right">Net g</th>
              <th className="px-4 py-2 text-right">Cost LKR</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-stone-100 last:border-0">
                <td className="px-4 py-2 font-mono text-xs">
                  <Link href={`/products/${it.product_id}`} className="hover:underline">{it.barcode}</Link>
                </td>
                <td className="px-4 py-2">{it.name}</td>
                <td className="px-4 py-2 text-right">{(it.net_mg / 1000).toLocaleString("en-US")}</td>
                <td className="px-4 py-2 text-right">{fmt(it.cost_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="font-medium">Payments</h2>
          {payments.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">No payments yet.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex justify-between">
                  <span>{p.method} · {new Date(p.created_at).toLocaleString()}</span>
                  <span>{fmt(p.amount_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="font-medium">Journal</h2>
          <ul className="mt-2 space-y-1 font-mono text-xs">
            {journal.map((j) => (
              <li key={j.id} className="flex justify-between">
                <span>{j.account_code}</span>
                <span>{j.debit_cents ? `DR ${fmt(j.debit_cents)}` : `CR ${fmt(j.credit_cents)}`}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {payOpen ? (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-6 shadow-lg">
            <h2 className="font-semibold">Record payment</h2>
            <p className="text-sm text-stone-500">Outstanding: {fmt(outstanding)} LKR</p>
            <input
              type="number"
              step="any"
              placeholder="Amount LKR"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
            />
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm">
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPayOpen(false)} className="rounded-md border px-3 py-2 text-sm">Cancel</button>
              <button
                onClick={() => pay.mutate()}
                disabled={pay.isPending || !amount}
                className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                Record
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
