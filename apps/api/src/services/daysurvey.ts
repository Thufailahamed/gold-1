import { addDays, denominationTotalCents, type CloseDayInput } from "@goldos/shared";
import { buildClosingReport, closeDay, type ClosingReport, type ClosingRow } from "./dayclose";
import { closingReportCsv, investigateDay, listUnclosedDays, type DayInvestigation } from "./dayreports";
import { tzOffsetMinutes } from "./busdate";
import { PdfDoc, type Rgb } from "./pdf";
import { reconcile, type CheckResult } from "./reconcile";

/* ----------------------------------------------------------------- types */

export type SurveySeverity = "blocker" | "warning" | "info" | "ok";

export type SurveyFinding = {
  severity: SurveySeverity;
  area: string;
  title: string;
  detail: string;
  cents?: number | null;
  items?: string[];
};

export type DaySurvey = {
  branchId: string;
  branchName: string;
  date: string;
  generatedAt: number;
  /** The business clock, so printed times read as the shop's local time. */
  tzOffsetMinutes: number;
  status: "OPEN" | "CLOSED" | "REOPENED";
  /** READY: nothing stops the close. BLOCKED: at least one blocker. CLOSED: already on file. */
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
  findings: SurveyFinding[];
  tally: { blockers: number; warnings: number; info: number; ok: number };
  checks: CheckResult[];
  report: ClosingReport;
  investigation: DayInvestigation;
  unclosedDays: { date: string; status: string; entries: number; cashMovementCents: number }[];
};

export type SurveyInput = {
  branchId: string;
  date: string;
  actualCents?: number;
  cardTerminalCents?: number;
  differenceReason?: string;
  denominations?: Record<string, number>;
};

/* ------------------------------------------------------------ formatting */

export const lkr = (c: number | null | undefined): string => {
  if (c === null || c === undefined) return "-";
  const a = Math.abs(c);
  const whole = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${c < 0 ? "-" : ""}${whole}.${String(a % 100).padStart(2, "0")}`;
};
/** "2026-10-10 18:05 (UTC+05:30)" on the shop's business clock. */
export const stamp = (ms: number, offsetMinutes: number): string => {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const a = Math.abs(offsetMinutes);
  const zone = `UTC${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
  return `${new Date(ms + offsetMinutes * 60_000).toISOString().replace("T", " ").slice(0, 16)} (${zone})`;
};
const grams = (mg: number) => `${(mg / 1000).toFixed(3)} g`;
/** Gold checks compare fine milligrams; every other check compares cents. */
const checkValue = (c: CheckResult, v: number) => (c.id.startsWith("gold_") ? grams(v) : lkr(v));

const SEVERITY_ORDER: Record<SurveySeverity, number> = { blocker: 0, warning: 1, info: 2, ok: 3 };

/* ---------------------------------------------------------------- survey */

/**
 * A snapshot frozen by an older build lacks the fields added since (card,
 * gold balance, net unclassified). Fill them with neutral values so a day
 * closed last year still surveys rather than throwing.
 */
function frozenReport(json: string): ClosingReport {
  const r = JSON.parse(json) as Partial<ClosingReport> & Pick<ClosingReport, "branchId" | "date" | "openingCents">;
  const group = (g: Partial<ClosingReport["cashIn"]> | undefined): ClosingReport["cashIn"] => ({
    totalCents: g?.totalCents ?? 0,
    unclassifiedCents: g?.unclassifiedCents ?? 0,
    unclassifiedNetCents: g?.unclassifiedNetCents ?? g?.unclassifiedCents ?? 0,
    lines: g?.lines ?? [],
  });
  return {
    ...r,
    cashIn: group(r.cashIn),
    cashOut: group(r.cashOut),
    money: {
      salesCents: 0, purchasesCents: 0, oldGoldCents: 0, expensesCents: 0,
      customerPaymentsCents: 0, supplierPaymentsCents: 0, bankTransactionsCents: 0,
      ...r.money,
    },
    gold: r.gold ?? ({} as ClosingReport["gold"]),
    goldBalance: r.goldBalance ?? { openingMg: 0, inMg: 0, outMg: 0, closingMg: 0 },
    card: r.card ?? { salesCents: 0, refundsCents: 0, netCents: 0 },
    checks: r.checks ?? { passed: true, failing: [], total: 0 },
    closing: { expectedCents: 0, differenceCents: 0, reasonRequired: false, awaitingApprovalCents: 0, ...r.closing },
  };
}

/**
 * The whole day at one branch in one pass: the closing arithmetic, every
 * reconciliation check, document-level posting faults, every drawer movement,
 * what is still waiting, late entries, earlier days nobody closed — reduced to
 * findings ranked by whether they stop the close.
 *
 * Read-only. It is the evidence an auto-close acts on, and the record kept of
 * why the day was (or was not) closed.
 */
export async function surveyDay(db: D1Database, input: SurveyInput): Promise<DaySurvey> {
  const { branchId, date } = input;
  const [branch, closing, tz] = await Promise.all([
    db.prepare("SELECT name FROM branches WHERE id = ?").bind(branchId).first<{ name: string }>(),
    db
      .prepare(
        "SELECT d.*, u.name AS closer FROM day_closings d LEFT JOIN users u ON u.id = d.closed_by WHERE d.branch_id = ? AND d.close_date = ?"
      )
      .bind(branchId, date)
      .first<ClosingRow & { closer: string | null }>(),
    tzOffsetMinutes(db),
  ]);
  const closed = closing?.status === "CLOSED";
  const status: DaySurvey["status"] = closed ? "CLOSED" : closing?.status === "REOPENED" ? "REOPENED" : "OPEN";

  // A closed day is reported from its frozen snapshot: the record, not a
  // re-derivation that its own correction entry would since have moved.
  const [report, recon, unclosedDays] = await Promise.all([
    closed ? Promise.resolve(frozenReport(closing!.report_json)) : buildClosingReport(db, { branchId, date }),
    reconcile(db, { date, branchId }),
    listUnclosedDays(db, { branchId, from: addDays(date, -60), to: addDays(date, -1) }),
  ]);

  const countedCents = closed ? closing!.actual_cents : (input.actualCents ?? null);
  const investigation = await investigateDay(
    db,
    { branchId, date, actualCents: closed ? undefined : (input.actualCents ?? undefined) },
    { report, recon }
  );
  const expectedCents = report.closing.expectedCents;
  const differenceCents = closed ? closing!.difference_cents : countedCents === null ? null : countedCents - expectedCents;
  const reason = (closed ? closing!.difference_reason : input.differenceReason?.trim()) || null;
  const terminalCents = closed ? closing!.card_actual_cents : (input.cardTerminalCents ?? null);
  const cardDifference = terminalCents === null ? null : terminalCents - report.card.netCents;

  const findings: SurveyFinding[] = [];
  const add = (f: SurveyFinding) => findings.push(f);

  // Blockers: what closeDay itself would refuse. Only meaningful while open.
  if (!closed) {
    for (const c of recon.checks.filter((x) => !x.pass))
      add({
        severity: "blocker",
        area: "Reconciliation",
        title: c.label,
        detail: `Expected ${checkValue(c, c.expected)}, found ${checkValue(c, c.actual)} (difference ${checkValue(c, c.difference)}).`,
        items: c.detail,
      });
    if (report.cashIn.unclassifiedNetCents > 0)
      add({
        severity: "blocker",
        area: "Cash",
        title: "Cash movement with no category",
        detail: "Some drawer movement does not belong to a category the closing knows, so the breakdown would be wrong.",
        cents: report.cashIn.unclassifiedNetCents,
        items: [...report.cashIn.lines, ...report.cashOut.lines].filter((l) => l.label.startsWith("Unrecognised")).map((l) => `${l.label}: ${lkr(l.cents)}`),
      });
    if (countedCents === null)
      add({
        severity: "blocker",
        area: "Cash",
        title: "Drawer not counted",
        detail: `Enter the counted cash (or the note count) — the books expect ${lkr(expectedCents)} LKR. A day is never closed on the expected figure alone.`,
      });
    if (input.denominations && countedCents !== null && denominationTotalCents(input.denominations) !== countedCents)
      add({
        severity: "blocker",
        area: "Cash",
        title: "Note count does not add up",
        detail: `The note count totals ${lkr(denominationTotalCents(input.denominations))}, not the ${lkr(countedCents)} entered.`,
      });
    if ((differenceCents ?? 0) !== 0 && !reason)
      add({ severity: "blocker", area: "Cash", title: "Cash difference not explained", detail: "A short or over drawer needs an explanation before it can close.", cents: differenceCents });
    if ((cardDifference ?? 0) !== 0 && !reason)
      add({ severity: "blocker", area: "Card", title: "Card terminal difference not explained", detail: "The terminal total differs from the card sales recorded; add an explanation.", cents: cardDifference });
  }

  if (differenceCents !== null && differenceCents !== 0)
    add({
      severity: "warning",
      area: "Cash",
      title: `Drawer ${differenceCents < 0 ? "short" : "over"} by ${lkr(Math.abs(differenceCents))}`,
      detail: reason ? `Explanation: ${reason}` : "No explanation yet.",
      cents: differenceCents,
      items: investigation.suspects.map((s) => `${s.explanation} — ${lkr(s.cents)}: ${s.items.join(", ")}`),
    });
  if (cardDifference !== null && cardDifference !== 0)
    add({
      severity: "warning",
      area: "Card",
      title: `Card terminal ${cardDifference < 0 ? "below" : "above"} recorded card sales by ${lkr(Math.abs(cardDifference))}`,
      detail: differenceCents && cardDifference === -differenceCents ? "Card and cash differences cancel out — a sale was probably keyed with the wrong payment method." : "Compare terminal slips with the card sales of the day.",
      cents: cardDifference,
    });
  for (const d of investigation.documentIssues)
    add({
      severity: "warning",
      area: "Documents",
      title: `${d.number}: ${d.problem}`,
      detail: `Document ${lkr(d.documentCents)}, ledger ${d.ledgerCents === null ? "nothing posted" : lkr(d.ledgerCents)}.`,
      cents: d.documentCents,
    });
  const p = investigation.pending;
  if (p.expenses.length)
    add({
      severity: "warning",
      area: "Approvals",
      title: `${p.expenses.length} expense${p.expenses.length === 1 ? "" : "s"} awaiting approval`,
      detail: "If paid from the drawer, the books read this much higher than the cash.",
      cents: p.expenses.reduce((s, e) => s + e.amountCents, 0),
      items: p.expenses.map((e) => `${e.number} ${e.description} — ${lkr(e.amountCents)}`),
    });
  if (p.transfersIn.length)
    add({
      severity: "warning",
      area: "Transfers",
      title: `${p.transfersIn.length} cash transfer${p.transfersIn.length === 1 ? "" : "s"} to this branch not received`,
      detail: "Money sent here that the system has not seen arrive.",
      cents: p.transfersIn.reduce((s, t) => s + t.amountCents, 0),
      items: p.transfersIn.map((t) => `${t.number} from ${t.fromBranchId}, sent ${t.sentOn} — ${lkr(t.amountCents)}`),
    });
  if (p.approvals.length)
    add({
      severity: "warning",
      area: "Approvals",
      title: `${p.approvals.length} approval request${p.approvals.length === 1 ? "" : "s"} pending`,
      detail: "Actions waiting on a second person; they may move today's figures once approved.",
      items: p.approvals.map((a) => `${a.action}: ${a.reason}`),
    });
  if (investigation.lateEntries.length)
    add({
      severity: "warning",
      area: "Ledger",
      title: `${investigation.lateEntries.length} entr${investigation.lateEntries.length === 1 ? "y" : "ies"} keyed today but dated earlier`,
      detail: "These changed an earlier day's closing cash, and so today's opening.",
      cents: investigation.lateEntries.reduce((s, l) => s + l.cashCents, 0),
      items: investigation.lateEntries.map((l) => `${l.entryNo} dated ${l.entryDate} (${l.refEntity ?? "manual"}) cash ${lkr(l.cashCents)}`),
    });
  if (unclosedDays.length)
    add({
      severity: "warning",
      area: "Earlier days",
      title: `${unclosedDays.length} earlier day${unclosedDays.length === 1 ? "" : "s"} with activity not closed`,
      detail: "Nobody counted those drawers. A shortage on a skipped day is only found by closing it.",
      items: unclosedDays.map((d) => `${d.date} (${d.status === "REOPENED" ? "re-opened" : "not closed"}, ${d.entries} entries)`),
    });
  if (report.goldBalance.closingMg < 0)
    add({ severity: "warning", area: "Gold", title: "Gold balance below zero", detail: `The branch closes on ${grams(report.goldBalance.closingMg)} fine — more gold left than ever arrived.` });

  const o = investigation.outstanding;
  if (o.cardClearingCents > 0)
    add({
      severity: "info",
      area: "Card",
      title: `${lkr(o.cardClearingCents)} card takings not yet settled by the bank`,
      detail: o.oldestUnsettledCardDate ? `Oldest unsettled card day: ${o.oldestUnsettledCardDate}.` : "Awaiting the bank settlement.",
      cents: o.cardClearingCents,
    });
  if (o.cashInTransitOutCents > 0)
    add({ severity: "info", area: "Transfers", title: `${lkr(o.cashInTransitOutCents)} sent to other branches, not yet received`, detail: "Cash in transit out of this branch.", cents: o.cashInTransitOutCents });
  if (report.closing.awaitingApprovalCents > 0 && !p.expenses.length)
    add({ severity: "info", area: "Approvals", title: `${lkr(report.closing.awaitingApprovalCents)} awaiting approval`, detail: "Out of the drawer but not yet in the books.", cents: report.closing.awaitingApprovalCents });

  const passing = recon.checks.filter((c) => c.pass).length;
  if (passing === recon.checks.length) add({ severity: "ok", area: "Reconciliation", title: `All ${recon.checks.length} reconciliation checks pass`, detail: "Ledger, documents, gold and cash agree." });
  if (report.cashIn.unclassifiedNetCents === 0) add({ severity: "ok", area: "Cash", title: "Every cash movement is categorised", detail: `${report.cashIn.lines.length + report.cashOut.lines.length} line(s) across the drawer.` });
  if (differenceCents === 0) add({ severity: "ok", area: "Cash", title: "Drawer balances to the cent", detail: `Counted ${lkr(countedCents)} = expected ${lkr(expectedCents)}.` });
  if (!investigation.documentIssues.length) add({ severity: "ok", area: "Documents", title: "Every document is posted as it says", detail: "Sales, returns, purchases, payments, expenses and receipts match their journal entries." });

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const tally = {
    blockers: findings.filter((f) => f.severity === "blocker").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
    ok: findings.filter((f) => f.severity === "ok").length,
  };

  return {
    branchId,
    branchName: branch?.name ?? branchId,
    date,
    generatedAt: Date.now(),
    tzOffsetMinutes: tz,
    status,
    verdict: closed ? "CLOSED" : tally.blockers ? "BLOCKED" : "READY",
    closingId: closing?.id ?? null,
    closedBy: closed ? (closing!.closer ?? closing!.closed_by) : null,
    closedAt: closed ? closing!.closed_at : null,
    cash: {
      openingCents: report.openingCents,
      inCents: report.cashIn.totalCents,
      outCents: report.cashOut.totalCents,
      expectedCents,
      countedCents,
      differenceCents,
      reason,
      awaitingApprovalCents: report.closing.awaitingApprovalCents,
      correctionCents: closing?.correction_cents ?? 0,
    },
    card: { recordedCents: report.card.netCents, terminalCents, differenceCents: cardDifference },
    findings,
    tally,
    checks: recon.checks,
    report,
    investigation,
    unclosedDays,
  };
}

/* ------------------------------------------------------------ auto close */

export type AutoCloseInput = SurveyInput & { postDifference?: boolean };

/**
 * Survey first, close only on a clean survey. Every blocker is one closeDay
 * would refuse anyway — the survey just says all of them at once, with the
 * evidence, instead of the first one as an error.
 */
export async function autoCloseDay(
  db: D1Database,
  input: AutoCloseInput,
  actorId: string
): Promise<{ closed: boolean; closingId: string | null; survey: DaySurvey }> {
  const before = await surveyDay(db, input);
  if (before.verdict !== "READY" || input.actualCents === undefined)
    return { closed: false, closingId: before.closingId, survey: before };
  const close: CloseDayInput = {
    branchId: input.branchId,
    date: input.date,
    actualCents: input.actualCents,
    differenceReason: input.differenceReason?.trim() || undefined,
    denominations: input.denominations,
    cardTerminalCents: input.cardTerminalCents,
    postDifference: before.cash.differenceCents ? (input.postDifference ?? true) : undefined,
  };
  const { id } = await closeDay(db, close, actorId);
  const after = await surveyDay(db, { branchId: input.branchId, date: input.date });
  return { closed: true, closingId: id, survey: after };
}

/* ------------------------------------------------------------------- CSV */

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const amt = (c: number | null | undefined) => (c === null || c === undefined ? "" : (c / 100).toFixed(2));

/** The full survey as one spreadsheet, section by section. */
export function surveyCsv(s: DaySurvey): string {
  const rows: unknown[][] = [
    ["GoldOS day-close survey"],
    ["Branch", s.branchName],
    ["Date", s.date],
    ["Status", s.status],
    ["Verdict", s.verdict],
    ["Generated", stamp(s.generatedAt, s.tzOffsetMinutes)],
    ...(s.closedBy ? [["Closed by", s.closedBy]] : []),
    ...(s.closedAt ? [["Closed at", stamp(s.closedAt, s.tzOffsetMinutes)]] : []),
    [],
    ["SUMMARY", "Line", "Amount (LKR)"],
    ["Cash", "Opening cash", amt(s.cash.openingCents)],
    ["Cash", "Cash in", amt(s.cash.inCents)],
    ["Cash", "Cash out", amt(s.cash.outCents)],
    ["Cash", "Expected closing cash", amt(s.cash.expectedCents)],
    ["Cash", "Counted cash", amt(s.cash.countedCents)],
    ["Cash", "Difference", amt(s.cash.differenceCents)],
    ["Cash", "Explanation", s.cash.reason ?? ""],
    ["Card", "Card sales recorded (net)", amt(s.card.recordedCents)],
    ["Card", "Terminal total", amt(s.card.terminalCents)],
    ["Card", "Difference", amt(s.card.differenceCents)],
    ["Findings", "Blockers", s.tally.blockers],
    ["Findings", "Warnings", s.tally.warnings],
    ["Findings", "Notes", s.tally.info],
    ["Findings", "Passed", s.tally.ok],
    [],
    ["FINDINGS", "Severity", "Area", "Title", "Detail", "Amount (LKR)", "Items"],
    ...s.findings.map((f) => ["", f.severity.toUpperCase(), f.area, f.title, f.detail, amt(f.cents), (f.items ?? []).join(" | ")]),
    [],
    ["RECONCILIATION CHECKS", "Check", "Label", "Scope", "Expected", "Actual", "Difference", "Unit", "Result", "Detail"],
    ...s.checks.map((c) => {
      const gold = c.id.startsWith("gold_");
      const v = (n: number) => (gold ? (n / 1000).toFixed(3) : amt(n));
      return ["", c.id, c.label, c.scope, v(c.expected), v(c.actual), v(c.difference), gold ? "fine g" : "LKR", c.pass ? "PASS" : "FAIL", c.detail.join(" | ")];
    }),
    [],
    ["CASH MOVEMENTS", "Entry", "Type", "Reference", "Memo", "Amount (LKR)", "Keyed by", "Keyed at", "Flags"],
    ...s.investigation.cashMovements.map((m) => [
      "", m.entryNo, m.refEntity ?? "", m.refNo ?? "", m.memo ?? "", amt(m.cents), m.createdBy ?? "", stamp(m.createdAt, s.tzOffsetMinutes),
      [m.backdated ? "backdated" : "", m.reversal ? "reversal" : ""].filter(Boolean).join(" "),
    ]),
    [],
    ["DOCUMENT ISSUES", "Kind", "Number", "Problem", "Document (LKR)", "Ledger (LKR)"],
    ...s.investigation.documentIssues.map((d) => ["", d.kind, d.number, d.problem, amt(d.documentCents), amt(d.ledgerCents)]),
    [],
    ["PENDING", "Kind", "Number", "Description", "Amount (LKR)"],
    ...s.investigation.pending.expenses.map((e) => ["", "Expense awaiting approval", e.number, e.description, amt(e.amountCents)]),
    ...s.investigation.pending.transfersIn.map((t) => ["", "Transfer not received", t.number, `from ${t.fromBranchId}, sent ${t.sentOn}`, amt(t.amountCents)]),
    ...s.investigation.pending.approvals.map((a) => ["", "Approval pending", a.action, a.reason, ""]),
    [],
    ["LATE ENTRIES", "Entry", "Dated", "Type", "Cash (LKR)", "Memo"],
    ...s.investigation.lateEntries.map((l) => ["", l.entryNo, l.entryDate, l.refEntity ?? "", amt(l.cashCents), l.memo ?? ""]),
    [],
    ["EARLIER DAYS NOT CLOSED", "Date", "Status", "Entries", "Cash moved (LKR)"],
    ...s.unclosedDays.map((d) => ["", d.date, d.status, d.entries, amt(d.cashMovementCents)]),
    [],
  ];
  const head = rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return (
    head +
    "CLOSING REPORT\r\n" +
    closingReportCsv(s.report, {
      branchName: s.branchName,
      status: s.status,
      actualCents: s.cash.countedCents,
      differenceCents: s.cash.differenceCents,
      reason: s.cash.reason,
      closedBy: s.closedBy,
    })
  );
}

/* ------------------------------------------------------------------- PDF */

const TONE: Record<SurveySeverity, Rgb> = {
  blocker: [0.75, 0.11, 0.2],
  warning: [0.7, 0.42, 0.04],
  info: [0.45, 0.38, 0.2],
  ok: [0.02, 0.47, 0.34],
};
const SEVERITY_LABEL: Record<SurveySeverity, string> = { blocker: "BLOCKER", warning: "WARNING", info: "NOTE", ok: "PASS" };

/** The survey as a printable, archivable PDF. */
export function surveyPdf(s: DaySurvey, shopName: string): ArrayBuffer {
  const doc = new PdfDoc(`${shopName} | ${s.branchName} | Day-close survey ${s.date} | generated ${stamp(s.generatedAt, s.tzOffsetMinutes)}`);

  doc.line("DAY-CLOSE SURVEY", { size: 9, bold: true, color: [0.45, 0.38, 0.2] }, 4);
  doc.line(shopName, { size: 20, bold: true }, 6);
  doc.line(`${s.branchName}  |  ${s.date}`, { size: 11, color: [0.35, 0.35, 0.33] }, 10);

  const verdict =
    s.verdict === "CLOSED"
      ? { text: `CLOSED${s.closedBy ? ` by ${s.closedBy}` : ""}${s.closedAt ? ` at ${stamp(s.closedAt, s.tzOffsetMinutes)}` : ""}`, color: TONE.ok }
      : s.verdict === "READY"
        ? { text: "READY TO CLOSE - no blockers found", color: TONE.ok }
        : { text: `NOT READY - ${s.tally.blockers} blocker${s.tally.blockers === 1 ? "" : "s"} must be cleared`, color: TONE.blocker };
  doc.ensure(30);
  doc.rect(doc.left, doc.y - 24, doc.contentWidth, 24, [0.97, 0.96, 0.93]);
  doc.rect(doc.left, doc.y - 24, 4, 24, verdict.color);
  doc.y -= 7;
  doc.text(verdict.text, { x: doc.left + 12, size: 11, bold: true, color: verdict.color });
  doc.text(`Blockers ${s.tally.blockers}   Warnings ${s.tally.warnings}   Notes ${s.tally.info}   Passed ${s.tally.ok}`, { size: 9, align: "right", width: doc.contentWidth - 10, color: [0.4, 0.4, 0.38] });
  doc.y -= 25;

  doc.heading("Cash");
  doc.pair("Opening cash (from the ledger)", lkr(s.cash.openingCents));
  doc.pair("+ Cash in", lkr(s.cash.inCents));
  doc.pair("- Cash out", lkr(s.cash.outCents));
  doc.pair("= Expected closing cash", lkr(s.cash.expectedCents), { bold: true });
  doc.pair("Counted cash", lkr(s.cash.countedCents));
  doc.pair("Difference", lkr(s.cash.differenceCents), {
    bold: true,
    color: s.cash.differenceCents === null ? undefined : s.cash.differenceCents === 0 ? TONE.ok : TONE.blocker,
  });
  if (s.cash.reason) doc.paragraph(`Explanation: ${s.cash.reason}`, { size: 9, color: [0.4, 0.4, 0.38] });
  if (s.cash.correctionCents) doc.paragraph(`Posted to Cash Short & Over: ${lkr(s.cash.correctionCents)}`, { size: 9, color: [0.4, 0.4, 0.38] });
  if (s.cash.awaitingApprovalCents) doc.paragraph(`Expenses awaiting approval: ${lkr(s.cash.awaitingApprovalCents)}`, { size: 9, color: [0.4, 0.4, 0.38] });

  doc.heading("Card");
  doc.pair("Card sales recorded (net of refunds)", lkr(s.card.recordedCents));
  doc.pair("Terminal total", lkr(s.card.terminalCents));
  doc.pair("Difference", lkr(s.card.differenceCents), { bold: true });

  doc.heading("Findings");
  for (const f of s.findings) {
    doc.ensure(30);
    const tone = TONE[f.severity];
    doc.text(SEVERITY_LABEL[f.severity], { size: 7.5, bold: true, color: tone, width: 52 });
    doc.text(f.area, { x: doc.left + 56, size: 7.5, color: [0.5, 0.5, 0.48], width: 80 });
    doc.text(f.cents === null || f.cents === undefined ? "" : lkr(f.cents), { size: 9, align: "right", bold: true });
    doc.paragraph(f.title, { x: doc.left + 140, width: doc.contentWidth - 230, size: 9.5, bold: true }, 2);
    doc.paragraph(f.detail, { x: doc.left + 140, width: doc.contentWidth - 140, size: 8.5, color: [0.35, 0.35, 0.33] }, 2);
    for (const it of (f.items ?? []).slice(0, 25)) doc.paragraph(`- ${it}`, { x: doc.left + 148, width: doc.contentWidth - 148, size: 8, color: [0.4, 0.4, 0.38] }, 1.5);
    if ((f.items?.length ?? 0) > 25) doc.line(`... and ${f.items!.length - 25} more (see CSV)`, { x: doc.left + 148, size: 8, color: [0.5, 0.5, 0.48] });
    doc.y -= 5;
  }

  doc.heading("The day in money (LKR)");
  const m = s.report.money;
  doc.table(
    [{ header: "Line", width: 3 }, { header: "Amount", width: 1, align: "right" }],
    [
      ["Sales", lkr(m.salesCents)],
      ["Purchases", lkr(m.purchasesCents)],
      ["Old gold bought", lkr(m.oldGoldCents)],
      ["Expenses", lkr(m.expensesCents)],
      ["Customer payments", lkr(m.customerPaymentsCents)],
      ["Supplier payments", lkr(m.supplierPaymentsCents)],
      ["Bank and card movement", lkr(m.bankTransactionsCents)],
    ]
  );

  doc.heading("Cash breakdown (LKR)");
  doc.table(
    [{ header: "Direction", width: 1 }, { header: "Line", width: 3 }, { header: "Amount", width: 1.2, align: "right" }],
    [
      ...s.report.cashIn.lines.map((l) => ["In", l.label, lkr(l.cents)]),
      ...s.report.cashOut.lines.map((l) => ["Out", l.label, lkr(l.cents)]),
    ]
  );

  doc.heading("Gold (fine grams)");
  const g = s.report.goldBalance;
  doc.table(
    [{ header: "Line", width: 3 }, { header: "Fine g", width: 1, align: "right" }],
    [
      ["Opening", (g.openingMg / 1000).toFixed(3)],
      ["In", (g.inMg / 1000).toFixed(3)],
      ["Out", (g.outMg / 1000).toFixed(3)],
      ["Closing", (g.closingMg / 1000).toFixed(3)],
      ...Object.values(s.report.gold).filter((x) => x.mg).map((x) => [x.label, (x.mg / 1000).toFixed(3)]),
    ]
  );

  doc.heading(`Reconciliation checks (${s.checks.filter((c) => c.pass).length} of ${s.checks.length} pass)`);
  doc.table(
    [
      { header: "Check", width: 4 },
      { header: "Expected", width: 1.3, align: "right" },
      { header: "Actual", width: 1.3, align: "right" },
      { header: "Difference", width: 1.3, align: "right" },
      { header: "Result", width: 0.8 },
    ],
    s.checks.map((c) => [c.label, checkValue(c, c.expected), checkValue(c, c.actual), checkValue(c, c.difference), c.pass ? "PASS" : "FAIL"])
  );

  if (s.investigation.cashMovements.length) {
    doc.heading("Every drawer movement");
    doc.table(
      [
        { header: "Entry", width: 1.2 },
        { header: "Type", width: 1.5 },
        { header: "Ref / memo", width: 2.6 },
        { header: "By", width: 1.1 },
        { header: "Amount", width: 1.2, align: "right" },
      ],
      s.investigation.cashMovements.map((mv) => [
        mv.entryNo + (mv.backdated ? " *" : "") + (mv.reversal ? " R" : ""),
        mv.refEntity ?? "manual",
        [mv.refNo, mv.memo].filter(Boolean).join(" - "),
        mv.createdBy ?? "",
        lkr(mv.cents),
      ])
    );
    doc.paragraph("* keyed on a different day than it is dated   R reversal", { size: 7.5, color: [0.5, 0.5, 0.48] });
  }

  if (s.unclosedDays.length) {
    doc.heading("Earlier days not closed");
    doc.table(
      [{ header: "Date", width: 1 }, { header: "Status", width: 1 }, { header: "Entries", width: 1, align: "right" }, { header: "Cash moved", width: 1.2, align: "right" }],
      s.unclosedDays.map((d) => [d.date, d.status === "REOPENED" ? "Re-opened" : "Not closed", String(d.entries), lkr(d.cashMovementCents)])
    );
  }

  doc.ensure(70);
  doc.y -= 40;
  const half = doc.contentWidth / 2 - 20;
  doc.rule([0.6, 0.6, 0.58], 0.5);
  doc.y -= 4;
  doc.text("Counted by", { size: 8, color: [0.45, 0.45, 0.43], width: half });
  doc.text("Checked by", { x: doc.left + half + 40, size: 8, color: [0.45, 0.45, 0.43], width: half });
  return doc.toBytes();
}
