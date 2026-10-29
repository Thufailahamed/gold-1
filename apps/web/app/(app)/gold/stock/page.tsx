"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page } from "@/components/ui";
import { ArchiveIcon, BookOpenIcon, CoinsIcon, GemIcon, RefreshCwIcon, StoreIcon } from "@/components/icons";
import { Card, CardHead, Empty, GoldHero, HeroBadge, RowsSkeleton, ShareBar, grams, heroGhost, karat, th, thead, tr } from "../kit";

type Stages = { stages: { old_gold_mg: number; melting_mg: number; refined_mg: number; for_sale_mg: number } };
type ByPurity = { byPurity: { permille: number; fine_mg: number }[] };
type ByBranch = { byBranch: { branch_id: string; fine_mg: number }[] };
type Branch = { id: string; name: string; code: string };

const STAGES = [
  { key: "old_gold_mg", label: "Old gold", hint: "Bought in, awaiting melt", bar: "bg-amber-400", href: "/old-gold/items?status=AVAILABLE" },
  { key: "melting_mg", label: "Melting", hint: "Locked or melted batches", bar: "bg-gold", href: "/gold/melting?status=LOCKED" },
  { key: "refined_mg", label: "Refined", hint: "Approved melt output", bar: "bg-gold-deep", href: "/gold/melting?status=APPROVED" },
  { key: "for_sale_mg", label: "For sale", hint: "Finished pieces in stock", bar: "bg-emerald-500", href: "/inventory" },
] as const;

export default function GoldStockPage() {
  const opt = { retry: false, staleTime: 30_000 } as const;
  // Same cache keys as the gold overview, so moving between them is instant.
  const stages = useQuery({ ...opt, queryKey: ["gold-stock", "stage"], queryFn: () => api<Stages>("/api/v1/gold/stock?groupBy=stage") });
  const purity = useQuery({ ...opt, queryKey: ["gold-stock", "purity"], queryFn: () => api<ByPurity>("/api/v1/gold/stock?groupBy=purity") });
  const branch = useQuery({ ...opt, queryKey: ["gold-stock", "branch"], queryFn: () => api<ByBranch>("/api/v1/gold/stock?groupBy=branch") });
  const branches = useQuery({ ...opt, queryKey: ["branches"], queryFn: () => api<{ rows: Branch[] }>("/api/v1/branches?limit=100") });

  const st = stages.data?.stages;
  const total = st ? st.old_gold_mg + st.melting_mg + st.refined_mg + st.for_sale_mg : undefined;
  const purityRows = (purity.data?.byPurity ?? []).filter((r) => r.fine_mg > 0).sort((a, b) => b.permille - a.permille);
  const purityTotal = purityRows.reduce((n, r) => n + r.fine_mg, 0);
  const avgPermille = purityTotal ? purityRows.reduce((n, r) => n + r.permille * r.fine_mg, 0) / purityTotal : undefined;
  const names = new Map((branches.data?.rows ?? []).map((b) => [b.id, b]));
  const branchRows = (branch.data?.byBranch ?? []).filter((r) => r.fine_mg > 0).sort((a, b) => b.fine_mg - a.fine_mg);
  const branchTotal = branchRows.reduce((n, r) => n + r.fine_mg, 0);
  const anyError = stages.isError || purity.isError || branch.isError;

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={ArchiveIcon}
        title="Gold"
        accent="stock"
        badge={<HeroBadge tone="good">Reconciled per batch</HeroBadge>}
        sub="Fine gold across every stage, purity and branch · balances derive from the immutable gold ledger"
        actions={
          <>
            <button
              type="button"
              onClick={() => {
                void stages.refetch();
                void purity.refetch();
                void branch.refetch();
              }}
              className={heroGhost}
            >
              <RefreshCwIcon size={13} className={cn((stages.isFetching || purity.isFetching || branch.isFetching) && "animate-spin")} />
              Refresh
            </button>
            <Link href="/gold/ledger" className={heroGhost}>
              <BookOpenIcon size={13} />
              Ledger
            </Link>
          </>
        }
        stats={[
          { label: "Total fine", value: total, format: grams, unit: "g", accent: true, loading: stages.isLoading, sub: "All stages" },
          ...STAGES.map((s) => ({
            label: s.label,
            value: st?.[s.key],
            format: grams,
            unit: "g",
            href: s.href,
            loading: stages.isLoading,
            sub: st && total ? `${((st[s.key] / total) * 100).toFixed(1)}% of vault` : s.hint,
          })),
          {
            label: "Avg purity",
            value: avgPermille,
            format: (n: number) => n.toFixed(0),
            unit: "‰",
            loading: purity.isLoading,
            sub: avgPermille ? `≈ ${karat(avgPermille)} · ${purityRows.length} purities` : "Weighted by fine",
          },
          {
            label: "Branches",
            value: branch.isLoading ? undefined : branchRows.length,
            loading: branch.isLoading,
            sub: branchRows[0] ? `Most at ${names.get(branchRows[0].branch_id)?.name ?? "—"}` : "Holding gold",
          },
        ]}
      />

      {anyError ? (
        <Card>
          <Empty icon={CoinsIcon} title="Some balances failed to load" desc="Check the API connection and use Refresh." />
        </Card>
      ) : null}

      {/* stage flow */}
      <Card>
        <CardHead icon={CoinsIcon} title="By stage" sub="From buy-in to showcase · tap a stage to open it" />
        <div className="px-4 pt-3">
          <div className="flex h-3 overflow-hidden rounded-full bg-ink/[0.06]" aria-hidden>
            {st && total
              ? STAGES.map((s) =>
                  st[s.key] > 0 ? (
                    <span key={s.key} className={cn("h-full border-r-2 border-paper last:border-r-0", s.bar)} style={{ width: `${(st[s.key] / total) * 100}%` }} />
                  ) : null
                )
              : null}
          </div>
        </div>
        {stages.isLoading ? (
          <RowsSkeleton rows={2} />
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-px border-t border-ink/20 bg-ink/[0.06] lg:grid-cols-4">
            {STAGES.map((s, i) => (
              <Link key={s.key} href={s.href} className="group bg-paper px-4 py-3 transition-colors hover:bg-gold-pale/50">
                <span className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink group-hover:text-gold-dark">
                    <span className={cn("size-2 rounded-full", s.bar)} />
                    {s.label}
                  </span>
                  <span className="g-metric text-[10px] text-ink-5">0{i + 1}</span>
                </span>
                <span className="g-metric mt-1.5 block text-[20px] leading-none text-ink">
                  {st ? grams(st[s.key]) : "—"} <span className="text-[10px] text-ink-4">g</span>
                </span>
                <span className="mt-1 block text-[10.5px] text-ink-4">
                  {st && total ? `${((st[s.key] / total) * 100).toFixed(1)}% · ` : ""}
                  {s.hint}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* purity */}
        <Card>
          <CardHead icon={GemIcon} title="By purity" sub={purityTotal ? `${grams(purityTotal)} g fine across ${purityRows.length} purities` : "Fine gold on hand"} />
          {purity.isLoading ? (
            <RowsSkeleton />
          ) : purityRows.length === 0 ? (
            <Empty icon={GemIcon} title="No stock" desc="No fine gold on hand by purity." />
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Purity</th>
                  <th className={th}>Karat</th>
                  <th className={cn(th, "w-[40%]")}>Share</th>
                  <th className={cn(th, "text-right")}>Gross equiv. g</th>
                  <th className={cn(th, "pr-4 text-right")}>Fine g</th>
                </tr>
              </thead>
              <tbody>
                {purityRows.map((r) => {
                  const share = purityTotal ? (r.fine_mg / purityTotal) * 100 : 0;
                  return (
                    <tr key={r.permille} className={tr}>
                      <td className="g-metric py-1.5 pl-4 pr-2 font-semibold text-ink">{r.permille}‰</td>
                      <td className="px-2">
                        <span className="rounded bg-void px-1.5 py-px font-display text-[10.5px] font-bold text-gold-light">{karat(r.permille)}</span>
                      </td>
                      <td className="px-2">
                        <div className="flex items-center gap-2">
                          <ShareBar value={share} className="flex-1" />
                          <span className="g-metric w-11 text-right text-[10.5px] text-ink-4">{share.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="g-metric px-2 text-right text-ink-4">{r.permille ? grams((r.fine_mg * 1000) / r.permille) : "—"}</td>
                      <td className="g-metric py-1.5 pl-2 pr-4 text-right font-semibold text-ink">{grams(r.fine_mg)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-ink/20 bg-bone text-[12px] font-semibold text-ink">
                  <td className="py-1.5 pl-4" colSpan={4}>
                    Total {avgPermille ? <span className="font-normal text-ink-4">· avg {avgPermille.toFixed(0)}‰</span> : null}
                  </td>
                  <td className="g-metric py-1.5 pr-4 text-right">{grams(purityTotal)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </Card>

        {/* branch */}
        <Card>
          <CardHead icon={StoreIcon} title="By branch" sub={branchTotal ? `${grams(branchTotal)} g fine across ${branchRows.length} branches` : "Where the gold is held"} />
          {branch.isLoading ? (
            <RowsSkeleton />
          ) : branchRows.length === 0 ? (
            <Empty icon={StoreIcon} title="No stock" desc="No fine gold on hand by branch." />
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Branch</th>
                  <th className={cn(th, "w-[45%]")}>Share</th>
                  <th className={cn(th, "pr-4 text-right")}>Fine g</th>
                </tr>
              </thead>
              <tbody>
                {branchRows.map((r) => {
                  const b = names.get(r.branch_id);
                  const share = branchTotal ? (r.fine_mg / branchTotal) * 100 : 0;
                  return (
                    <tr key={r.branch_id ?? "none"} className={tr}>
                      <td className="py-1.5 pl-4 pr-2">
                        <span className="font-semibold text-ink">{b?.name ?? (r.branch_id ? r.branch_id.slice(0, 8) : "Unassigned")}</span>
                        {b?.code ? <span className="g-metric ml-1.5 text-[10px] text-ink-5">{b.code}</span> : null}
                      </td>
                      <td className="px-2">
                        <div className="flex items-center gap-2">
                          <ShareBar value={share} className="flex-1" color="bg-gradient-to-r from-void to-emerald-600" />
                          <span className="g-metric w-11 text-right text-[10.5px] text-ink-4">{share.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="g-metric py-1.5 pl-2 pr-4 text-right font-semibold text-ink">{grams(r.fine_mg)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-ink/20 bg-bone text-[12px] font-semibold text-ink">
                  <td className="py-1.5 pl-4" colSpan={2}>
                    Total
                  </td>
                  <td className="g-metric py-1.5 pr-4 text-right">{grams(branchTotal)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </Card>
      </div>
    </Page>
  );
}
