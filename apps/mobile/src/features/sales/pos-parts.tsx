import { useState } from "react";
import { Modal, Platform, Pressable, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTheme } from "@/theme";
import {
  Button,
  CameraScanner,
  EmptyState,
  Field,
  FormStack,
  Icon,
  KeyValue,
  Loading,
  Pill,
  Row,
  SearchField,
  Section,
  SelectField,
  Sheet,
  Text,
} from "@/ui";

/* ------------------------------------------------------------------ shared types & helpers */

export type Lookup = {
  product: {
    id: string;
    barcode: string;
    name: string;
    karat: string;
    net_mg: number;
    selling_price_cents: number | null;
    cost_cents: number | null;
    status: string;
    branch_id: string;
    reserved_customer_id: string | null;
    reserved_customer_name: string | null;
  };
  livePrice: { amount_cents: number } | null;
};

export type CatalogRow = {
  id: string;
  barcode: string;
  sku: string;
  name: string;
  status: string;
  karat: string;
  category_name: string;
  net_mg: number;
  price_cents: number | null;
  reserved_customer_name: string | null;
};

export type CartLine = {
  productId: string;
  barcode: string;
  name: string;
  karat: string;
  netMg: number;
  priceCents: number;
  discountCents: number;
  /** Set when the piece is held: it sells only to this customer. */
  reservedFor?: { id: string; name: string };
};

export type PayRow = { method: string; amountLkr: string; bankAccountId?: string };
export type Customer = { id: string; name: string; code: string; phone?: string | null };
export type CustomerCredit = { balanceCents: number; branchBalanceCents: number; creditLimitCents: number; openInvoices: number; openDueCents: number };
export type BankAccount = { id: string; name: string; bank_name: string | null; account_number: string | null };
/** The replacement half of an exchange, handed over from the invoice page. */
export type Exchange = { returnId: string; number: string };
export type Done = { invoiceId: string; number: string; totalCents: number; changeCents: number | null; customer: string | null };

export const METHODS = ["cash", "card", "bank", "credit", "other"];
export const fmt = (c: number) => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const cents = (lkr: string) => Math.round(Number(lkr || 0) * 100);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The shelf price the server will charge, or why the piece cannot be sold
 * here. Mirrors the checkout guards so a bad scan is caught at the counter.
 */
export function saleable(d: Lookup, branchId: string, customer: Customer | null): { price: number } | { error: string } {
  const p = d.product;
  if (p.status === "RESERVED") {
    if (customer && customer.id !== p.reserved_customer_id) return { error: `${p.barcode} is held for ${p.reserved_customer_name ?? "another customer"}` };
  } else if (p.status !== "IN_STOCK") return { error: `${p.barcode} is ${p.status.replace(/_/g, " ").toLowerCase()}, not for sale` };
  if (branchId && p.branch_id !== branchId) return { error: `${p.barcode} belongs to another branch` };
  if (p.cost_cents === null) return { error: `${p.barcode} has no book cost — set its cost before selling` };
  const price = p.selling_price_cents ?? d.livePrice?.amount_cents;
  if (price === undefined) return { error: `No gold rate for ${p.karat} — set today's rate first` };
  return { price };
}

export const lookupCode = (code: string) => api<Lookup>(`/api/v1/products/barcode/${encodeURIComponent(code)}`);

/* ------------------------------------------------------------------ continuous scanner */

/** Camera stays open so a tray of pieces can be scanned in a row. */
export function ScanSheet({ visible, onClose, onCode, count }: { visible: boolean; onClose: () => void; onCode: (code: string) => void; count: number }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"} onRequestClose={onClose}>
      {visible ? (
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <CameraScanner continuous title={`Scan pieces · ${count} in cart`} hint="Each tag or QR is added to the sale" onClose={onClose} onScanned={onCode} />
          <View style={{ position: "absolute", left: 20, right: 20, bottom: 40 }}>
            <Button title="Done" size="lg" block onPress={onClose} />
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

/* ------------------------------------------------------------------ cart line editor */

export function LineSheet({
  line,
  lineTotal,
  onClose,
  onDiscount,
  onRemove,
}: {
  line: CartLine | null;
  lineTotal: number;
  onClose: () => void;
  onDiscount: (cents: number) => void;
  onRemove: () => void;
}) {
  const [value, setValue] = useState("");
  const [key, setKey] = useState<string | null>(null);
  if (line && key !== line.productId) {
    setKey(line.productId);
    setValue(line.discountCents ? String(line.discountCents / 100) : "");
  }
  if (!line) return null;
  const disc = Math.min(line.priceCents, Math.max(0, cents(value)));
  return (
    <Sheet
      visible={!!line}
      onClose={onClose}
      title={line.barcode}
      submitLabel="Apply"
      onSubmit={() => {
        onDiscount(disc);
        onClose();
      }}
    >
      <Section>
        <Row title={line.name} subtitle={`${line.karat} · ${(line.netMg / 1000).toLocaleString("en-US")} g net`} icon="gem" />
        <KeyValue label="Price" value={`${fmt(line.priceCents)} LKR`} />
        <KeyValue label="Line total" value={`${fmt(lineTotal)} LKR`} />
      </Section>
      {line.reservedFor ? (
        <View style={{ marginHorizontal: 16, marginTop: 12 }}>
          <Pill tone="warning" icon="lock">{`Held · ${line.reservedFor.name}`}</Pill>
        </View>
      ) : null}
      <FormStack>
        <Field
          label="Discount (LKR)"
          kind="money"
          value={value}
          onChangeText={setValue}
          placeholder="0"
          hint={`Up to ${fmt(line.priceCents)} LKR. Discounts above your limit need approval.`}
        />
        <Button
          title="Remove from cart"
          icon="trash"
          variant="destructiveTinted"
          block
          onPress={() => {
            onRemove();
            onClose();
          }}
        />
      </FormStack>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ customer picker */

export function CustomerSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (c: Customer) => void }) {
  const [q, setQ] = useState("");
  const customers = useQuery({
    queryKey: ["pos-customers", q],
    queryFn: () => api<{ rows: Customer[]; total: number }>(`/api/v1/customers?search=${encodeURIComponent(q)}&limit=8`),
    enabled: q.trim().length > 0,
  });
  return (
    <Sheet visible={visible} onClose={onClose} title="Customer">
      <SearchField value={q} onChangeText={setQ} placeholder="Search name or phone…" autoFocus style={{ marginTop: 12 }} />
      {!q.trim() ? (
        <EmptyState compact icon="person" title="Find a customer" message="Optional — needed for credit sales and held pieces." />
      ) : customers.isLoading ? (
        <Loading />
      ) : (customers.data?.rows ?? []).length === 0 ? (
        <EmptyState
          compact
          icon="personAdd"
          title="No match"
          message="Add the customer, then search again."
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
              subtitle={c.phone ?? undefined}
              value={c.code}
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

/* ------------------------------------------------------------------ payment */

export function PaymentSheet(p: {
  visible: boolean;
  onClose: () => void;
  total: number;
  subtotal: number;
  discount: number;
  tax: number;
  taxRateBp: number;
  taxLabel: string;
  pays: PayRow[];
  setPay: (i: number, patch: Partial<PayRow>) => void;
  setPays: (fn: (ps: PayRow[]) => PayRow[]) => void;
  payAll: (m: string) => void;
  autoBalance: () => void;
  tendered: string;
  setTendered: (s: string) => void;
  cashDue: number;
  change: number | null;
  paidSum: number;
  creditDue: number;
  customer: Customer | null;
  storeCredit: number;
  needsCustomer: boolean;
  needsBank: boolean;
  overLimit: boolean;
  creditLimitCents: number;
  bankRows: BankAccount[];
  canComplete: boolean;
  completing: boolean;
  approved: boolean;
  onComplete: () => void;
}) {
  const { c } = useTheme();
  const balanced = p.paidSum === p.total && p.total > 0;
  return (
    <Sheet visible={p.visible} onClose={p.onClose} title="Payment" cancelLabel="Back">
      <View style={{ alignItems: "center", paddingTop: 22, gap: 2 }}>
        <Text variant="footnote" tone="secondary" upper>
          Total due
        </Text>
        <Text variant="largeTitle" num rounded>
          {fmt(p.total)}
          <Text variant="title3" tone="secondary">
            {" "}
            LKR
          </Text>
        </Text>
      </View>

      <Section>
        <KeyValue label="Subtotal" value={fmt(p.subtotal)} />
        {p.discount > 0 ? <KeyValue label="Discount" value={`−${fmt(p.discount)}`} /> : null}
        {p.taxRateBp > 0 ? <KeyValue label={`${p.taxLabel} ${(p.taxRateBp / 100).toFixed(2).replace(/\.00$/, "")}%`} value={fmt(p.tax)} /> : null}
      </Section>

      {p.total > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginHorizontal: 16, marginTop: 18 }}>
          {["cash", "card", "bank", ...(p.customer ? ["credit"] : [])].map((m) => (
            <Button key={m} title={`All ${m}`} variant="tinted" size="sm" onPress={() => p.payAll(m)} />
          ))}
        </View>
      ) : null}

      <FormStack>
        {p.pays.map((pay, i) => (
          <View key={i} style={{ gap: 10, backgroundColor: c.cardSecondary, borderRadius: 14, borderCurve: "continuous", padding: 12 }}>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
              <View style={{ flex: 1 }}>
                <SelectField
                  label={p.pays.length > 1 ? `Payment ${i + 1}` : "Method"}
                  value={pay.method}
                  options={METHODS.map((m) => ({ value: m, label: cap(m) }))}
                  onChange={(v) => p.setPay(i, { method: v || "cash", bankAccountId: undefined })}
                />
              </View>
              <View style={{ flex: 1.2 }}>
                <Field
                  label="Amount"
                  kind="money"
                  value={pay.amountLkr}
                  placeholder="0"
                  onChangeText={(v) => p.setPay(i, { amountLkr: v })}
                  onFocus={() => {
                    // A single payment row is almost always the whole bill.
                    if (p.pays.length === 1 && !pay.amountLkr && p.total > 0) p.setPay(0, { amountLkr: String(p.total / 100) });
                  }}
                />
              </View>
              {p.pays.length > 1 ? (
                <Pressable hitSlop={8} onPress={() => p.setPays((ps) => ps.filter((_, j) => j !== i))} style={{ paddingBottom: 14 }} accessibilityLabel="Remove payment">
                  <Icon name="minusCircle" size={22} color={c.red} />
                </Pressable>
              ) : null}
            </View>
            {pay.method === "bank" && p.bankRows.length > 1 ? (
              <SelectField
                label="Bank account"
                value={pay.bankAccountId ?? ""}
                placeholder="Which bank account?"
                error={!pay.bankAccountId ? "Choose the account the payment went into" : null}
                options={p.bankRows.map((b) => ({
                  value: b.id,
                  label: `${b.name}${b.bank_name ? ` · ${b.bank_name}` : ""}`,
                  subtitle: b.account_number ?? undefined,
                }))}
                onChange={(v) => p.setPay(i, { bankAccountId: v || undefined })}
              />
            ) : pay.method === "bank" && p.bankRows.length === 1 ? (
              <Text variant="footnote" tone="secondary">
                Into {p.bankRows[0]!.name}
              </Text>
            ) : null}
          </View>
        ))}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button title="Split" icon="plus" variant="gray" size="sm" onPress={() => p.setPays((ps) => [...ps, { method: "card", amountLkr: "" }])} />
          <Button title="Auto-balance last" variant="gray" size="sm" onPress={p.autoBalance} />
        </View>

        {p.cashDue > 0 ? (
          <View style={{ gap: 6 }}>
            <Field label="Cash tendered" kind="money" value={p.tendered} onChangeText={p.setTendered} placeholder={fmt(p.cashDue)} />
            {p.change !== null ? (
              <Text variant="headline" num color={p.change < 0 ? c.red : c.greenText}>
                {p.change < 0 ? `Short ${fmt(-p.change)} LKR` : `Change ${fmt(p.change)} LKR`}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={{ gap: 4 }}>
          <Text variant="subhead" num weight={balanced ? "600" : "400"} color={balanced ? c.greenText : c.label2}>
            Paid {fmt(p.paidSum)} / {fmt(p.total)}
            {p.paidSum !== p.total && p.total > 0 ? ` · ${p.paidSum > p.total ? "over" : "short"} ${fmt(Math.abs(p.total - p.paidSum))}` : ""}
          </Text>
          {p.creditDue > 0 && p.customer ? (
            <Text variant="footnote" tone="secondary">
              {fmt(p.creditDue)} LKR on {p.customer.name}'s account
              {p.storeCredit > 0 ? ` — ${fmt(Math.min(p.storeCredit, p.creditDue))} from store credit` : ""}.
            </Text>
          ) : null}
          {p.needsCustomer ? (
            <Text variant="footnote" tone="danger">
              Credit needs a customer.
            </Text>
          ) : null}
          {p.needsBank ? (
            <Text variant="footnote" tone="danger">
              Choose the bank account the payment went into.
            </Text>
          ) : null}
          {p.overLimit ? (
            <Text variant="footnote" tone="danger">
              Over {p.customer?.name}'s credit limit of {fmt(p.creditLimitCents)} LKR — take more now or collect the balance first.
            </Text>
          ) : null}
        </View>

        <Button
          title={p.completing ? "Posting…" : p.approved ? "Complete approved sale" : "Complete sale"}
          icon="checkCircle"
          size="lg"
          block
          loading={p.completing}
          disabled={!p.canComplete}
          onPress={p.onComplete}
        />
      </FormStack>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ done */

export function DoneSheet({ done, onClose }: { done: Done | null; onClose: () => void }) {
  const { c } = useTheme();
  if (!done) return null;
  const go = (path: string) => {
    onClose();
    router.push(path as never);
  };
  return (
    <Sheet visible={!!done} onClose={onClose} title="Sale complete" cancelLabel="Close" submitLabel="New sale" onSubmit={onClose}>
      <View style={{ alignItems: "center", paddingTop: 28, gap: 8 }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, borderCurve: "continuous", backgroundColor: c.green, alignItems: "center", justifyContent: "center" }}>
          <Icon name="check" size={36} color="#FFFFFF" weight="bold" />
        </View>
        <Text variant="title2" mono>
          {done.number}
        </Text>
        <Text variant="footnote" tone="secondary" center style={{ maxWidth: 300 }}>
          Posted to the ledger — sales, tax, stock and the money accounts are updated.
        </Text>
      </View>
      <Section>
        <KeyValue label="Customer" value={done.customer ?? "Walk-in"} />
        <KeyValue label="Total" value={`${fmt(done.totalCents)} LKR`} />
        {done.changeCents ? (
          <KeyValue
            label="Change to give"
            value={
              <Text variant="title3" num color={c.greenText}>
                {fmt(done.changeCents)} LKR
              </Text>
            }
          />
        ) : null}
      </Section>
      <FormStack>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button title="Receipt 80mm" icon="print" variant="gray" block onPress={() => go(`/sales/invoices/${done.invoiceId}/print?format=receipt&auto=1`)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="A4 invoice" icon="invoice" block onPress={() => go(`/sales/invoices/${done.invoiceId}/print?auto=1`)} />
          </View>
        </View>
        <Button title="Open sale" variant="plain" onPress={() => go(`/sales/invoices/${done.invoiceId}`)} />
      </FormStack>
    </Sheet>
  );
}

