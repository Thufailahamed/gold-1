"use client";

import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, Skeleton, StatusPill } from "@/components/ui";
import {
  Card,
  CardHead,
  Empty,
  HeadLink,
  ListSkeleton,
  ModuleCard,
  ModuleHero,
  SectionHead,
  ago,
  count,
  grams,
  lkr,
} from "@/components/module-dashboard";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  BanknoteIcon,
  CheckCircleIcon,
  GemIcon,
  HammerIcon,
  PackageIcon,
  PlusIcon,
  ScaleIcon,
  TrendingUpIcon,
  UserCheckIcon,
} from "@/components/icons";

/* ------------------------------------------------------------------ types */

type Summary = { byStatus: { status: string; n: number }[]; goldInMg: number; goldOutMg: number; lossMg: number; labourCents: number };
type Wip = { id: string; number: string; status: string; allocatedMg: number; outputs: number };
type Order = { id: string; number: string; type: string; design: string; status: string; customer_name: string | null; created_at: number };
type Paged<R> = { rows: R[]; total: number };
type Stages = { stages: { old_gold_mg: number; melting_mg: number; refined_mg: number; for_sale_mg: number } };

/** A workshop order's life, from brief to finished piece. QC_FAILED is a detour back to the bench. */
const STAGES = [
  { status: "DRAFT", label: "Draft", hint: "Design briefed", bar: "bg-gold-light" },
  { status: "ALLOCATED", label: "Allocated", hint: "Gold issued", bar: "bg-gold" },
  { status: "IN_PRODUCTION", label: "On the bench", hint: "Being made", bar: "bg-amber-400" },
  { status: "QC_FAILED", label: "QC failed", hint: "Needs rework", bar: "bg-rose-500" },
  { status: "QC_PASSED", label: "QC passed", hint: "Ready to finish", bar: "bg-gold-deep" },
  { status: "COMPLETE", label: "Complete", hint: "In stock / delivered", bar: "bg-emerald-500" },
] as const;

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
  const recent = useQuery({ ...opt, queryKey: ["mfg-dash", "recent"], queryFn: () => api<Paged<Order>>("/api/v1/manufacturing/orders?limit=6") });
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
  const counts = STAGES.map((s) => statusCount.get(s.status) ?? 0);
  const countAt = (i: number) => counts[i] ?? 0;
  const inFlow = counts.reduce((a, c) => a + c, 0);
  const active = STAGES.filter((s) => s.status !== "COMPLETE").reduce((a, s) => a + (statusCount.get(s.status) ?? 0), 0);
  const failed = statusCount.get("QC_FAILED") ?? 0;
  const wipRows = wip.data ?? [];
  const wipGold = wipRows.reduce((s, w) => s + w.allocatedMg, 0);
  const lossPct = m && m.goldInMg > 0 ? (m.lossMg / m.goldInMg) * 100 : undefined;
  const outPct = m && m.goldInMg > 0 ? Math.min(100, (m.goldOutMg / m.goldInMg) * 100) : 0;
  const internalN = internal?.data?.total;
  const customerN = customer?.data?.total;
  const typeTotal = (internalN ?? 0) + (customerN ?? 0);

  return (
    <Page>
      <ModuleHero
        kicker="Workshop"
        title={
          <>
            Refined lots in, <span className="home-gold-text">finished pieces out.</span>
          </>
        }
        description="Brief a design, issue gold from approved melting lots, track it across the bench and QC, and finish it into stock — every gram lineage-tracked."
        actions={
          <>
            {canCreate ? (
              <Link href="/manufacturing/orders?new=1" className="home-btn-gold h-10 px-4 text-sm">
                <PlusIcon size={15} />
                New order
              </Link>
            ) : null}
            <Link href="/manufacturing/orders?status=IN_PRODUCTION" className="home-btn-ghost h-10 px-4 text-sm">
              <HammerIcon size={15} />
              On the bench
            </Link>
            <Link href="/manufacturing/reports" className="home-btn-ghost h-10 px-4 text-sm">
              <TrendingUpIcon size={15} />
              Reports
            </Link>
          </>
        }
        metrics={[
          { label: "Work in progress", value: wip.data ? wipRows.length : undefined, format: count, unit: "orders", icon: HammerIcon, href: "/manufacturing/reports" },
          { label: "Gold on the bench", value: wip.data ? wipGold : undefined, format: grams, unit: "g", icon: ScaleIcon, href: "/manufacturing/reports" },
          { label: "Gold out · month", value: m?.goldOutMg, format: grams, unit: "g", icon: GemIcon, href: "/manufacturing/reports" },
          { label: "Labour & making · month", value: m?.labourCents, format: lkr, unit: "LKR", icon: BanknoteIcon, href: "/manufacturing/reports" },
        ]}
      />

      {/* ------------------------------------------------------- workspaces */}
      <SectionHead index="01" title="Workspaces" sub="Jump into any part of the workshop" />
      <div className={cn("grid gap-4 sm:grid-cols-2", canGold || !me.data ? "xl:grid-cols-3" : "xl:grid-cols-2")}>
        <ModuleCard
          href="/manufacturing/orders"
          index="01"
          icon={HammerIcon}
          title="Orders"
          description="Brief new pieces, allocate gold, record production, QC and finish."
          metric={allTime.data ? active : "—"}
          metricLabel="Open orders"
          cta="Manage"
          loading={allTime.isLoading}
          alert={failed > 0}
          delay={0}
        />
        <ModuleCard
          href="/manufacturing/reports"
          index="02"
          icon={TrendingUpIcon}
          title="Reports"
          description="Throughput, the gold balance in versus out, loss and work in progress."
          metric={m ? `${grams(m.goldOutMg)} g` : "—"}
          metricLabel="Gold finished this month"
          cta="View reports"
          loading={month.isLoading}
          delay={60}
        />
        {canGold || !me.data ? (
          <ModuleCard
            href="/gold/melting?status=APPROVED"
            index="03"
            icon={GemIcon}
            title="Refined gold"
            description="Approved melting output — the stock your orders allocate from."
            metric={stock.data ? `${grams(stock.data.stages.refined_mg)} g` : "—"}
            metricLabel="Ready to allocate"
            cta="Melting lots"
            loading={stock.isLoading && canGold}
            delay={120}
          />
        ) : null}
      </div>

      {/* --------------------------------------------------------- pipeline */}
      <SectionHead index="02" title="Production pipeline" sub="Every order by stage — tap a stage to see its orders" />
      <Card>
        <div className="px-5 pt-5 sm:px-6">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-medium text-ink-4">
              <span className="g-metric text-base text-ink">{allTime.isLoading ? "—" : count(active)}</span> orders open ·{" "}
              {count(statusCount.get("COMPLETE") ?? 0)} completed
            </span>
            {failed > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600">
                <AlertCircleIcon size={13} />
                {failed} failed QC
              </span>
            ) : null}
          </div>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-ink/[0.06]" aria-hidden>
            {inFlow > 0
              ? STAGES.map((s, i) =>
                  countAt(i) > 0 ? (
                    <span
                      key={s.status}
                      className={cn("h-full border-r-2 border-paper last:border-r-0 transition-[width] duration-700 ease-brand", s.bar)}
                      style={{ width: `${(countAt(i) / inFlow) * 100}%` }}
                    />
                  ) : null
                )
              : null}
          </div>
        </div>
        <ol className="mt-5 grid grid-cols-2 gap-px border-t border-ink/[0.06] bg-ink/[0.06] sm:grid-cols-3 lg:grid-cols-6">
          {STAGES.map((s, i) => (
            <li key={s.status} className="bg-paper">
              <Link
                href={`/manufacturing/orders?status=${s.status}`}
                className={cn(
                  "group relative flex h-full flex-col px-4 py-4 transition-colors",
                  s.status === "QC_FAILED" && countAt(i) > 0 ? "bg-rose-50/60 hover:bg-rose-50" : "hover:bg-gold-pale/50"
                )}
              >
                <span className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", s.bar)} />
                  <span className="g-metric text-[10px] tracking-[0.2em] text-ink-5">{String(i + 1).padStart(2, "0")}</span>
                </span>
                <span className="mt-3 text-[13px] font-semibold text-ink transition-colors group-hover:text-gold-dark">{s.label}</span>
                {allTime.isLoading ? (
                  <Skeleton className="mt-2 h-7 w-10" />
                ) : (
                  <span className="g-metric mt-1 text-2xl leading-none text-ink">{allTime.data ? countAt(i) : "—"}</span>
                )}
                <span className="mt-2 text-[11px] text-ink-4">{s.hint}</span>
                {i < STAGES.length - 1 ? (
                  <ArrowRightIcon size={12} className="absolute right-3 top-4 hidden text-ink-6 transition-colors group-hover:text-gold-dark lg:block" />
                ) : null}
              </Link>
            </li>
          ))}
        </ol>
      </Card>

      {/* ------------------------------------------------------ gold balance */}
      <SectionHead index="03" title="Gold balance" sub="This month's orders — what went in, what came out, what was lost" />
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHead icon={ScaleIcon} title="In versus out" sub="Fine gold issued to orders against fine gold in finished pieces" action={<HeadLink href="/manufacturing/reports">Report</HeadLink>} />
          <div className="px-5 pb-6 sm:px-6">
            {month.isLoading ? (
              <ListSkeleton rows={2} className="h-16 rounded-xl" />
            ) : !m || m.goldInMg === 0 ? (
              <Empty icon={ScaleIcon} title="No gold issued yet" desc="Allocate refined gold to an order this month to see the balance here." />
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: "Gold in", value: `${grams(m.goldInMg)} g`, tone: "text-ink" },
                    { label: "Gold out", value: `${grams(m.goldOutMg)} g`, tone: "text-emerald-700" },
                    { label: "Loss", value: `${grams(m.lossMg)} g`, tone: m.lossMg > 0 ? "text-rose-700" : "text-ink" },
                  ].map((x) => (
                    <div key={x.label}>
                      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">{x.label}</span>
                      <p className={cn("g-metric mt-1 text-xl leading-none", x.tone)}>{x.value}</p>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="h-3 overflow-hidden rounded-full bg-ink/[0.06]">
                    <div className="h-full rounded-full bg-gradient-to-r from-gold-deep via-gold to-gold-light transition-[width] duration-700 ease-brand" style={{ width: `${outPct}%` }} />
                  </div>
                  <div className="mt-2 flex justify-between text-[11px] text-ink-4">
                    <span>{outPct.toFixed(1)}% of issued gold is in finished pieces</span>
                    {lossPct !== undefined ? <span className={lossPct > 0 ? "text-rose-600" : ""}>{lossPct.toFixed(2)}% loss</span> : null}
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-ink-5">
                  The gap between in and out is gold still on the bench plus recorded loss. Orders are counted by the month they were created.
                </p>
              </div>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHead icon={UserCheckIcon} title="Order mix" sub="Stock pieces versus customer commissions" action={<HeadLink href="/manufacturing/orders">Orders</HeadLink>} />
          <div className="space-y-3 px-5 pb-6 sm:px-6">
            {[
              { label: "For stock", hint: "Internal orders", n: internalN, icon: PackageIcon, bar: "bg-gold" },
              { label: "For customers", hint: "Commissioned pieces", n: customerN, icon: UserCheckIcon, bar: "bg-gold-deep" },
            ].map((x) => (
              <div key={x.label} className="rounded-xl bg-bone/70 p-3.5 ring-1 ring-ink/[0.06]">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-paper text-gold-deep ring-1 ring-ink/[0.08]">
                    <x.icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-ink">{x.label}</span>
                    <span className="block text-[11px] text-ink-4">{x.hint}</span>
                  </span>
                  <span className="g-metric text-xl text-ink">{x.n === undefined ? "—" : count(x.n)}</span>
                </div>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-ink/[0.07]">
                  <div className={cn("h-full rounded-full transition-[width] duration-700 ease-brand", x.bar)} style={{ width: `${typeTotal > 0 ? ((x.n ?? 0) / typeTotal) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ---------------------------------------------------------- the bench */}
      <SectionHead index="04" title="On the bench" sub="Open work and the latest orders" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead
            icon={HammerIcon}
            title="Work in progress"
            sub={wip.data ? `${wipRows.length} open · ${grams(wipGold)} g fine allocated` : "Allocated, in production or in QC"}
            action={<HeadLink href="/manufacturing/reports">All WIP</HeadLink>}
          />
          <div className="px-5 pb-5 sm:px-6">
            {wip.isLoading ? (
              <ListSkeleton />
            ) : wipRows.length === 0 ? (
              <Empty icon={CheckCircleIcon} title="Bench is clear" desc="Nothing is allocated or in production right now." />
            ) : (
              <ul className="space-y-2">
                {wipRows.slice(0, 6).map((w) => (
                  <li key={w.id}>
                    <Link
                      href={`/manufacturing/orders/${w.id}`}
                      className={cn(
                        "group flex items-center gap-3 rounded-xl px-3.5 py-3 ring-1 transition-colors",
                        w.status === "QC_FAILED"
                          ? "bg-rose-50/70 ring-rose-200/70 hover:bg-rose-50"
                          : "bg-bone/70 ring-ink/[0.06] hover:bg-gold-pale/60 hover:ring-gold-dark/20"
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="g-metric text-xs font-semibold text-ink">{w.number}</span>
                        <span className="mt-0.5 block truncate text-xs text-ink-4">
                          {grams(w.allocatedMg)} g allocated · {w.outputs} piece{w.outputs === 1 ? "" : "s"} made
                        </span>
                      </span>
                      <StatusPill status={w.status} />
                      <ArrowRightIcon size={13} className="shrink-0 text-ink-5 transition-all group-hover:translate-x-0.5 group-hover:text-gold-dark" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHead icon={PackageIcon} title="Latest orders" sub="Most recently briefed" action={<HeadLink href="/manufacturing/orders">All orders</HeadLink>} />
          <div className="pb-2">
            {recent.isLoading ? (
              <div className="px-5 pb-4 sm:px-6">
                <ListSkeleton rows={4} className="h-11 rounded-lg" />
              </div>
            ) : (recent.data?.rows ?? []).length === 0 ? (
              <div className="px-5 pb-4 sm:px-6">
                <Empty icon={PackageIcon} title="No orders yet" desc="Brief your first piece and it will show up here." />
              </div>
            ) : (
              <ul className="divide-y divide-ink/[0.05] border-t border-ink/[0.05]">
                {(recent.data?.rows ?? []).map((o) => (
                  <li key={o.id}>
                    <Link href={`/manufacturing/orders/${o.id}`} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gold-pale/40 sm:px-6">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="g-metric text-xs font-semibold text-ink group-hover:text-gold-dark">{o.number}</span>
                          <span className="text-[11px] text-ink-5">{ago(o.created_at)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-ink-4">
                          {o.design} · {o.type === "CUSTOMER" ? o.customer_name ?? "Customer" : "For stock"}
                        </span>
                      </span>
                      <StatusPill status={o.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </Page>
  );
}
