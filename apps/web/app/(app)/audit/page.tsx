"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";

type Row = {
  id: string;
  user_id: string | null;
  action: string;
  entity: string;
  entity_id: string;
  reason: string | null;
  created_at: number;
};

function toCsv(rows: Row[]): string {
  const head = "id,user_id,action,entity,entity_id,reason,created_at";
  const esc = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
  return [head, ...rows.map((r) => [r.id, r.user_id, r.action, r.entity, r.entity_id, r.reason, String(r.created_at)].map(esc).join(","))].join("\n");
}

export default function AuditPage() {
  const [entity, setEntity] = useState("");
  const [page, setPage] = useState(1);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canExport = hasPermission(me.data?.permissions ?? [], "audit:export");

  const list = useQuery({
    queryKey: ["audit", entity, page],
    queryFn: () =>
      api<{ rows: Row[]; total: number }>(
        `/api/v1/audit?limit=30&page=${page}${entity ? `&entity=${encodeURIComponent(entity)}` : ""}`
      ),
  });
  const rows = list.data?.rows ?? [];

  function exportCsv() {
    const blob = new Blob([toCsv(rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-page-${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Audit Log</h1>
          <p className="text-sm text-stone-500">Immutable record of important actions</p>
        </div>
        {canExport ? (
          <button
            onClick={exportCsv}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100"
          >
            Export CSV
          </button>
        ) : null}
      </div>
      <input
        placeholder="Filter by entity (user, product, branch…)"
        value={entity}
        onChange={(e) => {
          setEntity(e.target.value);
          setPage(1);
        }}
        className="w-full max-w-sm rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
      />
      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-stone-200" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
          No audit entries found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Entity</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-4 py-2">
                    {r.entity}/{r.entity_id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2">{r.reason ?? "—"}</td>
                  <td className="px-4 py-2">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center gap-2 text-sm text-stone-500">
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
          className="rounded border px-2 py-1 disabled:opacity-40"
        >
          Prev
        </button>
        <span>Page {page}</span>
        <button
          disabled={rows.length < 30}
          onClick={() => setPage((p) => p + 1)}
          className="rounded border px-2 py-1 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
