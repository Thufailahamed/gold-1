import { useState } from "react";
import { View } from "react-native";
import { router, Stack, useLocalSearchParams, type Href } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { extractScanCode } from "@goldos/shared";
import { api, PendingApprovalError } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { GUTTER, useTheme } from "@/theme";
import {
  Button,
  Callout,
  chooseAction,
  Checkbox,
  ErrorState,
  Field,
  FormStack,
  Grid,
  HeaderButton,
  Hero,
  IconButton,
  KeyValue,
  Loading,
  Pill,
  Row,
  scanBarcode,
  Screen,
  Section,
  SelectField,
  Sheet,
  StatusPill,
  Text,
  toast,
  useRefresh,
} from "@/ui";

type Detail = {
  invoice: {
    id: string;
    number: string;
    customer_id: string | null;
    customer_name: string | null;
    customer_code: string | null;
    salesperson_name: string | null;
    subtotal_cents: number;
    discount_cents: number;
    tax_cents?: number;
    tax_rate_bp?: number;
    total_cents: number;
    paid_cents: number;
    balance_cents: number;
    status: string;
    created_at: number;
    branch_id: string;
    branch_name: string | null;
    customer_phone: string | null;
    tendered_cents: number | null;
    store_credit_cents: number;
    notes: string | null;
  };
  items: { id: string; product_id: string; barcode: string; sku: string; name: string; gross_mg: number; net_mg: number; karat: string; price_cents: number; discount_cents: number }[];
  payments: { id: string; amount_cents: number; method: string; created_at: number; account_code: string | null; bank_account_name: string | null }[];
  receipts: { id: string; number: string; receipt_date: string; method: string; status: string; amount_cents: number }[];
  journal: { id: string; account_code: string; account_name: string | null; debit_cents: number; credit_cents: number; memo: string | null; entry_no: string | null }[];
  returns: { id: string; number: string; type: string; refund_cents: number; credit_cents: number; exchange_sale_id: string | null; status: string }[];
  returnedItemIds: string[];
  exchangeOf: { id: string; number: string; invoice_id: string; invoice_number: string } | null;
};

const STATUS_LABEL: Record<string, string> = { PAID: "Paid", PARTIAL: "Part paid", UNPAID: "Unpaid · on credit", VOID: "Void" };
const fmt = (c: number) => (c / 100).toLocaleString("en-US");

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const qc = useQueryClient();
  const { can } = useSession();
  const canCancel = can("sales:cancel");
  const canCollect = can("accounts:manage");

  const [retOpen, setRetOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [type, setType] = useState("PARTIAL");
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState("original");
  const [refundBank, setRefundBank] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [retScan, setRetScan] = useState("");
  // A return over the threshold waits in the Approval Center; the retry
  // carries the approval id and must keep the same items and type.
  const [retPending, setRetPending] = useState<{ approvalId: string; sig: string } | null>(null);

  const banks = useQuery({
    queryKey: ["pos-bank-accounts", "all"],
    queryFn: () => api<{ id: string; name: string; bank_name: string | null }[]>("/api/v1/sales/bank-accounts"),
    enabled: retOpen && refundMethod === "bank",
    retry: false,
  });
  const approvers = useQuery({
    queryKey: ["pos-approvers"],
    queryFn: () => api<{ id: string; name: string }[]>("/api/v1/sales/approvers"),
    enabled: retOpen,
    retry: false,
  });
  const retSig = JSON.stringify([type, [...selected].sort()]);
  const retApproval = retPending && retPending.sig === retSig ? retPending : null;

  const detail = useQuery({ queryKey: ["sale", id], queryFn: () => api<Detail>(`/api/v1/sales/invoices/${id}`), enabled: !!id });
  const refresh = useRefresh(detail);

  const ret = useMutation({
    mutationFn: () =>
      api<{ returnId: string; number: string }>("/api/v1/sales/returns", {
        method: "POST",
        body: JSON.stringify({
          invoiceId: id,
          itemIds: type === "FULL" ? undefined : selected,
          type,
          reason,
          refundMethod,
          refundBankAccountId: refundMethod === "bank" && refundBank ? refundBank : undefined,
          approvedBy: retApproval ? undefined : approvedBy || undefined,
          approvalId: retApproval?.approvalId,
        }),
      }),
    onSuccess: (d) => {
      toast.success(`Return ${d.number} recorded`);
      setRetOpen(false);
      setSelected([]);
      setReason("");
      setRetPending(null);
      void qc.invalidateQueries({ queryKey: ["sale", id] });
      void qc.invalidateQueries({ queryKey: ["sale-print", id] });
    },
    onError: (e) => {
      if (e instanceof PendingApprovalError && e.approvalId) {
        setRetPending({ approvalId: e.approvalId, sig: retSig });
        toast.info("Return sent for approval", "Once it is approved in the Approval Center, record the return again.");
        return;
      }
      toast.error(e, "Return failed");
    },
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
        <ErrorState error={detail.error} title="Sale not found" onRetry={() => void detail.refetch()} />
        <Button title="Back to invoices" variant="plain" onPress={() => router.replace("/sales/invoices")} style={{ alignSelf: "center" }} />
      </Screen>
    );
  }

  const { invoice, items, payments, journal, returns, exchangeOf } = detail.data;
  const returned = new Set(detail.data.returnedItemIds ?? []);
  const returnable = items.filter((it) => !returned.has(it.id));
  const creditCents = payments.filter((p) => p.method === "credit").reduce((s, p) => s + p.amount_cents, 0);
  const balance = Math.max(0, invoice.balance_cents ?? invoice.total_cents - invoice.paid_cents);
  const receipts = detail.data.receipts ?? [];
  const journalNet = journal.reduce((s, j) => s + j.debit_cents - j.credit_cents, 0);

  // Scan the piece the customer brought back to tick its line.
  function scanReturn(raw: string) {
    const code = extractScanCode(raw);
    setRetScan("");
    if (!code) return;
    const it = items.find((x) => x.barcode === code || x.sku === code);
    if (!it) return toast.error(`${code} is not on ${invoice.number}`);
    if (returned.has(it.id)) return toast.error(`${code} was already returned`);
    setSelected((s) => (s.includes(it.id) ? s : [...s, it.id]));
  }

  const exchangeHref = (r: { id: string; number: string }) => {
    const q = new URLSearchParams({ exchange: r.id, exchangeNo: r.number });
    if (invoice.customer_id) {
      q.set("customerId", invoice.customer_id);
      q.set("customerName", invoice.customer_name ?? "Customer");
      q.set("customerCode", invoice.customer_code ?? "");
    }
    return `/pos?${q.toString()}`;
  };

  async function printMenu() {
    const i = await chooseAction("Print", ["A4 invoice", "Receipt 80mm"]);
    if (i === 0) router.push(`/sales/invoices/${id}/print`);
    if (i === 1) router.push(`/sales/invoices/${id}/print?format=receipt`);
  }

  const stats = [
    { label: "Subtotal", value: `${fmt(invoice.subtotal_cents)} LKR` },
    ...(invoice.tax_cents ? [{ label: `Tax ${(invoice.tax_rate_bp ?? 0) / 100}%`, value: `${fmt(invoice.tax_cents)} LKR` }] : []),
    { label: "Total", value: `${fmt(invoice.total_cents)} LKR` },
    { label: "Paid", value: `${fmt(invoice.paid_cents)} LKR` },
    { label: "Balance due", value: `${fmt(balance)} LKR` },
    { label: "Items", value: String(items.length) },
  ];

  return (
    <Screen {...refresh}>
      <Stack.Screen options={{ title: invoice.number, headerLargeTitleEnabled: false, headerRight: () => <HeaderButton icon="print" onPress={printMenu} accessibilityLabel="Print" /> }} />
      <Hero
        style={{ marginTop: 8 }}
        kicker="Sales invoice"
        title={invoice.number}
        subtitle={`${invoice.customer_name ?? "Walk-in"} · ${dateTime(invoice.created_at)}${invoice.salesperson_name ? ` · ${invoice.salesperson_name}` : ""}${invoice.branch_name ? ` · ${invoice.branch_name}` : ""}`}
        stats={stats}
      >
        <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <Pill tone="dark">{STATUS_LABEL[invoice.status] ?? invoice.status}</Pill>
          {invoice.discount_cents ? <Pill tone="dark">{`Discount ${fmt(invoice.discount_cents)}`}</Pill> : null}
        </View>
      </Hero>

      <View style={{ marginHorizontal: GUTTER, marginTop: 14, gap: 10 }}>
        <Grid columns={2} style={{ marginHorizontal: 0 }}>
          <Button title="A4 invoice" icon="print" variant="gray" block onPress={() => router.push(`/sales/invoices/${id}/print`)} />
          <Button title="Receipt" icon="receipt" variant="gray" block onPress={() => router.push(`/sales/invoices/${id}/print?format=receipt`)} />
        </Grid>
        {balance > 0 && canCollect && invoice.customer_id ? (
          <Button title="Collect payment" icon="banknote" block onPress={() => router.push(`/accounts/receivables?collect=${encodeURIComponent(invoice.customer_id!)}`)} />
        ) : null}
        {canCancel && returnable.length > 0 ? <Button title="Record return" icon="return" variant="tinted" block onPress={() => setRetOpen(true)} /> : null}
      </View>

      {exchangeOf ? (
        <Callout tone="info" title={`Exchange for return ${exchangeOf.number}`} style={{ marginTop: 14 }}>
          <Button title={`Open ${exchangeOf.invoice_number}`} variant="plain" size="sm" onPress={() => router.push(`/sales/invoices/${exchangeOf.invoice_id}`)} style={{ alignSelf: "flex-start" }} />
        </Callout>
      ) : null}

      <Section title={`Items sold · ${items.length} piece${items.length === 1 ? "" : "s"}`}>
        {items.length === 0 ? (
          <Row title="No items" subtitle="This invoice has no line items." />
        ) : (
          items.map((it) => (
            <Row
              key={it.id}
              icon="gem"
              href={`/products/${it.product_id}` as Href}
              title={it.name}
              subtitle={
                <View style={{ gap: 3 }}>
                  <Text variant="caption1" tone="secondary" mono numberOfLines={1}>
                    {it.barcode} · {it.karat} · {(it.net_mg / 1000).toLocaleString("en-US")} g
                  </Text>
                  {returned.has(it.id) ? <Pill size="sm">Returned</Pill> : null}
                </View>
              }
              right={
                <View style={{ alignItems: "flex-end" }}>
                  <Text variant="body" num weight="600">
                    {fmt(it.price_cents)}
                  </Text>
                  {it.discount_cents ? (
                    <Text variant="caption1" num color={c.greenText}>
                      −{fmt(it.discount_cents)}
                    </Text>
                  ) : null}
                </View>
              }
            />
          ))
        )}
      </Section>

      <Section title="Payments" footer={creditCents > 0 ? `${fmt(creditCents)} LKR went on the customer's account` : undefined}>
        {payments.length === 0 ? <Row title="No payments" subtitle="No payments recorded on this invoice." /> : null}
        {payments.map((p) => (
          <Row
            key={p.id}
            title={
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Pill size="sm">{(p.method === "credit" ? "on account" : p.method).toUpperCase()}</Pill>
                {p.bank_account_name ? (
                  <Text variant="subhead" numberOfLines={1}>
                    {p.bank_account_name}
                  </Text>
                ) : null}
              </View>
            }
            subtitle={`${p.account_code ? `${p.account_code} · ` : ""}${dateTime(p.created_at)}`}
            value={fmt(p.amount_cents)}
            valueTone="label"
          />
        ))}
        {invoice.store_credit_cents > 0 ? <KeyValue label="Settled from store credit" value={fmt(invoice.store_credit_cents)} /> : null}
        {receipts.map((r) => (
          <Row
            key={r.id}
            title={
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Pill size="sm">RECEIPT</Pill>
                <Text variant="subhead" mono style={{ textDecorationLine: r.status === "VOID" ? "line-through" : "none" }}>
                  {r.number}
                </Text>
              </View>
            }
            subtitle={`${r.receipt_date} · ${r.method}${r.status === "VOID" ? " · void" : ""}`}
            value={fmt(r.amount_cents)}
          />
        ))}
        <KeyValue
          label={balance > 0 ? "Balance due" : "Settled in full"}
          value={
            <Text variant="headline" num color={balance > 0 ? c.redText : c.greenText}>
              {fmt(balance)}
            </Text>
          }
        />
      </Section>
      {invoice.notes ? (
        <Section title="Note">
          <Row title={invoice.notes} numberOfLines={6} />
        </Section>
      ) : null}

      {returns.length > 0 ? (
        <Section title={`Returns · ${returns.length} recorded`}>
          {returns.map((r) => (
            <View key={r.id}>
              <Row
                title={
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Text variant="body" mono weight="600">
                      {r.number}
                    </Text>
                    <Pill size="sm">{r.type}</Pill>
                    <StatusPill status={r.status} size="sm" />
                    {r.credit_cents ? <Pill size="sm" tone="info">store credit</Pill> : null}
                  </View>
                }
                value={fmt(r.refund_cents + (r.credit_cents ?? 0))}
                valueTone="label"
              />
              {r.type === "EXCHANGE" ? (
                r.exchange_sale_id ? (
                  <Row icon="swap" iconColor={c.teal} title="Replacement sale" href={`/sales/invoices/${r.exchange_sale_id}` as Href} />
                ) : (
                  <Row icon="swap" iconColor={c.gold} title="Start replacement sale" onPress={() => router.push(exchangeHref(r) as Href)} />
                )
              ) : null}
            </View>
          ))}
        </Section>
      ) : null}

      <Section title="Ledger postings" footer={journal.length > 0 ? (journalNet === 0 ? "Balanced — debits equal credits" : "Out of balance") : "Journal entries appear after posting."}>
        {journal.map((j) => (
          <Row
            key={j.id}
            title={
              <Text variant="subhead" numberOfLines={2}>
                <Text variant="subhead" mono tone="secondary">
                  {j.account_code}{" "}
                </Text>
                {j.account_name ?? ""}
                {j.memo && !j.memo.startsWith("Sale ") ? <Text tone="secondary">{` · ${j.memo}`}</Text> : null}
              </Text>
            }
            right={
              <View style={{ alignItems: "flex-end" }}>
                {j.debit_cents ? (
                  <Text variant="subhead" num>
                    Dr {fmt(j.debit_cents)}
                  </Text>
                ) : null}
                {j.credit_cents ? (
                  <Text variant="subhead" num tone="secondary">
                    Cr {fmt(j.credit_cents)}
                  </Text>
                ) : null}
              </View>
            }
          />
        ))}
      </Section>

      <Sheet
        visible={retOpen}
        onClose={() => setRetOpen(false)}
        title="Record return"
        submitLabel={retApproval ? "Record approved" : "Record"}
        onSubmit={() => ret.mutate()}
        submitting={ret.isPending}
        canSubmit={!!reason && (type === "FULL" || selected.length > 0)}
      >
        <FormStack>
          {retApproval ? (
            <Callout tone="warning" title="Waiting for approval" style={{ marginHorizontal: 0 }}>
              Once this return is approved in the Approval Center, press Record again. Changing the items or type cancels the request.
            </Callout>
          ) : null}
          <SelectField
            label="Type"
            value={type}
            options={[
              { value: "PARTIAL", label: "Partial" },
              { value: "FULL", label: "Full" },
              { value: "EXCHANGE", label: "Exchange" },
            ]}
            onChange={(v) => setType(v || "PARTIAL")}
          />
          {type !== "FULL" ? (
            <>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Field value={retScan} onChangeText={setRetScan} placeholder="Scan or type returned piece" kind="code" icon="barcode" autoCapitalize="characters" onSubmitEditing={() => scanReturn(retScan)} returnKeyType="done" />
                </View>
                <IconButton
                  name="scan"
                  variant="tinted"
                  size={48}
                  accessibilityLabel="Scan returned piece"
                  onPress={async () => {
                    const code = await scanBarcode({ title: "Scan returned piece" });
                    if (code) scanReturn(code);
                  }}
                />
              </View>
              <View style={{ gap: 2 }}>
                {returnable.map((it) => (
                  <Checkbox
                    key={it.id}
                    checked={selected.includes(it.id)}
                    onChange={(v) => setSelected((s) => (v ? [...s, it.id] : s.filter((x) => x !== it.id)))}
                    label={it.name}
                    subtitle={it.barcode}
                  />
                ))}
              </View>
            </>
          ) : (
            <Text variant="subhead" tone="secondary">
              Returns every remaining piece: {returnable.map((it) => it.barcode).join(", ")}
            </Text>
          )}
          <Field label="Reason (required)" value={reason} onChangeText={setReason} />
          <SelectField
            label="Refund method"
            value={refundMethod}
            options={[
              { value: "original", label: "Refund to original methods" },
              { value: "cash", label: "Cash" },
              { value: "bank", label: "Bank" },
              { value: "credit", label: "Store credit" },
            ]}
            onChange={(v) => setRefundMethod(v || "original")}
          />
          {refundMethod === "bank" && (banks.data?.length ?? 0) > 1 ? (
            <SelectField
              label="Refund from bank account"
              value={refundBank}
              allowClear
              clearLabel="Default bank (1010)"
              placeholder="Default bank (1010)"
              options={(banks.data ?? []).map((bk) => ({ value: bk.id, label: `${bk.name}${bk.bank_name ? ` · ${bk.bank_name}` : ""}` }))}
              onChange={setRefundBank}
            />
          ) : null}
          {refundMethod === "original" && creditCents > 0 ? (
            <Text variant="footnote" tone="secondary">
              The part bought on credit comes off what the customer owes; only money actually paid is refunded.
            </Text>
          ) : null}
          <SelectField
            label="Counter approver (large returns)"
            value={approvedBy}
            allowClear
            clearLabel="None"
            placeholder="None"
            options={(approvers.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
            onChange={setApprovedBy}
          />
          {type === "EXCHANGE" ? (
            <Text variant="footnote" tone="secondary">
              After recording, start the replacement sale from the Returns section — pick Store credit to carry the refund into it.
            </Text>
          ) : null}
        </FormStack>
      </Sheet>
    </Screen>
  );
}
