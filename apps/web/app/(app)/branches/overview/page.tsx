"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, downloadCsv } from "@/lib/api";
import { lkr, lkrSigned, useAccountsScope } from "@/lib/accounts";
import { cn } from "@/lib/cn";
import { Page, Skeleton } from "@/components/ui";
import { Card, CardHead, Empty, GoldHero, HeroBadge, RowsSkeleton, count, grams, heroGhost, th, thead, tr } from "@/components/console-kit";
import {
  ArrowLeftRightIcon,
  BanknoteIcon,
  Building2Icon,
  CoinsIcon,
  FileDownIcon,
  GemIcon,
  UsersIcon,
} from "@/components/icons";

/** Mirrors `BranchView` in apps/api/src/services/overview.ts. */
type BranchView = {
  branch: { id: string; name: string };
  asOf: number;
  month: string;
  jewellery: { pieces: number; netMg: number; fineMg: number; costCents?: number; hasData: boolean };
  gold: { products: number; oldGold: number; lots: number; wip: number; recovered: number; fineMg: number; hasData: boolean };
  cash: { drawer: number; cardClearing: number; hasData: boolean };
  banks: { name: string; balanceCents: number; shared: boolean }[];
  staff: { name: string; roles: string[] }[] | { redacted: true };
  sales: { netCents: number; invoiceCount: number };
  purchases: { valueCents: number };
  transit: { linesOut: { count: number; fineMg: number }; linesIn: { count: number; fineMg: number }; cashInTransit: number };
};

type AllBranches = { asOf: number; branches: BranchView[] };

const isRedacted = (s: BranchView["staff"]): s is { redacted: true } => !Array.isArray(s);
const asOfLabel = (ms: number) => new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const STAGE_TONE: Record<string, string> = { products: "#B8923F", oldGold: "#D97706", lots: "#7C3AED", wip: "#0284C7", recovered: "#059669" };
const darkSelect =
  "h-8 rounded-lg bg-paper/[0.07] px-2.5 text-[12px] text-paper shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] focus:outline-none focus:shadow-[inset_0_0_0_1px_rgba(226,194,122,0.6)] [&>option]:text-ink";
const whole = (c: number) => lkrSigned(c).replace(/\.\d+$/, "");
const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function BranchOverviewPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const { me, perms, canShop, visibleBranches, branchId, setBranchId } = useAccountsScope();
  const canExport = hasPermission(perms, "audit:export");
  const canSeeCost = hasPermission(perms, "purchases:view");
  const canSeePurchases = hasPermission(perms, "purchases:view");

  // Opened from a branch card: /branches/overview?branch=<id>.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("branch");
    if (wanted && visibleBranches.some((b) => b.id === wanted)) setBranchId(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleBranches]);

  const query = `/api/v1/branch-overview?branchId=${encodeURIComponent(branchId)}&month=${month}&year=${year}`;
  const overview = useQuery({
    queryKey: ["branch-overview", branchId, month, year],
    queryFn: () => api<BranchView>(query),
    enabled: !!me.data && branchId !== "",
  });
  // Side-by-side view is manage-only; the API returns an array with no total by design.
  const all = useQuery({
    queryKey: ["branch-overview-all", month, year],
    queryFn: () => api<AllBranches>(`/api/v1/branch-overview/all?month=${month}&year=${year}`),
    enabled: canShop,
  });
  const v = overview.data;

  async function exportCsv() {
    if (!v) return;
    try {
      await downloadCsv(`${query}&format=csv`, `branch-overview-${v.branch.name}-${v.month}.csv`);
    } catch (e) {
      toast.error(errMsg(e, "Download failed"));
    }
  }

  const noBranches = !!me.data && visibleBranches.length === 0;
  const loading = !v && !overview.isError;
  const bestSales = Math.max(1, ...(all.data?.branches ?? []).map((b) => b.sales.netCents));

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={Building2Icon}
        title={v ? v.branch.name : "Branch overview"}
        badge={<HeroBadge tone="muted">{v ? v.month : "Overview"}</HeroBadge>}
        sub={v ? `Stock, gold and cash live as of ${asOfLabel(v.asOf)} · sales and purchases for ${v.month}` : "Stock, gold and cash are a live snapshot; sales are month-to-date"}
        back={{ href: "/branches", label: "Branches" }}
        actions={
          canExport && v ? (
            <button onClick={exportCsv} className={heroGhost}>
              <FileDownIcon size={13} /> CSV
            </button>
          ) : undefined
        }
        stats={[
          { label: "Pieces in stock", value: v?.jewellery.pieces, loading, accent: true, sub: v ? (v.jewellery.hasData ? "in stock + reserved" : "no stock on hand") : undefined },
          { label: "Net weight", value: v?.jewellery.netMg, format: grams, unit: "g", loading },
          { label: "Fine in stock", value: v?.jewellery.fineMg, format: grams, unit: "g", loading },
          ...(canSeeCost
            ? [{ label: "Book cost", value: v && v.jewellery.costCents !== undefined ? v.jewellery.costCents / 100 : undefined, format: (n: number) => Math.round(n).toLocaleString("en-US"), unit: "LKR", loading, sub: "at cost" }]
            : []),
          { label: "Gold held", value: v?.gold.fineMg, format: grams, unit: "g", loading, sub: "fine, all stages" },
          { label: "Cash drawer", value: v ? v.cash.drawer / 100 : undefined, format: (n) => Math.round(n).toLocaleString("en-US"), unit: "LKR", loading, tone: v && v.cash.drawer < 0 ? "bad" : undefined },
          { label: "Net sales · MTD", value: v ? v.sales.netCents / 100 : undefined, format: (n) => Math.round(n).toLocaleString("en-US"), unit: "LKR", loading, tone: "good", sub: v ? `${count(v.sales.invoiceCount)} invoices` : undefined },
          ...(canSeePurchases
            ? [{ label: "Purchases · MTD", value: v ? v.purchases.valueCents / 100 : undefined, format: (n: number) => Math.round(n).toLocaleString("en-US"), unit: "LKR", loading }]
            : []),
        ]}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {visibleBranches.length <= 8
            ? visibleBranches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBranchId(b.id)}
                  className={cn(
                    "h-7 rounded-full px-2.5 text-[11.5px] font-semibold transition-colors",
                    b.id === branchId ? "bg-gold text-void" : "bg-paper/[0.06] text-paper/60 ring-1 ring-inset ring-paper/10 hover:text-paper"
                  )}
                >
                  {b.name}
                </button>
              ))
            : (
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={darkSelect} aria-label="Branch">
                {visibleBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          <span className="ml-auto flex gap-1.5">
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={darkSelect} aria-label="Month">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {new Date(2000, m - 1, 1).toLocaleString("en-US", { month: "long" })}
                </option>
              ))}
            </select>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={darkSelect} aria-label="Year">
              {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </span>
        </div>
      </GoldHero>

      {me.isError ? (
        <Card>
          <Empty icon={Building2Icon} title="Overview unavailable" desc={errMsg(me.error, "Could not load your session.")} />
        </Card>
      ) : noBranches ? (
        <Card>
          <Empty icon={Building2Icon} title="No branches" desc="You are not a member of any active branch." />
        </Card>
      ) : overview.isError ? (
        <Card>
          <Empty icon={Building2Icon} title="Overview unavailable" desc={errMsg(overview.error, "Could not load this branch.")} />
        </Card>
      ) : !v ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      ) : (
        <BranchSections v={v} />
      )}

      {canShop ? (
        <Card>
          <CardHead
            icon={Building2Icon}
            title="All branches"
            sub={all.data ? `Side by side · live as of ${asOfLabel(all.data.asOf)} · each branch computed on its own, never summed` : "Side by side, each branch computed on its own"}
          />
          {all.isLoading ? (
            <RowsSkeleton rows={3} />
          ) : all.isError ? (
            <Empty icon={Building2Icon} title="Comparison unavailable" desc={errMsg(all.error, "Could not load all branches.")} />
          ) : !all.data || all.data.branches.length === 0 ? (
            <Empty icon={Building2Icon} title="No active branches" desc="Activate a branch to compare it here." />
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[920px] text-[12.5px]">
                <thead className={thead}>
                  <tr>
                    <th className={cn(th, "pl-4")}>Branch</th>
                    <th className={cn(th, "text-right")}>Pieces</th>
                    <th className={cn(th, "text-right")}>Book cost</th>
                    <th className={cn(th, "text-right")}>Gold held</th>
                    <th className={cn(th, "text-right")}>Drawer</th>
                    <th className={cn(th, "text-right")}>Card clearing</th>
                    <th className={cn(th, "w-[180px]")}>Net sales</th>
                    <th className={cn(th, "text-right")}>Invoices</th>
                    <th className={cn(th, "text-right")}>Purchases</th>
                    <th className={cn(th, "pr-4")} />
                  </tr>
                </thead>
                <tbody>
                  {all.data.branches.map((b) => {
                    const on = b.branch.id === branchId;
                    return (
                      <tr key={b.branch.id} className={cn(tr, on && "bg-gold-pale/40")}>
                        <td className="py-2 pl-4 pr-2 font-semibold text-ink">
                          <span className="flex items-center gap-2">
                            {b.branch.name}
                            {on ? <span className="rounded-full bg-gold/20 px-1.5 text-[9.5px] font-semibold text-gold-deep">Viewing</span> : null}
                          </span>
                        </td>
                        <td className="g-metric px-2 text-right">{count(b.jewellery.pieces)}</td>
                        <td className="g-metric px-2 text-right text-ink-3">{whole(b.jewellery.costCents ?? 0)}</td>
                        <td className="g-metric px-2 text-right">{grams(b.gold.fineMg)} g</td>
                        <td className={cn("g-metric px-2 text-right", b.cash.drawer < 0 ? "text-rose-700" : "text-ink-3")}>{whole(b.cash.drawer)}</td>
                        <td className="g-metric px-2 text-right text-ink-3">{whole(b.cash.cardClearing)}</td>
                        <td className="px-2">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/[0.06]">
                              <div className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400" style={{ width: `${Math.max(0, (b.sales.netCents / bestSales) * 100)}%` }} />
                            </div>
                            <span className="g-metric w-[78px] text-right font-semibold text-ink">{whole(b.sales.netCents)}</span>
                          </div>
                        </td>
                        <td className="g-metric px-2 text-right text-ink-3">{count(b.sales.invoiceCount)}</td>
                        <td className="g-metric px-2 text-right text-ink-3">{whole(b.purchases.valueCents)}</td>
                        <td className="py-2 pl-2 pr-4 text-right">
                          {on ? null : (
                            <button onClick={() => setBranchId(b.branch.id)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-ink-3 ring-1 ring-inset ring-ink/10 hover:bg-bone hover:text-ink">
                              View
                            </button>
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
      ) : null}
    </Page>
  );
}

function BranchSections({ v }: { v: BranchView }) {
  const { gold, cash, transit } = v;
  const stages = [
    { key: "products", label: "Products", mg: gold.products },
    { key: "oldGold", label: "Old gold", mg: gold.oldGold },
    { key: "lots", label: "Melted lots", mg: gold.lots },
    { key: "wip", label: "Work in progress", mg: gold.wip },
    { key: "recovered", label: "Recovered", mg: gold.recovered },
  ];
  const stageTotal = stages.reduce((a, s) => a + Math.max(0, s.mg), 0) || 1;
  const bankTotal = v.banks.filter((b) => !b.shared).reduce((a, b) => a + b.balanceCents, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <Card>
        <CardHead icon={GemIcon} title="Gold held" sub={`${grams(gold.fineMg)} g fine across all stages`} />
        {gold.hasData ? (
          <div className="p-4">
            <div className="flex h-3 overflow-hidden rounded-full bg-ink/[0.06]">
              {stages.map((s) =>
                s.mg > 0 ? <div key={s.key} title={`${s.label} · ${grams(s.mg)} g`} style={{ width: `${(s.mg / stageTotal) * 100}%`, background: STAGE_TONE[s.key] }} /> : null
              )}
            </div>
            <ul className="mt-3 space-y-1.5">
              {stages.map((s) => (
                <li key={s.key} className="flex items-center gap-2 text-[12px]">
                  <span className="size-2 rounded-sm" style={{ background: STAGE_TONE[s.key] }} />
                  <span className="flex-1 text-ink-3">{s.label}</span>
                  <span className="g-metric text-[10.5px] text-ink-5">{Math.round((Math.max(0, s.mg) / stageTotal) * 100)}%</span>
                  <span className="g-metric w-[84px] text-right font-semibold text-ink">{grams(s.mg)} g</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Empty icon={GemIcon} title="No gold held" desc="Nothing recorded at this branch yet." />
        )}
      </Card>

      <Card>
        <CardHead icon={BanknoteIcon} title="Cash & banks" sub="Journal balances, not month-end cash" />
        <div className="grid grid-cols-2 gap-px border-b border-ink/[0.06] bg-ink/[0.05]">
          {[
            { k: "Cash drawer · 1000", c: cash.drawer },
            { k: "Card clearing · 1020", c: cash.cardClearing },
          ].map((m) => (
            <div key={m.k} className="bg-paper px-4 py-2.5">
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{m.k}</div>
              <div className={cn("g-metric mt-0.5 text-[15px] font-semibold", m.c < 0 ? "text-rose-700" : "text-ink")}>{lkrSigned(m.c)}</div>
            </div>
          ))}
        </div>
        {v.banks.length === 0 ? (
          <p className="px-4 py-3 text-[12px] text-ink-4">No bank accounts</p>
        ) : (
          <ul className="divide-y divide-ink/[0.05]">
            {v.banks.map((b, i) => (
              <li key={`${b.name}-${i}`} className="flex items-center gap-2 px-4 py-2 text-[12px]">
                <Building2Icon size={12} className="text-ink-5" />
                <span className="flex-1 truncate text-ink-2">{b.name}</span>
                {b.shared ? <span className="rounded-full bg-sky-500/10 px-1.5 text-[9.5px] font-semibold text-sky-800">Shared</span> : null}
                <span className="g-metric font-semibold text-ink">{lkrSigned(b.balanceCents)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between bg-bone/50 px-4 py-1.5 text-[11px] text-ink-4">
              <span>Branch-owned banks</span>
              <span className="g-metric font-semibold text-ink-2">{lkrSigned(bankTotal)}</span>
            </li>
          </ul>
        )}
      </Card>

      <Card>
        <CardHead icon={ArrowLeftRightIcon} title="In transit" sub="Counted on neither branch's shelf or drawer" />
        <ul className="divide-y divide-ink/[0.05]">
          {[
            { k: "Pieces going out", n: transit.linesOut.count, mg: transit.linesOut.fineMg, tone: "#E11D48", dir: "↗" },
            { k: "Pieces coming in", n: transit.linesIn.count, mg: transit.linesIn.fineMg, tone: "#059669", dir: "↙" },
          ].map((t) => (
            <li key={t.k} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex size-7 items-center justify-center rounded-lg text-[13px] font-bold" style={{ color: t.tone, background: `${t.tone}14` }}>
                {t.dir}
              </span>
              <span className="flex-1 text-[12px] text-ink-3">{t.k}</span>
              <span className="text-right leading-tight">
                <span className="g-metric block text-[13px] font-semibold text-ink">{count(t.n)}</span>
                <span className="g-metric block text-[10px] text-ink-5">{grams(t.mg)} g fine</span>
              </span>
            </li>
          ))}
          <li className="flex items-center gap-3 px-4 py-2.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-gold/15 text-gold-deep">
              <CoinsIcon size={13} />
            </span>
            <span className="flex-1 text-[12px] text-ink-3">Cash sent</span>
            <span className="g-metric text-[13px] font-semibold text-ink">{lkr(transit.cashInTransit)}</span>
          </li>
        </ul>
      </Card>

      <Card className="lg:col-span-2 xl:col-span-3">
        <CardHead icon={UsersIcon} title="Staff" sub={isRedacted(v.staff) ? "Hidden" : `${v.staff.length} active members`} />
        {isRedacted(v.staff) ? (
          <p className="px-4 py-3 text-[12px] text-ink-4">Staff names are visible to branch members and users with users:view.</p>
        ) : v.staff.length === 0 ? (
          <Empty icon={UsersIcon} title="No active staff" desc="Assign accounts to this branch from Users." />
        ) : (
          <ul className="grid gap-px bg-ink/[0.05] sm:grid-cols-2 xl:grid-cols-4">
            {v.staff.map((s) => (
              <li key={s.name} className="flex items-center gap-2.5 bg-paper px-4 py-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-void font-display text-[11px] font-bold text-gold-light">
                  {s.name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((w) => w[0]?.toUpperCase())
                    .join("")}
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-[12.5px] font-semibold text-ink">{s.name}</span>
                  <span className="block truncate text-[10.5px] text-ink-5">{s.roles.length ? s.roles.join(" · ") : "No role"}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
