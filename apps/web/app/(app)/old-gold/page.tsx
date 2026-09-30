"use client";

import Link from "next/link";
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
  ago,
  count,
  grams,
  lkr,
} from "@/components/module-dashboard";
import {
  ArchiveIcon,
  ArrowRightIcon,
  BanknoteIcon,
  CheckCircleIcon,
  CoinsIcon,
  FlaskConicalIcon,
  GemIcon,
  HistoryIcon,
  InboxIcon,
  PlusIcon,
  ScaleIcon,
  ScanBarcodeIcon,
  TrendingUpIcon,
} from "@/components/icons";

/* ------------------------------------------------------------------ types */

type Summary = { items: number; gross_mg: number; fine_mg: number; value_cents: number; paid_cents: number; outstanding_cents: number };
type Breakdown = { key: string | null; items: number; value_cents: number; fine_mg: number };
type Item = {
  id: string;
  number: string;
  description: string;
  status: string;
  net_mg: number;
  fine_mg: number | null;
  karat: string | null;
  created_at: number;
  customer_name: string | null;
};
type Pending = { id: string; number: string; description: string; fine_mg: number; purchase_value_cents: number; status: string; customer_name: string | null };

/** The life of a bought-in item, in order. VOID, RESOLD and TRANSFERRED sit outside the flow. */
const STAGES = [
  { status: "RECEIVED", label: "Received", hint: "Awaiting test", bar: "bg-amber-400" },
  { status: "TESTED", label: "Tested", hint: "Needs valuation", bar: "bg-gold-light" },
  { status: "VALUED", label: "Valued", hint: "Offer to customer", bar: "bg-gold" },
  { status: "PURCHASED", label: "Purchased", hint: "Bought in", bar: "bg-gold-dark" },
  { status: "AVAILABLE", label: "In stock", hint: "Ready to melt / resell", bar: "bg-emerald-500" },
  { status: "RESERVED_FOR_MELTING", label: "For melting", hint: "Reserved in a batch", bar: "bg-gold-deep" },
  { status: "MELTED", label: "Melted", hint: "Recovered as fine", bar: "bg-ink-3" },
] as const;

const TONES: Record<string, PillTone> = {
  RECEIVED: "warning",
  TESTED: "info",
  VALUED: "info",
  PURCHASED: "brand",
  AVAILABLE: "success",
  RESERVED_FOR_MELTING: "warning",
  MELTED: "dark",
  RESOLD: "neutral",
  TRANSFERRED: "info",
  VOID: "danger",
};

/* ------------------------------------------------------------------- page */

export default function OldGoldDashboardPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const perms = me.data?.permissions ?? [];
  const canIntake = hasPermission(perms, "oldgold:create");
  const canTest = hasPermission(perms, "oldgold:edit");

  const opt = { retry: false, staleTime: 30_000 } as const;
  const today = useQuery({ ...opt, queryKey: ["og-summary", "today"], queryFn: () => api<Summary>("/api/v1/oldgold/reports/summary?period=today") });
  const month = useQuery({ ...opt, queryKey: ["og-summary", "month"], queryFn: () => api<Summary>("/api/v1/oldgold/reports/summary?period=month") });
  const allTime = useQuery({ ...opt, queryKey: ["og-summary", "all"], queryFn: () => api<Summary>("/api/v1/oldgold/reports/summary?period=all") });
  const purity = useQuery({
    ...opt,
    queryKey: ["og-breakdown", "month", "purity"],
    queryFn: () => api<Breakdown[]>("/api/v1/oldgold/reports/breakdown?period=month&groupBy=purity"),
  });
  const pending = useQuery({ ...opt, queryKey: ["og-pending"], queryFn: () => api<Pending[]>("/api/v1/oldgold/reports/pending") });
  const recent = useQuery({
    ...opt,
    queryKey: ["og-dash", "recent"],
    queryFn: () => api<{ rows: Item[]; total: number }>("/api/v1/oldgold/items?limit=6"),
  });
  const queue = useQuery({
    ...opt,
    queryKey: ["og-dash", "queue"],
    queryFn: () => api<{ rows: Item[]; total: number }>("/api/v1/oldgold/items?status=RECEIVED&limit=5"),
  });

  // One count per pipeline stage; limit=1 keeps each call to a COUNT plus one row.
  const stageCounts = useQueries({
    queries: STAGES.map((s) => ({
      ...opt,
      queryKey: ["og-dash", "stage", s.status],
      queryFn: () => api<{ rows: Item[]; total: number }>(`/api/v1/oldgold/items?status=${s.status}&limit=1`),
    })),
  });
  const counts = stageCounts.map((q) => q.data?.total);
  const stagesLoading = stageCounts.some((q) => q.isLoading);
  const inFlow = counts.reduce<number>((a, c) => a + (c ?? 0), 0);
  const [received = 0, tested = 0, valued = 0] = counts;

  const t = today.data;
  const m = month.data;
  const a = allTime.data;
  const purityRows = (purity.data ?? [])
    .filter((r) => r.fine_mg > 0)
    .map((r) => ({
      key: r.key ?? "unknown",
      label: r.key ? (/^\d+$/.test(r.key) ? `${r.key}‰` : r.key) : "Untested",
      value: r.fine_mg,
      secondary: `${r.items} item${r.items === 1 ? "" : "s"} · ${lkr(r.value_cents)} LKR`,
    }));
  const pendingRows = pending.data ?? [];
  const pendingValue = pendingRows.reduce((s, p) => s + (p.purchase_value_cents ?? 0), 0);

  return (
    <Page>
      <ModuleHero
        kicker="Old gold"
        title={
          <>
            Buy it back, <span className="home-gold-text">test it true.</span>
          </>
        }
        description="Weigh at the counter, assay the purity, settle with the customer and send it on to the melt — every step of the old-gold desk in one place."
        actions={
          <>
            {canIntake ? (
              <Link href="/old-gold/intake" className="home-btn-gold h-10 px-4 text-sm">
                <PlusIcon size={15} />
                New intake
              </Link>
            ) : null}
            {canTest ? (
              <Link href="/old-gold/testing" className="home-btn-ghost h-10 px-4 text-sm">
                <FlaskConicalIcon size={15} />
                Testing queue
                {received > 0 ? (
                  <span className="g-metric rounded-full bg-gold px-1.5 text-[10px] font-bold leading-4 text-void">{received}</span>
                ) : null}
              </Link>
            ) : null}
            <Link href="/old-gold/items" className="home-btn-ghost h-10 px-4 text-sm">
              <ScanBarcodeIcon size={15} />
              Find an item
            </Link>
          </>
        }
        metrics={[
          { label: "Taken in today", value: t?.items, format: count, unit: "items", icon: InboxIcon, href: "/old-gold/items" },
          { label: "Fine gold · month", value: m?.fine_mg, format: grams, unit: "g", icon: GemIcon, href: "/old-gold/reports" },
          { label: "Paid out · month", value: m?.paid_cents, format: lkr, unit: "LKR", icon: BanknoteIcon, href: "/old-gold/reports" },
          { label: "Outstanding", value: a?.outstanding_cents, format: lkr, unit: "LKR", icon: CoinsIcon, href: "/old-gold/reports" },
        ]}
      />

      {/* ------------------------------------------------------- workspaces */}
      <SectionHead index="01" title="Workspaces" sub="Jump into any step of the old-gold desk" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {canIntake || !me.data ? (
          <ModuleCard
            href="/old-gold/intake"
            index="01"
            icon={ScaleIcon}
            title="Intake"
            description="Weigh the piece, log stones and photos, and tag it with an OG barcode."
            metric={t ? t.items : "—"}
            metricLabel="Received today"
            cta="Weigh in"
            loading={today.isLoading}
            delay={0}
          />
        ) : null}
        {canTest || !me.data ? (
          <ModuleCard
            href="/old-gold/testing"
            index="02"
            icon={FlaskConicalIcon}
            title="Testing"
            description="Record assay results, set the purity and value the item for purchase."
            metric={stagesLoading ? "—" : received + tested}
            metricLabel="In the queue"
            cta="Open queue"
            loading={stagesLoading}
            alert={received > 0}
            delay={60}
          />
        ) : null}
        <ModuleCard
          href="/old-gold/items"
          index="03"
          icon={ArchiveIcon}
          title="Items"
          description="Search every bought-in piece by number, status, customer or barcode."
          metric={recent.data ? count(recent.data.total) : "—"}
          metricLabel="Items on record"
          cta="Browse"
          loading={recent.isLoading}
          delay={120}
        />
        <ModuleCard
          href="/old-gold/reports"
          index="04"
          icon={TrendingUpIcon}
          title="Reports"
          description="Buy-ins, fine gold recovered and payables by purity, customer or branch."
          metric={m ? `${grams(m.fine_mg)} g` : "—"}
          metricLabel="Fine gold this month"
          cta="View reports"
          loading={month.isLoading}
          delay={180}
        />
      </div>

      {/* --------------------------------------------------------- pipeline */}
      <SectionHead index="02" title="Pipeline" sub="Where every live item sits right now — tap a stage to see its items" />
      <Card>
        <div className="px-5 pt-5 sm:px-6">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-medium text-ink-4">
              <span className="g-metric text-base text-ink">{stagesLoading ? "—" : count(inFlow)}</span> items in flow
            </span>
            {valued > 0 ? (
              <span className="text-xs font-medium text-gold-dark">{valued} valued, waiting on the customer</span>
            ) : null}
          </div>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-ink/[0.06]" aria-hidden>
            {inFlow > 0
              ? STAGES.map((s, i) => {
                  const c = counts[i] ?? 0;
                  return c > 0 ? (
                    <span
                      key={s.status}
                      className={cn("h-full border-r-2 border-paper last:border-r-0 transition-[width] duration-700 ease-brand", s.bar)}
                      style={{ width: `${(c / inFlow) * 100}%` }}
                    />
                  ) : null;
                })
              : null}
          </div>
        </div>
        <ol className="mt-5 grid grid-cols-2 gap-px border-t border-ink/[0.06] bg-ink/[0.06] sm:grid-cols-4 lg:grid-cols-7">
          {STAGES.map((s, i) => (
            <li key={s.status} className="bg-paper">
              <Link
                href={`/old-gold/items?status=${s.status}`}
                className="group relative flex h-full flex-col px-4 py-4 transition-colors hover:bg-gold-pale/50"
              >
                <span className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", s.bar)} />
                  <span className="g-metric text-[10px] tracking-[0.2em] text-ink-5">{String(i + 1).padStart(2, "0")}</span>
                </span>
                <span className="mt-3 text-[13px] font-semibold text-ink transition-colors group-hover:text-gold-dark">{s.label}</span>
                {stageCounts[i]?.isLoading ? (
                  <Skeleton className="mt-2 h-7 w-10" />
                ) : (
                  <span className="g-metric mt-1 text-2xl leading-none text-ink">{counts[i] ?? "—"}</span>
                )}
                <span className="mt-2 text-[11px] text-ink-4">{s.hint}</span>
                {i < STAGES.length - 1 ? (
                  <ArrowRightIcon
                    size={12}
                    className="absolute right-3 top-4 hidden text-ink-6 transition-colors group-hover:text-gold-dark lg:block"
                  />
                ) : null}
              </Link>
            </li>
          ))}
        </ol>
      </Card>

      {/* ---------------------------------------------------------- activity */}
      <SectionHead index="03" title="At the counter" sub="What needs attention, and what came in last" />
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHead
            icon={FlaskConicalIcon}
            title="Waiting for a test"
            sub={queue.data ? `${queue.data.total} received, not yet assayed` : "Items received at the counter"}
            action={canTest ? <HeadLink href="/old-gold/testing">Open queue</HeadLink> : null}
          />
          <div className="px-5 pb-5 sm:px-6">
            {queue.isLoading ? (
              <ListSkeleton />
            ) : (queue.data?.rows ?? []).length === 0 ? (
              <Empty icon={CheckCircleIcon} title="Queue is clear" desc="Every item received has been tested. New intake will appear here." />
            ) : (
              <ul className="space-y-2">
                {(queue.data?.rows ?? []).map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/old-gold/items/${r.id}`}
                      className="group flex items-center gap-3 rounded-xl bg-bone/70 px-3.5 py-3 ring-1 ring-ink/[0.06] transition-colors hover:bg-gold-pale/60 hover:ring-gold-dark/20"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 ring-1 ring-amber-200/70">
                        <ScaleIcon size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="g-metric text-xs font-semibold text-ink">{r.number}</span>
                          <span className="text-[11px] text-ink-5">{ago(r.created_at)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-ink-4">
                          {r.description} · {r.customer_name ?? "Walk-in"}
                        </span>
                      </span>
                      <span className="g-metric shrink-0 text-sm text-ink">{grams(r.net_mg)} g</span>
                      <ArrowRightIcon size={13} className="shrink-0 text-ink-5 transition-all group-hover:translate-x-0.5 group-hover:text-gold-dark" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHead icon={GemIcon} title="Purity mix" sub="Fine gold bought this month" action={<HeadLink href="/old-gold/reports">Reports</HeadLink>} />
          <div className="px-5 pb-5 sm:px-6">
            {purity.isLoading ? (
              <ListSkeleton />
            ) : (
              <BarList
                tone="light"
                items={purityRows}
                format={(n) => `${grams(n)} g`}
                empty={<Empty icon={GemIcon} title="No buy-ins yet" desc="Purchased items this month will be split by purity here." />}
              />
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead icon={HistoryIcon} title="Recent intake" sub="Latest pieces across all stages" action={<HeadLink href="/old-gold/items">All items</HeadLink>} />
          <div className="pb-2">
            {recent.isLoading ? (
              <div className="px-5 pb-4 sm:px-6">
                <ListSkeleton rows={4} className="h-11 rounded-lg" />
              </div>
            ) : (recent.data?.rows ?? []).length === 0 ? (
              <div className="px-5 pb-4 sm:px-6">
                <Empty icon={InboxIcon} title="Nothing taken in yet" desc="Weigh your first old-gold piece from the Intake page." />
              </div>
            ) : (
              <ul className="divide-y divide-ink/[0.05] border-t border-ink/[0.05]">
                {(recent.data?.rows ?? []).map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/old-gold/items/${r.id}`}
                      className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gold-pale/40 sm:px-6"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="g-metric text-xs font-semibold text-ink group-hover:text-gold-dark">{r.number}</span>
                          {r.karat ? <span className="text-[11px] font-medium text-ink-4">{r.karat}</span> : null}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-ink-4">
                          {r.description} · {r.customer_name ?? "Walk-in"} · {ago(r.created_at)}
                        </span>
                      </span>
                      <span className="g-metric hidden shrink-0 text-xs text-ink-3 sm:block">{grams(r.net_mg)} g</span>
                      <Pill tone={TONES[r.status] ?? "neutral"} dot>
                        {r.status.replace(/_/g, " ")}
                      </Pill>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHead
            icon={ArchiveIcon}
            title="Ready to process"
            sub={
              pending.data
                ? `${pendingRows.length} bought-in item${pendingRows.length === 1 ? "" : "s"} · ${lkr(pendingValue)} LKR`
                : "Purchased items awaiting melt or resale"
            }
            action={<HeadLink href="/old-gold/items?status=AVAILABLE">In stock</HeadLink>}
          />
          <div className="pb-2">
            {pending.isLoading ? (
              <div className="px-5 pb-4 sm:px-6">
                <ListSkeleton rows={4} className="h-11 rounded-lg" />
              </div>
            ) : pendingRows.length === 0 ? (
              <div className="px-5 pb-4 sm:px-6">
                <Empty icon={CheckCircleIcon} title="All clear" desc="No purchased items are waiting to be melted or resold." />
              </div>
            ) : (
              <ul className="divide-y divide-ink/[0.05] border-t border-ink/[0.05]">
                {pendingRows.slice(0, 6).map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/old-gold/items/${p.id}`}
                      className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gold-pale/40 sm:px-6"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="g-metric text-xs font-semibold text-ink group-hover:text-gold-dark">{p.number}</span>
                        <span className="mt-0.5 block truncate text-xs text-ink-4">
                          {p.description} · {p.customer_name ?? "Walk-in"}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="g-metric block text-xs text-ink">{grams(p.fine_mg)} g fine</span>
                        <span className="g-metric block text-[11px] text-ink-4">{lkr(p.purchase_value_cents ?? 0)} LKR</span>
                      </span>
                      <Pill tone={TONES[p.status] ?? "neutral"} dot>
                        {p.status.replace(/_/g, " ")}
                      </Pill>
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
