import { useState } from "react";
import { View } from "react-native";
import { router, Stack, type Href } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { count, dateTime } from "@/lib/format";
import { useBranch } from "@/lib/session";
import { useSession } from "@/lib/session";
import { Chips, Field, FormStack, Grid, HeaderButton, Pill, Row, ScreenList, Segmented, SelectField, Sheet, StatTile, StatusPill, Text, toast } from "@/ui";

type CountScope = "FULL" | "CATEGORY" | "BRANCH" | "LOCATION";
type CountStatus = "OPEN" | "COMPLETE" | "CANCELLED";
type CountListRow = {
  id: string;
  branch_id: string;
  branch_name: string | null;
  scope: CountScope;
  scope_ref: string | null;
  scope_label: string | null;
  status: CountStatus;
  opened_by: string | null;
  opened_by_name: string | null;
  created_at: number;
  expected: number;
  scanned: number;
};

export const SCOPE_LABEL: Record<CountScope, string> = { FULL: "Whole branch", BRANCH: "Whole branch", CATEGORY: "Category", LOCATION: "Location" };
const FILTERS: { key: "" | CountStatus; label: string }[] = [
  { key: "", label: "All" },
  { key: "OPEN", label: "Open" },
  { key: "COMPLETE", label: "Complete" },
  { key: "CANCELLED", label: "Cancelled" },
];

export default function CountsScreen() {
  const { can } = useSession();
  const canEdit = can("products:edit");
  const [status, setStatus] = useState<"" | CountStatus>("");
  const [starting, setStarting] = useState(false);
  const counts = useQuery({ queryKey: ["counts", status], queryFn: () => api<CountListRow[]>(`/api/v1/counts${status ? `?status=${encodeURIComponent(status)}` : ""}`) });
  const rows = counts.data ?? [];
  const openCount = rows.filter((r) => r.status === "OPEN").length;

  return (
    <>
      <Stack.Screen options={{ title: "Stock counts", headerRight: () => (canEdit ? <HeaderButton icon="plus" onPress={() => setStarting(true)} accessibilityLabel="Start count" /> : null) }} />
      <ScreenList
        data={rows}
        loading={counts.isLoading}
        error={counts.error}
        onRetry={() => void counts.refetch()}
        onRefresh={() => void counts.refetch()}
        refreshing={counts.isRefetching}
        keyExtractor={(r) => r.id}
        header={
          <View style={{ gap: 12, paddingTop: 8 }}>
            <Text variant="footnote" tone="secondary" style={{ marginHorizontal: 20 }}>
              Scan every piece on the shelf and compare it with the book. While a count is open, the pieces it covers are locked from sale and transfer.
            </Text>
            {status === "" && counts.data ? (
              <Grid>
                <StatTile label="Counts shown" value={count(rows.length)} icon="clipboardCheck" />
                <StatTile label="Open now" value={count(openCount)} icon="hourglass" tone={openCount ? "warning" : "default"} />
              </Grid>
            ) : null}
            <Chips items={FILTERS} value={status} onChange={setStatus} />
          </View>
        }
        empty={{
          icon: "clipboardCheck",
          title: status ? "No counts with this status" : "No stock counts yet",
          message: "Start a count to scan a branch, a category or a single location and find missing pieces.",
          action: canEdit ? { label: "Start count", icon: "plus", onPress: () => setStarting(true) } : undefined,
        }}
        renderItem={(r) => {
          const allFound = r.status === "OPEN" && r.expected > 0 && r.scanned >= r.expected;
          return (
            <Row
              href={`/inventory/counts/${r.id}` as Href}
              title={
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Text variant="body" weight="600">
                    {r.branch_name ?? "-"}
                  </Text>
                  <StatusPill status={r.status} size="sm" />
                </View>
              }
              subtitle={`${SCOPE_LABEL[r.scope] ?? r.scope}${(r.scope === "CATEGORY" || r.scope === "LOCATION") && (r.scope_label ?? r.scope_ref) ? ` · ${r.scope_label ?? r.scope_ref}` : ""}\n${dateTime(r.created_at)}${r.opened_by_name ? ` · ${r.opened_by_name}` : ""}`}
              numberOfLines={2}
              right={
                <View style={{ alignItems: "flex-end", gap: 3 }}>
                  <Text variant="subhead" num weight="600">
                    {`${count(r.scanned)} / ${count(r.expected)}`}
                  </Text>
                  {allFound ? (
                    <Pill size="sm" tone="success">
                      All found
                    </Pill>
                  ) : (
                    <Text variant="caption1" tone="secondary">
                      {r.status === "OPEN" ? "Continue" : "View"}
                    </Text>
                  )}
                </View>
              }
            />
          );
        }}
      />
      {starting ? <StartCountSheet onClose={() => setStarting(false)} /> : null}
    </>
  );
}

function StartCountSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const b = useBranch();
  const [branchId, setBranchId] = useState(b.branchId ?? "");
  const [scope, setScope] = useState<"FULL" | "CATEGORY" | "LOCATION">("FULL");
  const [categoryId, setCategoryId] = useState("");
  const [location, setLocation] = useState("");
  const categories = useQuery({
    queryKey: ["master-all", "categories"],
    queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/masters/categories?limit=100"),
    enabled: scope === "CATEGORY",
  });
  const effectiveBranch = b.branches.some((x) => x.id === branchId) ? branchId : (b.branches[0]?.id ?? "");
  const scopeRef = scope === "CATEGORY" ? categoryId : scope === "LOCATION" ? location.trim() : "";
  const ready = !!effectiveBranch && (scope === "FULL" || scopeRef.length > 0);

  const start = useMutation({
    mutationFn: () => api<{ id: string; expectedCount: number }>("/api/v1/counts", { method: "POST", body: JSON.stringify({ branchId: effectiveBranch, scope, ...(scope === "FULL" ? {} : { scopeRef }) }) }),
    onSuccess: (res) => {
      toast.success(`Count started: ${res.expectedCount} piece${res.expectedCount === 1 ? "" : "s"} expected`);
      void qc.invalidateQueries({ queryKey: ["counts"] });
      onClose();
      router.push(`/inventory/counts/${res.id}` as Href);
    },
    onError: (e) => toast.error(e, "Could not start the count"),
  });

  return (
    <Sheet visible onClose={onClose} title="Start stock count" submitLabel="Start" onSubmit={() => start.mutate()} submitting={start.isPending} canSubmit={ready}>
      <FormStack>
        <Text variant="footnote" tone="secondary">
          Every in-stock piece in the chosen scope is snapshotted as the expected list and locked from sale and transfer until the count is approved or cancelled.
        </Text>
        <SelectField label="Branch" value={effectiveBranch} options={b.branches.map((x) => ({ value: x.id, label: x.name }))} onChange={setBranchId} placeholder={b.isLoading ? "Loading…" : "No branches available"} />
        <Segmented
          style={{ marginHorizontal: 0 }}
          options={[
            { key: "FULL", label: "Whole branch" },
            { key: "CATEGORY", label: "Category" },
            { key: "LOCATION", label: "Location" },
          ]}
          value={scope}
          onChange={setScope}
        />
        {scope === "CATEGORY" ? (
          <SelectField label="Category" value={categoryId} options={(categories.data?.rows ?? []).map((x) => ({ value: x.id, label: x.name }))} onChange={setCategoryId} placeholder={categories.isLoading ? "Loading…" : "Select category…"} />
        ) : null}
        {scope === "LOCATION" ? <Field label="Location" value={location} onChangeText={setLocation} placeholder="Showcase A" hint="Exactly as recorded on the pieces, e.g. Showcase A" autoCorrect={false} /> : null}
      </FormStack>
    </Sheet>
  );
}
