import { useEffect, useState } from "react";
import { View } from "react-native";
import { router, Stack, useLocalSearchParams, type Href } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ago, count, gramsShort } from "@/lib/format";
import { useBranch, useSession } from "@/lib/session";
import { Callout, Chips, Field, FormStack, Grid, HeaderButton, Pill, Row, ScreenList, Sheet, StatTile, Text, toast, usePagedQuery } from "@/ui";
import { BATCH_TONES } from "./GoldDashboardScreen";

type Batch = { id: string; number: string; status: string; input_fine_mg: number; output_fine_mg: number; loss_mg: number; created_at: number };
const STATUSES = ["DRAFT", "LOCKED", "MELTED", "APPROVED", "VOID"];
const FILTERS = [{ key: "", label: "All" }, ...STATUSES.map((s) => ({ key: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))];

export default function MeltingScreen() {
  const params = useLocalSearchParams<{ status?: string; new?: string }>();
  const { can } = useSession();
  const canManage = can("gold:manage");
  const [status, setStatus] = useState(params.status && STATUSES.includes(params.status) ? params.status : "");
  const [creating, setCreating] = useState(params.new === "1");
  useEffect(() => {
    if (params.status && STATUSES.includes(params.status)) setStatus(params.status);
  }, [params.status]);

  const list = usePagedQuery<Batch>(["melting", status], (page) => `/api/v1/melting/batches?page=${page}&limit=20${status ? `&status=${status}` : ""}`, { limit: 20 });
  const fineIn = list.rows.reduce((n, b) => n + b.input_fine_mg, 0);
  const fineOut = list.rows.reduce((n, b) => n + b.output_fine_mg, 0);

  return (
    <>
      <Stack.Screen options={{ title: "Melting", headerRight: () => (canManage ? <HeaderButton icon="plus" onPress={() => setCreating(true)} accessibilityLabel="New batch" /> : null) }} />
      <ScreenList
        data={list.rows}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRefresh={() => void list.refetch()}
        refreshing={list.isRefetching}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        keyExtractor={(b) => b.id}
        header={
          <View style={{ gap: 12, paddingTop: 8 }}>
            <Text variant="footnote" tone="secondary" style={{ marginHorizontal: 20 }}>
              Old gold in, assayed lots out. Loss and recovery reconcile on approval — differences need a recorded reason.
            </Text>
            <Grid columns={3}>
              <StatTile label="Batches" value={list.data ? count(list.total) : "-"} icon="flask" />
              <StatTile label="Fine in" value={gramsShort(fineIn)} unit="g" />
              <StatTile label="Fine out" value={gramsShort(fineOut)} unit="g" />
            </Grid>
            <Chips items={FILTERS} value={status} onChange={setStatus} />
          </View>
        }
        empty={{ icon: "flask", title: "No batches", message: "Create the first melting batch.", action: canManage ? { label: "New batch", icon: "plus", onPress: () => setCreating(true) } : undefined }}
        renderItem={(b) => (
          <Row
            href={`/gold/melting/${b.id}` as Href}
            title={
              <Text variant="body" mono weight="600">
                {b.number}
              </Text>
            }
            subtitle={`${gramsShort(b.input_fine_mg)} g in · ${gramsShort(b.output_fine_mg)} g out · ${ago(b.created_at)}`}
            right={
              <View style={{ alignItems: "flex-end", gap: 3 }}>
                <Pill size="sm" dot tone={BATCH_TONES[b.status] ?? "neutral"}>
                  {b.status}
                </Pill>
                {b.loss_mg > 0 ? (
                  <Text variant="caption1" num tone="danger">
                    {`−${b.loss_mg} mg`}
                  </Text>
                ) : null}
              </View>
            }
          />
        )}
      />
      {creating ? <NewBatchSheet onClose={() => setCreating(false)} /> : null}
    </>
  );
}

function NewBatchSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { branchId } = useBranch();
  const [notes, setNotes] = useState("");
  const create = useMutation({
    mutationFn: () => api<{ id: string; number: string }>("/api/v1/melting/batches", { method: "POST", body: JSON.stringify({ branchId, notes: notes.trim() || undefined }) }),
    onSuccess: (d) => {
      toast.success(`Batch ${d.number} created`);
      void qc.invalidateQueries({ queryKey: ["melting"] });
      void qc.invalidateQueries({ queryKey: ["gold-dash"] });
      onClose();
      router.push(`/gold/melting/${d.id}` as Href);
    },
    onError: (e) => toast.error(e, "Create failed"),
  });
  return (
    <Sheet visible onClose={onClose} title="New melting batch" submitLabel="Create" onSubmit={() => create.mutate()} submitting={create.isPending} canSubmit={!!branchId}>
      <FormStack>
        {!branchId ? (
          <Callout tone="warning" title="No branch selected" style={{ marginHorizontal: 0 }}>
            Choose a working branch in More before starting a batch.
          </Callout>
        ) : null}
        <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
      </FormStack>
    </Sheet>
  );
}
