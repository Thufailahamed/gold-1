"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

type Detail = {
  invoice: {
    number: string;
    customer_name: string | null;
    subtotal_cents: number;
    discount_cents: number;
    total_cents: number;
    branch_id: string;
    created_at: number;
  };
  items: { barcode: string; sku: string; name: string; gross_mg: number; net_mg: number; karat: string; price_cents: number; discount_cents: number; making_cents: number }[];
  payments: { method: string; amount_cents: number }[];
};

export default function SalePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const detail = useQuery({
    queryKey: ["sale-print", id],
    queryFn: () => api<Detail>(`/api/v1/sales/invoices/${id}`),
  });
  const branches = useQuery({
    queryKey: ["branches-all"],
    queryFn: () => api<{ rows: { id: string; name: string; code: string }[] }>(`/api/v1/branches?limit=100`),
  });
  const branch = (branches.data?.rows ?? []).find((b) => b.id === detail.data?.invoice.branch_id);
  const shop = useQuery({
    queryKey: ["shop-name"],
    queryFn: () => api<{ value: unknown }>(`/api/v1/settings/shop_name`),
    retry: false,
  });

  if (detail.isLoading) return <div className="h-64 animate-pulse rounded-xl bg-stone-200" />;
  if (detail.isError || !detail.data) return <div>Invoice not found.</div>;
  const { invoice, items, payments } = detail.data;
  const fmt = (c: number) => (c / 100).toLocaleString("en-US");

  return (
    <div className="space-y-4">
      <button onClick={() => router.back()} className="text-sm underline print:hidden">← Back</button>
      <div className="print-area mx-auto max-w-2xl rounded-xl border border-stone-200 bg-white p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold">{String(shop.data?.value ?? "GoldOS")}</h1>
          <p className="text-sm text-stone-500">{branch ? `${branch.name} (${branch.code})` : invoice.branch_id}</p>
        </div>
        <div className="mt-4 flex justify-between border-y border-stone-300 py-2 text-sm">
          <span className="font-mono font-semibold">{invoice.number}</span>
          <span>{new Date(invoice.created_at).toLocaleString()}</span>
        </div>
        <p className="mt-2 text-sm">Customer: {invoice.customer_name ?? "Walk-in"}</p>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-stone-500">
              <th className="py-2">Item</th>
              <th className="py-2 text-right">Weight</th>
              <th className="py-2 text-right">Price</th>
              <th className="py-2 text-right">Disc.</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-b border-stone-100">
                <td className="py-2">
                  <p className="font-medium">{it.name}</p>
                  <p className="font-mono text-xs text-stone-500">{it.barcode} · {it.sku} · {it.karat}</p>
                  <p className="text-xs text-stone-500">Making {fmt(it.making_cents)}</p>
                </td>
                <td className="py-2 text-right">{(it.gross_mg / 1000).toLocaleString("en-US")} / {(it.net_mg / 1000).toLocaleString("en-US")}g</td>
                <td className="py-2 text-right">{fmt(it.price_cents)}</td>
                <td className="py-2 text-right">{fmt(it.discount_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 space-y-1 text-right text-sm">
          <p>Subtotal: {fmt(invoice.subtotal_cents)}</p>
          <p>Discount: {fmt(invoice.discount_cents)}</p>
          <p className="text-lg font-bold">Total: {fmt(invoice.total_cents)} LKR</p>
        </div>
        <div className="mt-2 text-sm">
          {payments.map((p, i) => (
            <p key={i} className="flex justify-between"><span>{p.method}</span><span>{fmt(p.amount_cents)}</span></p>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-stone-400">Thank you for shopping with us</p>
      </div>
      <button onClick={() => window.print()} className="rounded-md bg-stone-900 px-4 py-2 text-sm text-white print:hidden">
        Print
      </button>
    </div>
  );
}
