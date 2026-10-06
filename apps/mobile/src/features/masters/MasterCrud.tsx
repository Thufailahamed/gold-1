import { useState } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { count, lkr } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { useBranch } from "@/lib/session";
import { useTheme } from "@/theme";
import {
  BranchSelect,
  chooseAction,
  Field,
  FormStack,
  Grid,
  HeaderButton,
  KeyValue,
  Loading,
  Pill,
  promptText,
  Row,
  ScreenList,
  SearchField,
  Section,
  SelectField,
  Sheet,
  StatTile,
  Text,
  toast,
  usePagedQuery,
} from "@/ui";

export type CrudField = {
  name: string;
  label: string;
  type: "text" | "number" | "select" | "branch";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
};
export type CrudColumn = { key: string; label: string };
type Row = Record<string, string | number | null>;

export type MasterCrudProps = {
  title: string;
  subtitle: string;
  endpoint: string;
  columns: CrudColumn[];
  fields: CrudField[];
  deactivateEndpoint?: (id: string) => string;
  deactivateBody?: (reason: string) => Record<string, unknown>;
  emptyHint: string;
  note?: string;
  /** Adds a "Ledger" action that opens the party's account ledger. */
  ledger?: boolean;
};

const fmtCell = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "—" : String(v));

/** Mobile counterpart of the web's MasterCrud: searchable list, create sheet, deactivate. */
export function MasterCrud({ title, subtitle, endpoint, columns, fields, deactivateEndpoint, deactivateBody = (reason) => ({ reason }), emptyHint, note, ledger }: MasterCrudProps) {
  const { c } = useTheme();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const q = useDebounced(search, 300);
  const list = usePagedQuery<Row>([endpoint, q], (page) => `${endpoint}?search=${encodeURIComponent(q)}&page=${page}&limit=20`, { limit: 20 });
  const active = list.rows.filter((r) => r.is_active).length;

  const deactivate = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api(deactivateEndpoint!(id), { method: "PATCH", body: JSON.stringify(deactivateBody(reason)) }),
    onSuccess: () => {
      toast.success("Deactivated");
      void qc.invalidateQueries({ queryKey: [endpoint] });
    },
    onError: (e) => toast.error(e, "Deactivate failed"),
  });

  async function onRow(r: Row) {
    const actions: { label: string; run: () => void | Promise<void> }[] = [];
    if (ledger) actions.push({ label: "View ledger", run: () => setLedgerId(String(r.id)) });
    if (deactivateEndpoint && r.is_active)
      actions.push({
        label: "Deactivate",
        run: async () => {
          const reason = await promptText({ title: "Deactivate", message: "Reason for deactivation", required: true, destructive: true, submitLabel: "Deactivate" });
          if (reason) deactivate.mutate({ id: String(r.id), reason });
        },
      });
    if (actions.length === 0) return;
    const name = fmtCell(r[columns[0]!.key]);
    const i = await chooseAction(name, actions.map((a) => a.label), { destructiveIndex: actions.findIndex((a) => a.label === "Deactivate") });
    if (i !== null) await actions[i]?.run();
  }

  const [first, second, ...rest] = columns;
  return (
    <>
      <Stack.Screen options={{ title, headerRight: () => <HeaderButton icon="plus" onPress={() => setCreating(true)} accessibilityLabel={`New ${title}`} /> }} />
      <ScreenList
        data={list.rows}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRefresh={() => void list.refetch()}
        refreshing={list.isRefetching}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        keyExtractor={(r) => String(r.id)}
        header={
          <View style={{ gap: 12, paddingTop: 8 }}>
            <Text variant="footnote" tone="secondary" style={{ marginHorizontal: 20 }}>
              {`${subtitle}.${note ? ` ${note}.` : ""}`}
            </Text>
            <Grid>
              <StatTile label="Records" value={list.data ? count(list.total) : "—"} icon="list" />
              <StatTile label="Active (loaded)" value={list.data ? count(active) : "—"} icon="checkCircle" tone="success" />
            </Grid>
            <SearchField value={search} onChangeText={setSearch} placeholder="Search…" />
          </View>
        }
        empty={{ icon: "folder", title: `No ${title.toLowerCase()} found`, message: emptyHint, action: { label: "New", icon: "plus", onPress: () => setCreating(true) } }}
        renderItem={(r) => (
          <Row
            onPress={ledger || (deactivateEndpoint && r.is_active) ? () => void onRow(r) : undefined}
            title={
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Text variant="body" weight="600" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {fmtCell(r[first!.key])}
                </Text>
                {!r.is_active ? (
                  <Pill size="sm" tone="neutral">
                    Inactive
                  </Pill>
                ) : null}
              </View>
            }
            subtitle={
              [second ? `${second.label}: ${fmtCell(r[second.key])}` : "", ...rest.map((col) => (r[col.key] === null || r[col.key] === undefined || r[col.key] === "" ? "" : `${col.label}: ${fmtCell(r[col.key])}`))]
                .filter(Boolean)
                .join(" · ") || undefined
            }
            numberOfLines={2}
            chevron={!!ledger}
            right={!ledger && deactivateEndpoint && r.is_active ? <Text variant="caption1" color={c.label3}>Active</Text> : undefined}
          />
        )}
      />
      {creating ? <CreateSheet title={title} endpoint={endpoint} fields={fields} onClose={() => setCreating(false)} /> : null}
      {ledgerId ? <LedgerSheet endpoint={endpoint} id={ledgerId} onClose={() => setLedgerId(null)} /> : null}
    </>
  );
}

function CreateSheet({ title, endpoint, fields, onClose }: { title: string; endpoint: string; fields: CrudField[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { branchId } = useBranch();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.type === "branch" ? (branchId ?? "") : ""])));
  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));
  const invalid = (f: CrudField) => {
    const v = (values[f.name] ?? "").trim();
    if (f.required && !v) return "Required";
    if (f.type === "number" && v && !Number.isFinite(Number(v.replace(/,/g, "")))) return "Enter a number";
    if (v.length > 500) return "Too long";
    return null;
  };
  const valid = fields.every((f) => !invalid(f));
  const create = useMutation({
    mutationFn: () => {
      const body: Record<string, string | number> = {};
      for (const f of fields) {
        const v = (values[f.name] ?? "").trim();
        if (!v) continue;
        body[f.name] = f.type === "number" ? Number(v.replace(/,/g, "")) : v;
      }
      return api(endpoint, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      toast.success(`${title} created`);
      void qc.invalidateQueries({ queryKey: [endpoint] });
      onClose();
    },
    onError: (e) => toast.error(e, "Create failed"),
  });
  const [tried, setTried] = useState(false);
  return (
    <Sheet
      visible
      onClose={onClose}
      title={`New ${title.replace(/s$/, "").replace(/ie$/, "y")}`}
      submitLabel="Save"
      onSubmit={() => {
        setTried(true);
        if (valid) create.mutate();
      }}
      submitting={create.isPending}
    >
      <FormStack>
        {fields.map((f) => {
          const label = `${f.label}${f.required ? " *" : ""}`;
          const err = tried ? invalid(f) : null;
          if (f.type === "branch") return <BranchSelect key={f.name} value={values[f.name] ?? ""} onChange={(v) => set(f.name, v)} label={label} />;
          if (f.type === "select") return <SelectField key={f.name} label={label} value={values[f.name] ?? ""} options={f.options ?? []} onChange={(v) => set(f.name, v)} error={err} />;
          return <Field key={f.name} label={label} kind={f.type === "number" ? "decimal" : "text"} value={values[f.name] ?? ""} onChangeText={(v) => set(f.name, v)} placeholder={f.placeholder} error={err} autoCapitalize={f.name === "code" ? "characters" : "sentences"} />;
        })}
      </FormStack>
    </Sheet>
  );
}

type Ledger = {
  opening: number;
  debitSales: number;
  creditPayments: number;
  creditReturns: number;
  creditPurchases: number;
  debitPayments: number;
  debitReturns: number;
  closing: number;
  lines: { entryId: string; entryNo: string; entryDate: string; refEntity: string; refNo: string | null; memo: string | null; debitCents: number; creditCents: number }[];
};

/** Party account ledger (customers / suppliers). */
export function LedgerSheet({ endpoint, id, onClose }: { endpoint: string; id: string; onClose: () => void }) {
  const detail = useQuery({ queryKey: [endpoint, id], queryFn: () => api<{ code: string; name: string; phone: string | null; nic: string | null; notes: string | null }>(`${endpoint}/${id}`) });
  const ledger = useQuery({ queryKey: [endpoint, id, "ledger"], queryFn: () => api<Ledger>(`${endpoint}/${id}/ledger`) });
  const l = ledger.data;
  return (
    <Sheet visible onClose={onClose} title={detail.data?.name ?? "Ledger"} cancelLabel="Close">
      {detail.data ? (
        <View style={{ paddingHorizontal: 20, gap: 2 }}>
          <Text variant="caption1" mono tone="secondary">
            {detail.data.code}
          </Text>
          <Text variant="subhead" tone="secondary">{`${detail.data.phone ?? "—"} · ${detail.data.nic ?? "no NIC"}`}</Text>
          {detail.data.notes ? <Text variant="footnote">{detail.data.notes}</Text> : null}
        </View>
      ) : null}
      {!l ? (
        <Loading />
      ) : (
        <>
          <Section title="Balances">
            <KeyValue label="Opening" value={`LKR ${lkr(l.opening)}`} />
            <KeyValue label="Sales / Purchases" value={`LKR ${lkr(l.debitSales + l.creditPurchases)}`} />
            <KeyValue label="Payments" value={`LKR ${lkr(l.creditPayments + l.debitPayments)}`} />
            <KeyValue label="Returns" value={`LKR ${lkr(l.creditReturns + l.debitReturns)}`} />
            <KeyValue label="Closing" value={<Text variant="body" weight="700" num>{`LKR ${lkr(l.closing)}`}</Text>} />
          </Section>
          <Section title={`Transactions · ${l.lines.length}`}>
            {l.lines.length === 0 ? <Row title="No transactions yet" subtitle="The ledger starts with the first sale, purchase or payment." /> : null}
            {l.lines.map((ln) => (
              <Row
                key={ln.entryId}
                title={
                  <Text variant="subhead" mono weight="600">
                    {ln.entryNo}
                  </Text>
                }
                subtitle={`${ln.entryDate} · ${ln.refNo ?? ln.refEntity}${ln.memo ? ` · ${ln.memo}` : ""}`}
                value={ln.debitCents ? `DR ${lkr(ln.debitCents)}` : `CR ${lkr(ln.creditCents)}`}
                valueTone={ln.debitCents ? "label" : "success"}
                numberOfLines={2}
              />
            ))}
          </Section>
        </>
      )}
    </Sheet>
  );
}
