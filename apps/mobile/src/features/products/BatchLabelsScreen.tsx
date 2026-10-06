import { useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { SvgXml } from "react-native-svg";
import { useQueries } from "@tanstack/react-query";
import { apiText } from "@/lib/api";
import { printHtml, sharePdf } from "@/lib/print";
import { radius } from "@/theme";
import { BottomBar, Button, Callout, EmptyState, IconButton, Loading, Screen, Section, Text, toast } from "@/ui";
import { labelSheetHtml } from "./ProductPrintScreen";

const MAX_COPIES = 10;

/**
 * Batch label printing: /products/labels?ids=a,b,c. Used after a purchase
 * receive or a manufacturing finish, where a whole lot needs tagging at once.
 */
export default function BatchLabelsScreen() {
  const sp = useLocalSearchParams<{ ids?: string }>();
  const ids = Array.from(new Set((sp.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean))).slice(0, 200);
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState<"print" | "pdf" | null>(null);
  const labels = useQueries({
    queries: ids.map((id) => ({ queryKey: ["product-label", id], queryFn: () => apiText(`/api/v1/products/${encodeURIComponent(id)}/label`), retry: false })),
  });
  const loaded = labels.map((q) => q.data).filter((d): d is string => !!d);
  const failed = labels.filter((q) => q.isError).length;
  const loading = labels.some((q) => q.isLoading);
  const total = loaded.length * copies;

  async function run(kind: "print" | "pdf") {
    setBusy(kind);
    try {
      const html = labelSheetHtml(loaded.flatMap((svg) => Array.from({ length: copies }, () => svg)), "Barcode labels");
      if (kind === "print") await printHtml(html);
      else await sharePdf(html, "labels");
    } catch (e) {
      toast.error(e, "Could not print");
    } finally {
      setBusy(null);
    }
  }
  const set = (n: number) => setCopies(Math.max(1, Math.min(MAX_COPIES, n)));

  return (
    <>
      <Stack.Screen options={{ title: "Print labels", headerLargeTitleEnabled: false }} />
      <Screen
        footer={
          ids.length > 0 ? (
            <BottomBar>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Button title="Share PDF" icon="share" variant="gray" style={{ flex: 1 }} disabled={loading || loaded.length === 0} loading={busy === "pdf"} onPress={() => void run("pdf")} />
                <Button title={`Print ${total}`} icon="print" style={{ flex: 1 }} disabled={loading || loaded.length === 0} loading={busy === "print"} onPress={() => void run("print")} />
              </View>
            </BottomBar>
          ) : undefined
        }
      >
        {ids.length === 0 ? (
          <EmptyState icon="barcode" title="No pieces selected" message="Open this page from a purchase invoice or manufacturing order to print its labels." />
        ) : (
          <>
            <Text variant="subhead" tone="secondary" style={{ marginHorizontal: 20, marginTop: 8 }}>
              {`${ids.length} piece${ids.length === 1 ? "" : "s"} · ${ids.length * copies} label${ids.length * copies === 1 ? "" : "s"}`}
            </Text>
            <Section title="Copies per piece" footer={`1–${MAX_COPIES} labels each.`}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12 }}>
                <IconButton name="minus" onPress={() => set(copies - 1)} disabled={copies <= 1} accessibilityLabel="Fewer copies" />
                <Text variant="title1" num rounded>
                  {copies}
                </Text>
                <IconButton name="plus" onPress={() => set(copies + 1)} disabled={copies >= MAX_COPIES} accessibilityLabel="More copies" />
              </View>
            </Section>
            {failed > 0 ? (
              <Callout tone="danger" title={`${failed} label${failed === 1 ? "" : "s"} failed to load`} style={{ marginTop: 14 }}>
                Check that the pieces still exist and that you are signed in, then try again.
              </Callout>
            ) : null}
            <Section title="Preview">
              <View style={{ padding: 12, gap: 12, backgroundColor: "#fff", borderRadius: radius.md , borderCurve: "continuous"}}>
                {loading ? <Loading /> : null}
                {loaded.map((svg, i) => (
                  <SvgXml key={i} xml={svg} width="100%" height={110} />
                ))}
              </View>
            </Section>
          </>
        )}
      </Screen>
    </>
  );
}
