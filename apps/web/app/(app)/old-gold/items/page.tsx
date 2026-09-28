"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";

const STATUSES = ["RECEIVED", "TESTED", "VALUED", "PURCHASED", "AVAILABLE", "RESERVED_FOR_MELTING", "MELTED", "RESOLD", "TRANSFERRED", "VOID"];

export default function OldGoldItemsPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [fStatus, setFStatus] = useState("");
  const [scan, setScan] = useState("");

  const list = useQuery({
    queryKey: ["og-items", search, page, fStatus],
    queryFn: () =>
      api<{ rows: { id: string; number: string; description: string; status: string; net_mg: number; customer_name: string | null }[]; total: number }>(
        `/api/v1/oldgold/items?search=${encodeURIComponent(search)}&page=${page}&limit=20${fStatus ? `&status=${fStatus}` : ""}`
      ),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Old Gold Items</h1>
        <p className="text-sm text-stone-500">Full lifecycle with lineage</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (scan.trim()) window.location.href = `/old-gold/items/barcode/${encodeURIComponent(scan.trim())}`;
        }}
        className="flex gap-2"
      >
        <input
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          placeholder="Scan OG- number…"
          autoComplete="off"
          className="w-full max-w-sm rounded-md border border-stone-300 px-3 py-2 font-mono text-sm outline-none focus:border-gold"
        />
        <button type="submit" className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100">
          Look up
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        <input
          placeholder="Search number or description…"
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
                <th className="px-4 py-2">Description</th>
                <th className="px-4 py-2">Customer</th>
                <th className="px-4 py-2 text-right">Net g</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(list.data?.rows ?? []).map((r) => (
                <tr key={r.id} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-2 font-mono">
                    <Link href={`/old-gold/items/${r.id}`} className="hover:underline">{r.number}</Link>
                  </td>
                  <td className="px-4 py-2">{r.description}</td>
                  <td className="px-4 py-2">{r.customer_name ?? "—"}</td>
                  <td className="px-4 py-2 text-right">{(r.net_mg / 1000).toLocaleString("en-US")}</td>
                  <td className="px-4 py-2">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
