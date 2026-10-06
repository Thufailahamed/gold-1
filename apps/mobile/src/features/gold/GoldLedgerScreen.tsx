import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { shareTextFile } from "@/lib/api";
import { count, dateTime, gramsShort } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { alertMessage, Chips, Grid, HeaderButton, ScreenList, SearchField, StatTile, Text, toast, usePagedQuery } from "@/ui";
import { GoldEntryRow, pretty, type GoldEntry } from "./GoldDashboardScreen";

const TYPES = ["PURCHASE", "OLD_GOLD_PURCHASE", "SALE", "MELTING_INPUT", "MELTING_OUTPUT", "MANUFACTURING_INPUT", "MANUFACTURING_OUTPUT", "TRANSFER", "RETURN", "ADJUSTMENT", "LOSS", "RECOVERY"];
type Row = GoldEntry & { branch_id: string | null; ref_id: string; notes: string | null };

function toCsv(rows: Row[]): string {
  const head = "occurred_at,branch,type,source,destination,weight_g,permille,fine_g,ref_entity,ref_id,notes";
  const esc = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
  return [head, ...rows.map((r) => [new Date(r.occurred_at).toISOString(), r.branch_id ?? "", r.type, r.source, r.destination, String(r.weight_mg / 1000), String(r.permille), String(r.fine_mg / 1000), r.ref_entity, r.ref_id, r.notes ?? ""].map(esc).join(","))].join("\n");
}

export default function GoldLedgerScreen() {
  const params = useLocalSearchParams<{ type?: string }>();
  const [search, setSearch] = useState("");
  const [type, setType] = useState(params.type && TYPES.includes(params.type) ? params.type : "");
  useEffect(() => {
    if (params.type && TYPES.includes(params.type)) setType(params.type);
  }, [params.type]);
  const q = useDebounced(search, 300);
  const list = usePagedQuery<Row>(["gold-ledger", q, type], (page) => `/api/v1/gold/ledger?search=${encodeURIComponent(q)}&page=${page}&limit=20${type ? `&type=${type}` : ""}`, { limit: 20 });

  async function exportCsv() {
    try {
      await shareTextFile(toCsv(list.rows), `gold-ledger${type ? `-${type.toLowerCase()}` : ""}.csv`);
    } catch (e) {
      toast.error(e, "Export failed");
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "Gold Ledger", headerRight: () => <HeaderButton icon="share" onPress={() => void exportCsv()} accessibilityLabel="Export CSV" /> }} />
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
        keyExtractor={(r) => r.id}
        header={
          <View style={{ gap: 12, paddingTop: 8 }}>
            <Text variant="footnote" tone="secondary" style={{ marginHorizontal: 20 }}>
              Every gram in and out. Ledger lines are immutable — corrections post as new adjustment entries. Export shares the rows loaded so far.
            </Text>
            <Grid>
              <StatTile label="Entries" value={list.data ? count(list.total) : "-"} icon="book" />
              <StatTile label="Filter" value={type ? pretty(type) : "All types"} icon="filter" />
            </Grid>
            <Chips items={[{ key: "", label: "All" }, ...TYPES.map((t) => ({ key: t, label: pretty(t) }))]} value={type} onChange={setType} />
            <SearchField value={search} onChangeText={setSearch} placeholder="Search ref, source, notes…" />
          </View>
        }
        empty={{ icon: "book", title: "No ledger entries", message: "Movements appear here once gold flows." }}
        renderItem={(r) => (
          <GoldEntryRow
            e={r}
            onPress={() =>
              void alertMessage(
                pretty(r.type),
                `${dateTime(r.occurred_at)}\n${pretty(r.source)} → ${pretty(r.destination)}\nWeight ${gramsShort(r.weight_mg)} g · ${r.permille}‰ · fine ${gramsShort(r.fine_mg)} g\nRef ${r.ref_entity}/${r.ref_id.slice(0, 8)}${r.notes ? `\n${r.notes}` : ""}`
              )
            }
          />
        )}
      />
    </>
  );
}
