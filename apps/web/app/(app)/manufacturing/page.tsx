"use client";

import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, Skeleton } from "@/components/ui";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  GemIcon,
  HammerIcon,
  PackageIcon,
  PlusIcon,
  ScaleIcon,
  TrendingUpIcon,
} from "@/components/icons";
import {
  Card,
  CardHead,
  Empty,
  GoldHero,
  HeadLink,
  HeroBadge,
  ORDER_FLOW,
  ORDER_META,
  OPEN_STATUSES,
  OrderChip,
  RowsSkeleton,
  ShareBar,
  TypeChip,
  ago,
  count,
  grams,
  heroGhost,
  heroGold,
  lkrFromCents,
  th,
  thead,
  tr,
} from "./kit";

/* ------------------------------------------------------------------ types */

type Summary = { byStatus: { status: string; n: number }[]; goldInMg: number; goldOutMg: number; lossMg: number; labourCents: number };
type Wip = { id: string; number: string; status: string; allocatedMg: number; outputs: number };
type Order = { id: string; number: string; type: string; design: string; status: string; customer_name: string | null; created_at: number };
type Paged<R> = { rows: R[]; total: number };
type Stages = { stages: { old_gold_mg: number; melting_mg: number; refined_mg: number; for_sale_mg: number } };

/* ------------------------------------------------------------------- page */

export default function ManufacturingDashboardPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const perms = me.data?.permissions ?? [];
  const canCreate = hasPermission(perms, "mfg:create");
  const canGold = hasPermission(perms, "gold:view");

  const opt = { retry: false, staleTime: 30_000 } as const;
  const month = useQuery({ ...opt, queryKey: ["mfg-summary", "month"], queryFn: () => api<Summary>("/api/v1/manufacturing/reports/summary?period=month") });
  const allTime = useQuery({ ...opt, queryKey: ["mfg-summary", "all"], queryFn: () => api<Summary>("/api/v1/manufacturing/reports/summary?period=all") });
  const wip = useQuery({ ...opt, queryKey: ["mfg-wip"], queryFn: () => api<Wip[]>("/api/v1/manufacturing/reports/wip") });
  const recent = useQuery({ ...opt, queryKey: ["mfg-dash", "recent", 8], queryFn: () => api<Paged<Order>>("/api/v1/manufacturing/orders?limit=8") });
  const stock = useQuery({
    ...opt,
    enabled: canGold,
    queryKey: ["gold-stock", "stage"],
    queryFn: () => api<Stages>("/api/v1/gold/stock?groupBy=stage"),
  });
  const [internal, customer] = useQueries({
    queries: ["INTERNAL", "CUSTOMER"].map((t) => ({
      ...opt,
      queryKey: ["mfg-dash", "type", t],
      queryFn: () => api<Paged<Order>>(`/api/v1/manufacturing/orders?type=${t}&limit=1`),
    })),
  });

  const m = month.data;
  const statusCount = new Map((allTime.data?.byStatus ?? []).map((r) => [r.status, r.n]));
  const counts = ORDER_FLOW.map((s) => statusCount.get(s) ?? 0);
  const inFlow = counts.reduce((a, c) => a + c, 0);
  const open = OPEN_STATUSES.reduce((a, s) => a + (statusCount.get(s) ?? 0), 0);
  const failed = statusCount.get("QC_FAILED") ?? 0;
  const readyToFinish = statusCount.get("QC_PASSED") ?? 0;
  const completed = statusCount.get("COMPLETE") ?? 0;
  const wipRows = wip.data ?? [];
  const wipGold = wipRows.reduce((s, w) => s + w.allocatedMg, 0);
  const lossPct = m && m.goldInMg > 0 ? (m.lossMg / m.goldInMg) * 100 : undefined;
  const outPct = m && m.goldInMg > 0 ? Math.min(100, (m.goldOutMg / m.goldInMg) * 100) : 0;
  const benchPct = m && m.goldInMg > 0 ? Math.max(0, 100 - outPct - (lossPct ?? 0)) : 0;
  const internalN = internal?.data?.total;
  const customerN = customer?.data?.total;
  const typeTotal = (internalN ?? 0) + (customerN ?? 0);

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={HammerIcon}
        title="Manufacturing"
        accent="workshop"
        badge={failed > 0 ? <HeroBadge tone="bad">{failed} failed QC</HeroBadge> : <HeroBadge>Lineage-tracked</HeroBadge>}
        sub={
          <>
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · refined lots in, finished pieces out,
            every gram traced
          </>
        }
        actions={
          <>
            {canCreate ? (
              <Link href="/manufacturing/orders?new=1" className={heroGold}>
                <PlusIcon size={13} />
                New order
              </Link>
            ) : null}
            <Link href="/manufacturing/orders?status=IN_PRODUCTION" className={heroGhost}>
              <HammerIcon size={13} />
              On the bench
            </Link>
            {canGold ? (
              <Link href="/gold/melting?status=APPROVED" className={heroGhost}>
                <GemIcon size={13} />
                Refined gold
              </Link>
            ) : null}
            <Link href="/manufacturing/reports" className={heroGhost}>
              <TrendingUpIcon size={13} />
              Reports
            </Link>
          </>
        }
        stats={[
          { label: "Open orders", value: allTime.data ? open : undefined, accent: true, href: "/manufacturing/orders", loading: allTime.isLoading, sub: `${completed} completed all time` },
          { label: "On the bench", value: wip.data ? wipRows.length : undefined, unit: "orders", href: "/manufacturing/reports", loading: wip.isLoading, sub: "Allocated → QC" },
          { label: "Gold on the bench", value: wip.data ? wipGold : undefined, format: grams, unit: "g", href: "/manufacturing/reports", loading: wip.isLoading, sub: "Fine, allocated" },
          { label: "Gold in · month", value: m?.goldInMg, format: grams, unit: "g", loading: month.isLoading, sub: "Issued to orders" },
          { label: "Gold out · month", value: m?.goldOutMg, format: grams, unit: "g", tone: "good", loading: month.isLoading, sub: m && m.goldInMg ? `${outPct.toFixed(1)}% of issued` : "In finished pieces" },
          {
            label: "Loss · month",
            value: m?.lossMg,
            format: grams,
            unit: "g",
            tone: m && m.lossMg > 0 ? "bad" : undefined,
            loading: month.isLoading,
            sub: lossPct !== undefined ? `${lossPct.toFixed(2)}% of issued` : "Recorded at production",
          },
          { label: "Labour & making", value: m?.labourCents, format: lkrFromCents, unit: "LKR", loading: month.isLoading, sub: "This month, with stones" },
          canGold
            ? { label: "Refined, ready", value: stock.data?.stages.refined_mg, format: grams, unit: "g", href: "/gold/melting?status=APPROVED", loading: stock.isLoading, sub: "To allocate" }
            : { label: "Ready to finish", value: allTime.data ? readyToFinish : undefined, loading: allTime.isLoading, sub: "QC passed" },
        ]}
      />

      {/* --------------------------------------------- pipeline + balance */}
      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHead
            icon={HammerIcon}
            title="Production pipeline"
            sub={allTime.isLoading ? "Every order by stage" : `${count(open)} open · ${count(completed)} completed · tap a stage to see its orders`}
            action={
              failed > 0 ? (
                <Link href="/manufacturing/orders?status=QC_FAILED" className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                  <AlertCircleIcon size={11} /> {failed} need rework
                </Link>
              ) : (
                <HeadLink href="/manufacturing/orders">All orders</HeadLink>
              )
            }
          />
          <div className="px-4 pt-3">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-ink/[0.06]" aria-hidden>
              {inFlow > 0
                ? ORDER_FLOW.map((s, i) =>
                    (counts[i] ?? 0) > 0 ? (
                      <span
                        key={s}
                        className={cn("h-full border-r-2 border-paper transition-[width] duration-700 ease-brand last:border-r-0", ORDER_META[s]!.dot)}
                        style={{ width: `${((counts[i] ?? 0) / inFlow) * 100}%` }}
                      />
                    ) : null
                  )
                : null}
            </div>
          </div>
          <ol className="mt-3 grid flex-1 grid-cols-2 gap-px border-t border-ink/[0.06] bg-ink/[0.06] sm:grid-cols-3 lg:grid-cols-6">
            {ORDER_FLOW.map((s, i) => {
              const c = counts[i] ?? 0;
              const meta = ORDER_META[s]!;
              return (
                <li key={s} className="bg-paper">
                  <Link
                    href={`/manufacturing/orders?status=${s}`}
                    className={cn(
                      "group relative flex h-full flex-col px-3.5 py-3 transition-colors",
                      s === "QC_FAILED" && c > 0 ? "bg-rose-50/60 hover:bg-rose-50" : "hover:bg-gold-pale/50"
                    )}
                  >
                    <span className="flex items-center justify-between gap-1">
                      <span className="flex items-center gap-1.5">
                        <span className={cn("size-2 rounded-full", meta.dot)} />
                        <span className="text-[11.5px] font-semibold text-ink transition-colors group-hover:text-gold-dark">{meta.label}</span>
                      </span>
                      <span className="g-metric text-[9.5px] text-ink-5">{inFlow ? `${((c / inFlow) * 100).toFixed(0)}%` : `0${i + 1}`}</span>
                    </span>
                    {allTime.isLoading ? (
                      <Skeleton className="mt-2 h-6 w-8" />
                    ) : (
                      <span className={cn("g-metric mt-1.5 text-[22px] leading-none", s === "QC_FAILED" && c > 0 ? "text-rose-700" : "text-ink")}>
                        {allTime.data ? c : "—"}
                      </span>
                    )}
                    <span className="mt-1 text-[10.5px] text-ink-4">{meta.hint}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </Card>

        <Card className="xl:col-span-4">
          <CardHead icon={ScaleIcon} title="Gold balance · month" sub="Issued to orders against finished pieces" action={<HeadLink href="/manufacturing/reports">Report</HeadLink>} />
          <div className="flex-1 p-4">
            {month.isLoading ? (
              <RowsSkeleton rows={3} />
            ) : !m || m.goldInMg === 0 ? (
              <Empty icon={ScaleIcon} title="No gold issued yet" desc="Allocate refined gold to an order this month to see the balance." />
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-ink/[0.06] text-center">
                  {[
                    { k: "In", v: grams(m.goldInMg), tone: "text-ink" },
                    { k: "Out", v: grams(m.goldOutMg), tone: "text-emerald-700" },
                    { k: "Loss", v: grams(m.lossMg), tone: m.lossMg > 0 ? "text-rose-700" : "text-ink" },
                  ].map((x) => (
                    <div key={x.k} className="bg-bone/70 px-2 py-2">
                      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-5">{x.k} g</div>
                      <div className={cn("g-metric text-[15px]", x.tone)}>{x.v}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-ink/[0.06]">
                    <span className="h-full bg-gradient-to-r from-gold-deep to-gold-light" style={{ width: `${outPct}%` }} />
                    <span className="h-full bg-amber-300/70" style={{ width: `${benchPct}%` }} />
                    <span className="h-full bg-rose-500" style={{ width: `${lossPct ?? 0}%` }} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-ink-4">
                    <span className="flex items-center gap-1">
                      <span className="size-1.5 rounded-full bg-gold" /> {outPct.toFixed(1)}% finished
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="size-1.5 rounded-full bg-amber-300" /> {benchPct.toFixed(1)}% on bench
                    </span>
                    <span className="flex items-center gap-1 text-rose-700">
                      <span className="size-1.5 rounded-full bg-rose-500" /> {(lossPct ?? 0).toFixed(2)}% loss
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="border-t border-ink/[0.06] px-4 py-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">
              <span>Order mix</span>
              <span className="g-metric normal-case tracking-normal">{typeTotal} total</span>
            </div>
            {[
              { label: "For stock", n: internalN, bar: "bg-gold", href: "/manufacturing/orders" },
              { label: "For customers", n: customerN, bar: "bg-void", href: "/custom-orders" },
            ].map((x) => (
              <Link key={x.label} href={x.href} className="group flex items-center gap-2 py-0.5 text-[12px]">
                <span className="w-24 shrink-0 text-ink-3 group-hover:text-gold-dark">{x.label}</span>
                <ShareBar value={typeTotal > 0 ? ((x.n ?? 0) / typeTotal) * 100 : 0} className="flex-1" color={x.bar} />
                <span className="g-metric w-8 text-right text-ink">{x.n === undefined ? "—" : count(x.n)}</span>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      {/* ---------------------------------------------- bench + latest orders */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHead
            icon={HammerIcon}
            title="Work in progress"
            sub={wip.data ? `${wipRows.length} open · ${grams(wipGold)} g fine allocated` : "Allocated, in production or in QC"}
            action={<HeadLink href="/manufacturing/reports">All WIP</HeadLink>}
          />
          {wip.isLoading ? (
            <RowsSkeleton />
          ) : wipRows.length === 0 ? (
            <Empty icon={CheckCircleIcon} title="Bench is clear" desc="Nothing is allocated or in production right now." />
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Order</th>
                  <th className={th}>Status</th>
                  <th className={cn(th, "w-[28%]")}>Share of bench gold</th>
                  <th className={cn(th, "text-right")}>Fine g</th>
                  <th className={cn(th, "pr-4 text-right")}>Pieces</th>
                </tr>
              </thead>
              <tbody>
                {wipRows.slice(0, 8).map((w) => (
                  <tr key={w.id} className={cn(tr, w.status === "QC_FAILED" && "bg-rose-50/50")}>
                    <td className="py-1.5 pl-4 pr-2">
                      <Link href={`/manufacturing/orders/${w.id}`} className="g-metric font-semibold text-ink hover:text-gold-dark">
                        {w.number}
                      </Link>
                    </td>
                    <td className="px-2">
                      <OrderChip status={w.status} />
                    </td>
                    <td className="px-2">
                      <ShareBar value={wipGold ? (w.allocatedMg / wipGold) * 100 : 0} />
                    </td>
                    <td className="g-metric px-2 text-right text-ink">{grams(w.allocatedMg)}</td>
                    <td className="g-metric py-1.5 pl-2 pr-4 text-right text-ink-3">{w.outputs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {wipRows.length > 8 ? <p className="border-t border-ink/[0.05] px-4 py-1.5 text-[11px] text-ink-4">+ {wipRows.length - 8} more on the bench</p> : null}
        </Card>

        <Card>
          <CardHead
            icon={PackageIcon}
            title="Latest orders"
            sub={recent.data ? `${count(recent.data.total)} on file · most recently briefed` : "Most recently briefed"}
            action={
              <>
                {canCreate ? (
                  <Link href="/manufacturing/orders?new=1" className="inline-flex items-center gap-1 rounded-md bg-void px-2 py-1 text-[11px] font-semibold text-gold-light hover:bg-void/90">
                    <PlusIcon size={11} /> New
                  </Link>
                ) : null}
                <HeadLink href="/manufacturing/orders">All</HeadLink>
              </>
            }
          />
          {recent.isLoading ? (
            <RowsSkeleton />
          ) : (recent.data?.rows ?? []).length === 0 ? (
            <Empty icon={PackageIcon} title="No orders yet" desc="Brief your first piece and it will show up here." />
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Order</th>
                  <th className={th}>Design</th>
                  <th className={th}>For</th>
                  <th className={cn(th, "pr-4 text-right")}>Status</th>
                </tr>
              </thead>
              <tbody>
                {(recent.data?.rows ?? []).map((o) => (
                  <tr key={o.id} className={tr}>
                    <td className="whitespace-nowrap py-1.5 pl-4 pr-2">
                      <Link href={`/manufacturing/orders/${o.id}`} className="g-metric font-semibold text-ink hover:text-gold-dark">
                        {o.number}
                      </Link>
                      <span className="ml-1.5 text-[10px] text-ink-5">{ago(o.created_at)}</span>
                    </td>
                    <td className="max-w-[180px] truncate px-2 text-ink-2" title={o.design}>
                      {o.design}
                    </td>
                    <td className="max-w-[140px] truncate px-2">
                      {o.type === "CUSTOMER" ? <span className="text-ink-3">{o.customer_name ?? "Customer"}</span> : <TypeChip type={o.type} />}
                    </td>
                    <td className="py-1.5 pl-2 pr-4 text-right">
                      <OrderChip status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Link href="/manufacturing/orders" className="group mt-auto flex items-center justify-center gap-1 border-t border-ink/[0.06] py-2 text-[11px] font-medium text-ink-4 hover:bg-bone hover:text-ink">
            Open the order book <ArrowRightIcon size={11} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Card>
      </div>
    </Page>
  );
}
