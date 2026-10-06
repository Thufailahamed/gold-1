import { useState } from "react";
import { View } from "react-native";
import { router, Stack, useLocalSearchParams, type Href } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { normalizeCode, extractScanCode } from "@/lib/barcode";
import { count as fmtCount, dateTime, g, time } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { GUTTER, radius, useTheme } from "@/theme";
import {
  Button,
  Callout,
  ContinuousScanner,
  ErrorState,
  Field,
  FormStack,
  Grid,
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
  StatTile,
  Text,
  toast,
  useRefresh,
  Chips,
  type PillTone,
} from "@/ui";
import { SCOPE_LABEL } from "./CountsScreen";

type CountScope = "FULL" | "CATEGORY" | "BRANCH" | "LOCATION";
type CountStatus = "OPEN" | "COMPLETE" | "CANCELLED";
type ScanFlag = "OK" | "DUPLICATE" | "UNEXPECTED";
type CountLine = {
  productId: string;
  barcode: string;
  name: string | null;
  karat: string | null;
  net_mg: number | null;
  location: string | null;
  status: string | null;
  state: "MATCHED" | "MISSING" | "DUPLICATE";
  note: string | null;
  posted: boolean;
};
type ScanRow = { id: string; barcode: string; product_id: string | null; flag: ScanFlag; scanned_at: number; scanned_by_name: string | null };
type CountDetail = {
  count: {
    id: string;
    branch_id: string;
    branch_name: string | null;
    scope: CountScope;
    scope_ref: string | null;
    scope_label: string | null;
    status: CountStatus;
    opened_by: string | null;
    opened_by_name: string | null;
    closed_by: string | null;
    closed_by_name: string | null;
    created_at: number;
  };
  summary: { expected: number; matched: number; missing: number; unexpected: number; duplicates: number; posted: number };
  lines: CountLine[];
  unexpected: string[];
  scans: ScanRow[];
};
type TabKey = "missing" | "matched" | "unexpected" | "log";
type LastResult = { flag: ScanFlag | "ERROR"; barcode: string; message: string };

const FLAG_META: Record<ScanFlag, { tone: PillTone; label: string }> = {
  OK: { tone: "success", label: "Counted" },
  DUPLICATE: { tone: "warning", label: "Duplicate" },
  UNEXPECTED: { tone: "danger", label: "Unexpected" },
};
const plural = (n: number, word: string) => `${fmtCount(n)} ${word}${n === 1 ? "" : "s"}`;
const grams = (mg: number | null) => (mg == null ? "-" : g(mg));

function buildUnexpected(barcodes: string[], scans: ScanRow[]) {
  const map = new Map<string, { barcode: string; productId: string | null; scannedAt: number | null; by: string | null }>();
  for (const b of barcodes) map.set(b, { barcode: b, productId: null, scannedAt: null, by: null });
  for (const s of scans) {
    if (s.flag !== "UNEXPECTED") continue;
    const cur = map.get(s.barcode);
    if (!cur) map.set(s.barcode, { barcode: s.barcode, productId: s.product_id, scannedAt: s.scanned_at, by: s.scanned_by_name });
    else if (cur.scannedAt === null) map.set(s.barcode, { ...cur, productId: s.product_id, scannedAt: s.scanned_at, by: s.scanned_by_name });
  }
  return [...map.values()];
}

function FlagPill({ flag }: { flag: ScanFlag }) {
  const m = FLAG_META[flag] ?? { tone: "neutral" as PillTone, label: flag };
  return (
    <Pill tone={m.tone} size="sm" dot>
      {m.label}
    </Pill>
  );
}

export default function CountDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const qc = useQueryClient();
  const { can } = useSession();
  const canEdit = can("products:edit");
  const canApprove = can("products:cancel");
  const [tab, setTab] = useState<TabKey>("missing");
  const [dialog, setDialog] = useState<null | "approve" | "cancel">(null);
  const [noteFor, setNoteFor] = useState<CountLine | null>(null);
  const [scanning, setScanning] = useState(false);
  const [typed, setTyped] = useState("");
  const [last, setLast] = useState<LastResult | null>(null);
  const [inFlight, setInFlight] = useState(0);

  const detail = useQuery({ queryKey: ["count", id], queryFn: () => api<CountDetail>(`/api/v1/counts/${id}`), enabled: !!id });
  const refresh = useRefresh(detail);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["count", id] });
    void qc.invalidateQueries({ queryKey: ["counts"] });
  };

  async function submit(raw: string) {
    const code = normalizeCode(extractScanCode(raw) || raw);
    if (!code) return;
    setInFlight((n) => n + 1);
    try {
      const res = await api<{ flag: ScanFlag; productId: string | null; barcode: string }>(`/api/v1/counts/${id}/scans`, { method: "POST", body: JSON.stringify({ barcode: code }) });
      if (res.flag === "OK") {
        setLast({ flag: "OK", barcode: res.barcode, message: "Counted" });
        haptic.success();
      } else if (res.flag === "DUPLICATE") {
        setLast({ flag: "DUPLICATE", barcode: res.barcode, message: "Already counted" });
        haptic.warning();
      } else {
        setLast({ flag: "UNEXPECTED", barcode: res.barcode, message: "Not expected on this shelf" });
        haptic.error();
      }
      invalidate();
    } catch (e) {
      setLast({ flag: "ERROR", barcode: code, message: errorMessage(e, "Scan failed") });
      haptic.error();
    } finally {
      setInFlight((n) => n - 1);
    }
  }

  if (detail.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Stock count", headerLargeTitleEnabled: false }} />
        <Loading />
      </Screen>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Stock count", headerLargeTitleEnabled: false }} />
        <ErrorState error={detail.error} title="Count not found" onRetry={() => void detail.refetch()} />
        <Button title="Back to stock counts" variant="plain" onPress={() => router.replace("/inventory/counts" as Href)} style={{ alignSelf: "center" }} />
      </Screen>
    );
  }

  const { count, summary, lines, unexpected, scans } = detail.data;
  const open = count.status === "OPEN";
  const scopeText = count.scope === "CATEGORY" || count.scope === "LOCATION" ? `${SCOPE_LABEL[count.scope]}: ${count.scope_label ?? count.scope_ref ?? "-"}` : (SCOPE_LABEL[count.scope] ?? count.scope);
  const missing = lines.filter((l) => l.state === "MISSING");
  const matched = lines.filter((l) => l.state !== "MISSING");
  const unexpectedRows = buildUnexpected(unexpected, scans);
  const found = summary.expected - summary.missing;
  const lastTone = last?.flag === "OK" ? c.green : last?.flag === "DUPLICATE" ? c.orange : c.red;

  const lastBanner = last ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(28,28,30,0.92)", borderRadius: radius.lg, borderCurve: "continuous", padding: 14 }}>
      <Icon name={last.flag === "OK" ? "checkCircle" : "alert"} size={18} color={lastTone} />
      <View style={{ flex: 1 }}>
        <Text variant="subhead" mono tone="onVault" numberOfLines={1}>
          {last.barcode}
        </Text>
        <Text variant="caption1" color={lastTone}>
          {last.message}
        </Text>
      </View>
      <Text variant="headline" num tone="onVault">
        {`${found}/${summary.expected}`}
      </Text>
    </View>
  ) : (
    <View style={{ backgroundColor: "rgba(28,28,30,0.92)", borderRadius: radius.lg, borderCurve: "continuous", padding: 14 }}>
      <Text variant="footnote" tone="onVault2" center>
        {`${found} of ${summary.expected} found · point at each tag`}
      </Text>
    </View>
  );

  return (
    <Screen {...refresh}>
      <Stack.Screen options={{ title: "Stock count", headerLargeTitleEnabled: false }} />
      <Hero style={{ marginTop: 8 }} kicker="Stock count" title={`${count.branch_name ?? "Branch"} · ${scopeText}`} subtitle={`Started ${dateTime(count.created_at)} by ${count.opened_by_name ?? "unknown"}.`}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          <Pill tone="dark">{count.status}</Pill>
          {!open && count.closed_by_name ? <Pill tone="dark">{`${count.status === "COMPLETE" ? "Approved" : "Cancelled"} by ${count.closed_by_name}`}</Pill> : null}
        </View>
        {open && canEdit ? (
          <View style={{ marginTop: 14, gap: 10 }}>
            <Button title="Scan pieces" icon="scan" size="lg" block onPress={() => setScanning(true)} />
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Field
                  kind="code"
                  value={typed}
                  onChangeText={setTyped}
                  placeholder="Or type a barcode…"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="send"
                  blurOnSubmit={false}
                  onSubmitEditing={() => {
                    if (typed.trim()) void submit(typed);
                    setTyped("");
                  }}
                />
              </View>
              <IconButton
                name="arrowRight"
                variant="filled"
                size={44}
                disabled={!typed.trim()}
                onPress={() => {
                  void submit(typed);
                  setTyped("");
                }}
                accessibilityLabel="Record barcode"
              />
            </View>
            {last ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: radius.md, borderCurve: "continuous", padding: 10 }}>
                <Icon name={last.flag === "OK" ? "checkCircle" : "alert"} size={15} color={lastTone} />
                <Text variant="footnote" mono tone="onVault" numberOfLines={1} style={{ flex: 1 }}>
                  {last.barcode}
                </Text>
                <Text variant="footnote" weight="600" color={lastTone}>
                  {last.message}
                </Text>
              </View>
            ) : null}
            {inFlight > 0 ? (
              <Text variant="caption1" tone="onVault3">
                Recording…
              </Text>
            ) : null}
          </View>
        ) : null}
      </Hero>

      {open && (canApprove || canEdit) ? (
        <View style={{ flexDirection: "row", gap: 10, marginHorizontal: GUTTER, marginTop: 14 }}>
          {canApprove ? <Button title="Approve & post" icon="checkCircle" style={{ flex: 1 }} onPress={() => setDialog("approve")} /> : null}
          {canEdit ? <Button title="Cancel count" variant="destructiveTinted" style={{ flex: 1 }} onPress={() => setDialog("cancel")} /> : null}
        </View>
      ) : null}

      <Grid style={{ marginTop: 14 }}>
        <StatTile label="Expected" value={fmtCount(summary.expected)} sub={`${plural(found, "piece")} found`} />
        <StatTile label="Matched" value={fmtCount(summary.matched)} tone={summary.matched > 0 ? "success" : "default"} />
        <StatTile label="Missing" value={fmtCount(summary.missing)} tone={summary.missing > 0 ? "danger" : "default"} sub={!open && summary.posted > 0 ? `${plural(summary.posted, "piece")} written off` : undefined} />
        <StatTile label="Unexpected" value={fmtCount(summary.unexpected)} tone={summary.unexpected > 0 ? "warning" : "default"} />
        <StatTile label="Duplicates" value={fmtCount(summary.duplicates)} tone={summary.duplicates > 0 ? "warning" : "default"} />
      </Grid>

      {count.status === "COMPLETE" ? (
        <Callout tone="success" title="Count approved" style={{ marginTop: 14 }}>
          {`Closed by ${count.closed_by_name ?? "unknown"}. ${summary.posted > 0 ? `${plural(summary.posted, "missing piece")} ${summary.posted === 1 ? "was" : "were"} written off as LOST and posted to the gold ledger.` : "Nothing was written off."}`}
        </Callout>
      ) : null}
      {count.status === "CANCELLED" ? (
        <Callout tone="warning" title="Count cancelled" style={{ marginTop: 14 }}>
          {`Cancelled by ${count.closed_by_name ?? "unknown"}. The stock lock was released and nothing was posted.`}
        </Callout>
      ) : null}
      {open && !canEdit ? (
        <Callout tone="info" title="Read only" style={{ marginTop: 14 }}>
          You can follow this count, but scanning needs the products:edit permission.
        </Callout>
      ) : null}

      <Chips
        style={{ marginTop: 22 }}
        items={[
          { key: "missing", label: "Missing", count: missing.length },
          { key: "matched", label: "Matched", count: matched.length },
          { key: "unexpected", label: "Unexpected", count: unexpectedRows.length },
          { key: "log", label: "Scan log", count: scans.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "missing" ? (
        <Section footer={open ? "Expected on the shelf but not scanned yet. Approving writes these off as LOST." : "Pieces that were not found when the count closed."}>
          {missing.length === 0 ? (
            <Row icon="checkCircle" iconColor={c.green} title={summary.expected === 0 ? "Nothing expected" : "Nothing missing"} subtitle={summary.expected === 0 ? "No in-stock pieces matched this scope when the count started." : "Every expected piece has been scanned."} numberOfLines={2} />
          ) : null}
          {missing.map((l) => (
            <Row
              key={l.productId}
              title={l.name ?? l.barcode}
              subtitle={`${l.barcode} · ${l.karat ?? "-"} · ${grams(l.net_mg)} · ${l.location ?? "no location"}${l.note ? `\nNote: ${l.note}` : ""}`}
              numberOfLines={3}
              onPress={open && canEdit ? () => setNoteFor(l) : () => router.push(`/products/${l.productId}` as Href)}
              onLongPress={() => router.push(`/products/${l.productId}` as Href)}
              right={
                open ? (
                  canEdit ? (
                    <Pill size="sm" icon="edit">
                      {l.note ? "Edit note" : "Add note"}
                    </Pill>
                  ) : undefined
                ) : l.posted ? (
                  <Pill size="sm" tone="danger" dot>
                    Written off
                  </Pill>
                ) : (
                  <Pill size="sm">Not posted</Pill>
                )
              }
            />
          ))}
        </Section>
      ) : null}

      {tab === "matched" ? (
        <Section footer="Expected pieces that were scanned.">
          {matched.length === 0 ? <Row icon="scan" title="Nothing matched yet" subtitle="Scanned pieces from the expected list appear here." /> : null}
          {matched.map((l) => (
            <Row
              key={l.productId}
              title={l.name ?? l.barcode}
              subtitle={`${l.barcode} · ${l.karat ?? "-"} · ${grams(l.net_mg)} · ${l.location ?? "no location"}`}
              href={`/products/${l.productId}` as Href}
              right={
                l.state === "DUPLICATE" ? (
                  <Pill size="sm" tone="warning" dot>
                    Scanned twice
                  </Pill>
                ) : (
                  <Pill size="sm" tone="success" dot>
                    Matched
                  </Pill>
                )
              }
            />
          ))}
        </Section>
      ) : null}

      {tab === "unexpected" ? (
        <Section footer="Scanned here but not on the expected list: another branch, another shelf, already sold, or unknown.">
          {unexpectedRows.length === 0 ? <Row icon="checkCircle" iconColor={c.green} title="No unexpected scans" subtitle="Every scanned barcode belonged to this count." /> : null}
          {unexpectedRows.map((u) => (
            <Row
              key={u.barcode}
              title={<Text variant="body" mono>{u.barcode}</Text>}
              subtitle={`${u.scannedAt ? dateTime(u.scannedAt) : "-"}${u.by ? ` · ${u.by}` : ""}`}
              href={u.productId ? (`/products/${u.productId}` as Href) : undefined}
              right={u.productId ? undefined : <Pill size="sm">Not in catalog</Pill>}
            />
          ))}
        </Section>
      ) : null}

      {tab === "log" ? (
        <Section footer="Latest 200 scans, newest first.">
          {scans.length === 0 ? <Row icon="scan" title="No scans yet" subtitle="Every scan is recorded here with who scanned it." /> : null}
          {scans.map((s) => (
            <Row
              key={s.id}
              title={<Text variant="body" mono>{s.barcode}</Text>}
              subtitle={`${time(s.scanned_at)} · ${s.scanned_by_name ?? "-"}`}
              href={s.product_id ? (`/products/${s.product_id}` as Href) : undefined}
              right={<FlagPill flag={s.flag} />}
            />
          ))}
        </Section>
      ) : null}

      <ContinuousScanner visible={scanning} onClose={() => setScanning(false)} onScanned={(code) => void submit(code)} title="Count pieces" hint="Scan every tag on the shelf" footer={lastBanner} />
      {dialog === "approve" ? (
        <ApproveSheet
          countId={id}
          missing={summary.missing}
          expected={summary.expected}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            invalidate();
          }}
        />
      ) : null}
      {dialog === "cancel" ? (
        <CancelSheet
          countId={id}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            invalidate();
          }}
        />
      ) : null}
      {noteFor ? (
        <NoteSheet
          countId={id}
          line={noteFor}
          onClose={() => setNoteFor(null)}
          onDone={() => {
            setNoteFor(null);
            invalidate();
          }}
        />
      ) : null}
    </Screen>
  );
}

function ApproveSheet({ countId, missing, expected, onClose, onDone }: { countId: string; missing: number; expected: number; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const approvers = useQuery({ queryKey: ["count-approvers", countId], queryFn: () => api<{ id: string; name: string }[]>(`/api/v1/counts/${countId}/approvers`) });
  const list = approvers.data ?? [];
  const approve = useMutation({
    mutationFn: () => api<{ posted: number }>(`/api/v1/counts/${countId}/approve`, { method: "POST", body: JSON.stringify({ reason: reason.trim(), approvedBy }) }),
    onSuccess: (res) => {
      toast.success(res.posted > 0 ? `Count approved: ${plural(res.posted, "piece")} written off as LOST` : "Count approved, nothing written off");
      onDone();
    },
    onError: (e) => toast.error(e, "Approval failed"),
  });
  return (
    <Sheet
      visible
      onClose={onClose}
      title="Approve & post"
      submitLabel={missing > 0 ? "Write off" : "Approve"}
      destructive={missing > 0}
      onSubmit={() => approve.mutate()}
      submitting={approve.isPending}
      canSubmit={!!reason.trim() && !!approvedBy}
    >
      <FormStack>
        {missing > 0 ? (
          <Callout tone="danger" title={`${plural(missing, "piece")} will be written off as LOST`} style={{ marginHorizontal: 0 }}>
            {`Every piece still missing (${missing} of ${expected}) is marked LOST, removed from stock and posted to the gold ledger and accounts in one step. This cannot be undone. Scan anything you can still find first.`}
          </Callout>
        ) : (
          <Callout tone="success" title="Nothing is missing" style={{ marginHorizontal: 0 }}>
            Approving closes the count and releases the stock lock. No pieces will be written off.
          </Callout>
        )}
        <SelectField
          label="Second approver"
          value={approvedBy}
          options={list.map((u) => ({ value: u.id, label: u.name }))}
          onChange={setApprovedBy}
          disabled={approvers.isLoading || list.length === 0}
          placeholder={approvers.isLoading ? "Loading…" : list.length === 0 ? "No eligible approvers" : "Select approver…"}
          hint={approvers.isSuccess && list.length === 0 ? undefined : "Another user with gold:manage who is not you and did not open this count."}
        />
        {approvers.isSuccess && list.length === 0 ? (
          <Callout tone="warning" title="No eligible approver" style={{ marginHorizontal: 0 }}>
            A count must be approved by a second person. Ask an administrator to give another user the gold:manage permission (someone other than you and the person who opened this count).
          </Callout>
        ) : null}
        {approvers.isError ? (
          <Callout tone="danger" title="Could not load approvers" style={{ marginHorizontal: 0 }}>
            {errorMessage(approvers.error, "Please try again.")}
          </Callout>
        ) : null}
        <Field label="Reason" multiline value={reason} onChangeText={setReason} maxLength={500} placeholder="e.g. Monthly showcase count, missing pieces investigated" hint={`${reason.length}/500`} />
      </FormStack>
    </Sheet>
  );
}

function CancelSheet({ countId, onClose, onDone }: { countId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const cancel = useMutation({
    mutationFn: () => api(`/api/v1/counts/${countId}/cancel`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) }),
    onSuccess: () => {
      toast.success("Count cancelled, stock unlocked");
      onDone();
    },
    onError: (e) => toast.error(e, "Cancel failed"),
  });
  return (
    <Sheet visible onClose={onClose} title="Cancel count" submitLabel="Cancel count" cancelLabel="Back" destructive onSubmit={() => cancel.mutate()} submitting={cancel.isPending} canSubmit={!!reason.trim()}>
      <FormStack>
        <Text variant="footnote" tone="secondary">
          The pieces are unlocked for sale and transfer again. Nothing is written off and the scans are kept for the record.
        </Text>
        <Field label="Reason" multiline value={reason} onChangeText={setReason} maxLength={500} autoFocus />
      </FormStack>
    </Sheet>
  );
}

function NoteSheet({ countId, line, onClose, onDone }: { countId: string; line: CountLine; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState(line.note ?? "");
  const save = useMutation({
    mutationFn: () => api(`/api/v1/counts/${countId}/notes`, { method: "POST", body: JSON.stringify({ productId: line.productId, note: note.trim() }) }),
    onSuccess: () => {
      toast.success("Note saved");
      onDone();
    },
    onError: (e) => toast.error(e, "Could not save note"),
  });
  return (
    <Sheet visible onClose={onClose} title={`Note for ${line.barcode}`} submitLabel="Save" onSubmit={() => save.mutate()} submitting={save.isPending} canSubmit={!!note.trim()}>
      <FormStack>
        <View style={{ gap: 2 }}>
          <Text variant="headline">{line.name ?? line.barcode}</Text>
          <Text variant="footnote" tone="secondary">{`${line.karat ?? "-"} · ${grams(line.net_mg)} · ${line.location ?? "no location"}`}</Text>
        </View>
        <Field label="What happened to this piece?" multiline value={note} onChangeText={setNote} maxLength={500} autoFocus placeholder="e.g. Sent for repair on 12 Sep, receipt R-1042" hint={`${note.length}/500`} />
        <Button title="Open product" variant="plain" icon="tag" onPress={() => { onClose(); router.push(`/products/${line.productId}` as Href); }} />
      </FormStack>
    </Sheet>
  );
}
