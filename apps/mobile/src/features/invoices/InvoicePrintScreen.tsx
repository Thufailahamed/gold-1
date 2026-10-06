import { useEffect, useRef, useState } from "react";
import { Linking, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SvgXml } from "react-native-svg";
import { api, apiText } from "@/lib/api";
import { amountInWords } from "@/lib/barcode";
import { printHtml, sharePdf } from "@/lib/print";
import { GUTTER, radius, useTheme } from "@/theme";
import { Button, ErrorState, KeyValue, Loading, Screen, Section, Segmented, Text, toast } from "@/ui";
import { a4Html, DEFAULT_PROFILE, derive, fmt2, grams3, methodLabel, receiptHtml, STATUS_LABEL, waNumber, type PrintDetail, type Profile } from "./invoiceHtml";

/**
 * Printable sale. ?format=receipt picks the 80mm slip (default A4 bill);
 * ?auto=1 opens the print dialog as soon as the bill is ready (from the POS).
 * The preview is native; Print / PDF render the same HTML the web prints.
 */
export default function InvoicePrintScreen() {
  const { c } = useTheme();
  const params = useLocalSearchParams<{ id: string; format?: string; auto?: string }>();
  const id = params.id;
  const [format, setFormat] = useState<"a4" | "receipt">(params.format === "receipt" ? "receipt" : "a4");
  const [busy, setBusy] = useState(false);
  const autoRef = useRef(params.auto === "1");

  const detail = useQuery({ queryKey: ["sale-print", id], queryFn: () => api<PrintDetail>(`/api/v1/sales/invoices/${id}`), enabled: !!id });
  const profile = useQuery({ queryKey: ["invoice-profile"], queryFn: () => api<Profile>("/api/v1/sales/invoice-profile"), staleTime: 5 * 60_000, retry: false });
  // The print renderer has no session, so the codes are fetched and inlined.
  const qr = useQuery({ queryKey: ["sale-qr", id], queryFn: () => apiText(`/api/v1/sales/invoices/${id}/qr`), enabled: !!id, staleTime: Infinity, retry: false });
  const bar = useQuery({ queryKey: ["sale-barcode", id], queryFn: () => apiText(`/api/v1/sales/invoices/${id}/barcode`), enabled: !!id, staleTime: Infinity, retry: false });

  const ready = !!detail.data && !profile.isLoading && !qr.isLoading && !bar.isLoading;
  const shop = profile.data ?? DEFAULT_PROFILE;

  const html = () => {
    const d = detail.data!;
    return format === "receipt" ? receiptHtml(d, shop, qr.data ?? null) : a4Html(d, shop, qr.data ?? null, bar.data ?? null);
  };

  async function doPrint() {
    setBusy(true);
    try {
      await printHtml(html(), format === "receipt" ? { width: 227 } : undefined);
    } catch (e) {
      toast.error(e, "Print failed");
    } finally {
      setBusy(false);
    }
  }
  async function doPdf() {
    setBusy(true);
    try {
      await sharePdf(html(), `${detail.data!.invoice.number}${format === "receipt" ? "-receipt" : ""}`, format === "receipt" ? { width: 227 } : { width: 595, height: 842 });
    } catch (e) {
      toast.error(e, "PDF failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoRef.current || !ready) return;
    autoRef.current = false;
    const t = setTimeout(() => void doPrint(), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (detail.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Print", headerLargeTitleEnabled: false }} />
        <Loading />
      </Screen>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Print", headerLargeTitleEnabled: false }} />
        <ErrorState error={detail.error} title="Invoice not found" onRetry={() => void detail.refetch()} />
      </Screen>
    );
  }

  const d = detail.data;
  const { invoice, items, payments } = d;
  const { cashPaid, change, balance, totals, receipts, taxed } = derive(d);
  const shareText = `${shop.shopName} — Invoice ${invoice.number}\nTotal: LKR ${fmt2(invoice.total_cents)}${balance > 0 ? `\nBalance due: LKR ${fmt2(balance)}` : "\nPaid in full"}\nThank you!`;

  return (
    <Screen>
      <Stack.Screen options={{ title: invoice.number, headerLargeTitleEnabled: false }} />
      <Segmented
        style={{ marginTop: 8 }}
        options={[
          { key: "a4", label: "A4 invoice" },
          { key: "receipt", label: "Receipt 80mm" },
        ]}
        value={format}
        onChange={setFormat}
      />

      {/* Paper preview — always light, like the printed bill */}
      <View style={{ marginHorizontal: GUTTER, marginTop: 16, backgroundColor: "#FFFFFF", borderRadius: radius.lg, borderCurve: "continuous", padding: 18, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 4 }}>
        <View style={{ height: 4, borderRadius: 2, borderCurve: "continuous", backgroundColor: "#C9A227", marginBottom: 14 }} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text variant="title2" color="#111">
              {shop.shopName}
            </Text>
            {shop.header ? (
              <Text variant="footnote" color="#8C6D1F" style={{ fontStyle: "italic" }}>
                {shop.header}
              </Text>
            ) : null}
            {shop.address ? (
              <Text variant="caption1" color="#666">
                {shop.address}
              </Text>
            ) : null}
            {shop.phone ? (
              <Text variant="caption1" color="#666">
                Tel {shop.phone}
              </Text>
            ) : null}
            {taxed && shop.taxRegNo ? (
              <Text variant="caption1" color="#666">
                {shop.taxLabel} Reg. No. {shop.taxRegNo}
              </Text>
            ) : null}
          </View>
          {qr.data ? <SvgXml xml={qr.data} width={72} height={72} /> : null}
        </View>
        <View style={{ marginTop: 12 }}>
          <Text variant="caption2" color="#8C6D1F" weight="700" upper style={{ letterSpacing: 2 }}>
            {taxed ? "Tax invoice" : "Invoice"}
          </Text>
          <Text variant="headline" mono color="#111">
            {invoice.number}
          </Text>
          <Text variant="caption1" color="#666">
            {new Date(invoice.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} · {STATUS_LABEL[invoice.status] ?? invoice.status}
          </Text>
        </View>
        <View style={{ marginTop: 12, padding: 10, backgroundColor: "#FAFAF9", borderRadius: 8 , borderCurve: "continuous"}}>
          <Text variant="caption2" color="#888" weight="700" upper>
            Bill to
          </Text>
          <Text variant="subhead" weight="600" color="#111">
            {invoice.customer_name ?? "Walk-in customer"}
          </Text>
          {[invoice.customer_code, invoice.customer_phone, invoice.customer_nic ? `NIC ${invoice.customer_nic}` : null].filter(Boolean).length ? (
            <Text variant="caption1" color="#666">
              {[invoice.customer_code, invoice.customer_phone, invoice.customer_nic ? `NIC ${invoice.customer_nic}` : null].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
          <Text variant="caption1" color="#666">
            {invoice.branch_name ?? "—"}
            {invoice.branch_code ? ` (${invoice.branch_code})` : ""} · {invoice.salesperson_name ?? "—"}
            {invoice.cashier_name && invoice.cashier_name !== invoice.salesperson_name ? ` · cashier ${invoice.cashier_name}` : ""}
          </Text>
        </View>
        <View style={{ marginTop: 12, borderTopWidth: 1.5, borderTopColor: "#111" }}>
          {items.map((it, i) => (
            <View key={i} style={{ paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: "#ddd", flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text variant="subhead" weight="600" color="#111">
                  {i + 1}. {it.name}
                </Text>
                <Text variant="caption2" mono color="#777">
                  {it.barcode} · {it.karat} · gross {grams3(it.gross_mg)} · net {grams3(it.net_mg)}
                  {it.stone_mg > 0 ? ` · stone ${grams3(it.stone_mg)}` : ""} · making {fmt2(it.making_cents)}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text variant="subhead" num weight="600" color="#111">
                  {fmt2(it.price_cents)}
                </Text>
                {it.discount_cents ? (
                  <Text variant="caption2" num color="#777">
                    −{fmt2(it.discount_cents)}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
          <Text variant="caption1" color="#666" style={{ marginTop: 6 }} num>
            Totals · gross {grams3(totals.gross)} g · net {grams3(totals.net)} g · making {fmt2(totals.making)}
          </Text>
        </View>
        <View style={{ marginTop: 12, gap: 3 }}>
          <PRow l="Subtotal" r={fmt2(invoice.subtotal_cents)} />
          {invoice.discount_cents ? <PRow l="Discount" r={`− ${fmt2(invoice.discount_cents)}`} /> : null}
          {taxed ? <PRow l="Taxable value" r={fmt2(invoice.subtotal_cents - invoice.discount_cents)} /> : null}
          {taxed ? <PRow l={`${shop.taxLabel} @ ${((invoice.tax_rate_bp ?? 0) / 100).toFixed(2).replace(/\.00$/, "")}%`} r={fmt2(invoice.tax_cents ?? 0)} /> : null}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", backgroundColor: "#111", borderRadius: 10, borderCurve: "continuous", paddingHorizontal: 12, paddingVertical: 9, marginTop: 6 }}>
            <Text variant="caption2" color="#E7C65A" weight="700" style={{ letterSpacing: 2 }}>
              TOTAL LKR
            </Text>
            <Text variant="title3" color="#FFF" num weight="800">
              {fmt2(invoice.total_cents)}
            </Text>
          </View>
          {payments.map((p, i) => (
            <PRow key={i} l={methodLabel(p)} r={fmt2(p.amount_cents)} />
          ))}
          {invoice.tendered_cents != null && cashPaid > 0 ? <PRow l="Cash tendered" r={fmt2(invoice.tendered_cents)} /> : null}
          {invoice.tendered_cents != null && cashPaid > 0 ? <PRow l="Change given" r={fmt2(change)} /> : null}
          {(invoice.store_credit_cents ?? 0) > 0 ? <PRow l="Settled from store credit" r={fmt2(invoice.store_credit_cents!)} /> : null}
          {receipts.map((r) => (
            <PRow key={r.number} l={`Received ${r.receipt_date} · ${r.number}`} r={fmt2(r.amount_cents)} />
          ))}
          <PRow l="Amount paid" r={fmt2(invoice.paid_cents)} />
          <PRow l={balance > 0 ? "Balance due" : "Balance"} r={fmt2(balance)} color={balance > 0 ? "#9f1239" : "#166534"} bold />
        </View>
        <Text variant="caption1" color="#444" style={{ marginTop: 10 }}>
          {amountInWords(invoice.total_cents)}
        </Text>
        {invoice.notes ? (
          <Text variant="caption1" color="#444" style={{ marginTop: 6 }}>
            Note: {invoice.notes}
          </Text>
        ) : null}
        {(d.returns ?? []).length ? (
          <Text variant="caption1" color="#78350f" style={{ marginTop: 6 }}>
            Returns against this bill: {(d.returns ?? []).map((r) => `${r.number} (${r.type.toLowerCase()})`).join(", ")}
          </Text>
        ) : null}
        <Text variant="caption1" color="#666" center style={{ marginTop: 12 }}>
          {shop.footer || "Thank you for shopping with us."}
        </Text>
        {format === "a4" && bar.data ? (
          <View style={{ alignItems: "center", marginTop: 8 }}>
            <SvgXml xml={bar.data} width={220} height={48} />
          </View>
        ) : null}
      </View>

      <View style={{ marginHorizontal: GUTTER, marginTop: 18, gap: 10 }}>
        <Button title="Print" icon="print" size="lg" block loading={busy} disabled={!ready} onPress={doPrint} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button title="Share PDF" icon="share" variant="gray" block disabled={!ready || busy} onPress={doPdf} />
          </View>
          {invoice.customer_phone ? (
            <View style={{ flex: 1 }}>
              <Button
                title="WhatsApp"
                icon="message"
                variant="gray"
                block
                onPress={() =>
                  void Linking.openURL(`https://wa.me/${waNumber(invoice.customer_phone!)}?text=${encodeURIComponent(shareText)}`).catch(() => toast.error("Could not open WhatsApp"))
                }
              />
            </View>
          ) : null}
        </View>
      </View>
      <Section>
        <KeyValue label="Status" value={STATUS_LABEL[invoice.status] ?? invoice.status} />
        <KeyValue label="Pieces" value={`${items.length} · ${grams3(totals.net)} g net`} />
      </Section>
      <View style={{ height: 8, backgroundColor: c.bg }} />
    </Screen>
  );
}

function PRow({ l, r, bold, color }: { l: string; r: string; bold?: boolean; color?: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
      <Text variant="footnote" color={color ?? "#555"} weight={bold ? "700" : "400"} style={{ flex: 1 }}>
        {l}
      </Text>
      <Text variant="footnote" color={color ?? "#111"} num weight={bold ? "700" : "500"}>
        {r}
      </Text>
    </View>
  );
}
