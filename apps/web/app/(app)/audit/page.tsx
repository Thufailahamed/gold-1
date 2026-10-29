"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page } from "@/components/ui";
import { Card, CardHead, Empty, GoldHero, HeroBadge, RowsSkeleton, ShareBar, ago, count, heroGhost, inputCls, pretty, stamp, th, thead, tr } from "@/components/console-kit";
import { ChevronRightIcon, FileDownIcon, HistoryIcon, LayersIcon, SearchIcon, XIcon } from "@/components/icons";

/** Colour an action by its verb, so creates, edits and removals read apart. */
function verbTone(action: string) {
  const a = action.toLowerCase();
  if (/(delete|void|deactivat|reject|cancel|remove)/.test(a)) return { hex: "#E11D48", chip: "bg-rose-500/10 text-rose-800 ring-rose-500/25" };
  if (/(approve|publish|post|close)/.test(a)) return { hex: "#B8923F", chip: "bg-gold/15 text-gold-deep ring-gold/35" };
  if (/(create|add|new|activat|receive)/.test(a)) return { hex: "#059669", chip: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25" };
  if (/(update|edit|change|patch|set)/.test(a)) return { hex: "#0284C7", chip: "bg-sky-500/10 text-sky-800 ring-sky-500/25" };
  if (/(login|logout|auth|session)/.test(a)) return { hex: "#7C3AED", chip: "bg-violet-500/10 text-violet-800 ring-violet-500/25" };
  return { hex: "#64748B", chip: "bg-ink/[0.05] text-ink-3 ring-ink/20" };
}

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

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 30));
  const tally = (f: (r: Row) => string) =>
    [...rows.reduce((m, r) => m.set(f(r), (m.get(f(r)) ?? 0) + 1), new Map<string, number>())].sort((x, y) => y[1] - x[1]);
  const byAction = tally((r) => r.action);
  const byEntity = tally((r) => r.entity);
  const people = new Set(rows.map((r) => r.user_id).filter(Boolean)).size;
  const withReason = rows.filter((r) => r.reason).length;
  const newest = rows[0]?.created_at;

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={HistoryIcon}
        title="Audit"
        accent="log"
        badge={<HeroBadge tone="muted">Immutable</HeroBadge>}
        sub="Every important action, who did it and why · entries can't be edited, export for external review"
        back={{ href: "/setup", label: "Setup" }}
        actions={
          canExport ? (
            <button onClick={exportCsv} className={heroGhost}>
              <FileDownIcon size={13} />
              Export page
            </button>
          ) : undefined
        }
        stats={[
          { label: "Entries", value: list.isLoading ? undefined : total, loading: list.isLoading, accent: true, sub: entity ? `entity “${entity}”` : "all time" },
          { label: "On this page", value: list.isLoading ? undefined : rows.length, loading: list.isLoading },
          { label: "Actions", value: list.isLoading ? undefined : byAction.length, loading: list.isLoading, sub: "distinct, this page" },
          { label: "Entities", value: list.isLoading ? undefined : byEntity.length, loading: list.isLoading, sub: "distinct, this page" },
          { label: "People", value: list.isLoading ? undefined : people, loading: list.isLoading, sub: "acting, this page" },
          { label: "Latest", value: null, text: newest ? ago(newest) : "—", sub: withReason ? `${withReason} with a reason` : undefined },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-9">
          <div className="flex flex-wrap items-center gap-2 border-b border-ink/20 px-4 py-2.5">
            <div className="relative w-full max-w-xs">
              <SearchIcon size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-5" />
              <input
                placeholder="Filter by entity (user, product, branch…)"
                value={entity}
                onChange={(e) => {
                  setEntity(e.target.value);
                  setPage(1);
                }}
                className={cn(inputCls, "w-full pl-8 pr-7")}
              />
              {entity ? (
                <button
                  type="button"
                  onClick={() => {
                    setEntity("");
                    setPage(1);
                  }}
                  aria-label="Clear filter"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-5 hover:text-ink"
                >
                  <XIcon size={12} />
                </button>
              ) : null}
            </div>
            {!entity
              ? byEntity.slice(0, 5).map(([e, n]) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      setEntity(e);
                      setPage(1);
                    }}
                    className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium text-ink-3 ring-1 ring-inset ring-ink/20 hover:bg-bone hover:text-ink"
                  >
                    {e}
                    <span className="g-metric rounded-full bg-ink/[0.05] px-1.5 text-[10px] text-ink-4">{n}</span>
                  </button>
                ))
              : null}
          </div>
          {list.isLoading ? (
            <RowsSkeleton rows={8} />
          ) : rows.length === 0 ? (
            <Empty icon={HistoryIcon} title="No audit entries" desc="No audit entries match the filter." />
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-[12.5px]">
                <thead className={thead}>
                  <tr>
                    <th className={cn(th, "pl-4")}>When</th>
                    <th className={th}>Action</th>
                    <th className={th}>Entity</th>
                    <th className={th}>By</th>
                    <th className={cn(th, "pr-4")}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const t = verbTone(r.action);
                    return (
                      <tr key={r.id} className={tr}>
                        <td className="relative whitespace-nowrap py-1.5 pl-4 pr-2">
                          <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full" style={{ background: t.hex }} aria-hidden />
                          <span className="block text-[12px] text-ink-2">{ago(r.created_at)}</span>
                          <span className="g-metric block text-[10px] text-ink-5">{stamp(r.created_at)}</span>
                        </td>
                        <td className="px-2">
                          <span className={cn("g-metric inline-flex rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset", t.chip)}>{r.action}</span>
                        </td>
                        <td className="px-2">
                          <span className="text-ink-2">{pretty(r.entity)}</span>
                          <span className="g-metric ml-1.5 rounded bg-ink/[0.05] px-1 text-[10px] text-ink-4" title={r.entity_id}>
                            {r.entity_id.slice(0, 8)}
                          </span>
                        </td>
                        <td className="g-metric px-2 text-[10.5px] text-ink-4" title={r.user_id ?? "system"}>
                          {r.user_id ? r.user_id.slice(0, 8) : "system"}
                        </td>
                        <td className="max-w-[280px] truncate px-2 pr-4 text-ink-3" title={r.reason ?? undefined}>
                          {r.reason ?? <span className="text-ink-6">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-ink/20 bg-bone/40 px-4 py-2 text-[11px] text-ink-4">
            <span>
              <span className="g-metric text-ink-2">{count(rows.length)}</span> of <span className="g-metric text-ink-2">{count(total)}</span> entries
            </span>
            <span className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page" className="flex size-7 items-center justify-center rounded-md ring-1 ring-inset ring-ink/20 hover:bg-paper disabled:opacity-40">
                <ChevronRightIcon size={13} className="rotate-180" />
              </button>
              <span className="g-metric px-1.5 text-ink-2">
                {page} / {pages}
              </span>
              <button disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page" className="flex size-7 items-center justify-center rounded-md ring-1 ring-inset ring-ink/20 hover:bg-paper disabled:opacity-40">
                <ChevronRightIcon size={13} />
              </button>
            </span>
          </div>
        </Card>

        <div className="space-y-4 xl:col-span-3">
          <Card>
            <CardHead icon={HistoryIcon} title="Actions" sub="On this page" />
            {list.isLoading ? (
              <RowsSkeleton rows={4} />
            ) : (
              <ul className="space-y-2 p-4">
                {byAction.slice(0, 8).map(([a, n]) => (
                  <li key={a}>
                    <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
                      <span className="g-metric truncate text-ink-2">{a}</span>
                      <span className="g-metric text-ink-4">{n}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                      <div className="h-full rounded-full" style={{ width: `${(n / (byAction[0]?.[1] ?? 1)) * 100}%`, background: verbTone(a).hex }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHead icon={LayersIcon} title="Entities" sub="Tap to filter" />
            <ul className="divide-y divide-ink/[0.05]">
              {byEntity.slice(0, 8).map(([e, n]) => (
                <li key={e}>
                  <button
                    type="button"
                    onClick={() => {
                      setEntity(e);
                      setPage(1);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-[12px] transition-colors hover:bg-bone/60"
                  >
                    <span className="flex-1 truncate text-ink-2">{pretty(e)}</span>
                    <ShareBar value={(n / rows.length) * 100} className="w-16" />
                    <span className="g-metric w-6 text-right text-ink-4">{n}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </Page>
  );
}
