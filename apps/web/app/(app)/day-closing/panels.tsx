"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Callout, EmptyBlock, Panel, StatusPill, TableCard, TableSkeleton, controlClass, controlSmClass } from "@/components/ui";
import { AlertCircleIcon, ClipboardCheckIcon, HistoryIcon, SearchIcon, StoreIcon } from "@/components/icons";
import { api } from "@/lib/api";

export const fmt = (c: number) => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (c: number) => `${c > 0 ? "+" : c < 0 ? "−" : ""}${fmt(Math.abs(c))}`;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/* ------------------------------------------------------- find the difference */

type Investigation = {
  expectedCents: number;
  actualCents: number | null;
  differenceCents: number | null;
  failingChecks: { id: string; label: string; expected: number; actual: number; difference: number; detail: string[] }[];
  documentIssues: { kind: string; documentId: string; number: string; problem: string; documentCents: number; ledgerCents: number | null }[];
  cashMovements: { entryId: string; entryNo: string; refEntity: string | null; refNo: string | null; memo: string | null; cents: number; createdAt: number; createdBy: string | null; backdated: boolean; reversal: boolean }[];
  suspects: { explanation: string; cents: number; items: string[] }[];
  pending: {
    expenses: { id: string; number: string; amountCents: number; description: string }[];
    transfersIn: { id: string; number: string; amountCents: number; sentOn: string }[];
    approvals: { id: string; action: string; reason: string }[];
  };
  lateEntries: { entryNo: string; entryDate: string; refEntity: string | null; cashCents: number; memo: string | null }[];
  outstanding: { cardClearingCents: number; oldestUnsettledCardDate: string | null; cashInTransitOutCents: number };
};

const DOC_LINK: Record<string, (id: string) => string> = {
  sale: (id) => `/sales/invoices/${id}`,
  purchase: (id) => `/purchases/invoices/${id}`,
  expense: (id) => `/expenses/${id}`,
};

/**
 * Where did the money go. Everything the API can say about one branch-day,
 * arranged in the order a person would look: what matches the difference
 * exactly, which documents are wrong, what is still waiting, then every
 * drawer movement.
 */
export function InvestigatePanel({ branchId, date, initialActual }: { branchId: string; date: string; initialActual: string }) {
  const [actual, setActual] = useState(initialActual);
  const actualCents = actual === "" ? undefined : Math.round(Number(actual) * 100);
  const q = useQuery({
    enabled: !!branchId,
    queryKey: ["day-investigate", branchId, date, actualCents],
    queryFn: () =>
      api<Investigation>(
        `/api/v1/day-closings/investigate?branchId=${encodeURIComponent(branchId)}&date=${date}${actualCents !== undefined && Number.isFinite(actualCents) ? `&actualCents=${actualCents}` : ""}`
      ),
  });
  const r = q.data;
  const nothing =
    r && !r.failingChecks.length && !r.documentIssues.length && !r.suspects.length && !r.pending.expenses.length && !r.pending.transfersIn.length && !r.lateEntries.length;

  return (
    <div className="space-y-4">
      <Panel title="Find missing amounts" icon={<SearchIcon size={17} />} description="Enter the counted cash to look for what explains the difference">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm text-ink-2">
            Counted cash (LKR)
            <input type="number" step="any" value={actual} onChange={(e) => setActual(e.target.value)} className={`num-tabular ${controlClass} w-full`} />
          </label>
          <div className="text-sm">
            <div className="text-ink-4">Expected</div>
            <div className="g-metric text-lg text-ink">{r ? fmt(r.expectedCents) : "—"}</div>
          </div>
          <div className="text-sm">
            <div className="text-ink-4">Difference</div>
            <div className={`g-metric text-lg ${r?.differenceCents ? "text-rose-600" : "text-emerald-700"}`}>
              {r?.differenceCents === null || r?.differenceCents === undefined ? "—" : signed(r.differenceCents)}
            </div>
          </div>
        </div>
      </Panel>

      {q.isLoading ? <TableSkeleton rows={5} cols={4} /> : null}
      {q.isError ? <Callout tone="danger" title="Could not investigate">{(q.error as Error).message}</Callout> : null}
      {nothing ? (
        <Callout tone="success" title="Nothing out of place">
          Every check passes, every document is posted as it says, and nothing is waiting. {r?.differenceCents ? "If the count is still off, recount the drawer." : ""}
        </Callout>
      ) : null}

      {r && r.suspects.length ? (
        <TableCard title="Likely explanations" icon={<AlertCircleIcon size={17} />} description="Movements whose size matches the difference exactly">
          <table className="g-table">
            <thead>
              <tr>
                <th>Why it could be this</th>
                <th>Entries</th>
                <th className="!text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {r.suspects.map((s, i) => (
                <tr key={i}>
                  <td className="text-ink-2">{s.explanation}</td>
                  <td className="font-mono text-xs text-ink-3">{s.items.join(" + ")}</td>
                  <td className="!text-right num-tabular">{fmt(s.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      ) : null}

      {r && r.failingChecks.length ? (
        <TableCard title="Checks that do not agree" icon={<ClipboardCheckIcon size={17} />} description="Books vs documents. Money in LKR, gold in fine mg.">
          <table className="g-table">
            <thead>
              <tr>
                <th>Check</th>
                <th className="!text-right">Documents</th>
                <th className="!text-right">Ledger</th>
                <th className="!text-right">Out by</th>
              </tr>
            </thead>
            <tbody>
              {r.failingChecks.map((c) => {
                const gold = c.id.startsWith("gold_");
                const v = (n: number) => (gold ? `${n.toLocaleString("en-US")} mg` : fmt(n));
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="text-ink">{c.label}</div>
                      {c.detail.map((d) => (
                        <div key={d} className="font-mono text-[11px] text-ink-4">{d}</div>
                      ))}
                    </td>
                    <td className="!text-right num-tabular">{v(c.expected)}</td>
                    <td className="!text-right num-tabular">{v(c.actual)}</td>
                    <td className="!text-right num-tabular text-rose-600">{v(c.difference)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableCard>
      ) : null}

      {r && r.documentIssues.length ? (
        <TableCard title="Documents not posted as they say" icon={<AlertCircleIcon size={17} />} description="Each one is part of a failing check">
          <table className="g-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Problem</th>
                <th className="!text-right">Document</th>
                <th className="!text-right">Ledger</th>
              </tr>
            </thead>
            <tbody>
              {r.documentIssues.map((d, i) => (
                <tr key={`${d.documentId}-${i}`}>
                  <td className="font-mono text-xs">
                    {DOC_LINK[d.kind] ? <Link className="underline" href={DOC_LINK[d.kind]!(d.documentId)}>{d.number}</Link> : d.number}
                    <div className="font-sans text-[11px] capitalize text-ink-4">{d.kind.replace(/_/g, " ")}</div>
                  </td>
                  <td className="text-ink-2">{d.problem}</td>
                  <td className="!text-right num-tabular">{fmt(d.documentCents)}</td>
                  <td className="!text-right num-tabular">{d.ledgerCents === null ? "—" : fmt(d.ledgerCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      ) : null}

      {r && (r.pending.expenses.length || r.pending.transfersIn.length || r.pending.approvals.length || r.lateEntries.length) ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Waiting, not yet in the books" icon={<HistoryIcon size={17} />} className="space-y-1.5 text-sm">
            {r.pending.expenses.map((e) => (
              <div key={e.id} className="flex justify-between gap-3">
                <span className="text-ink-3">Expense {e.number} awaiting approval — {e.description}</span>
                <span className="g-metric">{fmt(e.amountCents)}</span>
              </div>
            ))}
            {r.pending.transfersIn.map((t) => (
              <div key={t.id} className="flex justify-between gap-3">
                <span className="text-ink-3">Transfer {t.number} sent {t.sentOn}, not received here</span>
                <span className="g-metric">{fmt(t.amountCents)}</span>
              </div>
            ))}
            {r.pending.approvals.map((a) => (
              <div key={a.id} className="text-ink-3">
                Approval pending: {a.action.replace(/_/g, " ").toLowerCase()} — {a.reason}
              </div>
            ))}
            {!r.pending.expenses.length && !r.pending.transfersIn.length && !r.pending.approvals.length ? <p className="text-ink-4">Nothing waiting.</p> : null}
          </Panel>
          <Panel title="Keyed today for an earlier day" icon={<HistoryIcon size={17} />} description="These changed an earlier close, and so today's opening" className="space-y-1.5 text-sm">
            {r.lateEntries.length === 0 ? (
              <p className="text-ink-4">None.</p>
            ) : (
              r.lateEntries.map((l) => (
                <div key={l.entryNo} className="flex justify-between gap-3">
                  <span className="text-ink-3">
                    {l.entryNo} dated {l.entryDate} · {l.memo ?? l.refEntity}
                  </span>
                  <span className="g-metric">{l.cashCents ? signed(l.cashCents) : "no cash"}</span>
                </div>
              ))
            )}
          </Panel>
        </div>
      ) : null}

      {r ? (
        <TableCard
          title="Every drawer movement"
          icon={<SearchIcon size={17} />}
          description={`Card clearing unsettled: ${fmt(r.outstanding.cardClearingCents)}${r.outstanding.oldestUnsettledCardDate ? ` since ${r.outstanding.oldestUnsettledCardDate}` : ""} · Cash sent out, not yet received: ${fmt(r.outstanding.cashInTransitOutCents)}`}
        >
          {r.cashMovements.length === 0 ? (
            <EmptyBlock title="No cash moved in the drawer" />
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>Entry</th>
                  <th>What</th>
                  <th>Keyed by</th>
                  <th>At</th>
                  <th className="!text-right">In / out</th>
                </tr>
              </thead>
              <tbody>
                {r.cashMovements.map((m) => (
                  <tr key={m.entryId}>
                    <td className="font-mono text-xs">{m.entryNo}</td>
                    <td className="text-ink-2">
                      {m.memo ?? m.refNo ?? m.refEntity}
                      {m.backdated ? <span className="ml-2 text-[11px] text-amber-700">keyed on another day</span> : null}
                      {m.reversal ? <span className="ml-2 text-[11px] text-ink-4">reversal</span> : null}
                    </td>
                    <td className="text-ink-3">{m.createdBy ?? "—"}</td>
                    <td className="text-ink-3">{new Date(m.createdAt).toLocaleTimeString()}</td>
                    <td className={`!text-right num-tabular ${m.cents < 0 ? "text-rose-700" : "text-emerald-700"}`}>{signed(m.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------- unclosed days */

export function UnclosedPanel({ branchId, onPick }: { branchId: string; onPick: (date: string) => void }) {
  const q = useQuery({
    enabled: !!branchId,
    queryKey: ["day-unclosed", branchId],
    queryFn: () =>
      api<{ from: string; to: string; days: { date: string; status: string; entries: number; cashMovementCents: number }[] }>(
        `/api/v1/day-closings/unclosed?branchId=${encodeURIComponent(branchId)}`
      ),
  });
  return (
    <TableCard
      title="Days with activity that were not closed"
      icon={<AlertCircleIcon size={17} />}
      description={q.data ? `${q.data.from} to ${q.data.to}. Nobody counted these drawers — a shortage on them is only found here.` : undefined}
    >
      {q.isLoading ? (
        <TableSkeleton rows={4} cols={4} />
      ) : (q.data?.days.length ?? 0) === 0 ? (
        <EmptyBlock icon={<ClipboardCheckIcon size={22} />} title="Every day with activity is closed" />
      ) : (
        <table className="g-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>State</th>
              <th className="!text-right">Entries</th>
              <th className="!text-right">Cash moved</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data!.days.map((d) => (
              <tr key={d.date}>
                <td className="g-metric text-xs">{d.date}</td>
                <td>
                  <StatusPill status={d.status === "REOPENED" ? "REOPENED" : "OPEN"} />
                </td>
                <td className="!text-right num-tabular">{d.entries}</td>
                <td className="!text-right num-tabular">{fmt(d.cashMovementCents)}</td>
                <td className="!text-right">
                  <button type="button" onClick={() => onPick(d.date)} className="g-btn g-btn-secondary h-8 px-3 text-xs">
                    Close it
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

/* ---------------------------------------------------------- variance */

type Variance = {
  from: string;
  to: string;
  days: number;
  daysShort: number;
  daysOver: number;
  shortCents: number;
  overCents: number;
  netCents: number;
  correctedCents: number;
  rows: { id: string; branchId: string; date: string; expectedCents: number; actualCents: number; differenceCents: number; reason: string | null; closedBy: string | null; cardDifferenceCents: number | null }[];
  byCloser: { closedBy: string; days: number; shortCents: number; overCents: number }[];
};

export function VariancePanel({ branchId, today, branchName }: { branchId: string; today: string; branchName: (id: string) => string }) {
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const q = useQuery({
    queryKey: ["day-variance", branchId, from, to],
    queryFn: () => api<Variance>(`/api/v1/day-closings/variance?from=${from}&to=${to}${branchId ? `&branchId=${encodeURIComponent(branchId)}` : ""}`),
  });
  const v = q.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
        From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={controlSmClass} />
        to <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={controlSmClass} />
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ["Days closed", v ? String(v.days) : "—"],
          ["Short", v ? `${fmt(v.shortCents)} on ${v.daysShort} days` : "—"],
          ["Over", v ? `${fmt(v.overCents)} on ${v.daysOver} days` : "—"],
          ["Net", v ? signed(v.netCents) : "—"],
        ].map(([label, value]) => (
          <Panel key={label} title={label}>
            <div className="g-metric text-lg text-ink">{value}</div>
          </Panel>
        ))}
      </div>
      {v && v.byCloser.length ? (
        <TableCard title="By who closed" icon={<HistoryIcon size={17} />} description="The same person short again and again is a pattern, not a miscount">
          <table className="g-table">
            <thead>
              <tr>
                <th>Closed by</th>
                <th className="!text-right">Days</th>
                <th className="!text-right">Short</th>
                <th className="!text-right">Over</th>
              </tr>
            </thead>
            <tbody>
              {v.byCloser.map((c) => (
                <tr key={c.closedBy}>
                  <td className="text-ink">{c.closedBy}</td>
                  <td className="!text-right num-tabular">{c.days}</td>
                  <td className="!text-right num-tabular text-rose-700">{c.shortCents ? fmt(c.shortCents) : "—"}</td>
                  <td className="!text-right num-tabular text-amber-700">{c.overCents ? fmt(c.overCents) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      ) : null}
      <TableCard title="Every difference" icon={<ClipboardCheckIcon size={17} />}>
        {q.isLoading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : !v || v.rows.filter((r) => r.differenceCents || r.cardDifferenceCents).length === 0 ? (
          <EmptyBlock title="No differences in this period" description="Every closed day counted exactly what the books expected." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Branch</th>
                <th className="!text-right">Expected</th>
                <th className="!text-right">Counted</th>
                <th className="!text-right">Cash diff.</th>
                <th className="!text-right">Card diff.</th>
                <th>Explanation</th>
                <th>Closed by</th>
              </tr>
            </thead>
            <tbody>
              {v.rows
                .filter((r) => r.differenceCents || r.cardDifferenceCents)
                .map((r) => (
                  <tr key={r.id}>
                    <td className="g-metric text-xs">{r.date}</td>
                    <td className="text-ink-3">{branchName(r.branchId)}</td>
                    <td className="!text-right num-tabular">{fmt(r.expectedCents)}</td>
                    <td className="!text-right num-tabular">{fmt(r.actualCents)}</td>
                    <td className={`!text-right num-tabular ${r.differenceCents < 0 ? "text-rose-700" : r.differenceCents > 0 ? "text-amber-700" : ""}`}>{r.differenceCents ? signed(r.differenceCents) : "—"}</td>
                    <td className="!text-right num-tabular">{r.cardDifferenceCents ? signed(r.cardDifferenceCents) : "—"}</td>
                    <td className="text-ink-3">{r.reason ?? "—"}</td>
                    <td className="text-ink-3">{r.closedBy ?? "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </div>
  );
}

/* ---------------------------------------------------------- all branches */

type Summary = {
  date: string;
  branches: { branchId: string; branchName: string; status: string; expectedCents: number; actualCents: number | null; differenceCents: number | null; salesCents: number; expensesCents: number; cardCents: number; checksPassed: boolean; failing: string[]; goldClosingMg: number }[];
  totals: { salesCents: number; expensesCents: number; differenceCents: number; closed: number; open: number };
};

export function SummaryPanel({ date, onPick }: { date: string; onPick: (branchId: string) => void }) {
  const q = useQuery({ queryKey: ["day-summary", date], queryFn: () => api<Summary>(`/api/v1/day-closings/summary?date=${date}`) });
  const s = q.data;
  return (
    <TableCard
      title={`Every branch on ${date}`}
      icon={<StoreIcon size={17} />}
      description={s ? `${s.totals.closed} closed, ${s.totals.open} still open · sales ${fmt(s.totals.salesCents)} · net difference ${signed(s.totals.differenceCents)}` : undefined}
    >
      {q.isLoading ? (
        <TableSkeleton rows={3} cols={6} />
      ) : !s || s.branches.length === 0 ? (
        <EmptyBlock title="No branches" />
      ) : (
        <table className="g-table">
          <thead>
            <tr>
              <th>Branch</th>
              <th>Status</th>
              <th className="!text-right">Sales</th>
              <th className="!text-right">Card</th>
              <th className="!text-right">Expenses</th>
              <th className="!text-right">Expected cash</th>
              <th className="!text-right">Counted</th>
              <th className="!text-right">Difference</th>
              <th>Checks</th>
              <th className="!text-right">Gold held</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.branches.map((b) => (
              <tr key={b.branchId}>
                <td className="font-medium text-ink">{b.branchName}</td>
                <td>
                  <StatusPill status={b.status} />
                </td>
                <td className="!text-right num-tabular">{fmt(b.salesCents)}</td>
                <td className="!text-right num-tabular">{fmt(b.cardCents)}</td>
                <td className="!text-right num-tabular">{fmt(b.expensesCents)}</td>
                <td className="!text-right num-tabular">{fmt(b.expectedCents)}</td>
                <td className="!text-right num-tabular">{b.actualCents === null ? "—" : fmt(b.actualCents)}</td>
                <td className={`!text-right num-tabular ${b.differenceCents ? "text-rose-700" : ""}`}>{b.differenceCents === null ? "—" : signed(b.differenceCents)}</td>
                <td className={b.checksPassed ? "text-emerald-700" : "text-rose-700"}>{b.checksPassed ? "All pass" : `${b.failing.length} failing`}</td>
                <td className="!text-right num-tabular">{(b.goldClosingMg / 1000).toFixed(3)} g</td>
                <td className="!text-right">
                  <button type="button" onClick={() => onPick(b.branchId)} className="g-btn g-btn-secondary h-8 px-3 text-xs">
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
