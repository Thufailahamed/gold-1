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
  Pill,
  Modal,
  Callout,
  Skeleton,
  Field,
  controlClass,
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
import { RepairChip, errMsg, grams, statusLabel, useBranches, useCustomer, when, type RepairStatus } from "../shared";
import { Card, CardHead, Empty, GoldHero, HeroBadge, ShareBar, heroGhost, heroGold, th, thead, tr } from "../../sales/kit";

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
      <Page className="space-y-4">
        <Skeleton className="h-44 rounded-[20px]" />
        <Skeleton className="h-72 rounded-2xl" />
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
  const live = job.status !== "COLLECTED" && job.status !== "CANCELLED";
  const endAt = collectedEvent?.created_at ?? cancelEvent?.created_at ?? Date.now();
  const days = Math.max(0, Math.floor((endAt - job.created_at) / 86_400_000));
  const variance = job.actual_cents == null ? null : job.actual_cents - job.estimate_cents;
  const qcFails = events.filter((e) => e.from_status === "QC" && e.to_status === "IN_PROGRESS").length;

  // Time spent in each stage, from the append-only history.
  const stageDays = STEPS.slice(0, 4).map((st) => {
    let ms = 0;
    events.forEach((e, i) => {
      if (e.to_status !== st.status) return;
      const next = events[i + 1]?.created_at ?? (job.status === st.status ? Date.now() : e.created_at);
      ms += Math.max(0, next - e.created_at);
    });
    if (st.status === "RECEIVED" && !events.some((e) => e.to_status === "RECEIVED")) {
      const first = events[0]?.created_at ?? (job.status === "RECEIVED" ? Date.now() : job.created_at);
      ms += Math.max(0, first - job.created_at);
    }
    return { ...st, days: ms / 86_400_000 };
  });
  const maxStage = Math.max(0.01, ...stageDays.map((d) => d.days));

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={HammerIcon}
        title={job.number}
        back={{ href: "/repairs", label: "Repairs" }}
        badge={<HeroBadge tone={job.status === "READY" ? "good" : job.status === "CANCELLED" ? "bad" : job.status === "COLLECTED" ? "muted" : "warn"}>{statusLabel(job.status)}</HeroBadge>}
        sub={
          <>
            {job.item_desc} · {job.repair_type} · {customer.data ? `${customer.data.name} (${customer.data.code})` : "Customer"} · {branchName} · {when(job.created_at)}
          </>
        }
        actions={
          <>
            {showAssign ? (
              <button type="button" onClick={() => setDialog("assign")} className={heroGold}>
                <UserCheckIcon size={13} /> Assign technician
              </button>
            ) : null}
            {showFinish ? (
              <button type="button" onClick={() => setDialog("finish")} className={heroGold}>
                <HammerIcon size={13} /> Repair done
              </button>
            ) : null}
            {showQc ? (
              <>
                <button type="button" onClick={() => setDialog("qc-pass")} className={heroGold}>
                  <CheckIcon size={13} /> QC pass
                </button>
                <button type="button" onClick={() => setDialog("qc-fail")} className={heroGhost}>
                  <XIcon size={13} /> QC fail
                </button>
              </>
            ) : null}
            {showCollect ? (
              <button type="button" onClick={() => setDialog("collect")} className={heroGold}>
                <BanknoteIcon size={13} /> Collect &amp; take payment
              </button>
            ) : null}
            {showCancel ? (
              <button type="button" onClick={() => setDialog("cancel")} className={`${heroGhost} !text-rose-300`}>
                <CircleSlashIcon size={13} /> Cancel
              </button>
            ) : null}
          </>
        }
        stats={[
          { label: "Weight at intake", value: job.weight_mg, format: grams, unit: "g", sub: "Snapshotted on ticket" },
          { label: "Estimate", value: job.estimate_cents / 100, format: (n) => Math.round(n).toLocaleString("en-US"), unit: "LKR", accent: job.actual_cents == null, sub: "Quoted at intake" },
          {
            label: "Actual",
            value: job.actual_cents == null ? null : job.actual_cents / 100,
            format: (n) => Math.round(n).toLocaleString("en-US"),
            unit: job.actual_cents == null ? undefined : "LKR",
            accent: job.actual_cents != null,
            sub: variance == null ? "Set when finished" : variance === 0 ? "On estimate" : `${variance > 0 ? "+" : "−"}${lkr(Math.abs(variance))} vs estimate`,
          },
          { label: live ? "In shop" : "Turnaround", value: days, unit: "days", tone: live && days >= 14 ? "bad" : live && days >= 7 ? "warn" : undefined, sub: live ? "Since intake" : "Intake to close" },
          { label: "Technician", value: null, text: userName(job.technician_id), sub: job.technician_id ? "Assigned" : "Not yet assigned" },
          { label: "QC fails", value: qcFails, tone: qcFails ? "warn" : undefined, sub: `${events.length} transitions` },
        ]}
      >
        {job.status === "CANCELLED" ? (
          <p className="text-[11.5px] text-rose-200/80">
            {cancelEvent?.reason ? `Cancelled: ${cancelEvent.reason}. ` : "Cancelled. "}Return the piece to the customer as received. Cancelled jobs cannot be reopened.
          </p>
        ) : (
          <ol className="flex flex-wrap items-center gap-1.5" aria-label="Repair progress">
            {STEPS.map((s, i) => {
              const done = i < stepIndex;
              const current = i === stepIndex;
              return (
                <li key={s.status} className="flex items-center gap-1.5" aria-current={current ? "step" : undefined}>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset",
                      done ? "bg-gold/[0.14] text-gold-light ring-gold/40" : current ? "bg-paper/10 text-paper ring-paper/25" : "text-paper/35 ring-paper/10"
                    )}
                  >
                    {done ? <CheckIcon size={11} aria-hidden /> : <span className={cn("size-1.5 rounded-full", current ? "animate-pulse-soft bg-gold" : "bg-paper/25")} />}
                    {s.label}
                    <span className="sr-only">{done ? " (done)" : current ? " (current)" : " (not started)"}</span>
                  </span>
                  {i < STEPS.length - 1 ? <span aria-hidden className={cn("h-px w-5", done ? "bg-gold/50" : "bg-paper/15")} /> : null}
                </li>
              );
            })}
          </ol>
        )}
      </GoldHero>

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

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHead icon={ClipboardCheckIcon} title="Job ticket" sub="Estimate and actual are both kept on the ticket" />
            <dl className="grid gap-px bg-ink/[0.06] sm:grid-cols-3">
              {[
                ["Item", job.item_desc],
                ["Repair type", job.repair_type],
                ["Branch", branchName],
                ["Received", when(job.created_at)],
                ["Technician", userName(job.technician_id)],
                ["Journal entry", journal ? journal.entry_no : "-"],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0 bg-paper px-4 py-2">
                  <dt className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{k}</dt>
                  <dd className="mt-0.5 truncate text-[12.5px] font-medium text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="grid gap-px border-t border-ink/[0.06] bg-ink/[0.06] sm:grid-cols-2">
              {[
                ["Condition at intake", job.condition_in],
                ["Condition at collection", job.condition_out ?? "-"],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0 bg-paper px-4 py-2">
                  <dt className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{k}</dt>
                  <dd className="mt-0.5 whitespace-pre-line text-[12.5px] leading-snug text-ink-2">{v}</dd>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHead icon={HistoryIcon} title="Status history" sub="Append-only: every transition with who made it" />
            {events.length === 0 ? (
              <Empty icon={HistoryIcon} title="No history" desc="No transitions have been recorded for this job." />
            ) : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-[12.5px]">
                  <thead className={thead}>
                    <tr>
                      <th className={cn(th, "pl-4")}>When</th>
                      <th className={th}>Change</th>
                      <th className={th}>By</th>
                      <th className={cn(th, "pr-4")}>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.id} className={tr}>
                        <td className="whitespace-nowrap py-1.5 pl-4 pr-2 text-ink-3">{when(e.created_at)}</td>
                        <td className="px-2 py-1.5">
                          {e.from_status === e.to_status ? (
                            <RepairChip status={e.to_status} />
                          ) : (
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                              <RepairChip status={e.from_status} />
                              <ArrowRightIcon size={10} className="text-ink-4" aria-label="to" />
                              <RepairChip status={e.to_status} />
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-ink-3">{userName(e.actor_id)}</td>
                        <td className="py-1.5 pl-2 pr-4 text-ink-3">{e.reason ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHead icon={UserCheckIcon} title="Customer" />
            {customer.isLoading ? (
              <div className="p-4">
                <Skeleton className="h-10 rounded-lg" />
              </div>
            ) : customer.data ? (
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold-light to-gold text-[11px] font-bold text-void">
                  {customer.data.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-ink">{customer.data.name}</span>
                  <span className="block truncate text-[11px] text-ink-4">
                    <span className="g-metric">{customer.data.code}</span>
                    {customer.data.phone ? ` · ${customer.data.phone}` : ""}
                  </span>
                </span>
              </div>
            ) : (
              <p className="px-4 py-3 text-[12px] text-ink-4">Customer not found.</p>
            )}
          </Card>

          <Card>
            <CardHead icon={BanknoteIcon} title="Charges" sub="LKR" />
            <dl className="divide-y divide-ink/[0.05] text-[12.5px]">
              <div className="flex items-center justify-between px-4 py-1.5">
                <dt className="text-ink-4">Estimate</dt>
                <dd className="g-metric text-ink">{lkr(job.estimate_cents)}</dd>
              </div>
              <div className="flex items-center justify-between px-4 py-1.5">
                <dt className="text-ink-4">Actual</dt>
                <dd className="g-metric text-ink">
                  {job.actual_cents == null ? "-" : lkr(job.actual_cents)}
                  {collectedEvent?.reason?.includes("estimate") ? (
                    <Pill tone="neutral" className="ml-2">
                      Billed at estimate
                    </Pill>
                  ) : null}
                </dd>
              </div>
              <div className={cn("flex items-center justify-between px-4 py-2", variance && variance > 0 ? "bg-amber-500/[0.07]" : "bg-gold-pale/40")}>
                <dt className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-gold-dark">Variance</dt>
                <dd className={cn("g-metric text-[14px]", variance && variance > 0 ? "text-amber-800" : "text-gold-deep")}>
                  {variance == null ? "—" : `${variance > 0 ? "+" : variance < 0 ? "−" : ""}${lkr(Math.abs(variance))}`}
                </dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHead icon={HistoryIcon} title="Time by stage" sub={`${days} day${days === 1 ? "" : "s"} ${live ? "so far" : "in all"}`} />
            <ul className="space-y-2 p-4">
              {stageDays.map((d) => (
                <li key={d.status}>
                  <div className="flex items-baseline justify-between text-[12px]">
                    <span className="text-ink-2">{d.label}</span>
                    <span className="g-metric text-ink">{d.days < 1 ? `${Math.round(d.days * 24)}h` : `${d.days.toFixed(1)}d`}</span>
                  </div>
                  <ShareBar value={(d.days / maxStage) * 100} className="mt-1 h-1" />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {dialog === "assign" ? <AssignDialog repairId={id} me={me.data} users={users} onClose={closeDialog} onDone={closeDialog} /> : null}
      {dialog === "finish" ? <FinishDialog repairId={id} onClose={closeDialog} onDone={closeDialog} /> : null}
      {dialog === "qc-pass" || dialog === "qc-fail" ? <QcDialog repairId={id} pass={dialog === "qc-pass"} onClose={closeDialog} onDone={closeDialog} /> : null}
      {dialog === "collect" ? (
        <CollectDialog repairId={id} branchId={job.branch_id} estimateCents={job.estimate_cents} onClose={closeDialog} onDone={closeDialog} />
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
