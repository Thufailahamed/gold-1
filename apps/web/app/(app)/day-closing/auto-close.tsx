"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Modal } from "@/components/ui";
import { cn } from "@/lib/cn";
import { AlertCircleIcon, CheckCircleIcon, FileDownIcon, FileTextIcon, PrinterIcon } from "@/components/icons";
import { downloadCsv, downloadFile } from "@/lib/api";
import { diffTone, fmt, signed } from "./panels";

export type Severity = "blocker" | "warning" | "info" | "ok";

export type DaySurvey = {
  branchId: string;
  branchName: string;
  date: string;
  generatedAt: number;
  status: "OPEN" | "CLOSED" | "REOPENED";
  verdict: "READY" | "BLOCKED" | "CLOSED";
  closingId: string | null;
  closedBy: string | null;
  closedAt: number | null;
  cash: {
    openingCents: number;
    inCents: number;
    outCents: number;
    expectedCents: number;
    countedCents: number | null;
    differenceCents: number | null;
    reason: string | null;
    awaitingApprovalCents: number;
    correctionCents: number;
  };
  card: { recordedCents: number; terminalCents: number | null; differenceCents: number | null };
  findings: { severity: Severity; area: string; title: string; detail: string; cents?: number | null; items?: string[] }[];
  tally: { blockers: number; warnings: number; info: number; ok: number };
  checks: { id: string; pass: boolean }[];
  report: { goldBalance: { closingMg: number }; money: { salesCents: number; expensesCents: number } };
  investigation: { cashMovements: unknown[] };
};

export type AutoCloseResult = { closed: boolean; closingId: string | null; survey: DaySurvey };

/** The query the downloads repeat, so the file shows exactly what the screen showed. */
export function surveyParams(p: { branchId: string; date: string; actualCents: number | null; cardCents: number | null; reason: string }): string {
  const q = new URLSearchParams({ branchId: p.branchId, date: p.date });
  if (p.actualCents !== null && !Number.isNaN(p.actualCents)) q.set("actualCents", String(p.actualCents));
  if (p.cardCents !== null && !Number.isNaN(p.cardCents)) q.set("cardTerminalCents", String(p.cardCents));
  if (p.reason.trim()) q.set("reason", p.reason.trim());
  return q.toString();
}

const SEV: Record<Severity, { label: string; bar: string; chip: string }> = {
  blocker: { label: "Blocker", bar: "bg-rose-500", chip: "bg-rose-500/10 text-rose-800 ring-rose-500/25" },
  warning: { label: "Warning", bar: "bg-amber-400", chip: "bg-amber-500/10 text-amber-800 ring-amber-500/25" },
  info: { label: "Note", bar: "bg-sky-500", chip: "bg-sky-500/10 text-sky-800 ring-sky-500/25" },
  ok: { label: "Pass", bar: "bg-emerald-500", chip: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25" },
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-paper px-3 py-2">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{label}</div>
      <div className={cn("g-metric mt-0.5 text-[14px] font-semibold", tone ?? "text-ink")}>{value}</div>
    </div>
  );
}

export function AutoCloseModal({ result, query, onClose }: { result: AutoCloseResult; query: string; onClose: () => void }) {
  const s = result.survey;
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<"pdf" | "csv" | null>(null);
  const attention = s.findings.filter((f) => f.severity === "blocker" || f.severity === "warning");
  const quiet = s.findings.filter((f) => f.severity === "info" || f.severity === "ok");
  const shown = showAll ? s.findings : attention.slice(0, 6);
  const hidden = s.findings.length - shown.length;
  const passing = s.checks.filter((c) => c.pass).length;
  const diff = s.cash.differenceCents;

  const download = async (kind: "pdf" | "csv") => {
    setBusy(kind);
    const path = `/api/v1/day-closings/survey.${kind}?${query}`;
    const name = `day-close-survey-${s.date}.${kind}`;
    try {
      await (kind === "pdf" ? downloadFile(path, name) : downloadCsv(path, name));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal kicker={`Auto close · ${s.branchName} · ${s.date}`} title="Day-close survey" wide footer={false} onClose={onClose}>
      {(() => {
        const v = result.closed
          ? { tone: "good", title: `Day closed — ${s.date}`, body: `The survey found nothing that stops the close, so the day was closed with the counted cash.${diff ? ` The ${fmt(Math.abs(diff))} ${diff < 0 ? "shortage" : "overage"} was recorded with its explanation.` : ""}` }
          : s.verdict === "CLOSED"
            ? { tone: "info", title: "This day is already closed", body: `Closed${s.closedBy ? ` by ${s.closedBy}` : ""}${s.closedAt ? ` on ${new Date(s.closedAt).toLocaleString()}` : ""}. The survey below is the record.` }
            : s.verdict === "READY"
              ? { tone: "good", title: "Ready to close", body: "Nothing blocks the close. Read the warnings, then close." }
              : { tone: "bad", title: `Not closed — ${s.tally.blockers} blocker${s.tally.blockers === 1 ? "" : "s"}`, body: "Clear every blocker below and run auto close again. Nothing was posted." };
        return (
          <div
            className={cn(
              "flex items-start gap-3 rounded-xl px-4 py-3 ring-1 ring-inset",
              v.tone === "good" ? "bg-emerald-600/10 ring-emerald-600/25" : v.tone === "bad" ? "bg-rose-500/10 ring-rose-500/25" : "bg-sky-500/10 ring-sky-500/25"
            )}
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg text-white",
                v.tone === "good" ? "bg-emerald-600" : v.tone === "bad" ? "bg-rose-600" : "bg-sky-600"
              )}
            >
              {v.tone === "bad" ? <AlertCircleIcon size={15} /> : <CheckCircleIcon size={15} />}
            </span>
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-ink">{v.title}</div>
              <p className="text-[12px] text-ink-3">{v.body}</p>
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-ink/[0.06] ring-1 ring-ink/[0.06] sm:grid-cols-3">
        <Stat label="Expected cash" value={fmt(s.cash.expectedCents)} />
        <Stat label="Counted cash" value={s.cash.countedCents === null ? "Not counted" : fmt(s.cash.countedCents)} tone={s.cash.countedCents === null ? "text-rose-700" : undefined} />
        <Stat label="Difference" value={diff === null ? "—" : signed(diff)} tone={diffTone(diff)} />
        <Stat label="Checks" value={`${passing}/${s.checks.length} pass`} tone={passing === s.checks.length ? "text-emerald-700" : "text-rose-700"} />
        <Stat label="Card difference" value={s.card.differenceCents === null ? "—" : signed(s.card.differenceCents)} tone={diffTone(s.card.differenceCents)} />
        <Stat label="Gold closing" value={`${(s.report.goldBalance.closingMg / 1000).toFixed(3)} g`} tone="text-gold-deep" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["blocker", s.tally.blockers, "blockers"],
            ["warning", s.tally.warnings, "warnings"],
            ["info", s.tally.info, "notes"],
            ["ok", s.tally.ok, "passed"],
          ] as [Severity, number, string][]
        ).map(([sev, n, word]) => (
          <span key={sev} className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", SEV[sev].chip)}>
            <span className={cn("size-1.5 rounded-full", SEV[sev].bar)} />
            <span className="g-metric">{n}</span> {word}
          </span>
        ))}
      </div>

      <ul className="max-h-[45vh] divide-y divide-ink/[0.06] overflow-y-auto rounded-xl ring-1 ring-ink/[0.08] scrollbar-thin">
        {shown.length === 0 ? (
          <li className="px-4 py-3 text-[12px] text-ink-3">No blockers or warnings. {quiet.length} item{quiet.length === 1 ? "" : "s"} passed or noted.</li>
        ) : (
          shown.map((f, i) => (
            <li key={`${f.title}-${i}`} className="relative py-2.5 pl-4 pr-3 text-[12.5px]">
              <span className={cn("absolute inset-y-2 left-0 w-[3px] rounded-r-full", SEV[f.severity].bar)} aria-hidden />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("rounded-full px-1.5 py-px text-[10px] font-semibold ring-1 ring-inset", SEV[f.severity].chip)}>{SEV[f.severity].label}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-5">{f.area}</span>
                  </div>
                  <div className="mt-1 font-semibold text-ink">{f.title}</div>
                  <div className="text-[11.5px] text-ink-3">{f.detail}</div>
                  {f.items?.length ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] font-medium text-gold-dark">
                        {f.items.length} detail{f.items.length === 1 ? "" : "s"}
                      </summary>
                      <ul className="mt-1 space-y-0.5 text-[11px] text-ink-3">
                        {f.items.slice(0, 20).map((it, j) => (
                          <li key={j} className="g-metric">
                            · {it}
                          </li>
                        ))}
                        {f.items.length > 20 ? <li className="text-ink-4">…and {f.items.length - 20} more in the downloaded report</li> : null}
                      </ul>
                    </details>
                  ) : null}
                </div>
                {f.cents !== null && f.cents !== undefined ? <span className="g-metric shrink-0 font-semibold text-ink-2">{fmt(f.cents)}</span> : null}
              </div>
            </li>
          ))
        )}
      </ul>
      {hidden > 0 || showAll ? (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="text-[11.5px] font-semibold text-gold-dark hover:underline">
          {showAll ? "Show only what needs attention" : `Show all ${s.findings.length} findings`}
        </button>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink/10 pt-3">
        <p className="text-xs text-ink-4">The downloaded report has every check, drawer movement, pending item and earlier unclosed day.</p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/day-closing/report?branchId=${encodeURIComponent(s.branchId)}&date=${s.date}`} className="g-btn g-btn-secondary h-9 px-3 text-xs">
            <PrinterIcon size={14} /> Closing report
          </Link>
          <button type="button" disabled={busy !== null} onClick={() => download("csv")} className="g-btn g-btn-secondary h-9 px-3 text-xs">
            <FileTextIcon size={14} /> {busy === "csv" ? "Preparing…" : "CSV"}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => download("pdf")} className="g-btn g-btn-primary h-9 px-3 text-xs">
            <FileDownIcon size={14} /> {busy === "pdf" ? "Preparing…" : "Download PDF"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
