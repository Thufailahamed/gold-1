import { useState } from "react";
import { Pressable, View } from "react-native";
import { router, Stack } from "expo-router";
import { Image } from "expo-image";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, appendFile, formApi, type UploadFile } from "@/lib/api";
import { useBranch } from "@/lib/session";
import { pickFile } from "@/lib/pick";
import { GUTTER, radius, useTheme } from "@/theme";
import { BottomBar, Button, Field, FieldRow, FormStack, Hero, Icon, Screen, SectionHeading, SelectField, Text, toast } from "@/ui";
import { ProductMedia } from "./ProductMedia";

type Opt = { id: string; name?: string; karat?: string; permille?: number };
const MAX_IMAGES = 10;

function useOpts(path: string) {
  return useQuery({ queryKey: ["master-all", path], queryFn: () => api<{ rows: Opt[] }>(`/api/v1/masters/${path}?limit=100`), staleTime: 60_000 });
}
const named = (rows: Opt[] | undefined) => (rows ?? []).map((r) => ({ value: r.id, label: r.name ?? r.id }));
const num = (s: string) => Number(s.replace(/,/g, ""));
const fix3 = (n: number | null) => (n !== null && Number.isFinite(n) ? n.toFixed(3) : "—");

export default function NewProductScreen() {
  const { c } = useTheme();
  const qc = useQueryClient();
  const b = useBranch();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [designId, setDesignId] = useState("");
  const [productTypeId, setProductTypeId] = useState("");
  const [metalTypeId, setMetalTypeId] = useState("");
  const [purityId, setPurityId] = useState("");
  const [stoneTypeId, setStoneTypeId] = useState("");
  const [gross, setGross] = useState("");
  const [stone, setStone] = useState("");
  const [wastage, setWastage] = useState("");
  const [making, setMaking] = useState("");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [branchId, setBranchId] = useState(b.branchId ?? "");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [images, setImages] = useState<UploadFile[]>([]);
  const [tried, setTried] = useState(false);

  const cats = useOpts("categories");
  const subcats = useOpts("subcategories");
  const designs = useOpts("designs");
  const ptypes = useOpts("product-types");
  const metals = useOpts("metal-types");
  const stones = useOpts("stone-types");
  const purs = useOpts("purities");

  const effectiveBranch = branchId || b.branches[0]?.id || "";
  const purity = purs.data?.rows.find((p) => p.id === purityId);
  const grossN = num(gross);
  const stoneN = stone.trim() ? num(stone) : 0;
  const net = Number.isFinite(grossN) && grossN > 0 ? grossN - (Number.isFinite(stoneN) ? stoneN : 0) : null;
  const fine = net !== null && purity?.permille ? (net * purity.permille) / 1000 : null;
  const priceN = num(price);

  const badNum = (s: string) => s.trim() !== "" && (!Number.isFinite(num(s)) || num(s) < 0);
  const errors = {
    name: !name.trim() ? "Required" : name.trim().length > 100 ? "Max 100 characters" : null,
    categoryId: !categoryId ? "Required" : null,
    metalTypeId: !metalTypeId ? "Required" : null,
    purityId: !purityId ? "Required" : null,
    gross: !(Number.isFinite(grossN) && grossN > 0) ? "Must be > 0" : null,
    stone: badNum(stone) ? "Invalid" : net !== null && net <= 0 ? "Exceeds gross" : null,
    wastage: badNum(wastage) ? "Invalid" : null,
    making: badNum(making) ? "Invalid" : null,
    cost: badNum(cost) ? "Invalid" : null,
    price: badNum(price) ? "Invalid" : null,
    branchId: !effectiveBranch ? "Required" : null,
  };
  const valid = Object.values(errors).every((e) => !e);
  const err = (k: keyof typeof errors) => (tried ? errors[k] : null);

  const steps = [
    !!(name.trim() && categoryId),
    !!(metalTypeId && purityId),
    Number.isFinite(grossN) && grossN > 0,
    !!effectiveBranch,
  ];

  const create = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        categoryId,
        branchId: effectiveBranch,
        metalTypeId,
        purityId,
        grossG: grossN,
        stoneG: stone.trim() ? num(stone) : 0,
        makingLkr: making.trim() ? num(making) : 0,
        wastageG: wastage.trim() ? num(wastage) : 0,
      };
      if (subcategoryId) payload.subcategoryId = subcategoryId;
      if (designId) payload.designId = designId;
      if (productTypeId) payload.productTypeId = productTypeId;
      if (stoneTypeId) payload.stoneTypeId = stoneTypeId;
      if (cost.trim()) payload.costLkr = num(cost);
      if (price.trim()) payload.sellingPriceLkr = num(price);
      if (location.trim()) payload.location = location.trim();
      if (notes.trim()) payload.notes = notes.trim();
      const created = await api<{ id: string }>("/api/v1/products", { method: "POST", body: JSON.stringify(payload) });
      let failed = 0;
      for (const f of images.slice(0, MAX_IMAGES)) {
        try {
          const form = new FormData();
          appendFile(form, "file", f);
          await formApi(`/api/v1/products/${created.id}/images`, form);
        } catch {
          failed++;
        }
      }
      return { ...created, failed };
    },
    onSuccess: (created) => {
      toast.success("Product created");
      if (created.failed) toast.warning(`${created.failed} image${created.failed === 1 ? "" : "s"} failed to upload — add them from the product page`);
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["products-count"] });
      router.replace(`/products/${created.id}`);
    },
    onError: (e) => toast.error(e, "Create failed"),
  });

  async function addImage() {
    try {
      const f = await pickFile({ title: "Add photo" });
      if (f) setImages((xs) => [...xs, f].slice(0, MAX_IMAGES));
    } catch (e) {
      toast.error(e, "Could not add photo");
    }
  }

  function submit() {
    setTried(true);
    if (!valid) {
      toast.warning("Fill in the required fields");
      return;
    }
    create.mutate();
  }

  const catName = cats.data?.rows.find((x) => x.id === categoryId)?.name;
  const metalName = metals.data?.rows.find((x) => x.id === metalTypeId)?.name;

  return (
    <>
      <Stack.Screen options={{ title: "New product", headerLargeTitleEnabled: false }} />
      <Screen
        footer={
          <BottomBar>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text variant="caption1" tone="secondary" num numberOfLines={1}>
                  {`Net ${fix3(net)} g · Fine ${fix3(fine)} g`}
                </Text>
              </View>
              <Button title="Save product" icon="check" loading={create.isPending} onPress={submit} />
            </View>
          </BottomBar>
        }
      >
        {/* Live preview of the catalog card */}
        <Hero kicker="Catalog · New piece" title={name.trim() || "Untitled piece"} subtitle={`${catName ?? "Category"}${metalName ? ` · ${metalName}` : ""}`} style={{ marginTop: 8 }} stats={[
          { label: "Net", value: `${fix3(net)} g` },
          { label: "Fine", value: `${fix3(fine)} g` },
          { label: "Price", value: price.trim() && Number.isFinite(priceN) && priceN > 0 ? `LKR ${priceN.toLocaleString("en-US")}` : "Live rate" },
          { label: "Sections", value: `${steps.filter(Boolean).length}/4` },
        ]}>
          <View style={{ marginTop: 10, height: 140, borderRadius: radius.lg, borderCurve: "continuous", overflow: "hidden" }}>
            {images[0] ? <Image source={{ uri: images[0].uri }} style={{ width: "100%", height: "100%" }} contentFit="cover" /> : <ProductMedia id="new" karat={purity?.karat} gemSize={64} style={{ width: "100%", height: "100%" }} />}
          </View>
          <Text variant="caption1" tone="onVault3" style={{ marginTop: 6 }}>
            Barcode and SKU are minted automatically on save.
          </Text>
        </Hero>

        <SectionHeading index="1" title="Identity" subtitle="Name & classification" />
        <FormStack style={{ marginHorizontal: GUTTER }}>
          <Field label="Name *" value={name} onChangeText={setName} placeholder="e.g. Kandyan bridal necklace" maxLength={100} error={err("name")} />
          <SelectField label="Category *" value={categoryId} options={named(cats.data?.rows)} onChange={setCategoryId} error={err("categoryId")} placeholder={cats.isLoading ? "Loading…" : "Select…"} />
          <SelectField label="Subcategory" value={subcategoryId} options={named(subcats.data?.rows)} onChange={setSubcategoryId} allowClear placeholder="None" />
          <SelectField label="Design" value={designId} options={named(designs.data?.rows)} onChange={setDesignId} allowClear placeholder="None" />
          <SelectField label="Product type" value={productTypeId} options={named(ptypes.data?.rows)} onChange={setProductTypeId} allowClear placeholder="None" />
        </FormStack>

        <SectionHeading index="2" title="Material" subtitle="Metal, purity & stone" />
        <FormStack style={{ marginHorizontal: GUTTER }}>
          <SelectField label="Metal *" value={metalTypeId} options={named(metals.data?.rows)} onChange={setMetalTypeId} error={err("metalTypeId")} />
          <SelectField
            label="Purity *"
            value={purityId}
            options={(purs.data?.rows ?? []).map((p) => ({ value: p.id, label: p.karat ?? p.id, subtitle: p.permille ? `${p.permille}‰` : undefined }))}
            onChange={setPurityId}
            error={err("purityId")}
          />
          <SelectField label="Stone" value={stoneTypeId} options={named(stones.data?.rows)} onChange={setStoneTypeId} allowClear placeholder="None" />
        </FormStack>

        <SectionHeading index="3" title="Weights & pricing" subtitle="Grams and rupees" />
        <FormStack style={{ marginHorizontal: GUTTER }}>
          <FieldRow>
            <Field label="Gross *" kind="weight" suffix="g" value={gross} onChangeText={setGross} placeholder="0.000" error={err("gross")} />
            <Field label="Stone" kind="weight" suffix="g" value={stone} onChangeText={setStone} placeholder="0.000" error={err("stone") ?? (badNum(stone) ? "Invalid" : null)} />
          </FieldRow>
          <FieldRow>
            <Field label="Wastage" kind="weight" suffix="g" value={wastage} onChangeText={setWastage} placeholder="0.000" error={badNum(wastage) ? "Invalid" : null} />
            <Field label="Making" kind="money" suffix="LKR" value={making} onChangeText={setMaking} placeholder="0.00" error={badNum(making) ? "Invalid" : null} />
          </FieldRow>
          <FieldRow>
            <Field label="Cost" kind="money" suffix="LKR" value={cost} onChangeText={setCost} placeholder="Optional" error={badNum(cost) ? "Invalid" : null} />
            <Field label="Price" kind="money" suffix="LKR" value={price} onChangeText={setPrice} placeholder="Live rate" error={badNum(price) ? "Invalid" : null} />
          </FieldRow>
          <View style={{ flexDirection: "row", gap: 10, backgroundColor: c.vault, borderRadius: radius.lg, borderCurve: "continuous", padding: 12 }}>
            {[
              { l: "Net weight", v: net },
              { l: "Fine gold", v: fine },
            ].map((m) => (
              <View key={m.l} style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: radius.md, borderCurve: "continuous", padding: 10 }}>
                <Text variant="caption2" tone="onVault3" upper weight="600">
                  {m.l}
                </Text>
                <Text variant="title3" num color={c.goldLight}>
                  {fix3(m.v)} g
                </Text>
              </View>
            ))}
          </View>
        </FormStack>

        <SectionHeading index="4" title="Location & media" subtitle="Branch, tray & photos" />
        <FormStack style={{ marginHorizontal: GUTTER }}>
          <SelectField label="Branch *" value={effectiveBranch} options={b.branches.map((x) => ({ value: x.id, label: x.name }))} onChange={setBranchId} error={err("branchId")} placeholder={b.isLoading ? "Loading…" : "Select…"} />
          <Field label="Location" value={location} onChangeText={setLocation} placeholder="Tray, showcase…" maxLength={100} />
          <Field label="Notes" value={notes} onChangeText={setNotes} multiline maxLength={2000} />
          <View style={{ gap: 8 }}>
            <Text variant="footnote" tone="secondary" weight="500" style={{ paddingHorizontal: 4 }}>
              {`Images (${images.length}/${MAX_IMAGES})`}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {images.map((f, i) => (
                <View key={`${f.uri}-${i}`} style={{ width: 76, height: 76, borderRadius: radius.md, borderCurve: "continuous", overflow: "hidden" }}>
                  <Image source={{ uri: f.uri }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
                  {i === 0 ? (
                    <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)", paddingVertical: 2 }}>
                      <Text variant="caption2" center color={c.goldLight} weight="700" upper>
                        Cover
                      </Text>
                    </View>
                  ) : null}
                  <Pressable
                    accessibilityLabel="Remove image"
                    hitSlop={8}
                    onPress={() => setImages((xs) => xs.filter((_, j) => j !== i))}
                    style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, borderCurve: "continuous", backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" }}
                  >
                    <Icon name="close" size={11} color="#fff" weight="bold" />
                  </Pressable>
                </View>
              ))}
              {images.length < MAX_IMAGES ? (
                <Pressable
                  onPress={() => void addImage()}
                  style={({ pressed }) => ({ width: 76, height: 76, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1.5, borderStyle: "dashed", borderColor: c.separator, alignItems: "center", justifyContent: "center", backgroundColor: c.card, opacity: pressed ? 0.6 : 1 })}
                >
                  <Icon name="camera" size={20} color={c.gold} />
                  <Text variant="caption2" tone="secondary" style={{ marginTop: 3 }}>
                    Add
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <Text variant="caption1" tone="tertiary" style={{ paddingHorizontal: 4 }}>
              JPG · PNG · WebP — up to 5 MB each. The first photo is the cover.
            </Text>
          </View>
        </FormStack>
      </Screen>
    </>
  );
}
