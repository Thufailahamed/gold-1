import { useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { router, Stack, useLocalSearchParams, type Href } from "expo-router";
import { Image } from "expo-image";
import { SvgXml } from "react-native-svg";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiText, appendFile, authedSource, formApi } from "@/lib/api";
import { centsInput, date, dateTime, g, humanize, money, mgInput } from "@/lib/format";
import { useBranches } from "@/lib/session";
import { pickFile } from "@/lib/pick";
import { GUTTER, radius, useTheme } from "@/theme";
import {
  Button,
  Callout,
  Card,
  CardHeader,
  confirm,
  DateField,
  ErrorState,
  Field,
  FieldRow,
  FormStack,
  Hero,
  Icon,
  KeyValue,
  LineageChain,
  Loading,
  Pill,
  promptText,
  Row,
  Screen,
  Section,
  Segmented,
  SelectField,
  Sheet,
  StatusPill,
  Text,
  toast,
  useRefresh,
  type LineageEdge,
  type LineageNode,
} from "@/ui";
import { CustomerField, type PickedCustomer } from "@/features/shared/CustomerPicker";
import { imagePath, ProductMedia } from "./ProductMedia";

type Product = {
  id: string;
  barcode: string;
  sku: string;
  name: string;
  category_name: string;
  karat: string;
  permille: number;
  gross_mg: number;
  stone_mg: number;
  net_mg: number;
  fine_gold_mg: number;
  making_cents: number;
  wastage_mg: number;
  cost_cents: number | null;
  selling_price_cents: number | null;
  location: string | null;
  notes: string | null;
  subcategory_id?: string | null;
  design_id?: string | null;
  product_type_id?: string | null;
  stone_type_id?: string | null;
  image_keys: string[];
  status: string;
  branch_id: string;
  reserved_customer_id: string | null;
  reserved_customer_name: string | null;
  reserved_note: string | null;
  reserved_until: number | null;
  reserved_at: number | null;
};
type Detail = {
  product: Product;
  livePrice: { amount_cents: number; rate_cents_per_g: number; rate_effective_from: number } | null;
  noRate: boolean;
};
type Movement = { id: string; type: string; from_status: string | null; to_status: string; reason: string | null; created_at: number };
type Named = { id: string; name: string };

const MAX_IMAGES = 10;

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<"specs" | "moves">("specs");
  const [editing, setEditing] = useState(false);
  const [reserving, setReserving] = useState(false);

  const detail = useQuery({ queryKey: ["product", id], queryFn: () => api<Detail>(`/api/v1/products/${id}`), enabled: !!id });
  const moves = useQuery({
    queryKey: ["product-moves", id],
    queryFn: () => api<{ rows: Movement[]; total: number }>(`/api/v1/inventory/movements?productId=${id}&limit=50`),
    enabled: !!id && tab === "moves",
  });
  const label = useQuery({ queryKey: ["product-label", id], queryFn: () => apiText(`/api/v1/products/${id}/label`), enabled: !!id, retry: false });
  const lineage = useQuery({
    queryKey: ["lineage", "product", id],
    queryFn: () => api<{ nodes: LineageNode[]; edges: LineageEdge[] }>(`/api/v1/gold/lineage?refEntity=product&refId=${id}`),
    enabled: !!id,
    retry: false,
  });
  const branches = useBranches();
  const refresh = useRefresh(detail, label, lineage, ...(tab === "moves" ? [moves] : []));

  const refreshProduct = () => {
    void qc.invalidateQueries({ queryKey: ["product", id] });
    void qc.invalidateQueries({ queryKey: ["product-moves", id] });
    void qc.invalidateQueries({ queryKey: ["products"] });
  };

  const voidIt = useMutation({
    mutationFn: (reason: string) => api(`/api/v1/products/${id}/void`, { method: "PATCH", body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      toast.success("Product voided");
      refreshProduct();
    },
    onError: (e) => toast.error(e, "Void failed"),
  });
  const release = useMutation({
    mutationFn: (reason: string) => api(`/api/v1/products/${id}/release`, { method: "POST", body: JSON.stringify({ reason: reason || undefined }) }),
    onSuccess: () => {
      toast.success("Hold released — piece is back on the shelf");
      refreshProduct();
    },
    onError: (e) => toast.error(e, "Release failed"),
  });
  const upload = useMutation({
    mutationFn: async () => {
      const file = await pickFile({ title: "Add image" });
      if (!file) return false;
      const form = new FormData();
      appendFile(form, "file", file);
      await formApi(`/api/v1/products/${id}/images`, form);
      return true;
    },
    onSuccess: (added) => {
      if (!added) return;
      toast.success("Image added");
      refreshProduct();
    },
    onError: (e) => toast.error(e, "Upload failed"),
  });
  const removeImage = useMutation({
    mutationFn: (img: string) => api(`/api/v1/products/${id}/images/${img}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Image removed");
      refreshProduct();
    },
    onError: (e) => toast.error(e, "Remove failed"),
  });

  if (detail.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Product", headerLargeTitleEnabled: false }} />
        <Loading />
      </Screen>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Product", headerLargeTitleEnabled: false }} />
        <ErrorState error={detail.error} title="Product not found" onRetry={() => void detail.refetch()} />
        <Button title="Back to products" variant="plain" onPress={() => router.replace("/products")} style={{ alignSelf: "center" }} />
      </Screen>
    );
  }

  const { product: p, livePrice, noRate } = detail.data;
  const holdExpired = p.reserved_until !== null && p.reserved_until < Date.now();
  const isVoid = p.status === "VOID";
  const branchName = branches.data?.rows.find((b) => b.id === p.branch_id)?.name ?? p.branch_id;
  const heroW = width - GUTTER * 2;

  async function onRelease() {
    const reason = await promptText({ title: "Release hold", message: "Why is the hold ending? (optional)", placeholder: "Reason", submitLabel: "Release" });
    if (reason === null) return;
    release.mutate(reason);
  }
  async function onVoid() {
    const reason = await promptText({ title: "Void product", message: "The piece leaves stock permanently. Give a reason.", placeholder: "Reason", required: true, submitLabel: "Void", destructive: true });
    if (!reason) return;
    voidIt.mutate(reason);
  }
  async function onRemoveImage(img: string) {
    const ok = await confirm({ title: "Remove this image?", confirmText: "Remove", destructive: true });
    if (ok) removeImage.mutate(img);
  }

  const specs: [string, string][] = [
    ["Category", p.category_name],
    ["Karat", `${p.karat} (${p.permille})`],
    ["Gross", g(p.gross_mg)],
    ["Stone", g(p.stone_mg)],
    ["Net", g(p.net_mg)],
    ["Fine gold", g(p.fine_gold_mg)],
    ["Wastage", g(p.wastage_mg)],
    ["Making", money(p.making_cents)],
    ["Cost", money(p.cost_cents)],
    ["Selling", money(p.selling_price_cents)],
    ["Location", p.location ?? "—"],
    ["Branch", branchName],
  ];

  return (
    <Screen {...refresh}>
      <Stack.Screen options={{ title: p.barcode, headerLargeTitleEnabled: false }} />

      {/* Photo carousel, or the gem placeholder. */}
      {p.image_keys.length > 0 ? (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} snapToInterval={heroW + 10} decelerationRate="fast" contentContainerStyle={{ paddingHorizontal: GUTTER, gap: 10 }}>
          {p.image_keys.map((k) => (
            <Image key={k} source={authedSource(imagePath(p.id, k))} style={{ width: heroW, height: heroW * 0.8, borderRadius: radius.xl, backgroundColor: c.fill }} contentFit="cover" transition={200} />
          ))}
        </ScrollView>
      ) : (
        <ProductMedia id={p.id} karat={p.karat} gemSize={88} style={{ marginHorizontal: GUTTER, marginTop: 8, height: 200, borderRadius: radius.xl , borderCurve: "continuous"}} />
      )}

      <Hero
        style={{ marginTop: 14 }}
        kicker="Catalog · Piece detail"
        title={p.name}
        subtitle={livePrice ? "Live price = net weight × board rate + making" : "Publish a board rate to enable live pricing for this piece"}
        stats={[
          { label: "Live price", value: livePrice ? money(livePrice.amount_cents) : "—" },
          { label: "Net weight", value: g(p.net_mg) },
          { label: "Karat", value: p.karat },
          { label: "Making", value: money(p.making_cents) },
        ]}
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          <Pill tone="dark">{p.barcode}</Pill>
          <Pill tone="dark">{p.sku}</Pill>
          <Pill tone="dark" dot>
            {humanize(p.status)}
          </Pill>
        </View>
      </Hero>

      <View style={{ marginHorizontal: GUTTER, marginTop: 14, gap: 10 }}>
        {p.status === "IN_STOCK" || p.status === "RESERVED" ? (
          <Button title="Sell at POS" icon="cart" block onPress={() => router.push(`/pos?add=${encodeURIComponent(p.barcode)}` as Href)} />
        ) : null}
        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          {!isVoid ? <Button title="Edit" icon="edit" variant="gray" onPress={() => setEditing(true)} style={{ flexGrow: 1 }} /> : null}
          {p.status === "IN_STOCK" ? <Button title="Reserve" icon="bag" variant="gray" onPress={() => setReserving(true)} style={{ flexGrow: 1 }} /> : null}
          {p.status === "RESERVED" ? <Button title="Release hold" icon="unlock" variant="gray" loading={release.isPending} onPress={() => void onRelease()} style={{ flexGrow: 1 }} /> : null}
          {p.status === "SOLD" || p.status === "RETURNED" ? (
            <Button title="Find sale" icon="receipt" variant="gray" onPress={() => router.push(`/sales/invoices/lookup/${encodeURIComponent(p.barcode)}` as Href)} style={{ flexGrow: 1 }} />
          ) : null}
          {p.status === "IN_STOCK" ? <Button title="Void" icon="ban" variant="destructiveTinted" loading={voidIt.isPending} onPress={() => void onVoid()} style={{ flexGrow: 1 }} /> : null}
        </View>
      </View>

      {p.status === "RESERVED" ? (
        <Callout tone={holdExpired ? "danger" : "warning"} title={`Held for ${p.reserved_customer_name ?? "a customer"}${holdExpired ? " — hold expired" : ""}`} style={{ marginTop: 14 }}>
          {`${p.reserved_note ?? ""}${p.reserved_until !== null ? ` · until ${date(p.reserved_until)}` : " · no end date"}${p.reserved_at !== null ? ` · since ${date(p.reserved_at)}` : ""}. Only this customer can buy it at the POS; release the hold to sell it to anyone else.`}
        </Callout>
      ) : null}
      {noRate || !livePrice ? (
        <Callout tone="warning" title="Price unavailable" style={{ marginTop: 14 }}>
          {`No rate published for ${p.karat} — publish a board rate to enable live pricing.`}
        </Callout>
      ) : null}

      <Segmented
        style={{ marginTop: 22 }}
        options={[
          { key: "specs", label: "Specs" },
          { key: "moves", label: "Movements" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "specs" ? (
        <Section>
          {specs.map(([k, v]) => (
            <KeyValue key={k} label={k} value={v} />
          ))}
          <KeyValue label="Status" value={<StatusPill status={p.status} size="sm" />} />
          <Row title="Notes" subtitle={p.notes ?? "—"} numberOfLines={0} />
        </Section>
      ) : (
        <Section title="Movement history" footer="Every status change for this piece.">
          {moves.isLoading ? <Loading /> : null}
          {moves.isError ? <Row title="Movements unavailable" subtitle="Could not load the movement history." /> : null}
          {!moves.isLoading && !moves.isError && (moves.data?.rows ?? []).length === 0 ? <Row title="No movements" subtitle="This piece has no recorded movements yet." /> : null}
          {(moves.data?.rows ?? []).map((m) => (
            <Row
              key={m.id}
              title={
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Pill size="sm">{m.type}</Pill>
                  <Text variant="footnote" tone="secondary">
                    {humanize(m.from_status) || "—"}
                  </Text>
                  <Icon name="arrowRight" size={11} color={c.label3} />
                  <Text variant="footnote" weight="600">
                    {humanize(m.to_status)}
                  </Text>
                </View>
              }
              subtitle={`${dateTime(m.created_at)}${m.reason ? ` · ${m.reason}` : ""}`}
              numberOfLines={2}
            />
          ))}
        </Section>
      )}

      {p.image_keys.length > 0 || !isVoid ? (
        <Card style={{ marginTop: 22 }}>
          <CardHeader
            title="Images"
            subtitle={`${p.image_keys.length} of ${MAX_IMAGES} attached`}
            icon="photo"
            action={!isVoid && p.image_keys.length < MAX_IMAGES && !upload.isPending ? { label: "Add image", onPress: () => upload.mutate() } : undefined}
          />
          {upload.isPending ? <Loading /> : null}
          {p.image_keys.length === 0 ? (
            <Text variant="footnote" tone="tertiary">
              No images yet. JPEG, PNG or WebP, up to 5 MB each.
            </Text>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
              {p.image_keys.map((k) => {
                const img = k.split("/").pop()!;
                return (
                  <View key={k}>
                    <Image source={authedSource(imagePath(p.id, k))} style={{ width: 96, height: 96, borderRadius: radius.md, backgroundColor: c.fill }} contentFit="cover" />
                    {!isVoid ? (
                      <Pressable
                        accessibilityLabel="Remove image"
                        disabled={removeImage.isPending}
                        onPress={() => void onRemoveImage(img)}
                        hitSlop={8}
                        style={{ position: "absolute", top: 4, right: 4, width: 26, height: 26, borderRadius: 13, borderCurve: "continuous", backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}
                      >
                        <Icon name="trash" size={13} color="#FF6B6B" />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </Card>
      ) : null}

      <Card style={{ marginTop: 14 }}>
        <CardHeader title="Barcode label" subtitle="Print-ready label for this piece" icon="barcode" />
        <View style={{ marginTop: 12, backgroundColor: "#fff", borderRadius: radius.md, borderCurve: "continuous", padding: 10, alignItems: "center", minHeight: 80, justifyContent: "center" }}>
          {label.data ? <SvgXml xml={label.data} width="100%" height={120} /> : label.isError ? <Text variant="footnote" tone="tertiary">Label preview unavailable.</Text> : <Loading />}
        </View>
        <Button title="Print label" icon="print" style={{ marginTop: 12 }} block onPress={() => router.push(`/products/${p.id}/print` as Href)} />
      </Card>

      <Card style={{ marginTop: 14 }}>
        <CardHeader title="Gold lineage" subtitle="Backwards and forwards through every transformation" icon="link" />
        <View style={{ marginTop: 12 }}>
          {lineage.isLoading ? <Loading /> : lineage.isError || !lineage.data ? <Text variant="footnote" tone="tertiary">Lineage unavailable.</Text> : <LineageChain nodes={lineage.data.nodes} edges={lineage.data.edges} />}
        </View>
      </Card>

      {editing ? (
        <EditSheet
          product={p}
          onClose={(saved) => {
            setEditing(false);
            if (saved) refreshProduct();
          }}
        />
      ) : null}
      {reserving ? (
        <ReserveSheet
          id={p.id}
          onClose={(saved) => {
            setReserving(false);
            if (saved) refreshProduct();
          }}
        />
      ) : null}
    </Screen>
  );
}

function useMaster(path: string) {
  return useQuery({ queryKey: ["master-all", path], queryFn: () => api<{ rows: Named[] }>(`/api/v1/masters/${path}?limit=100`), staleTime: 60_000 });
}
const opts = (rows: Named[] | undefined) => (rows ?? []).map((r) => ({ value: r.id, label: r.name }));

function EditSheet({ product, onClose }: { product: Product; onClose: (saved: boolean) => void }) {
  const [name, setName] = useState(product.name);
  const [making, setMaking] = useState(centsInput(product.making_cents));
  const [wastage, setWastage] = useState(mgInput(product.wastage_mg));
  const [cost, setCost] = useState(centsInput(product.cost_cents));
  const [selling, setSelling] = useState(centsInput(product.selling_price_cents));
  const [location, setLocation] = useState(product.location ?? "");
  const [notes, setNotes] = useState(product.notes ?? "");
  const [subcategoryId, setSubcategoryId] = useState(product.subcategory_id ?? "");
  const [designId, setDesignId] = useState(product.design_id ?? "");
  const [productTypeId, setProductTypeId] = useState(product.product_type_id ?? "");
  const [stoneTypeId, setStoneTypeId] = useState(product.stone_type_id ?? "");
  const subcats = useMaster("subcategories");
  const designs = useMaster("designs");
  const ptypes = useMaster("product-types");
  const stones = useMaster("stone-types");

  const num = (s: string) => Number(s.replace(/,/g, ""));
  const bad = (s: string) => s.trim() !== "" && (!Number.isFinite(num(s)) || num(s) < 0);
  const valid = !!name.trim() && ![making, wastage, cost, selling].some(bad);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: name.trim() || undefined,
        makingLkr: making.trim() !== "" ? num(making) : 0,
        wastageG: wastage.trim() !== "" ? num(wastage) : 0,
        location: location.trim() || undefined,
        notes: notes.trim() || undefined,
        subcategoryId: subcategoryId || undefined,
        designId: designId || undefined,
        productTypeId: productTypeId || undefined,
        stoneTypeId: stoneTypeId || undefined,
      };
      if (cost.trim() !== "") body.costLkr = num(cost);
      if (selling.trim() !== "") body.sellingPriceLkr = num(selling);
      return api(`/api/v1/products/${product.id}`, { method: "PATCH", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      toast.success("Product updated");
      onClose(true);
    },
    onError: (e) => toast.error(e, "Update failed"),
  });

  return (
    <Sheet visible onClose={() => onClose(false)} title={`Edit ${product.barcode}`} submitLabel="Save" onSubmit={() => save.mutate()} submitting={save.isPending} canSubmit={valid}>
      <FormStack>
        <Field label="Product name" value={name} onChangeText={setName} maxLength={200} error={!name.trim() ? "Name is required" : null} />
        <FieldRow>
          <Field label="Making (LKR)" kind="money" value={making} onChangeText={setMaking} placeholder="0.00" error={bad(making) ? "Invalid" : null} />
          <Field label="Wastage (g)" kind="weight" value={wastage} onChangeText={setWastage} placeholder="0.000" error={bad(wastage) ? "Invalid" : null} />
        </FieldRow>
        <FieldRow>
          <Field label="Cost (LKR)" kind="money" value={cost} onChangeText={setCost} placeholder="Optional" error={bad(cost) ? "Invalid" : null} />
          <Field label="Selling (LKR)" kind="money" value={selling} onChangeText={setSelling} placeholder="Live board rate" error={bad(selling) ? "Invalid" : null} />
        </FieldRow>
        <SelectField label="Subcategory" value={subcategoryId} options={opts(subcats.data?.rows)} onChange={setSubcategoryId} allowClear placeholder="None" />
        <SelectField label="Design" value={designId} options={opts(designs.data?.rows)} onChange={setDesignId} allowClear placeholder="None" />
        <SelectField label="Product type" value={productTypeId} options={opts(ptypes.data?.rows)} onChange={setProductTypeId} allowClear placeholder="None" />
        <SelectField label="Stone type" value={stoneTypeId} options={opts(stones.data?.rows)} onChange={setStoneTypeId} allowClear placeholder="None" />
        <Field label="Location / showcase / tray" value={location} onChangeText={setLocation} placeholder="e.g. Showcase A, Tray 3" />
        <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Internal notes or comments" multiline />
      </FormStack>
    </Sheet>
  );
}

function ReserveSheet({ id, onClose }: { id: string; onClose: (saved: boolean) => void }) {
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [note, setNote] = useState("");
  const [untilDate, setUntilDate] = useState("");
  const reserve = useMutation({
    mutationFn: () => api(`/api/v1/products/${id}/reserve`, { method: "POST", body: JSON.stringify({ customerId: customer!.id, note: note.trim(), untilDate: untilDate || undefined }) }),
    onSuccess: () => {
      toast.success(`Held for ${customer?.name ?? "customer"}`);
      onClose(true);
    },
    onError: (e) => toast.error(e, "Reserve failed"),
  });
  return (
    <Sheet visible onClose={() => onClose(false)} title="Reserve for a customer" submitLabel="Reserve" onSubmit={() => reserve.mutate()} submitting={reserve.isPending} canSubmit={!!customer && !!note.trim()}>
      <FormStack>
        <Text variant="footnote" tone="secondary">
          Only this customer can buy the piece at the POS until the hold is released.
        </Text>
        <CustomerField value={customer} onChange={setCustomer} />
        <Field label="Note (required)" value={note} onChangeText={setNote} placeholder="e.g. Resizing to 7, collecting Friday" maxLength={500} />
        <DateField label="Hold until (optional)" value={untilDate} onChange={setUntilDate} minimumDate={new Date()} allowClear />
      </FormStack>
    </Sheet>
  );
}
