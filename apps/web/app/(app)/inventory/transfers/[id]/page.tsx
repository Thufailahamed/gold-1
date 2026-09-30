"use client";

import { use, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { hasPermission, mgToG } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { normalizeCode } from "@/lib/barcode";
import { CameraScanButton } from "@/components/camera-scan";
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
  controlClass,
  heroBtnPrimary,
  heroBtnGhost,
} from "@/components/ui";
import {
  ArrowRightIcon,
  ArrowUturnLeftIcon,
  CheckIcon,
  CircleSlashIcon,
  ClipboardCheckIcon,
  PackageIcon,
  RefreshCwIcon,
  ScanBarcodeIcon,
  TruckIcon,
} from "@/components/icons";
import { cn } from "@/lib/cn";

type TransferStatus = "REQUESTED" | "APPROVED" | "DISPATCHED" | "PARTIAL" | "COMPLETE" | "CANCELLED";
type LineStatus = "PENDING" | "IN_TRANSIT" | "RECEIVED" | "RECALLED";

type TransferLine = {
  id: string;
  productId: string;
  barcode: string;
  status: LineStatus;
  name: string | null;
  karat: string | null;
  netMg: number | null;
  productStatus: string | null;
};

type TransferDetail = {
  id: string;
  number: string;
  fromBranchId: string;
  toBranchId: string;
  fromBranchName: string;
  toBranchName: string;
  status: TransferStatus;
  reason: string | null;
  requestedBy: string | null;
  requestedByName: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  createdAt: number | null;
  totalNetMg: number;
  lines: TransferLine[];
};

type Approver = { id: string; name: string };
type Reconcile = { passed: boolean; warnings: string[] };
type ReceiveResult = { received: string[]; skipped: string[] };
type ScanLog = { key: number; code: string; outcome: "received" | "skipped" | "error"; message: string };

const STATUS_LABEL: Record<TransferStatus, string> = {
  REQUESTED: "Awaiting approval",
  APPROVED: "Approved",
  DISPATCHED: "In transit",
  PARTIAL: "Partially received",
  COMPLETE: "Complete",
  CANCELLED: "Cancelled",
};

const LINE_LABEL: Record<LineStatus, string> = {
  PENDING: "Pending",
  IN_TRANSIT: "In transit",
  RECEIVED: "Received",
  RECALLED: "Recalled",
};

const STEPS = ["Requested", "Approved", "Dispatched", "Received"];

/** Index of the step currently in progress; steps before it are done. */
function stepOf(status: TransferStatus): number {
  switch (status) {
    case "REQUESTED":
      return 1;
    case "APPROVED":
      return 2;
    case "DISPATCHED":
    case "PARTIAL":
      return 3;
    case "COMPLETE":
      return 4;
    default:
      return -1;
  }
}

const DISPATCHED_STATES: ReadonlyArray<TransferStatus> = ["DISPATCHED", "PARTIAL", "COMPLETE"];
const grams = (mg: number) => mgToG(mg).toLocaleString("en-US", { maximumFractionDigits: 3 });
const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<null | "approve" | "dispatch" | "cancel" | "recall">(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const detail = useQuery({
    queryKey: ["transfer", id],
    queryFn: () => api<TransferDetail>(`/api/v1/transfers/${id}`),
  });

  const t = detail.data;
  const dispatched = !!t && DISPATCHED_STATES.includes(t.status);

  const reconcile = useQuery({
    queryKey: ["transfer-reconcile", id],
    queryFn: () => api<Reconcile>(`/api/v1/transfers/${id}/reconcile`),
    enabled: dispatched,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["transfer", id] });
    qc.invalidateQueries({ queryKey: ["transfer-reconcile", id] });
    qc.invalidateQueries({ queryKey: ["transfer-approvers", id] });
    qc.invalidateQueries({ queryKey: ["transfers"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  }

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
  if (detail.isError || !t) {
    return (
      <Page>
        <Callout tone="danger" title="Transfer could not be loaded">
          {errMsg(detail.error, "This transfer does not exist or you cannot view it.")}{" "}
          <Link href="/inventory/transfers" className="font-medium underline">
            Back to transfers
          </Link>
        </Callout>
      </Page>
    );
  }

  const perms = me.data?.permissions ?? [];
  const myBranches = me.data?.branchIds ?? [];
  const manage = hasPermission(perms, "branches:manage");
  const isSender = manage || myBranches.includes(t.fromBranchId);
  const isReceiver = manage || myBranches.includes(t.toBranchId);
  const canEdit = hasPermission(perms, "products:edit");
  const canApprove = hasPermission(perms, "products:cancel");

  const inTransitLines = t.lines.filter((l) => l.status === "IN_TRANSIT");
  const receivedCount = t.lines.filter((l) => l.status === "RECEIVED").length;
  const inTransit = t.status === "DISPATCHED" || t.status === "PARTIAL";
  const showApprove = t.status === "REQUESTED" && isSender && canApprove;
  const showDispatch = t.status === "APPROVED" && isSender && canEdit;
  const showCancel = (t.status === "REQUESTED" || t.status === "APPROVED") && isSender && canEdit;
  const showReceive = inTransit && isReceiver && canEdit;
  const showRecall = inTransit && isSender && canEdit;
  const selectable = (showReceive || showRecall) && inTransitLines.length > 0;

  // Only IN_TRANSIT lines may be selected; drop stale selections after a refetch.
  const selectedLines = inTransitLines.filter((l) => selected.has(l.productId));
  const allSelected = selectedLines.length === inTransitLines.length && inTransitLines.length > 0;

  function toggle(productId: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(productId)) n.delete(productId);
      else n.add(productId);
      return n;
    });
  }

  const step = stepOf(t.status);

  return (
    <Page>
      <Hero
        back={{ href: "/inventory/transfers", label: "Branch transfers" }}
        kicker="Branch transfer"
        title={t.number}
        description={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-paper">{t.fromBranchName}</span>
            <ArrowRightIcon size={13} className="text-gold" aria-label="to" />
            <span className="font-medium text-paper">{t.toBranchName}</span>
            {t.reason ? <span className="text-paper/60">— {t.reason}</span> : null}
          </span>
        }
        meta={
          <>
            <Pill tone="ghost" className="!text-paper">
              {STATUS_LABEL[t.status] ?? t.status}
            </Pill>
            <Pill tone="ghost" className="!text-paper">
              Requested by {t.requestedByName ?? "-"}
            </Pill>
            {t.approvedByName ? (
              <Pill tone="ghost" className="!text-paper">
                Approved by {t.approvedByName}
              </Pill>
            ) : null}
            <Pill tone="ghost" className="!text-paper">
              {t.createdAt ? new Date(t.createdAt).toLocaleString() : "-"}
            </Pill>
          </>
        }
        stats={[
          { label: "Pieces", value: t.lines.length },
          { label: "Net weight", value: `${grams(t.totalNetMg)} g` },
          { label: "Received", value: `${receivedCount}/${t.lines.length}` },
          { label: "In transit", value: inTransitLines.length },
        ]}
        actions={
          <>
            {showApprove ? (
              <button type="button" onClick={() => setDialog("approve")} className={heroBtnPrimary}>
                <CheckIcon size={15} /> Approve
              </button>
            ) : null}
            {showDispatch ? (
              <button type="button" onClick={() => setDialog("dispatch")} className={heroBtnPrimary}>
                <TruckIcon size={15} /> Dispatch
              </button>
            ) : null}
            {showCancel ? (
              <button type="button" onClick={() => setDialog("cancel")} className={`${heroBtnGhost} !text-rose-300`}>
                <CircleSlashIcon size={15} /> Cancel transfer
              </button>
            ) : null}
          </>
        }
      />

      {t.status === "CANCELLED" ? (
        <Callout tone="danger" title="Transfer cancelled">
          This transfer was cancelled before dispatch. The pieces never left the sending branch.
        </Callout>
      ) : (
        <ol className="flex flex-wrap items-center gap-2" aria-label="Transfer progress">
          {STEPS.map((s, i) => {
            const done = i < step;
            const current = i === step;
            const label = s === "Received" && t.status === "PARTIAL" ? "Received (partial)" : s;
            return (
              <li key={s} className="flex items-center gap-2" aria-current={current ? "step" : undefined}>
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
                  {label}
                  <span className="sr-only">{done ? " (done)" : current ? " (in progress)" : " (not started)"}</span>
                </span>
                {i < STEPS.length - 1 ? <ArrowRightIcon size={12} className="text-ink-5" aria-hidden /> : null}
              </li>
            );
          })}
        </ol>
      )}

      {t.status === "REQUESTED" && !isSender && me.data ? (
        <Callout tone="info" title="Waiting on the sending branch">
          {t.fromBranchName} must approve and dispatch this transfer.
        </Callout>
      ) : null}
      {t.status === "APPROVED" && !isSender && me.data ? (
        <Callout tone="info" title="Approved — awaiting dispatch">
          {t.fromBranchName} will dispatch the pieces. You can receive them once they are in transit.
        </Callout>
      ) : null}

      {showReceive ? <ReceivePanel transferId={id} onReceived={refresh} /> : null}

      <TableCard
        title="Pieces"
        icon={<PackageIcon size={17} />}
        description={`${t.lines.length} piece${t.lines.length === 1 ? "" : "s"} · ${grams(t.totalNetMg)} g net`}
        actions={
          selectable ? (
            <>
              <span className="text-xs text-ink-4 num-tabular">{selectedLines.length} selected</span>
              {showReceive ? (
                <ReceiveSelectedButton
                  transferId={id}
                  barcodes={selectedLines.map((l) => l.barcode)}
                  onDone={() => {
                    setSelected(new Set());
                    refresh();
                  }}
                />
              ) : null}
              {showRecall ? (
                <button
                  type="button"
                  disabled={selectedLines.length === 0}
                  onClick={() => setDialog("recall")}
                  className="g-btn g-btn-secondary h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ArrowUturnLeftIcon size={13} /> Recall selected
                </button>
              ) : null}
            </>
          ) : null
        }
      >
        {t.lines.length === 0 ? (
          <EmptyBlock title="No pieces" description="This transfer has no lines." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                {selectable ? (
                  <th className="w-10">
                    <input
                      type="checkbox"
                      className="accent-gold"
                      aria-label="Select all in-transit pieces"
                      checked={allSelected}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(inTransitLines.map((l) => l.productId)) : new Set())
                      }
                    />
                  </th>
                ) : null}
                <th>Barcode</th>
                <th>Item</th>
                <th>Karat</th>
                <th className="!text-right">Net g</th>
                <th>Line status</th>
                <th>Piece status</th>
              </tr>
            </thead>
            <tbody>
              {t.lines.map((l) => (
                <tr key={l.id}>
                  {selectable ? (
                    <td>
                      {l.status === "IN_TRANSIT" ? (
                        <input
                          type="checkbox"
                          className="accent-gold"
                          aria-label={`Select ${l.barcode}`}
                          checked={selected.has(l.productId)}
                          onChange={() => toggle(l.productId)}
                        />
                      ) : null}
                    </td>
                  ) : null}
                  <td className="g-metric text-xs">{l.barcode}</td>
                  <td>
                    <Link href={`/products/${l.productId}`} className="font-medium text-ink hover:text-gold-700">
                      {l.name ?? l.barcode}
                    </Link>
                  </td>
                  <td className="text-ink-3">{l.karat ?? "-"}</td>
                  <td className="!text-right num-tabular">{l.netMg == null ? "-" : grams(l.netMg)}</td>
                  <td>
                    <StatusPill status={l.status} label={LINE_LABEL[l.status] ?? l.status} />
                  </td>
                  <td>
                    <StatusPill status={l.productStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {dispatched ? (
        <Panel
          title="Reconciliation"
          icon={<ClipboardCheckIcon size={17} />}
          description="Checks that every line, piece status and branch agree."
          actions={
            <button
              type="button"
              onClick={() => reconcile.refetch()}
              disabled={reconcile.isFetching}
              className="g-btn g-btn-secondary h-8 px-3 text-xs disabled:opacity-50"
            >
              <RefreshCwIcon size={13} /> {reconcile.isFetching ? "Checking…" : "Re-run"}
            </button>
          }
        >
          {reconcile.isLoading ? (
            <Skeleton className="h-14" />
          ) : reconcile.isError ? (
            <Callout tone="danger" title="Reconcile failed">
              {errMsg(reconcile.error, "Could not run the reconciliation.")}
            </Callout>
          ) : reconcile.data?.passed ? (
            <Callout tone="success" title="Reconciled">
              Lines and piece records agree.
              {reconcile.data.warnings.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {reconcile.data.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </Callout>
          ) : reconcile.data ? (
            <Callout tone="danger" title="Reconciliation found problems">
              <ul className="list-disc space-y-1 pl-5">
                {reconcile.data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Callout>
          ) : null}
        </Panel>
      ) : null}

      {dialog === "approve" ? (
        <ApproveDialog
          transferId={id}
          fromBranchName={t.fromBranchName}
          onClose={closeDialog}
          onDone={() => {
            closeDialog();
            refresh();
          }}
        />
      ) : null}
      {dialog === "dispatch" ? (
        <DispatchDialog
          transferId={id}
          pieces={t.lines.filter((l) => l.status === "PENDING").length}
          netMg={t.totalNetMg}
          toBranchName={t.toBranchName}
          onClose={closeDialog}
          onDone={() => {
            closeDialog();
            refresh();
          }}
        />
      ) : null}
      {dialog === "cancel" ? (
        <CancelDialog
          transferId={id}
          onClose={closeDialog}
          onDone={() => {
            closeDialog();
            refresh();
          }}
        />
      ) : null}
      {dialog === "recall" ? (
        <RecallDialog
          transferId={id}
          lines={selectedLines}
          fromBranchName={t.fromBranchName}
          onClose={closeDialog}
          onDone={() => {
            closeDialog();
            setSelected(new Set());
            refresh();
          }}
        />
      ) : null}
    </Page>
  );
}

/* ---------------------------------------------------------------- Receive */

function ReceivePanel({ transferId, onReceived }: { transferId: string; onReceived: () => void }) {
  const [scan, setScan] = useState("");
  const [log, setLog] = useState<ScanLog[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);

  function push(entry: Omit<ScanLog, "key">) {
    setLog((l) => [{ ...entry, key: Date.now() + Math.random() }, ...l].slice(0, 8));
  }

  const receive = useMutation({
    mutationFn: (code: string) =>
      api<ReceiveResult>(`/api/v1/transfers/${transferId}/receive`, {
        method: "POST",
        body: JSON.stringify({ barcodes: [code] }),
      }),
    onSuccess: (d, code) => {
      if (d.received.length > 0) {
        toast.success(`Received ${d.received.join(", ")}`);
        push({ code, outcome: "received", message: "Received" });
      } else {
        toast.info(`${code} was already received`);
        push({ code, outcome: "skipped", message: "Already received — skipped" });
      }
      onReceived();
    },
    onError: (e, code) => {
      const message = errMsg(e, "Receive failed");
      toast.error(message);
      push({ code, outcome: "error", message });
    },
    onSettled: () => {
      setScan("");
      scanRef.current?.focus();
    },
  });

  function submit(raw: string) {
    const code = normalizeCode(raw);
    if (!code) {
      setScan("");
      scanRef.current?.focus();
      return;
    }
    receive.mutate(code);
  }

  return (
    <Panel
      title="Receive pieces"
      icon={<ScanBarcodeIcon size={17} />}
      description="Scan each piece as it arrives. Every scan is received immediately; repeats are skipped."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(scan);
        }}
        className="flex gap-2"
      >
        <label htmlFor="receive-scan" className="sr-only">
          Scan barcode to receive
        </label>
        <input
          id="receive-scan"
          ref={scanRef}
          autoFocus
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          placeholder="Scan barcode to receive…"
          autoComplete="off"
          className={`min-w-0 flex-1 font-mono ${controlClass}`}
        />
        <CameraScanButton onDetected={(c) => submit(c)} tone="light" />
        <button
          type="submit"
          disabled={receive.isPending}
          className="g-btn g-btn-primary h-10 px-4 text-sm disabled:opacity-50"
        >
          {receive.isPending ? "Receiving…" : "Receive"}
        </button>
      </form>
      {log.length > 0 ? (
        <ul className="mt-4 space-y-1.5 text-sm" aria-live="polite" aria-label="Recent scans">
          {log.map((e) => (
            <li key={e.key} className="flex items-center justify-between gap-3">
              <span className="g-metric text-xs text-ink-3">{e.code}</span>
              <Pill tone={e.outcome === "received" ? "success" : e.outcome === "skipped" ? "neutral" : "danger"} dot>
                {e.message}
              </Pill>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

function ReceiveSelectedButton({
  transferId,
  barcodes,
  onDone,
}: {
  transferId: string;
  barcodes: string[];
  onDone: () => void;
}) {
  const receive = useMutation({
    mutationFn: () =>
      api<ReceiveResult>(`/api/v1/transfers/${transferId}/receive`, {
        method: "POST",
        body: JSON.stringify({ barcodes }),
      }),
    onSuccess: (d) => {
      const parts = [`${d.received.length} received`];
      if (d.skipped.length > 0) parts.push(`${d.skipped.length} already received`);
      toast.success(parts.join(", "));
      onDone();
    },
    onError: (e) => toast.error(errMsg(e, "Receive failed")),
  });
  return (
    <button
      type="button"
      disabled={barcodes.length === 0 || receive.isPending}
      onClick={() => receive.mutate()}
      className="g-btn g-btn-primary h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
    >
      <CheckIcon size={13} /> {receive.isPending ? "Receiving…" : "Receive selected"}
    </button>
  );
}

/* ---------------------------------------------------------------- Dialogs */

function ApproveDialog({
  transferId,
  fromBranchName,
  onClose,
  onDone,
}: {
  transferId: string;
  fromBranchName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [approvedBy, setApprovedBy] = useState("");
  const approvers = useQuery({
    queryKey: ["transfer-approvers", transferId],
    queryFn: () => api<Approver[]>(`/api/v1/transfers/${transferId}/approvers`),
  });
  const approve = useMutation({
    mutationFn: () =>
      api(`/api/v1/transfers/${transferId}/approve`, {
        method: "POST",
        body: JSON.stringify({ approvedBy }),
      }),
    onSuccess: () => {
      toast.success("Transfer approved");
      onDone();
    },
    onError: (e) => toast.error(errMsg(e, "Approve failed")),
  });
  const list = approvers.data ?? [];
  return (
    <Modal
      kicker="Branch transfer"
      title="Approve transfer"
      onClose={onClose}
      onSubmit={list.length > 0 ? () => approve.mutate() : undefined}
      pending={approve.isPending}
      submitDisabled={!approvedBy}
      submitLabel="Approve"
    >
      {approvers.isLoading ? (
        <Skeleton className="h-10" />
      ) : approvers.isError ? (
        <Callout tone="danger" title="Could not load approvers">
          {errMsg(approvers.error, "Retry in a moment.")}
        </Callout>
      ) : list.length === 0 ? (
        <Callout tone="warning" title="No eligible approver">
          Someone else at {fromBranchName} with the products:cancel permission must approve this transfer. The
          requester cannot approve their own request.
        </Callout>
      ) : (
        <Field
          label="Approver"
          htmlFor="transfer-approver"
          hint={`A ${fromBranchName} member other than the requester.`}
        >
          <select
            id="transfer-approver"
            value={approvedBy}
            onChange={(e) => setApprovedBy(e.target.value)}
            className={`w-full ${controlClass}`}
          >
            <option value="">Select approver…</option>
            {list.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {list.length === 0 && !approvers.isLoading ? (
        <div className="flex justify-end pt-1">
          <button type="button" onClick={onClose} className="g-btn g-btn-secondary h-10 px-4 text-sm">
            Close
          </button>
        </div>
      ) : null}
    </Modal>
  );
}

function DispatchDialog({
  transferId,
  pieces,
  netMg,
  toBranchName,
  onClose,
  onDone,
}: {
  transferId: string;
  pieces: number;
  netMg: number;
  toBranchName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const dispatch = useMutation({
    mutationFn: () => api(`/api/v1/transfers/${transferId}/dispatch`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Transfer dispatched");
      onDone();
    },
    onError: (e) => toast.error(errMsg(e, "Dispatch failed")),
  });
  return (
    <Modal
      kicker="Branch transfer"
      title="Dispatch transfer"
      onClose={onClose}
      onSubmit={() => dispatch.mutate()}
      pending={dispatch.isPending}
      submitLabel="Dispatch"
    >
      <p className="text-sm text-ink-3">
        {pieces} piece{pieces === 1 ? "" : "s"} ({grams(netMg)} g net) will leave stock and go in transit to{" "}
        <span className="font-medium text-ink">{toBranchName}</span>. They cannot be sold until received.
      </p>
    </Modal>
  );
}

function CancelDialog({
  transferId,
  onClose,
  onDone,
}: {
  transferId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const cancel = useMutation({
    mutationFn: () =>
      api(`/api/v1/transfers/${transferId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      }),
    onSuccess: () => {
      toast.success("Transfer cancelled");
      onDone();
    },
    onError: (e) => toast.error(errMsg(e, "Cancel failed")),
  });
  return (
    <Modal
      kicker="Branch transfer"
      title="Cancel transfer"
      danger
      onClose={onClose}
      onSubmit={() => cancel.mutate()}
      pending={cancel.isPending}
      submitDisabled={!reason.trim()}
      submitLabel="Cancel transfer"
    >
      <Field label="Reason" htmlFor="transfer-cancel-reason">
        <input
          id="transfer-cancel-reason"
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

function RecallDialog({
  transferId,
  lines,
  fromBranchName,
  onClose,
  onDone,
}: {
  transferId: string;
  lines: TransferLine[];
  fromBranchName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const recall = useMutation({
    mutationFn: () =>
      api(`/api/v1/transfers/${transferId}/recall`, {
        method: "POST",
        body: JSON.stringify({ productIds: lines.map((l) => l.productId) }),
      }),
    onSuccess: () => {
      toast.success(`Recalled ${lines.length} piece${lines.length === 1 ? "" : "s"}`);
      onDone();
    },
    onError: (e) => toast.error(errMsg(e, "Recall failed")),
  });
  return (
    <Modal
      kicker="Branch transfer"
      title="Recall pieces"
      danger
      onClose={onClose}
      onSubmit={() => recall.mutate()}
      pending={recall.isPending}
      submitDisabled={lines.length === 0}
      submitLabel="Recall"
    >
      <p className="text-sm text-ink-3">
        These in-transit pieces return to {fromBranchName} stock and can no longer be received:
      </p>
      <ul className="space-y-1 text-sm">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3">
            <span className="g-metric text-xs text-ink-3">{l.barcode}</span>
            <span className="truncate text-ink">{l.name ?? "-"}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
