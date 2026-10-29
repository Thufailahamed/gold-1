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
  Pill,
  Modal,
  Callout,
  Skeleton,
  Field,
  controlClass,
} from "@/components/ui";
import {
  ArrowLeftRightIcon,
  ArrowRightIcon,
  ArrowUturnLeftIcon,
  CheckIcon,
  CircleSlashIcon,
  ClipboardCheckIcon,
  GemIcon,
  PackageIcon,
  RefreshCwIcon,
  ScanBarcodeIcon,
  TruckIcon,
} from "@/components/icons";
import { cn } from "@/lib/cn";
import { Card, CardHead, Empty, GoldHero, HeroBadge, PieceChip, ShareBar, heroGhost, heroGold, stamp, th, thead, tr } from "../../kit";

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
  createdAt: number | null;
  totalNetMg: number;
  lines: TransferLine[];
};

type Reconcile = { passed: boolean; warnings: string[] };
type ReceiveResult = { received: string[]; skipped: string[] };
type ScanLog = { key: number; code: string; outcome: "received" | "skipped" | "error"; message: string };

const LINE_META: Record<LineStatus, { label: string; chip: string; dot: string }> = {
  PENDING: { label: "Pending", chip: "bg-ink/[0.05] text-ink-3 ring-ink/20", dot: "bg-ink/30" },
  IN_TRANSIT: { label: "In transit", chip: "bg-gold/15 text-gold-deep ring-gold/35", dot: "bg-gold" },
  RECEIVED: { label: "Received", chip: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25", dot: "bg-emerald-500" },
  RECALLED: { label: "Recalled", chip: "bg-rose-500/10 text-rose-800 ring-rose-500/25", dot: "bg-rose-500" },
};

const STEPS = ["Requested", "Dispatched", "Received"];

/** Index of the step currently in progress; steps before it are done. */
function stepOf(status: TransferStatus): number {
  switch (status) {
    case "REQUESTED":
    case "APPROVED":
      return 1;
    case "DISPATCHED":
    case "PARTIAL":
      return 2;
    case "COMPLETE":
      return 3;
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
  const [dialog, setDialog] = useState<null | "dispatch" | "cancel" | "recall">(null);
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
    qc.invalidateQueries({ queryKey: ["transfers"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  }

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

  const inTransitLines = t.lines.filter((l) => l.status === "IN_TRANSIT");
  const lineCount = (st: LineStatus) => t.lines.filter((l) => l.status === st).length;
  const receivedCount = lineCount("RECEIVED");
  const inTransit = t.status === "DISPATCHED" || t.status === "PARTIAL";
  const showDispatch = (t.status === "REQUESTED" || t.status === "APPROVED") && isSender && canEdit;
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
  const receivedMg = t.lines.reduce((s, l) => s + (l.status === "RECEIVED" ? l.netMg ?? 0 : 0), 0);
  const transitMg = inTransitLines.reduce((s, l) => s + (l.netMg ?? 0), 0);
  const byKarat = [...t.lines.reduce((m, l) => {
    const k = l.karat ?? "Unknown";
    const cur = m.get(k) ?? { n: 0, mg: 0 };
    return m.set(k, { n: cur.n + 1, mg: cur.mg + (l.netMg ?? 0) });
  }, new Map<string, { n: number; mg: number }>())].sort((a, b) => b[1].mg - a[1].mg);
  const statusBadge =
    t.status === "COMPLETE" ? <HeroBadge tone="good">Complete</HeroBadge>
    : t.status === "CANCELLED" ? <HeroBadge tone="muted">Cancelled</HeroBadge>
    : inTransit ? <HeroBadge tone="warn">{t.status === "PARTIAL" ? "Part received" : "In transit"}</HeroBadge>
    : <HeroBadge>{t.status === "APPROVED" ? "Approved" : "Requested"}</HeroBadge>;

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={ArrowLeftRightIcon}
        title={t.number}
        back={{ href: "/inventory/transfers", label: "Branch transfers" }}
        badge={statusBadge}
        sub={
          <span className="inline-flex items-center gap-1.5">
            <span className="font-medium text-paper/80">{t.fromBranchName}</span>
            <ArrowRightIcon size={10} className="text-gold" aria-label="to" />
            <span className="font-medium text-paper/80">{t.toBranchName}</span>
            <span>
              · requested by {t.requestedByName ?? "-"}
              {t.createdAt ? ` · ${stamp(t.createdAt)}` : ""}
              {t.reason ? ` · ${t.reason}` : ""}
            </span>
          </span>
        }
        actions={
          <>
            {showDispatch ? (
              <button type="button" onClick={() => setDialog("dispatch")} className={heroGold}>
                <TruckIcon size={13} /> Dispatch
              </button>
            ) : null}
            {showCancel ? (
              <button type="button" onClick={() => setDialog("cancel")} className={`${heroGhost} !text-rose-300`}>
                <CircleSlashIcon size={13} /> Cancel transfer
              </button>
            ) : null}
          </>
        }
        stats={[
          { label: "Pieces", value: t.lines.length, sub: `${byKarat.length} ${byKarat.length === 1 ? "purity" : "purities"}` },
          { label: "Net weight", value: t.totalNetMg, format: grams, unit: "g", accent: true, sub: "On this transfer" },
          { label: "Received", value: receivedCount, tone: receivedCount ? "good" : undefined, sub: `${grams(receivedMg)} g · ${t.lines.length ? Math.round((receivedCount / t.lines.length) * 100) : 0}%` },
          { label: "In transit", value: inTransitLines.length, tone: inTransitLines.length ? "warn" : undefined, sub: `${grams(transitMg)} g on the road` },
          { label: "Pending", value: lineCount("PENDING"), sub: "Not yet dispatched" },
          { label: "Recalled", value: lineCount("RECALLED"), tone: lineCount("RECALLED") ? "bad" : undefined, sub: `Back to ${t.fromBranchName}` },
        ]}
      >
        {t.status === "CANCELLED" ? (
          <p className="text-[11.5px] text-rose-200/80">Cancelled before dispatch. The pieces never left the sending branch.</p>
        ) : (
          <ol className="flex flex-wrap items-center gap-1.5" aria-label="Transfer progress">
            {STEPS.map((s, i) => {
              const done = i < step;
              const current = i === step;
              const label = s === "Received" && t.status === "PARTIAL" ? "Received (partial)" : s;
              return (
                <li key={s} className="flex items-center gap-1.5" aria-current={current ? "step" : undefined}>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset",
                      done ? "bg-gold/[0.14] text-gold-light ring-gold/40" : current ? "bg-paper/10 text-paper ring-paper/25" : "text-paper/35 ring-paper/10"
                    )}
                  >
                    {done ? <CheckIcon size={11} aria-hidden /> : <span className={cn("size-1.5 rounded-full", current ? "animate-pulse-soft bg-gold" : "bg-paper/25")} />}
                    {label}
                    <span className="sr-only">{done ? " (done)" : current ? " (in progress)" : " (not started)"}</span>
                  </span>
                  {i < STEPS.length - 1 ? <span aria-hidden className={cn("h-px w-6", done ? "bg-gold/50" : "bg-paper/15")} /> : null}
                </li>
              );
            })}
          </ol>
        )}
      </GoldHero>

      {t.status === "REQUESTED" && !isSender && me.data ? (
        <Callout tone="info" title="Waiting on the sending branch">
          {t.fromBranchName} must dispatch this transfer.
        </Callout>
      ) : null}
      {t.status === "APPROVED" && !isSender && me.data ? (
        <Callout tone="info" title="Awaiting dispatch">
          {t.fromBranchName} will dispatch the pieces. You can receive them once they are in transit.
        </Callout>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          {showReceive ? <ReceivePanel transferId={id} onReceived={refresh} /> : null}

          <Card>
            <CardHead
              icon={PackageIcon}
              title="Pieces"
              sub={`${t.lines.length} piece${t.lines.length === 1 ? "" : "s"} · ${grams(t.totalNetMg)} g net`}
              action={
                selectable ? (
                  <>
                    <span className="g-metric text-[11px] text-ink-4">{selectedLines.length} selected</span>
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
                        className="g-btn g-btn-secondary h-7 rounded-lg px-2.5 text-[11.5px] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ArrowUturnLeftIcon size={12} /> Recall
                      </button>
                    ) : null}
                  </>
                ) : null
              }
            />
            {t.lines.length === 0 ? (
              <Empty icon={PackageIcon} title="No pieces" desc="This transfer has no lines." />
            ) : (
              <div className="max-h-[34rem] overflow-auto scrollbar-thin">
                <table className="w-full text-[12.5px]">
                  <thead className={cn(thead, "sticky top-0 z-10 backdrop-blur")}>
                    <tr>
                      {selectable ? (
                        <th className={cn(th, "w-8 pl-4")}>
                          <input
                            type="checkbox"
                            className="accent-gold"
                            aria-label="Select all in-transit pieces"
                            checked={allSelected}
                            onChange={(e) => setSelected(e.target.checked ? new Set(inTransitLines.map((l) => l.productId)) : new Set())}
                          />
                        </th>
                      ) : null}
                      <th className={cn(th, !selectable && "pl-4")}>Barcode</th>
                      <th className={th}>Item</th>
                      <th className={th}>Karat</th>
                      <th className={cn(th, "text-right")}>Net g</th>
                      <th className={th}>Line</th>
                      <th className={cn(th, "pr-4")}>Piece</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.lines.map((l) => {
                      const lm = LINE_META[l.status] ?? LINE_META.PENDING;
                      return (
                        <tr key={l.id} className={cn(tr, selected.has(l.productId) && "bg-gold-pale/40")}>
                          {selectable ? (
                            <td className="py-1.5 pl-4 pr-2">
                              {l.status === "IN_TRANSIT" ? (
                                <input type="checkbox" className="accent-gold" aria-label={`Select ${l.barcode}`} checked={selected.has(l.productId)} onChange={() => toggle(l.productId)} />
                              ) : null}
                            </td>
                          ) : null}
                          <td className={cn("px-2 py-1.5 font-mono text-[11px] text-ink-2", !selectable && "pl-4")}>{l.barcode}</td>
                          <td className="px-2 py-1.5">
                            <Link href={`/products/${l.productId}`} className="font-medium text-ink hover:text-gold-dark">
                              {l.name ?? l.barcode}
                            </Link>
                          </td>
                          <td className="px-2 py-1.5">
                            {l.karat ? <span className="g-metric rounded bg-gold-pale px-1.5 py-px text-[10.5px] font-semibold text-gold-deep ring-1 ring-gold-dark/15">{l.karat}</span> : <span className="text-ink-5">-</span>}
                          </td>
                          <td className="g-metric px-2 py-1.5 text-right">{l.netMg == null ? "-" : grams(l.netMg)}</td>
                          <td className="px-2 py-1.5">
                            <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset", lm.chip)}>
                              <span className={cn("size-1.5 rounded-full", lm.dot)} />
                              {lm.label}
                            </span>
                          </td>
                          <td className="py-1.5 pl-2 pr-4">{l.productStatus ? <PieceChip status={l.productStatus} /> : <span className="text-ink-5">-</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHead icon={ArrowLeftRightIcon} title="Route" sub={t.reason ?? "No reason given"} />
            <div className="flex items-stretch gap-2 p-3">
              {[
                { k: "From", name: t.fromBranchName, mine: myBranches.includes(t.fromBranchId) },
                { k: "To", name: t.toBranchName, mine: myBranches.includes(t.toBranchId) },
              ].map((b, i) => (
                <div key={b.k} className="flex min-w-0 flex-1 items-center gap-2">
                  {i === 1 ? <ArrowRightIcon size={12} className="shrink-0 text-gold-dark" /> : null}
                  <div className={cn("min-w-0 flex-1 rounded-xl px-3 py-2 ring-1 ring-inset", b.mine ? "bg-void text-paper ring-gold/25" : "bg-bone/70 text-ink ring-ink/20")}>
                    <div className={cn("text-[9.5px] font-semibold uppercase tracking-[0.14em]", b.mine ? "text-gold-light/70" : "text-ink-5")}>
                      {b.k}
                      {b.mine ? " · yours" : ""}
                    </div>
                    <div className="truncate text-[13px] font-semibold">{b.name}</div>
                  </div>
                </div>
              ))}
            </div>
            <dl className="divide-y divide-ink/[0.05] border-t border-ink/20 text-[12px]">
              {[
                ["Requested by", t.requestedByName ?? "-"],
                ["Created", t.createdAt ? stamp(t.createdAt) : "-"],
                ["Your role", isSender && isReceiver ? "Sender and receiver" : isSender ? "Sender" : isReceiver ? "Receiver" : "Viewer"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 px-4 py-1.5">
                  <dt className="text-ink-4">{k}</dt>
                  <dd className="truncate font-medium text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHead icon={GemIcon} title="By karat" sub={`${grams(t.totalNetMg)} g net`} />
            {byKarat.length === 0 ? (
              <Empty icon={GemIcon} title="No pieces" desc="Nothing on this transfer yet." />
            ) : (
              <ul className="space-y-2 p-4">
                {byKarat.map(([k, v]) => (
                  <li key={k}>
                    <div className="flex items-baseline justify-between gap-2 text-[12px]">
                      <span className="g-metric font-semibold text-gold-deep">{k}</span>
                      <span className="g-metric text-ink">
                        {grams(v.mg)} g <span className="text-[10.5px] text-ink-5">· {v.n} pcs</span>
                      </span>
                    </div>
                    <ShareBar value={t.totalNetMg > 0 ? (v.mg / t.totalNetMg) * 100 : 0} className="mt-1 h-1" />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {dispatched ? (
            <Card>
              <CardHead
                icon={ClipboardCheckIcon}
                title="Reconciliation"
                sub="Lines, piece status and branch agree"
                action={
                  <button
                    type="button"
                    onClick={() => reconcile.refetch()}
                    disabled={reconcile.isFetching}
                    className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-ink-3 ring-1 ring-inset ring-ink/20 hover:bg-bone hover:text-ink disabled:opacity-50"
                  >
                    <RefreshCwIcon size={11} className={reconcile.isFetching ? "animate-spin" : undefined} /> {reconcile.isFetching ? "Checking" : "Re-run"}
                  </button>
                }
              />
              <div className="p-3">
                {reconcile.isLoading ? (
                  <Skeleton className="h-12 rounded-xl" />
                ) : reconcile.isError ? (
                  <Callout tone="danger" title="Reconcile failed">
                    {errMsg(reconcile.error, "Could not run the reconciliation.")}
                  </Callout>
                ) : reconcile.data ? (
                  <div className={cn("rounded-xl px-3 py-2.5 ring-1 ring-inset", reconcile.data.passed ? "bg-emerald-50 ring-emerald-600/15" : "bg-rose-50 ring-rose-600/15")}>
                    <p className={cn("flex items-center gap-1.5 text-[12.5px] font-semibold", reconcile.data.passed ? "text-emerald-800" : "text-rose-800")}>
                      {reconcile.data.passed ? <CheckIcon size={13} /> : <CircleSlashIcon size={13} />}
                      {reconcile.data.passed ? "Reconciled" : "Problems found"}
                    </p>
                    {reconcile.data.warnings.length > 0 ? (
                      <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[11.5px] text-ink-3">
                        {reconcile.data.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-0.5 text-[11.5px] text-ink-3">Lines and piece records agree.</p>
                    )}
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}
        </div>
      </div>

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
    <Card>
      <CardHead icon={ScanBarcodeIcon} title="Receive pieces" sub="Scan each piece as it arrives · received immediately, repeats are skipped" />
      <div className="p-3">
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
          <span className="relative min-w-0 flex-1">
            <ScanBarcodeIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gold-dark" />
            <input
              id="receive-scan"
              ref={scanRef}
              autoFocus
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              placeholder="Scan barcode to receive…"
              autoComplete="off"
              className={`w-full pl-9 font-mono ${controlClass}`}
            />
          </span>
          <CameraScanButton onDetected={(c) => submit(c)} tone="light" />
          <button type="submit" disabled={receive.isPending} className="g-btn g-btn-primary h-10 px-4 text-[13px] disabled:opacity-50">
            {receive.isPending ? "Receiving…" : "Receive"}
          </button>
        </form>
        {log.length > 0 ? (
          <ul className="mt-2 grid gap-1 sm:grid-cols-2" aria-live="polite" aria-label="Recent scans">
            {log.map((e) => (
              <li key={e.key} className="flex items-center justify-between gap-2 rounded-lg bg-bone/60 px-2.5 py-1">
                <span className="truncate font-mono text-[11px] text-ink-3">{e.code}</span>
                <Pill tone={e.outcome === "received" ? "success" : e.outcome === "skipped" ? "neutral" : "danger"} dot>
                  {e.message}
                </Pill>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
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
      className="g-btn g-btn-primary h-7 rounded-lg px-2.5 text-[11.5px] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <CheckIcon size={12} /> {receive.isPending ? "Receiving…" : "Receive"}
    </button>
  );
}

/* ---------------------------------------------------------------- Dialogs */

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
