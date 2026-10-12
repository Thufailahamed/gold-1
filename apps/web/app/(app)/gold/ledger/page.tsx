"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, Pager } from "@/components/ui";
import { BookOpenIcon, FileDownIcon, SearchIcon, ShieldIcon, XIcon } from "@/components/icons";
import {
  Card,
  CardHead,
  DirectionGlyph,
  Empty,
  GoldHero,
  HeroBadge,
  LEDGER_TYPES,
  MiniStats,
  RowsSkeleton,
  direction,
  grams,
  heroGhost,
  inputCls,
  karat,
  pretty,
  th,
  thead,
  tr,
} from "../kit";

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
type Branch = { id: string; name: string; code: string };

const PAGE = 25;

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

  // The gold dashboard links here with ?type= to open one movement type.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("type");
    if (t && LEDGER_TYPES.includes(t)) setFType(t);
  }, []);

  const list = useQuery({
    queryKey: ["gold-ledger", search, page, fType],
    queryFn: () =>
      api<{ rows: Row[]; total: number }>(`/api/v1/gold/ledger?search=${encodeURIComponent(search)}&page=${page}&limit=${PAGE}${fType ? `&type=${fType}` : ""}`),
  });
  const branches = useQuery({ queryKey: ["branches"], queryFn: () => api<{ rows: Branch[] }>("/api/v1/branches?limit=100"), staleTime: 60_000 });
  const branchName = new Map((branches.data?.rows ?? []).map((b) => [b.id, b.code || b.name]));

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const inMg = rows.filter((r) => direction(r.type) === "in").reduce((n, r) => n + r.fine_mg, 0);
  const outMg = rows.filter((r) => direction(r.type) === "out").reduce((n, r) => n + r.fine_mg, 0);
  const moveMg = rows.filter((r) => direction(r.type) === "move").reduce((n, r) => n + r.fine_mg, 0);
  const grossMg = rows.reduce((n, r) => n + r.weight_mg, 0);
  const span: [number, number] | null = rows.length ? [rows[rows.length - 1]!.occurred_at, rows[0]!.occurred_at] : null;
  const filtered = !!search || !!fType;

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
    <Page className="space-y-4">
      <GoldHero
        icon={BookOpenIcon}
        title="Gold"
        accent="ledger"
        badge={<HeroBadge tone="good">Immutable</HeroBadge>}
        sub="Every gram in and out · corrections post as new adjustment entries, never edits"
        actions={
          <button type="button" onClick={exportCsv} disabled={!rows.length} className={cn(heroGhost, "disabled:opacity-40")}>
            <FileDownIcon size={13} /> Export page CSV
          </button>
        }
        stats={[
          { label: filtered ? "Matching entries" : "Entries on file", value: list.isLoading ? undefined : total, accent: true, loading: list.isLoading, sub: fType ? pretty(fType) : "All movement types" },
          { label: "In · this page", value: inMg, format: grams, unit: "g", tone: "good", loading: list.isLoading, sub: "Purchases, returns, recovery" },
          { label: "Out · this page", value: outMg, format: grams, unit: "g", tone: "bad", loading: list.isLoading, sub: "Sales and loss" },
          { label: "Internal · this page", value: moveMg, format: grams, unit: "g", loading: list.isLoading, sub: "Melts, transfers, making" },
          {
            label: "Net · this page",
            value: inMg - outMg,
            format: (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${grams(Math.abs(n))}`,
            unit: "g",
            loading: list.isLoading,
            sub: span ? `${new Date(span[0]).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${new Date(span[1]).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "—",
          },
        ]}
      />

      <Card>
        <CardHead
          icon={BookOpenIcon}
          title="Ledger entries"
          sub={`${total.toLocaleString("en-US")} ${filtered ? "matching" : "on file"} · newest first`}
          action={
            <>
              <label className="relative">
                <SearchIcon size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-5" />
                <input
                  placeholder="Search ref, source, notes…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  aria-label="Search the ledger"
                  className={cn(inputCls, "w-56 pl-8")}
                />
              </label>
              <select
                value={fType}
                onChange={(e) => {
                  setFType(e.target.value);
                  setPage(1);
                }}
                aria-label="Movement type"
                className={cn(inputCls, "pr-7")}
              >
                <option value="">All types</option>
                {LEDGER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {pretty(t)}
                  </option>
                ))}
              </select>
              {filtered ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setFType("");
                    setPage(1);
                  }}
                  className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11.5px] font-medium text-ink-4 hover:bg-ink/[0.05] hover:text-ink"
                >
                  <XIcon size={12} /> Clear
                </button>
              ) : null}
            </>
          }
        />
        <MiniStats
          items={[
            { k: "Rows shown", v: `${rows.length} of ${total.toLocaleString("en-US")}` },
            { k: "Gross weight · page", v: `${grams(grossMg)} g` },
            { k: "Fine weight · page", v: `${grams(inMg + outMg + moveMg)} g` },
            { k: "Avg purity · page", v: grossMg ? `${(((inMg + outMg + moveMg) / grossMg) * 1000).toFixed(0)}‰` : "—" },
          ]}
        />
        {list.isLoading ? (
          <RowsSkeleton rows={8} />
        ) : list.isError ? (
          <Empty icon={BookOpenIcon} title="Failed to load" desc="Check the API connection and retry." />
        ) : rows.length === 0 ? (
          <Empty icon={BookOpenIcon} title="No ledger entries" desc={filtered ? "Nothing matches these filters." : "Movements appear here once gold flows."} />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[940px] text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>When</th>
                  <th className={th}>Movement</th>
                  <th className={th}>From → to</th>
                  <th className={th}>Branch</th>
                  <th className={cn(th, "text-right")}>Purity</th>
                  <th className={cn(th, "text-right")}>Gross g</th>
                  <th className={cn(th, "text-right")}>Fine g</th>
                  <th className={cn(th, "pr-4")}>Reference</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const dir = direction(r.type);
                  const d = new Date(r.occurred_at);
                  return (
                    <tr key={r.id} className={tr}>
                      <td className="whitespace-nowrap py-1.5 pl-4 pr-2">
                        <span className="text-ink-2">{d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}</span>
                        <span className="g-metric ml-1.5 text-[10.5px] text-ink-5">{d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                      </td>
                      <td className="px-2">
                        <button type="button" onClick={() => { setFType(r.type); setPage(1); }} className="flex items-center gap-2 whitespace-nowrap font-semibold text-ink hover:text-gold-dark" title={`Show only ${pretty(r.type)}`}>
                          <DirectionGlyph type={r.type} />
                          {pretty(r.type)}
                        </button>
                      </td>
                      <td className="max-w-[220px] truncate px-2 text-ink-3" title={`${r.source} → ${r.destination}${r.notes ? ` · ${r.notes}` : ""}`}>
                        {pretty(r.source)} <span className="text-ink-5">→</span> {pretty(r.destination)}
                        {r.notes ? <span className="block truncate text-[10.5px] text-ink-5">{r.notes}</span> : null}
                      </td>
                      <td className="g-metric whitespace-nowrap px-2 text-[11px] text-ink-4">{r.branch_id ? branchName.get(r.branch_id) ?? r.branch_id.slice(0, 6) : "—"}</td>
                      <td className="g-metric whitespace-nowrap px-2 text-right text-ink-4">
                        {r.permille}‰ <span className="text-[10px] text-ink-5">{karat(r.permille)}</span>
                      </td>
                      <td className="g-metric px-2 text-right text-ink-3">{grams(r.weight_mg)}</td>
                      <td className={cn("g-metric px-2 text-right font-semibold", dir === "in" ? "text-emerald-700" : dir === "out" ? "text-rose-700" : "text-ink")}>
                        {dir === "in" ? "+" : dir === "out" ? "−" : ""}
                        {grams(r.fine_mg)}
                      </td>
                      <td className="py-1.5 pl-2 pr-4">
                        <span className="g-metric rounded bg-bone px-1.5 py-px text-[10.5px] text-ink-3 ring-1 ring-inset ring-ink/[0.06]" title={`${r.ref_entity}/${r.ref_id}`}>
                          {r.ref_entity}/{r.ref_id.slice(0, 8)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink/[0.06] px-4 py-2">
          <span className="flex items-center gap-1.5 text-[10.5px] text-ink-5">
            <ShieldIcon size={11} className="text-gold-dark" /> Ledger lines are never edited · <span className="text-emerald-700">+ in</span> ·{" "}
            <span className="text-rose-700">− out</span> · ⇄ internal
          </span>
          <Pager page={page} onChange={setPage} pageSize={PAGE} count={rows.length} total={total} unit="entries" />
        </div>
      </Card>
    </Page>
  );
}
