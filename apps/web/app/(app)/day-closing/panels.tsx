"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { Card, CardHead, Empty, RowsSkeleton, ShareBar, th, thead, tr } from "@/components/console-kit";
import { AlertCircleIcon, CheckCircleIcon, ClipboardCheckIcon, HistoryIcon, SearchIcon, StoreIcon } from "@/components/icons";
import { api } from "@/lib/api";

export const fmt = (c: number) => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const signed = (c: number) => `${c > 0 ? "+" : c < 0 ? "−" : ""}${fmt(Math.abs(c))}`;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const dayInputCls =
  "g-metric h-8 rounded-lg bg-paper px-2.5 text-[12.5px] text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12)] focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_3px_rgba(205,168,83,0.24)]";

/** Shortage red, overage amber, square green. */
export const diffTone = (c: number | null | undefined) =>
  c == null ? "text-ink-5" : c < 0 ? "text-rose-700" : c > 0 ? "text-amber-700" : "text-emerald-700";

export function DayChip({ status }: { status: string }) {
  const m =
    status === "CLOSED"
      ? { t: "Closed", c: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25", d: "bg-emerald-500" }
      : status === "REOPENED"
        ? { t: "Re-opened", c: "bg-amber-500/10 text-amber-800 ring-amber-500/25", d: "bg-amber-500" }
        : { t: "Open", c: "bg-sky-500/10 text-sky-800 ring-sky-500/25", d: "bg-sky-500" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset", m.c)}>
      <span className={cn("size-1.5 rounded-full", m.d)} />
      {m.t}
    </span>
  );
}

/** Small figures strip used across the panels. */
function Figures({ items }: { items: { k: string; v: ReactNode; tone?: string; sub?: ReactNode }[] }) {
  return (
    <div className={cn("grid grid-cols-2 gap-px border-b border-ink/[0.06] bg-ink/[0.05]", items.length >= 4 ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
      {items.map((it) => (
        <div key={it.k} className="bg-paper px-4 py-2">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{it.k}</div>
          <div className={cn("g-metric mt-0.5 truncate text-[15px] font-semibold", it.tone ?? "text-ink")}>{it.v}</div>
          {it.sub ? <div className="truncate text-[10.5px] text-ink-5">{it.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}

const btnSm = "inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[11px] font-semibold text-ink-3 ring-1 ring-inset ring-ink/10 transition-colors hover:bg-bone hover:text-ink";

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
  const movIn = (r?.cashMovements ?? []).filter((m) => m.cents > 0).reduce((a, m) => a + m.cents, 0);
  const movOut = (r?.cashMovements ?? []).filter((m) => m.cents < 0).reduce((a, m) => a + m.cents, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHead icon={SearchIcon} title="Find missing amounts" sub="Enter the counted cash; everything that could explain the difference is listed below" />
        <div className="grid grid-cols-2 gap-px bg-ink/[0.05] sm:grid-cols-4">
          <label className="bg-paper px-4 py-2.5">
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">Counted cash · LKR</span>
            <input type="number" step="any" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="0.00" className={cn(dayInputCls, "mt-1 w-full")} />
          </label>
          <div className="bg-paper px-4 py-2.5">
            <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">Expected</div>
            <div className="g-metric mt-1 text-[17px] font-semibold text-ink">{r ? fmt(r.expectedCents) : "—"}</div>
          </div>
          <div className="bg-paper px-4 py-2.5">
            <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">Difference</div>
            <div className={cn("g-metric mt-1 text-[17px] font-semibold", diffTone(r?.differenceCents))}>
              {r?.differenceCents === null || r?.differenceCents === undefined ? "—" : signed(r.differenceCents)}
            </div>
          </div>
          <div className="bg-paper px-4 py-2.5">
            <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">Leads found</div>
            <div className="g-metric mt-1 text-[17px] font-semibold text-ink">
              {r ? r.suspects.length + r.failingChecks.length + r.documentIssues.length + r.pending.expenses.length + r.pending.transfersIn.length + r.lateEntries.length : "—"}
            </div>
          </div>
        </div>
      </Card>

      {q.isLoading ? (
        <Card>
          <RowsSkeleton rows={5} />
        </Card>
      ) : null}
      {q.isError ? (
        <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 px-4 py-2.5 text-[12px] text-rose-900 ring-1 ring-inset ring-rose-500/25">
          <AlertCircleIcon size={14} />
          Could not investigate: {(q.error as Error).message}
        </div>
      ) : null}
      {nothing ? (
        <div className="flex items-center gap-2.5 rounded-xl bg-emerald-600/10 px-4 py-2.5 text-[12px] text-emerald-900 ring-1 ring-inset ring-emerald-600/25">
          <CheckCircleIcon size={15} />
          <span>
            <span className="font-semibold">Nothing out of place.</span> Every check passes, every document is posted as it says, and nothing is waiting.
            {r?.differenceCents ? " If the count is still off, recount the drawer." : ""}
          </span>
        </div>
      ) : null}

      {r && r.suspects.length ? (
        <Card>
          <CardHead icon={AlertCircleIcon} title="Likely explanations" sub="Movements whose size matches the difference exactly" />
          <table className="w-full text-[12.5px]">
            <thead className={thead}>
              <tr>
                <th className={cn(th, "pl-4")}>Why it could be this</th>
                <th className={th}>Entries</th>
                <th className={cn(th, "pr-4 text-right")}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {r.suspects.map((s, i) => (
                <tr key={i} className={tr}>
                  <td className="relative py-2 pl-4 pr-2 text-ink-2">
                    <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-gold" aria-hidden />
                    {s.explanation}
                  </td>
                  <td className="g-metric px-2 text-[11px] text-ink-3">{s.items.join(" + ")}</td>
                  <td className="g-metric px-2 pr-4 text-right font-semibold text-ink">{fmt(s.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {r && r.failingChecks.length ? (
        <Card>
          <CardHead icon={ClipboardCheckIcon} title="Checks that do not agree" sub="Books vs documents · money in LKR, gold in fine mg" />
          <table className="w-full text-[12.5px]">
            <thead className={thead}>
              <tr>
                <th className={cn(th, "pl-4")}>Check</th>
                <th className={cn(th, "text-right")}>Documents</th>
                <th className={cn(th, "text-right")}>Ledger</th>
                <th className={cn(th, "pr-4 text-right")}>Out by</th>
              </tr>
            </thead>
            <tbody>
              {r.failingChecks.map((c) => {
                const gold = c.id.startsWith("gold_");
                const v = (n: number) => (gold ? `${n.toLocaleString("en-US")} mg` : fmt(n));
                return (
                  <tr key={c.id} className={tr}>
                    <td className="relative py-2 pl-4 pr-2">
                      <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-rose-500" aria-hidden />
                      <div className="font-semibold text-ink">{c.label}</div>
                      {c.detail.map((d) => (
                        <div key={d} className="g-metric text-[10.5px] text-ink-4">
                          {d}
                        </div>
                      ))}
                    </td>
                    <td className="g-metric px-2 text-right text-ink-2">{v(c.expected)}</td>
                    <td className="g-metric px-2 text-right text-ink-2">{v(c.actual)}</td>
                    <td className="g-metric px-2 pr-4 text-right font-semibold text-rose-700">{v(c.difference)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : null}

      {r && r.documentIssues.length ? (
        <Card>
          <CardHead icon={AlertCircleIcon} title="Documents not posted as they say" sub="Each one is part of a failing check" />
          <table className="w-full text-[12.5px]">
            <thead className={thead}>
              <tr>
                <th className={cn(th, "pl-4")}>Document</th>
                <th className={th}>Problem</th>
                <th className={cn(th, "text-right")}>Document</th>
                <th className={cn(th, "pr-4 text-right")}>Ledger</th>
              </tr>
            </thead>
            <tbody>
              {r.documentIssues.map((d, i) => (
                <tr key={`${d.documentId}-${i}`} className={tr}>
                  <td className="py-2 pl-4 pr-2">
                    {DOC_LINK[d.kind] ? (
                      <Link className="g-metric font-semibold text-gold-deep hover:underline" href={DOC_LINK[d.kind]!(d.documentId)}>
                        {d.number}
                      </Link>
                    ) : (
                      <span className="g-metric font-semibold">{d.number}</span>
                    )}
                    <div className="text-[10.5px] capitalize text-ink-4">{d.kind.replace(/_/g, " ")}</div>
                  </td>
                  <td className="px-2 text-ink-2">{d.problem}</td>
                  <td className="g-metric px-2 text-right">{fmt(d.documentCents)}</td>
                  <td className="g-metric px-2 pr-4 text-right">{d.ledgerCents === null ? "—" : fmt(d.ledgerCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {r && (r.pending.expenses.length || r.pending.transfersIn.length || r.lateEntries.length) ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHead icon={HistoryIcon} title="Waiting, not yet in the books" sub="Approvals and transfers still in flight" />
            <ul className="divide-y divide-ink/[0.05] text-[12px]">
              {r.pending.expenses.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="text-ink-3">
                    <span className="g-metric font-semibold text-ink">{e.number}</span> expense awaiting approval · {e.description}
                  </span>
                  <span className="g-metric font-semibold">{fmt(e.amountCents)}</span>
                </li>
              ))}
              {r.pending.transfersIn.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="text-ink-3">
                    <span className="g-metric font-semibold text-ink">{t.number}</span> sent {t.sentOn}, not received here
                  </span>
                  <span className="g-metric font-semibold">{fmt(t.amountCents)}</span>
                </li>
              ))}
              {!r.pending.expenses.length && !r.pending.transfersIn.length ? <li className="px-4 py-3 text-ink-4">Nothing waiting.</li> : null}
            </ul>
          </Card>
          <Card>
            <CardHead icon={HistoryIcon} title="Keyed today for an earlier day" sub="These changed an earlier close, and so today's opening" />
            <ul className="divide-y divide-ink/[0.05] text-[12px]">
              {r.lateEntries.length === 0 ? (
                <li className="px-4 py-3 text-ink-4">None.</li>
              ) : (
                r.lateEntries.map((l) => (
                  <li key={l.entryNo} className="flex items-center justify-between gap-3 px-4 py-2">
                    <span className="text-ink-3">
                      <span className="g-metric font-semibold text-ink">{l.entryNo}</span> dated {l.entryDate} · {l.memo ?? l.refEntity}
                    </span>
                    <span className={cn("g-metric font-semibold", diffTone(l.cashCents))}>{l.cashCents ? signed(l.cashCents) : "no cash"}</span>
                  </li>
                ))
              )}
            </ul>
          </Card>
        </div>
      ) : null}

      {r ? (
        <Card>
          <CardHead
            icon={SearchIcon}
            title="Every drawer movement"
            sub={`Card clearing unsettled ${fmt(r.outstanding.cardClearingCents)}${r.outstanding.oldestUnsettledCardDate ? ` since ${r.outstanding.oldestUnsettledCardDate}` : ""} · cash sent out, not yet received ${fmt(r.outstanding.cashInTransitOutCents)}`}
            action={
              <span className="flex gap-3 text-[11px]">
                <span className="g-metric font-semibold text-emerald-700">+{fmt(movIn)}</span>
                <span className="g-metric font-semibold text-rose-700">{signed(movOut)}</span>
              </span>
            }
          />
          {r.cashMovements.length === 0 ? (
            <Empty icon={SearchIcon} title="No cash moved in the drawer" desc="Nothing touched the drawer on this day." />
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-[12.5px]">
                <thead className={thead}>
                  <tr>
                    <th className={cn(th, "pl-4")}>Entry</th>
                    <th className={th}>What</th>
                    <th className={th}>Keyed by</th>
                    <th className={th}>At</th>
                    <th className={cn(th, "pr-4 text-right")}>In / out</th>
                  </tr>
                </thead>
                <tbody>
                  {r.cashMovements.map((m) => (
                    <tr key={m.entryId} className={tr}>
                      <td className="g-metric relative py-1.5 pl-4 pr-2 text-[11.5px]">
                        <span className={cn("absolute inset-y-1.5 left-0 w-[3px] rounded-r-full", m.cents < 0 ? "bg-rose-500" : "bg-emerald-500")} aria-hidden />
                        {m.entryNo}
                      </td>
                      <td className="px-2 text-ink-2">
                        {m.memo ?? m.refNo ?? m.refEntity}
                        {m.backdated ? <span className="ml-2 rounded-full bg-amber-500/10 px-1.5 text-[10px] font-semibold text-amber-800">keyed on another day</span> : null}
                        {m.reversal ? <span className="ml-2 rounded-full bg-ink/[0.05] px-1.5 text-[10px] font-semibold text-ink-4">reversal</span> : null}
                      </td>
                      <td className="px-2 text-ink-3">{m.createdBy ?? "—"}</td>
                      <td className="g-metric px-2 text-[11px] text-ink-4">{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                      <td className={cn("g-metric px-2 pr-4 text-right font-semibold", m.cents < 0 ? "text-rose-700" : "text-emerald-700")}>{signed(m.cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
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
  const days = q.data?.days ?? [];
  const moved = days.reduce((a, d) => a + Math.abs(d.cashMovementCents), 0);
  const maxMoved = Math.max(1, ...days.map((d) => Math.abs(d.cashMovementCents)));
  return (
    <Card>
      <CardHead
        icon={AlertCircleIcon}
        title="Days with activity that were not closed"
        sub={q.data ? `${q.data.from} to ${q.data.to} · nobody counted these drawers, so a shortage on them is only found here` : undefined}
      />
      {q.data && days.length ? (
        <Figures
          items={[
            { k: "Days open", v: days.length, tone: "text-amber-700" },
            { k: "Entries", v: days.reduce((a, d) => a + d.entries, 0) },
            { k: "Cash moved", v: fmt(moved) },
            { k: "Oldest", v: days[days.length - 1]?.date ?? "—", sub: days[0] ? `newest ${days[0].date}` : undefined },
          ]}
        />
      ) : null}
      {q.isLoading ? (
        <RowsSkeleton rows={4} />
      ) : days.length === 0 ? (
        <Empty icon={ClipboardCheckIcon} title="Every day with activity is closed" desc="Nothing left uncounted." />
      ) : (
        <table className="w-full text-[12.5px]">
          <thead className={thead}>
            <tr>
              <th className={cn(th, "pl-4")}>Date</th>
              <th className={th}>State</th>
              <th className={cn(th, "text-right")}>Entries</th>
              <th className={cn(th, "w-[220px]")}>Cash moved</th>
              <th className={cn(th, "pr-4")} />
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date} className={tr}>
                <td className="g-metric py-1.5 pl-4 pr-2 font-semibold text-ink">{d.date}</td>
                <td className="px-2">
                  <DayChip status={d.status === "REOPENED" ? "REOPENED" : "OPEN"} />
                </td>
                <td className="g-metric px-2 text-right">{d.entries}</td>
                <td className="px-2">
                  <div className="flex items-center gap-2">
                    <ShareBar value={(Math.abs(d.cashMovementCents) / maxMoved) * 100} className="flex-1" />
                    <span className="g-metric w-[88px] text-right">{fmt(d.cashMovementCents)}</span>
                  </div>
                </td>
                <td className="py-1.5 pl-2 pr-4 text-right">
                  <button type="button" onClick={() => onPick(d.date)} className="inline-flex h-7 items-center rounded-md bg-void px-2.5 text-[11px] font-semibold text-gold-light">
                    Close it
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
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
  const diffRows = (v?.rows ?? []).filter((r) => r.differenceCents || r.cardDifferenceCents);
  const exact = v ? v.days - v.daysShort - v.daysOver : 0;
  const maxCloser = Math.max(1, ...(v?.byCloser ?? []).map((c) => c.shortCents + c.overCents));
  return (
    <div className="space-y-4">
      <Card>
        <CardHead
          icon={HistoryIcon}
          title="Shortages & overages"
          sub="How closely each counted drawer matched the books"
          action={
            <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-4">
              {[7, 30, 90].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setFrom(addDays(today, -n));
                    setTo(today);
                  }}
                  className={cn("h-7 rounded-full px-2.5 font-semibold", from === addDays(today, -n) && to === today ? "bg-void text-gold-light" : "ring-1 ring-inset ring-ink/10 hover:bg-bone")}
                >
                  {n}d
                </button>
              ))}
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={dayInputCls} />
              to
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={dayInputCls} />
            </span>
          }
        />
        <Figures
          items={[
            { k: "Days closed", v: v ? v.days : "—", sub: v ? `${exact} counted exactly` : undefined },
            { k: "Short", v: v ? fmt(v.shortCents) : "—", tone: "text-rose-700", sub: v ? `on ${v.daysShort} days` : undefined },
            { k: "Over", v: v ? fmt(v.overCents) : "—", tone: "text-amber-700", sub: v ? `on ${v.daysOver} days` : undefined },
            { k: "Net", v: v ? signed(v.netCents) : "—", tone: diffTone(v?.netCents), sub: v?.correctedCents ? `${fmt(v.correctedCents)} posted` : undefined },
          ]}
        />
        {v && v.days ? (
          <div className="px-4 py-2.5">
            <div className="flex h-2 overflow-hidden rounded-full bg-ink/[0.06]">
              <div className="bg-emerald-500" style={{ width: `${(exact / v.days) * 100}%` }} title="Exact" />
              <div className="bg-amber-400" style={{ width: `${(v.daysOver / v.days) * 100}%` }} title="Over" />
              <div className="bg-rose-500" style={{ width: `${(v.daysShort / v.days) * 100}%` }} title="Short" />
            </div>
            <div className="mt-1 flex gap-3 text-[10px] text-ink-5">
              <span>
                <span className="mr-1 inline-block size-2 rounded-sm bg-emerald-500" />
                Exact {Math.round((exact / v.days) * 100)}%
              </span>
              <span>
                <span className="mr-1 inline-block size-2 rounded-sm bg-amber-400" />
                Over
              </span>
              <span>
                <span className="mr-1 inline-block size-2 rounded-sm bg-rose-500" />
                Short
              </span>
            </div>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHead icon={ClipboardCheckIcon} title="Every difference" sub={`${diffRows.length} day${diffRows.length === 1 ? "" : "s"} off in this period`} />
          {q.isLoading ? (
            <RowsSkeleton rows={4} />
          ) : diffRows.length === 0 ? (
            <Empty icon={CheckCircleIcon} title="No differences in this period" desc="Every closed day counted exactly what the books expected." />
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[760px] text-[12.5px]">
                <thead className={thead}>
                  <tr>
                    <th className={cn(th, "pl-4")}>Date</th>
                    <th className={th}>Branch</th>
                    <th className={cn(th, "text-right")}>Expected</th>
                    <th className={cn(th, "text-right")}>Counted</th>
                    <th className={cn(th, "text-right")}>Cash</th>
                    <th className={cn(th, "text-right")}>Card</th>
                    <th className={th}>Explanation</th>
                    <th className={cn(th, "pr-4")}>By</th>
                  </tr>
                </thead>
                <tbody>
                  {diffRows.map((r) => (
                    <tr key={r.id} className={tr}>
                      <td className="g-metric relative py-1.5 pl-4 pr-2 text-[11.5px]">
                        <span className={cn("absolute inset-y-1.5 left-0 w-[3px] rounded-r-full", r.differenceCents < 0 ? "bg-rose-500" : "bg-amber-400")} aria-hidden />
                        {r.date}
                      </td>
                      <td className="px-2 text-ink-3">{branchName(r.branchId)}</td>
                      <td className="g-metric px-2 text-right text-ink-3">{fmt(r.expectedCents)}</td>
                      <td className="g-metric px-2 text-right text-ink-3">{fmt(r.actualCents)}</td>
                      <td className={cn("g-metric px-2 text-right font-semibold", diffTone(r.differenceCents))}>{r.differenceCents ? signed(r.differenceCents) : "—"}</td>
                      <td className={cn("g-metric px-2 text-right", diffTone(r.cardDifferenceCents))}>{r.cardDifferenceCents ? signed(r.cardDifferenceCents) : "—"}</td>
                      <td className="max-w-[220px] truncate px-2 text-ink-3" title={r.reason ?? undefined}>
                        {r.reason ?? "—"}
                      </td>
                      <td className="px-2 pr-4 text-ink-3">{r.closedBy ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card className="xl:col-span-4">
          <CardHead icon={HistoryIcon} title="By who closed" sub="The same person short again and again is a pattern" />
          {!v || v.byCloser.length === 0 ? (
            <p className="px-4 py-3 text-[12px] text-ink-4">No closes in this period.</p>
          ) : (
            <ul className="space-y-2.5 p-4">
              {v.byCloser.map((c) => (
                <li key={c.closedBy}>
                  <div className="flex items-baseline justify-between gap-2 text-[12px]">
                    <span className="truncate font-semibold text-ink">{c.closedBy}</span>
                    <span className="g-metric text-[10.5px] text-ink-5">{c.days} days</span>
                  </div>
                  <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                    <div className="bg-rose-500" style={{ width: `${(c.shortCents / maxCloser) * 100}%` }} />
                    <div className="bg-amber-400" style={{ width: `${(c.overCents / maxCloser) * 100}%` }} />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[10.5px]">
                    <span className="g-metric text-rose-700">{c.shortCents ? `short ${fmt(c.shortCents)}` : "never short"}</span>
                    <span className="g-metric text-amber-700">{c.overCents ? `over ${fmt(c.overCents)}` : ""}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
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
    <Card>
      <CardHead icon={StoreIcon} title={`Every branch on ${date}`} sub="Each branch is counted on its own" />
      {s ? (
        <Figures
          items={[
            { k: "Closed", v: `${s.totals.closed} / ${s.totals.closed + s.totals.open}`, tone: s.totals.open ? "text-amber-700" : "text-emerald-700", sub: s.totals.open ? `${s.totals.open} still open` : "all closed" },
            { k: "Sales", v: fmt(s.totals.salesCents) },
            { k: "Expenses", v: fmt(s.totals.expensesCents) },
            { k: "Net difference", v: signed(s.totals.differenceCents), tone: diffTone(s.totals.differenceCents) },
          ]}
        />
      ) : null}
      {q.isLoading ? (
        <RowsSkeleton rows={3} />
      ) : !s || s.branches.length === 0 ? (
        <Empty icon={StoreIcon} title="No branches" desc="Nothing to compare yet." />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[980px] text-[12.5px]">
            <thead className={thead}>
              <tr>
                <th className={cn(th, "pl-4")}>Branch</th>
                <th className={th}>Status</th>
                <th className={cn(th, "text-right")}>Sales</th>
                <th className={cn(th, "text-right")}>Card</th>
                <th className={cn(th, "text-right")}>Expenses</th>
                <th className={cn(th, "text-right")}>Expected</th>
                <th className={cn(th, "text-right")}>Counted</th>
                <th className={cn(th, "text-right")}>Difference</th>
                <th className={th}>Checks</th>
                <th className={cn(th, "text-right")}>Gold held</th>
                <th className={cn(th, "pr-4")} />
              </tr>
            </thead>
            <tbody>
              {s.branches.map((b) => (
                <tr key={b.branchId} className={tr}>
                  <td className="py-1.5 pl-4 pr-2 font-semibold text-ink">{b.branchName}</td>
                  <td className="px-2">
                    <DayChip status={b.status} />
                  </td>
                  <td className="g-metric px-2 text-right">{fmt(b.salesCents)}</td>
                  <td className="g-metric px-2 text-right text-ink-3">{fmt(b.cardCents)}</td>
                  <td className="g-metric px-2 text-right text-ink-3">{fmt(b.expensesCents)}</td>
                  <td className="g-metric px-2 text-right">{fmt(b.expectedCents)}</td>
                  <td className="g-metric px-2 text-right">{b.actualCents === null ? "—" : fmt(b.actualCents)}</td>
                  <td className={cn("g-metric px-2 text-right font-semibold", diffTone(b.differenceCents))}>{b.differenceCents === null ? "—" : signed(b.differenceCents)}</td>
                  <td className="px-2">
                    <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold", b.checksPassed ? "text-emerald-700" : "text-rose-700")} title={b.failing.join(", ")}>
                      {b.checksPassed ? <CheckCircleIcon size={11} /> : <AlertCircleIcon size={11} />}
                      {b.checksPassed ? "All pass" : `${b.failing.length} failing`}
                    </span>
                  </td>
                  <td className="g-metric px-2 text-right">{(b.goldClosingMg / 1000).toFixed(3)} g</td>
                  <td className="py-1.5 pl-2 pr-4 text-right">
                    <button type="button" onClick={() => onPick(b.branchId)} className={btnSm}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
