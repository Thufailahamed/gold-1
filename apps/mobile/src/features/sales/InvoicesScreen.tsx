import { useState } from "react";
import { View } from "react-native";
import { router, Stack, useLocalSearchParams, type Href } from "expo-router";
import { dateTime } from "@/lib/format";
import { useTheme } from "@/theme";
import { chooseAction, Chips, Row, ScreenList, SearchField, StatusPill, Text, usePagedQuery } from "@/ui";

type Invoice = {
  id: string;
  number: string;
  customer_name: string | null;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  status: string;
  created_at: number;
};

const STATUSES = ["PAID", "PARTIAL", "UNPAID", "VOID"] as const;
const fmt = (c: number) => (c / 100).toLocaleString("en-US");

export default function InvoicesScreen() {
  const { c } = useTheme();
  const params = useLocalSearchParams<{ status?: string }>();
  const [search, setSearch] = useState("");
  // The sales dashboard links here with ?status= to open a settlement state.
  const [fStatus, setFStatus] = useState<string>(params.status && (STATUSES as readonly string[]).includes(params.status) ? params.status : "");

  const list = usePagedQuery<Invoice>(["sales", search, fStatus], (page) =>
    `/api/v1/sales/invoices?search=${encodeURIComponent(search)}&page=${page}&limit=20${fStatus ? `&status=${fStatus}` : ""}`
  );
  const value = list.rows.reduce((n, r) => n + (r.status === "VOID" ? 0 : r.total_cents), 0);
  const due = list.rows.reduce((n, r) => n + (r.status === "VOID" ? 0 : Math.max(0, r.balance_cents ?? 0)), 0);

  return (
    <>
      <Stack.Screen options={{ title: "Invoices" }} />
      <ScreenList
        query={list}
        keyExtractor={(r) => r.id}
        separatorIndent={16}
        header={
          <View style={{ gap: 12, paddingTop: 8 }}>
            <SearchField value={search} onChangeText={setSearch} placeholder="Search by number…" />
            <Chips
              items={[{ key: "", label: "All" }, ...STATUSES.map((s) => ({ key: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))]}
              value={fStatus}
              onChange={setFStatus}
            />
            <View style={{ flexDirection: "row", marginHorizontal: 16, gap: 18 }}>
              <Stat label="On file" value={String(list.total)} />
              <Stat label="Loaded value" value={`${fmt(value)} LKR`} />
              <Stat label="Due" value={`${fmt(due)} LKR`} tone={due > 0 ? c.redText : undefined} />
            </View>
          </View>
        }
        empty={{ icon: "receipt", title: "No invoices", message: "Counter sales appear here once posted." }}
        renderItem={(r) => {
          const owes = r.balance_cents > 0 && r.status !== "VOID";
          return (
            <Row
              href={`/sales/invoices/${r.id}` as Href}
              onLongPress={async () => {
                const i = await chooseAction(r.number, ["Open", "Print"]);
                if (i === 0) router.push(`/sales/invoices/${r.id}`);
                if (i === 1) router.push(`/sales/invoices/${r.id}/print`);
              }}
              title={
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text variant="body" mono weight="600" numberOfLines={1}>
                    {r.number}
                  </Text>
                  <StatusPill status={r.status} size="sm" />
                </View>
              }
              subtitle={`${r.customer_name ?? "Walk-in"} · ${dateTime(r.created_at)}`}
              right={
                <View style={{ alignItems: "flex-end" }}>
                  <Text variant="body" num weight="600">
                    {fmt(r.total_cents)}
                  </Text>
                  {owes ? (
                    <Text variant="caption1" num color={c.redText}>
                      {fmt(r.balance_cents)} due
                    </Text>
                  ) : null}
                </View>
              }
            />
          );
        }}
      />
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text variant="caption2" tone="secondary" upper weight="600">
        {label}
      </Text>
      <Text variant="subhead" num weight="600" color={tone} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}
