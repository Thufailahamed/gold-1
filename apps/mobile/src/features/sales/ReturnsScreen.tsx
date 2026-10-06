import { useState } from "react";
import { View } from "react-native";
import { router, Stack, type Href } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { normalizeCode } from "@goldos/shared";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { GUTTER, useTheme } from "@/theme";
import { Button, Card, CardHeader, Field, IconButton, Pill, Row, scanBarcode, ScreenList, SearchField, StatusPill, Text, toast } from "@/ui";

type Ret = {
  id: string;
  number: string;
  invoice_id: string;
  invoice_number: string;
  type: string;
  reason: string;
  refund_cents: number;
  credit_cents: number;
  exchange_sale_id: string | null;
  status: string;
  created_at: number;
};

const fmt = (c: number) => (c / 100).toLocaleString("en-US");

export default function ReturnsScreen() {
  const { c } = useTheme();
  const { can } = useSession();
  const canCancel = can("sales:cancel");
  const [search, setSearch] = useState("");
  const [scan, setScan] = useState("");

  const list = useQuery({
    queryKey: ["returns", search],
    queryFn: () => api<{ rows: Ret[]; total: number }>(`/api/v1/sales/returns?limit=30${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  });

  // The customer hands back a piece or a bill: either finds the sale.
  const find = useMutation({
    mutationFn: (code: string) => api<{ invoiceId: string; number: string }>(`/api/v1/sales/lookup/${encodeURIComponent(code)}`),
    onSuccess: (d) => router.push(`/sales/invoices/${d.invoiceId}`),
    onError: (e) => toast.error(e, "No sale found"),
  });
  function lookup(raw: string) {
    const code = normalizeCode(raw);
    setScan("");
    if (code) find.mutate(code);
  }

  const rows = list.data?.rows ?? [];
  const refunds = rows.reduce((n, r) => n + r.refund_cents + (r.credit_cents ?? 0), 0);

  return (
    <>
      <Stack.Screen options={{ title: "Returns" }} />
      <ScreenList
        data={rows}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        refreshing={list.isRefetching}
        onRefresh={() => void list.refetch()}
        keyExtractor={(r) => r.id}
        header={
          <View style={{ gap: 14, paddingTop: 8 }}>
            <Card>
              <CardHeader icon="scan" title="Start a return" subtitle="Product tag, SKU or SINV- invoice number" />
              <Text variant="footnote" tone="secondary" style={{ marginBottom: 12 }}>
                {`Scan the returned piece or the bill to open its sale${canCancel ? ", then record the return there." : " — view only."}`}
              </Text>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Field
                    value={scan}
                    onChangeText={setScan}
                    placeholder="Scan tag or bill"
                    kind="code"
                    autoCapitalize="characters"
                    returnKeyType="search"
                    onSubmitEditing={() => lookup(scan)}
                  />
                </View>
                <IconButton
                  name="scan"
                  variant="tinted"
                  size={48}
                  accessibilityLabel="Scan with camera"
                  onPress={async () => {
                    const code = await scanBarcode({ title: "Scan piece or bill" });
                    if (code) lookup(code);
                  }}
                />
              </View>
              <Button title={find.isPending ? "Finding…" : "Find sale"} loading={find.isPending} disabled={!scan.trim()} onPress={() => lookup(scan)} block style={{ marginTop: 12 }} />
            </Card>
            <SearchField value={search} onChangeText={setSearch} placeholder="Filter by return or invoice number…" />
            <View style={{ flexDirection: "row", marginHorizontal: GUTTER, gap: 18 }}>
              <Stat label="Returns" value={String(list.data?.total ?? rows.length)} />
              <Stat label="Loaded" value={String(rows.length)} />
              <Stat label="Refunded" value={`${fmt(refunds)} LKR`} />
            </View>
            <Text variant="footnote" tone="secondary" style={{ marginHorizontal: GUTTER }}>
              Refunds post to the customer ledger and reverse the gold movement.
            </Text>
          </View>
        }
        empty={{ icon: "return", title: "No returns recorded", message: "Returns recorded against invoices appear here." }}
        renderItem={(r) => (
          <Row
            href={`/sales/invoices/${r.invoice_id}` as Href}
            title={
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Text variant="body" mono weight="600">
                  {r.number}
                </Text>
                <Pill size="sm">{r.type}</Pill>
                <StatusPill status={r.status} size="sm" />
              </View>
            }
            subtitle={
              <View style={{ gap: 2 }}>
                <Text variant="footnote" tone="secondary" numberOfLines={2}>
                  {`Invoice ${r.invoice_number} · ${r.reason}`}
                </Text>
                {r.type === "EXCHANGE" && !r.exchange_sale_id ? (
                  <Text variant="caption1" color={c.orangeText}>
                    No replacement yet
                  </Text>
                ) : null}
                <Text variant="caption1" tone="tertiary">
                  {dateTime(r.created_at)}
                </Text>
              </View>
            }
            right={
              <View style={{ alignItems: "flex-end" }}>
                <Text variant="body" num weight="600">
                  {fmt(r.refund_cents + (r.credit_cents ?? 0))}
                </Text>
                {r.credit_cents ? (
                  <Text variant="caption1" tone="secondary">
                    credit
                  </Text>
                ) : null}
              </View>
            }
          />
        )}
      />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text variant="caption2" tone="secondary" upper weight="600">
        {label}
      </Text>
      <Text variant="subhead" num weight="600" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}
