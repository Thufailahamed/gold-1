"use client";

import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { PERMISSIONS, hasPermission, salesTaxCents } from "@goldos/shared";
import { api, errorCode, type MeData } from "@/lib/api";
import { extractScanCode, looksLikeCode } from "@/lib/barcode";
import { cn } from "@/lib/cn";
import { CameraScanButton } from "@/components/camera-scan";
import { Select } from "@/components/select";
import { BranchSwitcher } from "@/components/branch-switcher";
import { SALES_PAGES } from "@/components/module-nav";
import { OldGoldExchange, type ExchangePayout, type NewOldGold, type ValuedOldGold } from "./old-gold-exchange";
import {
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
  BanknoteIcon,
  LandmarkIcon,
  FileCheckIcon,
  WalletIcon,
  LogOutIcon,
  MaximizeIcon,
  MinimizeIcon,
} from "@/components/icons";

/** A keyboard shortcut hint, styled as a key cap. */
function Kbd({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 font-mono text-[10px] font-semibold leading-none",
        dark
          ? "bg-paper/10 text-paper/80 shadow-[inset_0_-1px_0_rgba(255,255,255,0.12),inset_0_0_0_1px_rgba(255,255,255,0.08)]"
          : "bg-paper text-ink-3 shadow-[inset_0_-1px_0_rgba(16,32,27,0.12),inset_0_0_0_1px_rgba(16,32,27,0.1)]"
      )}
    >
      {children}
    </kbd>
  );
}

/** One live figure in the terminal header. */
function HeaderStat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="min-w-0 px-4 py-2.5 first:pl-0 sm:px-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-paper/45">{label}</p>
      <p className={cn("num-tabular mt-0.5 truncate font-semibold", accent ? "text-xl text-gold-light" : "text-lg text-paper")}>
        {value}
      </p>
    </div>
  );
}

const METHOD_ICON: Record<string, (p: { size?: number }) => React.ReactNode> = {
  cash: BanknoteIcon,
  cheque: FileCheckIcon,
  card: CreditCardIcon,
  bank: LandmarkIcon,
  credit: WalletIcon,
};

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
  /** The price charged — the cashier may move it off the shelf price. */
  priceCents: number;
  /** The shelf price at scan time; the server checks it is still current. */
  listPriceCents: number;
  discountCents: number;
  /** Set when the piece is held: it sells only to this customer. */
  reservedFor?: { id: string; name: string };
};

type PayRow = { method: string; amountLkr: string; bankAccountId?: string; chequeNo?: string; chequeBank?: string };

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


/** Old gold ticked for a customer. Kept against the customer id so it cannot follow a different customer. */
type OldSel = { customerId: string; ids: string[] };

/** A piece taken in at the counter that is not on record yet: it is saved only when the sale completes. */
type PendingOld = { key: string; grossG: number; valueCents: number };
type PendingState = { customerId: string; items: PendingOld[] };

type Draft = {
  cart: CartLine[];
  customer: Customer | null;
  exchange: Exchange | null;
  notes?: string;
  oldSel?: OldSel;
  pendingOld?: PendingState;
  payout?: ExchangePayout;
};

type Done = {
  invoiceId: string;
  number: string;
  totalCents: number;
  changeCents: number | null;
  customer: string | null;
  /** Set for an old-gold exchange: the old gold taken in, and the balance the counter settled. */
  exchange?: { oldGoldCents: number; balanceCents: number; payout: ExchangePayout };
};

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return (
    document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? ""
  );
}

const METHODS = ["cash", "cheque", "card", "bank", "credit", "other"];
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
  // The price set when the piece was created; a piece without one falls back to the live rate.
  const price = p.selling_price_cents !== null && p.selling_price_cents > 0 ? p.selling_price_cents : d.livePrice?.amount_cents;
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
  const [newCust, setNewCust] = useState<{ name: string; phone: string; address: string } | null>(null);
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [oldSel, setOldSel] = useState<OldSel>({ customerId: "", ids: [] });
  const [pendingOld, setPendingOld] = useState<PendingState>({ customerId: "", items: [] });
  // What is left after the bill: clears the customer's open bills (default), or is paid out in cash.
  const [payout, setPayout] = useState<ExchangePayout>("store_credit");
  const [pays, setPays] = useState<PayRow[]>([{ method: "cash", amountLkr: "" }]);
  const [tendered, setTendered] = useState("");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [stale, setStale] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const scanRef = useRef<HTMLInputElement>(null);
  const autoAmount = useRef(false);
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const customerRef = useRef(customer);
  customerRef.current = customer;
  const [branchId, setBranchId] = useState(branchDefault);
  // Set after mount so the server render and the first client render agree.
  const [clock, setClock] = useState<Date | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // The terminal covers the console shell; the page behind it must not scroll.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setClock(new Date());
    const t = setInterval(() => setClock(new Date()), 15_000);
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.body.style.overflow = prev;
      clearInterval(t);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  useEffect(() => {
    if (!branchId) {
      api<{ rows: { id: string }[] }>("/api/v1/branches?limit=100")
        .then((d) => {
          const first = d.rows[0]?.id;
          if (first) {
            setBranchId(first);
            document.cookie = `goldos_branch=${first}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`;
          }
        })
        .catch(() => undefined);
    }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail) setBranchId(detail);
      else setBranchId(branchDefault());
    };
    window.addEventListener("goldos-branch-changed", handler);
    return () => window.removeEventListener("goldos-branch-changed", handler);
  }, [branchId]);

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

  // An exchange buys old gold and sells new pieces in one batch, so the till
  // needs both the old-gold view and edit permissions to offer it.
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canExchange =
    hasPermission(me.data?.permissions ?? [], PERMISSIONS.OLDGOLD_VIEW) && hasPermission(me.data?.permissions ?? [], PERMISSIONS.OLDGOLD_EDIT);
  // Taking a new piece in at the till also creates it, so it needs the create permission too.
  const canCreate = canExchange && hasPermission(me.data?.permissions ?? [], PERMISSIONS.OLDGOLD_CREATE);
  // The customer's valued old gold at this branch: the only pieces that can be taken in.
  const valued = useQuery({
    queryKey: ["pos-oldgold-valued", branchId, customer?.id ?? ""],
    queryFn: () =>
      api<{ rows: ValuedOldGold[]; total: number }>(
        `/api/v1/oldgold/items?customerId=${encodeURIComponent(customer!.id)}&status=VALUED&branchId=${encodeURIComponent(branchId)}&limit=50`
      ),
    enabled: canExchange && Boolean(customer?.id) && Boolean(branchId),
    retry: false,
  });

  // A piece taken in at the counter is only held here until the sale completes:
  // the server records it in the same batch as the sale, so a sale that is not
  // completed leaves nothing on the old-gold record.
  function addPending(v: NewOldGold) {
    if (!customer) return;
    const item: PendingOld = { key: crypto.randomUUID(), grossG: v.grossG, valueCents: Math.round(v.valueLkr * 100) };
    setPendingOld((s) => ({ customerId: customer.id, items: [...(s.customerId === customer.id ? s.items : []), item] }));
  }

  function removePending(key: string) {
    setPendingOld((s) => ({ ...s, items: s.items.filter((p) => p.key !== key) }));
  }

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
        listPriceCents: ok.price,
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
        setCart((d.cart ?? []).map((l) => ({ ...l, listPriceCents: l.listPriceCents ?? l.priceCents })));
        setCustomer(d.customer ?? null);
        setExchange(d.exchange ?? null);
        setNotes(d.notes ?? "");
        if (d.oldSel) setOldSel(d.oldSel);
        if (d.pendingOld) setPendingOld(d.pendingOld);
        if (d.payout) setPayout(d.payout);
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
      const holdsOld = oldSel.ids.length > 0 || pendingOld.items.length > 0;
      if (cart.length === 0 && !customer && !exchange && !notes && !holdsOld) window.sessionStorage.removeItem(DRAFT_KEY);
      else window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ cart, customer, exchange, notes, oldSel, pendingOld, payout } satisfies Draft));
    } catch {
      // A draft is a convenience; the sale itself does not depend on it.
    }
  }, [cart, customer, exchange, notes, oldSel, pendingOld, payout, loaded]);

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

  // Old gold ticked against this bill. Only ids the customer still has valued
  // count; the selection is for this customer alone.
  const oldIds = customer && oldSel.customerId === customer.id ? oldSel.ids : [];
  // Pieces taken in here, not on record yet: they count in full and are saved with the sale.
  const pending = customer && pendingOld.customerId === customer.id ? pendingOld.items : [];
  const hasExchange = oldIds.length > 0 || pending.length > 0;
  const takenIn = (valued.data?.rows ?? []).filter((r) => oldIds.includes(r.id));
  const oldTotal = takenIn.reduce((s, r) => s + (r.purchase_value_cents ?? 0), 0) + pending.reduce((s, p) => s + p.valueCents, 0);
  // With old gold in, the payment settles the balance, not the bill: a positive
  // balance the customer pays, a negative one the shop pays out.
  const balance = total - oldTotal;
  const due = hasExchange ? Math.max(balance, 0) : total;
  const shopOwes = hasExchange && balance < 0 ? -balance : 0;
  // Nothing is keyed when the shop is the one paying. Any part of a customer's
  // balance left unpaid goes on their credit, as on any part-paid sale.
  const activePays = shopOwes > 0 ? [] : pays;
  const exchangeBlocked = hasExchange && (!valued.data || takenIn.length !== oldIds.length || Boolean(exchange));
  // The bill as the customer settles it: the total less the old gold taken in.
  const dueLabel = hasExchange
    ? shopOwes > 0
      ? `${fmt(shopOwes)} LKR ${payout === "cash" ? "cash to customer" : "to clear open bills"}`
      : `${fmt(due)} LKR due`
    : `${fmt(total)} LKR due`;

  const netMg = cart.reduce((s, l) => s + l.netMg, 0);
  const paidSum = activePays.reduce((s, p) => s + cents(p.amountLkr), 0);
  // Charging under the shelf price is a discount too; it counts against the same limits.
  const markdown = cart.reduce((s, l) => s + Math.max(0, l.listPriceCents - l.priceCents), 0);
  const listSubtotal = cart.reduce((s, l) => s + l.listPriceCents, 0);
  const pct = listSubtotal > 0 ? ((discount + markdown) / listSubtotal) * 100 : 0;
  const cashDue = activePays.filter((p) => p.method === "cash").reduce((s, p) => s + cents(p.amountLkr), 0);
  // Part-paid bills for a known customer: whatever is not paid now goes on their account.
  const autoCredit = customer && paidSum > 0 && paidSum < due ? due - paidSum : 0;
  const creditDue = activePays.filter((p) => p.method === "credit").reduce((s, p) => s + cents(p.amountLkr), 0) + autoCredit;
  const change = tendered ? cents(tendered) - cashDue : null;
  // Every bill is saved to a customer, cash or credit alike.
  const needsCustomer = !customer;
  const heldMismatch = cart.filter((l) => l.reservedFor && l.reservedFor.id !== customer?.id);
  const bankRows = banks.data ?? [];
  const needsBank = bankRows.length > 1 && activePays.some((p) => p.method === "bank" && !p.bankAccountId);
  // Store credit the customer holds at this branch is spent before new debt.
  const storeCredit = credit.data && credit.data.branchBalanceCents < 0 ? -credit.data.branchBalanceCents : 0;
  // The customer's balance once this sale is complete: what it owes now, plus any part of this bill
  // left on their account, less the shop's payout when that is kept as store credit (signed: < 0 is credit).
  const balanceAfterSale = credit.data
    ? credit.data.balanceCents + creditDue - (shopOwes > 0 && payout === "store_credit" ? shopOwes : 0)
    : null;
  const overLimit =
    creditDue > 0 &&
    credit.data &&
    credit.data.creditLimitCents > 0 &&
    credit.data.balanceCents + creditDue > credit.data.creditLimitCents;

  const canComplete =
    cart.length > 0 &&
    paidSum + autoCredit === due &&
    total > 0 &&
    !exchangeBlocked &&
    !needsCustomer &&
    !needsBank &&
    !overLimit &&
    (change === null || change >= 0) &&
    heldMismatch.length === 0 &&
    !stale &&
    Boolean(branchId);

  function resetSale() {
    autoAmount.current = false;
    setCart([]);
    setCustomer(null);
    setCustomerSearch("");
    setExchange(null);
    setOldSel({ customerId: "", ids: [] });
    setPendingOld({ customerId: "", items: [] });
    setPayout("store_credit");
    setPays([{ method: "cash", amountLkr: "" }]);
    setTendered("");
    setNotes("");
    setStale(false);
  }

  const addCustomer = useMutation({
    mutationFn: (v: { name: string; phone: string; address: string }) =>
      api<Customer>("/api/v1/customers", {
        method: "POST",
        body: JSON.stringify({
          name: v.name.trim(),
          phone: v.phone.trim(),
          address: v.address.trim(),
          branchId,
        }),
      }),
    onSuccess: (c) => {
      setCustomer(c);
      setCustomerSearch("");
      setNewCust(null);
      toast.success(`${c.name} added`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add the customer"),
  });

  const complete = useMutation({
    mutationFn: () => {
      const items = cart.map((l) => ({
        productId: l.productId,
        priceLkr: l.priceCents / 100,
        listPriceLkr: l.listPriceCents / 100,
        discountLkr: l.discountCents / 100,
      }));
      const payments = [
        ...activePays,
        ...(autoCredit > 0 ? [{ method: "credit", amountLkr: String(autoCredit / 100) } as PayRow] : []),
      ].map((p) => ({
        method: p.method,
        amountLkr: Number(p.amountLkr),
        chequeNo: p.method === "cheque" ? p.chequeNo?.trim() || undefined : undefined,
        chequeBank: p.method === "cheque" ? p.chequeBank?.trim() || undefined : undefined,
        // One bank account needs no choosing; several do (needsBank).
        bankAccountId:
          p.method === "bank" ? p.bankAccountId || (bankRows.length === 1 ? bankRows[0]!.id : undefined) : undefined,
      }));
      if (hasExchange) {
        // The old gold is bought in and the new pieces sold in one batch; the
        // payments carry only the balance the customer settles.
        return api<{ invoiceId: string; number: string }>("/api/v1/sales/exchanges", {
          method: "POST",
          body: JSON.stringify({
            customerId: customer?.id,
            branchId,
            oldGoldItemIds: takenIn.map((r) => r.id),
            newOldGold: pending.map((p) => ({ grossG: p.grossG, valueLkr: p.valueCents / 100 })),
            items,
            payments,
            payout: shopOwes > 0 ? payout : "store_credit",
            notes: notes.trim() || undefined,
          }),
        });
      }
      return api<{ invoiceId: string; number: string }>("/api/v1/sales/invoices", {
        method: "POST",
        body: JSON.stringify({
          customerId: customer?.id,
          branchId,
          items,
          payments,
          tenderedLkr: cashDue > 0 && tendered ? Number(tendered) : undefined,
          notes: notes.trim() || undefined,
          exchangeReturnId: exchange?.returnId,
        }),
      });
    },
    onSuccess: (d) => {
      setDone({
        invoiceId: d.invoiceId,
        number: d.number,
        totalCents: total,
        changeCents: change !== null && change > 0 ? change : null,
        customer: customer?.name ?? null,
        exchange: hasExchange ? { oldGoldCents: oldTotal, balanceCents: balance, payout } : undefined,
      });
      resetSale();
      toast.success(`Sale ${d.number} complete`);
    },
    onError: (e) => {
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
        if (ok.price !== l.listPriceCents) changed++;
        // A price the cashier negotiated survives a refresh; one left at shelf follows it.
        const price = l.priceCents === l.listPriceCents ? ok.price : l.priceCents;
        next.push({ ...l, priceCents: price, listPriceCents: ok.price, discountCents: Math.min(l.discountCents, price) });
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

  // A single payment row the cashier did not type (auto-filled or "All cash")
  // follows the total, so scanning another piece or changing a discount
  // never leaves a stale amount behind.
  useEffect(() => {
    if (!autoAmount.current) return;
    setPays((ps) => {
      const only = ps[0];
      if (ps.length !== 1 || !only) return ps;
      const next = due > 0 ? String(due / 100) : "";
      return only.amountLkr === next ? ps : [{ ...only, amountLkr: next }];
    });
  }, [due]);

  // Ticked old gold the customer no longer has valued (sold, re-valued or moved
  // since it was ticked) is dropped, so the balance is never worked out on a
  // piece the server would refuse.
  useEffect(() => {
    if (!valued.data || !customer || oldSel.customerId !== customer.id) return;
    const valid = new Set(valued.data.rows.map((r) => r.id));
    const kept = oldSel.ids.filter((id) => valid.has(id));
    if (kept.length !== oldSel.ids.length) setOldSel({ customerId: customer.id, ids: kept });
  }, [valued.data, oldSel, customer]);

  function setLine(i: number, patch: Partial<CartLine>) {
    setCart((c) => c.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function setPay(i: number, patch: Partial<PayRow>) {
    setPays((ps) => ps.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  function autoBalance() {
    const rest = due - pays.slice(0, -1).reduce((s, p) => s + cents(p.amountLkr), 0);
    setPays((ps) => ps.map((p, i) => (i === ps.length - 1 ? { ...p, amountLkr: String(Math.max(0, rest) / 100) } : p)));
  }

  /** One tap: the whole amount due on a single method. */
  function payAll(method: string) {
    autoAmount.current = true;
    setPays([{ method, amountLkr: due > 0 ? String(due / 100) : "" }]);
    if (method !== "cash") setTendered("");
  }

  function toggleOld(id: string) {
    if (!customer) return;
    const ids = oldIds.includes(id) ? oldIds.filter((x) => x !== id) : [...oldIds, id];
    setOldSel({ customerId: customer.id, ids });
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-bone text-ink animate-fade-in lg:overflow-hidden">
      <header className="sticky top-0 z-30 shrink-0 border-b border-ink/20 bg-paper/95 backdrop-blur-md">
        <div className="flex h-14 items-center gap-3 px-4 lg:px-5">
          <Link href="/sales" className="flex shrink-0 items-center gap-2.5" title="Back to the console">
            <BrandMark size={32} className="shrink-0" />
            <span className="hidden leading-none sm:block">
              <span className="block font-serif text-[15px] font-semibold text-ink">GoldOS</span>
              <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[0.22em] text-gold-dark">POS terminal</span>
            </span>
          </Link>
          <span className="hidden h-6 w-px bg-ink/10 md:block" aria-hidden />
          <nav aria-label="Sales" className="hidden min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-thin md:flex">
            {SALES_PAGES.filter((p) => !p.perm || hasPermission(me.data?.permissions ?? [], p.perm)).map((p) => {
              const Icon = p.icon;
              const on = p.href === "/pos";
              return (
                <Link
                  key={p.href}
                  href={p.href}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
                    on ? "bg-void text-paper" : "text-ink-3 hover:bg-ink/[0.05] hover:text-ink"
                  )}
                >
                  <Icon size={14} />
                  {p.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {clock ? (
              <span className="hidden flex-col items-end leading-none xl:flex">
                <span className="num-tabular text-sm font-semibold text-ink">
                  {clock.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="mt-0.5 text-[10px] text-ink-4">
                  {clock.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                </span>
              </span>
            ) : null}
            {me.data ? (
              <span className="hidden items-center gap-2 rounded-lg bg-bone px-2.5 py-1.5 lg:inline-flex">
                <span className="flex size-6 items-center justify-center rounded-md bg-void text-[10px] font-semibold text-gold-light">
                  {me.data.user.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="max-w-36 truncate text-xs font-medium text-ink-2">{me.data.user.name}</span>
              </span>
            ) : null}
            <BranchSwitcher />
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
              title={fullscreen ? "Exit full screen" : "Full screen"}
              className="flex size-9 items-center justify-center rounded-lg text-ink-3 ring-1 ring-ink/20 transition-colors hover:bg-ink/[0.05] hover:text-ink"
            >
              {fullscreen ? <MinimizeIcon size={16} /> : <MaximizeIcon size={16} />}
            </button>
            <Link
              href="/sales"
              className="g-btn g-btn-secondary h-9 px-3 text-xs"
              title="Leave the terminal"
            >
              <LogOutIcon size={14} /> <span className="hidden sm:inline">Exit</span>
            </Link>
          </div>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px]">
      <div className="min-w-0 space-y-4 p-4 scrollbar-thin lg:min-h-0 lg:overflow-y-auto lg:p-5">
      <section className="relative rounded-2xl bg-void text-paper shadow-4">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <div className="home-grid-bg absolute inset-0 opacity-30" />
          <div className="absolute -right-24 -top-32 size-72 rounded-full bg-gold/[0.12] blur-[90px]" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
        </div>

        <div className="relative flex flex-col gap-4 border-b border-paper/[0.07] px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.35)]">
              <ScanBarcodeIcon size={20} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="g-display text-[22px] leading-tight text-paper">Point of sale</h1>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                  <span className="size-1.5 animate-pulse-soft rounded-full bg-emerald-400" />
                  {branchId ? "Till open" : "No branch"}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-paper/50">
                Scan a tag or QR, or type a product name. Apply discounts, split payments, print the bill.
              </p>
            </div>
          </div>
          <div className="flex divide-x divide-paper/[0.08]">
            <HeaderStat label="Items" value={cart.length} />
            <HeaderStat label="Net weight" value={`${(netMg / 1000).toLocaleString("en-US")} g`} />
            <HeaderStat label="Amount due" value={dueLabel.replace(/ due$/, "")} accent />
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitScan();
          }}
          className="relative flex items-start gap-2 px-5 pt-4 sm:px-6"
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
              className="h-13 w-full rounded-xl bg-paper/10 py-3.5 pl-11 pr-4 font-mono text-lg text-paper placeholder:font-sans placeholder:text-paper/35 shadow-[inset_0_0_0_1px_rgba(205,168,83,0.45)] transition-shadow focus:outline-none focus:shadow-[inset_0_0_0_2px_#CDA853,0_0_0_4px_rgba(205,168,83,0.2)]"
            />
            {showResults ? (
              <ul
                id="pos-results"
                role="listbox"
                // Floats over the cart so the terminal layout never jumps while searching.
                className="absolute inset-x-0 top-[calc(100%+8px)] z-30 max-h-[min(24rem,60vh)] overflow-y-auto rounded-xl bg-paper p-1.5 text-ink shadow-5 ring-1 ring-ink/20 scrollbar-thin animate-pop-in"
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
        <div className="relative flex flex-wrap items-center gap-x-5 gap-y-2 px-5 pb-4 pt-3 text-[11px] text-paper/50 sm:px-6">
          <span className="inline-flex items-center gap-1.5"><Kbd dark>F2</Kbd> Scan / search</span>
          <span className="inline-flex items-center gap-1.5"><Kbd dark>↑</Kbd><Kbd dark>↓</Kbd> Pick</span>
          <span className="inline-flex items-center gap-1.5"><Kbd dark>F9</Kbd> Pay</span>
          <span className="inline-flex items-center gap-1.5"><Kbd dark>Enter</Kbd> Complete sale</span>
          {lookup.isPending ? (
            <span className="ml-auto inline-flex items-center gap-1.5 text-gold-light">
              <RefreshCwIcon size={12} className="animate-spin" /> Looking up…
            </span>
          ) : null}
        </div>
      </section>

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

      <TableCard
        title="Cart"
        icon={<ScanBarcodeIcon size={17} />}
        description={`${cart.length} item${cart.length === 1 ? "" : "s"} · ${(netMg / 1000).toLocaleString("en-US")} g net`}
        footer={
          cart.length > 0 ? (
            <>
              <span className="num-tabular">
                {cart.length} item{cart.length === 1 ? "" : "s"} · {(netMg / 1000).toLocaleString("en-US")} g net
                {discount + markdown > 0 ? ` · ${fmt(discount + markdown)} LKR off shelf` : ""}
              </span>
              <span className="num-tabular text-sm text-ink-3">
                Cart total <span className="ml-2 text-base font-semibold text-ink">{fmt(total)} LKR</span>
              </span>
            </>
          ) : null
        }
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
            <span className="rounded-full bg-gold-pale px-2.5 py-1 g-metric text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-deep shadow-[inset_0_0_0_1px_rgba(168,138,62,0.2)]">
              {dueLabel}
            </span>
          </span>
        }
      >
        {cart.length === 0 ? (
          <EmptyBlock
            icon={<ScanBarcodeIcon size={22} />}
            title="Cart is empty"
            description="Scan a tag or its QR code, or type a product name above to start the sale."
            action={
              <button
                type="button"
                onClick={() => scanRef.current?.focus()}
                className="g-btn g-btn-secondary h-9 px-3.5 text-xs"
              >
                <Kbd>F2</Kbd> Start scanning
              </button>
            }
          />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th className="w-10">#</th>
                <th>Barcode</th>
                <th>Item</th>
                <th className="!text-right">Net g</th>
                <th className="!text-right">Price (editable)</th>
                <th className="!text-right">Discount</th>
                <th className="!text-right">Line total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cart.map((l, i) => (
                <tr key={l.productId}>
                  <td className="num-tabular text-xs text-ink-4">{i + 1}</td>
                  <td className="g-metric text-xs">{l.barcode}</td>
                  <td className="font-medium text-ink">
                    {l.name} <span className="text-ink-4">· {l.karat}</span>
                    {l.reservedFor ? (
                      <Pill tone="warning" className="ml-2">Held · {l.reservedFor.name}</Pill>
                    ) : null}
                  </td>
                  <td className="!text-right num-tabular">{(l.netMg / 1000).toLocaleString("en-US")}</td>
                  <td className="!text-right">
                    <input
                      type="number"
                      step="any"
                      min={0}
                      value={l.priceCents / 100}
                      aria-label={`Price of ${l.barcode}`}
                      onChange={(e) => {
                        const price = Math.max(0, cents(e.target.value));
                        setLine(i, { priceCents: price, discountCents: Math.min(l.discountCents, price) });
                      }}
                      className={cn(
                        `${controlSmClass} w-28 !text-right num-tabular`,
                        l.priceCents < l.listPriceCents && "!text-amber-700",
                        l.priceCents > l.listPriceCents && "!text-emerald-700"
                      )}
                    />
                    {l.priceCents !== l.listPriceCents ? (
                      <button
                        type="button"
                        onClick={() => setLine(i, { priceCents: l.listPriceCents })}
                        className="mt-1 block w-full text-right text-[11px] text-ink-4 hover:text-ink"
                        title="Back to the shelf price"
                      >
                        Shelf {fmt(l.listPriceCents)} · {l.priceCents < l.listPriceCents ? "−" : "+"}
                        {((Math.abs(l.priceCents - l.listPriceCents) / l.listPriceCents) * 100).toFixed(1)}% · reset
                      </button>
                    ) : null}
                  </td>
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

      {customer && canExchange ? (
        <OldGoldExchange
          customerName={customer.name}
          pieces={valued.data?.rows ?? []}
          loading={valued.isLoading}
          selectedIds={oldIds}
          onToggle={toggleOld}
          saleTotalCents={total}
          oldTotalCents={oldTotal}
          payout={payout}
          onPayout={setPayout}
          canAdd={canCreate}
          pending={pending}
          onRemovePending={removePending}
          onAdd={addPending}
        />
      ) : null}

        <Panel title="Discount" icon={<TagsIcon size={17} />} description={`${pct.toFixed(1)}% of subtotal`} bodyClassName="py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-gradient-to-br from-void to-[#0b3a2e] px-4 py-3 shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">Discount given</p>
              <p className="num-tabular mt-1 text-xl font-semibold text-paper">
                {fmt(discount + markdown)} <span className="text-xs font-medium text-gold-light">LKR</span>
              </p>
            </div>
            <div className="rounded-xl bg-bone/70 px-4 py-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">Of shelf price</p>
              <p className="num-tabular mt-1 text-xl font-semibold text-ink">{pct.toFixed(1)}%</p>
            </div>
            <div className="rounded-xl bg-bone/70 px-4 py-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">Sale total</p>
              <p className="num-tabular mt-1 text-xl font-semibold text-ink">{fmt(total)}</p>
            </div>
          </div>
          <p className="mt-3 flex items-center gap-2 text-xs text-ink-4">
            <span className="size-1.5 shrink-0 rounded-full bg-gold" />
            Edit a price or discount in the cart. What you enter is what is charged and booked.
          </p>
        </Panel>
      </div>

      <aside className="flex min-w-0 flex-col border-t border-ink/20 bg-paper/55 lg:min-h-0 lg:border-l lg:border-t-0">
      <div className="space-y-4 p-4 scrollbar-thin lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:p-5">
        <Panel title="Customer" icon={<UserCheckIcon size={17} />} description="Required — every bill is saved to a customer">
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
                  {shopOwes > 0 ? (
                    <>
                      <dt className="text-ink-4">{payout === "cash" ? "Cash to customer" : "Clears open bills"}</dt>
                      <dd className="text-right font-medium text-emerald-700">
                        {fmt(shopOwes)} LKR
                      </dd>
                    </>
                  ) : null}
                  {balanceAfterSale !== null ? (
                    <>
                      <dt className="mt-1 border-t border-ink/20 pt-1 text-ink-3">
                        {balanceAfterSale < 0 ? "Store credit after sale" : "Owes after sale"}
                      </dt>
                      <dd
                        className={cn(
                          "mt-1 border-t border-ink/20 pt-1 text-right font-semibold",
                          balanceAfterSale > 0 ? "text-amber-700" : balanceAfterSale < 0 ? "text-emerald-700" : "text-ink"
                        )}
                      >
                        {balanceAfterSale === 0 ? "Settled" : `${fmt(Math.abs(balanceAfterSale))} LKR`}
                      </dd>
                    </>
                  ) : null}
                </dl>
              ) : null}
            </>
          ) : (
            <>
              <input
                placeholder="Search name or phone…"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className={`w-full !h-11 !rounded-xl !px-3.5 ${controlClass}`}
              />
              {newCust ? (
                <div className="mt-2 space-y-2 rounded-xl bg-bone/70 p-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)]">
                  <input
                    autoFocus
                    placeholder="Customer name"
                    value={newCust.name}
                    onChange={(e) => setNewCust({ ...newCust, name: e.target.value })}
                    className={`w-full ${controlClass}`}
                  />
                  <input
                    placeholder="Phone number"
                    inputMode="tel"
                    value={newCust.phone}
                    onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })}
                    className={`w-full ${controlClass}`}
                  />
                  <textarea
                    placeholder="Address"
                    rows={2}
                    value={newCust.address}
                    onChange={(e) => setNewCust({ ...newCust, address: e.target.value })}
                    className={`w-full resize-none py-2 ${controlClass}`}
                  />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setNewCust(null)} className="g-btn g-btn-secondary h-9 flex-1 text-xs">
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!newCust.name.trim() || !newCust.phone.trim() || !newCust.address.trim() || addCustomer.isPending}
                      onClick={() => addCustomer.mutate(newCust)}
                      className="g-btn g-btn-primary h-9 flex-1 text-xs"
                    >
                      {addCustomer.isPending ? "Adding…" : "Add & select"}
                    </button>
                  </div>
                </div>
              ) : null}
              {customerSearch.trim() && !newCust ? (
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
                  {newCust ? null : (
                    <li>
                      <button
                        type="button"
                        onClick={() => {
                          const t = customerSearch.trim();
                          const isPhone = /^[\d+\s-]{6,}$/.test(t);
                          setNewCust({ name: isPhone ? "" : t, phone: isPhone ? t : "", address: "" });
                        }}
                        className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-sm font-medium text-gold-deep transition-colors hover:bg-gold-pale/60"
                      >
                        + New customer{customers.data && customers.data.rows.length === 0 ? " — no match" : ""}
                      </button>
                    </li>
                  )}
                </ul>
              ) : (
                <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-bone px-2.5 py-1 text-xs font-medium text-ink-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)]">
                  <span className="size-1.5 rounded-full bg-gold" /> Select a customer to save the bill
                </p>
              )}
            </>
          )}
          {exchange ? (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-3">
              <ArrowLeftRightIcon size={12} /> Exchange for {exchange.number}
            </p>
          ) : null}
          <label className="mt-5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-dark">Invoice note
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 500))}
              rows={3}
              placeholder="Printed on the bill (optional)"
              className={`mt-1.5 w-full resize-none ${controlClass} !h-auto !rounded-xl !px-3.5 py-2.5 text-sm font-normal normal-case tracking-normal`}
            />
          </label>
        </Panel>
        <Panel
          title="Payment"
          icon={<CreditCardIcon size={17} />}
          description={hasExchange ? (shopOwes > 0 ? `${fmt(shopOwes)} LKR ${payout === "cash" ? "cash to customer" : "to clear open bills"}` : `Customer pays ${fmt(due)} LKR`) : `Total ${fmt(total)} LKR`}
          className="!overflow-visible"
        >
          <div className="mb-4 overflow-hidden rounded-xl bg-bone/70 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)]">
            <dl className="grid grid-cols-2 gap-y-1.5 px-4 pb-3 pt-3.5 text-sm num-tabular">
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
              {hasExchange ? (
                <>
                  <dt className="text-ink-3">Old gold in</dt>
                  <dd className="text-right text-ink">−{fmt(oldTotal)}</dd>
                </>
              ) : null}
            </dl>
          </div>
          {due > 0 ? (
            <div className="mb-1">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">Quick tender · full amount</p>
              <div className={cn("grid gap-1.5", customer ? "grid-cols-5" : "grid-cols-4")}>
                {["cash", "cheque", "card", "bank", ...(customer ? ["credit"] : [])].map((m) => {
                  const Icon = METHOD_ICON[m] ?? CreditCardIcon;
                  const on = pays.length === 1 && pays[0]?.method === m && cents(pays[0].amountLkr) === due;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => payAll(m)}
                      aria-pressed={on}
                      aria-label={`All ${m}`}
                      title={`Take the full amount by ${m}`}
                      className={cn(
                        "flex h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium capitalize ring-1 transition-colors",
                        on
                          ? "bg-gold-pale text-gold-deep ring-gold-dark/40"
                          : "bg-paper text-ink-2 ring-ink/20 hover:bg-bone hover:ring-ink/20"
                      )}
                    >
                      <Icon size={16} />
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <form
            id="pos-pay-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (canComplete && !complete.isPending) complete.mutate();
            }}
          >
            {shopOwes > 0 ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-2.5 text-xs leading-relaxed text-emerald-800">
                {payout === "cash"
                  ? `${fmt(shopOwes)} LKR is paid out to ${customer?.name} in cash on completion.`
                  : `${fmt(shopOwes)} LKR clears ${customer?.name}'s open bills on completion.`}
              </p>
            ) : pays.map((p, i) => (
              <div key={i} className="mt-2">
                <div className="flex gap-2">
                  <Select
                    value={p.method}
                    onChange={(v) => setPay(i, { method: v, bankAccountId: undefined })}
                    className="w-32 shrink-0"
                    ariaLabel="Payment method"
                    capitalize
                    options={METHODS.map((m) => ({ value: m, label: m }))}
                  />
                  <input
                    id={i === 0 ? "pos-pay-0" : undefined}
                    type="number"
                    step="any"
                    min={0}
                    placeholder="Amount"
                    value={p.amountLkr}
                    onChange={(e) => {
                      autoAmount.current = false;
                      setPay(i, { amountLkr: e.target.value });
                    }}
                    onFocus={() => {
                      // A single payment row is almost always the whole bill.
                      if (pays.length === 1 && !p.amountLkr && due > 0) {
                        autoAmount.current = true;
                        setPay(0, { amountLkr: String(due / 100) });
                      }
                    }}
                    className={`num-tabular min-w-0 flex-1 ${controlClass} !h-11 !rounded-xl !px-3.5`}
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
                {p.method === "cheque" ? (
                  <div className="mt-1.5 flex gap-2">
                    <input
                      value={p.chequeNo ?? ""}
                      onChange={(e) => setPay(i, { chequeNo: e.target.value })}
                      placeholder="Cheque no."
                      className={`min-w-0 flex-1 ${controlClass}`}
                    />
                    <input
                      value={p.chequeBank ?? ""}
                      onChange={(e) => setPay(i, { chequeBank: e.target.value })}
                      placeholder="Bank"
                      className={`min-w-0 flex-1 ${controlClass}`}
                    />
                  </div>
                ) : null}
                {p.method === "bank" && bankRows.length > 1 ? (
                  <Select
                    value={p.bankAccountId ?? ""}
                    onChange={(v) => setPay(i, { bankAccountId: v || undefined })}
                    ariaLabel="Bank account"
                    className="mt-1.5"
                    invalid={!p.bankAccountId}
                    placeholder="Which bank account?"
                    options={bankRows.map((b) => ({
                      value: b.id,
                      label: b.name,
                      hint: [b.bank_name, b.account_number].filter(Boolean).join(" · ") || undefined,
                    }))}
                  />
                ) : p.method === "bank" && bankRows.length === 1 ? (
                  <p className="mt-1 text-xs text-ink-4">Into {bankRows[0]!.name}</p>
                ) : null}
              </div>
            ))}
            {shopOwes > 0 ? null : (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setPays((ps) => [...ps, { method: "card", amountLkr: "" }])}
                  className="g-btn g-btn-secondary h-9 flex-1 rounded-xl px-3 text-xs"
                >
                  <PlusIcon size={12} /> Split
                </button>
                <button type="button" onClick={autoBalance} className="g-btn g-btn-secondary h-9 flex-1 rounded-xl px-3 text-xs">
                  Auto-balance last
                </button>
              </div>
            )}
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
            {shopOwes > 0 ? null : (
              <p className={`mt-3 num-tabular text-sm ${paidSum === due && due > 0 ? "font-semibold text-emerald-700" : "text-ink-3"}`}>
                Paid {fmt(paidSum)} / {fmt(due)}
                {paidSum !== due && due > 0 && autoCredit === 0 ? ` · ${paidSum > due ? "over" : "short"} ${fmt(Math.abs(due - paidSum))}` : ""}
              </p>
            )}
            {autoCredit > 0 && customer ? (
              <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                {fmt(autoCredit)} LKR balance goes on {customer.name}&apos;s credit.
              </p>
            ) : paidSum > 0 && paidSum < due ? (
              <p className="mt-1 text-xs text-ink-3">
                {hasExchange
                  ? `Key ${fmt(due - paidSum)} LKR more to settle the balance of ${fmt(due)} LKR.`
                  : "Choose a customer to put the balance on credit."}
              </p>
            ) : null}
            {creditDue > autoCredit && customer ? (
              <p className="mt-1 text-xs text-ink-3">
                {fmt(creditDue - autoCredit)} LKR on {customer.name}&apos;s account
                {storeCredit > 0 ? ` — ${fmt(Math.min(storeCredit, creditDue))} from store credit` : ""}.
              </p>
            ) : null}
            {needsCustomer && cart.length > 0 ? <p className="mt-1 text-xs text-rose-600">Select a customer to save this bill.</p> : null}
            {needsBank ? <p className="mt-1 text-xs text-rose-600">Choose the bank account the payment went into.</p> : null}
            {hasExchange && exchange ? (
              <p className="mt-1 text-xs text-rose-600">An old-gold exchange cannot go on a return-exchange bill — clear one of them.</p>
            ) : null}
            {overLimit ? (
              <p className="mt-1 text-xs text-rose-600">
                Over {customer?.name}&apos;s credit limit of {fmt(credit.data!.creditLimitCents)} LKR — take more now or collect the balance first.
              </p>
            ) : null}
          </form>
        </Panel>
      </div>

        {/* Pinned checkout: the total and the one button that matters are always on screen. */}
        <div className="sticky bottom-0 z-20 shrink-0 border-t border-ink/20 bg-paper px-4 pb-4 pt-3.5 shadow-[0_-18px_40px_-28px_rgba(16,32,27,0.35)] lg:static lg:px-5 lg:pb-5">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-4">
                {shopOwes > 0 ? (payout === "cash" ? "Cash to customer" : "Clears open bills") : hasExchange ? "Customer pays" : "Total due"}
              </p>
              {shopOwes > 0 ? null : (
                <p className={cn("num-tabular mt-1 text-xs", paidSum === due && due > 0 ? "font-medium text-emerald-700" : "text-ink-4")}>
                  Paid {fmt(paidSum)}
                  {autoCredit > 0 ? ` · ${fmt(autoCredit)} on credit` : ""}
                  {change !== null && change > 0 ? ` · change ${fmt(change)}` : ""}
                </p>
              )}
            </div>
            <p className="num-tabular text-[30px] font-semibold leading-none tracking-tight text-ink">
              {fmt(shopOwes > 0 ? shopOwes : due)} <span className="text-sm font-medium text-gold-dark">LKR</span>
            </p>
          </div>
          <button
            type="submit"
            form="pos-pay-form"
            disabled={complete.isPending || !canComplete}
            className="g-btn g-btn-primary mt-3.5 h-14 w-full rounded-xl text-[15px] font-semibold"
          >
            {complete.isPending ? (
              "Posting…"
            ) : (
              <>
                <CheckCircleIcon size={17} /> Complete sale
                <span className="ml-1 opacity-70"><Kbd>Enter</Kbd></span>
              </>
            )}
          </button>
        </div>
      </aside>
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
          <dl className="grid grid-cols-2 gap-y-1.5 rounded-xl bg-bone p-4 text-sm num-tabular ring-1 ring-ink/20">
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
            {done.exchange ? (
              <>
                <dt className="text-ink-3">Old gold in</dt>
                <dd className="text-right text-ink">{fmt(done.exchange.oldGoldCents)} LKR</dd>
                <dt className="text-ink-3">
                  {done.exchange.balanceCents < 0
                    ? done.exchange.payout === "cash"
                      ? "Paid out · cash"
                      : "Store credit"
                    : done.exchange.balanceCents > 0
                      ? "Customer paid"
                      : "Balance"}
                </dt>
                <dd className="text-right font-semibold text-ink">
                  {done.exchange.balanceCents === 0 ? "Settled" : `${fmt(Math.abs(done.exchange.balanceCents))} LKR`}
                </dd>
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
    </div>
  );
}
