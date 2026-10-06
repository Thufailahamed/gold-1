import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { BankAccount } from "@/lib/accounts";
import { radius, useTheme } from "@/theme";
import { Button, Field, FieldRow, IconButton, SelectField, Text } from "@/ui";

export type ItemDraft = { key: number; categoryId: string; metalTypeId: string; purityId: string; name: string; grossG: string; costLkr: string };
export type Supplier = { id: string; name: string; code: string };
type Opt = { id: string; name?: string; karat?: string };

let itemKey = 0;
export const newItem = (): ItemDraft => ({ key: ++itemKey, categoryId: "", metalTypeId: "", purityId: "", name: "", grossG: "", costLkr: "" });
export const num = (s: string) => Number(s.replace(/,/g, ""));
export const itemValid = (it: ItemDraft, needMetal: boolean) =>
  !!it.categoryId && !!it.purityId && (!needMetal || !!it.metalTypeId) && Number.isFinite(num(it.grossG)) && num(it.grossG) > 0 && it.costLkr.trim() !== "" && Number.isFinite(num(it.costLkr)) && num(it.costLkr) >= 0;

export function useSuppliers() {
  return useQuery({ queryKey: ["suppliers-all"], queryFn: () => api<{ rows: Supplier[]; total: number }>("/api/v1/suppliers?limit=100") });
}
export function useBankAccounts() {
  return useQuery({ queryKey: ["bank-accounts"], queryFn: () => api<BankAccount[]>("/api/v1/bank-accounts") });
}
export const bankOptions = (rows: BankAccount[] | undefined) => (rows ?? []).filter((b) => b.is_active).map((b) => ({ value: b.id, label: b.name, subtitle: b.account_code }));

function usePurchaseOptions() {
  const q = (path: string) => ({ queryKey: ["master-all", path], queryFn: () => api<{ rows: Opt[] }>(`/api/v1/masters/${path}?limit=100`), staleTime: 60_000 });
  const cats = useQuery(q("categories"));
  const purs = useQuery(q("purities"));
  const metals = useQuery(q("metal-types"));
  return { cats: cats.data?.rows ?? [], purs: purs.data?.rows ?? [], metals: metals.data?.rows ?? [] };
}

/** Line editor for purchase orders and direct-intake invoices. */
export function ItemEditor({ items, onChange, costLabel = "Cost (LKR)" }: { items: ItemDraft[]; onChange: (items: ItemDraft[]) => void; costLabel?: string }) {
  const { c } = useTheme();
  const { cats, purs, metals } = usePurchaseOptions();
  const set = (key: number, patch: Partial<ItemDraft>) => onChange(items.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  return (
    <View style={{ gap: 12 }}>
      {items.map((it, i) => (
        <View key={it.key} style={{ backgroundColor: c.cardSecondary, borderRadius: radius.lg, borderCurve: "continuous", padding: 12, gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text variant="caption1" weight="700" upper tone="secondary">{`Item ${i + 1}`}</Text>
            <IconButton name="trash" variant="plain" color={c.red} size={30} onPress={() => onChange(items.filter((x) => x.key !== it.key))} accessibilityLabel={`Remove item ${i + 1}`} />
          </View>
          <Field label="Name" value={it.name} onChangeText={(v) => set(it.key, { name: v })} placeholder={`Item ${i + 1} name`} />
          <SelectField label="Category" value={it.categoryId} options={cats.map((x) => ({ value: x.id, label: x.name ?? x.id }))} onChange={(v) => set(it.key, { categoryId: v })} placeholder="Category…" />
          <FieldRow>
            <SelectField label="Metal" value={it.metalTypeId} options={metals.map((x) => ({ value: x.id, label: x.name ?? x.id }))} onChange={(v) => set(it.key, { metalTypeId: v })} placeholder="Metal…" />
            <SelectField label="Purity" value={it.purityId} options={purs.map((x) => ({ value: x.id, label: x.karat ?? x.id }))} onChange={(v) => set(it.key, { purityId: v })} placeholder="Purity…" />
          </FieldRow>
          <FieldRow>
            <Field label="Gross (g)" kind="weight" value={it.grossG} onChangeText={(v) => set(it.key, { grossG: v })} placeholder="0.000" />
            <Field label={costLabel} kind="money" value={it.costLkr} onChangeText={(v) => set(it.key, { costLkr: v })} placeholder="0.00" />
          </FieldRow>
        </View>
      ))}
      <Button title="Add item" icon="plus" variant="gray" onPress={() => onChange([...items, newItem()])} />
    </View>
  );
}
