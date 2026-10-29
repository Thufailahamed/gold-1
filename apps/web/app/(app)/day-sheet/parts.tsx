"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Modal, controlClass } from "@/components/ui";
import { th, thead } from "@/components/console-kit";
import { AlertCircleIcon, CheckCircleIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import {
  METHOD_SHORT,
  gramsText,
  rupeesAlways,
  systemAsSheetLine,
  toCents,
  toMg,
  type Method,
  type Reconciliation,
  type RowResult,
  type RowStatus,
  type SheetRow,
  type SystemRow,
} from "@/lib/daysheet";

/* ------------------------------------------------------------- edit rows */

/** A sheet line while it is being edited: numbers stay as typed until saved. */
export type EditRow = {
  id: string;
  refNo: string;
  name: string;
  phone: string;
  details: string;
  goldText: string | null;
  gold: string;
  rec: string;
  recM: Method | "";
  giv: string;
  givM: Method | "";
  old: string;
  linkedRef: string | null;
  accepted: boolean;
  acceptNote: string | null;
};

const num = (c: number | null) => (c === null || c === undefined ? "" : String(c / 100));

export const toEdit = (r: SheetRow): EditRow => ({
  id: r.id,
  refNo: r.refNo ?? "",
  name: r.name ?? "",
  phone: r.phone ?? "",
  details: r.details ?? "",
  goldText: r.goldText,
  gold: r.goldMg === null ? "" : String(r.goldMg / 1000),
  rec: num(r.receivedCents),
  recM: r.receivedMethod ?? "",
  giv: num(r.givenCents),
  givM: r.givenMethod ?? "",
  old: num(r.oldGoldCents),
  linkedRef: r.linkedRef,
  accepted: r.accepted,
  acceptNote: r.acceptNote,
});

export const blankEdit = (): EditRow => ({
  id: `new-${crypto.randomUUID()}`,
  refNo: "",
  name: "",
  phone: "",
  details: "",
  goldText: null,
  gold: "",
  rec: "",
  recM: "",
  giv: "",
  givM: "",
  old: "",
  linkedRef: null,
  accepted: false,
  acceptNote: null,
});

const isBlank = (r: EditRow) => !r.refNo && !r.name && !r.phone && !r.details && !r.gold && !r.rec && !r.giv && !r.old;

/** The payload the API stores. Blank lines are dropped. */
export function fromEdit(rows: EditRow[]) {
  return rows
    .filter((r) => !isBlank(r))
    .map((r) => {
      const rec = toCents(r.rec);
      const giv = toCents(r.giv);
      return {
        id: r.id.startsWith("new-") ? undefined : r.id,
        refNo: r.refNo.trim() || null,
        name: r.name.trim() || null,
        phone: r.phone.trim() || null,
        details: r.details.trim() || null,
        goldText: r.goldText,
        goldMg: toMg(r.gold),
        receivedCents: rec,
        receivedMethod: rec ? r.recM || "cash" : null,
        givenCents: giv,
        givenMethod: giv ? r.givM || "cash" : null,
        oldGoldCents: toCents(r.old),
        linkedRef: r.linkedRef,
        accepted: r.accepted,
        acceptNote: r.acceptNote,
      };
    });
}

/** Lines that do not parse as numbers, so the save can refuse with a reason. */
export function editErrors(rows: EditRow[]): string[] {
  const out: string[] = [];
  rows.forEach((r, i) => {
    const bad = (v: string, f: (s: string) => number | null) => v.trim() !== "" && f(v) === null;
    if (bad(r.rec, toCents) || bad(r.giv, toCents) || bad(r.old, toCents)) out.push(`Line ${i + 1}: an amount is not a number`);
    if (bad(r.gold, toMg)) out.push(`Line ${i + 1}: the gold weight is not a number of grams`);
  });
  return out;
}

/* --------------------------------------------------------------- status */

const STATUS: Record<RowStatus, { label: string; cls: string }> = {
  MATCHED: { label: "Matches", cls: "bg-emerald-500/12 text-emerald-800 ring-emerald-500/25" },
  MISMATCH: { label: "Mismatch", cls: "bg-rose-500/12 text-rose-800 ring-rose-500/25" },
  MISSING_IN_SYSTEM: { label: "Not in system", cls: "bg-amber-500/14 text-amber-900 ring-amber-500/30" },
  ACCEPTED: { label: "Accepted", cls: "bg-sky-500/12 text-sky-800 ring-sky-500/25" },
  EMPTY: { label: "Empty", cls: "bg-ink/[0.05] text-ink-4 ring-ink/10" },
};

export function StatusChip({ status, stale }: { status: RowStatus | null; stale?: boolean }) {
  if (!status) return <span className="inline-flex h-5 items-center rounded-full bg-ink/[0.05] px-2 text-[10px] font-semibold text-ink-4 ring-1 ring-inset ring-ink/10">New</span>;
  const s = STATUS[status];
  return (
    <span className={cn("inline-flex h-5 items-center whitespace-nowrap rounded-full px-2 text-[10px] font-semibold ring-1 ring-inset", s.cls, stale && "opacity-50")} title={stale ? "Save to re-check" : undefined}>
      {s.label}
    </span>
  );
}

/* ------------------------------------------------------------- the grid */

const cell =
  "h-8 w-full rounded-md bg-transparent px-1.5 text-[12px] text-ink placeholder:text-ink-5 focus:bg-paper focus:outline-none focus:ring-1 focus:ring-gold/60 disabled:opacity-70";
const numCell = cn(cell, "text-right g-metric");

function MethodSelect({ value, onChange, disabled }: { value: Method | ""; onChange: (m: Method | "") => void; disabled?: boolean }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as Method | "")}
      className="h-6 w-full rounded bg-transparent text-[10.5px] text-ink-4 focus:outline-none focus:ring-1 focus:ring-gold/60"
      aria-label="Paid by"
    >
      <option value="">Cash</option>
      {(["bank", "card", "cheque", "credit"] as Method[]).map((m) => (
        <option key={m} value={m}>
          {METHOD_SHORT[m]}
        </option>
      ))}
    </select>
  );
}

export type RowAction =
  | { kind: "record"; rowId: string }
  | { kind: "link"; rowId: string }
  | { kind: "accept"; rowId: string; accepted: boolean }
  | { kind: "useSystem"; rowId: string; sys: SystemRow };

export function SheetGrid({
  rows,
  setRows,
  results,
  sysByRef,
  dirty,
  canEdit,
  onAction,
}: {
  rows: EditRow[];
  setRows: (fn: (rows: EditRow[]) => EditRow[]) => void;
  results: Map<string, RowResult>;
  sysByRef: Map<string, SystemRow>;
  dirty: boolean;
  canEdit: boolean;
  onAction: (a: RowAction) => void;
}) {
  const patch = (id: string, p: Partial<EditRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const insertAfter = (i: number) => setRows((rs) => [...rs.slice(0, i + 1), blankEdit(), ...rs.slice(i + 1)]);
  const remove = (id: string) => setRows((rs) => rs.filter((r) => r.id !== id));

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[1080px] border-collapse text-[12px]">
        <thead className={thead}>
          <tr>
            <th className={cn(th, "w-8 text-center")}>#</th>
            <th className={cn(th, "w-[92px]")}>Check</th>
            <th className={cn(th, "w-[86px]")}>Bill no</th>
            <th className={cn(th, "w-[150px]")}>Customer</th>
            <th className={cn(th, "w-[108px]")}>Phone</th>
            <th className={th}>Details</th>
            <th className={cn(th, "w-[78px] text-right")}>Gold g</th>
            <th className={cn(th, "w-[96px] text-right")}>Received</th>
            <th className={cn(th, "w-[96px] text-right")}>Given</th>
            <th className={cn(th, "w-[96px] text-right")}>Old gold</th>
            <th className={cn(th, "w-14")} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const res = results.get(r.id) ?? null;
            const sys = res?.matchRef ? sysByRef.get(res.matchRef) : undefined;
            const status = res?.status ?? null;
            const tone = status === "MISMATCH" ? "bg-rose-500/[0.04]" : status === "MISSING_IN_SYSTEM" ? "bg-amber-500/[0.05]" : "";
            const savedRow = !r.id.startsWith("new-");
            return (
              <Fragment key={r.id}>
                <tr className={cn("border-t border-ink/[0.06] align-top", tone)}>
                  <td className="pt-2 text-center text-[11px] font-semibold text-ink-4">{i + 1}</td>
                  <td className="pt-1.5">
                    <StatusChip status={status} stale={dirty} />
                  </td>
                  <td className="py-0.5">
                    <input className={cell} value={r.refNo} disabled={!canEdit} onChange={(e) => patch(r.id, { refNo: e.target.value })} placeholder="—" />
                  </td>
                  <td className="py-0.5">
                    <input className={cn(cell, "font-semibold")} value={r.name} disabled={!canEdit} onChange={(e) => patch(r.id, { name: e.target.value })} placeholder="Name" />
                  </td>
                  <td className="py-0.5">
                    <input className={cell} value={r.phone} disabled={!canEdit} onChange={(e) => patch(r.id, { phone: e.target.value })} placeholder="07…" inputMode="tel" />
                  </td>
                  <td className="py-0.5">
                    <input className={cell} value={r.details} disabled={!canEdit} onChange={(e) => patch(r.id, { details: e.target.value })} placeholder="Item, note" />
                  </td>
                  <td className="py-0.5">
                    <input className={numCell} value={r.gold} disabled={!canEdit} onChange={(e) => patch(r.id, { gold: e.target.value })} inputMode="decimal" placeholder="0.000" />
                    {r.goldText && r.goldText !== r.gold ? <div className="px-1.5 text-right text-[10px] text-ink-5" title="As written on the sheet">“{r.goldText}”</div> : null}
                  </td>
                  <td className="py-0.5">
                    <input className={numCell} value={r.rec} disabled={!canEdit} onChange={(e) => patch(r.id, { rec: e.target.value })} inputMode="decimal" placeholder="0" />
                    {r.rec ? <MethodSelect value={r.recM} disabled={!canEdit} onChange={(m) => patch(r.id, { recM: m })} /> : null}
                  </td>
                  <td className="py-0.5">
                    <input className={numCell} value={r.giv} disabled={!canEdit} onChange={(e) => patch(r.id, { giv: e.target.value })} inputMode="decimal" placeholder="0" />
                    {r.giv ? <MethodSelect value={r.givM} disabled={!canEdit} onChange={(m) => patch(r.id, { givM: m })} /> : null}
                  </td>
                  <td className="py-0.5">
                    <input className={numCell} value={r.old} disabled={!canEdit} onChange={(e) => patch(r.id, { old: e.target.value })} inputMode="decimal" placeholder="0" />
                  </td>
                  <td className="pt-1">
                    {canEdit ? (
                      <span className="flex gap-0.5">
                        <button type="button" title="Insert a line below" onClick={() => insertAfter(i)} className="flex size-6 items-center justify-center rounded text-ink-4 hover:bg-bone hover:text-ink">
                          <PlusIcon size={12} />
                        </button>
                        <button type="button" title="Remove this line" onClick={() => remove(r.id)} className="flex size-6 items-center justify-center rounded text-ink-4 hover:bg-rose-500/10 hover:text-rose-700">
                          <TrashIcon size={12} />
                        </button>
                      </span>
                    ) : null}
                  </td>
                </tr>
                {res && (status === "MISMATCH" || status === "MISSING_IN_SYSTEM" || status === "ACCEPTED" || (status === "MATCHED" && sys)) ? (
                  <tr className={cn(tone)}>
                    <td />
                    <td colSpan={10} className="pb-2 pr-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                        {sys ? (
                          <span className="text-ink-4">
                            {sys.href ? (
                              <Link href={sys.href} className="font-semibold text-ink-2 underline decoration-ink/20 underline-offset-2 hover:text-ink">
                                {sys.kind} {sys.refNo}
                              </Link>
                            ) : (
                              <b className="text-ink-2">
                                {sys.kind} {sys.refNo}
                              </b>
                            )}
                            {sys.name ? ` · ${sys.name}` : ""}
                            {res.matchedBy.length ? (
                              <span className="text-ink-5"> — {res.matchedBy[0] === "linked" ? "linked by hand" : `matched on ${res.matchedBy.join(", ")}`}</span>
                            ) : null}
                          </span>
                        ) : status === "MISSING_IN_SYSTEM" ? (
                          <span className="font-semibold text-amber-900">Written on the sheet, but nothing like it is in the system for this day.</span>
                        ) : null}
                        {res.issues.map((x, k) => (
                          <span key={k} className="rounded-md bg-rose-500/10 px-1.5 py-0.5 text-rose-900">
                            {x.label}: sheet <b>{x.sheet}</b> · system <b>{x.system}</b>
                          </span>
                        ))}
                        {status === "ACCEPTED" && r.acceptNote ? <span className="text-sky-800">Accepted: {r.acceptNote}</span> : null}
                        {canEdit && savedRow && !dirty ? (
                          <span className="ml-auto flex flex-wrap gap-1">
                            {status === "MISSING_IN_SYSTEM" ? (
                              <ActionBtn primary onClick={() => onAction({ kind: "record", rowId: r.id })}>
                                Add to system
                              </ActionBtn>
                            ) : null}
                            {status === "MISMATCH" && sys ? (
                              <ActionBtn onClick={() => onAction({ kind: "useSystem", rowId: r.id, sys })}>Sheet is wrong — use system values</ActionBtn>
                            ) : null}
                            {status !== "MATCHED" ? (
                              <ActionBtn onClick={() => onAction({ kind: "link", rowId: r.id })}>{sys ? "Link to another" : "Link to a transaction"}</ActionBtn>
                            ) : null}
                            {status === "MISMATCH" || status === "MISSING_IN_SYSTEM" ? (
                              <ActionBtn onClick={() => onAction({ kind: "accept", rowId: r.id, accepted: true })}>Accept as is</ActionBtn>
                            ) : null}
                            {status === "ACCEPTED" ? <ActionBtn onClick={() => onAction({ kind: "accept", rowId: r.id, accepted: false })}>Undo accept</ActionBtn> : null}
                            {r.linkedRef && status !== "MISSING_IN_SYSTEM" ? <ActionBtn onClick={() => onAction({ kind: "link", rowId: r.id })}>Change link</ActionBtn> : null}
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ActionBtn({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-6 rounded-md px-2 text-[11px] font-semibold transition-colors",
        primary ? "bg-void text-gold-light hover:bg-void/90" : "bg-paper text-ink-2 ring-1 ring-inset ring-ink/15 hover:bg-bone"
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------ the books */

export function SystemTable({ rows, compact }: { rows: SystemRow[]; compact?: boolean }) {
  const sum = (f: (s: SystemRow) => number) => rows.reduce((t, s) => t + f(s), 0);
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className={cn("w-full border-collapse text-[12px]", !compact && "min-w-[860px]")}>
        <thead className={thead}>
          <tr>
            <th className={cn(th, "w-8 text-center")}>#</th>
            <th className={cn(th, "w-[110px]")}>Bill no</th>
            <th className={th}>Customer · details</th>
            <th className={cn(th, "w-[80px] text-right")}>Gold g</th>
            <th className={cn(th, "w-[110px] text-right")}>Received</th>
            <th className={cn(th, "w-[110px] text-right")}>Given</th>
            <th className={cn(th, "w-[110px] text-right")}>Old gold</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const l = systemAsSheetLine(s);
            return (
              <tr key={s.ref} className="border-t border-ink/[0.06] align-top">
                <td className="py-1.5 text-center text-[11px] text-ink-4">{i + 1}</td>
                <td className="py-1.5 pr-2 font-semibold text-ink-2">{s.href ? <Link href={s.href} className="hover:underline">{s.refNo}</Link> : s.refNo}</td>
                <td className="py-1.5 pr-2">
                  <div className="font-semibold text-ink">{l.who || <span className="text-ink-5">—</span>}</div>
                  <div className="text-[11px] text-ink-4">{l.details}</div>
                </td>
                <td className="g-metric py-1.5 pr-2 text-right">{l.gold}</td>
                <td className="g-metric py-1.5 pr-2 text-right">
                  {l.received}
                  {l.receivedNote ? <div className="text-[10px] text-ink-5">{l.receivedNote}</div> : null}
                </td>
                <td className="g-metric py-1.5 pr-2 text-right">
                  {l.given}
                  {l.givenNote ? <div className="text-[10px] text-ink-5">{l.givenNote}</div> : null}
                </td>
                <td className="g-metric py-1.5 pr-2 text-right">{l.oldGold}</td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-ink/20 bg-gold-pale/40 font-semibold">
            <td />
            <td colSpan={2} className="py-2 text-[11px] uppercase tracking-[0.12em] text-ink-3">
              Total · {rows.length} transaction{rows.length === 1 ? "" : "s"}
            </td>
            <td className="g-metric py-2 pr-2 text-right">{gramsText(sum((s) => s.goldMg ?? 0))}</td>
            <td className="g-metric py-2 pr-2 text-right">{rupeesAlways(sum((s) => s.receivedCents))}</td>
            <td className="g-metric py-2 pr-2 text-right">{rupeesAlways(sum((s) => s.givenCents))}</td>
            <td className="g-metric py-2 pr-2 text-right">{rupeesAlways(sum((s) => s.oldGoldCents))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function TotalsCompare({ rec }: { rec: Reconciliation }) {
  const lines: [string, number, number, (n: number) => string][] = [
    ["Received", rec.totals.sheet.receivedCents, rec.totals.system.receivedCents, rupeesAlways],
    ["Given", rec.totals.sheet.givenCents, rec.totals.system.givenCents, rupeesAlways],
    ["Old gold", rec.totals.sheet.oldGoldCents, rec.totals.system.oldGoldCents, rupeesAlways],
    ["Gold weight (g)", rec.totals.sheet.goldMg, rec.totals.system.goldMg, (n) => (n / 1000).toFixed(3)],
  ];
  return (
    <table className="w-full text-[12px]">
      <thead className={thead}>
        <tr>
          <th className={th}>Column</th>
          <th className={cn(th, "text-right")}>Paper sheet</th>
          <th className={cn(th, "text-right")}>System</th>
          <th className={cn(th, "text-right")}>Difference</th>
        </tr>
      </thead>
      <tbody>
        {lines.map(([k, a, b, f]) => {
          const d = a - b;
          return (
            <tr key={k} className="border-t border-ink/[0.06]">
              <td className="py-1.5 pl-2 text-ink-3">{k}</td>
              <td className="g-metric py-1.5 pr-2 text-right">{f(a)}</td>
              <td className="g-metric py-1.5 pr-2 text-right">{f(b)}</td>
              <td className={cn("g-metric py-1.5 pr-2 text-right font-semibold", d === 0 ? "text-emerald-700" : "text-rose-700")}>
                {d === 0 ? <CheckCircleIcon size={13} className="inline" /> : `${d > 0 ? "+" : "−"}${f(Math.abs(d))}`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* --------------------------------------------------------------- modals */

export function NoteModal({
  title,
  kicker,
  label,
  submitLabel,
  pending,
  onClose,
  onSubmit,
}: {
  title: string;
  kicker?: string;
  label: string;
  submitLabel: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Modal title={title} kicker={kicker} onClose={onClose} onSubmit={() => onSubmit(note)} submitLabel={submitLabel} pending={pending} submitDisabled={!note.trim()}>
      <label className="block text-[12px] font-semibold text-ink-3">
        {label}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={300} className={cn(controlClass, "mt-1.5 h-auto w-full py-2")} autoFocus />
      </label>
    </Modal>
  );
}

export function LinkModal({
  row,
  system,
  takenRefs,
  pending,
  onClose,
  onLink,
}: {
  row: EditRow;
  system: SystemRow[];
  takenRefs: Set<string>;
  pending: boolean;
  onClose: () => void;
  onLink: (ref: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return system
      .filter((x) => !s || [x.refNo, x.name, x.phone, x.details, x.kind].some((v) => v?.toLowerCase().includes(s)))
      .sort((a, b) => Number(takenRefs.has(a.ref)) - Number(takenRefs.has(b.ref)));
  }, [q, system, takenRefs]);
  return (
    <Modal title="Link to a transaction" kicker={`Line: ${row.name || row.refNo || "—"}`} onClose={onClose} footer={false} wide>
      <p className="mb-2 text-[12px] text-ink-4">Pick what this line on the paper is in the books. The line is then compared with that transaction only.</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bill no, name, phone…" className={cn(controlClass, "mb-2 w-full")} autoFocus />
      <div className="max-h-[50vh] overflow-y-auto rounded-lg ring-1 ring-inset ring-ink/10 scrollbar-thin">
        {list.length === 0 ? <p className="p-4 text-[12px] text-ink-4">Nothing in the books for this day matches.</p> : null}
        {list.map((s) => {
          const l = systemAsSheetLine(s);
          return (
            <button
              key={s.ref}
              type="button"
              disabled={pending}
              onClick={() => onLink(s.ref)}
              className={cn("flex w-full items-start gap-3 border-b border-ink/[0.06] px-3 py-2 text-left text-[12px] hover:bg-gold-pale/40", row.linkedRef === s.ref && "bg-gold-pale/60")}
            >
              <span className="min-w-0 flex-1">
                <b className="text-ink">
                  {s.kind} {s.refNo}
                </b>
                <span className="text-ink-3"> · {l.who || "—"}</span>
                <span className="block truncate text-[11px] text-ink-5">{s.details}</span>
              </span>
              <span className="g-metric shrink-0 text-right text-[11.5px] text-ink-2">
                {l.received ? <span className="block text-emerald-700">+{l.received}</span> : null}
                {l.given ? <span className="block text-rose-700">−{l.given}</span> : null}
                {l.oldGold ? <span className="block text-amber-800">OG {l.oldGold}</span> : null}
              </span>
              {takenRefs.has(s.ref) ? <span className="shrink-0 rounded bg-ink/[0.06] px-1.5 text-[10px] text-ink-4">on another line</span> : null}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex justify-between">
        {row.linkedRef ? (
          <button type="button" onClick={() => onLink(null)} className="h-9 rounded-lg px-3 text-[12px] font-semibold text-rose-700 hover:bg-rose-500/10">
            Remove the link
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={onClose} className="h-9 rounded-lg px-3 text-[12px] font-semibold text-ink-3 hover:bg-bone">
          Close
        </button>
      </div>
    </Modal>
  );
}

type RecordKind = "customer_receipt" | "OTHER_INCOME" | "OWNER_CAPITAL" | "OTHER_EXPENSE" | "STAFF_TAKE" | "OWNER_DRAWING";

const RECORD_OPTIONS: { key: RecordKind; label: string; desc: string; dir: "in" | "out" }[] = [
  { key: "customer_receipt", label: "Customer paid towards a credit bill", desc: "Settles their open bills, oldest first.", dir: "in" },
  { key: "OTHER_INCOME", label: "Other income", desc: "Money in that is not a sale or bill payment.", dir: "in" },
  { key: "OWNER_CAPITAL", label: "Owner put money in", desc: "Cash the owner added to the drawer.", dir: "in" },
  { key: "OTHER_EXPENSE", label: "Other expense", desc: "Paid out for something (tea, transport, a part).", dir: "out" },
  { key: "STAFF_TAKE", label: "Staff took money", desc: "An advance to an employee, recovered from pay.", dir: "out" },
  { key: "OWNER_DRAWING", label: "Owner took money", desc: "Cash the owner took out.", dir: "out" },
];

export type RecordPayload =
  | { action: "customer_receipt"; customerId?: string; newCustomer?: { name: string; phone?: string }; amountCents: number; method: string; bankAccountId?: string; note?: string }
  | { action: "cash_entry"; kind: Exclude<RecordKind, "customer_receipt">; amountCents: number; method: string; bankAccountId?: string; person?: string; note: string };

export function RecordModal({
  row,
  branchId,
  pending,
  onClose,
  onSubmit,
}: {
  row: EditRow;
  branchId: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (p: RecordPayload) => void;
}) {
  const recC = toCents(row.rec) ?? 0;
  const givC = toCents(row.giv) ?? 0;
  const oldC = toCents(row.old) ?? 0;
  const dir: "in" | "out" = givC > recC ? "out" : "in";
  const [kind, setKind] = useState<RecordKind>(dir === "in" ? "customer_receipt" : "OTHER_EXPENSE");
  const [amount, setAmount] = useState(String((dir === "in" ? recC : givC) / 100 || ""));
  const [method, setMethod] = useState<string>(dir === "in" ? (row.recM && row.recM !== "credit" ? row.recM : "cash") : row.givM === "bank" ? "bank" : "cash");
  const [bankId, setBankId] = useState("");
  const [search, setSearch] = useState(row.phone || row.name);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [person, setPerson] = useState(row.name);
  const [note, setNote] = useState([row.refNo, row.name, row.details].filter(Boolean).join(" · "));

  const isReceipt = kind === "customer_receipt";
  const customers = useQuery({
    enabled: isReceipt && search.trim().length >= 2,
    queryKey: ["customers-search", search.trim()],
    queryFn: () => api<{ rows: { id: string; name: string; phone: string | null }[] }>(`/api/v1/customers?limit=6&search=${encodeURIComponent(search.trim())}`),
  });
  const banks = useQuery({
    enabled: method === "bank",
    queryKey: ["bank-accounts", branchId],
    queryFn: () => api<{ id: string; name: string; bank_name: string | null; is_active: number }[]>(`/api/v1/bank-accounts`),
  });
  useEffect(() => {
    const first = banks.data?.find((b) => b.is_active);
    if (first && !bankId) setBankId(first.id);
  }, [banks.data, bankId]);
  useEffect(() => {
    if (!isReceipt && !["cash", "bank"].includes(method)) setMethod("cash");
  }, [isReceipt, method]);

  const cents = toCents(amount);
  const valid =
    !!cents &&
    (method !== "bank" || !!bankId) &&
    (isReceipt ? !!customerId || !!row.name.trim() : !!note.trim() && (kind !== "STAFF_TAKE" || !!person.trim()));

  const submit = () => {
    if (!cents) return;
    const bank = method === "bank" ? bankId : undefined;
    if (isReceipt)
      onSubmit({
        action: "customer_receipt",
        customerId: customerId ?? undefined,
        newCustomer: customerId ? undefined : { name: row.name.trim(), phone: row.phone.trim() || undefined },
        amountCents: cents,
        method,
        bankAccountId: bank,
        note: note.trim() || undefined,
      });
    else onSubmit({ action: "cash_entry", kind, amountCents: cents, method, bankAccountId: bank, person: person.trim() || undefined, note: note.trim() });
  };

  return (
    <Modal title="Add to the system" kicker={`Day sheet line · ${row.name || row.refNo || "—"}`} onClose={onClose} onSubmit={submit} submitLabel="Record it" pending={pending} submitDisabled={!valid} wide>
      <div className="space-y-3 text-[12px]">
        {oldC > 0 || (row.gold && recC > 0) ? (
          <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-900 ring-1 ring-inset ring-amber-500/25">
            <b>Is this a sale or old gold?</b> Those need the pieces and weights, so record them on their own screen and come back — the line will match on its own.
            <span className="mt-1.5 flex gap-2">
              <Link href="/pos" className="font-semibold underline">
                Open POS
              </Link>
              <Link href="/old-gold/intake" className="font-semibold underline">
                Buy old gold
              </Link>
            </span>
          </div>
        ) : null}
        <div className="grid gap-1.5 sm:grid-cols-2">
          {RECORD_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setKind(o.key)}
              className={cn(
                "rounded-lg px-3 py-2 text-left ring-1 ring-inset transition-colors",
                kind === o.key ? "bg-void text-paper ring-void" : "bg-paper text-ink ring-ink/12 hover:bg-bone"
              )}
            >
              <span className="flex items-center gap-1.5 font-semibold">
                <span className={cn("text-[10px] font-bold", o.dir === "in" ? "text-emerald-500" : "text-rose-500")}>{o.dir === "in" ? "IN" : "OUT"}</span>
                {o.label}
              </span>
              <span className={cn("block text-[11px]", kind === o.key ? "text-paper/60" : "text-ink-4")}>{o.desc}</span>
            </button>
          ))}
        </div>

        {isReceipt ? (
          <div>
            <span className="font-semibold text-ink-3">Customer</span>
            <input value={search} onChange={(e) => { setSearch(e.target.value); setCustomerId(null); }} placeholder="Search name or phone" className={cn(controlClass, "mt-1 w-full")} />
            <div className="mt-1 space-y-0.5">
              {(customers.data?.rows ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCustomerId(c.id)}
                  className={cn("flex w-full justify-between rounded-md px-2 py-1 text-left hover:bg-bone", customerId === c.id && "bg-gold-pale/70 font-semibold")}
                >
                  <span>{c.name}</span>
                  <span className="text-ink-4">{c.phone}</span>
                </button>
              ))}
              {!customerId && row.name.trim() ? (
                <p className="px-2 text-[11px] text-ink-4">
                  Nobody picked: a new customer <b>{row.name}</b>
                  {row.phone ? ` (${row.phone})` : ""} will be added. The customer must owe on a credit bill, or the payment is refused.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-3">
          <label className="font-semibold text-ink-3">
            Amount (Rs)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={cn(controlClass, "mt-1 w-full text-right")} />
          </label>
          <label className="font-semibold text-ink-3">
            {kind === "customer_receipt" || RECORD_OPTIONS.find((o) => o.key === kind)?.dir === "in" ? "Received by" : "Paid from"}
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={cn(controlClass, "mt-1 w-full")}>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
              {isReceipt ? <option value="card">Card</option> : null}
              {isReceipt ? <option value="cheque">Cheque</option> : null}
            </select>
          </label>
          {method === "bank" ? (
            <label className="font-semibold text-ink-3">
              Bank account
              <select value={bankId} onChange={(e) => setBankId(e.target.value)} className={cn(controlClass, "mt-1 w-full")}>
                {(banks.data ?? [])
                  .filter((b) => b.is_active)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
        </div>
        {kind === "STAFF_TAKE" || kind === "OWNER_DRAWING" ? (
          <label className="block font-semibold text-ink-3">
            Who took it
            <input value={person} onChange={(e) => setPerson(e.target.value)} className={cn(controlClass, "mt-1 w-full")} />
          </label>
        ) : null}
        <label className="block font-semibold text-ink-3">
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={cn(controlClass, "mt-1 w-full")} />
        </label>
        <p className="flex items-center gap-1.5 text-[11px] text-ink-4">
          <AlertCircleIcon size={12} /> Posted to the books dated the sheet&apos;s day, and linked to this line.
        </p>
      </div>
    </Modal>
  );
}

