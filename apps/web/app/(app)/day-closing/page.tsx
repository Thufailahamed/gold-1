"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission, LKR_DENOMINATIONS } from "@goldos/shared";
import {
  Callout,
  EmptyBlock,
  Hero,
  Modal,
  Page,
  Pager,
  Panel,
  Skeleton,
  StatusPill,
  TableCard,
  TableSkeleton,
  Tabs,
  controlClass,
  heroBtnGhost,
} from "@/components/ui";
import {
  AlertCircleIcon,
  BanknoteIcon,
  ClipboardCheckIcon,
  CoinsIcon,
  CreditCardIcon,
  FileDownIcon,
  GemIcon,
  HistoryIcon,
  PrinterIcon,
  SearchIcon,
  StoreIcon,
} from "@/components/icons";
import { api, downloadCsv, type MeData } from "@/lib/api";
import { InvestigatePanel, SummaryPanel, UnclosedPanel, VariancePanel, fmt } from "./panels";

type CashLine = { label: string; refEntity: string; cents: number };
type CashGroup = { totalCents: number; unclassifiedCents: number; lines: CashLine[] };

type Report = {
  branchId: string;
  date: string;
  openingCents: number;
  cashIn: CashGroup;
  cashOut: CashGroup;
  money: {
    salesCents: number;
    purchasesCents: number;
    oldGoldCents: number;
    expensesCents: number;
    customerPaymentsCents: number;
    supplierPaymentsCents: number;
    bankTransactionsCents: number;
  };
  gold: Record<string, { label: string; mg: number }>;
  goldBalance?: { openingMg: number; inMg: number; outMg: number; closingMg: number };
  card?: { salesCents: number; refundsCents: number; netCents: number };
  checks: { passed: boolean; failing: string[]; total: number };
  closing: {
    expectedCents: number;
    differenceCents: number;
    reasonRequired: boolean;
    awaitingApprovalCents: number;
  };
};

type Closing = {
  id: string;
  branch_id: string;
  close_date: string;
  expected_cents: number;
  actual_cents: number;
  difference_cents: number;
  difference_reason: string | null;
  correction_cents?: number;
  status: string;
  closed_at: number;
};

type TabKey = "close" | "investigate" | "unclosed" | "variance" | "summary";

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const toCentsOrNull = (v: string) => (v === "" ? null : Math.round(Number(v) * 100));

function Money({ cents, strong }: { cents: number; strong?: boolean }) {
  return <span className={strong ? "g-metric font-semibold text-ink" : "g-metric text-ink-2"}>{fmt(cents)}</span>;
}

export default function DayClosingPage() {
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState(() =>
    typeof document === "undefined"
      ? "branch-main"
      : (document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? "branch-main")
  );
  const [date, setDate] = useState(today());
  const [tab, setTab] = useState<TabKey>("close");
  const [actual, setActual] = useState("");
  const [useSheet, setUseSheet] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [card, setCard] = useState("");
  const [reason, setReason] = useState("");
  const [postDifference, setPostDifference] = useState(true);
  const [page, setPage] = useState(1);
  const [reopenFor, setReopenFor] = useState<Closing | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [approver, setApprover] = useState("");

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canManage = hasPermission(me.data?.permissions ?? [], "accounts:manage");

  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/branches?limit=100"),
  });
  const branchName = (id: string) => branches.data?.rows.find((b) => b.id === id)?.name ?? id;
  const preview = useQuery({
    queryKey: ["day-closing-preview", branchId, date],
    queryFn: () => api<Report>(`/api/v1/day-closings/preview?branchId=${encodeURIComponent(branchId)}&date=${date}`),
  });
  const closings = useQuery({
    queryKey: ["day-closings", page],
    queryFn: () => api<{ rows: Closing[]; total: number }>(`/api/v1/day-closings?page=${page}&limit=20`),
  });
  const unclosed = useQuery({
    enabled: !!branchId,
    queryKey: ["day-unclosed", branchId],
    queryFn: () => api<{ days: { date: string }[] }>(`/api/v1/day-closings/unclosed?branchId=${encodeURIComponent(branchId)}`),
  });

  const r = preview.data;
  const expectedCents = r?.closing.expectedCents ?? 0;
  const sheetCents = useMemo(
    () => Object.entries(counts).reduce((s, [face, n]) => s + Number(face) * 100 * (Number(n) || 0), 0),
    [counts]
  );
  const actualCents = useSheet ? (Object.values(counts).some((n) => n !== "") ? sheetCents : null) : toCentsOrNull(actual);
  const differenceCents = actualCents === null || Number.isNaN(actualCents) ? null : actualCents - expectedCents;
  const cardCents = toCentsOrNull(card);
  const cardDifference = cardCents === null || !r?.card ? null : cardCents - r.card.netCents;
  const needsReason = (differenceCents !== null && differenceCents !== 0) || (cardDifference !== null && cardDifference !== 0);
  const unclassified = r?.cashIn.unclassifiedCents ?? 0;
  const canClose = !!r && r.checks.passed && unclassified === 0 && actualCents !== null && (!needsReason || !!reason.trim());

  const close = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/api/v1/day-closings", {
        method: "POST",
        body: JSON.stringify({
          branchId,
          date,
          actualCents,
          differenceReason: needsReason ? reason : undefined,
          denominations: useSheet
            ? Object.fromEntries(Object.entries(counts).filter(([, n]) => n !== "" && Number(n) > 0).map(([f, n]) => [f, Number(n)]))
            : undefined,
          cardTerminalCents: cardCents ?? undefined,
          postDifference: differenceCents ? postDifference : undefined,
        }),
      }),
    onSuccess: () => {
      toast.success(`Closed ${date}`);
      setActual("");
      setCounts({});
      setCard("");
      setReason("");
      qc.invalidateQueries({ queryKey: ["day-closings"] });
      qc.invalidateQueries({ queryKey: ["day-closing-preview"] });
      qc.invalidateQueries({ queryKey: ["day-unclosed"] });
      qc.invalidateQueries({ queryKey: ["day-summary"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not close"),
  });

  const reopen = useMutation({
    mutationFn: () =>
      api(`/api/v1/day-closings/${reopenFor?.id}/reopen`, {
        method: "POST",
        body: JSON.stringify({ reason: reopenReason, approvedBy: approver }),
      }),
    onSuccess: () => {
      toast.success("Re-opened");
      setReopenFor(null);
      setReopenReason("");
      setApprover("");
      qc.invalidateQueries({ queryKey: ["day-closings"] });
      qc.invalidateQueries({ queryKey: ["day-unclosed"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not re-open"),
  });

  const goldRows = useMemo(() => Object.values(r?.gold ?? {}).filter((g) => g.mg !== 0), [r]);
  const reportHref = `/day-closing/report?branchId=${encodeURIComponent(branchId)}&date=${date}`;
  const unclosedCount = unclosed.data?.days.length ?? 0;

  return (
    <Page>
      <Hero
        kicker="Accounts"
        back={{ href: "/accounts", label: "Accounts dashboard" }}
        title="Day Closing"
        description="Count the drawer, compare it to the books, find and explain any difference"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={controlClass}>
              {(branches.data?.rows ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={controlClass} />
            <Link href={reportHref} className={heroBtnGhost}>
              <PrinterIcon size={14} /> Print report
            </Link>
            <button
              type="button"
              className={heroBtnGhost}
              onClick={() =>
                downloadCsv(`/api/v1/day-closings/report.csv?branchId=${encodeURIComponent(branchId)}&date=${date}`, `day-close-${date}.csv`).catch((e: unknown) =>
                  toast.error(e instanceof Error ? e.message : "Export failed")
                )
              }
            >
              <FileDownIcon size={14} /> CSV
            </button>
          </div>
        }
        stats={[
          { label: "Expected closing", value: r ? `${fmt(expectedCents)} LKR` : "—" },
          { label: "Checks", value: r ? `${r.checks.total - r.checks.failing.length}/${r.checks.total} pass` : "—" },
          { label: "Days not closed", value: unclosed.data ? String(unclosedCount) : "—" },
          { label: "Awaiting approval", value: r ? `${fmt(r.closing.awaitingApprovalCents)} LKR` : "—" },
        ]}
        note="Money is in LKR. Gold is in fine milligrams. The two never mix."
      />

      <Tabs
        ariaLabel="Day closing"
        value={tab}
        onChange={setTab}
        items={[
          { key: "close", label: "Close the day", icon: <ClipboardCheckIcon size={14} /> },
          { key: "investigate", label: "Find missing amounts", icon: <SearchIcon size={14} /> },
          { key: "unclosed", label: "Days not closed", icon: <AlertCircleIcon size={14} />, count: unclosed.data ? unclosedCount : null },
          { key: "variance", label: "Shortages & overages", icon: <HistoryIcon size={14} /> },
          { key: "summary", label: "All branches", icon: <StoreIcon size={14} /> },
        ]}
      />

      {tab === "investigate" ? (
        <InvestigatePanel key={`${branchId}-${date}`} branchId={branchId} date={date} initialActual={actualCents === null ? "" : String(actualCents / 100)} />
      ) : tab === "unclosed" ? (
        <UnclosedPanel
          branchId={branchId}
          onPick={(d) => {
            setDate(d);
            setTab("close");
          }}
        />
      ) : tab === "variance" ? (
        <VariancePanel branchId={branchId} today={today()} branchName={branchName} />
      ) : tab === "summary" ? (
        <SummaryPanel
          date={date}
          onPick={(b) => {
            setBranchId(b);
            setTab("close");
          }}
        />
      ) : (
        <div className="space-y-4">
          {r && !r.checks.passed ? (
            <Callout
              tone="danger"
              title="Cannot close this day"
              action={
                <button type="button" onClick={() => setTab("investigate")} className="g-btn g-btn-secondary h-8 px-3 text-xs">
                  Find out why
                </button>
              }
            >
              {r.checks.total - r.checks.failing.length} of {r.checks.total} checks pass. Failing: {r.checks.failing.join(", ")}.
            </Callout>
          ) : null}

          {unclassified > 0 ? (
            <Callout tone="warning" title={`${fmt(unclassified)} LKR unrecognised`}>
              Some cash movement does not belong to a category this screen knows, so the breakdown would be wrong. The close is blocked until it is named.
            </Callout>
          ) : null}

          {r && r.closing.awaitingApprovalCents > 0 ? (
            <Callout tone="info" title={`${fmt(r.closing.awaitingApprovalCents)} LKR has left the bank but is not yet approved`}>
              The books read this much higher than the drawer. If your count is short by about that much, this is why — not a shortage.
            </Callout>
          ) : null}

          {unclosedCount > 0 && date === today() ? (
            <Callout
              tone="warning"
              title={`${unclosedCount} earlier day${unclosedCount === 1 ? "" : "s"} with activity not closed`}
              action={
                <button type="button" onClick={() => setTab("unclosed")} className="g-btn g-btn-secondary h-8 px-3 text-xs">
                  Show
                </button>
              }
            >
              Nobody counted those drawers. A shortage on a skipped day is only found by closing it.
            </Callout>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Cash" icon={<BanknoteIcon size={17} />} className="space-y-3">
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-ink-3">Opening Cash</span>
                  <Money cents={r?.openingCents ?? 0} />
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-3">+ Cash In</span>
                  <Money cents={r?.cashIn.totalCents ?? 0} />
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-3">− Cash Out</span>
                  <Money cents={r?.cashOut.totalCents ?? 0} />
                </div>
                <div className="flex justify-between border-t border-ink/10 pt-2 text-base">
                  <span className="font-medium text-ink">= Expected Closing Cash</span>
                  <Money cents={expectedCents} strong />
                </div>
              </div>

              {r && (r.cashIn.lines.length > 0 || r.cashOut.lines.length > 0) ? (
                <details className="pt-1">
                  <summary className="cursor-pointer text-xs text-ink-4">
                    Show the breakdown ({r.cashIn.lines.length + r.cashOut.lines.length} lines)
                  </summary>
                  <div className="mt-2 space-y-1 text-xs">
                    {[...r.cashIn.lines.map((l) => ({ ...l, dir: "In" })), ...r.cashOut.lines.map((l) => ({ ...l, dir: "Out" }))].map((l, i) => (
                      <div key={`${l.refEntity}-${l.dir}-${i}`} className="flex justify-between">
                        <span className="text-ink-4">
                          {l.dir} · {l.label}
                        </span>
                        <span className="g-metric">{fmt(l.cents)}</span>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}

              <div className="space-y-2 border-t border-ink/10 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-ink">Actual Closing Cash (counted)</span>
                  <label className="flex items-center gap-2 text-xs text-ink-3">
                    <input type="checkbox" checked={useSheet} onChange={(e) => setUseSheet(e.target.checked)} />
                    Count by notes
                  </label>
                </div>
                {useSheet ? (
                  <div className="rounded-xl bg-bone/60 p-3">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                      {LKR_DENOMINATIONS.map((face) => (
                        <label key={face} className="flex items-center justify-between gap-2 text-xs text-ink-3">
                          <span className="w-12 text-right g-metric">{face.toLocaleString("en-US")}</span>
                          <span>×</span>
                          <input
                            inputMode="numeric"
                            value={counts[face] ?? ""}
                            onChange={(e) => setCounts((c) => ({ ...c, [face]: e.target.value.replace(/\D/g, "") }))}
                            className="h-8 w-16 rounded-md border border-ink/15 bg-paper px-2 text-right num-tabular"
                            aria-label={`${face} rupee pieces`}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="mt-2 flex justify-between border-t border-ink/10 pt-2 text-sm">
                      <span className="text-ink-3">Counted</span>
                      <Money cents={sheetCents} strong />
                    </div>
                  </div>
                ) : (
                  <input type="number" step="any" value={actual} onChange={(e) => setActual(e.target.value)} className={`num-tabular ${controlClass} w-full`} />
                )}
                <div className="flex justify-between text-base">
                  <span className="font-medium text-ink">Cash Difference</span>
                  {differenceCents === null ? (
                    <span className="text-ink-4">—</span>
                  ) : (
                    <span className={`g-metric font-semibold ${differenceCents === 0 ? "text-emerald-700" : "text-rose-600"}`}>{fmt(differenceCents)}</span>
                  )}
                </div>
                {differenceCents ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <button type="button" onClick={() => setTab("investigate")} className="font-medium text-gold-dark underline">
                      Find what explains {fmt(Math.abs(differenceCents))}
                    </button>
                    <label className="flex items-center gap-2 text-ink-3">
                      <input type="checkbox" checked={postDifference} onChange={(e) => setPostDifference(e.target.checked)} />
                      Post to Cash Short &amp; Over so tomorrow opens on the counted cash
                    </label>
                  </div>
                ) : null}
                {needsReason ? (
                  <label className="block text-sm text-ink-2">
                    Explanation (required)
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="A 5,000 note was in the safe" className={`${controlClass} w-full`} />
                  </label>
                ) : null}
                {canManage ? (
                  <button type="button" onClick={() => close.mutate()} disabled={!canClose || close.isPending} className="g-btn g-btn-primary h-10 w-full text-sm">
                    {close.isPending ? "Closing…" : `Close ${date}`}
                  </button>
                ) : (
                  <p className="text-xs text-ink-4">You can read this screen; closing the day needs accounts:manage.</p>
                )}
              </div>
            </Panel>

            <div className="space-y-4">
              <Panel title="Card terminal" icon={<CreditCardIcon size={17} />} description="Compare the terminal's end-of-day total with the card sales recorded" className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-ink-3">Card sales recorded (net of refunds)</span>
                  <Money cents={r?.card?.netCents ?? 0} />
                </div>
                <label className="block text-sm text-ink-2">
                  Terminal total (optional)
                  <input type="number" step="any" value={card} onChange={(e) => setCard(e.target.value)} className={`num-tabular ${controlClass} w-full`} />
                </label>
                {cardDifference !== null ? (
                  <div className="flex justify-between">
                    <span className="font-medium text-ink">Card difference</span>
                    <span className={`g-metric font-semibold ${cardDifference === 0 ? "text-emerald-700" : "text-rose-600"}`}>{fmt(cardDifference)}</span>
                  </div>
                ) : null}
                {cardDifference && differenceCents && cardDifference === -differenceCents ? (
                  <p className="text-xs text-amber-700">The card and cash differences cancel out — a sale was probably keyed with the wrong payment method.</p>
                ) : null}
              </Panel>

              <Panel title="The day in money" icon={<CoinsIcon size={17} />} className="space-y-1.5 text-sm">
                {r ? (
                  [
                    ["Sales", r.money.salesCents],
                    ["Purchases", r.money.purchasesCents],
                    ["Old Gold Purchases", r.money.oldGoldCents],
                    ["Expenses", r.money.expensesCents],
                    ["Customer Payments", r.money.customerPaymentsCents],
                    ["Supplier Payments", r.money.supplierPaymentsCents],
                    ["Bank Transactions", r.money.bankTransactionsCents],
                  ].map(([label, cents]) => (
                    <div key={String(label)} className="flex justify-between">
                      <span className="text-ink-3">{String(label)}</span>
                      <Money cents={Number(cents)} />
                    </div>
                  ))
                ) : (
                  <Skeleton className="h-24" />
                )}
              </Panel>

              <Panel title="The day in gold" icon={<GemIcon size={17} />} description="Fine milligrams" className="space-y-1.5 text-sm">
                {r?.goldBalance ? (
                  <div className="grid grid-cols-4 gap-2 border-b border-ink/10 pb-2 text-xs">
                    {[
                      ["Opening", r.goldBalance.openingMg],
                      ["In", r.goldBalance.inMg],
                      ["Out", r.goldBalance.outMg],
                      ["Closing", r.goldBalance.closingMg],
                    ].map(([l, mg]) => (
                      <div key={String(l)}>
                        <div className="text-ink-4">{String(l)}</div>
                        <div className="g-metric text-ink">{Number(mg).toLocaleString("en-US")}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {goldRows.length === 0 ? (
                  <p className="text-ink-4">No gold moved today.</p>
                ) : (
                  goldRows.map((g) => (
                    <div key={g.label} className="flex justify-between">
                      <span className="text-ink-3">{g.label}</span>
                      <span className="g-metric text-ink-2">{g.mg.toLocaleString("en-US")} mg</span>
                    </div>
                  ))
                )}
              </Panel>
            </div>
          </div>

          <TableCard
            title="Closed days"
            icon={<ClipboardCheckIcon size={17} />}
            actions={
              <span className="g-metric text-[11px] font-medium uppercase tracking-[0.14em] text-ink-4">
                {String(closings.data?.total ?? 0).padStart(2, "0")} on file
              </span>
            }
            footer={<Pager page={page} onChange={setPage} pageSize={20} count={closings.data?.rows.length ?? 0} total={closings.data?.total ?? 0} unit="days" />}
          >
            {closings.isLoading ? (
              <TableSkeleton rows={5} cols={5} />
            ) : (closings.data?.rows.length ?? 0) === 0 ? (
              <EmptyBlock title="No days closed yet" description="Close the first day above." />
            ) : (
              <table className="g-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Branch</th>
                    <th className="!text-right">Expected</th>
                    <th className="!text-right">Actual</th>
                    <th className="!text-right">Difference</th>
                    <th>Explanation</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {closings.data?.rows.map((c) => (
                    <tr key={c.id}>
                      <td className="g-metric text-xs">{c.close_date}</td>
                      <td className="text-ink-3">{branchName(c.branch_id)}</td>
                      <td className="!text-right num-tabular">{fmt(c.expected_cents)}</td>
                      <td className="!text-right num-tabular">{fmt(c.actual_cents)}</td>
                      <td className={`!text-right num-tabular ${c.difference_cents === 0 ? "" : "text-rose-600"}`}>
                        {fmt(c.difference_cents)}
                        {c.correction_cents ? <div className="text-[11px] text-ink-4">posted</div> : null}
                      </td>
                      <td className="text-ink-3">{c.difference_reason ?? "—"}</td>
                      <td>
                        <StatusPill status={c.status} />
                      </td>
                      <td className="whitespace-nowrap !text-right">
                        <Link href={`/day-closing/report?branchId=${encodeURIComponent(c.branch_id)}&date=${c.close_date}`} className="g-btn g-btn-secondary mr-1 h-8 px-3 text-xs">
                          Report
                        </Link>
                        {canManage && c.status === "CLOSED" ? (
                          <button type="button" onClick={() => setReopenFor(c)} className="g-btn g-btn-secondary h-8 px-3 text-xs">
                            Re-open
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TableCard>
        </div>
      )}

      {reopenFor ? (
        <Modal
          kicker="Accounts"
          title={`Re-open ${reopenFor.close_date}`}
          danger
          submitLabel="Re-open day"
          submitDisabled={!reopenReason || !approver}
          pending={reopen.isPending}
          onClose={() => setReopenFor(null)}
          onSubmit={() => reopen.mutate()}
        >
          <p className="text-sm text-ink-2">The close is kept as a record. Re-opening only stops the block on new postings.</p>
          <label className="block text-sm text-ink-2">
            Why
            <input value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} className={`${controlClass} w-full`} />
          </label>
          <label className="block text-sm text-ink-2">
            Approved by
            <input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="A user id holding accounts:manage" className={`${controlClass} w-full`} />
          </label>
          <p className="text-xs text-ink-4">The approver must not be you, and must not be whoever closed the day.</p>
        </Modal>
      ) : null}
    </Page>
  );
}
