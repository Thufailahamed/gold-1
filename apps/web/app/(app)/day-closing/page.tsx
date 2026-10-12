"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission, LKR_DENOMINATIONS } from "@goldos/shared";
import { Modal, Page, Skeleton, controlClass } from "@/components/ui";
import { Card, CardHead, Empty, GoldHero, HeroBadge, RowsSkeleton, heroGhost, th, thead, tr } from "@/components/console-kit";
import { cn } from "@/lib/cn";
import {
  AlertCircleIcon,
  BanknoteIcon,
  ChevronRightIcon,
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
import { DayChip, InvestigatePanel, SummaryPanel, UnclosedPanel, VariancePanel, dayInputCls, diffTone, fmt, signed } from "./panels";
import { AutoCloseModal, surveyParams, type AutoCloseResult, type DaySurvey } from "./auto-close";

type CashLine = { label: string; refEntity: string; cents: number };
type CashGroup = { totalCents: number; unclassifiedCents: number; unclassifiedNetCents?: number; lines: CashLine[] };

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

const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A labelled money line; `total` is the bold rule-above result. */
function Line({ k, cents, total, tone, sub }: { k: string; cents: number | null; total?: boolean; tone?: string; sub?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 px-4 py-1.5", total && "border-t border-ink/[0.08] bg-gold-pale/40 py-2")}>
      <span className={cn("text-[12px]", total ? "font-semibold text-ink" : "text-ink-3")}>
        {k}
        {sub ? <span className="ml-1.5 text-[10.5px] text-ink-5">{sub}</span> : null}
      </span>
      <span className={cn("g-metric", total ? "text-[15px] font-semibold" : "text-[12.5px]", tone ?? "text-ink")}>{cents === null ? "—" : fmt(cents)}</span>
    </div>
  );
}

function Banner({ tone, title, children, action }: { tone: "bad" | "warn"; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-2.5 text-[12px] ring-1 ring-inset",
        tone === "bad" ? "bg-rose-500/10 text-rose-900 ring-rose-500/25" : "bg-amber-500/10 text-amber-900 ring-amber-500/25"
      )}
    >
      <AlertCircleIcon size={14} className="shrink-0" />
      <span className="font-semibold">{title}</span>
      <span className="min-w-0 flex-1 opacity-80">{children}</span>
      {action}
    </div>
  );
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
  const [survey, setSurvey] = useState<{ result: AutoCloseResult; query: string } | null>(null);

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

  // Is this branch-day already closed? The preview is always live, so without
  // this the Close button stays armed and the server refuses at the last step.
  const dayStatus = useQuery({
    enabled: !!branchId,
    queryKey: ["day-closing-status", branchId, date],
    queryFn: () =>
      api<{ rows: Closing[] }>(`/api/v1/day-closings?branchId=${encodeURIComponent(branchId)}&from=${date}&to=${date}&limit=1`),
  });
  const alreadyClosed = dayStatus.data?.rows[0]?.status === "CLOSED";

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
  // The server gates on the NET unnamed movement (an error and its reversal
  // cancel), so the screen must too, or it blocks a close the server allows.
  const unclassified = r?.cashIn.unclassifiedNetCents ?? r?.cashIn.unclassifiedCents ?? 0;
  const canClose =
    !!r && !alreadyClosed && r.checks.passed && unclassified <= 0 && actualCents !== null && actualCents >= 0 && !Number.isNaN(actualCents) && (!needsReason || !!reason.trim());

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
      qc.invalidateQueries({ queryKey: ["day-closing-status"] });
      qc.invalidateQueries({ queryKey: ["day-unclosed"] });
      qc.invalidateQueries({ queryKey: ["day-summary"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not close"),
  });

  // Survey the whole day and, when nothing blocks it and the user may close,
  // close it with the counted cash. Readers get the survey without the close.
  const autoClose = useMutation({
    mutationFn: async () => {
      const query = surveyParams({ branchId, date, actualCents, cardCents, reason: needsReason ? reason : "" });
      const result = canManage
        ? await api<AutoCloseResult>("/api/v1/day-closings/auto-close", {
            method: "POST",
            body: JSON.stringify({
              branchId,
              date,
              actualCents: actualCents ?? undefined,
              differenceReason: needsReason && reason.trim() ? reason : undefined,
              denominations: useSheet
                ? Object.fromEntries(Object.entries(counts).filter(([, n]) => n !== "" && Number(n) > 0).map(([f, n]) => [f, Number(n)]))
                : undefined,
              cardTerminalCents: cardCents ?? undefined,
              postDifference: differenceCents ? postDifference : undefined,
            }),
          })
        : { closed: false, closingId: null, survey: await api<DaySurvey>(`/api/v1/day-closings/survey?${query}`) };
      return { result, query };
    },
    onSuccess: (data) => {
      setSurvey(data);
      if (data.result.closed) {
        toast.success(`Auto-closed ${date}`);
        setActual("");
        setCounts({});
        setCard("");
        setReason("");
        qc.invalidateQueries({ queryKey: ["day-closings"] });
        qc.invalidateQueries({ queryKey: ["day-closing-preview"] });
      qc.invalidateQueries({ queryKey: ["day-closing-status"] });
        qc.invalidateQueries({ queryKey: ["day-unclosed"] });
        qc.invalidateQueries({ queryKey: ["day-summary"] });
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Survey failed"),
  });

  const reopen = useMutation({
    mutationFn: () =>
      api(`/api/v1/day-closings/${reopenFor?.id}/reopen`, {
        method: "POST",
        body: JSON.stringify({ reason: reopenReason }),
      }),
    onSuccess: () => {
      toast.success("Re-opened");
      setReopenFor(null);
      setReopenReason("");
      qc.invalidateQueries({ queryKey: ["day-closings"] });
      qc.invalidateQueries({ queryKey: ["day-closing-status"] });
      qc.invalidateQueries({ queryKey: ["day-unclosed"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not re-open"),
  });

  const goldRows = useMemo(() => Object.values(r?.gold ?? {}).filter((g) => g.mg !== 0), [r]);
  const reportHref = `/day-closing/report?branchId=${encodeURIComponent(branchId)}&date=${date}`;
  const unclosedCount = unclosed.data?.days.length ?? 0;
  const passing = r ? r.checks.total - r.checks.failing.length : 0;
  const isToday = date === today();
  const verdict = !r
    ? { t: "Loading", tone: "muted" as const }
    : alreadyClosed
      ? { t: "Closed", tone: "good" as const }
      : !r.checks.passed || unclassified > 0
      ? { t: "Blocked", tone: "bad" as const }
      : actualCents === null
        ? { t: "Count the drawer", tone: "warn" as const }
        : needsReason && !reason.trim()
          ? { t: "Explain the difference", tone: "warn" as const }
          : { t: "Ready to close", tone: "good" as const };
  const moneyRows: [string, number, string][] = r
    ? [
        ["Sales", r.money.salesCents, "#059669"],
        ["Purchases", r.money.purchasesCents, "#EA580C"],
        ["Old gold bought", r.money.oldGoldCents, "#D97706"],
        ["Expenses", r.money.expensesCents, "#E11D48"],
        ["Customer payments", r.money.customerPaymentsCents, "#0284C7"],
        ["Supplier payments", r.money.supplierPaymentsCents, "#7C3AED"],
        ["Bank transactions", r.money.bankTransactionsCents, "#4F46E5"],
      ]
    : [];
  const maxMoney = Math.max(1, ...moneyRows.map(([, c]) => Math.abs(c)));
  const tabs: { key: TabKey; label: string; icon: typeof SearchIcon; count?: number }[] = [
    { key: "close", label: "Close the day", icon: ClipboardCheckIcon },
    { key: "investigate", label: "Find missing amounts", icon: SearchIcon },
    { key: "unclosed", label: "Days not closed", icon: AlertCircleIcon, count: unclosed.data ? unclosedCount : undefined },
    { key: "variance", label: "Shortages & overages", icon: HistoryIcon },
    { key: "summary", label: "All branches", icon: StoreIcon },
  ];
  const darkCtl =
    "h-8 rounded-lg bg-paper/[0.07] px-2.5 text-[12px] text-paper shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] focus:outline-none focus:shadow-[inset_0_0_0_1px_rgba(226,194,122,0.6)] [&>option]:text-ink [color-scheme:dark]";

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={ClipboardCheckIcon}
        title="Day"
        accent="closing"
        badge={<HeroBadge tone={verdict.tone}>{verdict.t}</HeroBadge>}
        sub={`${branchName(branchId)} · ${new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · money in LKR, gold in fine mg — the two never mix`}
        back={{ href: "/accounts", label: "Accounts" }}
        actions={
          <>
            <button type="button" className={heroGhost} disabled={autoClose.isPending || !me.data} onClick={() => autoClose.mutate()}>
              <ClipboardCheckIcon size={13} /> {autoClose.isPending ? "Surveying…" : canManage ? "Auto close" : "Run survey"}
            </button>
            <Link href={reportHref} className={heroGhost}>
              <PrinterIcon size={13} /> Report
            </Link>
            <button
              type="button"
              className={heroGhost}
              onClick={() =>
                downloadCsv(`/api/v1/day-closings/report.csv?branchId=${encodeURIComponent(branchId)}&date=${date}`, `day-close-${date}.csv`).catch((e: unknown) =>
                  toast.error(e instanceof Error ? e.message : "Export failed")
                )
              }
            >
              <FileDownIcon size={13} /> CSV
            </button>
          </>
        }
        stats={[
          { label: "Opening cash", value: r ? r.openingCents / 100 : undefined, format: (n) => fmt(n * 100), loading: preview.isLoading },
          { label: "Cash in", value: r ? r.cashIn.totalCents / 100 : undefined, format: (n) => fmt(n * 100), loading: preview.isLoading, tone: "good", sub: r ? `${r.cashIn.lines.length} lines` : undefined },
          { label: "Cash out", value: r ? r.cashOut.totalCents / 100 : undefined, format: (n) => fmt(n * 100), loading: preview.isLoading, tone: "bad", sub: r ? `${r.cashOut.lines.length} lines` : undefined },
          { label: "Expected closing", value: r ? expectedCents / 100 : undefined, format: (n) => fmt(n * 100), unit: "LKR", accent: true, loading: preview.isLoading },
          { label: "Counted", value: actualCents !== null ? actualCents / 100 : null, format: (n) => fmt(n * 100), sub: actualCents === null ? "not counted yet" : useSheet ? "by notes" : "entered" },
          {
            label: "Difference",
            value: differenceCents !== null ? differenceCents / 100 : null,
            format: (n) => signed(n * 100),
            tone: differenceCents === null ? undefined : differenceCents === 0 ? "good" : differenceCents < 0 ? "bad" : "warn",
            sub: differenceCents === null ? undefined : differenceCents === 0 ? "square" : differenceCents < 0 ? "short" : "over",
          },
          { label: "Checks", value: r ? passing : undefined, text: r ? `${passing}/${r.checks.total}` : undefined, loading: preview.isLoading, tone: r ? (r.checks.passed ? "good" : "bad") : undefined, sub: r ? (r.checks.passed ? "all pass" : `${r.checks.failing.length} failing`) : undefined },
          { label: "Days not closed", value: unclosed.data ? unclosedCount : undefined, loading: unclosed.isLoading, tone: unclosedCount ? "warn" : "good", sub: unclosedCount ? "earlier, with activity" : "none" },
        ]}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {(branches.data?.rows ?? []).length <= 6 ? (
            (branches.data?.rows ?? []).map((b) => (
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
          ) : (
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={darkCtl} aria-label="Branch">
              {(branches.data?.rows ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <span className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => setDate(shiftDay(date, -1))} aria-label="Previous day" className="flex size-8 items-center justify-center rounded-lg text-paper/60 ring-1 ring-inset ring-paper/12 hover:text-paper">
              <ChevronRightIcon size={13} className="rotate-180" />
            </button>
            <input type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} className={cn(darkCtl, "g-metric")} aria-label="Date" />
            <button
              type="button"
              onClick={() => setDate(shiftDay(date, 1))}
              disabled={isToday}
              aria-label="Next day"
              className="flex size-8 items-center justify-center rounded-lg text-paper/60 ring-1 ring-inset ring-paper/12 hover:text-paper disabled:opacity-30"
            >
              <ChevronRightIcon size={13} />
            </button>
            {!isToday ? (
              <button type="button" onClick={() => setDate(today())} className="h-8 rounded-lg px-2.5 text-[11.5px] font-semibold text-gold-light ring-1 ring-inset ring-gold/30 hover:bg-gold/10">
                Today
              </button>
            ) : null}
          </span>
        </div>
      </GoldHero>

      <div role="tablist" aria-label="Day closing" className="flex gap-1 overflow-x-auto rounded-xl bg-paper p-1 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07)] scrollbar-thin">
        {tabs.map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition-all",
                on ? "bg-void text-gold-light shadow-[0_6px_16px_-8px_rgba(6,42,34,0.8)]" : "text-ink-3 hover:bg-bone hover:text-ink"
              )}
            >
              <t.icon size={13} />
              {t.label}
              {t.count !== undefined ? (
                <span className={cn("g-metric rounded-full px-1.5 text-[10px]", on ? "bg-paper/10" : t.count ? "bg-amber-500/15 text-amber-800" : "bg-ink/[0.05] text-ink-4")}>{t.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>

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
            <Banner
              tone="bad"
              title="Cannot close this day"
              action={
                <button type="button" onClick={() => setTab("investigate")} className="rounded-md bg-void px-2.5 py-1 text-[11px] font-semibold text-gold-light">
                  Find out why
                </button>
              }
            >
              {passing} of {r.checks.total} checks pass · failing: <span className="g-metric">{r.checks.failing.join(", ")}</span>
            </Banner>
          ) : null}
          {unclassified > 0 ? (
            <Banner tone="warn" title={`${fmt(unclassified)} LKR unrecognised`}>
              Some cash movement doesn't belong to a known category, so the breakdown would be wrong. The close is blocked until it is named.
            </Banner>
          ) : null}
          {unclosedCount > 0 && isToday ? (
            <Banner
              tone="warn"
              title={`${unclosedCount} earlier day${unclosedCount === 1 ? "" : "s"} with activity not closed`}
              action={
                <button type="button" onClick={() => setTab("unclosed")} className="rounded-md px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ring-amber-600/30 hover:bg-amber-500/10">
                  Show
                </button>
              }
            >
              Nobody counted those drawers; a shortage on a skipped day is only found by closing it.
            </Banner>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-12">
            {/* ---------------- the drawer */}
            <Card className="xl:col-span-7">
              <CardHead icon={BanknoteIcon} title="Cash drawer" sub="Books say what should be there; you count what is" />
              {preview.isLoading ? (
                <RowsSkeleton rows={4} />
              ) : (
                <div className="grid md:grid-cols-2">
                  <div className="border-ink/[0.06] py-1.5 md:border-r">
                    <Line k="Opening cash" cents={r?.openingCents ?? 0} />
                    <Line k="+ Cash in" cents={r?.cashIn.totalCents ?? 0} tone="text-emerald-700" />
                    {(r?.cashIn.lines ?? []).map((l, i) => (
                      <div key={`in-${i}`} className="flex justify-between px-4 pl-8 text-[11px] text-ink-4">
                        <span className="truncate">{l.label}</span>
                        <span className="g-metric">{fmt(l.cents)}</span>
                      </div>
                    ))}
                    <Line k="− Cash out" cents={r?.cashOut.totalCents ?? 0} tone="text-rose-700" />
                    {(r?.cashOut.lines ?? []).map((l, i) => (
                      <div key={`out-${i}`} className="flex justify-between px-4 pl-8 text-[11px] text-ink-4">
                        <span className="truncate">{l.label}</span>
                        <span className="g-metric">{fmt(l.cents)}</span>
                      </div>
                    ))}
                    <Line k="= Expected closing" cents={expectedCents} total tone="text-gold-deep" />
                    {r?.closing.awaitingApprovalCents ? (
                      <p className="px-4 pt-1 text-[10.5px] text-amber-700">{fmt(r.closing.awaitingApprovalCents)} awaiting approval is not in this figure.</p>
                    ) : null}
                  </div>

                  <div className="space-y-2.5 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-4">Counted cash</span>
                      <span className="flex rounded-lg bg-ink/[0.05] p-0.5 text-[11px] font-semibold">
                        {[
                          { v: false, t: "Total" },
                          { v: true, t: "By notes" },
                        ].map((o) => (
                          <button
                            key={o.t}
                            type="button"
                            onClick={() => setUseSheet(o.v)}
                            className={cn("h-6 rounded-md px-2 transition-colors", useSheet === o.v ? "bg-void text-gold-light" : "text-ink-4 hover:text-ink")}
                          >
                            {o.t}
                          </button>
                        ))}
                      </span>
                    </div>
                    {useSheet ? (
                      <div className="rounded-xl bg-bone/60 p-2 ring-1 ring-inset ring-ink/[0.05]">
                        <div className="grid grid-cols-2 gap-1">
                          {LKR_DENOMINATIONS.map((face) => {
                            const n = Number(counts[face] ?? 0) || 0;
                            return (
                              <label key={face} className={cn("flex items-center gap-1.5 rounded-lg px-1.5 py-1", n ? "bg-paper shadow-[inset_0_0_0_1px_rgba(168,138,62,0.3)]" : "")}>
                                <span className="g-metric w-12 text-right text-[11.5px] font-semibold text-ink-2">{face.toLocaleString("en-US")}</span>
                                <span className="text-[10px] text-ink-5">×</span>
                                <input
                                  inputMode="numeric"
                                  value={counts[face] ?? ""}
                                  onChange={(e) => setCounts((c) => ({ ...c, [face]: e.target.value.replace(/\D/g, "") }))}
                                  className="g-metric h-7 w-12 rounded-md bg-paper px-1.5 text-right text-[12px] shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12)] focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b]"
                                  aria-label={`${face} rupee pieces`}
                                />
                                <span className="g-metric ml-auto text-[10.5px] text-ink-4">{n ? (face * n).toLocaleString("en-US") : ""}</span>
                              </label>
                            );
                          })}
                        </div>
                        <div className="mt-1.5 flex justify-between border-t border-ink/10 px-1.5 pt-1.5 text-[12px]">
                          <span className="text-ink-3">Counted</span>
                          <span className="g-metric font-semibold text-ink">{fmt(sheetCents)}</span>
                        </div>
                      </div>
                    ) : (
                      <input
                        type="number"
                        step="any"
                        value={actual}
                        onChange={(e) => setActual(e.target.value)}
                        placeholder="0.00"
                        className="g-metric h-11 w-full rounded-lg bg-paper px-3 text-[18px] text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.15)] focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_3px_rgba(205,168,83,0.24)]"
                      />
                    )}

                    <div
                      className={cn(
                        "flex items-center justify-between rounded-xl px-3 py-2.5 ring-1 ring-inset",
                        differenceCents === null
                          ? "bg-bone/60 ring-ink/[0.06]"
                          : differenceCents === 0
                            ? "bg-emerald-600/10 ring-emerald-600/25"
                            : differenceCents < 0
                              ? "bg-rose-500/10 ring-rose-500/25"
                              : "bg-amber-500/10 ring-amber-500/25"
                      )}
                    >
                      <span className="text-[12px] font-semibold text-ink">
                        Difference
                        <span className="ml-1.5 text-[10.5px] font-normal text-ink-4">
                          {differenceCents === null ? "count first" : differenceCents === 0 ? "drawer is square" : differenceCents < 0 ? "shortage" : "overage"}
                        </span>
                      </span>
                      <span className={cn("g-metric text-[18px] font-semibold", diffTone(differenceCents))}>{differenceCents === null ? "—" : signed(differenceCents)}</span>
                    </div>

                    {differenceCents ? (
                      <div className="space-y-1.5 text-[11.5px]">
                        <button type="button" onClick={() => setTab("investigate")} className="inline-flex items-center gap-1 font-semibold text-gold-dark hover:underline">
                          <SearchIcon size={11} />
                          Find what explains {fmt(Math.abs(differenceCents))}
                        </button>
                        <label className="flex items-start gap-2 text-ink-3">
                          <input type="checkbox" checked={postDifference} onChange={(e) => setPostDifference(e.target.checked)} className="mt-0.5" />
                          Post to Cash Short &amp; Over so tomorrow opens on the counted cash
                        </label>
                      </div>
                    ) : null}
                    {needsReason ? (
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-4">
                          Explanation <span className="text-gold-dark">*</span>
                        </span>
                        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="A 5,000 note was in the safe" className={cn(controlClass, "!h-9 w-full")} />
                      </label>
                    ) : null}
                  </div>
                </div>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-ink/[0.06] bg-bone/40 px-4 py-2.5">
                {canManage ? (
                  <>
                    <span className="mr-auto text-[11px] text-ink-4">
                      {alreadyClosed ? "This day is already closed — re-open it from the list below to change it." : canClose ? "Everything is in order." : !r?.checks.passed ? "Failing checks block the close." : actualCents === null ? "Enter the counted cash." : needsReason && !reason.trim() ? "Explain the difference." : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => autoClose.mutate()}
                      disabled={autoClose.isPending || close.isPending || alreadyClosed}
                      title="Survey every check, document, pending item and earlier day; close only if nothing blocks it"
                      className="g-btn g-btn-secondary h-9 px-3.5 text-sm"
                    >
                      <ClipboardCheckIcon size={14} /> {autoClose.isPending ? "Surveying…" : "Auto close"}
                    </button>
                    <button type="button" onClick={() => close.mutate()} disabled={!canClose || close.isPending || autoClose.isPending} className="g-btn g-btn-primary h-9 px-4 text-sm">
                      {close.isPending ? "Closing…" : `Close ${date}`}
                    </button>
                  </>
                ) : (
                  <>
                    <span className="mr-auto text-[11px] text-ink-4">You can read this screen; closing the day needs accounts:manage.</span>
                    <button type="button" onClick={() => autoClose.mutate()} disabled={autoClose.isPending} className="g-btn g-btn-secondary h-9 px-3.5 text-sm">
                      <ClipboardCheckIcon size={14} /> {autoClose.isPending ? "Surveying…" : "Run day-close survey"}
                    </button>
                  </>
                )}
              </div>
            </Card>

            {/* ---------------- card, money, gold */}
            <div className="space-y-4 xl:col-span-5">
              <Card>
                <CardHead icon={CreditCardIcon} title="Card terminal" sub="Terminal's end-of-day total against the card sales recorded" />
                <div className="grid grid-cols-3 gap-px bg-ink/[0.05]">
                  <div className="bg-paper px-4 py-2">
                    <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">Recorded</div>
                    <div className="g-metric mt-0.5 text-[14px] font-semibold text-ink">{fmt(r?.card?.netCents ?? 0)}</div>
                    {r?.card?.refundsCents ? <div className="text-[10px] text-ink-5">after {fmt(r.card.refundsCents)} refunds</div> : null}
                  </div>
                  <label className="bg-paper px-4 py-2">
                    <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">Terminal</span>
                    <input type="number" step="any" value={card} onChange={(e) => setCard(e.target.value)} placeholder="optional" className={cn(dayInputCls, "mt-0.5 w-full")} />
                  </label>
                  <div className="bg-paper px-4 py-2">
                    <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">Difference</div>
                    <div className={cn("g-metric mt-0.5 text-[14px] font-semibold", diffTone(cardDifference))}>{cardDifference === null ? "—" : signed(cardDifference)}</div>
                  </div>
                </div>
                {cardDifference && differenceCents && cardDifference === -differenceCents ? (
                  <p className="border-t border-ink/[0.06] bg-amber-500/10 px-4 py-2 text-[11px] text-amber-800">
                    The card and cash differences cancel out — a sale was probably keyed with the wrong payment method.
                  </p>
                ) : null}
              </Card>

              <Card>
                <CardHead icon={CoinsIcon} title="The day in money" sub="Every flow, cash or not" />
                {r ? (
                  <ul className="space-y-1.5 p-4">
                    {moneyRows.map(([label, cents, tone]) => (
                      <li key={label} className="grid grid-cols-[120px_1fr_96px] items-center gap-2 text-[12px]">
                        <span className="truncate text-ink-3">{label}</span>
                        <span className="h-1.5 overflow-hidden rounded-full bg-ink/[0.05]">
                          <span className="block h-full rounded-full" style={{ width: `${(Math.abs(cents) / maxMoney) * 100}%`, background: tone }} />
                        </span>
                        <span className={cn("g-metric text-right", cents ? "font-semibold text-ink" : "text-ink-5")}>{fmt(cents)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="p-4">
                    <Skeleton className="h-24" />
                  </div>
                )}
              </Card>

              <Card>
                <CardHead icon={GemIcon} title="The day in gold" sub="Fine milligrams" />
                {r?.goldBalance ? (
                  <div className="grid grid-cols-4 gap-px border-b border-ink/[0.06] bg-ink/[0.05]">
                    {[
                      ["Opening", r.goldBalance.openingMg, "text-ink"],
                      ["In", r.goldBalance.inMg, "text-emerald-700"],
                      ["Out", r.goldBalance.outMg, "text-rose-700"],
                      ["Closing", r.goldBalance.closingMg, "text-gold-deep"],
                    ].map(([l, mg, tone]) => (
                      <div key={String(l)} className="bg-paper px-3 py-2">
                        <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{String(l)}</div>
                        <div className={cn("g-metric mt-0.5 text-[13px] font-semibold", String(tone))}>{Number(mg).toLocaleString("en-US")}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {goldRows.length === 0 ? (
                  <p className="px-4 py-3 text-[12px] text-ink-4">No gold moved today.</p>
                ) : (
                  <ul className="divide-y divide-ink/[0.05]">
                    {goldRows.map((g) => (
                      <li key={g.label} className="flex justify-between px-4 py-1.5 text-[12px]">
                        <span className="text-ink-3">{g.label}</span>
                        <span className={cn("g-metric font-semibold", g.mg < 0 ? "text-rose-700" : "text-ink")}>{g.mg.toLocaleString("en-US")} mg</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>

          <Card>
            <CardHead
              icon={HistoryIcon}
              title="Closed days"
              sub={`${(closings.data?.total ?? 0).toLocaleString("en-US")} on file`}
            />
            {closings.isLoading ? (
              <RowsSkeleton rows={5} />
            ) : (closings.data?.rows.length ?? 0) === 0 ? (
              <Empty icon={ClipboardCheckIcon} title="No days closed yet" desc="Close the first day above." />
            ) : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full min-w-[860px] text-[12.5px]">
                  <thead className={thead}>
                    <tr>
                      <th className={cn(th, "pl-4")}>Date</th>
                      <th className={th}>Branch</th>
                      <th className={cn(th, "text-right")}>Expected</th>
                      <th className={cn(th, "text-right")}>Counted</th>
                      <th className={cn(th, "text-right")}>Difference</th>
                      <th className={th}>Explanation</th>
                      <th className={th}>Status</th>
                      <th className={cn(th, "pr-4")} />
                    </tr>
                  </thead>
                  <tbody>
                    {closings.data?.rows.map((c) => (
                      <tr key={c.id} className={tr}>
                        <td className="g-metric relative py-1.5 pl-4 pr-2 text-[11.5px] font-semibold text-ink">
                          <span
                            className={cn("absolute inset-y-1.5 left-0 w-[3px] rounded-r-full", c.difference_cents === 0 ? "bg-emerald-500" : c.difference_cents < 0 ? "bg-rose-500" : "bg-amber-400")}
                            aria-hidden
                          />
                          {c.close_date}
                        </td>
                        <td className="px-2 text-ink-3">{branchName(c.branch_id)}</td>
                        <td className="g-metric px-2 text-right text-ink-3">{fmt(c.expected_cents)}</td>
                        <td className="g-metric px-2 text-right text-ink-3">{fmt(c.actual_cents)}</td>
                        <td className={cn("g-metric px-2 text-right font-semibold", diffTone(c.difference_cents))}>
                          {c.difference_cents ? signed(c.difference_cents) : "0.00"}
                          {c.correction_cents ? <div className="text-[10px] font-normal text-ink-5">posted</div> : null}
                        </td>
                        <td className="max-w-[240px] truncate px-2 text-ink-3" title={c.difference_reason ?? undefined}>
                          {c.difference_reason ?? "—"}
                        </td>
                        <td className="px-2">
                          <DayChip status={c.status} />
                        </td>
                        <td className="whitespace-nowrap py-1.5 pl-2 pr-4 text-right">
                          <Link
                            href={`/day-closing/report?branchId=${encodeURIComponent(c.branch_id)}&date=${c.close_date}`}
                            className="mr-1 inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[11px] font-semibold text-ink-3 ring-1 ring-inset ring-ink/10 hover:bg-bone hover:text-ink"
                          >
                            <PrinterIcon size={11} />
                            Report
                          </Link>
                          {canManage && c.status === "CLOSED" ? (
                            <button type="button" onClick={() => setReopenFor(c)} className="inline-flex h-7 items-center rounded-md px-2.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-500/10">
                              Re-open
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(closings.data?.total ?? 0) > 20 ? (
              <div className="flex items-center justify-end gap-1 border-t border-ink/[0.06] bg-bone/40 px-4 py-2 text-[11px] text-ink-4">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page" className="flex size-7 items-center justify-center rounded-md ring-1 ring-inset ring-ink/10 hover:bg-paper disabled:opacity-40">
                  <ChevronRightIcon size={13} className="rotate-180" />
                </button>
                <span className="g-metric px-1.5 text-ink-2">
                  {page} / {Math.ceil((closings.data?.total ?? 0) / 20)}
                </span>
                <button
                  disabled={page >= Math.ceil((closings.data?.total ?? 0) / 20)}
                  onClick={() => setPage(page + 1)}
                  aria-label="Next page"
                  className="flex size-7 items-center justify-center rounded-md ring-1 ring-inset ring-ink/10 hover:bg-paper disabled:opacity-40"
                >
                  <ChevronRightIcon size={13} />
                </button>
              </div>
            ) : null}
          </Card>
        </div>
      )}

      {survey ? <AutoCloseModal result={survey.result} query={survey.query} onClose={() => setSurvey(null)} /> : null}

      {reopenFor ? (
        <Modal
          kicker="Accounts"
          title={`Re-open ${reopenFor.close_date}`}
          danger
          submitLabel="Re-open day"
          submitDisabled={!reopenReason}
          pending={reopen.isPending}
          onClose={() => setReopenFor(null)}
          onSubmit={() => reopen.mutate()}
        >
          <p className="text-sm text-ink-2">The close is kept as a record. Re-opening only stops the block on new postings.</p>
          <label className="block text-sm text-ink-2">
            Why
            <input value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} className={`${controlClass} w-full`} />
          </label>
        </Modal>
      ) : null}
    </Page>
  );
}
