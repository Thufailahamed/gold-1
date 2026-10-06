import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { router, Stack, type Href } from "expo-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ago, count, gramsShort } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { useBranches, useSession } from "@/lib/session";
import { radius, useTheme } from "@/theme";
import {
  BarList,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Icon,
  ModuleCard,
  ModuleGrid,
  ModuleHero,
  Pill,
  Row,
  Screen,
  Section,
  SectionHeading,
  Skeleton,
  SkeletonRows,
  StatusBoard,
  Text,
  useRefresh,
  type IconName,
  type PillTone,
} from "@/ui";

type Stages = { stages: { old_gold_mg: number; melting_mg: number; refined_mg: number; for_sale_mg: number } };
type ByPurity = { byPurity: { permille: number; fine_mg: number }[] };
type ByBranch = { byBranch: { branch_id: string; fine_mg: number }[] };
type Batch = { id: string; number: string; status: string; input_fine_mg: number; output_fine_mg: number; loss_mg: number; created_at: number };
export type GoldEntry = { id: string; occurred_at: number; source: string; destination: string; type: string; weight_mg: number; permille: number; fine_mg: number; ref_entity: string };
type Paged<R> = { rows: R[]; total: number };

const FLOW: { key: keyof Stages["stages"]; label: string; hint: string; color: string; href: string; icon: IconName }[] = [
  { key: "old_gold_mg", label: "Old gold", hint: "Bought in, awaiting melt", color: "#FF9F0A", href: "/old-gold/items?status=AVAILABLE", icon: "scale" },
  { key: "melting_mg", label: "In the melt", hint: "Locked or melted batches", color: "#C9A227", href: "/gold/melting?status=LOCKED", icon: "flask" },
  { key: "refined_mg", label: "Refined", hint: "Approved melt output", color: "#8C6D1F", href: "/gold/melting?status=APPROVED", icon: "gem" },
  { key: "for_sale_mg", label: "For sale", hint: "Finished pieces in stock", color: "#34C759", href: "/inventory", icon: "store" },
];
const BATCH_STATES = [
  { status: "DRAFT", label: "Draft", hint: "Collecting old gold", color: "#E7C65A" },
  { status: "LOCKED", label: "Locked", hint: "Ready for the furnace", color: "#FF9F0A" },
  { status: "MELTED", label: "Melted", hint: "Awaiting assay approval", color: "#C9A227" },
  { status: "APPROVED", label: "Approved", hint: "Output in the vault", color: "#34C759" },
];
export const BATCH_TONES: Record<string, PillTone> = { DRAFT: "neutral", LOCKED: "warning", MELTED: "info", APPROVED: "success", VOID: "danger" };
export const IN_TYPES = new Set(["PURCHASE", "OLD_GOLD_PURCHASE", "RETURN", "RECOVERY"]);
export const OUT_TYPES = new Set(["SALE", "LOSS"]);
export const pretty = (k: string) => k.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());

export default function GoldDashboardScreen() {
  const { c } = useTheme();
  const { can, me } = useSession();
  const canManage = can("gold:manage");
  const canOldGold = can("oldgold:view");
  const opt = { retry: false, staleTime: 30_000 } as const;
  const stages = useQuery({ ...opt, queryKey: ["gold-stock", "stage"], queryFn: () => api<Stages>("/api/v1/gold/stock?groupBy=stage") });
  const byPurity = useQuery({ ...opt, queryKey: ["gold-stock", "purity"], queryFn: () => api<ByPurity>("/api/v1/gold/stock?groupBy=purity") });
  const byBranch = useQuery({ ...opt, queryKey: ["gold-stock", "branch"], queryFn: () => api<ByBranch>("/api/v1/gold/stock?groupBy=branch") });
  const branches = useBranches();
  const from = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }, []);
  const monthMoves = useQuery({ ...opt, queryKey: ["gold-dash", "month-moves", from], queryFn: () => api<Paged<GoldEntry>>(`/api/v1/gold/ledger?from=${from}&limit=1`) });
  const recentMoves = useQuery({ ...opt, queryKey: ["gold-dash", "moves"], queryFn: () => api<Paged<GoldEntry>>("/api/v1/gold/ledger?limit=8") });
  const recentBatches = useQuery({ ...opt, queryKey: ["gold-dash", "batches"], queryFn: () => api<Paged<Batch>>("/api/v1/melting/batches?limit=5") });
  const approved = useQuery({ ...opt, queryKey: ["gold-dash", "approved"], queryFn: () => api<Paged<Batch>>("/api/v1/melting/batches?status=APPROVED&limit=20") });
  const batchQueries = useQueries({
    queries: BATCH_STATES.map((s) => ({ ...opt, queryKey: ["gold-dash", "batch-state", s.status], queryFn: () => api<Paged<Batch>>(`/api/v1/melting/batches?status=${s.status}&limit=1`) })),
  });
  const refresh = useRefresh(stages, byPurity, byBranch, monthMoves, recentMoves, recentBatches, approved, ...batchQueries);

  const batchCounts = batchQueries.map((q) => q.data?.total);
  const batchesLoading = batchQueries.some((q) => q.isLoading);
  const activeBatches = (batchCounts[0] ?? 0) + (batchCounts[1] ?? 0) + (batchCounts[2] ?? 0);
  const awaitingApproval = batchCounts[2] ?? 0;
  const st = stages.data?.stages;
  const totalFine = st ? st.old_gold_mg + st.melting_mg + st.refined_mg + st.for_sale_mg : undefined;
  const approvedRows = approved.data?.rows ?? [];
  const fineIn = approvedRows.reduce((s, b) => s + b.input_fine_mg, 0);
  const fineOut = approvedRows.reduce((s, b) => s + b.output_fine_mg, 0);
  const lossMg = approvedRows.reduce((s, b) => s + b.loss_mg, 0);
  const yieldPct = fineIn > 0 ? (fineOut / fineIn) * 100 : undefined;
  const branchName = new Map((branches.data?.rows ?? []).map((b) => [b.id, b.name]));
  const purityRows = (byPurity.data?.byPurity ?? []).filter((r) => r.fine_mg > 0).slice(0, 6).map((r) => ({ label: `${r.permille}‰`, value: r.fine_mg }));
  const branchRows = (byBranch.data?.byBranch ?? []).filter((r) => r.fine_mg > 0).map((r) => ({ label: branchName.get(r.branch_id) ?? (r.branch_id ? r.branch_id.slice(0, 8) : "Unassigned"), value: r.fine_mg }));

  return (
    <Screen {...refresh}>
      <Stack.Screen options={{ title: "Gold Vault" }} />
      <ModuleHero
        kicker="Gold vault"
        title="Every gram, traced end to end."
        description="Fine gold from buy-in to melt to showcase — balances, melting batches and an immutable ledger of every movement."
        actions={
          <>
            {canManage ? <Button title="New melting batch" icon="plus" onPress={() => router.push("/gold/melting?new=1" as Href)} /> : null}
            <Button title="Stock" icon="coins" variant="glass" onPress={() => router.push("/gold/stock" as Href)} />
            <Button title="Ledger" icon="book" variant="glass" onPress={() => router.push("/gold/ledger" as Href)} />
          </>
        }
        metrics={[
          { label: "Fine gold on hand", value: totalFine, format: gramsShort, unit: "g", href: "/gold/stock" },
          { label: "For sale", value: st?.for_sale_mg, format: gramsShort, unit: "g", href: "/inventory" },
          { label: "In the melt", value: st?.melting_mg, format: gramsShort, unit: "g", href: "/gold/melting?status=LOCKED" },
          { label: "Movements · month", value: monthMoves.data?.total, format: count, unit: "entries", href: "/gold/ledger" },
        ]}
      />

      <SectionHeading index="01" title="Workspaces" subtitle="Jump into any part of the vault" />
      <ModuleGrid>
        {[
          <ModuleCard key="s" href="/gold/stock" icon="coins" title="Stock" description="Fine gold on hand by stage, by purity and by branch." metric={totalFine === undefined ? "—" : `${gramsShort(totalFine)} g`} metricLabel="Fine gold on hand" loading={stages.isLoading} />,
          <ModuleCard key="m" href="/gold/melting" icon="flask" title="Melting" description="Batch old gold, melt it, assay the output and reconcile any loss." metric={batchesLoading ? "—" : activeBatches} metricLabel="Active batches" loading={batchesLoading} alert={awaitingApproval > 0} />,
          <ModuleCard key="l" href="/gold/ledger" icon="book" title="Ledger" description="Every gram in and out — immutable, traceable and exportable." metric={recentMoves.data ? count(recentMoves.data.total) : "—"} metricLabel="Entries on record" loading={recentMoves.isLoading} />,
          canOldGold || !me ? (
            <ModuleCard key="o" href="/old-gold" icon="scale" title="Old gold" description="The buy-in desk that feeds the melt — intake, testing and settlement." metric={st ? `${gramsShort(st.old_gold_mg)} g` : "—"} metricLabel="Waiting to be melted" loading={stages.isLoading} />
          ) : null,
        ]}
      </ModuleGrid>

      <SectionHeading index="02" title="Gold flow" subtitle="Where the vault's fine gold sits right now — tap a stage to open it" />
      <Card style={{ marginTop: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
          <Text variant="footnote" tone="secondary">
            <Text variant="headline" num>
              {totalFine === undefined ? "—" : gramsShort(totalFine)}
            </Text>
            {" g fine across the vault"}
          </Text>
          {st && totalFine ? (
            <Text variant="caption1" weight="600" color={c.gold}>
              {`${((st.for_sale_mg / totalFine) * 100).toFixed(0)}% ready to sell`}
            </Text>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", height: 10, borderRadius: 5, borderCurve: "continuous", overflow: "hidden", backgroundColor: c.fill, marginTop: 10 }}>
          {st && totalFine ? FLOW.map((f) => (st[f.key] > 0 ? <View key={f.key} style={{ width: `${(st[f.key] / totalFine) * 100}%`, backgroundColor: f.color, borderRightWidth: 2, borderRightColor: c.card }} /> : null)) : null}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 14, marginHorizontal: -6 }}>
          {FLOW.map((f, i) => (
            <Pressable
              key={f.key}
              onPress={() => {
                haptic.selection();
                router.push(f.href as Href);
              }}
              style={({ pressed }) => ({ width: "50%", padding: 6, opacity: pressed ? 0.6 : 1 })}
            >
              <View style={{ backgroundColor: c.cardSecondary, borderRadius: radius.md, borderCurve: "continuous", padding: 12, gap: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, borderCurve: "continuous", backgroundColor: f.color }} />
                    <Text variant="caption2" num tone="tertiary">
                      {String(i + 1).padStart(2, "0")}
                    </Text>
                  </View>
                  <Icon name={f.icon} size={14} color={c.label3} />
                </View>
                <Text variant="footnote" weight="600">
                  {f.label}
                </Text>
                {stages.isLoading ? (
                  <Skeleton height={22} width={70} />
                ) : (
                  <Text variant="title3" num>
                    {st ? gramsShort(st[f.key]) : "—"}
                    <Text variant="caption1" tone="secondary">
                      {" g"}
                    </Text>
                  </Text>
                )}
                <Text variant="caption2" tone="secondary">
                  {f.hint}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      </Card>

      <SectionHeading index="03" title="Melting" subtitle="Batches in progress and how well the melt is yielding" />
      <StatusBoard
        title="Batch pipeline"
        subtitle={batchesLoading ? "Melting batches by status" : awaitingApproval > 0 ? `${awaitingApproval} melted, waiting on approval` : `${activeBatches} active batch${activeBatches === 1 ? "" : "es"}`}
        icon="flask"
        states={BATCH_STATES}
        counts={batchCounts}
        loading={batchesLoading}
        href={(s) => `/gold/melting?status=${s}`}
        action={{ label: "All batches", onPress: () => router.push("/gold/melting" as Href) }}
      />
      <Section title={yieldPct === undefined ? "Recent batches" : `${yieldPct.toFixed(2)}% yield · ${gramsShort(lossMg)} g lost over ${approvedRows.length} approved`} action={{ label: "Melting", onPress: () => router.push("/gold/melting" as Href) }}>
        {recentBatches.isLoading ? (
          <SkeletonRows rows={3} />
        ) : (recentBatches.data?.rows ?? []).length === 0 ? (
          <EmptyState compact icon="flask" title="No batches yet" message="Start a melting batch to turn bought-in old gold into refined fine gold." />
        ) : (
          (recentBatches.data?.rows ?? []).map((b) => {
            const y = b.input_fine_mg > 0 && b.output_fine_mg > 0 ? (b.output_fine_mg / b.input_fine_mg) * 100 : undefined;
            return (
              <Row
                key={b.id}
                href={`/gold/melting/${b.id}` as Href}
                title={
                  <Text variant="body" mono weight="600">
                    {b.number}
                  </Text>
                }
                subtitle={`${gramsShort(b.input_fine_mg)} g in${b.output_fine_mg > 0 ? ` → ${gramsShort(b.output_fine_mg)} g out` : ""}${y !== undefined ? ` · ${y.toFixed(1)}% yield` : ""} · ${ago(b.created_at)}`}
                right={
                  <View style={{ alignItems: "flex-end", gap: 3 }}>
                    <Pill size="sm" dot tone={BATCH_TONES[b.status] ?? "neutral"}>
                      {b.status}
                    </Pill>
                    {b.loss_mg > 0 ? (
                      <Text variant="caption1" num color={c.redText}>
                        {`−${gramsShort(b.loss_mg)} g`}
                      </Text>
                    ) : null}
                  </View>
                }
              />
            );
          })
        )}
      </Section>

      <SectionHeading index="04" title="Holdings" subtitle="Fine gold on hand, split two ways" />
      <Card style={{ marginTop: 12 }}>
        <CardHeader icon="gem" title="By purity" subtitle="Old gold, refined output and stock" action={{ label: "Stock", onPress: () => router.push("/gold/stock" as Href) }} />
        {byPurity.isLoading ? <SkeletonRows rows={3} /> : purityRows.length === 0 ? <EmptyState compact icon="gem" title="Vault is empty" message="Fine gold on hand will be split by purity here." /> : <BarList items={purityRows} format={(n) => `${gramsShort(n)} g`} />}
      </Card>
      <Card style={{ marginTop: 12 }}>
        <CardHeader icon="store" title="By branch" subtitle="Where the gold is held" action={{ label: "Stock", onPress: () => router.push("/gold/stock" as Href) }} />
        {byBranch.isLoading ? <SkeletonRows rows={3} /> : branchRows.length === 0 ? <EmptyState compact icon="store" title="Nothing held" message="Fine gold on hand will be split by branch here." /> : <BarList items={branchRows} format={(n) => `${gramsShort(n)} g`} color={c.blue} />}
      </Card>

      <SectionHeading index="05" title="Latest movements" subtitle="The newest lines on the gold ledger" />
      <Section title={monthMoves.data ? `${count(monthMoves.data.total)} movements this month` : "Gold ledger"} action={{ label: "Full ledger", onPress: () => router.push("/gold/ledger" as Href) }}>
        {recentMoves.isLoading ? (
          <SkeletonRows rows={4} />
        ) : (recentMoves.data?.rows ?? []).length === 0 ? (
          <EmptyState compact icon="book" title="No movements yet" message="Purchases, sales, melts and transfers post here as gold moves." />
        ) : (
          (recentMoves.data?.rows ?? []).map((e) => <GoldEntryRow key={e.id} e={e} onPress={() => router.push(`/gold/ledger?type=${e.type}` as Href)} />)
        )}
      </Section>
    </Screen>
  );
}

/** One gold ledger line, coloured by whether it crosses the vault boundary. */
export function GoldEntryRow({ e, onPress }: { e: GoldEntry; onPress?: () => void }) {
  const { c } = useTheme();
  const dir = IN_TYPES.has(e.type) ? "in" : OUT_TYPES.has(e.type) ? "out" : "move";
  return (
    <Row
      icon={dir === "in" ? "arrowDownLeft" : dir === "out" ? "arrowUpRight" : "swap"}
      iconColor={dir === "in" ? c.green : dir === "out" ? c.red : c.gray}
      onPress={onPress}
      title={pretty(e.type)}
      subtitle={`${pretty(e.source)} → ${pretty(e.destination)} · ${e.permille}‰ · ${ago(e.occurred_at)}`}
      right={
        <View style={{ alignItems: "flex-end" }}>
          <Text variant="subhead" num weight="600">
            {`${gramsShort(e.fine_mg)} g`}
          </Text>
          <Text variant="caption1" num tone="secondary">
            {`${gramsShort(e.weight_mg)} g gross`}
          </Text>
        </View>
      }
    />
  );
}
