import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, type Href } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ago, count, lkr, lkr0 } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { useBranch, useSession } from "@/lib/session";
import { Callout, Chips, Field, FieldRow, FormStack, Grid, HeaderButton, Row, ScreenList, SearchField, SelectField, Sheet, StatTile, StatusPill, Text, toast, usePagedQuery } from "@/ui";
import { bankOptions, ItemEditor, itemValid, newItem, num, useBankAccounts, useSuppliers, type ItemDraft } from "./shared";

type Invoice = { id: string; number: string; supplier_name: string; total_cents: number; paid_cents: number; status: string; created_at: number };
const STATUSES = ["UNPAID", "PARTIAL", "PAID", "VOID"];
const FILTERS = [
  { key: "", label: "All" },
  { key: "UNPAID", label: "Unpaid" },
  { key: "PARTIAL", label: "Part-paid" },
  { key: "PAID", label: "Paid" },
  { key: "VOID", label: "Void" },
];

export default function PurchaseInvoicesScreen() {
  const params = useLocalSearchParams<{ status?: string; new?: string }>();
  const { can } = useSession();
  const canCreate = can("purchases:create");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(params.status && STATUSES.includes(params.status) ? params.status : "");
  const [creating, setCreating] = useState(params.new === "1");
  const q = useDebounced(search, 300);
  useEffect(() => {
    if (params.status && STATUSES.includes(params.status)) setStatus(params.status);
  }, [params.status]);

  const list = usePagedQuery<Invoice>(["invoices", q, status], (page) => `/api/v1/purchases/invoices?search=${encodeURIComponent(q)}&page=${page}&limit=20${status ? `&status=${status}` : ""}`, { limit: 20 });
  const outstanding = list.rows.reduce((n, r) => n + (r.status === "VOID" ? 0 : Math.max(0, r.total_cents - r.paid_cents)), 0);

  return (
    <>
      <Stack.Screen options={{ title: "Purchase invoices", headerRight: () => (canCreate ? <HeaderButton icon="plus" onPress={() => setCreating(true)} accessibilityLabel="New invoice" /> : null) }} />
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
        keyExtractor={(r) => r.id}
        header={
          <View style={{ gap: 12, paddingTop: 8 }}>
            <Text variant="footnote" tone="secondary" style={{ marginHorizontal: 20 }}>
              Stock, ledger and journal post atomically. Unpaid and partial balances become supplier payables.
            </Text>
            <Grid>
              <StatTile label="Invoices" value={list.data ? count(list.total) : "-"} icon="creditCard" />
              <StatTile label="Outstanding (loaded)" value={list.data ? lkr0(outstanding) : "-"} unit="LKR" icon="wallet" tone={outstanding ? "warning" : "default"} />
            </Grid>
            <Chips items={FILTERS} value={status} onChange={setStatus} />
            <SearchField value={search} onChangeText={setSearch} placeholder="Search by number…" />
          </View>
        }
        empty={{ icon: "creditCard", title: "No invoices", message: "Post the first purchase invoice.", action: canCreate ? { label: "New invoice", icon: "plus", onPress: () => setCreating(true) } : undefined }}
        renderItem={(r) => {
          const due = Math.max(0, r.total_cents - r.paid_cents);
          return (
            <Row
              href={`/purchases/invoices/${r.id}` as Href}
              title={
                <Text variant="body" mono weight="600">
                  {r.number}
                </Text>
              }
              subtitle={`${r.supplier_name}${due > 0 && r.status !== "VOID" ? ` · ${lkr(due)} due` : ""} · ${ago(r.created_at)}`}
              right={
                <View style={{ alignItems: "flex-end", gap: 3 }}>
                  <Text variant="subhead" num weight="600">
                    {lkr(r.total_cents)}
                  </Text>
                  <StatusPill status={r.status} size="sm" />
                </View>
              }
            />
          );
        }}
      />
      {creating ? <NewInvoiceSheet onClose={() => setCreating(false)} /> : null}
    </>
  );
}

function NewInvoiceSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { branchId } = useBranch();
  const suppliers = useSuppliers();
  const banks = useBankAccounts();
  const [supplierId, setSupplierId] = useState("");
  const [charges, setCharges] = useState("");
  const [paid, setPaid] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [items, setItems] = useState<ItemDraft[]>(() => [newItem()]);
  const paying = paid.trim() !== "" && num(paid) > 0;
  const valid = !!supplierId && items.length > 0 && items.every((it) => itemValid(it, true)) && (!paying || !!bankAccountId);
  const create = useMutation({
    mutationFn: () =>
      api("/api/v1/purchases/invoices", {
        method: "POST",
        body: JSON.stringify({
          supplierId,
          branchId,
          chargesLkr: charges.trim() === "" ? 0 : num(charges),
          paidLkr: paid.trim() === "" ? 0 : num(paid),
          paidBankAccountId: paid.trim() === "" ? undefined : bankAccountId,
          items: items.map((it) => ({ categoryId: it.categoryId, metalTypeId: it.metalTypeId, purityId: it.purityId, name: it.name, grossG: num(it.grossG), costLkr: num(it.costLkr) })),
        }),
      }),
    onSuccess: () => {
      toast.success("Invoice created");
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      void qc.invalidateQueries({ queryKey: ["pur-dash"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      onClose();
    },
    onError: (e) => toast.error(e, "Create failed"),
  });
  return (
    <Sheet visible onClose={onClose} title="New invoice" submitLabel="Post" onSubmit={() => create.mutate()} submitting={create.isPending} canSubmit={valid}>
      <FormStack>
        <Text variant="footnote" tone="secondary">
          Direct intake: every item becomes a product in stock as soon as the invoice is posted.
        </Text>
        {!branchId ? (
          <Callout tone="warning" title="No branch selected" style={{ marginHorizontal: 0 }}>
            Choose a working branch in More before posting a bill.
          </Callout>
        ) : null}
        <SelectField label="Supplier" value={supplierId} options={(suppliers.data?.rows ?? []).map((s) => ({ value: s.id, label: s.name, subtitle: s.code }))} onChange={setSupplierId} placeholder={suppliers.isLoading ? "Loading…" : "Select…"} />
        <ItemEditor items={items} onChange={setItems} />
        <FieldRow>
          <Field label="Charges (LKR)" kind="money" value={charges} onChangeText={setCharges} placeholder="0.00" />
          <Field label="Paid (LKR)" kind="money" value={paid} onChangeText={setPaid} placeholder="0.00" />
        </FieldRow>
        {paying ? <SelectField label="Pay from" value={bankAccountId} options={bankOptions(banks.data)} onChange={setBankAccountId} placeholder="Choose an account…" /> : null}
      </FormStack>
    </Sheet>
  );
}
