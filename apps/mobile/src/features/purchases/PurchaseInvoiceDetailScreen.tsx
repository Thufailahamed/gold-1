import { useState } from "react";
import { View } from "react-native";
import { router, Stack, useLocalSearchParams, type Href } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { dateTime, g, lkr } from "@/lib/format";
import { useSession } from "@/lib/session";
import { GUTTER } from "@/theme";
import { Button, Callout, ErrorState, Field, FormStack, Hero, Loading, Pill, promptText, Row, Screen, Section, SelectField, Sheet, Text, toast, useRefresh } from "@/ui";
import { bankOptions, num, useBankAccounts } from "./shared";

type Detail = {
  invoice: { id: string; number: string; supplier_id: string; subtotal_cents: number; charges_cents: number; total_cents: number; paid_cents: number; status: string };
  items: { id: string; product_id: string; barcode: string; sku: string; name: string; net_mg: number; cost_cents: number }[];
  payments: { id: string; amount_cents: number; method: string; created_at: number }[];
  journal: { id: string; account_code: string; debit_cents: number; credit_cents: number; memo: string | null }[];
};

export default function PurchaseInvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useSession();
  const canEdit = can("purchases:edit");
  const canCancel = can("purchases:cancel");
  const [paying, setPaying] = useState(false);
  const detail = useQuery({ queryKey: ["invoice", id], queryFn: () => api<Detail>(`/api/v1/purchases/invoices/${id}`), enabled: !!id });
  const refresh = useRefresh(detail);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["invoice", id] });
    void qc.invalidateQueries({ queryKey: ["invoices"] });
    void qc.invalidateQueries({ queryKey: ["pur-dash"] });
  };

  const voidIt = useMutation({
    mutationFn: (reason: string) => api(`/api/v1/purchases/invoices/${id}/void`, { method: "PATCH", body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      toast.success("Invoice voided with reversal");
      invalidate();
    },
    onError: (e) => toast.error(e, "Void failed"),
  });

  if (detail.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Invoice", headerLargeTitleEnabled: false }} />
        <Loading />
      </Screen>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Invoice", headerLargeTitleEnabled: false }} />
        <ErrorState error={detail.error} title="Invoice not found" onRetry={() => void detail.refetch()} />
        <Button title="Back to invoices" variant="plain" onPress={() => router.replace("/purchases/invoices" as Href)} style={{ alignSelf: "center" }} />
      </Screen>
    );
  }
  const { invoice, items, payments, journal } = detail.data;
  const outstanding = invoice.total_cents - invoice.paid_cents;
  const showPay = invoice.status !== "PAID" && invoice.status !== "VOID" && canEdit;
  const showVoid = invoice.status !== "VOID" && canCancel;

  async function onVoid() {
    const reason = await promptText({ title: "Void invoice", message: "The stock, ledger and journal are reversed. Give a reason.", required: true, destructive: true, submitLabel: "Void" });
    if (reason) voidIt.mutate(reason);
  }

  return (
    <Screen {...refresh}>
      <Stack.Screen options={{ title: invoice.number, headerLargeTitleEnabled: false }} />
      <Hero
        style={{ marginTop: 8 }}
        kicker="Purchases"
        title={invoice.number}
        subtitle={`Supplier invoice — ${items.length} item${items.length === 1 ? "" : "s"} received into stock.`}
        stats={[
          { label: "Total", value: `LKR ${lkr(invoice.total_cents)}` },
          { label: "Paid", value: `LKR ${lkr(invoice.paid_cents)}` },
          { label: "Outstanding", value: `LKR ${lkr(outstanding)}` },
          { label: "Items", value: String(items.length) },
        ]}
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          <Pill tone="dark">{invoice.status}</Pill>
          {invoice.charges_cents ? <Pill tone="dark">{`Charges ${lkr(invoice.charges_cents)}`}</Pill> : null}
        </View>
      </Hero>
      {showPay || showVoid ? (
        <View style={{ flexDirection: "row", gap: 10, marginHorizontal: GUTTER, marginTop: 14 }}>
          {showPay ? <Button title="Record payment" icon="banknote" style={{ flex: 1 }} onPress={() => setPaying(true)} /> : null}
          {showVoid ? <Button title="Void" icon="ban" variant="destructiveTinted" style={{ flex: 1 }} loading={voidIt.isPending} onPress={() => void onVoid()} /> : null}
        </View>
      ) : null}

      <Section
        title={`Items · ${items.length} received`}
        action={items.length > 0 ? { label: "Print labels", onPress: () => router.push(`/products/labels?ids=${items.map((it) => it.product_id).join(",")}` as Href) } : undefined}
      >
        {items.length === 0 ? <Row title="No items" subtitle="This invoice has no line items." /> : null}
        {items.map((it) => (
          <Row key={it.id} href={`/products/${it.product_id}` as Href} title={it.name} subtitle={`${it.barcode} · ${g(it.net_mg)}`} value={lkr(it.cost_cents)} valueTone="label" />
        ))}
      </Section>

      <Section title="Payments">
        {payments.length === 0 ? <Row title="No payments yet" subtitle="Record a payment to settle the balance." /> : null}
        {payments.map((p) => (
          <Row key={p.id} title={<Pill size="sm">{p.method.toUpperCase()}</Pill>} subtitle={dateTime(p.created_at)} value={lkr(p.amount_cents)} valueTone="label" />
        ))}
      </Section>

      <Section title="Journal">
        {journal.length === 0 ? <Row title="No postings" subtitle="Journal entries appear after posting." /> : null}
        {journal.map((j) => (
          <Row
            key={j.id}
            title={
              <Text variant="subhead" mono>
                {j.account_code}
              </Text>
            }
            subtitle={j.memo ?? undefined}
            value={j.debit_cents ? `DR ${lkr(j.debit_cents)}` : `CR ${lkr(j.credit_cents)}`}
            valueTone={j.debit_cents ? "label" : "secondary"}
            mono
          />
        ))}
      </Section>

      {paying ? (
        <PaySheet
          id={id}
          outstanding={outstanding}
          onClose={() => setPaying(false)}
          onDone={() => {
            setPaying(false);
            invalidate();
          }}
        />
      ) : null}
    </Screen>
  );
}

function PaySheet({ id, outstanding, onClose, onDone }: { id: string; outstanding: number; onClose: () => void; onDone: () => void }) {
  const banks = useBankAccounts();
  const [amount, setAmount] = useState((outstanding / 100).toFixed(2));
  const [bankAccountId, setBankAccountId] = useState("");
  const opts = bankOptions(banks.data);
  const amt = num(amount);
  const valid = Number.isFinite(amt) && amt > 0 && !!bankAccountId;
  const pay = useMutation({
    mutationFn: () => api(`/api/v1/purchases/invoices/${id}/payments`, { method: "POST", body: JSON.stringify({ amountLkr: amt, bankAccountId }) }),
    onSuccess: () => {
      toast.success("Payment recorded");
      onDone();
    },
    onError: (e) => toast.error(e, "Payment failed"),
  });
  return (
    <Sheet visible onClose={onClose} title="Record payment" submitLabel="Record" onSubmit={() => pay.mutate()} submitting={pay.isPending} canSubmit={valid}>
      <FormStack>
        <Text variant="subhead" tone="secondary">
          {`Outstanding: LKR ${lkr(outstanding)}`}
        </Text>
        <Field label="Amount (LKR)" kind="money" value={amount} onChangeText={setAmount} error={amount && amt * 100 > outstanding + 0.5 ? "More than the outstanding balance" : null} />
        {!banks.isLoading && opts.length === 0 ? (
          <Callout tone="warning" title="No bank account" style={{ marginHorizontal: 0 }}>
            No bank account registered yet. Add one under Accounts first.
          </Callout>
        ) : (
          <SelectField label="Pay from" value={bankAccountId} options={opts} onChange={setBankAccountId} placeholder="Choose an account…" />
        )}
      </FormStack>
    </Sheet>
  );
}
