import { useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { SvgXml } from "react-native-svg";
import { useQuery } from "@tanstack/react-query";
import { apiText } from "@/lib/api";
import { printDoc, printHtml, sharePdf } from "@/lib/print";
import { GUTTER, radius } from "@/theme";
import { BottomBar, Button, ErrorState, IconButton, Loading, Screen, Section, Text, toast } from "@/ui";

const MAX = 50;

/** Repeats the server-rendered SVG label `copies` times in a printable sheet. */
export function labelSheetHtml(svgs: string[], title = "Labels") {
  const body = `<div class="labels">${svgs.map((s) => `<div class="label">${s}</div>`).join("")}</div>`;
  return printDoc(title, body, `body{margin:12px}.labels{display:flex;flex-wrap:wrap;gap:12px}.label{width:280px;break-inside:avoid;page-break-inside:avoid}.label svg{width:100%;height:auto}`);
}

export default function ProductPrintScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState<"print" | "pdf" | null>(null);
  const label = useQuery({ queryKey: ["product-label", id], queryFn: () => apiText(`/api/v1/products/${id}/label`), enabled: !!id });

  async function run(kind: "print" | "pdf") {
    if (!label.data) return;
    setBusy(kind);
    try {
      const html = labelSheetHtml(Array.from({ length: copies }, () => label.data!), "Barcode labels");
      if (kind === "print") await printHtml(html);
      else await sharePdf(html, `labels-${id}`);
    } catch (e) {
      toast.error(e, "Could not print");
    } finally {
      setBusy(null);
    }
  }

  const set = (n: number) => setCopies(Math.max(1, Math.min(MAX, n)));

  return (
    <>
      <Stack.Screen options={{ title: "Print labels", headerLargeTitleEnabled: false }} />
      <Screen
        footer={
          <BottomBar>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button title="Share PDF" icon="share" variant="gray" style={{ flex: 1 }} disabled={!label.data} loading={busy === "pdf"} onPress={() => void run("pdf")} />
              <Button title={`Print ${copies}`} icon="print" style={{ flex: 1 }} disabled={!label.data} loading={busy === "print"} onPress={() => void run("print")} />
            </View>
          </BottomBar>
        }
      >
        <Section title="Copies" footer={`1–${MAX} labels per run.`}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12 }}>
            <IconButton name="minus" onPress={() => set(copies - 1)} disabled={copies <= 1} accessibilityLabel="Fewer copies" />
            <Text variant="title1" num rounded>
              {copies}
            </Text>
            <IconButton name="plus" onPress={() => set(copies + 1)} disabled={copies >= MAX} accessibilityLabel="More copies" />
          </View>
        </Section>
        <View style={{ flexDirection: "row", gap: 8, marginHorizontal: GUTTER, marginTop: 12 }}>
          {[1, 2, 5, 10, 20].map((n) => (
            <Button key={n} title={String(n)} size="sm" variant={copies === n ? "filled" : "gray"} style={{ flex: 1 }} onPress={() => set(n)} />
          ))}
        </View>
        <Section title="Preview">
          <View style={{ padding: 12, backgroundColor: "#fff", borderRadius: radius.md, borderCurve: "continuous", alignItems: "center", minHeight: 100, justifyContent: "center" }}>
            {label.isLoading ? <Loading /> : label.isError ? <ErrorState error={label.error} onRetry={() => void label.refetch()} /> : label.data ? <SvgXml xml={label.data} width="100%" height={130} /> : null}
          </View>
        </Section>
      </Screen>
    </>
  );
}
