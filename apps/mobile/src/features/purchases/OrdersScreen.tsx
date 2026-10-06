import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ago, count } from "@/lib/format";
import { useBranch, useSession } from "@/lib/session";
import { useDebounced } from "@/lib/hooks";
import { Callout, chooseAction, Chips, Field, FormStack, Grid, HeaderButton, promptText, Row, ScreenList, SearchField, SelectField, Sheet, StatTile, StatusPill, Text, toast, usePagedQuery } from "@/ui";
import { bankOptions, ItemEditor, itemValid, newItem, num, useBankAccounts, useSuppliers, type ItemDraft } from "./shared";

type Order = { id: string; number: string; supplier_name: string; status: string; items: number; created_at: number };
const ORDER_STATUSES = ["DRAFT", "SENT", "RECEIVED", "CANCELLED"];
const FILTERS = [{ key: "", label: "All" }, ...ORDER_STATUSES.map((s) => ({ key: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))];

export default function OrdersScreen() {
  const params = useLocalSearchParams<{ status?: string; new?: string }>();
  const qc = useQueryClient();
  const { can } = useSession();
  const canCreate = can("purchases:create");
  const canCancel = can("purchases:cancel");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(params.status && ORDER_STATUSES.includes(params.status) ? params.status : "");
  const [creating, setCreating] = useState(params.new === "1");
  const [receiveId, setReceiveId] = useState<string | null>(null);
  const q = useDebounced(search, 300);

  useEffect(() => {
    if (params.status && ORDER_STATUSES.includes(params.status)) setStatus(params.status);
  }, [params.status]);

  const list = usePagedQuery<Order>(["orders", q, status], (page) => `/api/v1/purchases/orders?search=${encodeURIComponent(q)}&page=${page}&limit=20${status ? `&status=${status}` : ""}`, { limit: 20 });
  const open = list.rows.filter((r) => r.status === "DRAFT" || r.status === "SENT").length;

  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api(`/api/v1/purchases/orders/${id}/cancel`, { method: "PATCH", body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      toast.success("Order cancelled");
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["pur-dash"] });
    },
    onError: (e) => toast.error(e, "Cancel failed"),
  });

  async function onOrder(o: Order) {
    const isOpen = o.status === "DRAFT" || o.status === "SENT";
    const actions: { label: string; run: () => void | Promise<void> }[] = [];
    if (isOpen && canCreate) actions.push({ label: "Receive into stock", run: () => setReceiveId(o.id) });
    if (isOpen && canCancel)
      actions.push({
        label: "Cancel order",
        run: async () => {
          const reason = await promptText({ title: "Cancel order", message: `Reason to cancel ${o.number}`, required: true, destructive: true, submitLabel: "Cancel order" });
          if (reason) cancel.mutate({ id: o.id, reason });
        },
      });
    if (actions.length === 0) return;
    const i = await chooseAction(o.number, actions.map((a) => a.label), { destructiveIndex: actions.findIndex((a) => a.label === "Cancel order"), message: `${o.supplier_name} · ${o.items} item${o.items === 1 ? "" : "s"}` });
    if (i !== null) await actions[i]?.run();
  }

  return (
    <>
      <Stack.Screen options={{ title: "Purchase orders", headerRight: () => (canCreate ? <HeaderButton icon="plus" onPress={() => setCreating(true)} accessibilityLabel="New order" /> : null) }} />
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
              Receiving a draft creates products, stock movements and journal entries in one step.
            </Text>
            <Grid>
              <StatTile label="Orders" value={list.data ? count(list.total) : "-"} icon="document" />
              <StatTile label="Open (loaded)" value={list.data ? count(open) : "-"} icon="hourglass" tone={open ? "warning" : "default"} />
            </Grid>
            <Chips items={FILTERS} value={status} onChange={setStatus} />
            <SearchField value={search} onChangeText={setSearch} placeholder="Search by number…" />
          </View>
        }
        empty={{ icon: "document", title: "No orders", message: "Create the first purchase order.", action: canCreate ? { label: "New order", icon: "plus", onPress: () => setCreating(true) } : undefined }}
        renderItem={(o) => {
          const isOpen = o.status === "DRAFT" || o.status === "SENT";
          return (
            <Row
              onPress={isOpen && (canCreate || canCancel) ? () => void onOrder(o) : undefined}
              chevron={isOpen && (canCreate || canCancel)}
              title={
                <Text variant="body" mono weight="600">
                  {o.number}
                </Text>
              }
              subtitle={`${o.supplier_name} · ${o.items} item${o.items === 1 ? "" : "s"} · ${ago(o.created_at)}`}
              right={<StatusPill status={o.status} size="sm" />}
            />
          );
        }}
      />
      {creating ? <NewOrderSheet onClose={() => setCreating(false)} /> : null}
      {receiveId ? <ReceiveSheet id={receiveId} onClose={() => setReceiveId(null)} /> : null}
    </>
  );
}

function NewOrderSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { branchId } = useBranch();
  const suppliers = useSuppliers();
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemDraft[]>(() => [newItem()]);
  const valid = !!supplierId && items.length > 0 && items.every((it) => itemValid(it, false));
  const create = useMutation({
    mutationFn: () =>
      api("/api/v1/purchases/orders", {
        method: "POST",
        body: JSON.stringify({
          supplierId,
          branchId,
          notes: notes.trim() || undefined,
          items: items.map((it) => ({ categoryId: it.categoryId, metalTypeId: it.metalTypeId || undefined, purityId: it.purityId, name: it.name.trim() || undefined, grossG: num(it.grossG), estCostLkr: num(it.costLkr) })),
        }),
      }),
    onSuccess: () => {
      toast.success("Order created");
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["pur-dash"] });
      onClose();
    },
    onError: (e) => toast.error(e, "Create failed"),
  });
  return (
    <Sheet visible onClose={onClose} title="New purchase order" submitLabel="Save draft" onSubmit={() => create.mutate()} submitting={create.isPending} canSubmit={valid}>
      <FormStack>
        {!branchId ? (
          <Callout tone="warning" title="No branch selected" style={{ marginHorizontal: 0 }}>
            Choose a working branch in More before raising an order.
          </Callout>
        ) : null}
        <SelectField label="Supplier" value={supplierId} options={(suppliers.data?.rows ?? []).map((s) => ({ value: s.id, label: s.name, subtitle: s.code }))} onChange={setSupplierId} placeholder={suppliers.isLoading ? "Loading…" : "Select…"} />
        <Field label="Notes" value={notes} onChangeText={setNotes} />
        <ItemEditor items={items} onChange={setItems} costLabel="Est. cost (LKR)" />
      </FormStack>
    </Sheet>
  );
}

function ReceiveSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const banks = useBankAccounts();
  const [charges, setCharges] = useState("");
  const [paid, setPaid] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const paying = paid.trim() !== "" && num(paid) > 0;
  const valid = (!charges.trim() || Number.isFinite(num(charges))) && (!paid.trim() || (Number.isFinite(num(paid)) && (!paying || !!bankAccountId)));
  const receive = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      if (charges.trim() !== "") body.chargesLkr = num(charges);
      if (paid.trim() !== "") {
        body.paidLkr = num(paid);
        body.paidBankAccountId = bankAccountId;
      }
      return api<{ number: string }>(`/api/v1/purchases/orders/${id}/receive`, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: (res) => {
      toast.success(`Received as ${res.number}`);
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      void qc.invalidateQueries({ queryKey: ["pur-dash"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      onClose();
    },
    onError: (e) => toast.error(e, "Receive failed"),
  });
  return (
    <Sheet visible onClose={onClose} title="Receive order" submitLabel="Receive" onSubmit={() => receive.mutate()} submitting={receive.isPending} canSubmit={valid}>
      <FormStack>
        <Text variant="footnote" tone="secondary">
          Creates products, stock, ledger and journal entries atomically.
        </Text>
        <Field label="Additional charges (LKR)" kind="money" value={charges} onChangeText={setCharges} placeholder="0.00" />
        <Field label="Paid now (LKR)" kind="money" value={paid} onChangeText={setPaid} placeholder="0.00" />
        {paying ? <SelectField label="Pay from" value={bankAccountId} options={bankOptions(banks.data)} onChange={setBankAccountId} placeholder="Choose an account…" /> : null}
      </FormStack>
    </Sheet>
  );
}
