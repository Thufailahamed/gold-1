import { useState } from "react";
import { View } from "react-native";
import { router, Stack, useLocalSearchParams, type Href } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { extractScanCode, normalizeCode } from "@/lib/barcode";
import { dateTime, g } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { GUTTER, radius, useTheme } from "@/theme";
import {
  Button,
  Callout,
  Card,
  CardHeader,
  ContinuousScanner,
  ErrorState,
  Field,
  FormStack,
  Hero,
  Icon,
  IconButton,
  Loading,
  Pill,
  Row,
  Screen,
  Section,
  SelectField,
  Sheet,
  StatusPill,
  Text,
  toast,
  useRefresh,
} from "@/ui";
import { TRANSFER_STATUS_LABEL, type TransferStatus } from "./TransfersScreen";

type LineStatus = "PENDING" | "IN_TRANSIT" | "RECEIVED" | "RECALLED";
type TransferLine = { id: string; productId: string; barcode: string; status: LineStatus; name: string | null; karat: string | null; netMg: number | null; productStatus: string | null };
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

const LINE_LABEL: Record<LineStatus, string> = { PENDING: "Pending", IN_TRANSIT: "In transit", RECEIVED: "Received", RECALLED: "Recalled" };
const STEPS = ["Requested", "Approved", "Dispatched", "Received"];
const DISPATCHED_STATES: TransferStatus[] = ["DISPATCHED", "PARTIAL", "COMPLETE"];
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

export default function TransferDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const qc = useQueryClient();
  const { me, can } = useSession();
  const [dialog, setDialog] = useState<null | "approve" | "dispatch" | "cancel" | "recall">(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [typed, setTyped] = useState("");
  const [log, setLog] = useState<ScanLog[]>([]);

  const detail = useQuery({ queryKey: ["transfer", id], queryFn: () => api<TransferDetail>(`/api/v1/transfers/${id}`), enabled: !!id });
  const t = detail.data;
  const dispatched = !!t && DISPATCHED_STATES.includes(t.status);
  const reconcile = useQuery({ queryKey: ["transfer-reconcile", id], queryFn: () => api<Reconcile>(`/api/v1/transfers/${id}/reconcile`), enabled: dispatched });
  const refreshCtl = useRefresh(detail, ...(dispatched ? [reconcile] : []));

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["transfer", id] });
    void qc.invalidateQueries({ queryKey: ["transfer-reconcile", id] });
    void qc.invalidateQueries({ queryKey: ["transfer-approvers", id] });
    void qc.invalidateQueries({ queryKey: ["transfers"] });
    void qc.invalidateQueries({ queryKey: ["products"] });
  }

  const push = (entry: Omit<ScanLog, "key">) => setLog((l) => [{ ...entry, key: Date.now() + Math.random() }, ...l].slice(0, 8));
  async function receiveCode(raw: string) {
    const code = normalizeCode(extractScanCode(raw) || raw);
    if (!code) return;
    try {
      const d = await api<ReceiveResult>(`/api/v1/transfers/${id}/receive`, { method: "POST", body: JSON.stringify({ barcodes: [code] }) });
      if (d.received.length > 0) {
        haptic.success();
        push({ code, outcome: "received", message: "Received" });
      } else {
        haptic.warning();
        push({ code, outcome: "skipped", message: "Already received — skipped" });
      }
      refresh();
    } catch (e) {
      haptic.error();
      push({ code, outcome: "error", message: errorMessage(e, "Receive failed") });
    }
  }

  const receiveSelected = useMutation({
    mutationFn: (barcodes: string[]) => api<ReceiveResult>(`/api/v1/transfers/${id}/receive`, { method: "POST", body: JSON.stringify({ barcodes }) }),
    onSuccess: (d) => {
      const parts = [`${d.received.length} received`];
      if (d.skipped.length > 0) parts.push(`${d.skipped.length} already received`);
      toast.success(parts.join(", "));
      setSelected(new Set());
      refresh();
    },
    onError: (e) => toast.error(e, "Receive failed"),
  });

  if (detail.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Transfer", headerLargeTitleEnabled: false }} />
        <Loading />
      </Screen>
    );
  }
  if (detail.isError || !t) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Transfer", headerLargeTitleEnabled: false }} />
        <ErrorState error={detail.error} title="Transfer could not be loaded" onRetry={() => void detail.refetch()} />
        <Button title="Back to transfers" variant="plain" onPress={() => router.replace("/inventory/transfers" as Href)} style={{ alignSelf: "center" }} />
      </Screen>
    );
  }

  const myBranches = me?.branchIds ?? [];
  const manage = can("branches:manage");
  const isSender = manage || myBranches.includes(t.fromBranchId);
  const isReceiver = manage || myBranches.includes(t.toBranchId);
  const canEdit = can("products:edit");
  const canApprove = can("products:cancel");
  const inTransitLines = t.lines.filter((l) => l.status === "IN_TRANSIT");
  const receivedCount = t.lines.filter((l) => l.status === "RECEIVED").length;
  const inTransit = t.status === "DISPATCHED" || t.status === "PARTIAL";
  const showApprove = t.status === "REQUESTED" && isSender && canApprove;
  const showDispatch = t.status === "APPROVED" && isSender && canEdit;
  const showCancel = (t.status === "REQUESTED" || t.status === "APPROVED") && isSender && canEdit;
  const showReceive = inTransit && isReceiver && canEdit;
  const showRecall = inTransit && isSender && canEdit;
  const selectable = (showReceive || showRecall) && inTransitLines.length > 0;
  const selectedLines = inTransitLines.filter((l) => selected.has(l.productId));
  const allSelected = selectedLines.length === inTransitLines.length && inTransitLines.length > 0;
  const step = stepOf(t.status);
  const toggle = (pid: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(pid)) n.delete(pid);
      else n.add(pid);
      return n;
    });
  const latest = log[0];
  const tone = (o: ScanLog["outcome"]) => (o === "received" ? c.green : o === "skipped" ? c.gray : c.red);

  return (
    <Screen {...refreshCtl}>
      <Stack.Screen options={{ title: t.number, headerLargeTitleEnabled: false }} />
      <Hero
        style={{ marginTop: 8 }}
        kicker="Branch transfer"
        title={t.number}
        subtitle={`${t.fromBranchName} → ${t.toBranchName}${t.reason ? ` — ${t.reason}` : ""}`}
        stats={[
          { label: "Pieces", value: String(t.lines.length) },
          { label: "Net weight", value: g(t.totalNetMg) },
          { label: "Received", value: `${receivedCount}/${t.lines.length}` },
          { label: "In transit", value: String(inTransitLines.length) },
        ]}
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          <Pill tone="dark">{TRANSFER_STATUS_LABEL[t.status] ?? t.status}</Pill>
          <Pill tone="dark">{`Requested by ${t.requestedByName ?? "-"}`}</Pill>
          {t.approvedByName ? <Pill tone="dark">{`Approved by ${t.approvedByName}`}</Pill> : null}
          <Pill tone="dark">{t.createdAt ? dateTime(t.createdAt) : "-"}</Pill>
        </View>
      </Hero>

      {showApprove || showDispatch || showCancel ? (
        <View style={{ flexDirection: "row", gap: 10, marginHorizontal: GUTTER, marginTop: 14 }}>
          {showApprove ? <Button title="Approve" icon="check" style={{ flex: 1 }} onPress={() => setDialog("approve")} /> : null}
          {showDispatch ? <Button title="Dispatch" icon="truck" style={{ flex: 1 }} onPress={() => setDialog("dispatch")} /> : null}
          {showCancel ? <Button title="Cancel" icon="ban" variant="destructiveTinted" style={{ flex: 1 }} onPress={() => setDialog("cancel")} /> : null}
        </View>
      ) : null}

      {t.status === "CANCELLED" ? (
        <Callout tone="danger" title="Transfer cancelled" style={{ marginTop: 14 }}>
          This transfer was cancelled before dispatch. The pieces never left the sending branch.
        </Callout>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginHorizontal: GUTTER, marginTop: 16 }}>
          {STEPS.map((s, i) => {
            const done = i < step;
            const current = i === step;
            const label = s === "Received" && t.status === "PARTIAL" ? "Received (partial)" : s;
            return (
              <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 99, borderCurve: "continuous", backgroundColor: done ? c.vault2 : current ? c.goldSoft : c.fill }}>
                  {done ? <Icon name="check" size={10} color={c.goldLight} weight="bold" /> : null}
                  <Text variant="caption1" weight="600" color={done ? c.onVault : current ? c.goldInk : c.label3}>
                    {label}
                  </Text>
                </View>
                {i < STEPS.length - 1 ? <Icon name="chevronRight" size={10} color={c.label4} /> : null}
              </View>
            );
          })}
        </View>
      )}

      {t.status === "REQUESTED" && !isSender ? (
        <Callout tone="info" title="Waiting on the sending branch" style={{ marginTop: 14 }}>
          {`${t.fromBranchName} must approve and dispatch this transfer.`}
        </Callout>
      ) : null}
      {t.status === "APPROVED" && !isSender ? (
        <Callout tone="info" title="Approved — awaiting dispatch" style={{ marginTop: 14 }}>
          {`${t.fromBranchName} will dispatch the pieces. You can receive them once they are in transit.`}
        </Callout>
      ) : null}

      {showReceive ? (
        <Card style={{ marginTop: 18 }}>
          <CardHeader title="Receive pieces" subtitle="Each scan is received immediately; repeats are skipped." icon="inboxIn" />
          <Button title="Scan to receive" icon="scan" block onPress={() => setScanning(true)} />
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Field
                kind="code"
                value={typed}
                onChangeText={setTyped}
                placeholder="Or type a barcode…"
                autoCapitalize="characters"
                autoCorrect={false}
                blurOnSubmit={false}
                onSubmitEditing={() => {
                  void receiveCode(typed);
                  setTyped("");
                }}
              />
            </View>
            <IconButton
              name="arrowDown"
              variant="filled"
              size={44}
              disabled={!typed.trim()}
              onPress={() => {
                void receiveCode(typed);
                setTyped("");
              }}
              accessibilityLabel="Receive barcode"
            />
          </View>
          {log.length > 0 ? (
            <View style={{ marginTop: 12, gap: 6 }}>
              {log.map((e) => (
                <View key={e.key} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <Text variant="footnote" mono tone="secondary">
                    {e.code}
                  </Text>
                  <Pill size="sm" dot tone={e.outcome === "received" ? "success" : e.outcome === "skipped" ? "neutral" : "danger"}>
                    {e.message}
                  </Pill>
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

      <Section
        title={`Pieces · ${t.lines.length} · ${g(t.totalNetMg)} net`}
        action={selectable ? { label: allSelected ? "Select none" : "Select all", onPress: () => setSelected(allSelected ? new Set() : new Set(inTransitLines.map((l) => l.productId))) } : undefined}
      >
        {t.lines.length === 0 ? <Row title="No pieces" subtitle="This transfer has no lines." /> : null}
        {t.lines.map((l) => {
          const pick = selectable && l.status === "IN_TRANSIT";
          return (
            <Row
              key={l.id}
              leading={pick ? <Icon name={selected.has(l.productId) ? "checkCircle" : "circle"} size={22} color={selected.has(l.productId) ? c.gold : c.label4} /> : undefined}
              title={l.name ?? l.barcode}
              subtitle={
                <View style={{ gap: 4, marginTop: 2 }}>
                  <Text variant="caption1" tone="secondary">{`${l.barcode} · ${l.karat ?? "-"} · ${l.netMg == null ? "-" : g(l.netMg)}`}</Text>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <StatusPill status={l.status} label={LINE_LABEL[l.status] ?? l.status} size="sm" />
                    {l.productStatus ? <StatusPill status={l.productStatus} size="sm" /> : null}
                  </View>
                </View>
              }
              onPress={pick ? () => toggle(l.productId) : () => router.push(`/products/${l.productId}` as Href)}
              onLongPress={() => router.push(`/products/${l.productId}` as Href)}
              chevron={!pick}
            />
          );
        })}
      </Section>
      {selectable ? (
        <View style={{ flexDirection: "row", gap: 10, marginHorizontal: GUTTER, marginTop: 12 }}>
          {showReceive ? (
            <Button
              title={`Receive ${selectedLines.length || ""}`.trim()}
              icon="check"
              style={{ flex: 1 }}
              disabled={selectedLines.length === 0}
              loading={receiveSelected.isPending}
              onPress={() => receiveSelected.mutate(selectedLines.map((l) => l.barcode))}
            />
          ) : null}
          {showRecall ? <Button title={`Recall ${selectedLines.length || ""}`.trim()} icon="undo" variant="gray" style={{ flex: 1 }} disabled={selectedLines.length === 0} onPress={() => setDialog("recall")} /> : null}
        </View>
      ) : null}

      {dispatched ? (
        <Card style={{ marginTop: 22 }}>
          <CardHeader title="Reconciliation" subtitle="Checks that every line, piece status and branch agree." icon="clipboardCheck" action={{ label: reconcile.isFetching ? "Checking…" : "Re-run", onPress: () => void reconcile.refetch() }} />
          {reconcile.isLoading ? (
            <Loading />
          ) : reconcile.isError ? (
            <Callout tone="danger" title="Reconcile failed" style={{ marginHorizontal: 0 }}>
              {errorMessage(reconcile.error, "Could not run the reconciliation.")}
            </Callout>
          ) : reconcile.data ? (
            <Callout tone={reconcile.data.passed ? "success" : "danger"} title={reconcile.data.passed ? "Reconciled" : "Reconciliation found problems"} style={{ marginHorizontal: 0 }}>
              {[reconcile.data.passed ? "Lines and piece records agree." : "", ...reconcile.data.warnings.map((w) => `• ${w}`)].filter(Boolean).join("\n")}
            </Callout>
          ) : null}
        </Card>
      ) : null}

      <ContinuousScanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onScanned={(code) => void receiveCode(code)}
        title="Receive pieces"
        hint={`Arriving from ${t.fromBranchName}`}
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(28,28,30,0.92)", borderRadius: radius.lg, borderCurve: "continuous", padding: 14 }}>
            {latest ? <Icon name={latest.outcome === "received" ? "checkCircle" : "alert"} size={18} color={tone(latest.outcome)} /> : null}
            <View style={{ flex: 1 }}>
              <Text variant="subhead" mono tone="onVault" numberOfLines={1}>
                {latest?.code ?? "Point at each tag"}
              </Text>
              {latest ? (
                <Text variant="caption1" color={tone(latest.outcome)} numberOfLines={2}>
                  {latest.message}
                </Text>
              ) : null}
            </View>
            <Text variant="headline" num tone="onVault">
              {`${receivedCount}/${t.lines.length}`}
            </Text>
          </View>
        }
      />

      {dialog === "approve" ? <ApproveSheet transferId={id} fromBranchName={t.fromBranchName} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} /> : null}
      {dialog === "dispatch" ? (
        <DispatchSheet transferId={id} pieces={t.lines.filter((l) => l.status === "PENDING").length} netMg={t.totalNetMg} toBranchName={t.toBranchName} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />
      ) : null}
      {dialog === "cancel" ? <CancelSheet transferId={id} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} /> : null}
      {dialog === "recall" ? (
        <RecallSheet
          transferId={id}
          lines={selectedLines}
          fromBranchName={t.fromBranchName}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setSelected(new Set());
            refresh();
          }}
        />
      ) : null}
    </Screen>
  );
}

function ApproveSheet({ transferId, fromBranchName, onClose, onDone }: { transferId: string; fromBranchName: string; onClose: () => void; onDone: () => void }) {
  const [approvedBy, setApprovedBy] = useState("");
  const approvers = useQuery({ queryKey: ["transfer-approvers", transferId], queryFn: () => api<Approver[]>(`/api/v1/transfers/${transferId}/approvers`) });
  const approve = useMutation({
    mutationFn: () => api(`/api/v1/transfers/${transferId}/approve`, { method: "POST", body: JSON.stringify({ approvedBy }) }),
    onSuccess: () => {
      toast.success("Transfer approved");
      onDone();
    },
    onError: (e) => toast.error(e, "Approve failed"),
  });
  const list = approvers.data ?? [];
  return (
    <Sheet visible onClose={onClose} title="Approve transfer" submitLabel="Approve" onSubmit={list.length > 0 ? () => approve.mutate() : undefined} submitting={approve.isPending} canSubmit={!!approvedBy}>
      <FormStack>
        {approvers.isLoading ? (
          <Loading />
        ) : approvers.isError ? (
          <Callout tone="danger" title="Could not load approvers" style={{ marginHorizontal: 0 }}>
            {errorMessage(approvers.error, "Retry in a moment.")}
          </Callout>
        ) : list.length === 0 ? (
          <Callout tone="warning" title="No eligible approver" style={{ marginHorizontal: 0 }}>
            {`Someone else at ${fromBranchName} with the products:cancel permission must approve this transfer. The requester cannot approve their own request.`}
          </Callout>
        ) : (
          <SelectField label="Approver" value={approvedBy} options={list.map((a) => ({ value: a.id, label: a.name }))} onChange={setApprovedBy} hint={`A ${fromBranchName} member other than the requester.`} placeholder="Select approver…" />
        )}
      </FormStack>
    </Sheet>
  );
}

function DispatchSheet({ transferId, pieces, netMg, toBranchName, onClose, onDone }: { transferId: string; pieces: number; netMg: number; toBranchName: string; onClose: () => void; onDone: () => void }) {
  const dispatch = useMutation({
    mutationFn: () => api(`/api/v1/transfers/${transferId}/dispatch`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Transfer dispatched");
      onDone();
    },
    onError: (e) => toast.error(e, "Dispatch failed"),
  });
  return (
    <Sheet visible onClose={onClose} title="Dispatch transfer" submitLabel="Dispatch" onSubmit={() => dispatch.mutate()} submitting={dispatch.isPending}>
      <FormStack>
        <Text variant="body" tone="secondary">
          {`${pieces} piece${pieces === 1 ? "" : "s"} (${g(netMg)} net) will leave stock and go in transit to ${toBranchName}. They cannot be sold until received.`}
        </Text>
      </FormStack>
    </Sheet>
  );
}

function CancelSheet({ transferId, onClose, onDone }: { transferId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const cancel = useMutation({
    mutationFn: () => api(`/api/v1/transfers/${transferId}/cancel`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) }),
    onSuccess: () => {
      toast.success("Transfer cancelled");
      onDone();
    },
    onError: (e) => toast.error(e, "Cancel failed"),
  });
  return (
    <Sheet visible onClose={onClose} title="Cancel transfer" submitLabel="Cancel transfer" cancelLabel="Back" destructive onSubmit={() => cancel.mutate()} submitting={cancel.isPending} canSubmit={!!reason.trim()}>
      <FormStack>
        <Field label="Reason" value={reason} onChangeText={setReason} maxLength={500} autoFocus />
      </FormStack>
    </Sheet>
  );
}

function RecallSheet({ transferId, lines, fromBranchName, onClose, onDone }: { transferId: string; lines: TransferLine[]; fromBranchName: string; onClose: () => void; onDone: () => void }) {
  const recall = useMutation({
    mutationFn: () => api(`/api/v1/transfers/${transferId}/recall`, { method: "POST", body: JSON.stringify({ productIds: lines.map((l) => l.productId) }) }),
    onSuccess: () => {
      toast.success(`Recalled ${lines.length} piece${lines.length === 1 ? "" : "s"}`);
      onDone();
    },
    onError: (e) => toast.error(e, "Recall failed"),
  });
  return (
    <Sheet visible onClose={onClose} title="Recall pieces" submitLabel="Recall" destructive onSubmit={() => recall.mutate()} submitting={recall.isPending} canSubmit={lines.length > 0}>
      <FormStack>
        <Text variant="footnote" tone="secondary">
          {`These in-transit pieces return to ${fromBranchName} stock and can no longer be received:`}
        </Text>
        {lines.map((l) => (
          <View key={l.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
            <Text variant="footnote" mono tone="secondary">
              {l.barcode}
            </Text>
            <Text variant="footnote" numberOfLines={1} style={{ flexShrink: 1 }}>
              {l.name ?? "-"}
            </Text>
          </View>
        ))}
      </FormStack>
    </Sheet>
  );
}
