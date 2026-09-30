"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, downloadCsv } from "@/lib/api";
import { lkr, lkrSigned, useAccountsScope } from "@/lib/accounts";
import { count, grams } from "@/components/module-dashboard";
import {
  Page,
  Hero,
  heroBtnGhost,
  Panel,
  Pill,
  EmptyBlock,
  Callout,
  Toolbar,
  StatGrid,
  StatCard,
  SectionLabel,
  DetailList,
  TableCard,
  TableSkeleton,
  Skeleton,
  controlClass,
} from "@/components/ui";
import {
  ArrowLeftRightIcon,
  BanknoteIcon,
  Building2Icon,
  CoinsIcon,
  FileDownIcon,
  GemIcon,
  PackageIcon,
  ScaleIcon,
  StoreIcon,
  TruckIcon,
  UsersIcon,
} from "@/components/icons";

/** Mirrors `BranchView` in apps/api/src/services/overview.ts. */
type BranchView = {
  branch: { id: string; name: string };
  asOf: number;
  month: string;
  jewellery: { pieces: number; netMg: number; fineMg: number; costCents: number; hasData: boolean };
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
const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function BranchOverviewPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const { me, perms, canShop, visibleBranches, branchId, setBranchId } = useAccountsScope();
  const canExport = hasPermission(perms, "audit:export");

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

  return (
    <Page>
      <Hero
        kicker="Organisation"
        back={{ href: "/branches", label: "Branches" }}
        title={v ? v.branch.name : "Branch overview"}
        description="Stock, gold and cash for one branch, with month-to-date sales and purchases."
        stats={[
          { label: "Pieces in stock", value: v ? count(v.jewellery.pieces) : "—" },
          { label: "Fine gold held", value: v ? `${grams(v.gold.fineMg)} g` : "—" },
          { label: "Drawer cash", value: v ? `${lkrSigned(v.cash.drawer)} LKR` : "—" },
          { label: "Net sales (MTD)", value: v ? `${lkrSigned(v.sales.netCents)} LKR` : "—" },
        ]}
        actions={
          canExport && v ? (
            <button onClick={exportCsv} className={heroBtnGhost}>
              <FileDownIcon size={14} /> Download CSV
            </button>
          ) : undefined
        }
        note={v ? `Stock, gold & cash live as of ${asOfLabel(v.asOf)} · sales & purchases for ${v.month}` : "Live-read — stock and cash are a snapshot, sales are month-to-date"}
      />

      <Toolbar>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={controlClass} aria-label="Month">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {new Date(2000, m - 1, 1).toLocaleString("en-US", { month: "long" })}
            </option>
          ))}
        </select>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={controlClass} aria-label="Year">
          {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={controlClass} aria-label="Branch" disabled={visibleBranches.length === 0}>
          {visibleBranches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </Toolbar>

      {me.isError ? (
        <EmptyBlock title="Overview unavailable" description={errMsg(me.error, "Could not load your session.")} />
      ) : noBranches ? (
        <EmptyBlock icon={<Building2Icon size={22} />} title="No branches" description="You are not a member of any active branch." />
      ) : overview.isError ? (
        <EmptyBlock title="Overview unavailable" description={errMsg(overview.error, "Could not load this branch.")} />
      ) : !v ? (
        <OverviewSkeleton />
      ) : (
        <BranchSections v={v} />
      )}

      {canShop ? (
        <TableCard
          title="All branches"
          icon={<Building2Icon size={17} />}
          description={all.data ? `Side by side · live as of ${asOfLabel(all.data.asOf)} · each branch computed on its own, never summed` : "Side by side, each branch computed on its own"}
        >
          {all.isLoading ? (
            <TableSkeleton rows={3} cols={8} />
          ) : all.isError ? (
            <EmptyBlock title="Comparison unavailable" description={errMsg(all.error, "Could not load all branches.")} />
          ) : !all.data || all.data.branches.length === 0 ? (
            <EmptyBlock title="No active branches" />
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>Branch</th>
                  <th className="!text-right">Pieces</th>
                  <th className="!text-right">Book cost</th>
                  <th className="!text-right">Gold held (g)</th>
                  <th className="!text-right">Drawer</th>
                  <th className="!text-right">Card clearing</th>
                  <th className="!text-right">Net sales</th>
                  <th className="!text-right">Invoices</th>
                  <th className="!text-right">Purchases</th>
                  <th className="!text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {all.data.branches.map((b) => (
                  <tr key={b.branch.id}>
                    <td className="font-medium text-ink">
                      {b.branch.name}
                      {b.branch.id === branchId ? <Pill tone="brand" className="ml-2">Viewing</Pill> : null}
                    </td>
                    <td className="text-right g-metric">{count(b.jewellery.pieces)}</td>
                    <td className="text-right g-metric">{lkr(b.jewellery.costCents)}</td>
                    <td className="text-right g-metric">{grams(b.gold.fineMg)}</td>
                    <td className="text-right g-metric">{lkrSigned(b.cash.drawer)}</td>
                    <td className="text-right g-metric">{lkrSigned(b.cash.cardClearing)}</td>
                    <td className="text-right g-metric">{lkrSigned(b.sales.netCents)}</td>
                    <td className="text-right g-metric">{count(b.sales.invoiceCount)}</td>
                    <td className="text-right g-metric">{lkr(b.purchases.valueCents)}</td>
                    <td className="text-right">
                      <button
                        onClick={() => setBranchId(b.branch.id)}
                        className="text-xs font-medium text-ink-3 transition-colors hover:text-ink hover:underline"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : null}
    </Page>
  );
}

function OverviewSkeleton() {
  return (
    <>
      <StatGrid cols={4}>
        {Array.from({ length: 4 }, (_, i) => (
          <StatCard key={i} label="Loading" value="" loading />
        ))}
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </>
  );
}

function BranchSections({ v }: { v: BranchView }) {
  const { jewellery: j, gold, cash, transit } = v;
  return (
    <>
      <SectionLabel>Live snapshot · {asOfLabel(v.asOf)}</SectionLabel>
      <StatGrid cols={4}>
        <StatCard label="Pieces in stock" icon={<PackageIcon size={16} />} value={count(j.pieces)} sub={j.hasData ? "In stock + reserved" : "No stock on hand"} />
        <StatCard label="Net weight" icon={<ScaleIcon size={16} />} value={grams(j.netMg)} sub="grams" />
        <StatCard label="Fine gold in stock" icon={<GemIcon size={16} />} value={grams(j.fineMg)} sub="grams" />
        <StatCard label="Book cost" icon={<CoinsIcon size={16} />} value={lkr(j.costCents)} sub="LKR · at cost, not board rate" />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Gold held" icon={<GemIcon size={17} />} description={`${grams(gold.fineMg)} g fine across all stages`}>
          {gold.hasData ? (
            <DetailList
              columns={2}
              items={[
                { label: "Products", value: `${grams(gold.products)} g` },
                { label: "Old gold", value: `${grams(gold.oldGold)} g` },
                { label: "Melted lots", value: `${grams(gold.lots)} g` },
                { label: "Work in progress", value: `${grams(gold.wip)} g` },
                { label: "Recovered", value: `${grams(gold.recovered)} g` },
                { label: "Total fine", value: <span className="font-semibold">{grams(gold.fineMg)} g</span> },
              ]}
            />
          ) : (
            <div className="text-sm text-ink-4">No gold held at this branch</div>
          )}
        </Panel>
        <Panel title="Cash" icon={<BanknoteIcon size={17} />} description="Journal balances — not month-end cash">
          {cash.hasData ? (
            <DetailList
              columns={2}
              items={[
                { label: "Cash drawer (1000)", value: `${lkrSigned(cash.drawer)} LKR` },
                { label: "Card clearing (1020)", value: `${lkrSigned(cash.cardClearing)} LKR` },
              ]}
            />
          ) : (
            <div className="text-sm text-ink-4">No cash postings at this branch</div>
          )}
        </Panel>
        <Panel title="Bank accounts" icon={<Building2Icon size={17} />} description="Shared head-office accounts are shown but never counted as branch cash">
          {v.banks.length === 0 ? (
            <div className="text-sm text-ink-4">No bank accounts</div>
          ) : (
            <div className="divide-y divide-ink/[0.06]">
              {v.banks.map((b, i) => (
                <div key={`${b.name}-${i}`}className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="flex items-center gap-2 text-ink-2">
                    {b.name}
                    {b.shared ? <Pill tone="neutral">Shared</Pill> : null}
                  </span>
                  <span className="g-metric">{lkrSigned(b.balanceCents)} LKR</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="In transit" icon={<ArrowLeftRightIcon size={17} />} description="Counted on neither branch's shelf or drawer">
          <DetailList
            columns={3}
            items={[
              { label: "Pieces going out", value: `${count(transit.linesOut.count)} · ${grams(transit.linesOut.fineMg)} g` },
              { label: "Pieces coming in", value: `${count(transit.linesIn.count)} · ${grams(transit.linesIn.fineMg)} g` },
              { label: "Cash sent", value: `${lkr(transit.cashInTransit)} LKR` },
            ]}
          />
        </Panel>
      </div>

      <Panel title="Staff" icon={<UsersIcon size={17} />} description={isRedacted(v.staff) ? undefined : `${v.staff.length} active members`}>
        {isRedacted(v.staff) ? (
          <Callout tone="info" title="Staff hidden">Staff names are visible to branch members and users with users:view.</Callout>
        ) : v.staff.length === 0 ? (
          <div className="text-sm text-ink-4">No active staff assigned</div>
        ) : (
          <div className="divide-y divide-ink/[0.06]">
            {v.staff.map((s) => (
              <div key={s.name} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="font-medium text-ink">{s.name}</span>
                <span className="flex flex-wrap gap-1.5">
                  {s.roles.length ? s.roles.map((r) => <Pill key={r}>{r}</Pill>) : <span className="text-xs text-ink-4">No role</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <SectionLabel>Month to date · {v.month}</SectionLabel>
      <StatGrid cols={2}>
        <StatCard label="Net sales" icon={<StoreIcon size={16} />} value={lkrSigned(v.sales.netCents)} sub={`LKR · ${count(v.sales.invoiceCount)} invoices`} />
        <StatCard label="Purchases" icon={<TruckIcon size={16} />} value={lkr(v.purchases.valueCents)} sub="LKR · supplier purchases" />
      </StatGrid>
    </>
  );
}
