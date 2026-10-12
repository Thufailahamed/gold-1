"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Callout, Modal, Pill, type PillTone } from "@/components/ui";
import { FileDownIcon, FileTextIcon, PrinterIcon } from "@/components/icons";
import { downloadCsv, downloadFile } from "@/lib/api";
import { fmt } from "./panels";

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

const TONE: Record<Severity, PillTone> = { blocker: "danger", warning: "warning", info: "info", ok: "success" };
const LABEL: Record<Severity, string> = { blocker: "Blocker", warning: "Warning", info: "Note", ok: "Pass" };

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl bg-bone/60 px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.12em] text-ink-4">{label}</div>
      <div className={`g-metric mt-0.5 text-sm font-semibold ${tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-rose-600" : "text-ink"}`}>{value}</div>
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
      {result.closed ? (
        <Callout tone="success" title={`Day closed — ${s.date}`}>
          The survey found nothing that stops the close, so the day was closed with the counted cash.
          {diff ? ` The ${fmt(Math.abs(diff))} ${diff < 0 ? "shortage" : "overage"} was recorded with its explanation.` : ""}
        </Callout>
      ) : s.verdict === "CLOSED" ? (
        <Callout tone="info" title="This day is already closed">
          Closed{s.closedBy ? ` by ${s.closedBy}` : ""}
          {s.closedAt ? ` on ${new Date(s.closedAt).toLocaleString()}` : ""}. The survey below is the record.
        </Callout>
      ) : s.verdict === "READY" ? (
        <Callout tone="success" title="Ready to close">
          Nothing blocks the close. Read the warnings, then close.
        </Callout>
      ) : (
        <Callout tone="danger" title={`Not closed — ${s.tally.blockers} blocker${s.tally.blockers === 1 ? "" : "s"}`}>
          Clear every blocker below and run auto close again. Nothing was posted.
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Expected cash" value={fmt(s.cash.expectedCents)} />
        <Stat label="Counted cash" value={s.cash.countedCents === null ? "Not counted" : fmt(s.cash.countedCents)} tone={s.cash.countedCents === null ? "bad" : undefined} />
        <Stat label="Difference" value={diff === null ? "—" : fmt(diff)} tone={diff === null ? undefined : diff === 0 ? "good" : "bad"} />
        <Stat label="Checks" value={`${passing}/${s.checks.length} pass`} tone={passing === s.checks.length ? "good" : "bad"} />
        <Stat label="Card difference" value={s.card.differenceCents === null ? "—" : fmt(s.card.differenceCents)} tone={s.card.differenceCents ? "bad" : undefined} />
        <Stat label="Gold closing" value={`${(s.report.goldBalance.closingMg / 1000).toFixed(3)} g`} />
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs">
        <Pill tone="danger">{s.tally.blockers} blockers</Pill>
        <Pill tone="warning">{s.tally.warnings} warnings</Pill>
        <Pill tone="info">{s.tally.info} notes</Pill>
        <Pill tone="success">{s.tally.ok} passed</Pill>
      </div>

      <ul className="divide-y divide-ink/10 rounded-xl border border-ink/10">
        {shown.length === 0 ? (
          <li className="px-3 py-3 text-sm text-ink-3">No blockers or warnings. {quiet.length} item{quiet.length === 1 ? "" : "s"} passed or noted.</li>
        ) : (
          shown.map((f, i) => (
            <li key={`${f.title}-${i}`} className="px-3 py-2.5 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={TONE[f.severity]}>{LABEL[f.severity]}</Pill>
                    <span className="text-[11px] uppercase tracking-[0.1em] text-ink-4">{f.area}</span>
                  </div>
                  <div className="mt-1 font-medium text-ink">{f.title}</div>
                  <div className="text-xs text-ink-3">{f.detail}</div>
                  {f.items?.length ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-ink-4">{f.items.length} detail{f.items.length === 1 ? "" : "s"}</summary>
                      <ul className="mt-1 space-y-0.5 text-xs text-ink-3">
                        {f.items.slice(0, 20).map((it, j) => (
                          <li key={j}>· {it}</li>
                        ))}
                        {f.items.length > 20 ? <li className="text-ink-4">…and {f.items.length - 20} more in the downloaded report</li> : null}
                      </ul>
                    </details>
                  ) : null}
                </div>
                {f.cents !== null && f.cents !== undefined ? <span className="g-metric shrink-0 text-ink-2">{fmt(f.cents)}</span> : null}
              </div>
            </li>
          ))
        )}
      </ul>
      {hidden > 0 || showAll ? (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs font-medium text-gold-dark underline">
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
