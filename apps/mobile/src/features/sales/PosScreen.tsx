import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, TextInput, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { salesTaxCents } from "@goldos/shared";
import { api, errorCode, PendingApprovalError } from "@/lib/api";
import { extractScanCode, looksLikeCode } from "@/lib/barcode";
import { haptic } from "@/lib/haptics";
import { getSavedBranchId, useBranch } from "@/lib/session";
import { GUTTER, radius, typeScale, useTheme } from "@/theme";
import {
  BottomBar,
  Button,
  Callout,
  chooseAction,
  confirm,
  EmptyState,
  Field,
  HeaderButton,
  Icon,
  IconButton,
  KeyValue,
  OptionSheet,
  Pill,
  Row,
  Screen,
  Section,
  SelectField,
  Text,
  toast,
} from "@/ui";
import {
  cents,
  CustomerSheet,
  DoneSheet,
  fmt,
  LineSheet,
  lookupCode,
  PaymentSheet,
  saleable,
  ScanSheet,
  type BankAccount,
  type CartLine,
  type CatalogRow,
  type Customer,
  type CustomerCredit,
  type Done,
  type Exchange,
  type PayRow,
} from "./pos-parts";

type Pending = { approvalId: string; entityId: string; sig: string };
type Draft = { cart: CartLine[]; customer: Customer | null; exchange: Exchange | null; notes: string };

// An unfinished sale survives leaving the screen (web: sessionStorage draft).
let draft: Draft | null = null;

/** Debounce a fast-changing value (typed search) before it hits the API. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function PosScreen() {
  const { c } = useTheme();
  const params = useLocalSearchParams<{ add?: string; exchange?: string; exchangeNo?: string; customerId?: string; customerName?: string; customerCode?: string }>();
  const b = useBranch();
  const branchId = b.branch?.id ?? "";

  const [scan, setScan] = useState("");
  const [cart, setCart] = useState<CartLine[]>(draft?.cart ?? []);
  const [customer, setCustomer] = useState<Customer | null>(draft?.customer ?? null);
  const [exchange, setExchange] = useState<Exchange | null>(draft?.exchange ?? null);
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [approver, setApprover] = useState("");
  const [pays, setPays] = useState<PayRow[]>([{ method: "cash", amountLkr: "" }]);
  const [tendered, setTendered] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [stale, setStale] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [editLine, setEditLine] = useState<string | null>(null);
  const scanRef = useRef<TextInput>(null);
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const customerRef = useRef(customer);
  customerRef.current = customer;

  // Web stores the first branch when none is chosen; do the same.
  useEffect(() => {
    if (!getSavedBranchId() && b.branch) b.setBranchId(b.branch.id);
  }, [b]);

  // Keep the draft in memory so leaving the POS does not lose the cart.
  useEffect(() => {
    draft = cart.length === 0 && !customer && !exchange && !notes ? null : { cart, customer, exchange, notes };
  }, [cart, customer, exchange, notes]);

  // Typed text that is not a scanner's code is a product search.
  const typed = scan.trim();
  const isSearch = typed.length >= 2 && !looksLikeCode(typed);
  const q = useDebounced(isSearch ? typed : "", 180);
  const catalog = useQuery({
    queryKey: ["pos-catalog", branchId, customer?.id ?? "", q],
    queryFn: () =>
      api<CatalogRow[]>(
        `/api/v1/sales/catalog?branchId=${encodeURIComponent(branchId)}&q=${encodeURIComponent(q)}&limit=10${customer ? `&customerId=${encodeURIComponent(customer.id)}` : ""}`
      ),
    enabled: Boolean(branchId) && q.length >= 2,
    staleTime: 15_000,
  });
  const results = isSearch ? (catalog.data ?? []).filter((r) => !cart.some((l) => l.productId === r.id)) : [];

  const credit = useQuery({
    queryKey: ["pos-customer-credit", customer?.id, branchId],
    queryFn: () => api<CustomerCredit>(`/api/v1/sales/customers/${encodeURIComponent(customer!.id)}/credit?branchId=${encodeURIComponent(branchId)}`),
    enabled: Boolean(customer?.id) && Boolean(branchId),
    retry: false,
  });
  const banks = useQuery({
    queryKey: ["pos-bank-accounts", branchId],
    queryFn: () => api<BankAccount[]>(`/api/v1/sales/bank-accounts?branchId=${encodeURIComponent(branchId)}`),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const approvers = useQuery({
    queryKey: ["pos-approvers"],
    queryFn: () => api<{ id: string; name: string }[]>("/api/v1/sales/approvers"),
    staleTime: 5 * 60_000,
  });
  const taxConfig = useQuery({
    queryKey: ["pos-tax-config"],
    queryFn: () => api<{ rateBp: number; label: string }>("/api/v1/sales/tax-config"),
    staleTime: 5 * 60_000,
  });

  const lookup = useMutation({
    mutationFn: lookupCode,
    onSuccess: (d) => {
      const ok = saleable(d, branchId, customerRef.current);
      if ("error" in ok) {
        toast.error(ok.error);
        return;
      }
      const held =
        d.product.status === "RESERVED" && d.product.reserved_customer_id
          ? { id: d.product.reserved_customer_id, name: d.product.reserved_customer_name ?? "Customer" }
          : undefined;
      // A held piece names its buyer: put them on the sale.
      if (held && !customerRef.current) {
        setCustomer({ id: held.id, name: held.name, code: "" });
        toast.info(`${d.product.barcode} is held for ${held.name} — customer set`);
      }
      if (cartRef.current.some((l) => l.productId === d.product.id)) {
        toast.error(`${d.product.barcode} is already in the cart`);
        return;
      }
      const line: CartLine = {
        productId: d.product.id,
        barcode: d.product.barcode,
        name: d.product.name,
        karat: d.product.karat,
        netMg: d.product.net_mg,
        priceCents: ok.price,
        discountCents: 0,
        reservedFor: held,
      };
      // Two fast scans of one tag can both pass the check above.
      setCart((cur) => (cur.some((l) => l.productId === line.productId) ? cur : [...cur, line]));
      setDone(null);
      haptic.success();
    },
    onError: (e) => toast.error(e, "Lookup failed"),
  });

  function addCode(raw: string) {
    const code = extractScanCode(raw);
    if (!code) return;
    setScan("");
    if (code.startsWith("SINV-")) {
      toast.error(`${code} is an invoice — open it from Sales › Invoices to return or reprint`);
      return;
    }
    if (cartRef.current.some((l) => l.barcode === code)) {
      toast.error(`${code} is already in the cart`);
      return;
    }
    lookup.mutate(code);
  }

  function submitScan() {
    if (isSearch) {
      const pick = results[0];
      if (pick) return addCode(pick.barcode);
      if (catalog.isFetching || q !== typed) return; // results still coming
      toast.error(`No piece for sale matches "${typed}"`);
      return;
    }
    if (typed) addCode(scan);
  }

  // Hand-offs from other screens: ?add=<tag> from Scan / product pages,
  // ?exchange=<return> from an invoice's exchange return.
  const handled = useRef("");
  useEffect(() => {
    const key = `${params.add ?? ""}|${params.exchange ?? ""}`;
    if (key === "|" || handled.current === key || !branchId) return;
    handled.current = key;
    if (params.exchange) {
      setExchange({ returnId: params.exchange, number: params.exchangeNo ?? "exchange" });
      if (params.customerId) setCustomer({ id: params.customerId, name: params.customerName ?? "Customer", code: params.customerCode ?? "" });
    }
    if (params.add) addCode(params.add);
    router.setParams({ add: undefined, exchange: undefined, exchangeNo: undefined, customerId: undefined, customerName: undefined, customerCode: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.add, params.exchange, branchId]);

  // Same per-line rounding as the server, so the total asked for is exactly
  // the total the API will accept.
  const taxRateBp = taxConfig.data?.rateBp ?? 0;
  const taxLabel = taxConfig.data?.label ?? "VAT";
  const lineTax = (l: CartLine) => salesTaxCents(l.priceCents - l.discountCents, taxRateBp);
  const subtotal = cart.reduce((s, l) => s + l.priceCents, 0);
  const discount = cart.reduce((s, l) => s + l.discountCents, 0);
  const tax = cart.reduce((s, l) => s + lineTax(l), 0);
  const total = subtotal - discount + tax;
  const netMg = cart.reduce((s, l) => s + l.netMg, 0);
  const paidSum = pays.reduce((s, p) => s + cents(p.amountLkr), 0);
  const pct = subtotal > 0 ? (discount / subtotal) * 100 : 0;
  const cashDue = pays.filter((p) => p.method === "cash").reduce((s, p) => s + cents(p.amountLkr), 0);
  const creditDue = pays.filter((p) => p.method === "credit").reduce((s, p) => s + cents(p.amountLkr), 0);
  const change = tendered ? cents(tendered) - cashDue : null;
  const needsCustomer = creditDue > 0 && !customer;
  const heldMismatch = cart.filter((l) => l.reservedFor && l.reservedFor.id !== customer?.id);
  const bankRows = banks.data ?? [];
  const needsBank = bankRows.length > 1 && pays.some((p) => p.method === "bank" && !p.bankAccountId);
  // Store credit the customer holds at this branch is spent before new debt.
  const storeCredit = credit.data && credit.data.branchBalanceCents < 0 ? -credit.data.branchBalanceCents : 0;
  const overLimit = !!(creditDue > 0 && credit.data && credit.data.creditLimitCents > 0 && credit.data.balanceCents + creditDue > credit.data.creditLimitCents);

  // An approval binds the exact terms it was asked for; any cart edit voids it.
  const sig = JSON.stringify(cart.map((l) => [l.productId, l.priceCents, l.discountCents]));
  const approval = pending && pending.sig === sig ? pending : null;
  const canComplete =
    cart.length > 0 &&
    paidSum === total &&
    total > 0 &&
    !needsCustomer &&
    !needsBank &&
    !overLimit &&
    (change === null || change >= 0) &&
    heldMismatch.length === 0 &&
    !stale &&
    Boolean(branchId);

  function resetSale() {
    setCart([]);
    setCustomer(null);
    setExchange(null);
    setPays([{ method: "cash", amountLkr: "" }]);
    setTendered("");
    setNotes("");
    setApprover("");
    setPending(null);
    setStale(false);
  }

  const complete = useMutation({
    mutationFn: () =>
      api<{ invoiceId: string; number: string }>("/api/v1/sales/invoices", {
        method: "POST",
        body: JSON.stringify({
          customerId: customer?.id,
          branchId,
          items: cart.map((l) => ({ productId: l.productId, priceLkr: l.priceCents / 100, discountLkr: l.discountCents / 100 })),
          payments: pays.map((p) => ({
            method: p.method,
            amountLkr: Number(p.amountLkr),
            // One bank account needs no choosing; several do (needsBank).
            bankAccountId: p.method === "bank" ? p.bankAccountId || (bankRows.length === 1 ? bankRows[0]!.id : undefined) : undefined,
          })),
          tenderedLkr: cashDue > 0 && tendered ? Number(tendered) : undefined,
          notes: notes.trim() || undefined,
          approvedBy: approval ? undefined : approver || undefined,
          approvalId: approval?.approvalId,
          approvalEntityId: approval?.entityId,
          exchangeReturnId: exchange?.returnId,
        }),
      }),
    onSuccess: (d) => {
      const result: Done = {
        invoiceId: d.invoiceId,
        number: d.number,
        totalCents: total,
        changeCents: change !== null && change > 0 ? change : null,
        customer: customer?.name ?? null,
      };
      setPayOpen(false);
      // iOS cannot present a sheet while another is still dismissing.
      setTimeout(() => setDone(result), Platform.OS === "ios" ? 550 : 0);
      resetSale();
      toast.success(`Sale ${d.number} complete`);
    },
    onError: (e) => {
      if (e instanceof PendingApprovalError && e.approvalId) {
        setPending({ approvalId: e.approvalId, entityId: e.entityId ?? "", sig });
        setPayOpen(false);
        toast.info("Discount sent for approval", "Once a manager approves it in the Approval Center, complete the sale again.");
        return;
      }
      if (errorCode(e) === "CONFLICT" && e instanceof Error && e.message.includes("refresh the cart")) {
        setStale(true);
        setPayOpen(false);
      }
      toast.error(e, "Sale failed");
    },
  });

  // Reprice every line from the shelf. Pieces that can no longer be sold here
  // drop out with a reason.
  const reprice = useMutation({
    mutationFn: () => Promise.all(cartRef.current.map((l) => lookupCode(l.barcode).then((d) => ({ l, d })))),
    onSuccess: (rows) => {
      const next: CartLine[] = [];
      let changed = 0;
      for (const { l, d } of rows) {
        const ok = saleable(d, branchId, customerRef.current);
        if ("error" in ok) {
          toast.error(`Removed: ${ok.error}`);
          continue;
        }
        if (ok.price !== l.priceCents) changed++;
        next.push({ ...l, priceCents: ok.price, discountCents: Math.min(l.discountCents, ok.price) });
      }
      setCart(next);
      setStale(false);
      toast.success(changed ? `${changed} price${changed === 1 ? "" : "s"} updated — re-check the payment` : "Prices are current");
    },
    onError: (e) => toast.error(e, "Refresh failed"),
  });

  function setPay(i: number, patch: Partial<PayRow>) {
    setPays((ps) => ps.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }
  function autoBalance() {
    const rest = total - pays.slice(0, -1).reduce((s, p) => s + cents(p.amountLkr), 0);
    setPays((ps) => ps.map((p, i) => (i === ps.length - 1 ? { ...p, amountLkr: String(Math.max(0, rest) / 100) } : p)));
  }
  /** One tap: the whole bill on a single method. */
  function payAll(method: string) {
    setPays([{ method, amountLkr: total > 0 ? String(total / 100) : "" }]);
    if (method !== "cash") setTendered("");
  }

  async function cartActions() {
    const i = await chooseAction("Cart", ["Reprice from shelf", "Clear cart"], { destructiveIndex: 1 });
    if (i === 0) reprice.mutate();
    if (i === 1 && (await confirm({ title: "Clear the cart and start over?", confirmText: "Clear", destructive: true }))) resetSale();
  }

  const editing = cart.find((l) => l.productId === editLine) ?? null;

  return (
    <Screen
      footer={
        <BottomBar>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={{ flex: 1 }}>
              <Text variant="caption1" tone="secondary" num>
                {cart.length} item{cart.length === 1 ? "" : "s"} · {(netMg / 1000).toLocaleString("en-US")} g
              </Text>
              <Text variant="title2" num rounded numberOfLines={1} adjustsFontSizeToFit>
                {fmt(total)}{" "}
                <Text variant="footnote" tone="secondary">
                  LKR
                </Text>
              </Text>
            </View>
            <Button
              title={approval ? "Charge (approved)" : "Charge"}
              icon="creditCard"
              size="lg"
              disabled={cart.length === 0 || total <= 0 || stale || heldMismatch.length > 0 || !branchId}
              onPress={() => setPayOpen(true)}
              style={{ minWidth: 150 }}
            />
          </View>
        </BottomBar>
      }
    >
      <Stack.Screen
        options={{
          title: "Point of Sale",
          headerLargeTitleEnabled: false,
          headerRight: () => (cart.length > 0 ? <HeaderButton icon="more" onPress={cartActions} accessibilityLabel="Cart actions" /> : null),
        }}
      />

      {/* Scan / search bar */}
      <View style={{ marginHorizontal: GUTTER, marginTop: 12, flexDirection: "row", gap: 10, alignItems: "center" }}>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: c.card, borderRadius: radius.lg, borderCurve: "continuous", paddingHorizontal: 12, height: 50, gap: 8, borderWidth: 1.5, borderColor: c.goldSoft }}>
          <Icon name={isSearch ? "search" : "barcode"} size={18} color={c.gold} />
          <TextInput
            ref={scanRef}
            value={scan}
            onChangeText={setScan}
            onSubmitEditing={submitScan}
            placeholder={lookup.isPending ? "Looking up…" : "Scan, type a code or a product name"}
            placeholderTextColor={c.label3}
            selectionColor={c.gold}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            style={[typeScale.body, { flex: 1, color: c.label, paddingVertical: 0 }]}
          />
          {lookup.isPending ? <ActivityIndicator color={c.gold} /> : null}
        </View>
        <IconButton name="scan" variant="filled" size={50} onPress={() => setScanOpen(true)} accessibilityLabel="Scan with camera" />
      </View>

      {isSearch && q.length >= 2 ? (
        <Section>
          {catalog.isFetching && results.length === 0 ? (
            <Row title="Searching…" />
          ) : results.length === 0 ? (
            <Row title={`No piece for sale here matches "${typed}"`} />
          ) : (
            results.map((r) => (
              <Row
                key={r.id}
                icon="gem"
                title={r.name}
                subtitle={`${r.barcode} · ${r.karat} · ${r.category_name} · ${(r.net_mg / 1000).toLocaleString("en-US")} g`}
                right={
                  <View style={{ alignItems: "flex-end", gap: 3 }}>
                    {r.price_cents !== null ? (
                      <Text variant="subhead" num weight="600">
                        {fmt(r.price_cents)}
                      </Text>
                    ) : (
                      <Text variant="footnote" tone="danger">
                        No rate
                      </Text>
                    )}
                    {r.status === "RESERVED" ? (
                      <Pill tone="warning" size="sm">
                        Held
                      </Pill>
                    ) : null}
                  </View>
                }
                onPress={() => addCode(r.barcode)}
              />
            ))
          )}
        </Section>
      ) : null}

      {/* Branch */}
      <Section>
        <Row icon="building" iconColor={c.vault2} title="Branch" value={b.branch?.name ?? "None"} onPress={() => setBranchOpen(true)} />
      </Section>

      {!branchId && !b.isLoading ? (
        <Callout tone="warning" title="No branch selected" style={{ marginTop: 12 }}>
          Pick a branch before selling — stock and takings post to it.
        </Callout>
      ) : null}
      {exchange ? (
        <Callout tone="info" title={`Exchange for return ${exchange.number}`} style={{ marginTop: 12 }}>
          <View style={{ gap: 8 }}>
            <Text variant="footnote">This sale will be linked to the return. Store credit from the return is spent with the credit payment method.</Text>
            <Button title="Not an exchange" variant="gray" size="sm" onPress={() => setExchange(null)} style={{ alignSelf: "flex-start" }} />
          </View>
        </Callout>
      ) : null}
      {stale ? (
        <Callout tone="warning" title="Prices changed since these pieces were scanned" style={{ marginTop: 12 }}>
          <View style={{ gap: 8 }}>
            <Text variant="footnote">The gold rate or a selling price moved. Refresh the cart, confirm the new total with the customer, then take payment.</Text>
            <Button title={reprice.isPending ? "Refreshing…" : "Refresh prices"} icon="refresh" variant="gray" size="sm" loading={reprice.isPending} onPress={() => reprice.mutate()} style={{ alignSelf: "flex-start" }} />
          </View>
        </Callout>
      ) : null}
      {heldMismatch.length > 0 ? (
        <Callout tone="warning" title="Reserved pieces need their customer" style={{ marginTop: 12 }}>
          {`${heldMismatch.map((l) => `${l.barcode} is held for ${l.reservedFor!.name}`).join(" · ")}. Select that customer, or remove the piece — release the hold on the product page to sell it to someone else.`}
        </Callout>
      ) : null}
      {approval ? (
        <Callout tone="warning" title="Discount waiting for approval" style={{ marginTop: 12 }}>
          <View style={{ gap: 8 }}>
            <Text variant="footnote">{`A ${pct.toFixed(2)}% discount needs sign-off. Once it is approved, charge again — changing the cart cancels this request.`}</Text>
            <Button title="Approval Center" variant="gray" size="sm" onPress={() => router.push("/approvals")} style={{ alignSelf: "flex-start" }} />
          </View>
        </Callout>
      ) : null}

      {/* Cart */}
      <Section title={`Cart · ${cart.length} item${cart.length === 1 ? "" : "s"}`} footer={cart.length > 0 ? "Tap a piece to discount or remove it." : undefined}>
        {cart.length === 0 ? (
          <EmptyState compact icon="cart" title="Cart is empty" message="Scan a tag or its QR code, or type a product name above to start the sale." />
        ) : (
          cart.map((l) => (
            <Pressable key={l.productId} onPress={() => setEditLine(l.productId)}>
              {({ pressed }) => (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: pressed ? c.fill : "transparent" }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, borderCurve: "continuous", backgroundColor: c.goldSoft, alignItems: "center", justifyContent: "center" }}>
                    <Icon name="gem" size={18} color={c.goldInk} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text variant="body" weight="600" numberOfLines={1}>
                      {l.name}
                    </Text>
                    <Text variant="caption1" tone="secondary" mono numberOfLines={1}>
                      {l.barcode} · {l.karat} · {(l.netMg / 1000).toLocaleString("en-US")} g
                    </Text>
                    {l.reservedFor ? (
                      <Pill tone="warning" size="sm">
                        {`Held · ${l.reservedFor.name}`}
                      </Pill>
                    ) : null}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text variant="body" num weight="600">
                      {fmt(l.priceCents - l.discountCents + lineTax(l))}
                    </Text>
                    {l.discountCents > 0 ? (
                      <Text variant="caption1" num color={c.greenText}>
                        −{fmt(l.discountCents)} off {fmt(l.priceCents)}
                      </Text>
                    ) : (
                      <Text variant="caption1" tone="secondary" num>
                        {fmt(l.priceCents)}
                      </Text>
                    )}
                  </View>
                </View>
              )}
            </Pressable>
          ))
        )}
      </Section>

      {/* Customer */}
      <Section title="Customer" footer="Optional — required for credit.">
        {customer ? (
          <Row
            icon="personCheck"
            iconColor={c.green}
            title={customer.name}
            subtitle={[customer.code, customer.phone].filter(Boolean).join(" · ") || undefined}
            right={
              <Pressable hitSlop={10} onPress={() => setCustomer(null)} accessibilityLabel="Clear customer">
                <Icon name="closeCircle" size={20} color={c.label3} />
              </Pressable>
            }
          />
        ) : (
          <Row icon="person" iconColor={c.gray} title="Walk-in sale" value="Add" valueTone="gold" onPress={() => setCustOpen(true)} />
        )}
        {customer && credit.data ? (
          <KeyValue
            label={credit.data.balanceCents < 0 ? "Store credit" : "Owes"}
            value={
              <Text variant="body" num color={credit.data.balanceCents > 0 ? c.orangeText : c.greenText}>
                {fmt(Math.abs(credit.data.balanceCents))} LKR
              </Text>
            }
          />
        ) : null}
        {customer && credit.data && credit.data.openInvoices > 0 ? <KeyValue label="Open bills" value={`${credit.data.openInvoices} · ${fmt(credit.data.openDueCents)}`} /> : null}
        {customer && credit.data ? <KeyValue label="Credit limit" value={credit.data.creditLimitCents > 0 ? fmt(credit.data.creditLimitCents) : "No limit"} /> : null}
        {exchange ? <Row icon="swap" iconColor={c.teal} title={`Exchange for ${exchange.number}`} /> : null}
      </Section>

      <View style={{ marginHorizontal: GUTTER, marginTop: 16 }}>
        <Field label="Invoice note" value={notes} onChangeText={(v) => setNotes(v.slice(0, 500))} placeholder="Printed on the bill (optional)" multiline />
      </View>

      {/* Discount */}
      <Section title="Discount" footer="Discounts above the approval threshold go to the Approval Center instead.">
        <KeyValue label="Total discount" value={`${fmt(discount)} LKR · ${pct.toFixed(1)}%`} />
      </Section>
      <View style={{ marginHorizontal: GUTTER, marginTop: 12 }}>
        <SelectField
          label="Counter approver (over your limit)"
          value={approver}
          allowClear
          clearLabel="None"
          placeholder="None"
          disabled={Boolean(approval)}
          options={(approvers.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
          onChange={setApprover}
        />
      </View>

      {/* Totals */}
      <Section title="Summary">
        <KeyValue label="Subtotal" value={fmt(subtotal)} />
        {discount > 0 ? <KeyValue label="Discount" value={`−${fmt(discount)}`} /> : null}
        {taxRateBp > 0 ? <KeyValue label={`${taxLabel} ${(taxRateBp / 100).toFixed(2).replace(/\.00$/, "")}%`} value={fmt(tax)} /> : null}
        <KeyValue
          label="Total due"
          value={
            <Text variant="headline" num>
              {fmt(total)} LKR
            </Text>
          }
        />
      </Section>

      <ScanSheet visible={scanOpen} onClose={() => setScanOpen(false)} onCode={addCode} count={cart.length} />
      <LineSheet
        line={editing}
        lineTotal={editing ? editing.priceCents - editing.discountCents + lineTax(editing) : 0}
        onClose={() => setEditLine(null)}
        onDiscount={(d) => setCart((cur) => cur.map((l) => (l.productId === editLine ? { ...l, discountCents: d } : l)))}
        onRemove={() => setCart((cur) => cur.filter((l) => l.productId !== editLine))}
      />
      <CustomerSheet visible={custOpen} onClose={() => setCustOpen(false)} onPick={setCustomer} />
      <OptionSheet
        visible={branchOpen}
        onClose={() => setBranchOpen(false)}
        title="Branch"
        value={branchId}
        options={b.branches.map((br) => ({ value: br.id, label: br.name, subtitle: br.code }))}
        onPick={(id) => {
          if (id) b.setBranchId(id);
          setBranchOpen(false);
        }}
      />
      <PaymentSheet
        visible={payOpen}
        onClose={() => setPayOpen(false)}
        total={total}
        subtotal={subtotal}
        discount={discount}
        tax={tax}
        taxRateBp={taxRateBp}
        taxLabel={taxLabel}
        pays={pays}
        setPay={setPay}
        setPays={setPays}
        payAll={payAll}
        autoBalance={autoBalance}
        tendered={tendered}
        setTendered={setTendered}
        cashDue={cashDue}
        change={change}
        paidSum={paidSum}
        creditDue={creditDue}
        customer={customer}
        storeCredit={storeCredit}
        needsCustomer={needsCustomer}
        needsBank={needsBank}
        overLimit={overLimit}
        creditLimitCents={credit.data?.creditLimitCents ?? 0}
        bankRows={bankRows}
        canComplete={canComplete && !complete.isPending}
        completing={complete.isPending}
        approved={!!approval}
        onComplete={() => complete.mutate()}
      />
      <DoneSheet done={done} onClose={() => setDone(null)} />
    </Screen>
  );
}

