import { useState } from "react";
import { Pressable, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PERMISSIONS } from "@goldos/shared";
import { api, errorCode } from "@/lib/api";
import { type BankAccount } from "@/lib/accounts";
import { lkr, toCents } from "@/lib/format";
import { useBranches, useSession } from "@/lib/session";
import { GUTTER, useTheme } from "@/theme";
import {
  Button,
  Callout,
  Checkbox,
  ErrorState,
  Field,
  FormStack,
  Hero,
  Icon,
  KeyValue,
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
import { useCustomer } from "@/features/shared/CustomerPicker";
import { grams, statusLabel, when, type RepairStatus } from "./shared";

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
type RepairEvent = { id: string; repair_id: string; from_status: RepairStatus; to_status: RepairStatus; actor_id: string | null; reason: string | null; created_at: number };
type RepairDetail = { job: RepairJob; events: RepairEvent[]; journal: { id: string; entry_no: string } | null };
type UserRow = { id: string; email: string; name: string; is_active: number };
type PayMethod = "cash" | "card" | "bank" | "credit";
type PayRow = { key: number; method: PayMethod; amount: string; bankAccountId: string };

const STEPS: { status: RepairStatus; label: string }[] = [
  { status: "RECEIVED", label: "Received" },
  { status: "IN_PROGRESS", label: "In workshop" },
  { status: "QC", label: "Quality check" },
  { status: "READY", label: "Ready" },
  { status: "COLLECTED", label: "Collected" },
];
const METHOD_LABEL: Record<PayMethod, string> = { cash: "Cash", card: "Card", bank: "Bank transfer", credit: "Customer credit (on account)" };

type Dialog = null | "assign" | "finish" | "qc-pass" | "qc-fail" | "collect" | "cancel";

/** POSTs one transition. A CONFLICT means someone else moved the job first. */
function useRepairAction<V>(repairId: string, action: string, success: string, onDone: () => void) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["repair", repairId] });
    void qc.invalidateQueries({ queryKey: ["repairs"] });
  };
  return useMutation({
    mutationFn: (body: V) => api(`/api/v1/repairs/${repairId}/${action}`, { method: "POST", body: JSON.stringify(body ?? {}) }),
    onSuccess: () => {
      toast.success(success);
      refresh();
      onDone();
    },
    onError: (e) => {
      toast.error(e, "Action failed");
      if (errorCode(e) === "CONFLICT") {
        refresh();
        onDone();
      }
    },
  });
}

export default function RepairDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { me, can } = useSession();
  const [dialog, setDialog] = useState<Dialog>(null);

  const detail = useQuery({ queryKey: ["repair", id], queryFn: () => api<RepairDetail>(`/api/v1/repairs/${id}`), enabled: !!id });
  const job = detail.data?.job;
  const customer = useCustomer(job?.customer_id);
  const branches = useBranches();
  // Needs users:view. Without it names fall back to "You" / a short id.
  const users = useQuery({ queryKey: ["repair-technicians"], queryFn: () => api<{ rows: UserRow[]; total: number }>("/api/v1/users?limit=100"), retry: false });
  const refresh = useRefresh(detail, customer);
  const close = () => setDialog(null);

  if (detail.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Repair", headerLargeTitleEnabled: false }} />
        <Loading />
      </Screen>
    );
  }
  if (detail.isError || !detail.data || !job) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Repair", headerLargeTitleEnabled: false }} />
        <ErrorState error={detail.error} title="Repair could not be loaded" onRetry={() => void detail.refetch()} />
        <Button title="Back to repairs" variant="plain" onPress={() => router.replace("/repairs")} style={{ alignSelf: "center" }} />
      </Screen>
    );
  }

  const { events, journal } = detail.data;
  const canCreate = can(PERMISSIONS.SALES_CREATE);
  const canApprove = can(PERMISSIONS.SALES_APPROVE);
  const canCancel = can(PERMISSIONS.SALES_CANCEL);
  // Buttons mirror the service's NEXT table so only legal transitions are offered.
  const showAssign = job.status === "RECEIVED" && canCreate;
  const showFinish = job.status === "IN_PROGRESS" && canCreate;
  const showQc = job.status === "QC" && canApprove;
  const showCollect = job.status === "READY" && canCreate;
  const showCancel = job.status !== "COLLECTED" && job.status !== "CANCELLED" && canCancel;

  function userName(uid: string | null): string {
    if (!uid) return "-";
    if (uid === me?.user.id) return me.user.name ? `${me.user.name} (you)` : "You";
    return users.data?.rows.find((u) => u.id === uid)?.name ?? `${uid.slice(0, 8)}…`;
  }

  const branchName = branches.data?.rows.find((b) => b.id === job.branch_id)?.name ?? "-";
  const lastEvent = events[events.length - 1];
  const cancelEvent = [...events].reverse().find((e) => e.to_status === "CANCELLED");
  const qcFail = job.status === "IN_PROGRESS" && lastEvent?.from_status === "QC" ? lastEvent : undefined;
  const collectedEvent = events.find((e) => e.to_status === "COLLECTED");
  const stepIndex = job.status === "COLLECTED" ? STEPS.length : STEPS.findIndex((s) => s.status === job.status);

  return (
    <Screen {...refresh}>
      <Stack.Screen options={{ title: job.number, headerLargeTitleEnabled: false }} />
      <Hero
        style={{ marginTop: 8 }}
        kicker="Repair job"
        title={job.number}
        subtitle={`${job.item_desc} — ${job.repair_type}`}
        stats={[
          { label: "Weight at intake", value: `${grams(job.weight_mg)} g` },
          { label: "Estimate", value: `LKR ${lkr(job.estimate_cents)}` },
          { label: "Actual", value: job.actual_cents == null ? "-" : `LKR ${lkr(job.actual_cents)}` },
          { label: "Technician", value: userName(job.technician_id) },
        ]}
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          <Pill tone="dark">{statusLabel(job.status)}</Pill>
          <Pill tone="dark">{customer.data ? `${customer.data.name} · ${customer.data.code}` : "Customer"}</Pill>
          <Pill tone="dark">{branchName}</Pill>
        </View>
      </Hero>

      {showAssign || showFinish || showQc || showCollect || showCancel ? (
        <View style={{ marginHorizontal: GUTTER, marginTop: 14, gap: 10 }}>
          {showAssign ? <Button title="Assign technician" icon="personCheck" block onPress={() => setDialog("assign")} /> : null}
          {showFinish ? <Button title="Repair done" icon="hammer" block onPress={() => setDialog("finish")} /> : null}
          {showQc ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button title="QC pass" icon="check" block onPress={() => setDialog("qc-pass")} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="QC fail" icon="close" variant="destructiveTinted" block onPress={() => setDialog("qc-fail")} />
              </View>
            </View>
          ) : null}
          {showCollect ? <Button title="Collect & take payment" icon="banknote" block onPress={() => setDialog("collect")} /> : null}
          {showCancel ? <Button title="Cancel repair" icon="ban" variant="destructiveTinted" block onPress={() => setDialog("cancel")} /> : null}
        </View>
      ) : null}

      {job.status === "CANCELLED" ? (
        <Callout tone="danger" title="Repair cancelled" style={{ marginTop: 14 }}>
          {`${cancelEvent?.reason ? `Reason: ${cancelEvent.reason}. ` : ""}Return the piece to the customer as received. Cancelled jobs cannot be reopened.`}
        </Callout>
      ) : (
        <Section title="Progress">
          {STEPS.map((s, i) => {
            const done = i < stepIndex;
            const current = i === stepIndex;
            return (
              <Row
                key={s.status}
                leading={
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 13, borderCurve: "continuous",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: done ? c.vault2 : current ? c.goldSoft : c.fill,
                    }}
                  >
                    {done ? (
                      <Icon name="check" size={13} color={c.goldLight} weight="bold" />
                    ) : (
                      <Text variant="caption1" weight="700" color={current ? c.goldInk : c.label3}>
                        {i + 1}
                      </Text>
                    )}
                  </View>
                }
                title={
                  <Text variant="body" weight={current ? "600" : "400"} tone={done || current ? "label" : "tertiary"}>
                    {s.label}
                  </Text>
                }
                value={current ? "Current" : done ? "Done" : undefined}
                valueTone={current ? "gold" : "secondary"}
              />
            );
          })}
        </Section>
      )}

      {qcFail ? (
        <Callout tone="warning" title="Returned from quality check" style={{ marginTop: 14 }}>
          {`${qcFail.reason ?? "QC failed."} Fix the issue and mark the repair done again.`}
        </Callout>
      ) : null}
      {job.status === "RECEIVED" && !canCreate ? (
        <Callout tone="info" title="Awaiting a technician" style={{ marginTop: 14 }}>
          Someone with the sales:create permission must assign this job.
        </Callout>
      ) : null}
      {job.status === "QC" && !canApprove ? (
        <Callout tone="info" title="Awaiting quality check" style={{ marginTop: 14 }}>
          A supervisor with the sales:approve permission must pass or fail this repair.
        </Callout>
      ) : null}

      <Section title="Job ticket" footer="Estimate and actual are both kept on the ticket.">
        <KeyValue label="Customer" value={customer.isLoading ? "…" : customer.data ? `${customer.data.name} · ${customer.data.code}${customer.data.phone ? `\n${customer.data.phone}` : ""}` : "-"} />
        <KeyValue label="Branch" value={branchName} />
        <KeyValue label="Received" value={when(job.created_at)} />
        <KeyValue label="Item" value={job.item_desc} />
        <KeyValue label="Repair type" value={job.repair_type} />
        <KeyValue label="Weight at intake" value={`${grams(job.weight_mg)} g`} />
        <Row title="Condition at intake" subtitle={job.condition_in} numberOfLines={1} />
        <Row title="Condition at collection" subtitle={job.condition_out ?? "-"} />
        <KeyValue label="Technician" value={userName(job.technician_id)} />
        <KeyValue label="Estimate" value={`LKR ${lkr(job.estimate_cents)}`} />
        <KeyValue
          label="Actual"
          value={
            job.actual_cents == null ? (
              "-"
            ) : (
              <View style={{ alignItems: "flex-end", gap: 3 }}>
                <Text variant="body" num>
                  LKR {lkr(job.actual_cents)}
                </Text>
                {collectedEvent?.reason?.includes("estimate") ? <Pill size="sm">Billed at estimate</Pill> : null}
              </View>
            )
          }
        />
        <KeyValue label="Journal entry" value={journal ? journal.entry_no : "-"} mono />
      </Section>

      <Section title="Status history" footer="Append-only: every transition is recorded with who made it.">
        {events.length === 0 ? <Row title="No history" subtitle="No transitions have been recorded for this job." /> : null}
        {events.map((e) => (
          <Row
            key={e.id}
            title={
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {e.from_status !== e.to_status ? (
                  <>
                    <StatusPill status={e.from_status} label={statusLabel(e.from_status)} size="sm" />
                    <Icon name="arrowRight" size={11} color={c.label3} />
                  </>
                ) : null}
                <StatusPill status={e.to_status} label={statusLabel(e.to_status)} size="sm" />
              </View>
            }
            subtitle={`${when(e.created_at)} · ${userName(e.actor_id)}${e.reason ? ` · ${e.reason}` : ""}`}
          />
        ))}
      </Section>

      <AssignSheet visible={dialog === "assign"} repairId={id} users={users} onClose={close} />
      <FinishSheet visible={dialog === "finish"} repairId={id} onClose={close} />
      <QcSheet visible={dialog === "qc-pass" || dialog === "qc-fail"} pass={dialog === "qc-pass"} repairId={id} onClose={close} />
      {dialog === "collect" ? <CollectSheet repairId={id} branchId={job.branch_id} estimateCents={job.estimate_cents} onClose={close} /> : null}
      <CancelSheet visible={dialog === "cancel"} repairId={id} onClose={close} />
    </Screen>
  );
}

function AssignSheet({ visible, repairId, users, onClose }: { visible: boolean; repairId: string; users: { data?: { rows: UserRow[] }; isLoading: boolean; isError: boolean }; onClose: () => void }) {
  const { me } = useSession();
  const [technicianId, setTechnicianId] = useState("");
  const assign = useRepairAction<{ technicianId: string }>(repairId, "assign", "Technician assigned", onClose);
  // The current user is always offered, so assignment works without users:view.
  const active = (users.data?.rows ?? []).filter((u) => u.is_active === 1 && u.id !== me?.user.id);
  const options = [...(me ? [{ value: me.user.id, label: `${me.user.name} (you)` }] : []), ...active.map((u) => ({ value: u.id, label: u.name, subtitle: u.email }))];
  return (
    <Sheet visible={visible} onClose={onClose} title="Assign technician" submitLabel="Assign" onSubmit={() => assign.mutate({ technicianId })} submitting={assign.isPending} canSubmit={!!technicianId}>
      <FormStack>
        <Text variant="footnote" tone="secondary">
          The job moves into the workshop as soon as a technician is assigned.
        </Text>
        <SelectField label="Technician" value={technicianId} options={options} onChange={setTechnicianId} placeholder={users.isLoading ? "Loading staff…" : "Select technician…"} />
        {users.isError ? (
          <Callout tone="warning" title="Staff list unavailable" style={{ marginHorizontal: 0 }}>
            Listing other staff needs the users:view permission. You can still assign the job to yourself.
          </Callout>
        ) : null}
      </FormStack>
    </Sheet>
  );
}

function FinishSheet({ visible, repairId, onClose }: { visible: boolean; repairId: string; onClose: () => void }) {
  const finish = useRepairAction<Record<string, never>>(repairId, "finish", "Sent to quality check", onClose);
  return (
    <Sheet visible={visible} onClose={onClose} title="Repair done" submitLabel="Send to QC" onSubmit={() => finish.mutate({})} submitting={finish.isPending}>
      <FormStack>
        <Text variant="body" tone="secondary">
          The piece goes to quality check. A supervisor passes it for collection or sends it back to the workshop.
        </Text>
      </FormStack>
    </Sheet>
  );
}

function QcSheet({ visible, pass, repairId, onClose }: { visible: boolean; pass: boolean; repairId: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const qc = useRepairAction<{ pass: boolean; reason?: string }>(repairId, "qc", pass ? "QC passed — ready to collect" : "QC failed — back to the workshop", () => {
    setReason("");
    onClose();
  });
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={pass ? "Pass quality check" : "Fail quality check"}
      submitLabel={pass ? "Pass" : "Fail"}
      destructive={!pass}
      onSubmit={() => qc.mutate({ pass, ...(reason.trim() ? { reason: reason.trim() } : {}) })}
      submitting={qc.isPending}
      canSubmit={pass || !!reason.trim()}
    >
      <FormStack>
        <Text variant="footnote" tone="secondary">
          {pass ? "The job becomes ready for the customer to collect and pay." : "The job returns to the workshop. Say what must be fixed."}
        </Text>
        <Field label={pass ? "Note (optional)" : "Reason"} value={reason} maxLength={500} onChangeText={setReason} autoFocus />
      </FormStack>
    </Sheet>
  );
}

function CancelSheet({ visible, repairId, onClose }: { visible: boolean; repairId: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const cancel = useRepairAction<{ reason: string }>(repairId, "cancel", "Repair cancelled", onClose);
  return (
    <Sheet visible={visible} onClose={onClose} title="Cancel repair" submitLabel="Cancel repair" destructive cancelLabel="Back" onSubmit={() => cancel.mutate({ reason: reason.trim() })} submitting={cancel.isPending} canSubmit={!!reason.trim()}>
      <FormStack>
        <Text variant="footnote" tone="secondary">
          No money is posted. The piece is returned to the customer as received.
        </Text>
        <Field label="Reason" value={reason} maxLength={500} onChangeText={setReason} autoFocus />
      </FormStack>
    </Sheet>
  );
}

let payKey = 0;
const newPayRow = (amount: string): PayRow => ({ key: ++payKey, method: "cash", amount, bankAccountId: "" });

function CollectSheet({ repairId, branchId, estimateCents, onClose }: { repairId: string; branchId: string; estimateCents: number; onClose: () => void }) {
  const { c } = useTheme();
  const [conditionOut, setConditionOut] = useState("");
  const [override, setOverride] = useState(false);
  const [actual, setActual] = useState("");
  const [payments, setPayments] = useState<PayRow[]>(() => [newPayRow((estimateCents / 100).toFixed(2))]);
  const banks = useQuery({ queryKey: ["bank-accounts"], queryFn: () => api<BankAccount[]>("/api/v1/bank-accounts"), retry: false });
  const bankRows = (banks.data ?? []).filter((b) => b.is_active === 1 && (!b.branch_id || b.branch_id === branchId));
  const collect = useRepairAction<{ payments: { method: PayMethod; amountLkr: number; bankAccountId?: string }[]; actualLkr?: number; conditionOut: string }>(
    repairId,
    "collect",
    "Repair collected and payment posted",
    onClose
  );

  // Work in cents throughout: the API refuses unless payments sum to the billed amount exactly.
  const actualCents = override ? toCents(actual) : estimateCents;
  const actualOk = Number.isFinite(actualCents) && actualCents > 0;
  const legCents = payments.map((p) => toCents(p.amount));
  const legsOk = legCents.every((x) => Number.isFinite(x) && x > 0);
  const paidCents = legsOk ? legCents.reduce((n, x) => n + x, 0) : Number.NaN;
  const balanced = actualOk && legsOk && paidCents === actualCents;
  const ready = balanced && !!conditionOut.trim();

  const patch = (key: number, next: Partial<PayRow>) => setPayments((rows) => rows.map((r) => (r.key === key ? { ...r, ...next } : r)));

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
    <Sheet visible onClose={onClose} title="Collect & pay" submitLabel="Collect" onSubmit={submit} submitting={collect.isPending} canSubmit={ready}>
      <FormStack>
        <Field label="Condition at collection" multiline value={conditionOut} maxLength={1000} onChangeText={setConditionOut} hint="Record what the customer is handed back." />
        <Checkbox
          checked={override}
          onChange={(v) => {
            setOverride(v);
            if (v && !actual) setActual((estimateCents / 100).toFixed(2));
          }}
          label="Bill a different amount"
          subtitle={`Estimate is LKR ${lkr(estimateCents)}`}
        />
        {override ? (
          <Field
            label="Actual cost (LKR)"
            kind="money"
            value={actual}
            onChangeText={setActual}
            error={actual && !actualOk ? "Enter an amount above 0 with at most 2 decimals" : null}
            hint="Stored beside the estimate; both stay on the ticket."
          />
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text variant="headline">Payments</Text>
          <Button
            title="Split payment"
            icon="plus"
            size="sm"
            variant="gray"
            disabled={payments.length >= 10}
            onPress={() => {
              const rest = actualOk && legsOk ? Math.max(actualCents - paidCents, 0) : 0;
              setPayments((rows) => [...rows, newPayRow(rest > 0 ? (rest / 100).toFixed(2) : "")]);
            }}
          />
        </View>
        {payments.map((p, i) => (
          <View key={p.key} style={{ gap: 10, backgroundColor: c.cardSecondary, borderRadius: 14, borderCurve: "continuous", padding: 12 }}>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
              <View style={{ flex: 1.2 }}>
                <SelectField
                  label={`Payment ${i + 1}`}
                  value={p.method}
                  options={(Object.keys(METHOD_LABEL) as PayMethod[]).map((m) => ({ value: m, label: METHOD_LABEL[m] }))}
                  onChange={(v) => patch(p.key, { method: (v || "cash") as PayMethod })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Amount" kind="money" value={p.amount} onChangeText={(v) => patch(p.key, { amount: v })} placeholder="0.00" />
              </View>
              {payments.length > 1 ? (
                <Pressable hitSlop={8} style={{ paddingBottom: 14 }} onPress={() => setPayments((rows) => rows.filter((r) => r.key !== p.key))} accessibilityLabel={`Remove payment ${i + 1}`}>
                  <Icon name="minusCircle" size={22} color={c.red} />
                </Pressable>
              ) : null}
            </View>
            {p.method === "bank" ? (
              <SelectField
                label="Bank account"
                value={p.bankAccountId}
                allowClear
                clearLabel="Main bank account"
                placeholder="Main bank account"
                options={bankRows.map((b) => ({ value: b.id, label: b.name, subtitle: b.account_number ?? undefined }))}
                onChange={(v) => patch(p.key, { bankAccountId: v })}
              />
            ) : null}
          </View>
        ))}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: c.card, borderRadius: 12, borderCurve: "continuous", padding: 12, gap: 8 }}>
          <View>
            <Text variant="footnote" tone="secondary" num>
              Billed {actualOk ? `LKR ${lkr(actualCents)}` : "-"}
            </Text>
            <Text variant="footnote" tone="secondary" num>
              Paid {legsOk ? `LKR ${lkr(paidCents)}` : "-"}
            </Text>
          </View>
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
        </View>
        {banks.isError && payments.some((p) => p.method === "bank") ? (
          <Callout tone="warning" title="Bank accounts unavailable" style={{ marginHorizontal: 0 }}>
            Listing bank accounts needs accounts:view. Bank payments will post to the main bank account.
          </Callout>
        ) : null}
      </FormStack>
    </Sheet>
  );
}
