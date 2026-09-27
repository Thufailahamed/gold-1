"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  Page,
  Hero,
  heroBtnGhost,
  TableCard,
  TableSkeleton,
  Pager,
  EmptyBlock,
  Pill,
  controlClass,
} from "@/components/ui";
import { FileDownIcon, SearchIcon } from "@/components/icons";

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
    <Page>
      <Hero
        kicker="System"
        title="Audit Log"
        description="Immutable record of important actions."
        actions={
          canExport ? (
            <button onClick={exportCsv} className={heroBtnGhost}>
              <FileDownIcon size={14} />
              Export CSV
            </button>
          ) : undefined
        }
        stats={[
          { label: "Entries", value: list.isLoading ? "—" : (list.data?.total ?? 0).toLocaleString("en-US") },
          { label: "On this page", value: list.isLoading ? "—" : rows.length },
        ]}
        note="Entries are immutable — export CSV for external review"
      />

      <TableCard
        toolbar={
          <div className="relative w-full max-w-sm">
            <SearchIcon
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"
            />
            <input
              placeholder="Filter by entity (user, product, branch…)"
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value);
                setPage(1);
              }}
              className={cn(controlClass, "pl-9")}
            />
          </div>
        }
        footer={
          <Pager
            page={page}
            onChange={setPage}
            pageSize={30}
            count={rows.length}
            total={list.data?.total ?? 0}
            unit="entries"
          />
        }
      >
        {list.isLoading ? (
          <TableSkeleton rows={6} cols={4} />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No audit entries" description="No audit entries match the filter." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Entity</th>
                <th>Reason</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Pill tone="neutral" className="font-mono normal-case tracking-normal">
                      {r.action}
                    </Pill>
                  </td>
                  <td className="text-ink-3">
                    {r.entity}/<span className="font-mono text-xs">{r.entity_id.slice(0, 8)}</span>
                  </td>
                  <td className="text-ink-3">{r.reason ?? "—"}</td>
                  <td className="num text-xs">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </Page>
  );
}
