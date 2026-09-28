"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Page, Hero, Panel, TableCard, TableSkeleton, Pager, EmptyBlock, controlClass } from "@/components/ui";

const TYPES = ["PURCHASE", "OLD_GOLD_PURCHASE", "SALE", "MELTING_INPUT", "MELTING_OUTPUT", "MANUFACTURING_INPUT", "MANUFACTURING_OUTPUT", "TRANSFER", "RETURN", "ADJUSTMENT", "LOSS", "RECOVERY"];

type Row = {
  id: string;
  occurred_at: number;
  branch_id: string | null;
  source: string;
  destination: string;
  type: string;
  weight_mg: number;
  permille: number;
  fine_mg: number;
  ref_entity: string;
  ref_id: string;
  notes: string | null;
};

function toCsv(rows: Row[]): string {
  const head = "occurred_at,branch,type,source,destination,weight_g,permille,fine_g,ref_entity,ref_id,notes";
  const esc = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
  return [
    head,
    ...rows.map((r) =>
      [new Date(r.occurred_at).toISOString(), r.branch_id ?? "", r.type, r.source, r.destination, String(r.weight_mg / 1000), String(r.permille), String(r.fine_mg / 1000), r.ref_entity, r.ref_id, r.notes ?? ""].map(esc).join(",")
    ),
  ].join("\n");
}

export default function GoldLedgerPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [fType, setFType] = useState("");

  const list = useQuery({
    queryKey: ["gold-ledger", search, page, fType],
    queryFn: () =>
      api<{ rows: Row[]; total: number }>(
        `/api/v1/gold/ledger?search=${encodeURIComponent(search)}&page=${page}&limit=20${fType ? `&type=${fType}` : ""}`
      ),
  });
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;

  function exportCsv() {
    const blob = new Blob([toCsv(rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gold-ledger-p${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Page>
      <Hero
        kicker="Gold"
        title="Gold ledger"
        description="Every gram in and out — immutable and traceable."
        actions={
          <button onClick={exportCsv} className="g-btn border border-ink/15 bg-transparent px-4 text-sm text-ink">
            Export CSV
          </button>
        }
      />
      <div className="flex flex-wrap gap-2">
        <input
          placeholder="Search ref, source, notes…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className={controlClass}
        />
        <select value={fType} onChange={(e) => { setFType(e.target.value); setPage(1); }} className={controlClass}>
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
      <TableCard
        footer={<Pager page={page} onChange={setPage} pageSize={20} count={rows.length} total={total} unit="entries" />}
      >
        {list.isLoading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : list.isError ? (
          <EmptyBlock title="Failed to load" description="Check the API connection and retry." />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No ledger entries" description="Movements appear here once gold flows." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Source → Dest</th>
                <th className="!text-right">Weight g</th>
                <th className="!text-right">Fine g</th>
                <th>Ref</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-ink-3">{new Date(r.occurred_at).toLocaleString()}</td>
                  <td><span className="font-mono text-xs">{r.type}</span></td>
                  <td className="max-w-56 truncate text-ink-3" title={`${r.source} → ${r.destination}`}>
                    {r.source} → {r.destination}
                  </td>
                  <td className="!text-right">{(r.weight_mg / 1000).toLocaleString("en-US")}</td>
                  <td className="!text-right font-medium text-ink">{(r.fine_mg / 1000).toLocaleString("en-US")}</td>
                  <td className="font-mono text-xs text-ink-3">{r.ref_entity}/{r.ref_id.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </Page>
  );
}
