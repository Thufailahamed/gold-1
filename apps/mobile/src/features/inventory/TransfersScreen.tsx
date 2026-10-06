import { useMemo, useState } from "react";
import { View } from "react-native";
import { router, Stack, type Href } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { count, dateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme";
import { Chips, Grid, HeaderButton, Icon, Pill, Row, ScreenList, StatTile, StatusPill, Text } from "@/ui";

export type TransferStatus = "REQUESTED" | "APPROVED" | "DISPATCHED" | "PARTIAL" | "COMPLETE" | "CANCELLED";
type TransferListRow = {
  id: string;
  number: string;
  from_branch_id: string;
  from_branch_name: string;
  to_branch_id: string;
  to_branch_name: string;
  status: TransferStatus;
  reason: string | null;
  requested_by: string | null;
  requested_by_name: string | null;
  created_at: number;
  lines: number;
  in_transit: number;
  received: number;
};

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  REQUESTED: "Awaiting approval",
  APPROVED: "Approved",
  DISPATCHED: "In transit",
  PARTIAL: "Partially received",
  COMPLETE: "Complete",
  CANCELLED: "Cancelled",
};

const STATUS_FILTERS: { key: string; label: string; match: (s: TransferStatus) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "requested", label: "Awaiting approval", match: (s) => s === "REQUESTED" },
  { key: "approved", label: "Approved", match: (s) => s === "APPROVED" },
  { key: "transit", label: "In transit", match: (s) => s === "DISPATCHED" || s === "PARTIAL" },
  { key: "complete", label: "Complete", match: (s) => s === "COMPLETE" },
  { key: "cancelled", label: "Cancelled", match: (s) => s === "CANCELLED" },
];
type Direction = "all" | "outgoing" | "incoming";

export default function TransfersScreen() {
  const { c } = useTheme();
  const { me, can } = useSession();
  const canCreate = can("products:edit");
  const [statusKey, setStatusKey] = useState("all");
  const [direction, setDirection] = useState<Direction>("all");
  const myBranches = useMemo(() => new Set(me?.branchIds ?? []), [me]);
  const list = useQuery({ queryKey: ["transfers"], queryFn: () => api<TransferListRow[]>("/api/v1/transfers") });

  const all = list.data ?? [];
  const byDirection = all.filter((r) => (direction === "outgoing" ? myBranches.has(r.from_branch_id) : direction === "incoming" ? myBranches.has(r.to_branch_id) : true));
  const active = STATUS_FILTERS.find((f) => f.key === statusKey) ?? STATUS_FILTERS[0]!;
  const rows = byDirection.filter((r) => active.match(r.status));
  const awaiting = all.filter((r) => r.status === "REQUESTED").length;
  const inTransit = all.reduce((n, r) => n + (r.status === "DISPATCHED" || r.status === "PARTIAL" ? r.in_transit : 0), 0);
  const incomingOpen = all.filter((r) => (r.status === "DISPATCHED" || r.status === "PARTIAL") && myBranches.has(r.to_branch_id)).length;
  const newTransfer = () => router.push("/inventory/transfers/new" as Href);

  return (
    <>
      <Stack.Screen options={{ title: "Transfers", headerRight: () => (canCreate ? <HeaderButton icon="plus" onPress={newTransfer} accessibilityLabel="New transfer" /> : null) }} />
      <ScreenList
        data={rows}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRefresh={() => void list.refetch()}
        refreshing={list.isRefetching}
        keyExtractor={(r) => r.id}
        header={
          <View style={{ gap: 12, paddingTop: 8 }}>
            <Grid>
              <StatTile label="Transfers" value={list.data ? count(all.length) : "-"} icon="swap" />
              <StatTile label="Awaiting approval" value={list.data ? count(awaiting) : "-"} icon="hourglass" tone={awaiting ? "warning" : "default"} />
              <StatTile label="Pieces in transit" value={list.data ? count(inTransit) : "-"} icon="truck" />
              <StatTile label="Incoming to receive" value={list.data ? count(incomingOpen) : "-"} icon="inboxIn" tone={incomingOpen ? "gold" : "default"} />
            </Grid>
            <Chips items={STATUS_FILTERS.map((f) => ({ key: f.key, label: f.label, count: list.data ? byDirection.filter((r) => f.match(r.status)).length : undefined }))} value={statusKey} onChange={setStatusKey} />
            <Chips
              items={[
                { key: "all", label: "Both directions" },
                { key: "outgoing", label: "Outgoing" },
                { key: "incoming", label: "Incoming" },
              ]}
              value={direction}
              onChange={(k) => setDirection(k as Direction)}
            />
            <Text variant="footnote" tone="secondary" style={{ marginHorizontal: 20 }}>
              Only transfers touching your branches are shown.
            </Text>
          </View>
        }
        empty={{
          icon: "truck",
          title: all.length === 0 ? "No transfers yet" : "No transfers match",
          message: all.length === 0 ? "Request a transfer to move pieces to another branch." : "Try a different status or direction filter.",
          action: canCreate && all.length === 0 ? { label: "New transfer", icon: "plus", onPress: newTransfer } : undefined,
        }}
        renderItem={(r) => (
          <Row
            href={`/inventory/transfers/${r.id}` as Href}
            title={
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Text variant="body" mono weight="600">
                  {r.number}
                </Text>
                <StatusPill status={r.status} label={TRANSFER_STATUS_LABEL[r.status] ?? r.status} size="sm" />
              </View>
            }
            subtitle={
              <View style={{ gap: 2, marginTop: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text variant="footnote" weight="500">
                    {r.from_branch_name}
                  </Text>
                  <Icon name="arrowRight" size={10} color={c.label3} />
                  <Text variant="footnote" weight="500">
                    {r.to_branch_name}
                  </Text>
                </View>
                <Text variant="caption1" tone="tertiary">
                  {`${dateTime(r.created_at)}${r.requested_by_name ? ` · ${r.requested_by_name}` : ""}`}
                </Text>
              </View>
            }
            right={
              <View style={{ alignItems: "flex-end", gap: 3 }}>
                <Text variant="subhead" num weight="600">
                  {`${r.received}/${r.lines}`}
                </Text>
                {r.in_transit > 0 ? (
                  <Pill size="sm" tone="info">
                    {`${r.in_transit} in transit`}
                  </Pill>
                ) : null}
              </View>
            }
          />
        )}
      />
    </>
  );
}
