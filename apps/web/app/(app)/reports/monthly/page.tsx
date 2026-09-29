"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { hasPermission } from "@goldos/shared";
import { api, downloadCsv, type MeData } from "@/lib/api";
import { Page, Hero, Panel, Pill, EmptyBlock, Callout, Toolbar, StatGrid, StatCard, BarList, Skeleton, controlClass, heroBtnGhost } from "@/components/ui";
import {
  AlertCircleIcon,
  BanknoteIcon,
  Building2Icon,
  CreditCardIcon,
  FileDownIcon,
  PrinterIcon,
  GemIcon,
  PackageIcon,
  StoreIcon,
  TrendingUpIcon,
  TruckIcon,
  UsersIcon,
} from "@/components/icons";
import { type MonthlyReport } from "@/lib/monthly";
import "./print.css";

type Report = MonthlyReport;

const SECTIONS = ["sales", "purchases", "gold", "expenses", "profit", "cashflow", "receivables", "payables", "inventory"] as const;

function sectionRowsForXlsx(report: Report, section: string): Record<string, unknown>[] {
  const v = (report as unknown as Record<string, unknown>)[section];
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  if (v && typeof v === "object") return [v as Record<string, unknown>];
  return [];
}

function Statement({
  rows,
  unit,
  scale = 100,
  note,
}: {
  rows: [string, number, ("indent" | "sub" | "total")?][];
  unit?: string;
  scale?: number;
  note?: string;
}) {
  const f = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(n / scale).toLocaleString("en-US", { maximumFractionDigits: scale === 100 ? 0 : 3 })}${unit ? ` ${unit}` : ""}`;
  return (
    <div>
      {rows.map(([label, v, kind]) => (
        <div
          key={label}
          className={
            "flex items-baseline justify-between gap-3 py-2 " +
            (kind === "total" ? "border-t border-ink/[0.12] pt-3 text-[15px] font-semibold text-ink" : kind === "sub" ? "border-t border-ink/[0.06] font-medium text-ink-2" : "text-sm text-ink-3") +
            (kind === "indent" ? " pl-4" : "")
          }
        >
          <span>{label}</span>
          <span className={"g-metric " + (v < 0 ? "text-rose-700" : "")}>{f(v)}</span>
        </div>
      ))}
      {note ? <p className="mt-2 text-xs text-ink-4">{note}</p> : null}
    </div>
  );
}

function Aging({ aging }: { aging: Record<string, number> }) {
  const items = Object.entries(aging);
  if (items.every(([, v]) => v === 0)) return <div className="text-sm text-ink-4">Nothing outstanding</div>;
  return <BarList tone="light" format={(n) => lkr(n)} items={items.map(([k, v]) => ({ key: k, label: k, value: v }))} />;
}

const lkr = (c: number) => (c / 100).toLocaleString("en-US");
const g = (mg: number) => (mg / 1000).toLocaleString("en-US");

function MonthlyView() {
  const now = new Date();
  const params = useSearchParams();
  const initial = /^\d{4}-\d{2}$/.test(params.get("month") ?? "") ? (params.get("month") as string) : "";
  const [month, setMonth] = useState(initial ? Number(initial.slice(5)) : now.getMonth() + 1);
  const [year, setYear] = useState(initial ? Number(initial.slice(0, 4)) : now.getFullYear());
  const [branchId, setBranchId] = useState(params.get("branch") ?? "");
  const [note, setNote] = useState("");
  const [frozen, setFrozen] = useState<string | null>(null);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/branches?limit=100"),
  });
  const perms = me.data?.permissions ?? [];
  const canExport = hasPermission(perms, "audit:export");
  const canFreeze = hasPermission(perms, "accounts:manage");
  const canShop = hasPermission(perms, "branches:manage");
  const visibleBranches = (branches.data?.rows ?? []).filter(
    (b) => canShop || (me.data?.branchIds ?? []).includes(b.id)
  );
  const query = `/api/v1/reports/monthly?month=${month}&year=${year}${branchId ? `&branchId=${branchId}` : ""}`;
  const report = useQuery({ queryKey: ["monthly", month, year, branchId], queryFn: () => api<Report>(query) });
  const r = report.data;

  const csv = (section: string) =>
    canExport ? (
      <button className="no-print g-btn g-btn-secondary h-8 px-3 text-xs" onClick={() => downloadCsv(`${query}&format=csv&section=${section}`, `monthly-${section}.csv`)}>
        CSV
      </button>
    ) : null;

  function exportXlsx() {
    if (!r) return;
    const wb = XLSX.utils.book_new();
    for (const s of [...SECTIONS, "estimates"] as string[]) {
      const rows = sectionRowsForXlsx(r, s);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ note: "no data" }]), s.slice(0, 31));
    }
    XLSX.writeFile(wb, `monthly-${r.meta.month}${r.meta.branchId ? `-${r.meta.branchId}` : "-shop"}.xlsx`);
  }

  async function freeze() {
    const res = await api<{ id: string }>(`/api/v1/reports/monthly/snapshot`, {
      method: "POST",
      body: JSON.stringify({ month, year, branchId: branchId || undefined, note: note || undefined }),
    });
    setFrozen(res.id);
  }

  return (
    <Page>
      <div className="print-header">
        <div>Monthly report {r?.meta.month ?? `${year}-${String(month).padStart(2, "0")}`} · generated {new Date().toISOString()} · live-read, not a frozen snapshot</div>
      </div>
      <Hero
        kicker="Accounts · Ledger"
        back={{ href: "/accounts", label: "Accounts dashboard" }}
        title="Monthly report"
        description="Ledger-posted figures with estimates kept separate."
        stats={[
          { label: "Net sales", value: r ? `${lkr(r.sales.netCents)} LKR` : "—" },
          { label: "Net profit", value: r ? `${lkr(r.profit.netProfitCents)} LKR` : "—" },
          { label: "Closing cash", value: r ? `${lkr(r.cashflow.closingCents)} LKR` : "—" },
          { label: "Gold closing", value: r ? `${g(r.gold.closingFineMg)} g` : "—" },
        ]}
        actions={
          <>
            <button onClick={() => window.print()} className={heroBtnGhost}>
              <PrinterIcon size={14} /> Print
            </button>
            {canExport && r ? (
              <button onClick={exportXlsx} className={heroBtnGhost}>
                <FileDownIcon size={14} /> Export .xlsx
              </button>
            ) : null}
          </>
        }
        note="Live-read from the ledger — freeze a snapshot to lock a period for audit"
      />
      <Toolbar className="no-print" actions={canFreeze && r ? (
        <>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Snapshot note (required if warnings)" className={controlClass} />
          <button onClick={freeze} className="g-btn g-btn-secondary h-10 px-4 text-sm">Freeze snapshot</button>
        </>
      ) : undefined}>
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
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={controlClass} aria-label="Branch">
          <option value="">{canShop ? "All branches" : "Select branch"}</option>
          {visibleBranches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </Toolbar>
      {frozen ? <Callout tone="success" title="Snapshot frozen">Snapshot id {frozen} — this period is locked for audit.</Callout> : null}
      {r?.warnings?.length ? (
        <Panel title="Warnings" icon={<AlertCircleIcon size={17} />} description="Snapshot requires a note while these stand">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </Panel>
      ) : null}
      {!r ? (
        report.isError ? (
          <EmptyBlock title="Report unavailable" description={report.error instanceof Error ? report.error.message : "Could not load this report."} />
        ) : (
          <EmptyBlock title="Loading" description="Fetching the monthly report." />
        )
      ) : (
        <>
          <StatGrid cols={4}>
            <StatCard label="Net sales" icon={<StoreIcon size={16} />} value={lkr(r.sales.netCents)} sub={`${r.sales.invoiceCount} invoices`} />
            <StatCard label="Expenses" icon={<CreditCardIcon size={16} />} value={lkr(r.expenses.totalCents)} sub={r.expenses.pendingCents ? `+ ${lkr(r.expenses.pendingCents)} pending approval` : `${r.expenses.byCategory.length} categories`} />
            <StatCard label="Net profit" icon={<TrendingUpIcon size={16} />} value={lkr(r.profit.netProfitCents)} tone={r.profit.netProfitCents < 0 ? "danger" : "success"} sub={`Revenue ${lkr(r.profit.revenueCents)}`} />
            <StatCard label="Closing cash" icon={<BanknoteIcon size={16} />} value={lkr(r.cashflow.closingCents)} sub={`Opening ${lkr(r.cashflow.openingCents)}`} />
          </StatGrid>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Profit & loss" icon={<TrendingUpIcon size={17} />} description={r.profit.basis} actions={csv("profit")}>
              <Statement rows={[
                ["Revenue", r.profit.revenueCents],
                ["Cost of goods sold", -r.profit.cogsCents, "indent"],
                ["Gross profit", r.profit.grossProfitCents, "sub"],
                ["Operating expenses", -r.profit.operatingExpensesCents, "indent"],
                ["Net profit", r.profit.netProfitCents, "total"],
              ]} />
            </Panel>
            <Panel title="Cash flow" icon={<BanknoteIcon size={17} />} description="Drawer + bank movement" actions={csv("cashflow")}>
              <Statement rows={[
                ["Opening cash", r.cashflow.openingCents],
                ["Cash in", r.cashflow.inflowsCents, "indent"],
                ["Cash out", -r.cashflow.outflowsCents, "indent"],
                ["Closing cash", r.cashflow.closingCents, "total"],
              ]} />
              {r.cashflow.unclassifiedCents ? <p className="mt-3 text-xs text-amber-700">{lkr(r.cashflow.unclassifiedCents)} LKR of movement is unclassified.</p> : null}
            </Panel>
            <Panel title="Sales" icon={<StoreIcon size={17} />} description={`${r.sales.invoiceCount} invoices`} actions={csv("sales")}>
              {r.sales.hasData ? (
                <Statement rows={[["Gross sales", r.sales.grossCents], ["Returns", -r.sales.returnsCents, "indent"], ["Net sales", r.sales.netCents, "total"]]} />
              ) : <div className="text-sm text-ink-4">No postings this month</div>}
            </Panel>
            <Panel title="Purchases" icon={<TruckIcon size={17} />} description="Supplier + old-gold intake" actions={csv("purchases")}>
              {r.purchases.hasData ? (
                <Statement rows={[["Supplier purchases", r.purchases.purchaseValueCents], ["Old gold bought", r.purchases.oldGoldCents]]} note={`${g(r.purchases.goldFineMg)} g fine gold received`} />
              ) : <div className="text-sm text-ink-4">No postings this month</div>}
            </Panel>
          </div>
          <Panel title="Expenses by category" icon={<CreditCardIcon size={17} />} description={`Total ${lkr(r.expenses.totalCents)} LKR${r.expenses.pendingCents ? ` · ${lkr(r.expenses.pendingCents)} pending approval` : ""}`} actions={csv("expenses")}>
            {r.expenses.byCategory.length === 0 ? <div className="text-sm text-ink-4">No expenses this month</div> : (
              <BarList tone="light" format={(n) => lkr(n)} items={[...r.expenses.byCategory].sort((a, b) => b.cents - a.cents).map((c) => ({ key: c.accountCode, label: c.name, value: c.cents, secondary: c.accountCode }))} />
            )}
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Receivables" icon={<UsersIcon size={17} />} description={`${lkr(r.receivables.totalCents)} LKR · ${r.receivables.outstanding.length} open invoices`} actions={csv("receivables")}>
              <Aging aging={r.receivables.aging} />
            </Panel>
            <Panel title="Payables" icon={<Building2Icon size={17} />} description={`${lkr(r.payables.totalCents)} LKR · ${r.payables.outstanding.length} open bills`} actions={csv("payables")}>
              <Aging aging={r.payables.aging} />
            </Panel>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Gold" icon={<GemIcon size={17} />} description="Fine gold flows" actions={csv("gold")}>
              <Statement rows={[["Opening", r.gold.openingFineMg], ["In", r.gold.inFineMg, "indent"], ["Out", -r.gold.outFineMg, "indent"], ["Closing", r.gold.closingFineMg, "total"]]} unit="g" scale={1000} />
            </Panel>
            <Panel title="Inventory" icon={<PackageIcon size={17} />} description={`${r.inventory.basis} · ${r.inventory.method}`} actions={csv("inventory")}>
              <Statement rows={[["Jewellery", r.inventory.jewelleryCents], ["Gold", r.inventory.goldCents]]} note={r.inventory.uncostedPieces ? `${r.inventory.uncostedPieces} pieces have no cost recorded` : undefined} />
            </Panel>
          </div>
          <Panel title="Estimates" icon={<AlertCircleIcon size={17} />} description="Not in profit">
            {r.estimates.map((e) => (
              <div key={e.label} className="flex items-center gap-2 text-sm"><Pill tone="warning">Estimate</Pill><span>{e.label} — {e.note}</span></div>
            ))}
          </Panel>
        </>
      )}
    </Page>
  );
}

export default function MonthlyPage() {
  return (
    <Suspense fallback={null}>
      <MonthlyView />
    </Suspense>
  );
}
