import { useState } from "react";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { gramsShort } from "@/lib/format";
import { useBranches } from "@/lib/session";
import { BarList, Card, CardHeader, ErrorState, Grid, Hero, KeyValue, Screen, Section, Segmented, SkeletonRows, StatTile, useRefresh } from "@/ui";

type Stock =
  | { stages: { old_gold_mg: number; melting_mg: number; refined_mg: number; for_sale_mg: number } }
  | { byPurity: { permille: number; fine_mg: number }[] }
  | { byBranch: { branch_id: string; fine_mg: number }[] };
type Group = "stage" | "purity" | "branch";

export default function GoldStockScreen() {
  const [groupBy, setGroupBy] = useState<Group>("stage");
  const stock = useQuery({ queryKey: ["gold-stock", groupBy], queryFn: () => api<Stock>(`/api/v1/gold/stock?groupBy=${groupBy}`) });
  const branches = useBranches();
  const refresh = useRefresh(stock);
  const d = stock.data;
  const totalFine =
    d && "stages" in d
      ? d.stages.old_gold_mg + d.stages.melting_mg + d.stages.refined_mg + d.stages.for_sale_mg
      : d && "byPurity" in d
        ? d.byPurity.reduce((n, r) => n + r.fine_mg, 0)
        : d && "byBranch" in d
          ? d.byBranch.reduce((n, r) => n + r.fine_mg, 0)
          : 0;
  const branchName = (id: string) => branches.data?.rows.find((b) => b.id === id)?.name ?? (id ? id.slice(0, 8) : "Unassigned");

  return (
    <Screen {...refresh}>
      <Stack.Screen options={{ title: "Gold Stock" }} />
      <Hero
        style={{ marginTop: 8 }}
        kicker="Gold · Vault"
        title="Gold stock"
        subtitle="Fine gold across every stage, purity and branch. Balances derive from the immutable gold ledger."
        stats={[
          { label: "Total fine", value: `${gramsShort(totalFine)} g` },
          { label: "Grouped by", value: groupBy },
        ]}
      />
      <Segmented
        style={{ marginTop: 18 }}
        options={[
          { key: "stage", label: "Stage" },
          { key: "purity", label: "Purity" },
          { key: "branch", label: "Branch" },
        ]}
        value={groupBy}
        onChange={setGroupBy}
      />
      {stock.isLoading ? <SkeletonRows rows={4} /> : null}
      {stock.isError ? <ErrorState error={stock.error} onRetry={() => void stock.refetch()} /> : null}
      {d && "stages" in d ? (
        <Grid style={{ marginTop: 16 }}>
          <StatTile icon="scale" label="Old gold" value={gramsShort(d.stages.old_gold_mg)} unit="g fine" href="/old-gold/items?status=AVAILABLE" />
          <StatTile icon="flask" label="Melting" value={gramsShort(d.stages.melting_mg)} unit="g fine" href="/gold/melting?status=LOCKED" />
          <StatTile icon="gem" label="Refined" value={gramsShort(d.stages.refined_mg)} unit="g fine" href="/gold/melting?status=APPROVED" />
          <StatTile icon="store" label="For sale" value={gramsShort(d.stages.for_sale_mg)} unit="g fine" href="/inventory" tone="gold" />
        </Grid>
      ) : null}
      {d && "byPurity" in d ? (
        d.byPurity.length === 0 ? (
          <Section>
            <KeyValue label="No stock" value="No fine gold on hand by purity." />
          </Section>
        ) : (
          <>
            <Card style={{ marginTop: 16 }}>
              <CardHeader icon="gem" title="By purity" subtitle={`${d.byPurity.length} purities`} />
              <BarList items={d.byPurity.map((r) => ({ label: `${r.permille}‰`, value: r.fine_mg }))} format={(n) => `${gramsShort(n)} g`} />
            </Card>
          </>
        )
      ) : null}
      {d && "byBranch" in d ? (
        d.byBranch.length === 0 ? (
          <Section>
            <KeyValue label="No stock" value="No fine gold on hand by branch." />
          </Section>
        ) : (
          <Card style={{ marginTop: 16 }}>
            <CardHeader icon="store" title="By branch" subtitle={`${d.byBranch.length} branches`} />
            <BarList items={d.byBranch.map((r) => ({ label: branchName(r.branch_id), value: r.fine_mg }))} format={(n) => `${gramsShort(n)} g`} color="#007AFF" />
          </Card>
        )
      ) : null}
    </Screen>
  );
}
