import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { router, Stack, type Href } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PERMISSIONS } from "@goldos/shared";
import { api } from "@/lib/api";
import { extractScanCode } from "@/lib/barcode";
import { count, date, g, humanize, money0 } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { haptic } from "@/lib/haptics";
import { useBranches, useSession } from "@/lib/session";
import { GUTTER, radius, useTheme } from "@/theme";
import {
  BarList,
  BranchSelect,
  Button,
  Callout,
  Card,
  CardHeader,
  chooseAction,
  Chips,
  EmptyState,
  ErrorState,
  Field,
  Hero,
  Icon,
  IconButton,
  Loading,
  ModuleLinks,
  Row,
  scanBarcode,
  Screen,
  SearchField,
  Section,
  Segmented,
  Skeleton,
  StatusPill,
  Text,
  toast,
  usePagedQuery,
  useRefresh,
  type IconName,
} from "@/ui";
import { MOVEMENT_TYPES, MovementRow, type Insights, type Movement, type Piece, type StockRow } from "./shared";

type GroupBy = "branch" | "purity" | "product";
type Target = "RETURNED" | "IN_STOCK";

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const NOUN: Record<GroupBy, [string, string]> = { branch: ["branch", "branches"], purity: ["purity", "purities"], product: ["piece", "pieces"] };

/** Mirrors the server's transition table for the two moves this screen posts. */
const ACTIONS: { key: Target; title: string; body: string; verb: string; from: string[]; icon: IconName; reasons: string[] }[] = [
  {
    key: "RETURNED",
    title: "Take off the shelf",
    body: "Customer return, damage, or pulled from display.",
    verb: "Take off shelf",
    from: ["IN_STOCK", "SOLD"],
    icon: "return",
    reasons: ["Customer return", "Damaged", "Pulled for photos", "Held for inspection"],
  },
  {
    key: "IN_STOCK",
    title: "Put back on the shelf",
    body: "Restock a returned or inspected piece for sale.",
    verb: "Put back on shelf",
    from: ["RETURNED", "TRANSFER_PENDING"],
    icon: "package",
    reasons: ["Inspected — OK", "Repaired", "Back from display", "Return accepted"],
  },
];

export default function InventoryScreen() {
  const { can } = useSession();
  const canView = can(PERMISSIONS.PRODUCTS_VIEW);
  const [groupBy, setGroupBy] = useState<GroupBy>("branch");
  const [barcode, setBarcode] = useState("");
  const [mType, setMType] = useState("");
  const [mBranch, setMBranch] = useState("");
  const [mSearch, setMSearch] = useState("");
  const mSearchD = useDebounced(mSearch);

  const insights = useQuery({ queryKey: ["inventory", "insights"], queryFn: () => api<Insights>("/api/v1/inventory/insights"), enabled: canView, staleTime: 60_000, retry: false });
  const stock = useQuery({ queryKey: ["stock", groupBy], queryFn: () => api<StockRow[]>(`/api/v1/inventory/stock?groupBy=${groupBy}`), enabled: canView });
  const branches = useBranches();
  const purities = useQuery({ queryKey: ["master-all", "purities"], queryFn: () => api<{ rows: { id: string; karat: string }[] }>("/api/v1/masters/purities?limit=100"), staleTime: 60_000 });
  const moves = usePagedQuery<Movement>(
    ["moves", mType, mBranch, mSearchD],
    (page) => {
      const q = new URLSearchParams({ limit: "25", page: String(page) });
      if (mType) q.set("type", mType);
      if (mBranch) q.set("branchId", mBranch);
      if (mSearchD.trim()) q.set("search", mSearchD.trim());
      return `/api/v1/inventory/movements?${q}`;
    },
    { enabled: canView, limit: 25 }
  );
  const refresh = useRefresh(insights, stock, moves);

  const branchName = (id: string | null) => (id ? (branches.data?.rows.find((b) => b.id === id)?.name ?? id.slice(0, 8)) : "—");
  const karatOf = (id: string) => purities.data?.rows.find((p) => p.id === id)?.karat;

  const rows = useMemo(() => [...(stock.data ?? [])].sort((a, b) => b.fine_mg - a.fine_mg), [stock.data]);
  const totals = useMemo(() => {
    const base = stock.data ?? [];
    const value = base.reduce((s, r) => s + (r.value_cents ?? 0), 0);
    return { pieces: base.reduce((s, r) => s + r.pieces, 0), net: base.reduce((s, r) => s + r.net_mg, 0), fine: base.reduce((s, r) => s + r.fine_mg, 0), value, hasValue: value > 0 };
  }, [stock.data]);

  if (!canView) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Inventory" }} />
        <EmptyState icon="lock" title="No access" message="You need the products:view permission to see inventory." />
      </Screen>
    );
  }

  const t = insights.data?.totals;
  const dash = insights.isLoading || insights.isError;
  const avgPurity = t && t.net_mg > 0 ? (t.fine_mg / t.net_mg) * 100 : 0;

  async function scanToMove() {
    const raw = await scanBarcode({ title: "Scan piece", hint: "Scan the tag of the piece that is moving" });
    if (!raw) return;
    setBarcode(extractScanCode(raw) || raw);
  }

  async function openStockRow(r: StockRow) {
    if (groupBy === "branch") {
      setMBranch(r.key);
      return;
    }
    if (groupBy !== "product") return;
    const i = await chooseAction(r.name ?? r.barcode ?? "Piece", ["View product", "Record movement"]);
    if (i === 0) router.push(`/products/${r.key}` as Href);
    if (i === 1 && r.barcode) setBarcode(r.barcode);
  }

  const a = insights.data?.attention;
  const last = a?.last_movement_at ?? null;
  const quiet = !!a && (last === null || Date.now() - last > STALE_AFTER_MS);
  const attention: { key: string; icon: IconName; title: string; sub: string; tone: "warning" | "info" | "neutral"; onPress: () => void }[] = [];
  if (a?.transfer_pending) attention.push({ key: "t", icon: "truck", title: `${count(a.transfer_pending)} pieces in transit`, sub: "Awaiting receipt at destination", tone: "warning", onPress: () => setMType("TRANSFER_OUT") });
  if (a?.in_repair) attention.push({ key: "r", icon: "hammer", title: `${count(a.in_repair)} pieces in repair`, sub: "Off the shelf at the workshop", tone: "info", onPress: () => router.push("/products?status=IN_REPAIR" as Href) });
  if (a?.reserved) attention.push({ key: "h", icon: "personCheck", title: `${count(a.reserved)} pieces reserved`, sub: "Held for customers, not on the shelf", tone: "neutral", onPress: () => router.push("/products?status=RESERVED" as Href) });
  if (quiet)
    attention.push({
      key: "q",
      icon: "history",
      title: last === null ? "No movements logged yet" : "No movement in over a week",
      sub: last === null ? "Scan a piece to start the ledger" : `Last activity ${date(last)}`,
      tone: "warning",
      onPress: () => setMType(""),
    });

  return (
    <Screen {...refresh}>
      <Stack.Screen options={{ title: "Inventory" }} />
      <Hero
        style={{ marginTop: 8 }}
        kicker={insights.isError ? "Data unavailable" : "Inventory"}
        title="Every gram, accounted for."
        subtitle={insights.isError ? "Insights could not be loaded. Pull to refresh." : undefined}
        stats={[
          { label: "Pieces on hand", value: dash ? "—" : count(t?.pieces ?? 0) },
          { label: "Net weight", value: dash ? "—" : g(t?.net_mg ?? 0) },
          { label: avgPurity ? `Fine · ${avgPurity.toFixed(1)}%` : "Fine gold", value: dash ? "—" : g(t?.fine_mg ?? 0) },
          { label: "Stock value", value: dash ? "—" : (t?.value_cents ?? 0) > 0 ? money0(t!.value_cents) : "Not priced", onPress: (t?.value_cents ?? 0) > 0 ? undefined : () => router.push("/gold-rates" as Href) },
        ]}
        actions={<Button title="Scan to move stock" icon="scan" variant="filled" onPress={() => void scanToMove()} />}
      />

      <ModuleLinks
        title="Workflows"
        links={[
          { href: "/inventory/counts", label: "Stock counts", subtitle: "Scan the shelf against a frozen snapshot", icon: "clipboardCheck" },
          { href: "/inventory/transfers", label: "Branch transfers", subtitle: "Request, approve, dispatch and receive", icon: "truck" },
          { href: "/inventory/discrepancies", label: "Discrepancies", subtitle: "Missing pieces, overdue transfers, gold consistency", icon: "alert" },
        ]}
      />

      <Section title={a ? `Needs attention · ${a.movements_24h} moves in 24h` : "Needs attention"}>
        {insights.isLoading ? <Row title={<Skeleton width={180} />} /> : null}
        {insights.isError ? <Row title="Unavailable" subtitle="Could not load insights" icon="alert" iconColor="#FF3B30" onPress={() => void insights.refetch()} /> : null}
        {a && attention.length === 0 ? <Row title="All clear" subtitle="Nothing is in transit, repair or waiting on a decision." icon="checkCircle" iconColor="#34C759" /> : null}
        {attention.map((r) => (
          <Row key={r.key} title={r.title} subtitle={r.sub} icon={r.icon} iconColor={r.tone === "warning" ? "#FF9500" : r.tone === "info" ? "#007AFF" : "#8E8E93"} onPress={r.onPress} chevron />
        ))}
      </Section>

      {insights.data && insights.data.byKarat.length > 0 ? (
        <Card style={{ marginTop: 22 }}>
          <CardHeader title="Fine gold by karat" subtitle={`${insights.data.byKarat.length} purities`} icon="gem" />
          <BarList items={insights.data.byKarat.map((k) => ({ label: k.karat, value: k.fine_mg, sub: `${count(k.pieces)} pcs · ${g(k.net_mg)} net${k.value_cents ? ` · ${money0(k.value_cents)}` : ""}` }))} format={(n) => g(n)} />
        </Card>
      ) : null}
      {insights.data && insights.data.byBranch.length > 0 ? (
        <Card style={{ marginTop: 14 }}>
          <CardHeader title="Stock by branch" subtitle={`${insights.data.byBranch.length} branches`} icon="building" />
          <BarList items={insights.data.byBranch.map((b) => ({ label: b.name, value: b.fine_mg, sub: `${count(b.pieces)} pcs · ${g(b.net_mg)} net${b.value_cents ? ` · ${money0(b.value_cents)}` : ""}` }))} format={(n) => g(n)} color="#007AFF" />
        </Card>
      ) : null}

      <MovementComposer barcode={barcode} onBarcode={setBarcode} onScan={() => void scanToMove()} branchName={branchName} />

      <Segmented
        style={{ marginTop: 26 }}
        options={[
          { key: "branch", label: "By branch" },
          { key: "purity", label: "By purity" },
          { key: "product", label: "By product" },
        ]}
        value={groupBy}
        onChange={setGroupBy}
      />
      <Section
        title={stock.data ? `Stock on hand · ${count(rows.length)} ${NOUN[groupBy][rows.length === 1 ? 0 : 1]}` : "Stock on hand"}
        footer={stock.data ? `Total ${count(totals.pieces)} pcs · ${g(totals.net)} net · ${g(totals.fine)} fine · ${totals.hasValue ? money0(totals.value) : "not priced"}` : undefined}
      >
        {stock.isLoading ? <Loading /> : null}
        {stock.isError ? <ErrorState error={stock.error} onRetry={() => void stock.refetch()} /> : null}
        {stock.data && rows.length === 0 ? <Row title="No stock on hand" subtitle="No pieces are in stock for this grouping." href={"/products" as Href} /> : null}
        {rows.slice(0, groupBy === "product" ? 200 : undefined).map((r) => (
          <Row
            key={r.key}
            icon={groupBy === "branch" ? "building" : groupBy === "purity" ? "gem" : undefined}
            title={groupBy === "branch" ? branchName(r.key) === r.key.slice(0, 8) ? (r.name ?? r.key.slice(0, 8)) : branchName(r.key) : groupBy === "purity" ? (karatOf(r.key) ?? r.name ?? r.key.slice(0, 8)) : (r.name ?? "Unnamed piece")}
            subtitle={`${groupBy === "product" ? `${r.barcode ?? r.key.slice(0, 10)} · ` : `${count(r.pieces)} pcs · `}${g(r.net_mg)} net${r.net_mg > 0 ? ` · ${Math.round((r.fine_mg / r.net_mg) * 100)}% fine` : ""}`}
            right={
              <View style={{ alignItems: "flex-end" }}>
                <Text variant="subhead" num weight="600">
                  {g(r.fine_mg)}
                </Text>
                <Text variant="caption1" num tone="secondary">
                  {r.value_cents ? money0(r.value_cents) : "—"}
                </Text>
              </View>
            }
            onPress={groupBy === "purity" ? undefined : () => void openStockRow(r)}
          />
        ))}
      </Section>
      {groupBy === "product" && rows.length > 200 ? (
        <Text variant="footnote" tone="secondary" center style={{ marginTop: 8 }}>
          Showing the 200 heaviest pieces. Use the catalog to search the rest.
        </Text>
      ) : null}

      <Text variant="title3" style={{ marginHorizontal: GUTTER, marginTop: 30 }}>
        Movement history
      </Text>
      <Text variant="footnote" tone="secondary" style={{ marginHorizontal: GUTTER, marginTop: 2 }}>
        {moves.data ? `${count(moves.total)} ${mType ? humanize(mType).toLowerCase() : ""} movements${mBranch ? ` at ${branchName(mBranch)}` : ""}`.replace(/\s+/g, " ") : "Latest movements"}
      </Text>
      <Chips items={MOVEMENT_TYPES} value={mType} onChange={setMType} style={{ marginTop: 12 }} />
      <SearchField value={mSearch} onChangeText={setMSearch} placeholder="Barcode or reason…" style={{ marginTop: 10 }} />
      <View style={{ marginHorizontal: GUTTER, marginTop: 10 }}>
        <BranchSelect value={mBranch} onChange={setMBranch} allowAll />
      </View>
      <Section>
        {moves.isLoading ? <Loading /> : null}
        {moves.isError ? <ErrorState error={moves.error} onRetry={() => void moves.refetch()} /> : null}
        {moves.data && moves.rows.length === 0 ? <Row title="No movements" subtitle="Nothing matches these filters. Clear them to see the full ledger." /> : null}
        {moves.rows.map((m) => (
          <MovementRow key={m.id} m={m} branchName={branchName} onPress={() => router.push(`/products/${m.product_id}` as Href)} />
        ))}
      </Section>
      {moves.hasNextPage ? <Button title="Load more" variant="plain" loading={moves.isFetchingNextPage} onPress={() => void moves.fetchNextPage()} style={{ alignSelf: "center", marginTop: 8 }} /> : null}
      {mType || mBranch || mSearch ? (
        <Button
          title="Clear filters"
          variant="plain"
          onPress={() => {
            setMType("");
            setMBranch("");
            setMSearch("");
          }}
          style={{ alignSelf: "center" }}
        />
      ) : null}
    </Screen>
  );
}

function MovementComposer({ barcode, onBarcode, onScan, branchName }: { barcode: string; onBarcode: (v: string) => void; onScan: () => void; branchName: (id: string | null) => string }) {
  const { c } = useTheme();
  const qc = useQueryClient();
  const [target, setTarget] = useState<Target>("RETURNED");
  const [reason, setReason] = useState("");
  const code = barcode.trim();
  const debounced = useDebounced(code, 300);

  const lookup = useQuery({
    queryKey: ["piece-by-barcode", debounced],
    queryFn: () => api<Piece>(`/api/v1/products/barcode/${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 0,
    retry: false,
    staleTime: 10_000,
  });
  const piece = lookup.data && lookup.data.product.barcode.toLowerCase() === code.toLowerCase() ? lookup.data.product : null;
  const pending = code.length > 0 && (code !== debounced || lookup.isFetching);
  const notFound = !pending && code.length > 0 && lookup.isError;

  useEffect(() => {
    if (!piece) return;
    const fits = ACTIONS.find((x) => x.from.includes(piece.status));
    if (fits) setTarget(fits.key);
  }, [piece?.id, piece?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const action = ACTIONS.find((x) => x.key === target)!;
  const blocked: string | null = !code
    ? "Scan a piece to begin"
    : notFound
      ? "No piece with that barcode"
      : piece && piece.status === target
        ? `Already ${humanize(target).toLowerCase()}`
        : piece && !action.from.includes(piece.status)
          ? `Not possible while ${humanize(piece.status).toLowerCase()}`
          : null;

  const move = useMutation({
    mutationFn: async () => {
      const id = piece?.id ?? (await api<Piece>(`/api/v1/products/barcode/${encodeURIComponent(code)}`)).product.id;
      return api("/api/v1/inventory/movements", { method: "POST", body: JSON.stringify({ productId: id, toStatus: target, reason: reason.trim() || undefined }) });
    },
    onSuccess: () => {
      haptic.success();
      toast.success(`${piece?.name ?? code} · ${humanize(target)}`);
      onBarcode("");
      setReason("");
      void qc.invalidateQueries({ queryKey: ["moves"] });
      void qc.invalidateQueries({ queryKey: ["stock"] });
      void qc.invalidateQueries({ queryKey: ["inventory", "insights"] });
      void qc.invalidateQueries({ queryKey: ["piece-by-barcode"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => toast.error(e, "Movement failed"),
  });
  const canPost = !blocked && !move.isPending;

  return (
    <Card style={{ marginTop: 22 }}>
      <CardHeader title="Record movement" subtitle="Scan a piece, choose what's happening, post it." icon="refresh" />
      <Field
        label="1 · Scan piece"
        kind="code"
        value={barcode}
        onChangeText={onBarcode}
        placeholder="Scan or type JW-XXXXXX"
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={() => canPost && move.mutate()}
        error={notFound ? `No piece with barcode ${code}` : null}
        right={
          <View style={{ flexDirection: "row", gap: 6 }}>
            {barcode ? <IconButton name="closeCircle" variant="plain" size={30} onPress={() => onBarcode("")} accessibilityLabel="Clear barcode" /> : null}
            <IconButton name="scan" variant="tinted" size={30} onPress={onScan} accessibilityLabel="Scan barcode" />
          </View>
        }
      />
      <View style={{ marginTop: 10 }}>
        {!code ? (
          <Text variant="footnote" tone="tertiary">
            The piece's details, weight and current status appear here as soon as it's scanned.
          </Text>
        ) : pending && !piece ? (
          <Skeleton height={86} r={radius.md} />
        ) : piece ? (
          <View style={{ backgroundColor: c.cardSecondary, borderRadius: radius.md, borderCurve: "continuous", padding: 12, gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text variant="subhead" weight="600" numberOfLines={1}>
                  {piece.name}
                </Text>
                <Text variant="caption1" mono tone="secondary">
                  {`${piece.barcode} · ${piece.karat}`}
                </Text>
              </View>
              <StatusPill status={piece.status} size="sm" />
            </View>
            <View style={{ flexDirection: "row" }}>
              {[
                ["Branch", branchName(piece.branch_id)],
                ["Net", g(piece.net_mg)],
                ["Fine", g(piece.fine_gold_mg)],
              ].map(([k, v]) => (
                <View key={k} style={{ flex: 1 }}>
                  <Text variant="caption2" tone="secondary" upper>
                    {k}
                  </Text>
                  <Text variant="footnote" num numberOfLines={1}>
                    {v}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </View>

      <Text variant="footnote" tone="secondary" weight="500" style={{ marginTop: 16, marginBottom: 8, paddingHorizontal: 4 }}>
        2 · What's happening?
      </Text>
      <View style={{ gap: 8 }}>
        {ACTIONS.map((x) => {
          const selected = x.key === target;
          const impossible = !!piece && !x.from.includes(piece.status) && piece.status !== x.key;
          return (
            <Pressable
              key={x.key}
              onPress={() => {
                haptic.selection();
                setTarget(x.key);
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                padding: 12,
                borderRadius: radius.md, borderCurve: "continuous",
                backgroundColor: selected ? c.vault : c.cardSecondary,
                opacity: impossible && !selected ? 0.55 : pressed ? 0.8 : 1,
              })}
            >
              <View style={{ width: 34, height: 34, borderRadius: 9, borderCurve: "continuous", alignItems: "center", justifyContent: "center", backgroundColor: selected ? "rgba(231,198,90,0.2)" : c.fill }}>
                <Icon name={x.icon} size={16} color={selected ? c.goldLight : c.label2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="subhead" weight="600" color={selected ? c.onVault : undefined}>
                  {x.title}
                </Text>
                <Text variant="caption1" color={selected ? c.onVault2 : c.label2}>
                  {impossible ? `Not possible while ${humanize(piece!.status).toLowerCase()}` : x.body}
                </Text>
              </View>
              <Icon name={selected ? "checkCircle" : "circle"} size={20} color={selected ? c.goldLight : c.label4} />
            </Pressable>
          );
        })}
      </View>

      <Field label="Reason (optional)" value={reason} onChangeText={setReason} maxLength={200} placeholder="Why is this piece moving?" containerStyle={{ marginTop: 14 }} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {action.reasons.map((r) => (
          <Button key={r} title={r} size="sm" variant={reason === r ? "tinted" : "gray"} onPress={() => setReason(r)} />
        ))}
      </View>

      {blocked && code ? (
        <Callout tone="danger" style={{ marginHorizontal: 0, marginTop: 14 }}>
          {blocked}
        </Callout>
      ) : null}
      {piece && !blocked ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, justifyContent: "center" }}>
          <StatusPill status={piece.status} size="sm" />
          <Icon name="arrowRight" size={12} color={c.label3} />
          <StatusPill status={target} size="sm" />
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
        <Button
          title="Clear"
          variant="gray"
          onPress={() => {
            onBarcode("");
            setReason("");
          }}
        />
        <Button title={action.verb} icon={action.icon} style={{ flex: 1 }} disabled={!canPost} loading={move.isPending} onPress={() => move.mutate()} />
      </View>
      <Button title="Moving to another branch? Start a transfer" variant="plain" size="sm" icon="truck" onPress={() => router.push("/inventory/transfers/new" as Href)} style={{ marginTop: 8 }} />
    </Card>
  );
}
