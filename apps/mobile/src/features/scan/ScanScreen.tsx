import { useEffect, useState } from "react";
import { View } from "react-native";
import { router, Stack, type Href } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import * as SecureStore from "expo-secure-store";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { lookupPath, normalizeCode, extractScanCode } from "@/lib/barcode";
import { g, money } from "@/lib/format";
import { GUTTER, radius, useTheme } from "@/theme";
import { Button, CameraScanner, Card, Chips, Field, Icon, KeyValue, Screen, Section, Skeleton, StatusPill, Text, Callout } from "@/ui";

type Lookup = {
  product: {
    id: string;
    barcode: string;
    sku: string;
    name: string;
    karat: string;
    status: string;
    net_mg: number;
    selling_price_cents: number | null;
  };
  livePrice: { amount_cents: number } | null;
  noRate: boolean;
};

const RECENT_KEY = "goldos.recentScans";

export default function ScanScreen() {
  const { c } = useTheme();
  const focused = useIsFocused();
  const [code, setCode] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    SecureStore.getItemAsync(RECENT_KEY)
      .then((raw) => setRecent(raw ? (JSON.parse(raw) as string[]) : []))
      .catch(() => setRecent([]));
  }, []);

  const lookup = useQuery({
    queryKey: ["scan", code],
    queryFn: () => api<Lookup>(`/api/v1/products/barcode/${encodeURIComponent(code ?? "")}`),
    enabled: code !== null,
    retry: false,
  });

  function onScan(raw: string) {
    const c0 = normalizeCode(extractScanCode(raw));
    if (!c0) return;
    // Old-gold items live in the vault and invoice numbers in sales.
    if (c0.startsWith("OG-") || c0.startsWith("SINV-")) {
      const path = lookupPath(c0);
      if (path) router.push(path as Href);
      return;
    }
    setCode(c0);
    setRecent((r) => {
      const next = [c0, ...r.filter((x) => x !== c0)].slice(0, 10);
      SecureStore.setItemAsync(RECENT_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }

  const p = lookup.data?.product;
  const price = p ? (p.selling_price_cents ?? lookup.data?.livePrice?.amount_cents ?? null) : null;

  return (
    <Screen>
      <Stack.Screen options={{ title: "Scan" }} />
      <View style={{ marginHorizontal: GUTTER, marginTop: 8, height: 260, borderRadius: radius.xxl - 6, borderCurve: "continuous", overflow: "hidden", backgroundColor: "#000" }}>
        <CameraScanner embedded active={focused} onScanned={onScan} title="" hint="Tags, SKUs, OG- numbers and invoice QR codes" continuous />
      </View>

      <View style={{ marginHorizontal: GUTTER, marginTop: 16, flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
        <View style={{ flex: 1 }}>
          <Field
            value={typed}
            onChangeText={setTyped}
            placeholder="Type barcode, SKU or invoice no…"
            kind="code"
            icon="barcode"
            autoCapitalize="characters"
            returnKeyType="search"
            onSubmitEditing={() => {
              if (typed.trim()) {
                onScan(typed);
                setTyped("");
              }
            }}
          />
        </View>
        <Button
          title="Look up"
          disabled={!typed.trim()}
          onPress={() => {
            onScan(typed);
            setTyped("");
          }}
          style={{ height: 48 }}
        />
      </View>

      {lookup.isLoading ? (
        <Card style={{ marginTop: 18, gap: 10 }}>
          <Skeleton width="60%" height={18} />
          <Skeleton width="40%" />
          <Skeleton width="80%" />
        </Card>
      ) : null}

      {lookup.isError ? (
        <Callout tone="danger" title="Not found" style={{ marginTop: 18 }}>
          {`No product found for ${code ?? ""}.`}
        </Callout>
      ) : null}

      {p ? (
        <>
          <Card style={{ marginTop: 18 }} onPress={() => router.push(`/products/${p.id}`)}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ width: 44, height: 44, borderRadius: 12, borderCurve: "continuous", backgroundColor: c.goldSoft, alignItems: "center", justifyContent: "center" }}>
                <Icon name="gem" size={20} color={c.goldInk} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="headline" numberOfLines={2}>
                  {p.name}
                </Text>
                <Text variant="footnote" tone="secondary" mono numberOfLines={1}>
                  {p.barcode} · {p.sku} · {p.karat}
                </Text>
              </View>
              <Icon name="chevronRight" size={13} color={c.label3} weight="bold" />
            </View>
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 16 }}>
              <View>
                <Text variant="caption1" tone="secondary">
                  {p.selling_price_cents !== null ? "Selling price" : "Live price"}
                </Text>
                {price !== null ? (
                  <Text variant="title1" num rounded>
                    {money(price)}
                  </Text>
                ) : (
                  <Text variant="subhead" tone="secondary">
                    No rate for {p.karat}
                  </Text>
                )}
              </View>
              <StatusPill status={p.status} />
            </View>
          </Card>
          <Section>
            <KeyValue label="Net weight" value={g(p.net_mg)} />
            <KeyValue label="Karat" value={p.karat} />
          </Section>
          <View style={{ marginHorizontal: GUTTER, marginTop: 16, gap: 10 }}>
            {p.status === "IN_STOCK" ? (
              <Button title="Sell at POS" icon="cart" size="lg" block onPress={() => router.push(`/pos?add=${encodeURIComponent(p.barcode)}`)} />
            ) : null}
            {p.status === "SOLD" || p.status === "RETURNED" ? (
              <Button title="Find sale" icon="receipt" variant="tinted" size="lg" block onPress={() => router.push(`/sales/invoices/lookup/${encodeURIComponent(p.barcode)}`)} />
            ) : null}
            <Button title="Open detail" variant="gray" size="lg" block onPress={() => router.push(`/products/${p.id}`)} />
          </View>
        </>
      ) : null}

      {recent.length > 0 ? (
        <View style={{ marginTop: 26, gap: 8 }}>
          <Text variant="footnote" tone="secondary" upper style={{ marginHorizontal: GUTTER + 16, letterSpacing: 0.2 }}>
            Recent scans
          </Text>
          <Chips items={recent.map((r) => ({ key: r, label: r }))} value={code ?? ""} onChange={onScan} />
        </View>
      ) : null}
    </Screen>
  );
}
