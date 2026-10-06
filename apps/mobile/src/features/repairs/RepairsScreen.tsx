import { useState } from "react";
import { ScrollView, View } from "react-native";
import { router, Stack, type Href } from "expo-router";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { PERMISSIONS } from "@goldos/shared";
import { api } from "@/lib/api";
import { lkr } from "@/lib/format";
import { getSavedBranchId, useBranch, useBranches, useSession } from "@/lib/session";
import { GUTTER } from "@/theme";
import {
  BranchSelect,
  Button,
  Chips,
  Field,
  FieldRow,
  FormStack,
  Grid,
  HeaderButton,
  Row,
  ScreenList,
  SearchField,
  SelectField,
  Sheet,
  StatTile,
  StatusPill,
  Text,
  toast,
  usePagedQuery,
  Pill,
} from "@/ui";
import { CustomerField, CustomerNameText, type PickedCustomer } from "@/features/shared/CustomerPicker";
import { REPAIR_TYPES, statusLabel, when, type RepairStatus } from "./shared";

type RepairListRow = {
  id: string;
  number: string;
  customer_id: string;
  branch_id: string;
  item_desc: string;
  repair_type: string;
  estimate_cents: number;
  actual_cents: number | null;
  status: RepairStatus;
  created_at: number;
};

const FILTERS: { key: "" | RepairStatus; label: string }[] = [
  { key: "", label: "All" },
  { key: "RECEIVED", label: "Received" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "QC", label: "Awaiting QC" },
  { key: "READY", label: "Ready to collect" },
  { key: "COLLECTED", label: "Collected" },
  { key: "CANCELLED", label: "Cancelled" },
];
const COUNTED: RepairStatus[] = ["RECEIVED", "IN_PROGRESS", "QC", "READY"];

export default function RepairsScreen() {
  const { can } = useSession();
  const canCreate = can(PERMISSIONS.SALES_CREATE);
  const [status, setStatus] = useState<"" | RepairStatus>("");
  const [branchId, setBranchId] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const branches = useBranches();
  const branchName = (id: string) => (branches.data?.rows ?? []).find((b) => b.id === id)?.name ?? "-";

  const qs = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (branchId) p.set("branchId", branchId);
    for (const [k, v] of Object.entries(extra)) if (v !== "") p.set(k, String(v));
    return p.toString();
  };

  const list = usePagedQuery<RepairListRow>(["repairs", "list", { status, branchId, search }], (page) => `/api/v1/repairs?${qs({ page, limit: 20, status, search: search.trim() })}`, { limit: 20 });
  const counts = useQueries({
    queries: COUNTED.map((s) => ({
      queryKey: ["repairs", "count", s, branchId],
      queryFn: () => api<{ rows: RepairListRow[]; total: number }>(`/api/v1/repairs?${qs({ status: s, limit: 1 })}`),
    })),
  });
  const countOf = (s: RepairStatus) => counts[COUNTED.indexOf(s)]?.data?.total;
  const sum = (...ss: RepairStatus[]) => {
    const vals = ss.map(countOf);
    return vals.some((v) => v === undefined) ? "-" : String(vals.reduce<number>((n, v) => n + (v ?? 0), 0));
  };

  // The list endpoint does not filter on `search` yet, so narrow loaded rows here too.
  const term = search.trim().toLowerCase();
  const rows = term ? list.rows.filter((r) => [r.number, r.item_desc, r.repair_type].some((v) => v.toLowerCase().includes(term))) : list.rows;
  const filtered = !!status || !!branchId;

  return (
    <>
      <Stack.Screen options={{ title: "Repairs", headerRight: () => (canCreate ? <HeaderButton icon="plus" onPress={() => setCreating(true)} accessibilityLabel="New repair" /> : null) }} />
      <ScreenList
        data={rows}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRefresh={() => void Promise.all([list.refetch(), ...counts.map((q) => q.refetch())])}
        refreshing={list.isRefetching}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        keyExtractor={(r) => r.id}
        header={
          <View style={{ gap: 12, paddingTop: 8 }}>
            <Grid>
              <StatTile label={status ? statusLabel(status) : "Jobs"} value={list.data ? String(list.total) : "-"} icon="hammer" />
              <StatTile label="Awaiting technician" value={countOf("RECEIVED") === undefined ? "-" : String(countOf("RECEIVED"))} icon="inbox" />
              <StatTile label="In workshop / QC" value={sum("IN_PROGRESS", "QC")} icon="wrench" />
              <StatTile label="Ready to collect" value={countOf("READY") === undefined ? "-" : String(countOf("READY"))} icon="checkCircle" tone="success" />
            </Grid>
            <Chips items={FILTERS} value={status} onChange={setStatus} />
            <SearchField value={search} onChangeText={setSearch} placeholder="Search number, item or repair type…" />
            <View style={{ marginHorizontal: GUTTER }}>
              <BranchSelect value={branchId} onChange={setBranchId} allowAll label="Branch" />
            </View>
          </View>
        }
        empty={{
          icon: "hammer",
          title: list.total === 0 && !filtered ? "No repairs yet" : "No repairs match",
          message: list.total === 0 && !filtered ? "Take in a customer's piece to open the first repair job." : "Try a different status, branch or search.",
          action: canCreate && list.total === 0 && !filtered ? { label: "New repair", icon: "plus", onPress: () => setCreating(true) } : undefined,
        }}
        renderItem={(r) => (
          <Row
            href={`/repairs/${r.id}` as Href}
            title={
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Text variant="body" mono weight="600">
                  {r.number}
                </Text>
                <StatusPill status={r.status} label={statusLabel(r.status)} size="sm" />
              </View>
            }
            subtitle={
              <View style={{ gap: 1 }}>
                <Text variant="footnote" numberOfLines={1}>
                  {r.item_desc} · {r.repair_type}
                </Text>
                <CustomerNameText id={r.customer_id} prefix="" />
                <Text variant="caption1" tone="tertiary">
                  {branchName(r.branch_id)} · {when(r.created_at)}
                </Text>
              </View>
            }
            right={
              <View style={{ alignItems: "flex-end" }}>
                <Text variant="subhead" num weight="600">
                  {lkr(r.estimate_cents)}
                </Text>
                {r.actual_cents != null ? <Pill size="sm" tone="success">{`Actual ${lkr(r.actual_cents)}`}</Pill> : null}
              </View>
            }
          />
        )}
      />
      <NewRepairSheet visible={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function NewRepairSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const b = useBranch();
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [branchId, setBranchId] = useState(getSavedBranchId());
  const [itemDesc, setItemDesc] = useState("");
  const [weightG, setWeightG] = useState("");
  const [repairType, setRepairType] = useState("");
  const [conditionIn, setConditionIn] = useState("");
  const [estimate, setEstimate] = useState("");

  // Intake happens at a branch the user works at; shop-wide roles may pick any.
  const effectiveBranch = b.branches.some((x) => x.id === branchId) ? branchId : b.branches[0]?.id ?? "";
  const weight = Number(weightG);
  const estimateLkr = Number(estimate.replace(/,/g, ""));
  const weightOk = Number.isFinite(weight) && weight > 0 && weight <= 100000;
  const estimateOk = Number.isFinite(estimateLkr) && estimateLkr > 0;
  const ready = !!customer && !!effectiveBranch && !!itemDesc.trim() && !!repairType.trim() && !!conditionIn.trim() && weightOk && estimateOk;

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string; number: string }>("/api/v1/repairs", {
        method: "POST",
        body: JSON.stringify({
          customerId: customer!.id,
          branchId: effectiveBranch,
          itemDesc: itemDesc.trim(),
          weightG: weight,
          conditionIn: conditionIn.trim(),
          repairType: repairType.trim(),
          estimateLkr,
        }),
      }),
    onSuccess: (d) => {
      toast.success(`Repair ${d.number} opened`);
      void qc.invalidateQueries({ queryKey: ["repairs"] });
      onClose();
      setCustomer(null);
      setItemDesc("");
      setWeightG("");
      setRepairType("");
      setConditionIn("");
      setEstimate("");
      router.push(`/repairs/${d.id}`);
    },
    onError: (e) => toast.error(e, "Could not open the repair"),
  });

  return (
    <Sheet visible={visible} onClose={onClose} title="New repair" submitLabel="Open" onSubmit={() => create.mutate()} submitting={create.isPending} canSubmit={ready}>
      <FormStack>
        <Text variant="footnote" tone="secondary">
          Record the piece exactly as it is handed over. Weight and condition are snapshotted on the ticket.
        </Text>
        <CustomerField value={customer} onChange={setCustomer} />
        <SelectField
          label="Branch"
          value={effectiveBranch}
          options={b.branches.map((x) => ({ value: x.id, label: x.name }))}
          onChange={(v) => setBranchId(v)}
          placeholder={b.isLoading ? "Loading…" : "No branches available"}
        />
        <View style={{ gap: 8 }}>
          <Field label="Repair type" value={repairType} maxLength={100} onChangeText={setRepairType} placeholder="e.g. Resize" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {REPAIR_TYPES.map((t) => (
              <Button key={t} title={t} size="sm" variant={repairType === t ? "filled" : "gray"} onPress={() => setRepairType(t)} />
            ))}
          </ScrollView>
        </View>
        <Field label="Item" value={itemDesc} maxLength={500} onChangeText={setItemDesc} hint="What the piece is, e.g. 22K ladies ring with red stone" />
        <FieldRow>
          <Field label="Weight (g)" kind="weight" value={weightG} onChangeText={setWeightG} placeholder="0.000" error={weightG && !weightOk ? "Enter a weight above 0 g" : null} />
          <Field label="Estimate (LKR)" kind="money" value={estimate} onChangeText={setEstimate} placeholder="0.00" error={estimate && !estimateOk ? "Enter an estimate above 0" : null} />
        </FieldRow>
        <Field label="Condition at intake" multiline value={conditionIn} maxLength={1000} onChangeText={setConditionIn} hint="Scratches, missing stones, breaks: anything the customer should agree to." />
      </FormStack>
    </Sheet>
  );
}
