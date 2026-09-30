"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { salesTaxCents } from "@goldos/shared";
import { api, errorCode, PendingApprovalError } from "@/lib/api";
import { extractScanCode, looksLikeCode } from "@/lib/barcode";
import { cn } from "@/lib/cn";
import { CameraScanButton } from "@/components/camera-scan";
import {
  Page,
  Hero,
  Panel,
  TableCard,
  EmptyBlock,
  Callout,
  Pill,
  Modal,
  controlClass,
  controlSmClass,
} from "@/components/ui";
import {
  PlusIcon,
  ScanBarcodeIcon,
  SearchIcon,
  TrashIcon,
  UserCheckIcon,
  TagsIcon,
  CreditCardIcon,
  RefreshCwIcon,
  XIcon,
  PrinterIcon,
  ArrowLeftRightIcon,
  FileTextIcon,
  CheckCircleIcon,
} from "@/components/icons";

type Lookup = {
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

type CatalogRow = {
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

type CartLine = {
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

type PayRow = { method: string; amountLkr: string; bankAccountId?: string };

type Customer = { id: string; name: string; code: string; phone?: string | null };

type CustomerCredit = {
  balanceCents: number;
  branchBalanceCents: number;
  creditLimitCents: number;
  openInvoices: number;
  openDueCents: number;
};

type BankAccount = { id: string; name: string; bank_name: string | null; account_number: string | null };

/** The replacement half of an exchange, handed over from the invoice page. */
type Exchange = { returnId: string; number: string };

type Pending = { approvalId: string; entityId: string; sig: string };

type Draft = { cart: CartLine[]; customer: Customer | null; exchange: Exchange | null; notes?: string };

type Done = { invoiceId: string; number: string; totalCents: number; changeCents: number | null; customer: string | null };

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return (
    document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? ""
  );
}

const METHODS = ["cash", "card", "bank", "credit", "other"];
const DRAFT_KEY = "goldos-pos-draft";
const fmt = (c: number) => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const cents = (lkr: string) => Math.round(Number(lkr || 0) * 100);

/**
 * The shelf price the server will charge, or why the piece cannot be sold
 * here. Mirrors the checkout guards so a bad scan is caught at the counter,
 * not after the whole cart and payment have been keyed in.
 */
function saleable(d: Lookup, branchId: string, customer: Customer | null): { price: number } | { error: string } {
  const p = d.product;
  if (p.status === "RESERVED") {
    if (customer && customer.id !== p.reserved_customer_id)
      return { error: `${p.barcode} is held for ${p.reserved_customer_name ?? "another customer"}` };
  } else if (p.status !== "IN_STOCK")
    return { error: `${p.barcode} is ${p.status.replace(/_/g, " ").toLowerCase()}, not for sale` };
  if (branchId && p.branch_id !== branchId) return { error: `${p.barcode} belongs to another branch` };
  if (p.cost_cents === null) return { error: `${p.barcode} has no book cost — set its cost before selling` };
  const price = p.selling_price_cents ?? d.livePrice?.amount_cents;
  if (price === undefined) return { error: `No gold rate for ${p.karat} — set today's rate first` };
  return { price };
}

const lookupCode = (code: string) => api<Lookup>(`/api/v1/products/barcode/${encodeURIComponent(code)}`);

/** Debounce a fast-changing value (typed search) before it hits the API. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function PosPage() {
  const [scan, setScan] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [approver, setApprover] = useState("");
  const [pays, setPays] = useState<PayRow[]>([{ method: "cash", amountLkr: "" }]);
  const [tendered, setTendered] = useState("");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [stale, setStale] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const scanRef = useRef<HTMLInputElement>(null);
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const customerRef = useRef(customer);
  customerRef.current = customer;
  const [branchId] = useState(branchDefault);

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
  const showResults = searchOpen && isSearch && q.length >= 2;

  const customers = useQuery({
    queryKey: ["pos-customers", customerSearch],
    queryFn: () =>
      api<{ rows: Customer[]; total: number }>(
        `/api/v1/customers?search=${encodeURIComponent(customerSearch)}&limit=8`
      ),
    enabled: customerSearch.trim().length > 0,
  });

  const credit = useQuery({
    queryKey: ["pos-customer-credit", customer?.id, branchId],
    queryFn: () =>
      api<CustomerCredit>(`/api/v1/sales/customers/${encodeURIComponent(customer!.id)}/credit?branchId=${encodeURIComponent(branchId)}`),
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

  function refocus() {
    setScan("");
    setSearchOpen(false);
    setHighlight(0);
    scanRef.current?.focus();
  }

  const lookup = useMutation({
    mutationFn: lookupCode,
    onSuccess: (d) => {
      const ok = saleable(d, branchId, customerRef.current);
      if ("error" in ok) {
        toast.error(ok.error);
        return refocus();
      }
      const held =
        d.product.status === "RESERVED" && d.product.reserved_customer_id
          ? { id: d.product.reserved_customer_id, name: d.product.reserved_customer_name ?? "Customer" }
          : undefined;
      // A held piece names its buyer: put them on the sale rather than make
      // the cashier look them up.
      if (held && !customerRef.current) {
        setCustomer({ id: held.id, name: held.name, code: "" });
        toast.message(`${d.product.barcode} is held for ${held.name} — customer set`);
      }
      if (cartRef.current.some((l) => l.productId === d.product.id)) {
        toast.error(`${d.product.barcode} is already in the cart`);
        return refocus();
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
      setCart((c) => (c.some((l) => l.productId === line.productId) ? c : [...c, line]));
      setDone(null);
      refocus();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Lookup failed");
      refocus();
    },
  });

  function addCode(raw: string) {
    // A QR tag may carry a link or JSON around the code.
    const code = extractScanCode(raw);
    if (!code) return;
    if (code.startsWith("SINV-")) {
      toast.error(`${code} is an invoice — open it from Sales › Invoices to return or reprint`);
      return refocus();
    }
    // Saves a round trip for the commonest slip: scanning the same tag twice.
    if (cartRef.current.some((l) => l.barcode === code)) {
      toast.error(`${code} is already in the cart`);
      return refocus();
    }
    lookup.mutate(code);
  }

  function submitScan() {
    if (isSearch) {
      const pick = results[highlight] ?? results[0];
      if (pick) return addCode(pick.barcode);
      if (catalog.isFetching || q !== typed) return; // results still coming
      toast.error(`No piece for sale matches "${typed}"`);
      return;
    }
    addCode(scan);
  }

  // Restore an unfinished sale (a refresh must not lose a keyed-in cart),
  // then take hand-offs from other screens: ?add=<tag> from the scan and
  // product pages, ?exchange=<return> from an invoice's exchange return.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Draft;
        setCart(d.cart ?? []);
        setCustomer(d.customer ?? null);
        setExchange(d.exchange ?? null);
        setNotes(d.notes ?? "");
      }
    } catch {
      // Storage blocked or draft corrupt: start clean.
    }
    const qs = new URLSearchParams(window.location.search);
    const ex = qs.get("exchange");
    if (ex) {
      setExchange({ returnId: ex, number: qs.get("exchangeNo") ?? "exchange" });
      const cid = qs.get("customerId");
      if (cid) setCustomer({ id: cid, name: qs.get("customerName") ?? "Customer", code: qs.get("customerCode") ?? "" });
    }
    const add = qs.get("add");
    if (ex || add) window.history.replaceState(null, "", "/pos");
    setLoaded(true);
    if (add) addCode(add);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      if (cart.length === 0 && !customer && !exchange && !notes) window.sessionStorage.removeItem(DRAFT_KEY);
      else window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ cart, customer, exchange, notes } satisfies Draft));
    } catch {
      // A draft is a convenience; the sale itself does not depend on it.
    }
  }, [cart, customer, exchange, notes, loaded]);

  // Same per-line rounding as the server, so the total the cashier asks for
  // is exactly the total the API will accept.
  const taxConfig = useQuery({
    queryKey: ["pos-tax-config"],
    queryFn: () => api<{ rateBp: number; label: string }>("/api/v1/sales/tax-config"),
    staleTime: 5 * 60_000,
  });
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
  const overLimit =
    creditDue > 0 &&
    credit.data &&
    credit.data.creditLimitCents > 0 &&
    credit.data.balanceCents + creditDue > credit.data.creditLimitCents;

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
    setCustomerSearch("");
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
          items: cart.map((l) => ({
            productId: l.productId,
            priceLkr: l.priceCents / 100,
            discountLkr: l.discountCents / 100,
          })),
          payments: pays.map((p) => ({
            method: p.method,
            amountLkr: Number(p.amountLkr),
            // One bank account needs no choosing; several do (needsBank).
            bankAccountId:
              p.method === "bank" ? p.bankAccountId || (bankRows.length === 1 ? bankRows[0]!.id : undefined) : undefined,
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
      setDone({
        invoiceId: d.invoiceId,
        number: d.number,
        totalCents: total,
        changeCents: change !== null && change > 0 ? change : null,
        customer: customer?.name ?? null,
      });
      resetSale();
      toast.success(`Sale ${d.number} complete`);
    },
    onError: (e) => {
      if (e instanceof PendingApprovalError && e.approvalId) {
        setPending({ approvalId: e.approvalId, entityId: e.entityId ?? "", sig });
        toast.message("Discount sent for approval", {
          description: "Once a manager approves it in the Approval Center, complete the sale again.",
        });
        return;
      }
      if (errorCode(e) === "CONFLICT" && e instanceof Error && e.message.includes("refresh the cart")) setStale(true);
      toast.error(e instanceof Error ? e.message : "Sale failed");
    },
  });

  // Reprice every line from the shelf. Pieces that can no longer be sold here
  // (sold at another till, moved, rate withdrawn) drop out with a reason.
  const refresh = useMutation({
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
    onError: (e) => toast.error(e instanceof Error ? e.message : "Refresh failed"),
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F2") {
        e.preventDefault();
        scanRef.current?.focus();
      }
      if (e.key === "F9") {
        e.preventDefault();
        document.getElementById("pos-pay-0")?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function setLine(i: number, patch: Partial<CartLine>) {
    setCart((c) => c.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

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

  return (
    <Page>
      <Hero
        kicker="Sales"
        title="Point of sale"
        description="Scan a tag or QR, or type a product name. Apply discounts, split payments, print the bill."
        note="F2 scan / search · ↑↓ pick · F9 pay · Enter completes the sale"
        meta={
          <>
            <Pill tone="ghost" className="!text-paper">{cart.length} item{cart.length === 1 ? "" : "s"}</Pill>
            <Pill tone="ghost" className="!text-paper">{(netMg / 1000).toLocaleString("en-US")} g net</Pill>
            <Pill tone="ghost" className="!text-paper">{fmt(total)} LKR due</Pill>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitScan();
          }}
          className="relative mt-6 flex items-start gap-2"
        >
          <div className="relative flex-1">
            {isSearch ? (
              <SearchIcon size={18} className="pointer-events-none absolute left-4 top-[19px] text-gold" />
            ) : (
              <ScanBarcodeIcon size={18} className="pointer-events-none absolute left-4 top-[19px] text-gold" />
            )}
            <input
              ref={scanRef}
              autoFocus
              value={scan}
              onChange={(e) => {
                setScan(e.target.value);
                setSearchOpen(true);
                setHighlight(0);
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              onKeyDown={(e) => {
                if (!showResults || results.length === 0) return;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlight((h) => Math.min(h + 1, results.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlight((h) => Math.max(h - 1, 0));
                } else if (e.key === "Escape") {
                  setSearchOpen(false);
                }
              }}
              placeholder={lookup.isPending ? "Looking up…" : "Scan barcode / QR, or type a product name…"}
              autoComplete="off"
              role="combobox"
              aria-expanded={showResults}
              aria-controls="pos-results"
              aria-label="Scan barcode or search products"
              className="h-13 w-full rounded-xl bg-paper/10 py-3.5 pl-11 pr-4 font-mono text-lg text-paper placeholder:font-sans placeholder:text-paper/35 shadow-[inset_0_0_0_1px_rgba(201,162,39,0.45)] transition-shadow focus:outline-none focus:shadow-[inset_0_0_0_2px_#C9A227,0_0_0_4px_rgba(201,162,39,0.2)]"
            />
            {showResults ? (
              <ul
                id="pos-results"
                role="listbox"
                // In flow, not absolute: the hero card clips overflow, and the
                // list pushing the page down keeps every match visible.
                className="mt-2 max-h-80 overflow-y-auto rounded-xl bg-paper p-1.5 text-ink shadow-4 ring-1 ring-ink/10 scrollbar-thin"
              >
                {catalog.isFetching && results.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-ink-4">Searching…</li>
                ) : results.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-ink-4">No piece for sale here matches “{typed}”.</li>
                ) : (
                  results.map((r, i) => (
                    <li key={r.id} role="option" aria-selected={i === highlight}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => addCode(r.barcode)}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                          i === highlight ? "bg-gold-pale" : "hover:bg-bone"
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">
                            {r.name}
                            {r.status === "RESERVED" ? <Pill tone="warning" className="ml-2">Held</Pill> : null}
                          </span>
                          <span className="block truncate text-xs text-ink-4">
                            <span className="font-mono">{r.barcode}</span> · {r.karat} · {r.category_name} · {(r.net_mg / 1000).toLocaleString("en-US")} g
                          </span>
                        </span>
                        <span className="shrink-0 text-right num-tabular text-sm font-semibold text-ink">
                          {r.price_cents !== null ? `${fmt(r.price_cents)}` : <span className="text-rose-600">No rate</span>}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
          <CameraScanButton onDetected={addCode} tone="dark" className="h-14 rounded-xl" />
          <button type="submit" className="g-btn h-14 rounded-xl bg-gold px-5 text-sm font-medium text-ink transition-colors hover:bg-gold-light">
            Add
          </button>
        </form>
      </Hero>

      {!branchId ? (
        <Callout tone="warning" title="No branch selected">
          Pick a branch in the header before selling — stock and takings post to it.
        </Callout>
      ) : null}

      {exchange ? (
        <Callout
          tone="info"
          title={`Exchange for return ${exchange.number}`}
          action={
            <button onClick={() => setExchange(null)} className="g-btn g-btn-secondary h-8 px-3 text-xs">
              Not an exchange
            </button>
          }
        >
          This sale will be linked to the return. Store credit from the return is spent with the <b>credit</b> payment method.
        </Callout>
      ) : null}

      {stale ? (
        <Callout
          tone="warning"
          title="Prices changed since these pieces were scanned"
          action={
            <button onClick={() => refresh.mutate()} disabled={refresh.isPending} className="g-btn g-btn-secondary h-8 px-3 text-xs">
              <RefreshCwIcon size={12} /> {refresh.isPending ? "Refreshing…" : "Refresh prices"}
            </button>
          }
        >
          The gold rate or a selling price moved. Refresh the cart, confirm the new total with the customer, then take payment.
        </Callout>
      ) : null}

      {heldMismatch.length > 0 ? (
        <Callout tone="warning" title="Reserved pieces need their customer">
          {heldMismatch.map((l) => `${l.barcode} is held for ${l.reservedFor!.name}`).join(" · ")}. Select that customer,
          or remove the piece — release the hold on the product page to sell it to someone else.
        </Callout>
      ) : null}

      {approval ? (
        <Callout
          tone="warning"
          title="Discount waiting for approval"
          action={
            <Link href="/approvals" className="g-btn g-btn-secondary h-8 px-3 text-xs">
              Approval Center
            </Link>
          }
        >
          A {pct.toFixed(2)}% discount needs sign-off. Once it is approved, press <b>Complete sale</b> again —
          changing the cart cancels this request.
        </Callout>
      ) : null}

      <TableCard
        title="Cart"
        icon={<ScanBarcodeIcon size={17} />}
        description={`${cart.length} item${cart.length === 1 ? "" : "s"}`}
        actions={
          <span className="flex items-center gap-3">
            {cart.length > 0 ? (
              <>
                <button onClick={() => refresh.mutate()} disabled={refresh.isPending} className="g-btn g-btn-secondary h-8 px-2.5 text-xs">
                  <RefreshCwIcon size={12} /> Reprice
                </button>
                <button
                  onClick={() => {
                    if (window.confirm("Clear the cart and start over?")) resetSale();
                  }}
                  className="g-btn g-btn-secondary h-8 px-2.5 text-xs"
                >
                  Clear
                </button>
              </>
            ) : null}
            <span className="g-metric text-[11px] font-medium uppercase tracking-[0.14em] text-ink-4">{fmt(total)} LKR due</span>
          </span>
        }
      >
        {cart.length === 0 ? (
          <EmptyBlock title="Cart is empty" description="Scan a tag or its QR code, or type a product name above to start the sale." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Barcode</th>
                <th>Item</th>
                <th className="!text-right">Net g</th>
                <th className="!text-right">Price</th>
                <th className="!text-right">Discount</th>
                <th className="!text-right">Line total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cart.map((l, i) => (
                <tr key={l.productId}>
                  <td className="g-metric text-xs">{l.barcode}</td>
                  <td className="font-medium text-ink">
                    {l.name} <span className="text-ink-4">· {l.karat}</span>
                    {l.reservedFor ? (
                      <Pill tone="warning" className="ml-2">Held · {l.reservedFor.name}</Pill>
                    ) : null}
                  </td>
                  <td className="!text-right num-tabular">{(l.netMg / 1000).toLocaleString("en-US")}</td>
                  <td className="!text-right num-tabular">{fmt(l.priceCents)}</td>
                  <td className="!text-right">
                    <input
                      type="number"
                      step="any"
                      min={0}
                      max={l.priceCents / 100}
                      value={l.discountCents / 100}
                      aria-label={`Discount on ${l.barcode}`}
                      onChange={(e) =>
                        setLine(i, {
                          discountCents: Math.min(l.priceCents, Math.max(0, cents(e.target.value))),
                        })
                      }
                      className={`${controlSmClass} w-24 !text-right num-tabular`}
                    />
                  </td>
                  <td className="!text-right num-tabular font-medium text-ink">
                    {fmt(l.priceCents - l.discountCents + lineTax(l))}
                  </td>
                  <td className="!text-right">
                    <button
                      onClick={() => setCart((c) => c.filter((_, j) => j !== i))}
                      aria-label={`Remove ${l.barcode}`}
                      className="inline-flex size-7 items-center justify-center rounded-md text-rose-600 transition-colors hover:bg-rose-50"
                    >
                      <TrashIcon size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Panel title="Customer" icon={<UserCheckIcon size={17} />} description="Optional — required for credit">
          {customer ? (
            <>
              <div className="flex items-center justify-between gap-2 rounded-lg bg-ink/[0.04] px-3 py-2.5">
                <span className="text-sm">
                  <span className="font-medium text-ink">{customer.name}</span>
                  {customer.code ? <span className="g-metric ml-2 text-xs text-ink-4">{customer.code}</span> : null}
                  {customer.phone ? <span className="block text-xs text-ink-4">{customer.phone}</span> : null}
                </span>
                <button
                  onClick={() => setCustomer(null)}
                  aria-label="Clear customer"
                  className="inline-flex size-7 items-center justify-center rounded-md text-ink-4 transition-colors hover:bg-ink/[0.06] hover:text-ink"
                >
                  <XIcon size={14} />
                </button>
              </div>
              {credit.data ? (
                <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs num-tabular">
                  <dt className="text-ink-4">{credit.data.balanceCents < 0 ? "Store credit" : "Owes"}</dt>
                  <dd className={cn("text-right font-medium", credit.data.balanceCents > 0 ? "text-amber-700" : "text-emerald-700")}>
                    {fmt(Math.abs(credit.data.balanceCents))} LKR
                  </dd>
                  {credit.data.openInvoices > 0 ? (
                    <>
                      <dt className="text-ink-4">Open bills</dt>
                      <dd className="text-right text-ink">{credit.data.openInvoices} · {fmt(credit.data.openDueCents)}</dd>
                    </>
                  ) : null}
                  <dt className="text-ink-4">Credit limit</dt>
                  <dd className="text-right text-ink">{credit.data.creditLimitCents > 0 ? fmt(credit.data.creditLimitCents) : "No limit"}</dd>
                </dl>
              ) : null}
            </>
          ) : (
            <>
              <input
                placeholder="Search name or phone…"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className={`w-full ${controlClass}`}
              />
              {customerSearch.trim() ? (
                <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto scrollbar-thin">
                  {(customers.data?.rows ?? []).map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => {
                          setCustomer(c);
                          setCustomerSearch("");
                        }}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-ink-2 transition-colors hover:bg-ink/[0.05]"
                      >
                        <span>
                          {c.name}
                          {c.phone ? <span className="ml-2 text-xs text-ink-4">{c.phone}</span> : null}
                        </span>
                        <span className="g-metric text-xs text-ink-4">{c.code}</span>
                      </button>
                    </li>
                  ))}
                  {customers.data && customers.data.rows.length === 0 ? (
                    <li className="px-2 py-1.5 text-sm text-ink-4">
                      No match. <Link href="/customers" className="underline">Add a customer</Link>
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-ink-4">Walk-in sale</p>
              )}
            </>
          )}
          {exchange ? (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-3">
              <ArrowLeftRightIcon size={12} /> Exchange for {exchange.number}
            </p>
          ) : null}
          <label className="mt-4 block text-sm text-ink-2">Invoice note
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 500))}
              rows={2}
              placeholder="Printed on the bill (optional)"
              className={`mt-1 w-full resize-none ${controlClass} !h-auto py-2`}
            />
          </label>
        </Panel>
        <Panel title="Discount" icon={<TagsIcon size={17} />} description={`${pct.toFixed(1)}% of subtotal`}>
          <p className="num-tabular text-lg font-semibold text-ink">{fmt(discount)} LKR</p>
          <label className="mt-3 block text-sm text-ink-2">Counter approver (over your limit)
            <select
              value={approver}
              onChange={(e) => setApprover(e.target.value)}
              disabled={Boolean(approval)}
              className={`mt-1 w-full ${controlClass}`}
            >
              <option value="">None</option>
              {(approvers.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-xs text-ink-4">
            Discounts above the approval threshold go to the Approval Center instead.
          </p>
        </Panel>
        <Panel title="Payment" icon={<CreditCardIcon size={17} />} description={`Total ${fmt(total)} LKR`}>
          <dl className="mb-2 grid grid-cols-2 gap-y-1 text-sm num-tabular">
            <dt className="text-ink-3">Subtotal</dt>
            <dd className="text-right text-ink">{fmt(subtotal)}</dd>
            {discount > 0 ? (
              <>
                <dt className="text-ink-3">Discount</dt>
                <dd className="text-right text-ink">−{fmt(discount)}</dd>
              </>
            ) : null}
            {taxRateBp > 0 ? (
              <>
                <dt className="text-ink-3">{taxLabel} {(taxRateBp / 100).toFixed(2).replace(/\.00$/, "")}%</dt>
                <dd className="text-right text-ink">{fmt(tax)}</dd>
              </>
            ) : null}
            <dt className="font-medium text-ink">Total due</dt>
            <dd className="text-right font-semibold text-ink">{fmt(total)}</dd>
          </dl>
          {total > 0 ? (
            <div className="mb-1 flex flex-wrap gap-1.5">
              {["cash", "card", "bank", ...(customer ? ["credit"] : [])].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => payAll(m)}
                  className="g-btn g-btn-secondary h-7 px-2.5 text-[11px] capitalize"
                >
                  All {m}
                </button>
              ))}
            </div>
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canComplete && !complete.isPending) complete.mutate();
            }}
          >
            {pays.map((p, i) => (
              <div key={i} className="mt-2">
                <div className="flex gap-2">
                  <select
                    value={p.method}
                    onChange={(e) => setPay(i, { method: e.target.value, bankAccountId: undefined })}
                    className={cn(controlClass, "capitalize")}
                    aria-label="Payment method"
                  >
                    {METHODS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <input
                    id={i === 0 ? "pos-pay-0" : undefined}
                    type="number"
                    step="any"
                    min={0}
                    placeholder="Amount"
                    value={p.amountLkr}
                    onChange={(e) => setPay(i, { amountLkr: e.target.value })}
                    onFocus={() => {
                      // A single payment row is almost always the whole bill.
                      if (pays.length === 1 && !p.amountLkr && total > 0) setPay(0, { amountLkr: String(total / 100) });
                    }}
                    className={`num-tabular min-w-0 flex-1 ${controlClass}`}
                  />
                  {pays.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setPays((ps) => ps.filter((_, j) => j !== i))}
                      aria-label="Remove payment"
                      className="inline-flex size-9 shrink-0 items-center justify-center self-center rounded-md text-ink-4 transition-colors hover:bg-ink/[0.06]"
                    >
                      <XIcon size={14} />
                    </button>
                  ) : null}
                </div>
                {p.method === "bank" && bankRows.length > 1 ? (
                  <select
                    value={p.bankAccountId ?? ""}
                    onChange={(e) => setPay(i, { bankAccountId: e.target.value || undefined })}
                    aria-label="Bank account"
                    className={cn(controlClass, "mt-1.5 w-full", !p.bankAccountId && "ring-1 ring-amber-400")}
                  >
                    <option value="">Which bank account?</option>
                    {bankRows.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}{b.bank_name ? ` · ${b.bank_name}` : ""}{b.account_number ? ` ${b.account_number}` : ""}
                      </option>
                    ))}
                  </select>
                ) : p.method === "bank" && bankRows.length === 1 ? (
                  <p className="mt-1 text-xs text-ink-4">Into {bankRows[0]!.name}</p>
                ) : null}
              </div>
            ))}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setPays((ps) => [...ps, { method: "card", amountLkr: "" }])}
                className="g-btn g-btn-secondary h-8 px-2.5 text-xs"
              >
                <PlusIcon size={12} /> Split
              </button>
              <button type="button" onClick={autoBalance} className="g-btn g-btn-secondary h-8 px-2.5 text-xs">
                Auto-balance last
              </button>
            </div>
            {cashDue > 0 ? (
              <label className="mt-3 block text-sm text-ink-2">Cash tendered
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={tendered}
                  onChange={(e) => setTendered(e.target.value)}
                  placeholder={fmt(cashDue)}
                  className={`mt-1 w-full num-tabular ${controlClass}`}
                />
                {change !== null ? (
                  <span className={`mt-1 block num-tabular text-sm ${change < 0 ? "text-rose-600" : "font-semibold text-ink"}`}>
                    {change < 0 ? `Short ${fmt(-change)} LKR` : `Change ${fmt(change)} LKR`}
                  </span>
                ) : null}
              </label>
            ) : null}
            <p className={`mt-3 num-tabular text-sm ${paidSum === total && total > 0 ? "font-semibold text-emerald-700" : "text-ink-3"}`}>
              Paid {fmt(paidSum)} / {fmt(total)}
              {paidSum !== total && total > 0 ? ` · ${paidSum > total ? "over" : "short"} ${fmt(Math.abs(total - paidSum))}` : ""}
            </p>
            {creditDue > 0 && customer ? (
              <p className="mt-1 text-xs text-ink-3">
                {fmt(creditDue)} LKR on {customer.name}&apos;s account
                {storeCredit > 0 ? ` — ${fmt(Math.min(storeCredit, creditDue))} from store credit` : ""}.
              </p>
            ) : null}
            {needsCustomer ? <p className="mt-1 text-xs text-rose-600">Credit needs a customer.</p> : null}
            {needsBank ? <p className="mt-1 text-xs text-rose-600">Choose the bank account the payment went into.</p> : null}
            {overLimit ? (
              <p className="mt-1 text-xs text-rose-600">
                Over {customer?.name}&apos;s credit limit of {fmt(credit.data!.creditLimitCents)} LKR — take more now or collect the balance first.
              </p>
            ) : null}
            <button
              type="submit"
              disabled={complete.isPending || !canComplete}
              className="g-btn g-btn-primary mt-3 h-11 w-full text-sm"
            >
              {complete.isPending ? "Posting…" : approval ? "Complete approved sale (Enter)" : "Complete sale (Enter)"}
            </button>
          </form>
        </Panel>
      </div>

      {done ? (
        <Modal
          kicker="Sale complete"
          title={
            <span className="flex items-center gap-2">
              <CheckCircleIcon size={20} className="text-emerald-600" /> {done.number}
            </span>
          }
          onClose={() => {
            setDone(null);
            scanRef.current?.focus();
          }}
          footer={false}
        >
          <dl className="grid grid-cols-2 gap-y-1.5 rounded-xl bg-bone p-4 text-sm num-tabular ring-1 ring-ink/[0.06]">
            <dt className="text-ink-3">Customer</dt>
            <dd className="text-right text-ink">{done.customer ?? "Walk-in"}</dd>
            <dt className="text-ink-3">Total</dt>
            <dd className="text-right text-lg font-semibold text-ink">{fmt(done.totalCents)} LKR</dd>
            {done.changeCents ? (
              <>
                <dt className="text-ink-3">Change to give</dt>
                <dd className="text-right text-lg font-semibold text-emerald-700">{fmt(done.changeCents)} LKR</dd>
              </>
            ) : null}
          </dl>
          <p className="text-xs text-ink-4">
            Posted to the ledger — sales, tax, stock and the money accounts are updated.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Link href={`/sales/invoices/${done.invoiceId}/print?format=receipt&auto=1`} className="g-btn g-btn-secondary h-11 text-sm">
              <PrinterIcon size={15} /> Receipt 80mm
            </Link>
            <Link href={`/sales/invoices/${done.invoiceId}/print?auto=1`} className="g-btn g-btn-primary h-11 text-sm">
              <FileTextIcon size={15} /> A4 invoice
            </Link>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Link href={`/sales/invoices/${done.invoiceId}`} className="text-sm font-medium text-ink-3 underline hover:text-ink">
              Open sale
            </Link>
            <button
              autoFocus
              onClick={() => {
                setDone(null);
                scanRef.current?.focus();
              }}
              className="g-btn g-btn-secondary h-9 px-4 text-sm"
            >
              New sale
            </button>
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}
