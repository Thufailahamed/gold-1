"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
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
  controlClass,
} from "@/components/ui";
import {
  BanknoteIcon,
  ClipboardCheckIcon,
  CoinsIcon,
  GemIcon,
} from "@/components/icons";
import { api, type MeData } from "@/lib/api";

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
  status: string;
  closed_at: number;
};

const fmt = (c: number) => (c / 100).toLocaleString("en-US");
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

function Money({ cents, strong }: { cents: number; strong?: boolean }) {
  return (
    <span className={strong ? "g-metric font-semibold text-ink" : "g-metric text-ink-2"}>
      {fmt(cents)}
    </span>
  );
}

export default function DayClosingPage() {
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState("branch-main");
  const [date, setDate] = useState(today());
  const [actual, setActual] = useState("");
  const [reason, setReason] = useState("");
  const [page, setPage] = useState(1);
  const [reopenFor, setReopenFor] = useState<Closing | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [approver, setApprover] = useState("");

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canManage = hasPermission(me.data?.permissions ?? [], "accounts:manage");

  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () => api<{ id: string; name: string }[]>("/api/v1/branches"),
  });
  const preview = useQuery({
    queryKey: ["day-closing-preview", branchId, date],
    queryFn: () =>
      api<Report>(`/api/v1/day-closings/preview?branchId=${encodeURIComponent(branchId)}&date=${date}`),
  });
  const closings = useQuery({
    queryKey: ["day-closings", page],
    queryFn: () => api<{ rows: Closing[]; total: number }>(`/api/v1/day-closings?page=${page}&limit=20`),
  });

  const r = preview.data;
  const expectedCents = r?.closing.expectedCents ?? 0;
  const actualCents = actual === "" ? null : Math.round(Number(actual) * 100);
  const differenceCents =
    actualCents === null || Number.isNaN(actualCents) ? null : actualCents - expectedCents;
  const needsReason = differenceCents !== null && differenceCents !== 0;
  const unclassified = r?.cashIn.unclassifiedCents ?? 0;
  const canClose =
    !!r && r.checks.passed && unclassified === 0 && actualCents !== null && (!needsReason || !!reason.trim());

  const close = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/api/v1/day-closings", {
        method: "POST",
        body: JSON.stringify({
          branchId,
          date,
          actualCents,
          differenceReason: needsReason ? reason : undefined,
        }),
      }),
    onSuccess: () => {
      toast.success(`Closed ${date}`);
      setActual("");
      setReason("");
      qc.invalidateQueries({ queryKey: ["day-closings"] });
      qc.invalidateQueries({ queryKey: ["day-closing-preview"] });
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
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not re-open"),
  });

  const goldRows = useMemo(
    () => Object.values(r?.gold ?? {}).filter((g) => g.mg !== 0),
    [r]
  );

  return (
    <Page>
      <Hero
        kicker="Accounts"
        title="Day Closing"
        description="Count the drawer, compare it to the books, explain any difference"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className={controlClass}
            >
              {(branches.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={controlClass}
            />
          </div>
        }
        stats={[
          { label: "Expected closing", value: r ? `${fmt(expectedCents)} LKR` : "—" },
          { label: "Checks", value: r ? `${r.checks.total - r.checks.failing.length}/${r.checks.total} pass` : "—" },
          { label: "Days closed", value: (closings.data?.total ?? 0).toLocaleString("en-US") },
          { label: "Awaiting approval", value: r ? `${fmt(r.closing.awaitingApprovalCents)} LKR` : "—" },
        ]}
        note="Money is in LKR. Gold is in fine milligrams. The two never mix."
      />

      <div className="space-y-4">
        {/* The things that stop the close, above everything else. */}
        {r && !r.checks.passed ? (
          <Callout tone="danger" title="Cannot close this day">
            {r.checks.total - r.checks.failing.length} of {r.checks.total} checks pass. Failing:{" "}
            {r.checks.failing.join(", ")}.
          </Callout>
        ) : null}

        {unclassified > 0 ? (
          <Callout tone="warning" title={`${fmt(unclassified)} LKR unrecognised`}>
            Some cash movement does not belong to a category this screen knows, so the
            breakdown would be wrong. The close is blocked until it is named.
          </Callout>
        ) : null}

        {r && r.closing.awaitingApprovalCents > 0 ? (
          <Callout
            tone="info"
            title={`${fmt(r.closing.awaitingApprovalCents)} LKR has left the bank but is not yet approved`}
          >
            The books read this much higher than the drawer. If your count is short by
            about that much, this is why — not a shortage.
          </Callout>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {/* The arithmetic */}
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
                  Show the breakdown ({r.cashIn.lines.length + r.cashOut.lines.length} movements)
                </summary>
                <div className="mt-2 space-y-1 text-xs">
                  {[...r.cashIn.lines.map((l) => ({ ...l, dir: "In" })), ...r.cashOut.lines.map((l) => ({ ...l, dir: "Out" }))].map(
                    (l, i) => (
                      <div key={`${l.refEntity}-${l.dir}-${i}`} className="flex justify-between">
                        <span className="text-ink-4">
                          {l.dir} · {l.label}
                        </span>
                        <span className="g-metric">{fmt(l.cents)}</span>
                      </div>
                    )
                  )}
                </div>
              </details>
            ) : null}

            <div className="space-y-2 border-t border-ink/10 pt-3">
              <label className="block text-sm text-ink-2">
                Actual Closing Cash (counted)
                <input
                  type="number"
                  step="any"
                  value={actual}
                  onChange={(e) => setActual(e.target.value)}
                  className={`num-tabular ${controlClass}`}
                />
              </label>
              <div className="flex justify-between text-base">
                <span className="font-medium text-ink">Cash Difference</span>
                {differenceCents === null ? (
                  <span className="text-ink-4">—</span>
                ) : (
                  <span
                    className={`g-metric font-semibold ${
                      differenceCents === 0 ? "text-emerald-700" : "text-rose-600"
                    }`}
                  >
                    {fmt(differenceCents)}
                  </span>
                )}
              </div>
              {needsReason ? (
                <label className="block text-sm text-ink-2">
                  Explanation (required)
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="A 5,000 note was in the safe"
                    className={controlClass}
                  />
                </label>
              ) : null}
              {canManage ? (
                <button
                  type="button"
                  onClick={() => close.mutate()}
                  disabled={!canClose || close.isPending}
                  className="g-btn g-btn-primary h-10 w-full text-sm"
                >
                  {close.isPending ? "Closing…" : `Close ${date}`}
                </button>
              ) : (
                <p className="text-xs text-ink-4">
                  You can read this screen; closing the day needs accounts:manage.
                </p>
              )}
            </div>
          </Panel>

          {/* The money and gold summaries */}
          <div className="space-y-4">
            <Panel title="The day in money" icon={<CoinsIcon size={17} />} className="space-y-1.5 text-sm">
              {r ? (
                <>
                  {[
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
                  ))}
                </>
              ) : (
                <Skeleton className="h-24" />
              )}
            </Panel>

            <Panel title="The day in gold" icon={<GemIcon size={17} />} description="Fine milligrams" className="space-y-1.5 text-sm">
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
          footer={
            <Pager
              page={page}
              onChange={setPage}
              pageSize={20}
              count={closings.data?.rows.length ?? 0}
              total={closings.data?.total ?? 0}
              unit="days"
            />
          }
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
                  <th>Status</th>
                  {canManage ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {closings.data?.rows.map((c) => (
                  <tr key={c.id}>
                    <td className="g-metric text-xs">{c.close_date}</td>
                    <td className="text-ink-3">{c.branch_id}</td>
                    <td className="!text-right num-tabular">{fmt(c.expected_cents)}</td>
                    <td className="!text-right num-tabular">{fmt(c.actual_cents)}</td>
                    <td
                      className={`!text-right num-tabular ${c.difference_cents === 0 ? "" : "text-rose-600"}`}
                    >
                      {fmt(c.difference_cents)}
                    </td>
                    <td>
                      <StatusPill status={c.status} />
                    </td>
                    {canManage ? (
                      <td className="!text-right">
                        {c.status === "CLOSED" ? (
                          <button
                            type="button"
                            onClick={() => setReopenFor(c)}
                            className="g-btn g-btn-secondary h-8 px-3 text-xs"
                          >
                            Re-open
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      </div>

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
          <p className="text-sm text-ink-2">
            The close is kept as a record. Re-opening only stops the block on new postings.
          </p>
          <label className="block text-sm text-ink-2">
            Why
            <input
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              className={controlClass}
            />
          </label>
          <label className="block text-sm text-ink-2">
            Approved by
            <input
              value={approver}
              onChange={(e) => setApprover(e.target.value)}
              placeholder="A user id holding accounts:manage"
              className={controlClass}
            />
          </label>
          <p className="text-xs text-ink-4">
            The approver must not be you, and must not be whoever closed the day.
          </p>
        </Modal>
      ) : null}
    </Page>
  );
}
