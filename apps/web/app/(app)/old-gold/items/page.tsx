"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import {
  Page,
  Hero,
  TableCard,
  TableSkeleton,
  Pager,
  EmptyBlock,
  Pill,
  type PillTone,
  controlClass,
  heroBtnPrimary,
} from "@/components/ui";
import { ScanBarcodeIcon } from "@/components/icons";

const STATUSES = ["RECEIVED", "TESTED", "VALUED", "PURCHASED", "AVAILABLE", "RESERVED_FOR_MELTING", "MELTED", "RESOLD", "TRANSFERRED", "VOID"];

const TONES: Record<string, PillTone> = {
  RECEIVED: "warning",
  TESTED: "info",
  VALUED: "info",
  PURCHASED: "brand",
  AVAILABLE: "success",
  RESERVED_FOR_MELTING: "warning",
  MELTED: "dark",
  RESOLD: "neutral",
  TRANSFERRED: "info",
  VOID: "danger",
};

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

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const netG = rows.reduce((n, r) => n + r.net_mg, 0);

  return (
    <Page>
      <Hero
        kicker="Old gold"
        title="Old gold items"
        description="Full lifecycle with lineage — intake to melt or resale."
        note="Scan an OG- number to jump straight to the item."
        stats={[
          { label: "Items", value: total },
          { label: "On this page", value: rows.length },
          { label: "Net weight", value: `${(netG / 1000).toLocaleString("en-US")} g` },
        ]}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (scan.trim()) window.location.href = `/old-gold/items/barcode/${encodeURIComponent(scan.trim())}`;
          }}
          className="relative mt-6 flex max-w-md gap-2"
        >
          <div className="relative flex-1">
            <ScanBarcodeIcon size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold" />
            <input
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              placeholder="Scan OG- number…"
              autoComplete="off"
              className="w-full rounded-xl bg-paper/10 py-3 pl-11 pr-4 font-mono text-sm text-paper placeholder:text-paper/35 shadow-[inset_0_0_0_1px_rgba(201,162,39,0.45)] transition-shadow focus:outline-none focus:shadow-[inset_0_0_0_2px_#C9A227,0_0_0_4px_rgba(201,162,39,0.2)]"
            />
          </div>
          <button type="submit" className={heroBtnPrimary}>Look up</button>
        </form>
      </Hero>
      <div className="flex flex-wrap gap-2">
        <input
          placeholder="Search number or description…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className={controlClass}
        />
        <select value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(1); }} className={controlClass}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <TableCard footer={<Pager page={page} onChange={setPage} pageSize={20} count={rows.length} total={total} unit="items" />}>
        {list.isLoading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : list.isError ? (
          <EmptyBlock title="Failed to load" description="Check the API connection and retry." />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No items" description="Intake an old-gold item to see it here." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Description</th>
                <th>Customer</th>
                <th className="!text-right">Net g</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/old-gold/items/${r.id}`} className="g-metric font-medium text-ink hover:text-gold-700">
                      {r.number}
                    </Link>
                  </td>
                  <td className="text-ink-2">{r.description}</td>
                  <td className="text-ink-3">{r.customer_name ?? "—"}</td>
                  <td className="!text-right num-tabular">{(r.net_mg / 1000).toLocaleString("en-US")}</td>
                  <td><Pill tone={TONES[r.status] ?? "neutral"} dot>{r.status.replace(/_/g, " ")}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </Page>
  );
}
