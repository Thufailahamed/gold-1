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
    customer_name: string | null;
    customer_code: string | null;
    salesperson_name: string | null;
    subtotal_cents: number;
    discount_cents: number;
    total_cents: number;
    paid_cents: number;
    status: string;
    created_at: number;
    branch_id: string;
  };
  items: { id: string; product_id: string; barcode: string; sku: string; name: string; gross_mg: number; net_mg: number; karat: string; price_cents: number; discount_cents: number }[];
  payments: { id: string; amount_cents: number; method: string; created_at: number }[];
  journal: { id: string; account_code: string; debit_cents: number; credit_cents: number; memo: string | null }[];
  returns: { id: string; number: string; type: string; refund_cents: number; status: string }[];
};

export default function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [retOpen, setRetOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [type, setType] = useState("PARTIAL");
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState("original");
  const [approvedBy, setApprovedBy] = useState("");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCancel = hasPermission(me.data?.permissions ?? [], "sales:cancel");

  const detail = useQuery({
    queryKey: ["sale", id],
    queryFn: () => api<Detail>(`/api/v1/sales/invoices/${id}`),
  });

  const ret = useMutation({
    mutationFn: () =>
      api("/api/v1/sales/returns", {
        method: "POST",
        body: JSON.stringify({
          invoiceId: id,
          itemIds: type === "FULL" ? undefined : selected,
          type,
          reason,
          refundMethod,
          approvedBy: approvedBy || undefined,
        }),
      }),
    onSuccess: () => {
      toast.success("Return recorded");
      setRetOpen(false);
      qc.invalidateQueries({ queryKey: ["sale", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Return failed"),
  });

  if (detail.isLoading) return <div className="h-64 animate-pulse rounded-xl bg-stone-200" />;
  if (detail.isError || !detail.data)
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Sale not found. <button onClick={() => router.push("/sales/invoices")} className="underline">Back</button>
      </div>
    );
  const { invoice, items, payments, journal, returns } = detail.data;
  const fmt = (c: number) => (c / 100).toLocaleString("en-US");

  return (
    <div className="space-y-4">
      <button onClick={() => router.push("/sales/invoices")} className="text-sm text-stone-500 hover:underline">
        ← Invoices
      </button>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-mono text-xl font-semibold">{invoice.number}</h1>
          <p className="text-sm text-stone-500">
            {invoice.customer_name ?? "Walk-in"} · {new Date(invoice.created_at).toLocaleString()} · {invoice.status}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/sales/invoices/${id}/print`} className="rounded-md border px-3 py-1.5 text-sm hover:bg-stone-100">
            Print
          </Link>
          {canCancel ? (
            <button onClick={() => setRetOpen(true)} className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
              Return
            </button>
          ) : null}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
              <th className="px-4 py-2">Barcode</th>
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2 text-right">Net g</th>
              <th className="px-4 py-2 text-right">Price</th>
              <th className="px-4 py-2 text-right">Discount</th>
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
                <td className="px-4 py-2 text-right">{fmt(it.price_cents)}</td>
                <td className="px-4 py-2 text-right">{fmt(it.discount_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="font-medium">Totals</h2>
          <p className="mt-2 text-sm">Subtotal {fmt(invoice.subtotal_cents)} · Discount {fmt(invoice.discount_cents)}</p>
          <p className="text-lg font-semibold">Total {fmt(invoice.total_cents)} LKR</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="font-medium">Payments</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex justify-between"><span>{p.method}</span><span>{fmt(p.amount_cents)}</span></li>
            ))}
          </ul>
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
      {returns.length > 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="font-medium">Returns</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {returns.map((r) => (
              <li key={r.id}>{r.number} · {r.type} · {fmt(r.refund_cents)} · {r.status}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {retOpen ? (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-lg">
            <h2 className="font-semibold">Record return</h2>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm">
              <option value="PARTIAL">Partial</option>
              <option value="FULL">Full</option>
              <option value="EXCHANGE">Exchange</option>
            </select>
            {type !== "FULL" ? (
              <div className="space-y-1">
                {items.map((it) => (
                  <label key={it.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.includes(it.id)}
                      onChange={(e) =>
                        setSelected((s) => (e.target.checked ? [...s, it.id] : s.filter((x) => x !== it.id)))
                      }
                    />
                    {it.barcode} — {it.name}
                  </label>
                ))}
              </div>
            ) : null}
            <input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
            <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm">
              <option value="original">Refund to original methods</option>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
              <option value="credit">Store credit</option>
            </select>
            <input placeholder="Approver user ID (large returns)" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRetOpen(false)} className="rounded-md border px-3 py-2 text-sm">Cancel</button>
              <button onClick={() => ret.mutate()} disabled={ret.isPending || !reason} className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50">
                Record
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
