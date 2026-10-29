"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, Skeleton } from "@/components/ui";
import {
  ArrowRightIcon,
  BookOpenIcon,
  CoinsIcon,
  FlaskConicalIcon,
  GemIcon,
  HistoryIcon,
  PlusIcon,
  ScaleIcon,
  StoreIcon,
} from "@/components/icons";
import {
  BATCH_META,
  Card,
  CardHead,
  DirectionGlyph,
  Empty,
  GoldHero,
  HeadLink,
  HeroBadge,
  RowsSkeleton,
  ShareBar,
  StatusChip,
  ago,
  count,
  direction,
  grams,
  heroGhost,
  heroGold,
  karat,
  pretty,
  th,
  thead,
  tr,
} from "./kit";

/* ------------------------------------------------------------------ types */

type Stages = { stages: { old_gold_mg: number; melting_mg: number; refined_mg: number; for_sale_mg: number } };
type ByPurity = { byPurity: { permille: number; fine_mg: number }[] };
type ByBranch = { byBranch: { branch_id: string; fine_mg: number }[] };
type Branch = { id: string; name: string; code: string };
type Batch = { id: string; number: string; status: string; input_fine_mg: number; output_fine_mg: number; loss_mg: number; created_at: number };
type Entry = {
  id: string;
  occurred_at: number;
  source: string;
  destination: string;
  type: string;
  weight_mg: number;
  permille: number;
  fine_mg: number;
  ref_entity: string;
};
type Paged<R> = { rows: R[]; total: number };

/** Fine gold as it moves through the vault, from buy-in to the showcase. */
const FLOW = [
  { key: "old_gold_mg", label: "Old gold", hint: "Bought in, awaiting melt", bar: "bg-amber-400", href: "/old-gold/items?status=AVAILABLE", icon: ScaleIcon },
  { key: "melting_mg", label: "In the melt", hint: "Locked or melted batches", bar: "bg-gold", href: "/gold/melting?status=LOCKED", icon: FlaskConicalIcon },
  { key: "refined_mg", label: "Refined", hint: "Approved melt output", bar: "bg-gold-deep", href: "/gold/melting?status=APPROVED", icon: GemIcon },
  { key: "for_sale_mg", label: "For sale", hint: "Finished pieces in stock", bar: "bg-emerald-500", href: "/inventory", icon: StoreIcon },
] as const;

const PIPELINE = ["DRAFT", "LOCKED", "MELTED", "APPROVED"] as const;
const PURITY_BARS = ["bg-gold", "bg-void", "bg-gold-light", "bg-emerald-600", "bg-gold-deep", "bg-ink/30"];

function monthStart(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/* ------------------------------------------------------------------- page */

export default function GoldDashboardPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const perms = me.data?.permissions ?? [];
  const canManage = hasPermission(perms, "gold:manage");
  const canOldGold = hasPermission(perms, "oldgold:view");

  const opt = { retry: false, staleTime: 30_000 } as const;
  const stages = useQuery({ ...opt, queryKey: ["gold-stock", "stage"], queryFn: () => api<Stages>("/api/v1/gold/stock?groupBy=stage") });
  const byPurity = useQuery({ ...opt, queryKey: ["gold-stock", "purity"], queryFn: () => api<ByPurity>("/api/v1/gold/stock?groupBy=purity") });
  const byBranch = useQuery({ ...opt, queryKey: ["gold-stock", "branch"], queryFn: () => api<ByBranch>("/api/v1/gold/stock?groupBy=branch") });
  const branches = useQuery({ ...opt, queryKey: ["branches"], queryFn: () => api<{ rows: Branch[] }>("/api/v1/branches?limit=100") });
  const from = useMemo(monthStart, []);
  const monthMoves = useQuery({
    ...opt,
    queryKey: ["gold-dash", "month-moves", from],
    queryFn: () => api<Paged<Entry>>(`/api/v1/gold/ledger?from=${from}&limit=1`),
  });
  const recentMoves = useQuery({ ...opt, queryKey: ["gold-dash", "moves", 10], queryFn: () => api<Paged<Entry>>("/api/v1/gold/ledger?limit=10") });
  const recentBatches = useQuery({ ...opt, queryKey: ["gold-dash", "batches", 6], queryFn: () => api<Paged<Batch>>("/api/v1/melting/batches?limit=6") });
  const approved = useQuery({
    ...opt,
    queryKey: ["gold-dash", "approved"],
    queryFn: () => api<Paged<Batch>>("/api/v1/melting/batches?status=APPROVED&limit=20"),
  });
  const batchQueries = useQueries({
    queries: PIPELINE.map((s) => ({
      ...opt,
      queryKey: ["gold-dash", "batch-state", s],
      queryFn: () => api<Paged<Batch>>(`/api/v1/melting/batches?status=${s}&limit=1`),
    })),
  });
  const batchCounts = batchQueries.map((q) => q.data?.total);
  const batchesLoading = batchQueries.some((q) => q.isLoading);
  const activeBatches = (batchCounts[0] ?? 0) + (batchCounts[1] ?? 0) + (batchCounts[2] ?? 0);
  const awaitingApproval = batchCounts[2] ?? 0;
  const pipelineMax = Math.max(1, ...batchCounts.map((c) => c ?? 0));

  const st = stages.data?.stages;
  const totalFine = st ? st.old_gold_mg + st.melting_mg + st.refined_mg + st.for_sale_mg : undefined;

  // Yield across the most recent approved batches — how much fine survives the melt.
  const approvedRows = approved.data?.rows ?? [];
  const fineIn = approvedRows.reduce((s, b) => s + b.input_fine_mg, 0);
  const fineOut = approvedRows.reduce((s, b) => s + b.output_fine_mg, 0);
  const lossMg = approvedRows.reduce((s, b) => s + b.loss_mg, 0);
  const yieldPct = fineIn > 0 ? (fineOut / fineIn) * 100 : undefined;

  const branchName = new Map((branches.data?.rows ?? []).map((b) => [b.id, b.name]));
  const purityRows = (byPurity.data?.byPurity ?? []).filter((r) => r.fine_mg > 0).sort((a, b) => b.fine_mg - a.fine_mg);
  const purityTotal = purityRows.reduce((s, r) => s + r.fine_mg, 0);
  const branchRows = (byBranch.data?.byBranch ?? []).filter((r) => r.fine_mg > 0).sort((a, b) => b.fine_mg - a.fine_mg);
  const branchTotal = branchRows.reduce((s, r) => s + r.fine_mg, 0);
  const moves = recentMoves.data?.rows ?? [];

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={CoinsIcon}
        title="Gold"
        accent="vault"
        badge={
          awaitingApproval > 0 ? (
            <HeroBadge tone="warn">{awaitingApproval} awaiting approval</HeroBadge>
          ) : (
            <HeroBadge>Traced end to end</HeroBadge>
          )
        }
        sub={
          <>
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · buy-in → melt → showcase, every
            movement on an immutable ledger
          </>
        }
        actions={
          <>
            {canManage ? (
              <Link href="/gold/melting?new=1" className={heroGold}>
                <PlusIcon size={13} />
                New melting batch
              </Link>
            ) : null}
            {canOldGold ? (
              <Link href="/old-gold" className={heroGhost}>
                <ScaleIcon size={13} />
                Old gold
              </Link>
            ) : null}
            <Link href="/gold/stock" className={heroGhost}>
              <CoinsIcon size={13} />
              Stock
            </Link>
            <Link href="/gold/ledger" className={heroGhost}>
              <BookOpenIcon size={13} />
              Ledger
            </Link>
          </>
        }
        stats={[
          { label: "Fine gold on hand", value: totalFine, format: grams, unit: "g", accent: true, href: "/gold/stock", loading: stages.isLoading, sub: "All stages, all branches" },
          { label: "Old gold", value: st?.old_gold_mg, format: grams, unit: "g", href: "/old-gold/items?status=AVAILABLE", loading: stages.isLoading, sub: "Awaiting melt" },
          { label: "In the melt", value: st?.melting_mg, format: grams, unit: "g", href: "/gold/melting?status=LOCKED", loading: stages.isLoading, sub: "Locked or melted" },
          { label: "Refined", value: st?.refined_mg, format: grams, unit: "g", href: "/gold/melting?status=APPROVED", loading: stages.isLoading, sub: "Approved output" },
          { label: "For sale", value: st?.for_sale_mg, format: grams, unit: "g", href: "/inventory", loading: stages.isLoading, sub: st && totalFine ? `${((st.for_sale_mg / totalFine) * 100).toFixed(0)}% of the vault` : "Finished pieces" },
          {
            label: "Active batches",
            value: batchesLoading ? undefined : activeBatches,
            href: "/gold/melting",
            loading: batchesLoading,
            tone: awaitingApproval > 0 ? "warn" : undefined,
            sub: awaitingApproval > 0 ? `${awaitingApproval} need approval` : "Draft, locked, melted",
          },
          {
            label: "Melt yield",
            value: yieldPct,
            format: (n) => n.toFixed(2),
            unit: "%",
            loading: approved.isLoading,
            tone: yieldPct === undefined ? undefined : yieldPct >= 99 ? "good" : yieldPct >= 97 ? "warn" : "bad",
            sub: approvedRows.length ? `Last ${approvedRows.length} approved · −${grams(lossMg)} g` : "No approved batches",
          },
          { label: "Movements · month", value: monthMoves.data?.total, format: count, unit: "entries", href: "/gold/ledger", loading: monthMoves.isLoading, sub: recentMoves.data ? `${count(recentMoves.data.total)} on record` : undefined },
        ]}
      />

      {/* ------------------------------------------------- flow + pipeline */}
      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHead
            icon={GemIcon}
            title="Gold flow"
            sub="Where the vault's fine gold sits right now · tap a stage to open it"
            action={
              st && totalFine ? (
                <span className="g-metric text-[11px] text-ink-4">
                  <span className="text-[13px] text-ink">{grams(totalFine)}</span> g fine
                </span>
              ) : null
            }
          />
          <div className="px-4 pt-3">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-ink/[0.06]" aria-hidden>
              {st && totalFine
                ? FLOW.map((f) =>
                    st[f.key] > 0 ? (
                      <span
                        key={f.key}
                        className={cn("h-full border-r-2 border-paper transition-[width] duration-700 ease-brand last:border-r-0", f.bar)}
                        style={{ width: `${(st[f.key] / totalFine) * 100}%` }}
                      />
                    ) : null
                  )
                : null}
            </div>
          </div>
          <ol className="mt-3 grid flex-1 grid-cols-2 gap-px border-t border-ink/20 bg-ink/[0.06] lg:grid-cols-4">
            {FLOW.map((f, i) => {
              const share = st && totalFine ? (st[f.key] / totalFine) * 100 : 0;
              return (
                <li key={f.key} className="bg-paper">
                  <Link href={f.href} className="group relative flex h-full flex-col px-4 py-3 transition-colors hover:bg-gold-pale/50">
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5">
                        <span className={cn("size-2 rounded-full", f.bar)} />
                        <span className="text-[12px] font-semibold text-ink transition-colors group-hover:text-gold-dark">{f.label}</span>
                      </span>
                      <span className="g-metric text-[10px] text-ink-5">{st && totalFine ? `${share.toFixed(0)}%` : `0${i + 1}`}</span>
                    </span>
                    {stages.isLoading ? (
                      <Skeleton className="mt-2 h-6 w-20" />
                    ) : (
                      <span className="g-metric mt-1.5 flex items-baseline gap-1 text-[20px] leading-none text-ink">
                        {st ? grams(st[f.key]) : "—"}
                        <span className="text-[10px] font-medium text-ink-4">g</span>
                      </span>
                    )}
                    <span className="mt-1.5 flex items-center gap-1 text-[10.5px] text-ink-4">
                      <f.icon size={11} className="text-ink-5 group-hover:text-gold-dark" />
                      {f.hint}
                    </span>
                    {i < FLOW.length - 1 ? (
                      <ArrowRightIcon size={11} className="absolute right-2.5 top-1/2 hidden -translate-y-1/2 text-ink-6 lg:block" />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ol>
        </Card>

        <Card className="xl:col-span-4">
          <CardHead
            icon={FlaskConicalIcon}
            title="Batch pipeline"
            sub={batchesLoading ? "Melting batches by status" : awaitingApproval > 0 ? `${awaitingApproval} melted, waiting on approval` : `${activeBatches} active`}
            action={<HeadLink href="/gold/melting">All</HeadLink>}
          />
          <ul className="flex-1 divide-y divide-ink/[0.05]">
            {PIPELINE.map((s, i) => {
              const c = batchCounts[i];
              const m = BATCH_META[s]!;
              return (
                <li key={s}>
                  <Link href={`/gold/melting?status=${s}`} className="group flex items-center gap-3 px-4 py-2 transition-colors hover:bg-gold-pale/40">
                    <span className={cn("size-2 shrink-0 rounded-full", m.dot)} />
                    <span className="w-20 shrink-0 leading-tight">
                      <span className="block text-[12px] font-semibold text-ink group-hover:text-gold-dark">{m.label}</span>
                      <span className="block truncate text-[10px] text-ink-5">{m.hint}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                        <span className={cn("block h-full rounded-full transition-[width] duration-700", m.dot)} style={{ width: `${((c ?? 0) / pipelineMax) * 100}%` }} />
                      </span>
                    </span>
                    <span className="g-metric w-8 text-right text-[15px] text-ink">{batchesLoading ? "…" : c ?? "—"}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="grid grid-cols-3 border-t border-ink/20 bg-bone/50 text-center">
            {[
              ["Fine in", fineIn ? `${grams(fineIn)} g` : "—"],
              ["Fine out", fineOut ? `${grams(fineOut)} g` : "—"],
              ["Loss", lossMg ? `${grams(lossMg)} g` : "—"],
            ].map(([k, v], i) => (
              <div key={k} className={cn("px-2 py-2", i > 0 && "border-l border-ink/20")}>
                <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-5">{k}</div>
                <div className={cn("g-metric text-[12px]", k === "Loss" && lossMg ? "text-rose-700" : "text-ink")}>{v}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* --------------------------------------------- batches + holdings */}
      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-6">
          <CardHead
            icon={FlaskConicalIcon}
            title="Recent batches"
            sub={yieldPct === undefined ? "Latest melting batches" : `${yieldPct.toFixed(2)}% yield over the last ${approvedRows.length} approved`}
            action={
              <>
                {canManage ? (
                  <Link href="/gold/melting?new=1" className="inline-flex items-center gap-1 rounded-md bg-void px-2 py-1 text-[11px] font-semibold text-gold-light hover:bg-void/90">
                    <PlusIcon size={11} /> New
                  </Link>
                ) : null}
                <HeadLink href="/gold/melting">Melting</HeadLink>
              </>
            }
          />
          {recentBatches.isLoading ? (
            <RowsSkeleton />
          ) : (recentBatches.data?.rows ?? []).length === 0 ? (
            <Empty icon={FlaskConicalIcon} title="No batches yet" desc="Start a melting batch to turn bought-in old gold into refined fine gold." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className={thead}>
                    <th className={cn(th, "pl-4")}>Batch</th>
                    <th className={th}>Status</th>
                    <th className={cn(th, "text-right")}>In g</th>
                    <th className={cn(th, "text-right")}>Out g</th>
                    <th className={cn(th, "pr-4 text-right")}>Yield</th>
                  </tr>
                </thead>
                <tbody>
                  {(recentBatches.data?.rows ?? []).map((b) => {
                    const y = b.input_fine_mg > 0 && b.output_fine_mg > 0 ? (b.output_fine_mg / b.input_fine_mg) * 100 : undefined;
                    return (
                      <tr key={b.id} className={tr}>
                        <td className="py-1.5 pl-4 pr-2">
                          <Link href={`/gold/melting/${b.id}`} className="g-metric font-semibold text-ink hover:text-gold-dark">
                            {b.number}
                          </Link>
                          <span className="ml-1.5 text-[10px] text-ink-5">{ago(b.created_at)}</span>
                        </td>
                        <td className="px-2">
                          <StatusChip status={b.status} />
                        </td>
                        <td className="g-metric px-2 text-right text-ink-2">{grams(b.input_fine_mg)}</td>
                        <td className="g-metric px-2 text-right text-ink-2">{b.output_fine_mg ? grams(b.output_fine_mg) : "—"}</td>
                        <td className="py-1.5 pl-2 pr-4 text-right">
                          {y !== undefined ? (
                            <span className={cn("g-metric", y >= 99 ? "text-emerald-700" : y >= 97 ? "text-amber-700" : "text-rose-700")}>{y.toFixed(1)}%</span>
                          ) : (
                            <span className="text-ink-6">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="xl:col-span-3">
          <CardHead icon={GemIcon} title="By purity" sub={purityTotal ? `${grams(purityTotal)} g fine` : "Fine gold on hand"} action={<HeadLink href="/gold/stock">Stock</HeadLink>} />
          {byPurity.isLoading ? (
            <RowsSkeleton />
          ) : purityRows.length === 0 ? (
            <Empty icon={GemIcon} title="Vault is empty" desc="Fine gold on hand will be split by purity here." />
          ) : (
            <ul className="space-y-2 p-4">
              {purityRows.slice(0, 6).map((r, i) => {
                const share = purityTotal ? (r.fine_mg / purityTotal) * 100 : 0;
                return (
                  <li key={r.permille}>
                    <div className="flex items-baseline justify-between gap-2 text-[12px]">
                      <span className="font-semibold text-ink">
                        {r.permille}‰ <span className="font-normal text-ink-5">· {karat(r.permille)}</span>
                      </span>
                      <span className="g-metric text-ink">
                        {grams(r.fine_mg)} <span className="text-[10px] text-ink-5">{share.toFixed(0)}%</span>
                      </span>
                    </div>
                    <ShareBar value={share} className="mt-1" color={PURITY_BARS[i % PURITY_BARS.length]} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="xl:col-span-3">
          <CardHead icon={StoreIcon} title="By branch" sub={branchRows.length ? `${branchRows.length} holding gold` : "Where the gold is held"} action={<HeadLink href="/gold/stock">Stock</HeadLink>} />
          {byBranch.isLoading ? (
            <RowsSkeleton />
          ) : branchRows.length === 0 ? (
            <Empty icon={StoreIcon} title="Nothing held" desc="Fine gold on hand will be split by branch here." />
          ) : (
            <ul className="space-y-2 p-4">
              {branchRows.slice(0, 6).map((r) => {
                const share = branchTotal ? (r.fine_mg / branchTotal) * 100 : 0;
                return (
                  <li key={r.branch_id ?? "none"}>
                    <div className="flex items-baseline justify-between gap-2 text-[12px]">
                      <span className="min-w-0 truncate font-semibold text-ink">
                        {branchName.get(r.branch_id) ?? (r.branch_id ? r.branch_id.slice(0, 8) : "Unassigned")}
                      </span>
                      <span className="g-metric shrink-0 text-ink">
                        {grams(r.fine_mg)} <span className="text-[10px] text-ink-5">{share.toFixed(0)}%</span>
                      </span>
                    </div>
                    <ShareBar value={share} className="mt-1" />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* ------------------------------------------------------------ ledger */}
      <Card>
        <CardHead
          icon={HistoryIcon}
          title="Latest movements"
          sub={monthMoves.data ? `${count(monthMoves.data.total)} movements this month · newest lines on the gold ledger` : "Every gram in and out"}
          action={<HeadLink href="/gold/ledger">Full ledger</HeadLink>}
        />
        {recentMoves.isLoading ? (
          <RowsSkeleton rows={5} />
        ) : moves.length === 0 ? (
          <Empty icon={BookOpenIcon} title="No movements yet" desc="Purchases, sales, melts and transfers post here as gold moves." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Movement</th>
                  <th className={th}>From → to</th>
                  <th className={cn(th, "text-right")}>Purity</th>
                  <th className={cn(th, "text-right")}>Gross g</th>
                  <th className={cn(th, "text-right")}>Fine g</th>
                  <th className={cn(th, "pr-4 text-right")}>When</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((e) => {
                  const dir = direction(e.type);
                  return (
                    <tr key={e.id} className={tr}>
                      <td className="py-1.5 pl-4 pr-2">
                        <Link href={`/gold/ledger?type=${e.type}`} className="flex items-center gap-2 font-semibold text-ink hover:text-gold-dark">
                          <DirectionGlyph type={e.type} />
                          {pretty(e.type)}
                        </Link>
                      </td>
                      <td className="max-w-[260px] truncate px-2 text-ink-3">
                        {pretty(e.source)} <span className="text-ink-5">→</span> {pretty(e.destination)}
                      </td>
                      <td className="g-metric px-2 text-right text-ink-4">
                        {e.permille}‰ <span className="text-[10px] text-ink-5">{karat(e.permille)}</span>
                      </td>
                      <td className="g-metric px-2 text-right text-ink-3">{grams(e.weight_mg)}</td>
                      <td className={cn("g-metric px-2 text-right font-semibold", dir === "in" ? "text-emerald-700" : dir === "out" ? "text-rose-700" : "text-ink")}>
                        {dir === "in" ? "+" : dir === "out" ? "−" : ""}
                        {grams(e.fine_mg)}
                      </td>
                      <td className="whitespace-nowrap py-1.5 pl-2 pr-4 text-right text-[11px] text-ink-5">{ago(e.occurred_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
