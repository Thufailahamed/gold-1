"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { hasPermission, PERMISSIONS } from "@goldos/shared";
import { api, errorCode, type MeData } from "@/lib/api";
import { lkr, toCents, type BankAccount } from "@/lib/accounts";
import {
  Page,
  Hero,
  Panel,
  TableCard,
  Pill,
  StatusPill,
  Modal,
  Callout,
  EmptyBlock,
  Skeleton,
  Field,
  DetailList,
  controlClass,
  heroBtnPrimary,
  heroBtnGhost,
} from "@/components/ui";
import {
  ArrowRightIcon,
  BanknoteIcon,
  CheckIcon,
  CircleSlashIcon,
  ClipboardCheckIcon,
  HammerIcon,
  HistoryIcon,
  PlusIcon,
  TrashIcon,
  UserCheckIcon,
  XIcon,
} from "@/components/icons";
import { cn } from "@/lib/cn";
import { errMsg, grams, statusLabel, useBranches, useCustomer, when, type RepairStatus } from "../shared";

type RepairJob = {
  id: string;
  number: string;
  customer_id: string;
  branch_id: string;
  item_desc: string;
  weight_mg: number;
  condition_in: string;
  condition_out: string | null;
  repair_type: string;
  estimate_cents: number;
  actual_cents: number | null;
  technician_id: string | null;
  status: RepairStatus;
  created_at: number;
};

type RepairEvent = {
  id: string;
  repair_id: string;
  from_status: RepairStatus;
  to_status: RepairStatus;
  actor_id: string | null;
  reason: string | null;
  created_at: number;
};

type RepairDetail = {
  job: RepairJob;
  events: RepairEvent[];
  journal: { id: string; entry_no: string } | null;
};

type UserRow = { id: string; email: string; name: string; is_active: number };
type PayMethod = "cash" | "card" | "bank" | "credit";
type PayRow = { key: number; method: PayMethod; amount: string; bankAccountId: string };

const STEPS: ReadonlyArray<{ status: RepairStatus; label: string }> = [
  { status: "RECEIVED", label: "Received" },
  { status: "IN_PROGRESS", label: "In workshop" },
  { status: "QC", label: "Quality check" },
  { status: "READY", label: "Ready" },
  { status: "COLLECTED", label: "Collected" },
];

const METHOD_LABEL: Record<PayMethod, string> = {
  cash: "Cash",
  card: "Card",
  bank: "Bank transfer",
  credit: "Customer credit (on account)",
};

type Dialog = null | "assign" | "finish" | "qc-pass" | "qc-fail" | "collect" | "cancel";

export default function RepairDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [dialog, setDialog] = useState<Dialog>(null);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const detail = useQuery({
    queryKey: ["repair", id],
    queryFn: () => api<RepairDetail>(`/api/v1/repairs/${id}`),
  });
  const job = detail.data?.job;
  const customer = useCustomer(job?.customer_id);
  const branches = useBranches();
  // Needs users:view. Without it names fall back to "You" / a short id.
  const users = useQuery({
    queryKey: ["repair-technicians"],
    queryFn: () => api<{ rows: UserRow[]; total: number }>("/api/v1/users?limit=100"),
    retry: false,
  });

  function closeDialog() {
    setDialog(null);
  }

  if (detail.isLoading) {
    return (
      <Page>
        <Skeleton className="h-56" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-64" />
      </Page>
    );
  }
  if (detail.isError || !detail.data || !job) {
    return (
      <Page>
        <Callout tone="danger" title="Repair could not be loaded">
          {errMsg(detail.error, "This repair does not exist or you cannot view it.")}{" "}
          <Link href="/repairs" className="font-medium underline">
            Back to repairs
          </Link>
        </Callout>
      </Page>
    );
  }

  const { events, journal } = detail.data;
  const perms = me.data?.permissions ?? [];
  const canCreate = hasPermission(perms, PERMISSIONS.SALES_CREATE);
  const canApprove = hasPermission(perms, PERMISSIONS.SALES_APPROVE);
  const canCancel = hasPermission(perms, PERMISSIONS.SALES_CANCEL);

  // Buttons mirror the service's NEXT table so only legal transitions are offered.
  const showAssign = job.status === "RECEIVED" && canCreate;
  const showFinish = job.status === "IN_PROGRESS" && canCreate;
  const showQc = job.status === "QC" && canApprove;
  const showCollect = job.status === "READY" && canCreate;
  const showCancel = job.status !== "COLLECTED" && job.status !== "CANCELLED" && canCancel;

  function userName(uid: string | null): string {
    if (!uid) return "-";
    if (uid === me.data?.user.id) return me.data.user.name ? `${me.data.user.name} (you)` : "You";
    return users.data?.rows.find((u) => u.id === uid)?.name ?? `${uid.slice(0, 8)}…`;
  }

  const branchName = branches.data?.rows.find((b) => b.id === job.branch_id)?.name ?? "-";
  const lastEvent = events[events.length - 1];
  const cancelEvent = [...events].reverse().find((e) => e.to_status === "CANCELLED");
  const qcFail = job.status === "IN_PROGRESS" && lastEvent?.from_status === "QC" ? lastEvent : undefined;
  const collectedEvent = events.find((e) => e.to_status === "COLLECTED");
  const stepIndex = job.status === "COLLECTED" ? STEPS.length : STEPS.findIndex((s) => s.status === job.status);

  return (
    <Page>
      <Hero
        back={{ href: "/repairs", label: "Repairs" }}
        kicker="Repair job"
        title={job.number}
        description={
          <span>
            <span className="font-medium text-paper">{job.item_desc}</span>
            <span className="text-paper/60"> — {job.repair_type}</span>
          </span>
        }
        meta={
          <>
            <Pill tone="ghost" className="!text-paper">
              {statusLabel(job.status)}
            </Pill>
            <Pill tone="ghost" className="!text-paper">
              {customer.data ? `${customer.data.name} · ${customer.data.code}` : "Customer"}
            </Pill>
            <Pill tone="ghost" className="!text-paper">
              {branchName}
            </Pill>
            <Pill tone="ghost" className="!text-paper">
              {when(job.created_at)}
            </Pill>
          </>
        }
        stats={[
          { label: "Weight at intake", value: `${grams(job.weight_mg)} g` },
          { label: "Estimate", value: `LKR ${lkr(job.estimate_cents)}` },
          { label: "Actual", value: job.actual_cents == null ? "-" : `LKR ${lkr(job.actual_cents)}` },
          { label: "Technician", value: userName(job.technician_id) },
        ]}
        actions={
          <>
            {showAssign ? (
              <button type="button" onClick={() => setDialog("assign")} className={heroBtnPrimary}>
                <UserCheckIcon size={15} /> Assign technician
              </button>
            ) : null}
            {showFinish ? (
              <button type="button" onClick={() => setDialog("finish")} className={heroBtnPrimary}>
                <HammerIcon size={15} /> Repair done
              </button>
            ) : null}
            {showQc ? (
              <>
                <button type="button" onClick={() => setDialog("qc-pass")} className={heroBtnPrimary}>
                  <CheckIcon size={15} /> QC pass
                </button>
                <button type="button" onClick={() => setDialog("qc-fail")} className={heroBtnGhost}>
                  <XIcon size={15} /> QC fail
                </button>
              </>
            ) : null}
            {showCollect ? (
              <button type="button" onClick={() => setDialog("collect")} className={heroBtnPrimary}>
                <BanknoteIcon size={15} /> Collect &amp; take payment
              </button>
            ) : null}
            {showCancel ? (
              <button type="button" onClick={() => setDialog("cancel")} className={`${heroBtnGhost} !text-rose-300`}>
                <CircleSlashIcon size={15} /> Cancel repair
              </button>
            ) : null}
          </>
        }
      />

      {job.status === "CANCELLED" ? (
        <Callout tone="danger" title="Repair cancelled">
          {cancelEvent?.reason ? `Reason: ${cancelEvent.reason}. ` : null}
          Return the piece to the customer as received. Cancelled jobs cannot be reopened.
        </Callout>
      ) : (
        <ol className="flex flex-wrap items-center gap-2" aria-label="Repair progress">
          {STEPS.map((s, i) => {
            const done = i < stepIndex;
            const current = i === stepIndex;
            return (
              <li key={s.status} className="flex items-center gap-2" aria-current={current ? "step" : undefined}>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                    done
                      ? "bg-ink text-paper"
                      : current
                        ? "bg-gold-soft text-ink shadow-[inset_0_0_0_1px_rgba(168,134,27,0.3)]"
                        : "bg-ink/[0.05] text-ink-4"
                  )}
                >
                  {done ? <CheckIcon size={12} className="text-gold" aria-hidden /> : null}
                  {s.label}
                  <span className="sr-only">{done ? " (done)" : current ? " (current)" : " (not started)"}</span>
                </span>
                {i < STEPS.length - 1 ? <ArrowRightIcon size={12} className="text-ink-5" aria-hidden /> : null}
              </li>
            );
          })}
        </ol>
      )}

      {qcFail ? (
        <Callout tone="warning" title="Returned from quality check">
          {qcFail.reason ?? "QC failed."} Fix the issue and mark the repair done again.
        </Callout>
      ) : null}
      {job.status === "RECEIVED" && !canCreate && me.data ? (
        <Callout tone="info" title="Awaiting a technician">
          Someone with the sales:create permission must assign this job.
        </Callout>
      ) : null}
      {job.status === "QC" && !canApprove && me.data ? (
        <Callout tone="info" title="Awaiting quality check">
          A supervisor with the sales:approve permission must pass or fail this repair.
        </Callout>
      ) : null}

      <Panel title="Job ticket" icon={<ClipboardCheckIcon size={17} />} description="Estimate and actual are both kept on the ticket.">
        <DetailList
          columns={3}
          items={[
            {
              label: "Customer",
              value: customer.isLoading ? (
                "…"
              ) : customer.data ? (
                <>
                  {customer.data.name} <span className="text-ink-4">· {customer.data.code}</span>
                  {customer.data.phone ? <div className="text-xs text-ink-4">{customer.data.phone}</div> : null}
                </>
              ) : (
                "-"
              ),
            },
            { label: "Branch", value: branchName },
            { label: "Received", value: when(job.created_at) },
            { label: "Item", value: job.item_desc },
            { label: "Repair type", value: job.repair_type },
            { label: "Weight at intake", value: <span className="num-tabular">{grams(job.weight_mg)} g</span> },
            { label: "Condition at intake", value: <span className="whitespace-pre-line">{job.condition_in}</span> },
            {
              label: "Condition at collection",
              value: job.condition_out ? <span className="whitespace-pre-line">{job.condition_out}</span> : "-",
            },
            { label: "Technician", value: userName(job.technician_id) },
            { label: "Estimate", value: <span className="num-tabular">LKR {lkr(job.estimate_cents)}</span> },
            {
              label: "Actual",
              value:
                job.actual_cents == null ? (
                  "-"
                ) : (
                  <span className="num-tabular">
                    LKR {lkr(job.actual_cents)}
                    {collectedEvent?.reason?.includes("estimate") ? (
                      <Pill tone="neutral" className="ml-2">
                        Billed at estimate
                      </Pill>
                    ) : null}
                  </span>
                ),
            },
            { label: "Journal entry", value: journal ? <span className="g-metric text-xs">{journal.entry_no}</span> : "-" },
          ]}
        />
      </Panel>

      <TableCard
        title="Status history"
        icon={<HistoryIcon size={17} />}
        description="Append-only: every transition is recorded with who made it."
      >
        {events.length === 0 ? (
          <EmptyBlock title="No history" description="No transitions have been recorded for this job." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Change</th>
                <th>By</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-ink-3">{when(e.created_at)}</td>
                  <td>
                    {e.from_status === e.to_status ? (
                      <StatusPill status={e.to_status} label={statusLabel(e.to_status)} />
                    ) : (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <StatusPill status={e.from_status} label={statusLabel(e.from_status)} />
                        <ArrowRightIcon size={12} className="text-ink-4" aria-label="to" />
                        <StatusPill status={e.to_status} label={statusLabel(e.to_status)} />
                      </span>
                    )}
                  </td>
                  <td className="text-ink-3">{userName(e.actor_id)}</td>
                  <td className="text-ink-3">{e.reason ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {dialog === "assign" ? (
        <AssignDialog repairId={id} me={me.data} users={users} onClose={closeDialog} onDone={closeDialog} />
      ) : null}
      {dialog === "finish" ? <FinishDialog repairId={id} onClose={closeDialog} onDone={closeDialog} /> : null}
      {dialog === "qc-pass" || dialog === "qc-fail" ? (
        <QcDialog repairId={id} pass={dialog === "qc-pass"} onClose={closeDialog} onDone={closeDialog} />
      ) : null}
      {dialog === "collect" ? (
        <CollectDialog
          repairId={id}
          branchId={job.branch_id}
          estimateCents={job.estimate_cents}
          onClose={closeDialog}
          onDone={closeDialog}
        />
      ) : null}
      {dialog === "cancel" ? <CancelDialog repairId={id} onClose={closeDialog} onDone={closeDialog} /> : null}
    </Page>
  );
}

/* ---------------------------------------------------------------- Mutations */

/**
 * POSTs one transition and refreshes the job and every repair list. A CONFLICT
 * means someone else moved the job first, so refetch to show the real state.
 */
function useRepairAction<V>(repairId: string, action: string, success: string, onDone: () => void) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["repair", repairId] });
    qc.invalidateQueries({ queryKey: ["repairs"] });
  };
  return useMutation({
    mutationFn: (body: V) =>
      api(`/api/v1/repairs/${repairId}/${action}`, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      }),
    onSuccess: () => {
      toast.success(success);
      refresh();
      onDone();
    },
    onError: (e) => {
      toast.error(errMsg(e, "Action failed"));
      if (errorCode(e) === "CONFLICT") {
        refresh();
        onDone();
      }
    },
  });
}

/* ---------------------------------------------------------------- Dialogs */

type DialogProps = { repairId: string; onClose: () => void; onDone: () => void };

function AssignDialog({
  repairId,
  me,
  users,
  onClose,
  onDone,
}: DialogProps & {
  me: MeData | undefined;
  users: { data?: { rows: UserRow[] }; isLoading: boolean; isError: boolean };
}) {
  const [technicianId, setTechnicianId] = useState("");
  const assign = useRepairAction<{ technicianId: string }>(repairId, "assign", "Technician assigned", onDone);

  // The current user is always offered, so assignment works without users:view.
  const active = (users.data?.rows ?? []).filter((u) => u.is_active === 1 && u.id !== me?.user.id);

  return (
    <Modal
      kicker="Repair job"
      title="Assign technician"
      onClose={onClose}
      onSubmit={() => assign.mutate({ technicianId })}
      pending={assign.isPending}
      submitDisabled={!technicianId}
      submitLabel="Assign & start"
    >
      <p className="text-sm text-ink-3">The job moves into the workshop as soon as a technician is assigned.</p>
      <Field label="Technician" htmlFor="repair-technician">
        <select
          id="repair-technician"
          autoFocus
          value={technicianId}
          onChange={(e) => setTechnicianId(e.target.value)}
          className={`w-full ${controlClass}`}
        >
          <option value="">{users.isLoading ? "Loading staff…" : "Select technician…"}</option>
          {me ? <option value={me.user.id}>{me.user.name} (you)</option> : null}
          {active.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} · {u.email}
            </option>
          ))}
        </select>
      </Field>
      {users.isError ? (
        <Callout tone="warning" title="Staff list unavailable">
          Listing other staff needs the users:view permission. You can still assign the job to yourself.
        </Callout>
      ) : null}
    </Modal>
  );
}

function FinishDialog({ repairId, onClose, onDone }: DialogProps) {
  const finish = useRepairAction<Record<string, never>>(repairId, "finish", "Sent to quality check", onDone);
  return (
    <Modal
      kicker="Repair job"
      title="Repair done"
      onClose={onClose}
      onSubmit={() => finish.mutate({})}
      pending={finish.isPending}
      submitLabel="Send to QC"
    >
      <p className="text-sm text-ink-3">
        The piece goes to quality check. A supervisor passes it for collection or sends it back to the workshop.
      </p>
    </Modal>
  );
}

function QcDialog({ repairId, pass, onClose, onDone }: DialogProps & { pass: boolean }) {
  const [reason, setReason] = useState("");
  const qc = useRepairAction<{ pass: boolean; reason?: string }>(
    repairId,
    "qc",
    pass ? "QC passed — ready to collect" : "QC failed — back to the workshop",
    onDone
  );
  return (
    <Modal
      kicker="Quality check"
      title={pass ? "Pass quality check" : "Fail quality check"}
      danger={!pass}
      onClose={onClose}
      onSubmit={() => qc.mutate({ pass, ...(reason.trim() ? { reason: reason.trim() } : {}) })}
      pending={qc.isPending}
      submitDisabled={!pass && !reason.trim()}
      submitLabel={pass ? "Pass" : "Fail & return"}
    >
      <p className="text-sm text-ink-3">
        {pass
          ? "The job becomes ready for the customer to collect and pay."
          : "The job returns to the workshop. Say what must be fixed."}
      </p>
      <Field label={pass ? "Note (optional)" : "Reason"} htmlFor="repair-qc-reason">
        <input
          id="repair-qc-reason"
          autoFocus
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          className={`w-full ${controlClass}`}
        />
      </Field>
    </Modal>
  );
}

function CancelDialog({ repairId, onClose, onDone }: DialogProps) {
  const [reason, setReason] = useState("");
  const cancel = useRepairAction<{ reason: string }>(repairId, "cancel", "Repair cancelled", onDone);
  return (
    <Modal
      kicker="Repair job"
      title="Cancel repair"
      danger
      onClose={onClose}
      onSubmit={() => cancel.mutate({ reason: reason.trim() })}
      pending={cancel.isPending}
      submitDisabled={!reason.trim()}
      submitLabel="Cancel repair"
    >
      <p className="text-sm text-ink-3">No money is posted. The piece is returned to the customer as received.</p>
      <Field label="Reason" htmlFor="repair-cancel-reason">
        <input
          id="repair-cancel-reason"
          autoFocus
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          className={`w-full ${controlClass}`}
        />
      </Field>
    </Modal>
  );
}

let payKey = 0;
const newPayRow = (amount: string): PayRow => ({ key: ++payKey, method: "cash", amount, bankAccountId: "" });

function CollectDialog({
  repairId,
  branchId,
  estimateCents,
  onClose,
  onDone,
}: DialogProps & { branchId: string; estimateCents: number }) {
  const [conditionOut, setConditionOut] = useState("");
  const [override, setOverride] = useState(false);
  const [actual, setActual] = useState("");
  const [payments, setPayments] = useState<PayRow[]>(() => [newPayRow((estimateCents / 100).toFixed(2))]);

  const banks = useQuery({ queryKey: ["bank-accounts"], queryFn: () => api<BankAccount[]>("/api/v1/bank-accounts"), retry: false });
  const bankRows = (banks.data ?? []).filter((b) => b.is_active === 1 && (!b.branch_id || b.branch_id === branchId));

  const collect = useRepairAction<{
    payments: { method: PayMethod; amountLkr: number; bankAccountId?: string }[];
    actualLkr?: number;
    conditionOut: string;
  }>(repairId, "collect", "Repair collected and payment posted", onDone);

  // Work in cents throughout: the API refuses unless payments sum to the billed amount exactly.
  const actualCents = override ? toCents(actual) : estimateCents;
  const actualOk = Number.isFinite(actualCents) && actualCents > 0;
  const legCents = payments.map((p) => toCents(p.amount));
  const legsOk = legCents.every((c) => Number.isFinite(c) && c > 0);
  const paidCents = legsOk ? legCents.reduce((n, c) => n + c, 0) : Number.NaN;
  const balanced = actualOk && legsOk && paidCents === actualCents;
  const ready = balanced && !!conditionOut.trim();

  function patch(key: number, next: Partial<PayRow>) {
    setPayments((rows) => rows.map((r) => (r.key === key ? { ...r, ...next } : r)));
  }

  function submit() {
    if (!ready) return;
    collect.mutate({
      conditionOut: conditionOut.trim(),
      ...(override ? { actualLkr: actualCents / 100 } : {}),
      payments: payments.map((p, i) => ({
        method: p.method,
        amountLkr: (legCents[i] ?? 0) / 100,
        ...(p.method === "bank" && p.bankAccountId ? { bankAccountId: p.bankAccountId } : {}),
      })),
    });
  }

  return (
    <Modal
      kicker="Repair job"
      title="Collect & take payment"
      wide
      onClose={onClose}
      onSubmit={submit}
      pending={collect.isPending}
      submitDisabled={!ready}
      submitLabel="Collect"
    >
      <Field label="Condition at collection" htmlFor="repair-condition-out" hint="Record what the customer is handed back.">
        <textarea
          id="repair-condition-out"
          autoFocus
          rows={3}
          value={conditionOut}
          maxLength={1000}
          onChange={(e) => setConditionOut(e.target.value)}
          className={`w-full py-2 !h-auto ${controlClass}`}
        />
      </Field>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            className="accent-gold"
            checked={override}
            onChange={(e) => {
              setOverride(e.target.checked);
              if (e.target.checked && !actual) setActual((estimateCents / 100).toFixed(2));
            }}
          />
          Bill a different amount than the estimate (LKR {lkr(estimateCents)})
        </label>
        {override ? (
          <Field
            label="Actual cost (LKR)"
            htmlFor="repair-actual"
            error={actual && !actualOk ? "Enter an amount above 0 with at most 2 decimals" : undefined}
            hint="Stored beside the estimate; both stay on the ticket."
          >
            <input
              id="repair-actual"
              inputMode="decimal"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              className={`w-full num-tabular ${controlClass}`}
            />
          </Field>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-ink-3">Payments</span>
          <button
            type="button"
            disabled={payments.length >= 10}
            onClick={() => {
              const rest = actualOk && legsOk ? Math.max(actualCents - paidCents, 0) : 0;
              setPayments((rows) => [...rows, newPayRow(rest > 0 ? (rest / 100).toFixed(2) : "")]);
            }}
            className="g-btn g-btn-secondary h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PlusIcon size={13} /> Split payment
          </button>
        </div>
        {payments.map((p, i) => (
          <div key={p.key} className="flex flex-wrap items-center gap-2">
            <label htmlFor={`repair-pay-method-${p.key}`} className="sr-only">
              Payment {i + 1} method
            </label>
            <select
              id={`repair-pay-method-${p.key}`}
              value={p.method}
              onChange={(e) => patch(p.key, { method: e.target.value as PayMethod })}
              className={controlClass}
            >
              {(Object.keys(METHOD_LABEL) as PayMethod[]).map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </select>
            {p.method === "bank" ? (
              <>
                <label htmlFor={`repair-pay-bank-${p.key}`} className="sr-only">
                  Payment {i + 1} bank account
                </label>
                <select
                  id={`repair-pay-bank-${p.key}`}
                  value={p.bankAccountId}
                  onChange={(e) => patch(p.key, { bankAccountId: e.target.value })}
                  className={controlClass}
                >
                  <option value="">Main bank account</option>
                  {bankRows.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.account_number ? ` · ${b.account_number}` : ""}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            <label htmlFor={`repair-pay-amount-${p.key}`} className="sr-only">
              Payment {i + 1} amount (LKR)
            </label>
            <input
              id={`repair-pay-amount-${p.key}`}
              inputMode="decimal"
              value={p.amount}
              onChange={(e) => patch(p.key, { amount: e.target.value })}
              placeholder="0.00"
              className={`w-36 num-tabular ${controlClass}`}
            />
            {payments.length > 1 ? (
              <button
                type="button"
                aria-label={`Remove payment ${i + 1}`}
                onClick={() => setPayments((rows) => rows.filter((r) => r.key !== p.key))}
                className="flex size-9 items-center justify-center rounded-lg text-ink-4 transition-colors hover:bg-ink/5 hover:text-rose-700"
              >
                <TrashIcon size={15} />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between rounded-lg bg-bone/60 px-4 py-3 text-sm">
        <span className="text-ink-3">
          Billed <span className="num-tabular font-medium text-ink">{actualOk ? `LKR ${lkr(actualCents)}` : "-"}</span>
        </span>
        <span className="text-ink-3">
          Paid <span className="num-tabular font-medium text-ink">{legsOk ? `LKR ${lkr(paidCents)}` : "-"}</span>
        </span>
        {balanced ? (
          <Pill tone="success" dot>
            Balanced
          </Pill>
        ) : actualOk && legsOk ? (
          <Pill tone="warning" dot>
            {paidCents < actualCents ? `LKR ${lkr(actualCents - paidCents)} short` : `LKR ${lkr(paidCents - actualCents)} over`}
          </Pill>
        ) : (
          <Pill tone="danger" dot>
            Check amounts
          </Pill>
        )}
      </div>
      {banks.isError && payments.some((p) => p.method === "bank") ? (
        <Callout tone="warning" title="Bank accounts unavailable">
          Listing bank accounts needs accounts:view. Bank payments will post to the main bank account.
        </Callout>
      ) : null}
    </Modal>
  );
}
