"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";

type Lookup = {
  product: { id: string; barcode: string; name: string; karat: string };
  livePrice: { amount_cents: number } | null;
  noRate: boolean;
};

export default function ScanPage() {
  const [code, setCode] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(window.localStorage.getItem("goldos-recent-scans") ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const lookup = useQuery({
    queryKey: ["scan", code],
    queryFn: () => api<Lookup>(`/api/v1/products/barcode/${encodeURIComponent(code ?? "")}`),
    enabled: code !== null,
    retry: false,
  });

  function onScan(c: string) {
    setCode(c);
    setRecent((r) => {
      const next = [c, ...r.filter((x) => x !== c)].slice(0, 10);
      window.localStorage.setItem("goldos-recent-scans", JSON.stringify(next));
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Scan</h1>
        <p className="text-sm text-stone-500">USB/Bluetooth scanners type + Enter; manual entry works too</p>
      </div>
      <ScanInput onScan={onScan} />
      {lookup.isLoading ? <div className="h-24 animate-pulse rounded-xl bg-stone-200" /> : null}
      {lookup.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          No product found for {code}.
        </div>
      ) : null}
      {lookup.data ? (
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <p className="font-mono text-sm text-stone-500">{lookup.data.product.barcode}</p>
          <p className="text-lg font-semibold">{lookup.data.product.name}</p>
          <p className="text-sm text-stone-500">{lookup.data.product.karat}</p>
          <Link href={`/products/${lookup.data.product.id}`} className="mt-2 inline-block text-sm underline">
            Open detail →
          </Link>
        </div>
      ) : null}
      {recent.length > 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="mb-2 text-sm font-medium">Recent scans</p>
          <ul className="space-y-1 text-sm">
            {recent.map((r) => (
              <li key={r}>
                <button onClick={() => onScan(r)} className="font-mono hover:underline">{r}</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ScanInput({ onScan }: { onScan: (code: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) {
          onScan(v.trim());
          setV("");
        }
      }}
      className="flex gap-2"
    >
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="Scan or type barcode…"
        autoComplete="off"
        className="w-full max-w-md rounded-md border-2 border-gold px-4 py-3 font-mono text-lg outline-none"
      />
      <button type="submit" className="rounded-md bg-stone-900 px-4 py-2 text-sm text-white">
        Look up
      </button>
    </form>
  );
}
