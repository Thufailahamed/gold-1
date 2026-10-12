"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, Skeleton } from "@/components/ui";
import {
  ArchiveIcon,
  ArrowRightIcon,
  Building2Icon,
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
  UsersIcon,
} from "@/components/icons";
import {
  Card,
  CardHead,
  Empty,
  GoldHero,
  HeadLink,
  HeroBadge,
  KaratTag,
  OgChip,
  RowsSkeleton,
  STAGES,
  ShareBar,
  ago,
  count,
  grams,
  heroGhost,
  heroGold,
  lkr,
  permille,
  th,
  thead,
  tr,
  type IconCmp,
} from "./kit";

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
type Paged<R> = { rows: R[]; total: number };

/** This month's buy-ins broken down one way, by fine gold. */
function MixCard({
  icon,
  title,
  sub,
  rows,
  loading,
  label,
}: {
  icon: IconCmp;
  title: string;
  sub: string;
  rows: Breakdown[] | undefined;
  loading: boolean;
  label: (k: string | null) => string;
}) {
  const items = (rows ?? []).filter((r) => r.fine_mg > 0 || r.value_cents > 0).slice(0, 6);
  const total = items.reduce((n, r) => n + r.fine_mg, 0);
  return (
    <Card>
      <CardHead icon={icon} title={title} sub={sub} action={<HeadLink href="/old-gold/reports">Report</HeadLink>} />
      {loading ? (
        <RowsSkeleton />
      ) : items.length === 0 ? (
        <Empty icon={icon} title="No buy-ins yet" desc="Purchased items this month will be broken down here." />
      ) : (
        <ul className="space-y-2 p-4">
          {items.map((r, i) => {
            const share = total ? (r.fine_mg / total) * 100 : 0;
            return (
              <li key={r.key ?? `_${i}`}>
                <div className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="min-w-0 truncate font-semibold text-ink">{label(r.key)}</span>
                  <span className="g-metric shrink-0 text-ink">
                    {grams(r.fine_mg)} g <span className="text-[10px] text-ink-5">{share.toFixed(0)}%</span>
                  </span>
                </div>
                <ShareBar value={share} className="mt-1" />
                <div className="mt-0.5 text-[10px] text-ink-5">
                  {r.items} item{r.items === 1 ? "" : "s"} · {lkr(r.value_cents)} LKR
                  {r.fine_mg ? ` · ${lkr((r.value_cents / r.fine_mg) * 1000)} / g` : ""}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------- page */

export default function OldGoldDashboardPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const perms = me.data?.permissions ?? [];
  const canIntake = hasPermission(perms, "oldgold:create");
  const canTest = hasPermission(perms, "oldgold:edit");
  const [todayLabel, setTodayLabel] = useState("");
  useEffect(() => {
    setTodayLabel(new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  }, []);

  const opt = { retry: false, staleTime: 30_000 } as const;
  const today = useQuery({ ...opt, queryKey: ["og-summary", "today"], queryFn: () => api<Summary>("/api/v1/oldgold/reports/summary?period=today") });
  const month = useQuery({ ...opt, queryKey: ["og-summary", "month"], queryFn: () => api<Summary>("/api/v1/oldgold/reports/summary?period=month") });
  const allTime = useQuery({ ...opt, queryKey: ["og-summary", "all"], queryFn: () => api<Summary>("/api/v1/oldgold/reports/summary?period=all") });
  const breakdown = (groupBy: string) => ({
    ...opt,
    queryKey: ["og-breakdown", "month", groupBy],
    queryFn: () => api<Breakdown[]>(`/api/v1/oldgold/reports/breakdown?period=month&groupBy=${groupBy}`),
  });
  const purity = useQuery(breakdown("purity"));
  const byCustomer = useQuery(breakdown("customer"));
  const byBranch = useQuery(breakdown("branch"));
  const pending = useQuery({ ...opt, queryKey: ["og-pending"], queryFn: () => api<Pending[]>("/api/v1/oldgold/reports/pending") });
  const recent = useQuery({ ...opt, queryKey: ["og-dash", "recent", 8], queryFn: () => api<Paged<Item>>("/api/v1/oldgold/items?limit=8") });
  const queue = useQuery({ ...opt, queryKey: ["og-dash", "queue", 8], queryFn: () => api<Paged<Item>>("/api/v1/oldgold/items?status=RECEIVED&limit=8") });

  // One count per pipeline stage; limit=1 keeps each call to a COUNT plus one row.
  const stageCounts = useQueries({
    queries: STAGES.map((s) => ({
      ...opt,
      queryKey: ["og-dash", "stage", s.status],
      queryFn: () => api<Paged<Item>>(`/api/v1/oldgold/items?status=${s.status}&limit=1`),
    })),
  });
  const counts = stageCounts.map((q) => q.data?.total);
  const stagesLoading = stageCounts.some((q) => q.isLoading);
  const inFlow = counts.reduce<number>((a, c) => a + (c ?? 0), 0);
  const [received = 0, tested = 0, valued = 0] = counts;

  const t = today.data;
  const m = month.data;
  const a = allTime.data;
  const pendingRows = pending.data ?? [];
  const pendingValue = pendingRows.reduce((s, p) => s + (p.purchase_value_cents ?? 0), 0);
  const pendingFine = pendingRows.reduce((s, p) => s + (p.fine_mg ?? 0), 0);
  const perGram = m && m.fine_mg > 0 ? (m.value_cents / m.fine_mg) * 1000 : undefined;
  const yieldPct = m && m.gross_mg > 0 ? (m.fine_mg / m.gross_mg) * 100 : undefined;
  const paidPct = a && a.value_cents > 0 ? Math.min(100, (a.paid_cents / a.value_cents) * 100) : undefined;

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={ScaleIcon}
        title="Buy it back,"
        accent="test it true"
        badge={
          stagesLoading ? null : received ? (
            <HeroBadge tone="warn">{received} waiting for a test</HeroBadge>
          ) : (
            <HeroBadge tone="good">Testing queue clear</HeroBadge>
          )
        }
        sub={<>{todayLabel ? `${todayLabel} · ` : ""}weigh at the counter, assay, settle and send on to the melt</>}
        actions={
          <>
            {canIntake ? (
              <Link href="/old-gold/intake" className={heroGold}>
                <PlusIcon size={13} /> New intake
              </Link>
            ) : null}
            {canTest ? (
              <Link href="/old-gold/testing" className={heroGhost}>
                <FlaskConicalIcon size={13} /> Testing
                {received > 0 ? <span className="g-metric rounded-full bg-gold px-1.5 text-[10px] font-bold leading-4 text-void">{received}</span> : null}
              </Link>
            ) : null}
            <Link href="/old-gold/items" className={heroGhost}>
              <ScanBarcodeIcon size={13} /> Items
            </Link>
            <Link href="/old-gold/reports" className={heroGhost}>
              <TrendingUpIcon size={13} /> Reports
            </Link>
          </>
        }
        stats={[
          { label: "Taken in today", value: t?.items, loading: today.isLoading, href: "/old-gold/items", sub: t ? `${grams(t.gross_mg)} g gross · ${grams(t.fine_mg)} g fine` : undefined },
          { label: "Fine gold · month", value: m?.fine_mg, format: grams, unit: "g", accent: true, loading: month.isLoading, href: "/old-gold/reports", sub: yieldPct !== undefined ? `${yieldPct.toFixed(1)}% of ${grams(m!.gross_mg)} g gross` : "Recovered weight" },
          { label: "Items · month", value: m?.items, loading: month.isLoading, sub: "Bought in" },
          { label: "Value · month", value: m?.value_cents, format: lkr, unit: "LKR", loading: month.isLoading, sub: perGram ? `${lkr(perGram)} LKR / g fine` : "Purchase value" },
          { label: "Paid out · month", value: m?.paid_cents, format: lkr, unit: "LKR", tone: "good", loading: month.isLoading, sub: "To customers" },
          {
            label: "Outstanding",
            value: a?.outstanding_cents,
            format: lkr,
            unit: "LKR",
            tone: a && a.outstanding_cents > 0 ? "warn" : undefined,
            loading: allTime.isLoading,
            href: "/old-gold/reports",
            sub: paidPct !== undefined ? `${paidPct.toFixed(0)}% of all-time paid` : "Owed to customers",
          },
          { label: "Ready to process", value: pending.data ? pendingRows.length : undefined, loading: pending.isLoading, href: "/old-gold/items?status=AVAILABLE", sub: `${grams(pendingFine)} g fine · ${lkr(pendingValue)} LKR` },
          { label: "Items in flow", value: stagesLoading ? undefined : inFlow, loading: stagesLoading, sub: a ? `${count(a.items)} bought all time` : undefined },
        ]}
      >
        <div>
          <div className="flex h-1.5 gap-[2px] overflow-hidden rounded-full bg-paper/10" aria-hidden>
            {inFlow > 0
              ? STAGES.map((s, i) => {
                  const c = counts[i] ?? 0;
                  return c > 0 ? <span key={s.status} className={cn("h-full rounded-full", s.dot)} style={{ width: `${(c / inFlow) * 100}%` }} title={`${s.label}: ${c}`} /> : null;
                })
              : null}
          </div>
          <ol className="mt-2 grid grid-cols-4 gap-1 sm:grid-cols-7">
            {STAGES.map((s, i) => {
              const c = counts[i];
              return (
                <li key={s.status}>
                  <Link
                    href={`/old-gold/items?status=${s.status}`}
                    className="group flex items-center gap-2 rounded-lg px-2 py-1.5 ring-1 ring-inset ring-paper/10 transition-colors hover:bg-paper/[0.06] hover:ring-gold/30"
                  >
                    <span className={cn("size-1.5 shrink-0 rounded-full", s.dot)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[9.5px] font-semibold uppercase tracking-[0.12em] text-paper/45 group-hover:text-gold-light">{s.label}</span>
                      <span className={cn("g-metric block text-[14px] leading-tight", (c ?? 0) > 0 ? "text-paper" : "text-paper/35")}>{stagesLoading ? "—" : c ?? "—"}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      </GoldHero>

      {valued > 0 ? (
        <Link
          href="/old-gold/items?status=VALUED"
          className="group flex items-center gap-3 rounded-2xl bg-gradient-to-r from-gold-pale via-gold-pale/50 to-paper px-4 py-2.5 ring-1 ring-gold-dark/20 transition-all hover:ring-gold-dark/40"
        >
          <span className="size-2 animate-pulse-soft rounded-full bg-gold" />
          <span className="flex-1 text-[12.5px] text-ink-3">
            <span className="g-metric font-semibold text-ink">{valued}</span> valued item{valued === 1 ? " is" : "s are"} waiting on the customer to accept the offer
            {tested ? (
              <>
                {" "}· <span className="g-metric font-semibold text-ink">{tested}</span> tested, not yet valued
              </>
            ) : null}
          </span>
          <ArrowRightIcon size={12} className="text-gold-dark transition-transform group-hover:translate-x-0.5" />
        </Link>
      ) : null}

      {/* --------------------------------------------- counter */}
      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-7">
          <CardHead
            icon={FlaskConicalIcon}
            title="Waiting for a test"
            sub={queue.data ? `${queue.data.total} received, not yet assayed` : "Items received at the counter"}
            action={canTest ? <HeadLink href="/old-gold/testing">Open queue</HeadLink> : null}
          />
          {queue.isLoading ? (
            <RowsSkeleton rows={4} />
          ) : (queue.data?.rows ?? []).length === 0 ? (
            <Empty icon={CheckCircleIcon} title="Queue is clear" desc="Every item received has been tested. New intake will appear here." />
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Item</th>
                  <th className={th}>Description</th>
                  <th className={th}>Customer</th>
                  <th className={cn(th, "text-right")}>Net g</th>
                  <th className={cn(th, "pr-4 text-right")}>Waiting</th>
                </tr>
              </thead>
              <tbody>
                {(queue.data?.rows ?? []).map((r) => (
                  <tr key={r.id} className={tr}>
                    <td className="whitespace-nowrap py-1.5 pl-4 pr-2">
                      <Link href={`/old-gold/items/${r.id}`} className="g-metric font-semibold text-ink hover:text-gold-dark">
                        {r.number}
                      </Link>
                    </td>
                    <td className="max-w-[180px] truncate px-2 text-ink-3">{r.description}</td>
                    <td className="max-w-[140px] truncate px-2 text-ink-4">{r.customer_name ?? "Walk-in"}</td>
                    <td className="g-metric px-2 text-right text-ink">{grams(r.net_mg)}</td>
                    <td className="whitespace-nowrap py-1.5 pl-2 pr-4 text-right text-[11px] text-amber-700">{ago(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <div className="xl:col-span-5">
          <MixCard icon={GemIcon} title="Purity mix" sub="This month · fine gold bought" rows={purity.data} loading={purity.isLoading} label={permille} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHead icon={HistoryIcon} title="Recent intake" sub={recent.data ? `${count(recent.data.total)} on record · latest pieces` : "Latest pieces"} action={<HeadLink href="/old-gold/items">All items</HeadLink>} />
          {recent.isLoading ? (
            <RowsSkeleton rows={5} />
          ) : (recent.data?.rows ?? []).length === 0 ? (
            <Empty icon={InboxIcon} title="Nothing taken in yet" desc="Weigh your first old-gold piece from the Intake page." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-[12px]">
                <thead>
                  <tr className={thead}>
                    <th className={cn(th, "pl-4")}>Item</th>
                    <th className={th}>Description</th>
                    <th className={th}>Karat</th>
                    <th className={cn(th, "text-right")}>Net g</th>
                    <th className={cn(th, "pr-4 text-right")}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(recent.data?.rows ?? []).map((r) => (
                    <tr key={r.id} className={tr}>
                      <td className="whitespace-nowrap py-1.5 pl-4 pr-2">
                        <Link href={`/old-gold/items/${r.id}`} className="g-metric font-semibold text-ink hover:text-gold-dark">
                          {r.number}
                        </Link>
                        <span className="ml-1.5 text-[10px] text-ink-5">{ago(r.created_at)}</span>
                      </td>
                      <td className="max-w-[180px] px-2">
                        <span className="block truncate text-ink-3">{r.description}</span>
                        <span className="block truncate text-[10px] text-ink-5">{r.customer_name ?? "Walk-in"}</span>
                      </td>
                      <td className="px-2">
                        <KaratTag k={r.karat} />
                      </td>
                      <td className="g-metric px-2 text-right text-ink">{grams(r.net_mg)}</td>
                      <td className="py-1.5 pl-2 pr-4 text-right">
                        <OgChip status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHead
            icon={ArchiveIcon}
            title="Ready to process"
            sub={pending.data ? `${pendingRows.length} item${pendingRows.length === 1 ? "" : "s"} · ${grams(pendingFine)} g fine · ${lkr(pendingValue)} LKR` : "Purchased items awaiting melt or resale"}
            action={
              <>
                <Link href="/gold/melting" className="inline-flex items-center gap-1 rounded-md bg-void px-2 py-1 text-[11px] font-semibold text-gold-light hover:bg-void/90">
                  <ScaleIcon size={11} /> Melt
                </Link>
                <HeadLink href="/old-gold/items?status=AVAILABLE">In stock</HeadLink>
              </>
            }
          />
          {pending.isLoading ? (
            <RowsSkeleton rows={5} />
          ) : pendingRows.length === 0 ? (
            <Empty icon={CheckCircleIcon} title="All clear" desc="No purchased items are waiting to be melted or resold." />
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Item</th>
                  <th className={th}>Description</th>
                  <th className={cn(th, "text-right")}>Fine g</th>
                  <th className={cn(th, "text-right")}>Cost LKR</th>
                  <th className={cn(th, "pr-4 text-right")}>Status</th>
                </tr>
              </thead>
              <tbody>
                {pendingRows.slice(0, 8).map((p) => (
                  <tr key={p.id} className={tr}>
                    <td className="whitespace-nowrap py-1.5 pl-4 pr-2">
                      <Link href={`/old-gold/items/${p.id}`} className="g-metric font-semibold text-ink hover:text-gold-dark">
                        {p.number}
                      </Link>
                    </td>
                    <td className="max-w-[160px] px-2">
                      <span className="block truncate text-ink-3">{p.description}</span>
                      <span className="block truncate text-[10px] text-ink-5">{p.customer_name ?? "Walk-in"}</span>
                    </td>
                    <td className="g-metric px-2 text-right text-ink">{grams(p.fine_mg)}</td>
                    <td className="g-metric px-2 text-right text-ink-3">{lkr(p.purchase_value_cents ?? 0)}</td>
                    <td className="py-1.5 pl-2 pr-4 text-right">
                      <OgChip status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* --------------------------------------------- who and where */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <MixCard icon={UsersIcon} title="Top sellers to us" sub="This month · by fine gold" rows={byCustomer.data} loading={byCustomer.isLoading} label={(k) => k ?? "Walk-in"} />
        <MixCard icon={Building2Icon} title="By branch" sub="This month · where it came in" rows={byBranch.data} loading={byBranch.isLoading} label={(k) => k ?? "Unknown"} />
        <Card className="lg:col-span-2 xl:col-span-1">
          <CardHead icon={CoinsIcon} title="Customer payables" sub="What buy-ins have cost in cash so far" />
          <div className="flex-1 space-y-3 p-4">
            {allTime.isLoading ? (
              <Skeleton className="h-28 rounded-xl" />
            ) : (
              <>
                <div>
                  <div className="flex items-baseline justify-between text-[11px] text-ink-4">
                    <span>Paid of all-time buy-ins</span>
                    <span className="g-metric text-ink">{paidPct !== undefined ? `${paidPct.toFixed(0)}%` : "—"}</span>
                  </div>
                  <ShareBar value={paidPct ?? 0} className="mt-1.5 h-2" color="bg-gradient-to-r from-emerald-700 to-emerald-400" />
                </div>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-ink/[0.06] text-center">
                  {[
                    ["Owed now", a ? lkr(a.outstanding_cents) : "—", a && a.outstanding_cents > 0 ? "text-amber-700" : "text-ink"],
                    ["Paid all time", a ? lkr(a.paid_cents) : "—", "text-ink"],
                    ["Value all time", a ? lkr(a.value_cents) : "—", "text-ink"],
                    ["Fine all time", a ? `${grams(a.fine_mg)} g` : "—", "text-ink"],
                  ].map(([k, v, tone]) => (
                    <div key={k} className="bg-bone/70 px-2 py-2">
                      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-5">{k}</div>
                      <div className={cn("g-metric text-[13px]", tone)}>{v}</div>
                    </div>
                  ))}
                </div>
                <Link href="/old-gold/reports" className="group flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11.5px] font-medium text-ink-3 ring-1 ring-ink/[0.08] hover:bg-void hover:text-gold-light">
                  Open reports <ArrowRightIcon size={11} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </>
            )}
          </div>
        </Card>
      </div>
    </Page>
  );
}
