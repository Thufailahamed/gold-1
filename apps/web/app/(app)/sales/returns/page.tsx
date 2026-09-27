"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";

type Ret = { id: string; number: string; type: string; reason: string; refund_cents: number; status: string; created_at: number };

export default function ReturnsPage() {
  const [invoiceId, setInvoiceId] = useState("");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCancel = hasPermission(me.data?.permissions ?? [], "sales:cancel");

  const list = useQuery({
    queryKey: ["returns", invoiceId],
    queryFn: () =>
      api<{ rows: Ret[]; total: number }>(
        `/api/v1/sales/returns?limit=30${invoiceId ? `&invoiceId=${invoiceId}` : ""}`
      ),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Returns</h1>
        <p className="text-sm text-stone-500">Record returns from the invoice detail page{canCancel ? "" : " (view only)"}</p>
      </div>
      <input
        placeholder="Filter by invoice ID…"
        value={invoiceId}
        onChange={(e) => setInvoiceId(e.target.value)}
        className="w-full max-w-sm rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
      />
      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-stone-200" />
          ))}
        </div>
      ) : (list.data?.rows ?? []).length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
          No returns recorded.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
                <th className="px-4 py-2">Number</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2 text-right">Refund</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {(list.data?.rows ?? []).map((r) => (
                <tr key={r.id} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-2 font-mono">{r.number}</td>
                  <td className="px-4 py-2">{r.type}</td>
                  <td className="px-4 py-2">{r.reason}</td>
                  <td className="px-4 py-2 text-right">{(r.refund_cents / 100).toLocaleString("en-US")}</td>
                  <td className="px-4 py-2">{r.status}</td>
                  <td className="px-4 py-2">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
