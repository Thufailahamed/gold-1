"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Page, Skeleton, Callout } from "@/components/ui";
import { ArrowLeftIcon, PrinterIcon } from "@/components/icons";

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

  if (detail.isLoading) {
    return (
      <Page>
        <Skeleton className="mx-auto h-[36rem] max-w-2xl" />
      </Page>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Page>
        <Callout tone="danger" title="Invoice not found">
          This sales invoice does not exist or could not be loaded.
        </Callout>
      </Page>
    );
  }
  const { invoice, items, payments } = detail.data;
  const fmt = (c: number) => (c / 100).toLocaleString("en-US");

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button onClick={() => router.back()} className="g-btn g-btn-secondary h-10 px-4 text-sm">
          <ArrowLeftIcon size={15} /> Back
        </button>
        <button onClick={() => window.print()} className="g-btn g-btn-primary h-10 px-4 text-sm">
          <PrinterIcon size={15} /> Print invoice
        </button>
      </div>
      <div className="print-area mx-auto w-full max-w-2xl animate-fade-in rounded-2xl border border-ink/10 bg-paper p-8 shadow-elevated">
        <div className="text-center">
          <p className="g-kicker justify-center">Tax invoice</p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-ink">{String(shop.data?.value ?? "GoldOS")}</h1>
          <p className="mt-1 text-sm text-ink-3">{branch ? `${branch.name} (${branch.code})` : invoice.branch_id}</p>
        </div>
        <div className="mt-5 flex justify-between border-y border-ink/15 py-2.5 text-sm">
          <span className="g-metric font-semibold text-ink">{invoice.number}</span>
          <span className="text-ink-3">{new Date(invoice.created_at).toLocaleString()}</span>
        </div>
        <p className="mt-3 text-sm text-ink-2">Customer: <span className="font-medium text-ink">{invoice.customer_name ?? "Walk-in"}</span></p>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-ink/15 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-4">
              <th className="py-2">Item</th>
              <th className="py-2 text-right">Weight</th>
              <th className="py-2 text-right">Price</th>
              <th className="py-2 text-right">Disc.</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-b border-ink/[0.07]">
                <td className="py-2.5">
                  <p className="font-medium text-ink">{it.name}</p>
                  <p className="g-metric text-xs text-ink-4">{it.barcode} · {it.sku} · {it.karat}</p>
                  <p className="text-xs text-ink-4">Making {fmt(it.making_cents)}</p>
                </td>
                <td className="py-2.5 text-right num-tabular text-ink-2">{(it.gross_mg / 1000).toLocaleString("en-US")} / {(it.net_mg / 1000).toLocaleString("en-US")}g</td>
                <td className="py-2.5 text-right num-tabular">{fmt(it.price_cents)}</td>
                <td className="py-2.5 text-right num-tabular">{fmt(it.discount_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-5 space-y-1.5 text-right text-sm">
          <p className="text-ink-3">Subtotal: <span className="num-tabular">{fmt(invoice.subtotal_cents)}</span></p>
          <p className="text-ink-3">Discount: <span className="num-tabular">{fmt(invoice.discount_cents)}</span></p>
          <p className="pt-1 text-xl font-bold text-ink">Total: <span className="num-tabular">{fmt(invoice.total_cents)} LKR</span></p>
        </div>
        <div className="mt-3 border-t border-ink/10 pt-3 text-sm">
          {payments.map((p, i) => (
            <p key={i} className="flex justify-between py-0.5 text-ink-2"><span className="capitalize">{p.method}</span><span className="num-tabular">{fmt(p.amount_cents)}</span></p>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-ink-4">Thank you for shopping with us</p>
      </div>
    </Page>
  );
}
