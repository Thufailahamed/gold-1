import { useState } from "react";
import { View } from "react-native";
import { router, Stack, useLocalSearchParams, type Href } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiText, errorMessage } from "@/lib/api";
import { extractScanCode } from "@/lib/barcode";
import { gramsShort } from "@/lib/format";
import { printHtml } from "@/lib/print";
import { useSession } from "@/lib/session";
import { GUTTER } from "@/theme";
import {
  Button,
  Callout,
  Card,
  CardHeader,
  ErrorState,
  Field,
  FieldRow,
  FormStack,
  Hero,
  IconButton,
  LineageChain,
  Loading,
  Pill,
  Row,
  scanBarcode,
  Screen,
  Section,
  Segmented,
  SelectField,
  Sheet,
  Text,
  toast,
  useRefresh,
  type LineageEdge,
  type LineageNode,
} from "@/ui";
import { labelSheetHtml } from "@/features/products/ProductPrintScreen";

type Detail = {
  batch: { id: string; number: string; status: string; input_fine_mg: number; output_fine_mg: number; waste_mg: number; loss_mg: number; recovery_mg: number };
  inputs: { old_gold_id: string; number: string; description: string; fine_mg: number }[];
  outputs: { lot_number: string; weight_mg: number; permille: number; fine_mg: number; output_type: string }[];
  ledger: { type: string; fine_mg: number }[];
};
type Dialog = null | "melt" | "approve" | "void";

export default function MeltingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useSession();
  const canManage = can("gold:manage");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [scan, setScan] = useState("");
  const [printing, setPrinting] = useState(false);

  const detail = useQuery({ queryKey: ["melt", id], queryFn: () => api<Detail>(`/api/v1/melting/batches/${id}`), enabled: !!id });
  const lineage = useQuery({
    queryKey: ["melt-lineage", id],
    queryFn: () => api<{ nodes: LineageNode[]; edges: LineageEdge[] }>(`/api/v1/gold/lineage?refEntity=melting_batch&refId=${id}`),
    enabled: !!id,
    retry: false,
  });
  const refresh = useRefresh(detail, lineage);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["melt", id] });
    void qc.invalidateQueries({ queryKey: ["melt-lineage", id] });
    void qc.invalidateQueries({ queryKey: ["melting"] });
    void qc.invalidateQueries({ queryKey: ["gold-dash"] });
    void qc.invalidateQueries({ queryKey: ["gold-stock"] });
  };

  const action = useMutation({
    mutationFn: ({ path, method, body }: { path: string; method: string; body?: unknown; ok: string }) =>
      api(`/api/v1/melting/batches/${id}${path}`, { method, body: body ? JSON.stringify(body) : undefined }),
    onSuccess: (_d, v) => {
      toast.success(v.ok);
      setDialog(null);
      invalidate();
    },
    onError: (e) => toast.error(e, "Action failed"),
  });

  const addItem = useMutation({
    mutationFn: async (code: string) => {
      const found = await api<{ item: { id: string } }>(`/api/v1/oldgold/items/barcode/${encodeURIComponent(code)}`);
      return api(`/api/v1/melting/batches/${id}/items`, { method: "POST", body: JSON.stringify({ oldGoldIds: [found.item.id] }) });
    },
    onSuccess: () => {
      toast.success("Item added");
      setScan("");
      invalidate();
    },
    onError: (e) => toast.error(e, "Add failed"),
  });
  const add = (raw: string) => {
    const code = (extractScanCode(raw) || raw).trim();
    if (code) addItem.mutate(code);
  };

  async function printLabel() {
    setPrinting(true);
    try {
      const svg = await apiText(`/api/v1/melting/batches/${id}/label`);
      await printHtml(labelSheetHtml([svg], "Batch label"));
    } catch (e) {
      toast.error(e, "Could not print the label");
    } finally {
      setPrinting(false);
    }
  }

  if (detail.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Batch", headerLargeTitleEnabled: false }} />
        <Loading />
      </Screen>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Batch", headerLargeTitleEnabled: false }} />
        <ErrorState error={detail.error} title="Batch not found" onRetry={() => void detail.refetch()} />
        <Button title="Back to melting" variant="plain" onPress={() => router.replace("/gold/melting" as Href)} style={{ alignSelf: "center" }} />
      </Screen>
    );
  }
  const { batch, inputs, outputs, ledger } = detail.data;
  const draft = batch.status === "DRAFT";

  return (
    <Screen {...refresh}>
      <Stack.Screen options={{ title: batch.number, headerLargeTitleEnabled: false, headerRight: () => <IconButton name="print" variant="plain" onPress={() => void printLabel()} disabled={printing} accessibilityLabel="Print label" /> }} />
      <Hero
        style={{ marginTop: 8 }}
        kicker="Gold · Vault"
        title={batch.number}
        subtitle="Old gold in, assayed lots out — every milligram reconciled."
        stats={[
          { label: "Input fine", value: `${gramsShort(batch.input_fine_mg)} g` },
          { label: "Output fine", value: `${gramsShort(batch.output_fine_mg)} g` },
          { label: "Waste", value: `${gramsShort(batch.waste_mg)} g` },
          { label: batch.loss_mg > 0 ? "Loss" : "Recovery", value: `${batch.loss_mg > 0 ? batch.loss_mg : batch.recovery_mg} mg` },
        ]}
      >
        <View style={{ flexDirection: "row", marginTop: 8 }}>
          <Pill tone="dark">{batch.status}</Pill>
        </View>
      </Hero>

      {canManage && (draft || batch.status === "LOCKED" || batch.status === "MELTED") ? (
        <View style={{ flexDirection: "row", gap: 10, marginHorizontal: GUTTER, marginTop: 14 }}>
          {draft ? <Button title="Lock" icon="lock" style={{ flex: 1 }} loading={action.isPending} onPress={() => action.mutate({ path: "/lock", method: "POST", body: {}, ok: "Locked" })} /> : null}
          {batch.status === "LOCKED" ? <Button title="Record melt" icon="flame" style={{ flex: 1 }} onPress={() => setDialog("melt")} /> : null}
          {batch.status === "MELTED" ? <Button title="Approve" icon="checkCircle" style={{ flex: 1 }} onPress={() => setDialog("approve")} /> : null}
          {draft ? <Button title="Void" icon="ban" variant="destructiveTinted" style={{ flex: 1 }} onPress={() => setDialog("void")} /> : null}
        </View>
      ) : null}

      {draft && canManage ? (
        <Card style={{ marginTop: 18 }}>
          <CardHeader title="Add old-gold items" subtitle="Scan OG- item numbers into this batch" icon="scan" />
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <Field kind="code" value={scan} onChangeText={setScan} placeholder="OG-…" autoCapitalize="characters" autoCorrect={false} onSubmitEditing={() => add(scan)} />
            </View>
            <IconButton
              name="scan"
              variant="tinted"
              size={44}
              onPress={async () => {
                const code = await scanBarcode({ title: "Scan old gold", hint: "Scan the OG- tag" });
                if (code) add(code);
              }}
              accessibilityLabel="Scan item"
            />
            <IconButton name="plus" variant="filled" size={44} disabled={!scan.trim() || addItem.isPending} onPress={() => add(scan)} accessibilityLabel="Add item" />
          </View>
        </Card>
      ) : null}

      <Section title={`Inputs · ${inputs.length} item${inputs.length === 1 ? "" : "s"}`}>
        {inputs.length === 0 ? <Row title="No inputs yet" subtitle="Scan old-gold items into the batch." /> : null}
        {inputs.map((i) => (
          <Row
            key={i.old_gold_id}
            href={`/old-gold/items/${i.old_gold_id}` as Href}
            title={
              <Text variant="body" mono weight="600">
                {i.number}
              </Text>
            }
            subtitle={i.description}
            value={`${gramsShort(i.fine_mg)} g fine`}
            valueTone="label"
          />
        ))}
      </Section>

      {outputs.length > 0 ? (
        <Section title={`Outputs · ${outputs.length} lot${outputs.length === 1 ? "" : "s"}`} footer={`Waste ${gramsShort(batch.waste_mg)} g · Loss ${batch.loss_mg} mg · Recovery ${batch.recovery_mg} mg`}>
          {outputs.map((o) => (
            <Row
              key={o.lot_number}
              title={
                <Text variant="body" mono weight="600">
                  {o.lot_number}
                </Text>
              }
              subtitle={`${o.output_type} · ${o.permille}‰ · ${gramsShort(o.weight_mg)} g gross`}
              value={`${gramsShort(o.fine_mg)} g fine`}
              valueTone="label"
            />
          ))}
        </Section>
      ) : null}

      {ledger.length > 0 ? (
        <Section title="Ledger postings">
          {ledger.map((l, i) => (
            <Row key={i} title={l.type} value={`${l.fine_mg} mg`} mono />
          ))}
        </Section>
      ) : null}

      <Card style={{ marginTop: 22 }}>
        <CardHeader title="Gold lineage" subtitle="Where this gold came from and where it went" icon="link" />
        {lineage.isLoading ? <Loading /> : lineage.data ? <LineageChain nodes={lineage.data.nodes} edges={lineage.data.edges} /> : <Text variant="footnote" tone="tertiary">Lineage unavailable.</Text>}
      </Card>

      {dialog === "melt" ? <MeltSheet inputFineMg={batch.input_fine_mg} pending={action.isPending} onClose={() => setDialog(null)} onSubmit={(body) => action.mutate({ path: "/melt", method: "POST", body, ok: "Melt recorded" })} /> : null}
      {dialog === "approve" ? (
        <ApproveSheet lossMg={batch.loss_mg} recoveryMg={batch.recovery_mg} pending={action.isPending} onClose={() => setDialog(null)} onSubmit={(body) => action.mutate({ path: "/approve", method: "POST", body, ok: "Approved" })} />
      ) : null}
      {dialog === "void" ? <VoidSheet pending={action.isPending} onClose={() => setDialog(null)} onSubmit={(reason) => action.mutate({ path: "/void", method: "PATCH", body: { reason }, ok: "Voided" })} /> : null}
    </Screen>
  );
}

function MeltSheet({ inputFineMg, pending, onClose, onSubmit }: { inputFineMg: number; pending: boolean; onClose: () => void; onSubmit: (b: { outputWeightG: number; assayPermille: number; wasteG: number; outputType: string }) => void }) {
  const [outG, setOutG] = useState("");
  const [assay, setAssay] = useState("");
  const [waste, setWaste] = useState("");
  const [otype, setOtype] = useState<"grain" | "bar">("grain");
  const o = Number(outG);
  const a = Number(assay);
  const w = Number(waste || 0);
  const valid = o > 0 && a > 0 && a <= 1000 && Number.isFinite(w) && w >= 0;
  const preview = valid ? Math.round((o * 1000 * a) / 1000) : null;
  const previewLoss = preview !== null ? inputFineMg - preview - Math.round(w * 1000) : null;
  return (
    <Sheet visible onClose={onClose} title="Record melt + assay" submitLabel="Record" onSubmit={() => onSubmit({ outputWeightG: o, assayPermille: a, wasteG: w, outputType: otype })} submitting={pending} canSubmit={valid}>
      <FormStack>
        <FieldRow>
          <Field label="Output weight (g)" kind="weight" value={outG} onChangeText={setOutG} placeholder="0.000" />
          <Field label="Assay (‰)" kind="int" value={assay} onChangeText={setAssay} placeholder="916" />
        </FieldRow>
        <Field label="Waste (g)" kind="weight" value={waste} onChangeText={setWaste} placeholder="0.000" />
        <Segmented
          style={{ marginHorizontal: 0 }}
          options={[
            { key: "grain", label: "Grain" },
            { key: "bar", label: "Bar" },
          ]}
          value={otype}
          onChange={setOtype}
        />
        {previewLoss !== null ? (
          <Callout tone={previewLoss >= 0 ? "warning" : "info"} style={{ marginHorizontal: 0 }}>
            {`Output fine ≈ ${gramsShort(preview!)} g · ${previewLoss >= 0 ? `Loss ${previewLoss} mg` : `Recovery ${-previewLoss} mg`}`}
          </Callout>
        ) : null}
      </FormStack>
    </Sheet>
  );
}

function ApproveSheet({ lossMg, recoveryMg, pending, onClose, onSubmit }: { lossMg: number; recoveryMg: number; pending: boolean; onClose: () => void; onSubmit: (b: { reason: string; approvedBy?: string }) => void }) {
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState("");
  // Needs users:view; without it the approver is optional anyway.
  const users = useQuery({ queryKey: ["users-options"], queryFn: () => api<{ rows: { id: string; name: string; email: string; is_active: number }[] }>("/api/v1/users?limit=100"), retry: false });
  const opts = (users.data?.rows ?? []).filter((u) => u.is_active).map((u) => ({ value: u.id, label: u.name, subtitle: u.email }));
  return (
    <Sheet visible onClose={onClose} title="Approve reconciliation" submitLabel="Approve" onSubmit={() => onSubmit({ reason: reason.trim(), approvedBy: approver || undefined })} submitting={pending} canSubmit={!!reason.trim()}>
      <FormStack>
        <Callout tone="info" style={{ marginHorizontal: 0 }}>{`Loss ${lossMg} mg · Recovery ${recoveryMg} mg`}</Callout>
        <Field label="Reason (required)" value={reason} onChangeText={setReason} maxLength={500} />
        {users.isError ? (
          <Text variant="footnote" tone="secondary">
            {`Second approver list unavailable (${errorMessage(users.error)}). Needed only when the loss is over the threshold.`}
          </Text>
        ) : (
          <SelectField label="Second approver (if over threshold)" value={approver} options={opts} onChange={setApprover} allowClear clearLabel="None" placeholder={users.isLoading ? "Loading…" : "None"} />
        )}
      </FormStack>
    </Sheet>
  );
}

function VoidSheet({ pending, onClose, onSubmit }: { pending: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Sheet visible onClose={onClose} title="Void batch" submitLabel="Void" destructive cancelLabel="Back" onSubmit={() => onSubmit(reason.trim())} submitting={pending} canSubmit={!!reason.trim()}>
      <FormStack>
        <Field label="Reason" value={reason} onChangeText={setReason} maxLength={500} autoFocus />
      </FormStack>
    </Sheet>
  );
}
