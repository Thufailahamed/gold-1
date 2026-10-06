import { useState } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api, shareTextFile } from "@/lib/api";
import { useSession } from "@/lib/session";
import { GUTTER } from "@/theme";
import {
  BarList,
  Card,
  CardHeader,
  Chips,
  EmptyState,
  Grid,
  HeaderButton,
  KeyValue,
  Screen,
  Section,
  Segmented,
  SkeletonRows,
  StatTile,
  toast,
  useRefresh,
} from "@/ui";

type Summary = { invoices: number; value_cents: number; discount_cents: number; gold_mg: number };
type BRow = { key: string; invoices: number; value_cents: number; gold_mg: number };

const GROUPS = ["category", "purity", "branch", "salesperson", "payment", "product"] as const;
type Period = "today" | "month" | "all";
type Group = (typeof GROUPS)[number];

const fmt = (c: number) => (c / 100).toLocaleString("en-US");
const g = (mg: number) => (mg / 1000).toLocaleString("en-US");

export default function SalesReportsScreen() {
  const { can } = useSession();
  const canExport = can("sales:export");
  const [period, setPeriod] = useState<Period>("month");
  const [groupBy, setGroupBy] = useState<Group>("category");

  const summary = useQuery({ queryKey: ["sales-summary", period], queryFn: () => api<Summary>(`/api/v1/sales/reports/summary?period=${period}`) });
  const breakdown = useQuery({
    queryKey: ["sales-breakdown", period, groupBy],
    queryFn: () => api<BRow[]>(`/api/v1/sales/reports/breakdown?period=${period}&groupBy=${groupBy}`),
  });
  const refresh = useRefresh(summary, breakdown);
  const s = summary.data;
  const rows = breakdown.data ?? [];

  async function exportCsv() {
    const csv = ["key,invoices,value_lkr,gold_g", ...rows.map((r) => `"${r.key}",${r.invoices},${r.value_cents / 100},${r.gold_mg / 1000}`)].join("\n");
    try {
      await shareTextFile(csv, `sales-${period}-${groupBy}.csv`);
    } catch (e) {
      toast.error(e, "Export failed");
    }
  }

  return (
    <Screen {...refresh}>
      <Stack.Screen
        options={{
          title: "Sales Reports",
          headerRight: () => (canExport ? <HeaderButton icon="share" onPress={exportCsv} accessibilityLabel="Export CSV" /> : null),
        }}
      />
      <Segmented
        style={{ marginTop: 8 }}
        options={[
          { key: "today", label: "Today" },
          { key: "month", label: "This month" },
          { key: "all", label: "All time" },
        ]}
        value={period}
        onChange={setPeriod}
      />
      <Grid style={{ marginTop: 16 }}>
        <StatTile label="Invoices" icon="receipt" value={s ? String(s.invoices) : "—"} loading={summary.isLoading} />
        <StatTile label="Value" icon="banknote" prefix="LKR" value={s ? fmt(s.value_cents) : "—"} loading={summary.isLoading} />
        <StatTile label="Gold out" icon="gem" unit="g" value={s ? g(s.gold_mg) : "—"} loading={summary.isLoading} />
        <StatTile label="Discounts" icon="percent" prefix="LKR" value={s ? fmt(s.discount_cents) : "—"} loading={summary.isLoading} />
      </Grid>
      <View style={{ marginTop: 22, gap: 8 }}>
        <Chips items={GROUPS.map((x) => ({ key: x, label: `By ${x}` }))} value={groupBy} onChange={setGroupBy} />
      </View>

      {breakdown.isLoading ? (
        <SkeletonRows rows={5} />
      ) : rows.length === 0 ? (
        <EmptyState icon="chart" title="Nothing in this period" message="Try widening the period or a different grouping." />
      ) : (
        <>
          <Card style={{ marginTop: 16 }}>
            <CardHeader icon="chart" title={`By ${groupBy}`} subtitle={`${rows.length} groups · top 8 by value`} />
            <BarList
              items={[...rows]
                .sort((a, b) => b.value_cents - a.value_cents)
                .slice(0, 8)
                .map((r) => ({ label: r.key, value: r.value_cents, sub: `${r.invoices} invoices · ${g(r.gold_mg)} g` }))}
              format={(n) => `${fmt(n)} LKR`}
            />
          </Card>
          <Section title={`All ${rows.length} groups`}>
            {rows.map((r) => (
              <KeyValue key={r.key} label={r.key} value={`${fmt(r.value_cents)} · ${r.invoices} inv · ${g(r.gold_mg)} g`} />
            ))}
          </Section>
        </>
      )}
      <View style={{ height: GUTTER }} />
    </Screen>
  );
}
