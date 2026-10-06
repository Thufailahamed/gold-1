import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, type Href } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { downloadCsv, api, errorMessage } from "@/lib/api";
import { count, dateTime, gramsShort } from "@/lib/format";
import { useBranch, useSession } from "@/lib/session";
import { GUTTER, useTheme } from "@/theme";
import { BranchSelect, Callout, Card, CardHeader, Chips, Grid, HeaderButton, Loading, Pill, Row, Screen, Section, StatTile, Text, toast, useRefresh } from "@/ui";

type Summary = {
  missing: number;
  unexpected: number;
  duplicates: number;
  unreceived: number;
  gold: { branchId: string; passed: boolean; differenceMg: number }[];
  transfers: { transferId: string; number: string; warnings: string[] }[];
  hasData: boolean;
};
type MissingRow = { countId: string; productId: string; barcode: string; productName: string; daysOpen: number; status: "OPEN" | "COMPLETE"; posted: boolean };
type ScanRow = { countId: string; barcode: string; scannedAt: number; scannedBy: string };
type UnreceivedRow = { transferId: string; number: string; barcode: string; productId: string; fromBranch: string; toBranch: string; fromBranchName: string; toBranchName: string; ageDays: number };
type TabKey = "missing" | "unexpected" | "duplicates" | "unreceived";
type TabData = {
  rows: (MissingRow | ScanRow | UnreceivedRow)[];
  hasData: boolean;
  note?: string;
  thresholdDays?: number;
};

const TAB_LABEL: Record<TabKey, string> = { missing: "Missing", unexpected: "Unexpected", duplicates: "Duplicates", unreceived: "Unreceived" };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "branch";

export default function DiscrepanciesScreen() {
  const { c } = useTheme();
  const { can } = useSession();
  const canExport = can("audit:export");
  const b = useBranch();
  const [branchId, setBranchId] = useState("");
  const [tab, setTab] = useState<TabKey>("missing");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (branchId || b.branches.length === 0) return;
    setBranchId(b.branches.find((x) => x.id === b.branchId)?.id ?? b.branches[0]?.id ?? "");
  }, [branchId, b.branches, b.branchId]);
  const branchName = b.allBranches.find((x) => x.id === branchId)?.name ?? "";

  const summary = useQuery({ queryKey: ["discrepancies", "summary", branchId], queryFn: () => api<Summary>(`/api/v1/discrepancies/summary?branchId=${encodeURIComponent(branchId)}`), enabled: !!branchId, retry: false });
  const detail = useQuery({ queryKey: ["discrepancies", tab, branchId], queryFn: () => api<TabData>(`/api/v1/discrepancies/${tab}?branchId=${encodeURIComponent(branchId)}`), enabled: !!branchId, retry: false });
  const refresh = useRefresh(summary, detail);

  async function exportCsv() {
    setDownloading(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      await downloadCsv(`/api/v1/discrepancies/${tab}?branchId=${encodeURIComponent(branchId)}&format=csv`, `${tab}-${slug(branchName || branchId)}-${date}.csv`);
    } catch (e) {
      toast.error(e, "Export failed");
    } finally {
      setDownloading(false);
    }
  }

  const s = summary.data;
  const gold = s?.gold.find((x) => x.branchId === branchId) ?? s?.gold[0];
  const loading = summary.isLoading || !branchId;
  const desc: Record<TabKey, string> = {
    missing: "Pieces a stock count expected but could not find.",
    unexpected: "Scans of pieces that were not expected on that shelf.",
    duplicates: "The same piece scanned more than once in a count. Scan hygiene, not stock movement.",
    unreceived: detail.data?.thresholdDays != null ? `Transfer lines in transit ≥ ${detail.data.thresholdDays} days.` : "Transfer lines that have been in transit too long.",
  };

  return (
    <Screen {...refresh}>
      <Stack.Screen
        options={{
          title: "Discrepancies",
          headerRight: () => (canExport ? <HeaderButton icon="download" disabled={downloading || !branchId} onPress={() => void exportCsv()} accessibilityLabel="Download CSV" /> : null),
        }}
      />
      <Text variant="footnote" tone="secondary" style={{ marginHorizontal: 20, marginTop: 8 }}>
        Live reads of stock counts, scans, transfers and the gold ledger for one branch. Every figure is computed when you open the page.
      </Text>
      <View style={{ marginHorizontal: GUTTER, marginTop: 12 }}>
        <BranchSelect value={branchId} onChange={setBranchId} />
      </View>
      {b.branches.length === 0 && !b.isLoading ? (
        <Callout tone="info" title="No branches available" style={{ marginTop: 14 }}>
          You are not a member of any branch, so there is nothing to check.
        </Callout>
      ) : null}

      {summary.isError ? (
        <Callout tone="danger" title="Could not load the summary" style={{ marginTop: 14 }}>
          {errorMessage(summary.error)}
        </Callout>
      ) : (
        <Grid style={{ marginTop: 14 }}>
          <StatTile label="Missing pieces" value={s ? count(s.missing) : "-"} icon="search" tone={s && s.missing > 0 ? "warning" : "default"} sub="Not found by a stock count" loading={loading} />
          <StatTile label="Unexpected scans" value={s ? count(s.unexpected) : "-"} icon="scan" tone={s && s.unexpected > 0 ? "warning" : "default"} sub="Scanned where not expected" loading={loading} />
          <StatTile label="Duplicate scans" value={s ? count(s.duplicates) : "-"} icon="clipboardCheck" sub="Same piece scanned twice" loading={loading} />
          <StatTile label="Unreceived" value={s ? count(s.unreceived) : "-"} icon="truck" tone={s && s.unreceived > 0 ? "warning" : "default"} sub="Lines stuck in transit" loading={loading} />
          <StatTile
            label="Gold consistency"
            value={!gold ? "-" : gold.passed ? "Passed" : `Off ${gramsShort(Math.abs(gold.differenceMg))} g`}
            icon="scale"
            tone={!gold ? "default" : gold.passed ? "success" : "danger"}
            sub="Ledger vs held stock, exact mg"
            loading={loading}
          />
        </Grid>
      )}

      {s && !s.hasData ? (
        <Callout tone="success" title="No open discrepancies for this branch" style={{ marginTop: 14 }}>
          Nothing was found by these checks right now. That covers counts, scans, transfers in transit and the gold ledger only; it is not a full audit of the branch.
        </Callout>
      ) : null}

      {s && s.transfers.length > 0 ? (
        <Card style={{ marginTop: 18 }}>
          <CardHeader title="Transfer warnings" subtitle="Open transfers whose reconciliation raised warnings." icon="warning" />
          {s.transfers.map((t) => (
            <View key={t.transferId} style={{ paddingVertical: 6 }}>
              <Row title={<Text variant="body" mono weight="600">{t.number}</Text>} subtitle={t.warnings.map((w) => `• ${w}`).join("\n")} numberOfLines={0} href={`/inventory/transfers/${t.transferId}` as Href} />
            </View>
          ))}
        </Card>
      ) : null}

      <Chips
        style={{ marginTop: 22 }}
        items={(["missing", "unexpected", "duplicates", "unreceived"] as TabKey[]).map((k) => ({ key: k, label: TAB_LABEL[k], count: s ? s[k] : undefined }))}
        value={tab}
        onChange={setTab}
      />
      <Section footer={[desc[tab], detail.data?.note].filter(Boolean).join(" ")}>
        {detail.isLoading || !branchId ? <Loading /> : null}
        {detail.isError ? <Row title={`Could not load ${TAB_LABEL[tab].toLowerCase()} rows`} subtitle={errorMessage(detail.error)} icon="alert" iconColor={c.red} /> : null}
        {detail.data && detail.data.rows.length === 0 ? <Row icon="checkCircle" iconColor={c.green} title={`No ${TAB_LABEL[tab].toLowerCase()} rows`} subtitle="This check found nothing for the selected branch." /> : null}
        {detail.data?.rows.map((r, i) => {
          if (tab === "missing") {
            const m = r as MissingRow;
            return (
              <Row
                key={`${m.countId}:${m.productId}`}
                title={m.productName || "Unnamed piece"}
                subtitle={`${m.barcode} · count ${m.countId.slice(0, 8)} · ${count(m.daysOpen)} days open`}
                href={`/products/${m.productId}` as Href}
                right={
                  m.status === "OPEN" ? (
                    <Pill size="sm" tone="warning" dot>
                      Count open
                    </Pill>
                  ) : m.posted ? (
                    <Pill size="sm" tone="danger" dot>
                      Written off
                    </Pill>
                  ) : (
                    <Pill size="sm" dot>
                      Not posted
                    </Pill>
                  )
                }
              />
            );
          }
          if (tab === "unreceived") {
            const u = r as UnreceivedRow;
            return (
              <Row
                key={`${u.transferId}:${u.productId}`}
                title={<Text variant="body" mono weight="600">{`${u.number} · ${u.barcode}`}</Text>}
                subtitle={`${u.fromBranchName || u.fromBranch.slice(0, 8)} → ${u.toBranchName || u.toBranch.slice(0, 8)}`}
                value={`${count(u.ageDays)} ${u.ageDays === 1 ? "day" : "days"}`}
                valueTone="warning"
                href={`/inventory/transfers/${u.transferId}` as Href}
              />
            );
          }
          const sc = r as ScanRow;
          return (
            <Row
              key={`${sc.countId}:${sc.barcode}:${sc.scannedAt}:${i}`}
              title={<Text variant="body" mono>{sc.barcode}</Text>}
              subtitle={`${dateTime(sc.scannedAt)} · ${sc.scannedBy} · count ${sc.countId.slice(0, 8)}`}
              href={`/inventory/counts/${sc.countId}` as Href}
            />
          );
        })}
      </Section>
    </Screen>
  );
}
