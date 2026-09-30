"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { BarList, Page, Pill, Skeleton, type PillTone } from "@/components/ui";
import {
  Card,
  CardHead,
  Empty,
  HeadLink,
  ListSkeleton,
  ModuleCard,
  ModuleHero,
  SectionHead,
  StatusBoard,
  ago,
  count,
  grams,
  type BoardState,
} from "@/components/module-dashboard";
import {
  ArrowLeftRightIcon,
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

const BATCH_STATES: BoardState[] = [
  { status: "DRAFT", label: "Draft", hint: "Collecting old gold", bar: "bg-gold-light" },
  { status: "LOCKED", label: "Locked", hint: "Ready for the furnace", bar: "bg-amber-400" },
  { status: "MELTED", label: "Melted", hint: "Awaiting assay approval", bar: "bg-gold" },
  { status: "APPROVED", label: "Approved", hint: "Output in the vault", bar: "bg-emerald-500" },
];

const BATCH_TONES: Record<string, PillTone> = { DRAFT: "neutral", LOCKED: "warning", MELTED: "info", APPROVED: "success", VOID: "danger" };

/** Movements that cross the vault boundary; everything else is an internal hand-off. */
const IN_TYPES = new Set(["PURCHASE", "OLD_GOLD_PURCHASE", "RETURN", "RECOVERY"]);
const OUT_TYPES = new Set(["SALE", "LOSS"]);

const pretty = (k: string) => k.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

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
  const recentMoves = useQuery({ ...opt, queryKey: ["gold-dash", "moves"], queryFn: () => api<Paged<Entry>>("/api/v1/gold/ledger?limit=8") });
  const recentBatches = useQuery({ ...opt, queryKey: ["gold-dash", "batches"], queryFn: () => api<Paged<Batch>>("/api/v1/melting/batches?limit=5") });
  const approved = useQuery({
    ...opt,
    queryKey: ["gold-dash", "approved"],
    queryFn: () => api<Paged<Batch>>("/api/v1/melting/batches?status=APPROVED&limit=20"),
  });
  const batchQueries = useQueries({
    queries: BATCH_STATES.map((s) => ({
      ...opt,
      queryKey: ["gold-dash", "batch-state", s.status],
      queryFn: () => api<Paged<Batch>>(`/api/v1/melting/batches?status=${s.status}&limit=1`),
    })),
  });
  const batchCounts = batchQueries.map((q) => q.data?.total);
  const batchesLoading = batchQueries.some((q) => q.isLoading);
  const activeBatches = (batchCounts[0] ?? 0) + (batchCounts[1] ?? 0) + (batchCounts[2] ?? 0);
  const awaitingApproval = batchCounts[2] ?? 0;

  const st = stages.data?.stages;
  const totalFine = st ? st.old_gold_mg + st.melting_mg + st.refined_mg + st.for_sale_mg : undefined;

  // Yield across the most recent approved batches — how much fine survives the melt.
  const approvedRows = approved.data?.rows ?? [];
  const fineIn = approvedRows.reduce((s, b) => s + b.input_fine_mg, 0);
  const fineOut = approvedRows.reduce((s, b) => s + b.output_fine_mg, 0);
  const lossMg = approvedRows.reduce((s, b) => s + b.loss_mg, 0);
  const yieldPct = fineIn > 0 ? (fineOut / fineIn) * 100 : undefined;

  const branchName = new Map((branches.data?.rows ?? []).map((b) => [b.id, b.name]));
  const purityRows = (byPurity.data?.byPurity ?? [])
    .filter((r) => r.fine_mg > 0)
    .slice(0, 6)
    .map((r) => ({ key: String(r.permille), label: `${r.permille}‰`, value: r.fine_mg }));
  const branchRows = (byBranch.data?.byBranch ?? [])
    .filter((r) => r.fine_mg > 0)
    .map((r) => ({ key: r.branch_id ?? "none", label: branchName.get(r.branch_id) ?? (r.branch_id ? r.branch_id.slice(0, 8) : "Unassigned"), value: r.fine_mg }));

  return (
    <Page>
      <ModuleHero
        kicker="Gold vault"
        title={
          <>
            Every gram, <span className="home-gold-text">traced end to end.</span>
          </>
        }
        description="Fine gold from buy-in to melt to showcase — balances, melting batches and an immutable ledger of every movement in one place."
        actions={
          <>
            {canManage ? (
              <Link href="/gold/melting?new=1" className="home-btn-gold h-10 px-4 text-sm">
                <PlusIcon size={15} />
                New melting batch
              </Link>
            ) : null}
            <Link href="/gold/stock" className="home-btn-ghost h-10 px-4 text-sm">
              <CoinsIcon size={15} />
              Stock
            </Link>
            <Link href="/gold/ledger" className="home-btn-ghost h-10 px-4 text-sm">
              <BookOpenIcon size={15} />
              Ledger
            </Link>
          </>
        }
        metrics={[
          { label: "Fine gold on hand", value: totalFine, format: grams, unit: "g", icon: CoinsIcon, href: "/gold/stock" },
          { label: "For sale", value: st?.for_sale_mg, format: grams, unit: "g", icon: StoreIcon, href: "/inventory" },
          { label: "In the melt", value: st?.melting_mg, format: grams, unit: "g", icon: FlaskConicalIcon, href: "/gold/melting?status=LOCKED" },
          { label: "Movements · month", value: monthMoves.data?.total, format: count, unit: "entries", icon: ArrowLeftRightIcon, href: "/gold/ledger" },
        ]}
      />

      {/* ------------------------------------------------------- workspaces */}
      <SectionHead index="01" title="Workspaces" sub="Jump into any part of the vault" />
      <div className={cn("grid gap-4 sm:grid-cols-2", canOldGold || !me.data ? "xl:grid-cols-4" : "xl:grid-cols-3")}>
        <ModuleCard
          href="/gold/stock"
          index="01"
          icon={CoinsIcon}
          title="Stock"
          description="Fine gold on hand by stage, by purity and by branch."
          metric={totalFine === undefined ? "—" : `${grams(totalFine)} g`}
          metricLabel="Fine gold on hand"
          cta="View stock"
          loading={stages.isLoading}
          delay={0}
        />
        <ModuleCard
          href="/gold/melting"
          index="02"
          icon={FlaskConicalIcon}
          title="Melting"
          description="Batch old gold, melt it, assay the output and reconcile any loss."
          metric={batchesLoading ? "—" : activeBatches}
          metricLabel="Active batches"
          cta="Open batches"
          loading={batchesLoading}
          alert={awaitingApproval > 0}
          delay={60}
        />
        <ModuleCard
          href="/gold/ledger"
          index="03"
          icon={BookOpenIcon}
          title="Ledger"
          description="Every gram in and out — immutable, traceable and exportable."
          metric={recentMoves.data ? count(recentMoves.data.total) : "—"}
          metricLabel="Entries on record"
          cta="Open ledger"
          loading={recentMoves.isLoading}
          delay={120}
        />
        {canOldGold || !me.data ? (
          <ModuleCard
            href="/old-gold"
            index="04"
            icon={ScaleIcon}
            title="Old gold"
            description="The buy-in desk that feeds the melt — intake, testing and settlement."
            metric={st ? `${grams(st.old_gold_mg)} g` : "—"}
            metricLabel="Waiting to be melted"
            cta="Old gold desk"
            loading={stages.isLoading}
            delay={180}
          />
        ) : null}
      </div>

      {/* ------------------------------------------------------------- flow */}
      <SectionHead index="02" title="Gold flow" sub="Where the vault's fine gold sits right now — tap a stage to open it" />
      <Card>
        <div className="px-5 pt-5 sm:px-6">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-medium text-ink-4">
              <span className="g-metric text-base text-ink">{totalFine === undefined ? "—" : grams(totalFine)}</span> g fine across the vault
            </span>
            {st && totalFine ? (
              <span className="text-xs font-medium text-gold-dark">{((st.for_sale_mg / totalFine) * 100).toFixed(0)}% ready to sell</span>
            ) : null}
          </div>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-ink/[0.06]" aria-hidden>
            {st && totalFine
              ? FLOW.map((f) =>
                  st[f.key] > 0 ? (
                    <span
                      key={f.key}
                      className={cn("h-full border-r-2 border-paper last:border-r-0 transition-[width] duration-700 ease-brand", f.bar)}
                      style={{ width: `${(st[f.key] / totalFine) * 100}%` }}
                    />
                  ) : null
                )
              : null}
          </div>
        </div>
        <ol className="mt-5 grid grid-cols-2 gap-px border-t border-ink/[0.06] bg-ink/[0.06] lg:grid-cols-4">
          {FLOW.map((f, i) => (
            <li key={f.key} className="bg-paper">
              <Link href={f.href} className="group relative flex h-full flex-col px-5 py-5 transition-colors hover:bg-gold-pale/50">
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", f.bar)} />
                    <span className="g-metric text-[10px] tracking-[0.2em] text-ink-5">{String(i + 1).padStart(2, "0")}</span>
                  </span>
                  <f.icon size={15} className="text-ink-5 transition-colors group-hover:text-gold-dark" />
                </span>
                <span className="mt-3 text-[13px] font-semibold text-ink transition-colors group-hover:text-gold-dark">{f.label}</span>
                {stages.isLoading ? (
                  <Skeleton className="mt-2 h-7 w-20" />
                ) : (
                  <span className="g-metric mt-1 flex items-baseline gap-1 text-2xl leading-none text-ink">
                    {st ? grams(st[f.key]) : "—"}
                    <span className="text-xs font-medium text-ink-4">g</span>
                  </span>
                )}
                <span className="mt-2 text-[11px] text-ink-4">{f.hint}</span>
                {i < FLOW.length - 1 ? (
                  <ArrowRightIcon size={12} className="absolute right-4 top-1/2 hidden -translate-y-1/2 text-ink-6 lg:block" />
                ) : null}
              </Link>
            </li>
          ))}
        </ol>
      </Card>

      {/* ---------------------------------------------------------- melting */}
      <SectionHead index="03" title="Melting" sub="Batches in progress and how well the melt is yielding" />
      <div className="grid gap-4 lg:grid-cols-2">
        <StatusBoard
          icon={FlaskConicalIcon}
          title="Batch pipeline"
          sub={batchesLoading ? "Melting batches by status" : awaitingApproval > 0 ? `${awaitingApproval} melted, waiting on approval` : `${activeBatches} active batch${activeBatches === 1 ? "" : "es"}`}
          action={<HeadLink href="/gold/melting">All batches</HeadLink>}
          states={BATCH_STATES}
          counts={batchCounts}
          loading={batchesLoading}
          href={(s) => `/gold/melting?status=${s}`}
        />

        <Card>
          <CardHead
            icon={GemIcon}
            title="Recent batches"
            sub={
              yieldPct === undefined
                ? "Latest melting batches"
                : `${yieldPct.toFixed(2)}% yield · ${grams(lossMg)} g lost over the last ${approvedRows.length} approved`
            }
            action={<HeadLink href="/gold/melting">Melting</HeadLink>}
          />
          <div className="px-5 pb-5 sm:px-6">
            {recentBatches.isLoading ? (
              <ListSkeleton />
            ) : (recentBatches.data?.rows ?? []).length === 0 ? (
              <Empty icon={FlaskConicalIcon} title="No batches yet" desc="Start a melting batch to turn bought-in old gold into refined fine gold." />
            ) : (
              <ul className="space-y-2">
                {(recentBatches.data?.rows ?? []).map((b) => {
                  const y = b.input_fine_mg > 0 && b.output_fine_mg > 0 ? (b.output_fine_mg / b.input_fine_mg) * 100 : undefined;
                  return (
                    <li key={b.id}>
                      <Link
                        href={`/gold/melting/${b.id}`}
                        className="group flex items-center gap-3 rounded-xl bg-bone/70 px-3.5 py-3 ring-1 ring-ink/[0.06] transition-colors hover:bg-gold-pale/60 hover:ring-gold-dark/20"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="g-metric text-xs font-semibold text-ink">{b.number}</span>
                            <span className="text-[11px] text-ink-5">{ago(b.created_at)}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-ink-4">
                            {grams(b.input_fine_mg)} g in
                            {b.output_fine_mg > 0 ? ` → ${grams(b.output_fine_mg)} g out` : ""}
                            {y !== undefined ? ` · ${y.toFixed(1)}% yield` : ""}
                          </span>
                        </span>
                        {b.loss_mg > 0 ? <span className="g-metric shrink-0 text-xs text-rose-600">−{grams(b.loss_mg)} g</span> : null}
                        <Pill tone={BATCH_TONES[b.status] ?? "neutral"} dot>
                          {b.status}
                        </Pill>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {/* --------------------------------------------------------- holdings */}
      <SectionHead index="04" title="Holdings" sub="Fine gold on hand, split two ways" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead icon={GemIcon} title="By purity" sub="Old gold, refined output and stock" action={<HeadLink href="/gold/stock">Stock</HeadLink>} />
          <div className="px-5 pb-5 sm:px-6">
            {byPurity.isLoading ? (
              <ListSkeleton />
            ) : (
              <BarList tone="light" items={purityRows} format={(n) => `${grams(n)} g`} empty={<Empty icon={GemIcon} title="Vault is empty" desc="Fine gold on hand will be split by purity here." />} />
            )}
          </div>
        </Card>
        <Card>
          <CardHead icon={StoreIcon} title="By branch" sub="Where the gold is held" action={<HeadLink href="/gold/stock">Stock</HeadLink>} />
          <div className="px-5 pb-5 sm:px-6">
            {byBranch.isLoading ? (
              <ListSkeleton />
            ) : (
              <BarList tone="light" items={branchRows} format={(n) => `${grams(n)} g`} empty={<Empty icon={StoreIcon} title="Nothing held" desc="Fine gold on hand will be split by branch here." />} />
            )}
          </div>
        </Card>
      </div>

      {/* ------------------------------------------------------------ ledger */}
      <SectionHead index="05" title="Latest movements" sub="The newest lines on the gold ledger" />
      <Card>
        <CardHead
          icon={HistoryIcon}
          title="Gold ledger"
          sub={monthMoves.data ? `${count(monthMoves.data.total)} movements this month` : "Every gram in and out"}
          action={<HeadLink href="/gold/ledger">Full ledger</HeadLink>}
        />
        <div className="pb-2">
          {recentMoves.isLoading ? (
            <div className="px-5 pb-4 sm:px-6">
              <ListSkeleton rows={4} className="h-11 rounded-lg" />
            </div>
          ) : (recentMoves.data?.rows ?? []).length === 0 ? (
            <div className="px-5 pb-4 sm:px-6">
              <Empty icon={BookOpenIcon} title="No movements yet" desc="Purchases, sales, melts and transfers post here as gold moves." />
            </div>
          ) : (
            <ul className="divide-y divide-ink/[0.05] border-t border-ink/[0.05]">
              {(recentMoves.data?.rows ?? []).map((e) => {
                const dir = IN_TYPES.has(e.type) ? "in" : OUT_TYPES.has(e.type) ? "out" : "move";
                return (
                  <li key={e.id}>
                    <Link href={`/gold/ledger?type=${e.type}`} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gold-pale/40 sm:px-6">
                      <span
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-lg ring-1",
                          dir === "in" && "bg-emerald-50 text-emerald-600 ring-emerald-200/70",
                          dir === "out" && "bg-rose-50 text-rose-600 ring-rose-200/70",
                          dir === "move" && "bg-bone text-ink-4 ring-ink/[0.08]"
                        )}
                      >
                        <ArrowLeftRightIcon size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-ink group-hover:text-gold-dark">{pretty(e.type)}</span>
                          <span className="text-[11px] text-ink-5">{ago(e.occurred_at)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-ink-4">
                          {pretty(e.source)} → {pretty(e.destination)} · {e.permille}‰
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="g-metric block text-sm text-ink">{grams(e.fine_mg)} g</span>
                        <span className="g-metric block text-[11px] text-ink-4">{grams(e.weight_mg)} g gross</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>
    </Page>
  );
}
