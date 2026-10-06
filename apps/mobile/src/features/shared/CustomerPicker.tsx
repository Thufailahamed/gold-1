import { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { radius, useTheme } from "@/theme";
import { EmptyState, Icon, Loading, Row, SearchField, Section, Sheet, Text } from "@/ui";

export type PickedCustomer = { id: string; code: string; name: string; phone?: string | null };

/** Searchable customer list in a sheet (GET /api/v1/customers?search=). */
export function CustomerSearchSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (c: PickedCustomer) => void }) {
  const [q, setQ] = useState("");
  const customers = useQuery({
    queryKey: ["customer-search", q],
    queryFn: () => api<{ rows: PickedCustomer[]; total: number }>(`/api/v1/customers?search=${encodeURIComponent(q)}&limit=10`),
    enabled: q.trim().length > 0,
  });
  return (
    <Sheet visible={visible} onClose={onClose} title="Customer">
      <SearchField value={q} onChangeText={setQ} placeholder="Name or phone…" autoFocus style={{ marginTop: 12 }} />
      {!q.trim() ? (
        <EmptyState compact icon="person" title="Search customers" message="Search by name or phone." />
      ) : customers.isLoading ? (
        <Loading />
      ) : customers.isError ? (
        <EmptyState compact icon="warning" title="Could not search customers" message={errorMessage(customers.error, "Please try again.")} />
      ) : (customers.data?.rows ?? []).length === 0 ? (
        <EmptyState
          compact
          icon="personAdd"
          title="No match"
          message="Add the customer first, then search again."
          action={{
            label: "Add a customer",
            onPress: () => {
              onClose();
              router.push("/customers");
            },
          }}
        />
      ) : (
        <Section>
          {(customers.data?.rows ?? []).map((c) => (
            <Row
              key={c.id}
              title={c.name}
              subtitle={[c.code, c.phone].filter(Boolean).join(" · ")}
              onPress={() => {
                onPick(c);
                setQ("");
                onClose();
              }}
            />
          ))}
        </Section>
      )}
    </Sheet>
  );
}

/** Form field that shows the chosen customer and opens the search sheet. */
export function CustomerField({
  label = "Customer",
  value,
  onChange,
  error,
  allowClear = true,
}: {
  label?: string;
  value: PickedCustomer | null;
  onChange: (c: PickedCustomer | null) => void;
  error?: string | null;
  allowClear?: boolean;
}) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text variant="footnote" tone="secondary" weight="500" style={{ paddingHorizontal: 4 }}>
        {label}
      </Text>
      <Pressable
        onPress={() => {
          haptic.selection();
          setOpen(true);
        }}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          backgroundColor: c.card,
          borderRadius: radius.md + 2, borderCurve: "continuous",
          paddingHorizontal: 14,
          minHeight: 52,
          opacity: pressed ? 0.7 : 1,
          borderWidth: 1.5,
          borderColor: error ? c.red : "transparent",
        })}
      >
        <Icon name={value ? "personCheck" : "person"} size={18} color={value ? c.green : c.label2} />
        <View style={{ flex: 1 }}>
          <Text variant="body" tone={value ? "label" : "tertiary"} numberOfLines={1}>
            {value ? value.name : "Search customers…"}
          </Text>
          {value ? (
            <Text variant="caption1" tone="secondary" numberOfLines={1}>
              {[value.code, value.phone].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
        </View>
        {value && allowClear ? (
          <Pressable hitSlop={10} onPress={() => onChange(null)} accessibilityLabel="Clear customer">
            <Icon name="closeCircle" size={18} color={c.label3} />
          </Pressable>
        ) : (
          <Icon name="chevronRight" size={13} color={c.label3} weight="bold" />
        )}
      </Pressable>
      {error ? (
        <Text variant="footnote" tone="danger" style={{ paddingHorizontal: 4 }}>
          {error}
        </Text>
      ) : null}
      <CustomerSearchSheet visible={open} onClose={() => setOpen(false)} onPick={onChange} />
    </View>
  );
}

/** Resolves a customer id to its record (shared cache with the web key). */
export function useCustomer(id: string | null | undefined) {
  return useQuery({
    queryKey: ["repair-customer", id],
    queryFn: () => api<PickedCustomer>(`/api/v1/customers/${id}`),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });
}

export function CustomerNameText({ id, prefix = "" }: { id: string; prefix?: string }) {
  const q = useCustomer(id);
  return (
    <Text variant="footnote" tone="secondary" numberOfLines={1}>
      {prefix}
      {q.isLoading ? "…" : q.data?.name ?? "-"}
    </Text>
  );
}
