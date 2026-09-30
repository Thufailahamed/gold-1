"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Callout, Page, Skeleton } from "@/components/ui";
import { ArrowLeftIcon, FileDownIcon, PrinterIcon } from "@/components/icons";
import { api, downloadCsv } from "@/lib/api";
import { fmt } from "../panels";

type Line = { label: string; refEntity: string; cents: number };
type Report = {
  date: string;
  openingCents: number;
  cashIn: { totalCents: number; lines: Line[] };
  cashOut: { totalCents: number; lines: Line[] };
  money: Record<string, number>;
  gold: Record<string, { label: string; mg: number }>;
  goldBalance?: { openingMg: number; inMg: number; outMg: number; closingMg: number };
  card?: { netCents: number };
  checks: { passed: boolean; failing: string[]; total: number };
  closing: { expectedCents: number; awaitingApprovalCents: number };
};
type ClosingRow = {
  id: string;
  status: string;
  actual_cents: number;
  difference_cents: number;
  difference_reason: string | null;
  closed_by: string | null;
  closed_at: number;
  denominations_json: string | null;
  card_expected_cents: number | null;
  card_actual_cents: number | null;
  correction_cents: number;
};

const MONEY_LABELS: [string, string][] = [
  ["salesCents", "Sales"],
  ["purchasesCents", "Purchases"],
  ["oldGoldCents", "Old gold bought"],
  ["expensesCents", "Expenses"],
  ["customerPaymentsCents", "Customer payments"],
  ["supplierPaymentsCents", "Supplier payments"],
  ["bankTransactionsCents", "Bank & card movement"],
];

function Row({ label, cents, strong }: { label: string; cents: number | null; strong?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${strong ? "border-t border-ink/15 pt-1.5 font-semibold text-ink" : "text-ink-2"}`}>
      <span>{label}</span>
      <span className="num-tabular">{cents === null ? "—" : fmt(cents)}</span>
    </div>
  );
}

function ReportView() {
  const router = useRouter();
  const params = useSearchParams();
  const branchId = params.get("branchId") ?? "";
  const date = params.get("date") ?? "";

  const closing = useQuery({
    enabled: !!branchId && !!date,
    queryKey: ["day-report-closing", branchId, date],
    queryFn: async () => {
      const list = await api<{ rows: { id: string }[] }>(`/api/v1/day-closings?branchId=${encodeURIComponent(branchId)}&from=${date}&to=${date}&limit=1`);
      const id = list.rows[0]?.id;
      return id ? api<{ closing: ClosingRow; report: Report; reopens: unknown[] }>(`/api/v1/day-closings/${id}`) : null;
    },
  });
  const closed = closing.data?.closing.status === "CLOSED";
  const preview = useQuery({
    enabled: closing.isSuccess && !closed,
    queryKey: ["day-closing-preview", branchId, date],
    queryFn: () => api<Report>(`/api/v1/day-closings/preview?branchId=${encodeURIComponent(branchId)}&date=${date}`),
  });
  const branches = useQuery({ queryKey: ["branches"], queryFn: () => api<{ rows: { id: string; name: string; code?: string }[] }>("/api/v1/branches?limit=100") });
  const shop = useQuery({ queryKey: ["shop-name"], queryFn: () => api<{ value: unknown }>("/api/v1/settings/shop_name"), retry: false });
  const branch = branches.data?.rows.find((b) => b.id === branchId);

  const report = closed ? closing.data!.report : preview.data;
  const c = closed ? closing.data!.closing : null;
  const counts = c?.denominations_json ? (JSON.parse(c.denominations_json) as Record<string, number>) : null;

  if (!branchId || !date) return <Callout tone="danger" title="Choose a branch and date on the day-closing screen" />;
  if (closing.isLoading || (!closed && preview.isLoading)) return <Skeleton className="mx-auto h-[40rem] max-w-2xl" />;
  if (!report) return <Callout tone="danger" title="Report could not be loaded" />;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button onClick={() => router.back()} className="g-btn g-btn-secondary h-10 px-4 text-sm">
          <ArrowLeftIcon size={15} /> Back
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => downloadCsv(`/api/v1/day-closings/report.csv?branchId=${encodeURIComponent(branchId)}&date=${date}`, `day-close-${date}.csv`)}
            className="g-btn g-btn-secondary h-10 px-4 text-sm"
          >
            <FileDownIcon size={15} /> CSV
          </button>
          <button onClick={() => window.print()} className="g-btn g-btn-primary h-10 px-4 text-sm">
            <PrinterIcon size={15} /> Print
          </button>
        </div>
      </div>
      <div className="print-area mx-auto w-full max-w-2xl rounded-2xl border border-ink/10 bg-paper p-8 text-sm shadow-elevated">
        <div className="text-center">
          <p className="g-kicker justify-center">Daily closing report</p>
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink">{String(shop.data?.value ?? "GoldOS")}</h1>
          <p className="mt-1 text-ink-3">
            {branch ? `${branch.name}${branch.code ? ` (${branch.code})` : ""}` : branchId} · {date}
          </p>
          <p className={`mt-1 text-xs font-medium ${closed ? "text-emerald-700" : "text-amber-700"}`}>
            {closed ? `Closed ${new Date(c!.closed_at).toLocaleString()}` : "NOT CLOSED — live preview, figures may still change"}
          </p>
        </div>

        <h2 className="mt-6 border-b border-ink/15 pb-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink-4">Cash</h2>
        <Row label="Opening cash (from the ledger)" cents={report.openingCents} />
        {report.cashIn.lines.map((l, i) => (
          <Row key={`in-${i}`} label={`+ ${l.label}`} cents={l.cents} />
        ))}
        {report.cashOut.lines.map((l, i) => (
          <Row key={`out-${i}`} label={`− ${l.label}`} cents={l.cents} />
        ))}
        <Row label="Expected closing cash" cents={report.closing.expectedCents} strong />
        <Row label="Counted cash" cents={c ? c.actual_cents : null} />
        <Row label="Difference" cents={c ? c.difference_cents : null} strong />
        {c?.difference_reason ? <p className="mt-1 text-xs text-ink-3">Explanation: {c.difference_reason}</p> : null}
        {c?.correction_cents ? <p className="text-xs text-ink-3">Posted to Cash Short &amp; Over: {fmt(c.correction_cents)}</p> : null}
        {report.closing.awaitingApprovalCents ? <p className="text-xs text-ink-3">Expenses awaiting approval: {fmt(report.closing.awaitingApprovalCents)}</p> : null}

        {counts && Object.keys(counts).length ? (
          <>
            <h2 className="mt-5 border-b border-ink/15 pb-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink-4">Cash count</h2>
            <div className="grid grid-cols-3 gap-x-6">
              {Object.entries(counts)
                .sort((a, b) => Number(b[0]) - Number(a[0]))
                .map(([face, n]) => (
                  <div key={face} className="flex justify-between py-0.5 text-ink-2">
                    <span>
                      {Number(face).toLocaleString("en-US")} × {n}
                    </span>
                    <span className="num-tabular">{fmt(Number(face) * 100 * n)}</span>
                  </div>
                ))}
            </div>
          </>
        ) : null}

        {c?.card_actual_cents !== null && c?.card_actual_cents !== undefined ? (
          <>
            <h2 className="mt-5 border-b border-ink/15 pb-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink-4">Card terminal</h2>
            <Row label="Card sales recorded" cents={c.card_expected_cents} />
            <Row label="Terminal total" cents={c.card_actual_cents} />
            <Row label="Difference" cents={c.card_actual_cents - (c.card_expected_cents ?? 0)} strong />
          </>
        ) : report.card ? (
          <>
            <h2 className="mt-5 border-b border-ink/15 pb-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink-4">Card</h2>
            <Row label="Card takings (net)" cents={report.card.netCents} />
          </>
        ) : null}

        <h2 className="mt-5 border-b border-ink/15 pb-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink-4">The day in money</h2>
        {MONEY_LABELS.map(([k, label]) => (
          <Row key={k} label={label} cents={report.money[k] ?? 0} />
        ))}

        <h2 className="mt-5 border-b border-ink/15 pb-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink-4">Gold (fine grams)</h2>
        {report.goldBalance ? (
          <div className="grid grid-cols-4 gap-2 py-1 text-ink-2">
            {[
              ["Opening", report.goldBalance.openingMg],
              ["In", report.goldBalance.inMg],
              ["Out", report.goldBalance.outMg],
              ["Closing", report.goldBalance.closingMg],
            ].map(([l, mg]) => (
              <div key={String(l)}>
                <div className="text-xs text-ink-4">{String(l)}</div>
                <div className="num-tabular">{(Number(mg) / 1000).toFixed(3)}</div>
              </div>
            ))}
          </div>
        ) : null}
        {Object.values(report.gold)
          .filter((g) => g.mg)
          .map((g) => (
            <div key={g.label} className="flex justify-between py-0.5 text-ink-2">
              <span>{g.label}</span>
              <span className="num-tabular">{(g.mg / 1000).toFixed(3)}</span>
            </div>
          ))}

        <h2 className="mt-5 border-b border-ink/15 pb-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink-4">Checks</h2>
        <p className={report.checks.passed ? "text-emerald-700" : "text-rose-700"}>
          {report.checks.total - report.checks.failing.length} of {report.checks.total} reconciliation checks pass
          {report.checks.failing.length ? ` — failing: ${report.checks.failing.join(", ")}` : ""}
        </p>

        <div className="mt-10 grid grid-cols-2 gap-10 text-xs text-ink-4">
          <div className="border-t border-ink/30 pt-1">Counted by</div>
          <div className="border-t border-ink/30 pt-1">Checked by</div>
        </div>
      </div>
    </>
  );
}

export default function DayReportPage() {
  return (
    <Page>
      <Suspense fallback={<Skeleton className="mx-auto h-[40rem] max-w-2xl" />}>
        <ReportView />
      </Suspense>
    </Page>
  );
}
