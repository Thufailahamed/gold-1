import { useState } from "react";
import { Pressable, View } from "react-native";
import { router, Stack, useLocalSearchParams, type Href } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { mgToG } from "@goldos/shared";
import { api } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { GUTTER, radius, useTheme } from "@/theme";
import {
  Button,
  Chips,
  Field,
  FieldRow,
  FormStack,
  HeaderButton,
  Icon,
  IconButton,
  Pill,
  Row,
  scanBarcode,
  ScreenList,
  SearchField,
  SelectField,
  Sheet,
  StatusPill,
  Text,
  usePagedQuery,
} from "@/ui";
import { ProductMedia } from "./ProductMedia";

type Product = {
  id: string;
  barcode: string;
  sku: string;
  name: string;
  category_name: string;
  metal_name?: string;
  karat: string;
  net_mg: number;
  fine_gold_mg: number;
  selling_price_cents: number | null;
  image_keys?: string[];
  location?: string | null;
  status: string;
};
type Option = { id: string; name?: string; karat?: string; code?: string; permille?: number };

const STATUSES = ["IN_STOCK", "RESERVED", "SOLD", "RETURNED", "IN_REPAIR", "IN_MANUFACTURING", "TRANSFER_PENDING", "MELTING", "MELTED", "LOST", "VOID"];
const QUICK_STATUSES = ["IN_STOCK", "RESERVED", "SOLD", "IN_REPAIR", "IN_MANUFACTURING"];
const humanize = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (ch) => ch.toUpperCase());
const price = (c: number) => (c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });

// Grid/list choice for the session (web keeps it in localStorage).
let savedView: "grid" | "list" = "grid";

export default function ProductsScreen() {
  const { c } = useTheme();
  const { can } = useSession();
  const params = useLocalSearchParams<{ status?: string }>();
  const [search, setSearch] = useState("");
  const [fCat, setFCat] = useState("");
  const [fPur, setFPur] = useState("");
  const [fBranch, setFBranch] = useState("");
  // Deep links like /products?status=IN_REPAIR preselect the status filter.
  const [fStatus, setFStatus] = useState(params.status && STATUSES.includes(params.status) ? params.status : "");
  const [fMinG, setFMinG] = useState("");
  const [fMaxG, setFMaxG] = useState("");
  const [fMinP, setFMinP] = useState("");
  const [fMaxP, setFMaxP] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setViewState] = useState(savedView);
  const setView = (v: "grid" | "list") => {
    savedView = v;
    setViewState(v);
  };

  function query(page: number): string {
    const p = new URLSearchParams({ search, page: String(page), limit: "20" });
    if (fCat) p.set("categoryId", fCat);
    if (fPur) p.set("purityId", fPur);
    if (fBranch) p.set("branchId", fBranch);
    if (fStatus) p.set("status", fStatus);
    if (fMinG) p.set("minG", fMinG);
    if (fMaxG) p.set("maxG", fMaxG);
    if (fMinP) p.set("minPriceLkr", fMinP);
    if (fMaxP) p.set("maxPriceLkr", fMaxP);
    return `/api/v1/products?${p.toString()}`;
  }
  const list = usePagedQuery<Product>(["products", search, fCat, fPur, fBranch, fStatus, fMinG, fMaxG, fMinP, fMaxP], query, { limit: 20 });
  const allCount = useQuery({ queryKey: ["products-count", "all"], queryFn: () => api<{ rows: Product[]; total: number }>("/api/v1/products?limit=1&page=1") });
  const stockCount = useQuery({ queryKey: ["products-count", "IN_STOCK"], queryFn: () => api<{ rows: Product[]; total: number }>("/api/v1/products?limit=1&page=1&status=IN_STOCK") });
  const cats = useQuery({ queryKey: ["categories-all"], queryFn: () => api<{ rows: Option[]; total: number }>("/api/v1/masters/categories?limit=100") });
  const purs = useQuery({ queryKey: ["purities-all"], queryFn: () => api<{ rows: Option[]; total: number }>("/api/v1/masters/purities?limit=100") });
  const branches = useQuery({ queryKey: ["branches"], queryFn: () => api<{ rows: Option[]; total: number }>("/api/v1/branches?limit=100") });

  const nameOf = (opts: Option[] | undefined, id: string) => {
    const o = opts?.find((x) => x.id === id);
    return o?.name ?? o?.karat ?? id;
  };
  const active = [
    fCat && { key: "cat", label: nameOf(cats.data?.rows, fCat), clear: () => setFCat("") },
    fPur && { key: "pur", label: nameOf(purs.data?.rows, fPur), clear: () => setFPur("") },
    fStatus && { key: "status", label: humanize(fStatus), clear: () => setFStatus("") },
    fBranch && { key: "branch", label: nameOf(branches.data?.rows, fBranch), clear: () => setFBranch("") },
    (fMinG || fMaxG) && { key: "g", label: `${fMinG || "0"}–${fMaxG || "∞"} g`, clear: () => (setFMinG(""), setFMaxG("")) },
    (fMinP || fMaxP) && { key: "p", label: `LKR ${fMinP || "0"}–${fMaxP || "∞"}`, clear: () => (setFMinP(""), setFMaxP("")) },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];
  const advancedCount = [fCat, fBranch, fMinG || fMaxG, fMinP || fMaxP].filter(Boolean).length;

  function clearAll() {
    [setFCat, setFPur, setFBranch, setFStatus, setFMinG, setFMaxG, setFMinP, setFMaxP].forEach((f) => f(""));
    setSearch("");
  }

  async function scan() {
    const code = await scanBarcode({ title: "Look up a piece" });
    if (code) router.push(`/products/barcode/${encodeURIComponent(code.trim())}`);
  }

  const stats = [
    { label: "Pieces", value: allCount.data ? allCount.data.total.toLocaleString("en-US") : "—" },
    { label: "In stock", value: stockCount.data ? stockCount.data.total.toLocaleString("en-US") : "—" },
    { label: "Categories", value: cats.data ? String(cats.data.total) : "—" },
    { label: "Purities", value: purs.data ? String(purs.data.total) : "—" },
  ];

  const header = (
    <View style={{ gap: 12, paddingTop: 8 }}>
      <View style={{ flexDirection: "row", marginHorizontal: GUTTER, backgroundColor: c.card, borderRadius: radius.lg, borderCurve: "continuous", paddingVertical: 12 }}>
        {stats.map((s, i) => (
          <View key={s.label} style={{ flex: 1, alignItems: "center", borderLeftWidth: i ? 0.5 : 0, borderLeftColor: c.separator }}>
            <Text variant="headline" num rounded>
              {s.value}
            </Text>
            <Text variant="caption2" tone="secondary" upper weight="600">
              {s.label}
            </Text>
          </View>
        ))}
      </View>
      <SearchField
        value={search}
        onChangeText={setSearch}
        placeholder="Search name, barcode, SKU…"
        right={
          <>
            <IconButton name="filter" variant={advancedCount ? "filled" : "gray"} onPress={() => setFiltersOpen(true)} accessibilityLabel="Filters" />
            <IconButton name="scan" variant="tinted" onPress={scan} accessibilityLabel="Scan barcode" />
          </>
        }
      />
      <Chips items={[{ key: "", label: "All" }, ...QUICK_STATUSES.map((s) => ({ key: s, label: humanize(s) }))]} value={fStatus} onChange={setFStatus} />
      {(purs.data?.rows ?? []).length ? (
        <Chips items={[{ key: "", label: "All karats" }, ...(purs.data?.rows ?? []).map((p) => ({ key: p.id, label: p.karat ?? p.name ?? "" }))]} value={fPur} onChange={setFPur} />
      ) : null}
      <View style={{ marginHorizontal: GUTTER, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text variant="footnote" tone="secondary" style={{ flex: 1 }}>
          {list.isLoading ? "Loading pieces…" : `${list.total.toLocaleString("en-US")} ${list.total === 1 ? "piece" : "pieces"}${search ? ` for “${search}”` : ""}`}
        </Text>
        <IconButton name="grid" size={30} variant={view === "grid" ? "filled" : "plain"} onPress={() => setView("grid")} accessibilityLabel="Grid view" />
        <IconButton name="list" size={30} variant={view === "list" ? "filled" : "plain"} onPress={() => setView("list")} accessibilityLabel="List view" />
      </View>
      {active.length > 0 ? (
        <View style={{ marginHorizontal: GUTTER, flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {active.map((f) => (
            <Pressable key={f.key} onPress={f.clear}>
              <Pill tone="info" icon="close">
                {f.label}
              </Pill>
            </Pressable>
          ))}
          <Button title="Clear all" variant="plain" size="sm" onPress={clearAll} />
        </View>
      ) : null}
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: "Catalog",
          headerRight: () => (can("products:create") ? <HeaderButton icon="plus" onPress={() => router.push("/products/new")} accessibilityLabel="New product" /> : null),
        }}
      />
      <ScreenList
        key={view}
        query={list}
        grouped={view === "list"}
        numColumns={view === "grid" ? 2 : 1}
        columnWrapperStyle={view === "grid" ? { gap: 10, marginHorizontal: GUTTER, marginBottom: 10 } : undefined}
        keyExtractor={(p) => p.id}
        header={header}
        empty={{
          icon: "gem",
          title: active.length || search ? "Nothing matches" : "Your catalog is empty",
          message: active.length || search ? "Nothing matches these filters. Try widening the search." : "Add the first piece to get started.",
          action: active.length || search ? { label: "Clear filters", onPress: clearAll } : can("products:create") ? { label: "New product", icon: "plus", onPress: () => router.push("/products/new") } : undefined,
        }}
        renderItem={(p) =>
          view === "grid" ? (
            <ProductCard p={p} />
          ) : (
            <Row
              href={`/products/${p.id}` as Href}
              leading={<ProductMedia id={p.id} imageKey={p.image_keys?.[0]} style={{ width: 46, height: 46, borderRadius: 10 , borderCurve: "continuous"}} gemSize={28} />}
              title={p.name}
              subtitle={
                <View style={{ gap: 3 }}>
                  <Text variant="caption1" tone="secondary" mono numberOfLines={1}>
                    {p.barcode} · {p.sku}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <Pill size="sm" tone="info">
                      {p.karat}
                    </Pill>
                    <StatusPill status={p.status} label={humanize(p.status)} size="sm" />
                  </View>
                </View>
              }
              right={
                <View style={{ alignItems: "flex-end" }}>
                  <Text variant="subhead" num weight="600">
                    {p.selling_price_cents !== null ? price(p.selling_price_cents) : "Live"}
                  </Text>
                  <Text variant="caption1" tone="secondary" num>
                    {mgToG(p.net_mg)} g
                  </Text>
                </View>
              }
            />
          )
        }
      />
      <Sheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters" submitLabel="Done" onSubmit={() => setFiltersOpen(false)} cancelLabel="Close">
        <FormStack>
          <SelectField label="Category" value={fCat} allowClear clearLabel="All categories" placeholder="All categories" options={(cats.data?.rows ?? []).map((o) => ({ value: o.id, label: o.name ?? o.id }))} onChange={setFCat} />
          <SelectField label="Branch" value={fBranch} allowClear clearLabel="All branches" placeholder="All branches" options={(branches.data?.rows ?? []).map((o) => ({ value: o.id, label: o.name ?? o.id }))} onChange={setFBranch} />
          <SelectField label="Status" value={fStatus} allowClear clearLabel="All statuses" placeholder="All statuses" options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))} onChange={setFStatus} />
          <SelectField label="Purity" value={fPur} allowClear clearLabel="All purities" placeholder="All purities" options={(purs.data?.rows ?? []).map((o) => ({ value: o.id, label: o.karat ?? o.name ?? o.id }))} onChange={setFPur} />
          <FieldRow>
            <Field label="Min net g" kind="weight" value={fMinG} onChangeText={setFMinG} placeholder="0" />
            <Field label="Max net g" kind="weight" value={fMaxG} onChangeText={setFMaxG} placeholder="∞" />
          </FieldRow>
          <FieldRow>
            <Field label="Min price LKR" kind="money" value={fMinP} onChangeText={setFMinP} placeholder="0" />
            <Field label="Max price LKR" kind="money" value={fMaxP} onChangeText={setFMaxP} placeholder="∞" />
          </FieldRow>
          <Button title="Clear all filters" variant="destructiveTinted" block onPress={clearAll} />
        </FormStack>
      </Sheet>
    </>
  );
}

function ProductCard({ p }: { p: Product }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={() => {
        haptic.selection();
        router.push(`/products/${p.id}`);
      }}
      style={({ pressed }) => ({ flex: 1, backgroundColor: c.card, borderRadius: radius.xl - 4, borderCurve: "continuous", overflow: "hidden", opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}
    >
      <ProductMedia id={p.id} imageKey={p.image_keys?.[0]} karat={p.karat} style={{ height: 130 }} />
      <View style={{ position: "absolute", top: 8, right: 8 }}>
        <StatusPill status={p.status} label={humanize(p.status)} size="sm" />
      </View>
      <View style={{ padding: 11, gap: 3 }}>
        <Text variant="subhead" weight="600" numberOfLines={1}>
          {p.name}
        </Text>
        <Text variant="caption2" tone="secondary" numberOfLines={1}>
          {p.category_name}
          {p.metal_name ? ` · ${p.metal_name}` : ""}
        </Text>
        <Text variant="caption2" tone="tertiary" mono numberOfLines={1}>
          {p.barcode}
        </Text>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
          <View>
            <Text variant="caption2" tone="secondary" upper>
              Net
            </Text>
            <Text variant="footnote" num weight="600">
              {mgToG(p.net_mg)}
            </Text>
          </View>
          <View>
            <Text variant="caption2" tone="secondary" upper>
              Fine
            </Text>
            <Text variant="footnote" num weight="600">
              {mgToG(p.fine_gold_mg)}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
          {p.selling_price_cents !== null ? (
            <Text variant="subhead" num weight="700">
              <Text variant="caption2" tone="secondary">
                LKR{" "}
              </Text>
              {price(p.selling_price_cents)}
            </Text>
          ) : (
            <Text variant="caption1" color={c.gold} weight="600">
              Live price
            </Text>
          )}
          <Icon name="chevronRight" size={11} color={c.label3} weight="bold" />
        </View>
      </View>
    </Pressable>
  );
}
