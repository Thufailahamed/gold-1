"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Callout, EmptyBlock, Hero, Modal, Page, StatusPill, TableCard, TableSkeleton, controlClass } from "@/components/ui";
import { ClipboardCheckIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { businessToday } from "@/lib/monthly";
import { lkr, lkrSigned, useAccountsScope } from "@/lib/accounts";

type Close = {
  id: string;
  status: "CLOSED" | "REOPENED";
  net_profit_cents: number;
  closed_at: number;
  reopen_reason: string | null;
};
type Year = { start: string; end: string; label: string; close: Close | null };
type Years = { startMonth: number; current: { start: string; end: string; label: string }; years: Year[] };
type BalanceSheet = { retainedEarningsCents: number; currentYearProfitCents: number; balanced: boolean };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function YearEndPage() {
  const qc = useQueryClient();
  const today = businessToday();
  const { canManage, ready } = useAccountsScope();
  const [closing, setClosing] = useState<Year | null>(null);
  const [reopening, setReopening] = useState<Year | null>(null);

  const years = useQuery({ queryKey: ["acct", "fiscal-years"], queryFn: () => api<Years>("/api/v1/accounts/fiscal-years") });
  const bs = useQuery({
    enabled: ready,
    queryKey: ["acct", "bs", "year-end", today],
    queryFn: () => api<BalanceSheet>(`/api/v1/accounts/statements/balance-sheet?date=${today}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["acct"] });
  const lastClosed = years.data?.years.find((y) => y.close?.status === "CLOSED");

  return (
    <Page>
      <Hero
        kicker="Accounts"
        back={{ href: "/accounts", label: "Accounts dashboard" }}
        title="Financial year"
        description="Close a finished year to lock its books and freeze its statements. Profit from closed-off years is carried as retained earnings on the balance sheet."
        stats={[
          { label: "Current year", value: years.data?.current.label ?? "—" },
          { label: "Year starts", value: years.data ? MONTHS[years.data.startMonth - 1] : "—" },
          { label: "Retained earnings", value: bs.data ? lkrSigned(bs.data.retainedEarningsCents) : "—" },
          { label: "Current year profit", value: bs.data ? lkrSigned(bs.data.currentYearProfitCents) : "—" },
        ]}
        note={lastClosed ? `Books locked up to ${lastClosed.end}` : "No year has been closed yet"}
      />

      <Callout tone="info" title="What closing does">
        Closing posts nothing. It refuses any new entry dated inside the year, at every branch, and keeps a copy of that year's profit & loss and closing balance sheet.
        A correction after closing needs the year reopened by a second person with accounts:manage.
      </Callout>

      <TableCard title="Years" icon={<ClipboardCheckIcon size={17} />} description="Newest first. Only a year that has ended can be closed.">
        {years.isLoading ? (
          <TableSkeleton rows={3} cols={4} />
        ) : years.isError ? (
          <EmptyBlock title="Could not load financial years" description={(years.error as Error).message} />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>Period</th>
                <th>Status</th>
                <th className="!text-right">Net profit (frozen)</th>
                {canManage ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {years.data!.years.map((y) => {
                const ended = y.end < today;
                const status = y.close?.status ?? (ended ? "OPEN" : "CURRENT");
                return (
                  <tr key={y.end}>
                    <td className="font-medium text-ink">{y.label}</td>
                    <td className="text-ink-3">
                      {y.start} – {y.end}
                    </td>
                    <td>
                      <StatusPill status={status} />
                      {y.close?.status === "REOPENED" && y.close.reopen_reason ? (
                        <div className="mt-1 text-xs text-ink-4">Reopened: {y.close.reopen_reason}</div>
                      ) : null}
                    </td>
                    <td className="!text-right num-tabular">{y.close?.status === "CLOSED" ? lkrSigned(y.close.net_profit_cents) : "—"}</td>
                    {canManage ? (
                      <td className="!text-right">
                        {y.close?.status === "CLOSED" ? (
                          y === lastClosed ? (
                            <button type="button" onClick={() => setReopening(y)} className="g-btn g-btn-secondary h-8 px-3 text-xs">
                              Reopen
                            </button>
                          ) : null
                        ) : ended ? (
                          <button type="button" onClick={() => setClosing(y)} className="g-btn g-btn-primary h-8 px-3 text-xs">
                            Close year
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>

      {closing ? <CloseModal year={closing} onClose={() => setClosing(null)} onDone={() => { setClosing(null); refresh(); }} /> : null}
      {reopening ? <ReopenModal year={reopening} onClose={() => setReopening(null)} onDone={() => { setReopening(null); refresh(); }} /> : null}
    </Page>
  );
}

function CloseModal({ year, onClose, onDone }: { year: Year; onClose: () => void; onDone: () => void }) {
  const pnl = useQuery({
    queryKey: ["acct", "pnl", year.start, year.end],
    queryFn: () => api<{ netProfitCents: number; totalRevenueCents: number }>(`/api/v1/accounts/statements/pnl?from=${year.start}&to=${year.end}`),
  });
  const close = useMutation({
    mutationFn: () => api<{ netProfitCents: number }>("/api/v1/accounts/fiscal-years/close", { method: "POST", body: JSON.stringify({ yearEnd: year.end }) }),
    onSuccess: () => {
      toast.success(`${year.label} closed`);
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not close the year"),
  });
  return (
    <Modal kicker="Close financial year" title={year.label} onClose={onClose} onSubmit={() => close.mutate()} submitLabel="Close year" pending={close.isPending}>
      <p className="text-sm text-ink-3">
        Every entry dated {year.start} to {year.end} becomes read-only, at every branch. Make sure every correction for the year has been posted first.
      </p>
      <div className="rounded-xl bg-bone/60 p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-ink-3">Revenue</span>
          <span className="num-tabular">{pnl.data ? lkr(pnl.data.totalRevenueCents) : "…"}</span>
        </div>
        <div className="mt-1 flex justify-between font-semibold text-ink">
          <span>Net profit to retained earnings</span>
          <span className="num-tabular">{pnl.data ? lkrSigned(pnl.data.netProfitCents) : "…"}</span>
        </div>
      </div>
    </Modal>
  );
}

function ReopenModal({ year, onClose, onDone }: { year: Year; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState("");
  const reopen = useMutation({
    mutationFn: () =>
      api(`/api/v1/accounts/fiscal-years/${year.end}/reopen`, { method: "POST", body: JSON.stringify({ reason: reason.trim(), approvedBy: approver.trim() }) }),
    onSuccess: () => {
      toast.success(`${year.label} reopened`);
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not reopen"),
  });
  return (
    <Modal
      kicker="Reopen financial year"
      title={year.label}
      danger
      onClose={onClose}
      onSubmit={() => reopen.mutate()}
      submitLabel="Reopen year"
      pending={reopen.isPending}
      submitDisabled={!reason.trim() || !approver.trim()}
    >
      <label className="block text-sm text-ink-2">
        Reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. supplier invoice received late" className={`${controlClass} w-full`} />
      </label>
      <label className="block text-sm text-ink-2">
        Approved by
        <input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="A user id holding accounts:manage" className={`${controlClass} w-full`} />
      </label>
      <p className="text-xs text-ink-4">The approver must not be you, and must not be whoever closed the year.</p>
    </Modal>
  );
}
