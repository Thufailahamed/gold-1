"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { hasPermission } from "@goldos/shared";
import { api, downloadCsv, type MeData } from "@/lib/api";
import { Page, Hero, Panel, Pill, EmptyBlock, Callout, Toolbar, controlClass, heroBtnGhost } from "@/components/ui";
import {
  AlertCircleIcon,
  BanknoteIcon,
  Building2Icon,
  CreditCardIcon,
  FileDownIcon,
  GemIcon,
  PackageIcon,
  StoreIcon,
  TrendingUpIcon,
  TruckIcon,
  UsersIcon,
} from "@/components/icons";
import "./print.css";

type Report = {
  meta: { month: string; from: string; to: string; branchId: string | null };
  sales: { netCents: number; invoiceCount: number; grossCents: number; returnsCents: number; hasData: boolean };
  purchases: { purchaseValueCents: number; oldGoldCents: number; goldFineMg: number; hasData: boolean };
  gold: { openingFineMg: number; inFineMg: number; outFineMg: number; closingFineMg: number; hasData: boolean };
  expenses: { totalCents: number; pendingCents: number; byCategory: { accountCode: string; name: string; cents: number }[]; hasData: boolean };
  profit: { revenueCents: number; cogsCents: number; grossProfitCents: number; operatingExpensesCents: number; netProfitCents: number; basis: string };
  cashflow: { openingCents: number; inflowsCents: number; outflowsCents: number; closingCents: number; unclassifiedCents: number; hasData: boolean };
  receivables: { totalCents: number; aging: Record<string, number>; outstanding: { id: string; number: string; outstandingCents: number }[]; hasData: boolean };
  payables: { totalCents: number; aging: Record<string, number>; outstanding: { id: string; number: string; outstandingCents: number }[]; hasData: boolean };
  inventory: { jewelleryCents: number; goldCents: number; byBranch: { key: string; cents: number }[]; byCategory: { key: string; cents: number }[]; byPurity: { key: string; cents: number }[]; uncostedPieces: number; method: string; basis: string; hasData: boolean };
  estimates: { kind: string; label: string; note: string }[];
  warnings: string[];
};

const SECTIONS = ["sales", "purchases", "gold", "expenses", "profit", "cashflow", "receivables", "payables", "inventory"] as const;

function sectionRowsForXlsx(report: Report, section: string): Record<string, unknown>[] {
  const v = (report as unknown as Record<string, unknown>)[section];
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  if (v && typeof v === "object") return [v as Record<string, unknown>];
  return [];
}

const lkr = (c: number) => (c / 100).toLocaleString("en-US");
const g = (mg: number) => (mg / 1000).toLocaleString("en-US");

export default function MonthlyPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [branchId, setBranchId] = useState("");
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
        kicker="Reports · Ledger"
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
        <EmptyBlock title="Loading" description="Fetching the monthly report." />
      ) : (
        <>
          <Panel title="Sales" icon={<StoreIcon size={17} />} description={`Invoices: ${r.sales.invoiceCount}`}>
            {r.sales.hasData ? (
              <div className="text-sm">Gross {lkr(r.sales.grossCents)} · Returns {lkr(r.sales.returnsCents)} · Net {lkr(r.sales.netCents)} LKR</div>
            ) : <div className="text-sm text-ink-4">No postings this month</div>}
            {canExport ? <button className="no-print g-btn g-btn-secondary mt-3 h-8 px-3 text-xs" onClick={() => downloadCsv(`${query}&format=csv&section=sales`, `monthly-sales.csv`)}>CSV</button> : null}
          </Panel>
          <Panel title="Purchases" icon={<TruckIcon size={17} />} description="Supplier + old-gold intake">
            {r.purchases.hasData ? (
              <div className="text-sm">Value {lkr(r.purchases.purchaseValueCents)} · Old gold {lkr(r.purchases.oldGoldCents)} LKR · {g(r.purchases.goldFineMg)} g</div>
            ) : <div className="text-sm text-ink-4">No postings this month</div>}
            {canExport ? <button className="no-print g-btn g-btn-secondary mt-3 h-8 px-3 text-xs" onClick={() => downloadCsv(`${query}&format=csv&section=purchases`, `monthly-purchases.csv`)}>CSV</button> : null}
          </Panel>
          <Panel title="Profit" icon={<TrendingUpIcon size={17} />} description={r.profit.basis}>
            <div className="text-sm">Revenue {lkr(r.profit.revenueCents)} · COGS {lkr(r.profit.cogsCents)} · Gross {lkr(r.profit.grossProfitCents)} · Opex {lkr(r.profit.operatingExpensesCents)} · Net {lkr(r.profit.netProfitCents)} LKR</div>
            <Pill tone="ghost">Ledger</Pill>
            {canExport ? <button className="no-print g-btn g-btn-secondary mt-3 h-8 px-3 text-xs" onClick={() => downloadCsv(`${query}&format=csv&section=profit`, `monthly-profit.csv`)}>CSV</button> : null}
          </Panel>
          <Panel title="Cashflow" icon={<BanknoteIcon size={17} />} description="Drawer + bank movement">
            <div className="text-sm">Opening {lkr(r.cashflow.openingCents)} · In {lkr(r.cashflow.inflowsCents)} · Out {lkr(r.cashflow.outflowsCents)} · Closing {lkr(r.cashflow.closingCents)} LKR</div>
            {canExport ? <button className="no-print g-btn g-btn-secondary mt-3 h-8 px-3 text-xs" onClick={() => downloadCsv(`${query}&format=csv&section=cashflow`, `monthly-cashflow.csv`)}>CSV</button> : null}
          </Panel>
          <Panel title="Gold" icon={<GemIcon size={17} />} description="Fine gold flows">
            <div className="text-sm">Opening {g(r.gold.openingFineMg)} · In {g(r.gold.inFineMg)} · Out {g(r.gold.outFineMg)} · Closing {g(r.gold.closingFineMg)} g</div>
            {canExport ? <button className="no-print g-btn g-btn-secondary mt-3 h-8 px-3 text-xs" onClick={() => downloadCsv(`${query}&format=csv&section=gold`, `monthly-gold.csv`)}>CSV</button> : null}
          </Panel>
          <Panel title="Expenses" icon={<CreditCardIcon size={17} />} description={`Pending: ${lkr(r.expenses.pendingCents)} LKR`}>
            <div className="text-sm">Total {lkr(r.expenses.totalCents)} LKR · {r.expenses.byCategory.length} categories</div>
            {canExport ? <button className="no-print g-btn g-btn-secondary mt-3 h-8 px-3 text-xs" onClick={() => downloadCsv(`${query}&format=csv&section=expenses`, `monthly-expenses.csv`)}>CSV</button> : null}
          </Panel>
          <Panel title="Receivables" icon={<UsersIcon size={17} />} description={`Total ${lkr(r.receivables.totalCents)} LKR`}>
            <div className="text-sm">Outstanding {r.receivables.outstanding.length} invoices · Buckets {Object.entries(r.receivables.aging).map(([k, v]) => `${k}: ${lkr(v)}`).join(" · ")}</div>
            {canExport ? <button className="no-print g-btn g-btn-secondary mt-3 h-8 px-3 text-xs" onClick={() => downloadCsv(`${query}&format=csv&section=receivables`, `monthly-receivables.csv`)}>CSV</button> : null}
          </Panel>
          <Panel title="Payables" icon={<Building2Icon size={17} />} description={`Total ${lkr(r.payables.totalCents)} LKR`}>
            <div className="text-sm">Outstanding {r.payables.outstanding.length} invoices · Buckets {Object.entries(r.payables.aging).map(([k, v]) => `${k}: ${lkr(v)}`).join(" · ")}</div>
            {canExport ? <button className="no-print g-btn g-btn-secondary mt-3 h-8 px-3 text-xs" onClick={() => downloadCsv(`${query}&format=csv&section=payables`, `monthly-payables.csv`)}>CSV</button> : null}
          </Panel>
          <Panel title="Inventory" icon={<PackageIcon size={17} />} description={`${r.inventory.basis} · ${r.inventory.method}`}>
            <div className="text-sm">Jewellery {lkr(r.inventory.jewelleryCents)} · Gold {lkr(r.inventory.goldCents)} LKR · Uncosted {r.inventory.uncostedPieces} pcs</div>
            {canExport ? <button className="no-print g-btn g-btn-secondary mt-3 h-8 px-3 text-xs" onClick={() => downloadCsv(`${query}&format=csv&section=inventory`, `monthly-inventory.csv`)}>CSV</button> : null}
          </Panel>
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
