"use client";

// Old-for-new exchange desk: a customer's valued old gold is bought back and
// settled against new pieces in one atomic batch. The counter pays the
// difference in whichever direction it falls — out of the drawer when the old
// gold wins, at the till when the new pieces do.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { salesTaxCents } from "@goldos/shared";
import { api, errorCode } from "@/lib/api";
import { extractScanCode, looksLikeCode } from "@/lib/barcode";
import { cn } from "@/lib/cn";
import { Select } from "@/components/select";
import { CameraScanButton } from "@/components/camera-scan";
import { Page, Callout, controlClass } from "@/components/ui";
import { AlertCircleIcon, ArrowLeftRightIcon, ArrowRightIcon, BanknoteIcon, CheckCircleIcon, CheckIcon, FileTextIcon, FlaskConicalIcon, GemIcon, PlusIcon, ScaleIcon, ScanBarcodeIcon, SearchIcon, TagsIcon, TrashIcon, UserCheckIcon, XIcon } from "@/components/icons";
import { Card, CardHead, Empty, GoldHero, HeadLink, HeroBadge, KaratTag, RowsSkeleton, grams, heroGhost, inputCls, permille, th, thead, tr } from "../kit";

type Customer = { id: string; name: string; code: string; phone?: string | null };

type OldGoldRow = {
  id: string;
  number: string;
  description: string;
  karat: string | null;
  tested_permille: number | null;
  net_mg: number;
  fine_mg: number;
  purchase_value_cents: number | null;
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
};

type CartLine = {
  productId: string;
  barcode: string;
  name: string;
  karat: string;
  priceCents: number;
  listPriceCents: number;
  discountCents: number;
};

type PayRow = { method: string; amountLkr: string; bankAccountId?: string };

type BankAccount = { id: string; name: string; bank_name: string | null; account_number: string | null };

type Lookup = {
  product: {
    id: string; barcode: string; name: string; karat: string; net_mg: number;
    selling_price_cents: number | null; cost_cents: number | null; status: string; branch_id: string;
    reserved_customer_id: string | null; reserved_customer_name: string | null;
  };
  livePrice: { amount_cents: number } | null;
};

type Done = {
  invoiceId: string;
  number: string;
  oldGoldValueCents: number;
  saleTotalCents: number;
  customerPaysCents: number;
  shopPaysCents: number;
  payout: "cash" | "store_credit";
};

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? "";
}

const METHODS = ["cash", "card", "bank", "credit", "other"];
const fmt = (c: number) => (c / 100).toLocaleString("en-US");
const cents = (lkr: string) => Math.round(Number(lkr || 0) * 100);
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

/** The shelf price the server will charge, or why the piece cannot be sold here. */
function saleable(d: Lookup, branchId: string): { price: number } | { error: string } {
  const p = d.product;
  if (p.status === "RESERVED") return { error: `${p.barcode} is held for ${p.reserved_customer_name ?? "another customer"} — release the hold first` };
  if (p.status !== "IN_STOCK") return { error: `${p.barcode} is ${p.status.replace(/_/g, " ").toLowerCase()}, not for sale` };
  if (branchId && p.branch_id !== branchId) return { error: `${p.barcode} belongs to another branch` };
  if (p.cost_cents === null) return { error: `${p.barcode} has no book cost — set its cost before selling` };
  const price = p.selling_price_cents ?? d.livePrice?.amount_cents;
  if (price === undefined) return { error: `No gold rate for ${p.karat} — set today's rate first` };
  return { price };
}

export default function ExchangePage() {
  const [branchId, setBranchId] = useState(branchDefault);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [oldIds, setOldIds] = useState<string[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [scan, setScan] = useState("");
  const [pays, setPays] = useState<PayRow[]>([{ method: "cash", amountLkr: "" }]);
  const [payout, setPayout] = useState<"cash" | "store_credit">("cash");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const cartRef = useRef(cart);
  cartRef.current = cart;

  useEffect(() => {
    if (branchId) return;
    api<{ rows: { id: string }[] }>("/api/v1/branches?limit=100")
      .then((d) => {
        const first = d.rows[0]?.id;
        if (first) {
          setBranchId(first);
          document.cookie = `goldos_branch=${first}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`;
        }
      })
      .catch(() => undefined);
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail) setBranchId(detail);
      else setBranchId(branchDefault());
    };
    window.addEventListener("goldos-branch-changed", handler);
    return () => window.removeEventListener("goldos-branch-changed", handler);
  }, [branchId]);

  const customers = useQuery({
    queryKey: ["ex-customers", customerSearch],
    queryFn: () => api<{ rows: Customer[]; total: number }>(`/api/v1/customers?search=${encodeURIComponent(customerSearch)}&limit=8`),
    enabled: customerSearch.trim().length > 0,
  });

  // The old gold on the counter: this customer's valued offers at this branch.
  const olds = useQuery({
    queryKey: ["ex-oldgold", branchId, customer?.id ?? ""],
    queryFn: () =>
      api<{ rows: OldGoldRow[]; total: number }>(
        `/api/v1/oldgold/items?customerId=${encodeURIComponent(customer!.id)}&status=VALUED&branchId=${encodeURIComponent(branchId)}&limit=50`
      ),
    enabled: Boolean(customer?.id) && Boolean(branchId),
  });

  const taxConfig = useQuery({
    queryKey: ["pos-tax-config"],
    queryFn: () => api<{ rateBp: number; label: string }>("/api/v1/sales/tax-config"),
    staleTime: 5 * 60_000,
  });
  const taxRateBp = taxConfig.data?.rateBp ?? 0;

  const banks = useQuery({
    queryKey: ["pos-bank-accounts", branchId],
    queryFn: () => api<BankAccount[]>(`/api/v1/sales/bank-accounts?branchId=${encodeURIComponent(branchId)}`),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const bankRows = banks.data ?? [];

  // Typed text that is not a scanner's code is a product search.
  const typed = scan.trim();
  const isSearch = typed.length >= 2 && !looksLikeCode(typed);
  const q = useDebounced(isSearch ? typed : "", 180);
  const catalog = useQuery({
    queryKey: ["ex-catalog", branchId, q],
    queryFn: () =>
      api<CatalogRow[]>(`/api/v1/sales/catalog?branchId=${encodeURIComponent(branchId)}&q=${encodeURIComponent(q)}&limit=10`),
    enabled: Boolean(branchId) && q.length >= 2,
    staleTime: 15_000,
  });
  const results = isSearch ? (catalog.data ?? []).filter((r) => !cart.some((l) => l.productId === r.id)) : [];

  function refocus() {
    setScan("");
    scanRef.current?.focus();
  }

  function addCode(raw: string) {
    const code = extractScanCode(raw);
    if (!code) return;
    if (code.startsWith("SINV-") || code.startsWith("OG-")) {
      toast.error(`${code} is not a piece tag — scan the jewellery to sell`);
      return refocus();
    }
    if (cartRef.current.some((l) => l.barcode === code)) {
      toast.error(`${code} is already in the exchange`);
      return refocus();
    }
    lookup.mutate(code);
  }

  const lookup = useMutation({
    mutationFn: lookupCode,
    onSuccess: (d) => {
      const ok = saleable(d, branchId);
      if ("error" in ok) {
        toast.error(ok.error);
        return refocus();
      }
      setCart((c) =>
        c.some((l) => l.productId === d.product.id)
          ? c
          : [
              ...c,
              {
                productId: d.product.id,
                barcode: d.product.barcode,
                name: d.product.name,
                karat: d.product.karat,
                priceCents: ok.price,
                listPriceCents: ok.price,
                discountCents: 0,
              },
            ]
      );
      refocus();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Lookup failed");
      refocus();
    },
  });

  // Same per-line rounding as the server, so the totals agree to the cent.
  const lineTax = (l: CartLine) => salesTaxCents(l.priceCents - l.discountCents, taxRateBp);
  const subtotal = cart.reduce((s, l) => s + l.priceCents, 0);
  const discount = cart.reduce((s, l) => s + l.discountCents, 0);
  const tax = cart.reduce((s, l) => s + lineTax(l), 0);
  const total = subtotal - discount + tax;
  const selected = (olds.data?.rows ?? []).filter((r) => oldIds.includes(r.id));
  const oldTotal = selected.reduce((s, r) => s + (r.purchase_value_cents ?? 0), 0);
  const diff = total - oldTotal;
  const paySum = pays.reduce((s, p) => s + cents(p.amountLkr), 0);
  const needsBank = bankRows.length > 1 && pays.some((p) => p.method === "bank" && !p.bankAccountId);
  const needsCustomer = pays.some((p) => p.method === "credit") && !customer;

  const canComplete =
    Boolean(customer) &&
    Boolean(branchId) &&
    oldIds.length > 0 &&
    cart.length > 0 &&
    total > 0 &&
    (diff > 0 ? paySum === diff && !needsBank && !needsCustomer : true) &&
    (diff < 0 ? oldTotal - total > 0 : true);

  function reset() {
    setCustomer(null);
    setCustomerSearch("");
    setOldIds([]);
    setCart([]);
    setPays([{ method: "cash", amountLkr: "" }]);
    setPayout("cash");
    setNotes("");
  }

  function toggleOld(id: string) {
    setOldIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  function setLine(i: number, patch: Partial<CartLine>) {
    setCart((c) => c.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function setPay(i: number, patch: Partial<PayRow>) {
    setPays((ps) => ps.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  function autoBalance() {
    const rest = diff - pays.slice(0, -1).reduce((s, p) => s + cents(p.amountLkr), 0);
    setPays((ps) => ps.map((p, i) => (i === ps.length - 1 ? { ...p, amountLkr: String(Math.max(0, rest) / 100) } : p)));
  }

  const submit = useMutation({
    mutationFn: () =>
      api<Done>("/api/v1/sales/exchanges", {
        method: "POST",
        body: JSON.stringify({
          customerId: customer!.id,
          branchId,
          oldGoldItemIds: oldIds,
          items: cart.map((l) => ({
            productId: l.productId,
            priceLkr: l.priceCents / 100,
            listPriceLkr: l.listPriceCents / 100,
            discountLkr: l.discountCents / 100,
          })),
          payments:
            diff > 0
              ? pays.map((p) => ({
                  method: p.method,
                  amountLkr: Number(p.amountLkr),
                  bankAccountId:
                    p.method === "bank" ? p.bankAccountId || (bankRows.length === 1 ? bankRows[0]!.id : undefined) : undefined,
                }))
              : [],
          payout: diff < 0 ? payout : "cash",
          notes: notes.trim() || undefined,
        }),
      }),
    onSuccess: (d) => {
      setDone(d);
      reset();
      toast.success(`Exchange ${d.number} complete`);
    },
    onError: (e) => {
      if (errorCode(e) === "CONFLICT" && e instanceof Error && e.message.includes("refresh")) {
        toast.error(e.message);
      } else {
        toast.error(e instanceof Error ? e.message : "Exchange failed");
      }
    },
  });

  const oldRows = olds.data?.rows ?? [];
  const steps = [
    { t: "Customer", done: Boolean(customer) },
    { t: "Old gold", done: oldIds.length > 0 },
    { t: "New pieces", done: cart.length > 0 },
    { t: "Settle", done: canComplete },
  ];
  const stepsDone = steps.filter((x) => x.done).length;
  const direction = diff > 0 ? "Customer pays" : diff < 0 ? (payout === "cash" ? "Shop pays · cash" : "Shop pays · store credit") : "Settled exactly";

  // The first thing still standing between the counter and "Complete".
  const blocker = !customer
    ? "Pick the customer whose gold is on the counter"
    : oldIds.length === 0
      ? "Tick at least one valued piece to trade in"
      : cart.length === 0
        ? "Scan the new pieces they are taking"
        : diff > 0 && paySum !== diff
          ? `Key payments totalling LKR ${fmt(diff)}`
          : needsBank
            ? "Choose the bank account"
            : needsCustomer
              ? "Credit needs a customer"
              : null;

  // Old gold against the bill, drawn to one scale.
  const scale = Math.max(total, oldTotal, 1);

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={ArrowLeftRightIcon}
        title="Old for new,"
        accent="settled to the cent"
        back={{ href: "/old-gold", label: "Old gold" }}
        badge={canComplete ? <HeroBadge tone="good">Ready to post</HeroBadge> : <HeroBadge>{stepsDone} of 4 steps</HeroBadge>}
        sub="Valued old gold is bought in and new pieces sold in one atomic batch — whoever is short pays the difference."
        actions={
          <>
            <Link href="/old-gold/testing" className={heroGhost}>
              <FlaskConicalIcon size={13} /> Testing
            </Link>
            <Link href="/old-gold/items?status=VALUED" className={heroGhost}>
              Valued items
            </Link>
          </>
        }
        stats={[
          {
            label: "Old gold offered",
            value: oldTotal,
            format: fmt,
            unit: "LKR",
            sub: customer ? `${selected.length} of ${oldRows.length} valued pieces` : "Pick the customer",
          },
          { label: "New pieces · with tax", value: total, format: fmt, unit: "LKR", sub: `${cart.length} ${cart.length === 1 ? "piece" : "pieces"} on the ticket` },
          { label: diff > 0 ? "Customer pays" : diff < 0 ? "Shop pays" : "Balance", value: Math.abs(diff), format: fmt, unit: "LKR", accent: true, sub: direction },
        ]}
      >
        <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {steps.map((x, i) => (
            <li key={x.t} className={cn("flex items-center gap-2.5 rounded-xl px-3 py-2 ring-1 ring-inset transition-colors duration-200", x.done ? "bg-gold/[0.14] ring-gold/40" : "bg-paper/[0.04] ring-paper/10")}>
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", x.done ? "bg-gradient-to-b from-gold-light to-gold text-void" : "text-paper/50 ring-1 ring-paper/20")}>
                {x.done ? <CheckIcon size={12} /> : <span className="g-metric">{i + 1}</span>}
              </span>
              <span className={cn("truncate text-[12px] font-medium", x.done ? "text-gold-light" : "text-paper/75")}>{x.t}</span>
            </li>
          ))}
        </ol>
      </GoldHero>

      {done ? (
        <section className="relative flex animate-pop-in flex-col gap-4 overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-50 via-emerald-50/60 to-paper px-4 py-4 ring-1 ring-emerald-600/15 lg:flex-row lg:items-center lg:justify-between">
          <div className="pointer-events-none absolute -left-10 -top-16 size-48 rounded-full bg-emerald-300/30 blur-3xl" aria-hidden />
          <div className="relative flex items-center gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-emerald-500 to-emerald-700 text-paper shadow-[0_12px_24px_-10px_rgba(5,150,105,0.7)]">
              <CheckCircleIcon size={22} />
            </span>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Exchange posted</div>
              <div className="g-display text-[20px] leading-tight text-ink">{done.number}</div>
              <div className="text-[11.5px] text-ink-4">Old gold bought in and new pieces sold in one batch</div>
            </div>
          </div>
          <dl className="relative grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-ink/[0.06] ring-1 ring-ink/[0.06]">
            {[
              { k: "Old gold in", v: done.oldGoldValueCents },
              { k: "New pieces", v: done.saleTotalCents },
              {
                k: done.shopPaysCents > 0 ? (done.payout === "cash" ? "Paid out · cash" : "Store credit") : "Customer paid",
                v: done.shopPaysCents > 0 ? done.shopPaysCents : done.customerPaysCents,
              },
            ].map((x) => (
              <div key={x.k} className="min-w-0 bg-paper/90 px-3.5 py-2">
                <dt className="truncate text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{x.k}</dt>
                <dd className="g-metric mt-0.5 truncate text-[14px] text-ink">LKR {fmt(x.v)}</dd>
              </div>
            ))}
          </dl>
          <div className="relative flex items-center gap-2">
            <Link href={`/sales/invoices/${done.invoiceId}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-paper px-3.5 text-[12.5px] font-medium text-ink ring-1 ring-inset ring-ink/10 transition-colors hover:bg-bone">
              <FileTextIcon size={14} /> Invoice
            </Link>
            <button onClick={() => setDone(null)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-void px-4 text-[12.5px] font-semibold text-paper transition-transform hover:-translate-y-px">
              Next exchange <ArrowRightIcon size={13} />
            </button>
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="min-w-0 space-y-4">
          {/* 1. The customer whose gold is on the counter */}
          <Card>
            <CardHead icon={UserCheckIcon} title="Customer" sub="The valued old gold must belong to them" action={<StepTag n={1} done={Boolean(customer)} />} />
            {customer ? (
              <div className="flex items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={customer.name} size="lg" />
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold text-ink">{customer.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-4">
                      {customer.code ? <span className="g-metric rounded bg-bone px-1.5 py-px text-[10.5px] text-ink-3">{customer.code}</span> : null}
                      {customer.phone ? <span>{customer.phone}</span> : null}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setCustomer(null);
                    setOldIds([]);
                  }}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-ink-4 ring-1 ring-inset ring-ink/10 transition-colors hover:bg-ink/[0.04] hover:text-ink"
                >
                  <XIcon size={13} /> Change
                </button>
              </div>
            ) : (
              <div className="p-4">
                <div className="relative">
                  <SearchIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-5" />
                  <input
                    className={cn(controlClass, "w-full pl-9")}
                    placeholder="Search customers by name, code or phone…"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                  />
                </div>
                {(customers.data?.rows ?? []).length > 0 ? (
                  <div className="mt-2 animate-pop-in divide-y divide-ink/[0.06] overflow-hidden rounded-xl bg-paper shadow-pop">
                    {(customers.data?.rows ?? []).map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setCustomer(c);
                          setCustomerSearch("");
                        }}
                        className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gold-pale/40"
                      >
                        <Avatar name={c.name} />
                        <span className="min-w-0 flex-1 truncate font-medium text-ink">{c.name}</span>
                        <span className="g-metric text-[11px] text-ink-4">{c.code || c.phone}</span>
                        <ArrowRightIcon size={13} className="text-ink-5 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                      </button>
                    ))}
                  </div>
                ) : customerSearch.trim() && !customers.isFetching ? (
                  <p className="mt-2 px-1 text-xs text-ink-4">No customer matches “{customerSearch}”.</p>
                ) : null}
              </div>
            )}
          </Card>

          {/* 2. The old gold on the counter */}
          <Card>
            <CardHead
              icon={ScaleIcon}
              title="Old gold taken in"
              sub={customer ? "Their valued offers, not yet bought — tap to trade in" : "Pick the customer first"}
              action={
                <>
                  {customer && oldRows.length > 1 ? (
                    <button
                      onClick={() => setOldIds(oldIds.length === oldRows.length ? [] : oldRows.map((r) => r.id))}
                      className="rounded-md px-2 py-1 text-[11px] font-medium text-gold-deep transition-colors hover:bg-gold-pale/50"
                    >
                      {oldIds.length === oldRows.length ? "Clear" : "Select all"}
                    </button>
                  ) : null}
                  <StepTag n={2} done={oldIds.length > 0} />
                </>
              }
            />
            {!customer ? (
              <Empty icon={UserCheckIcon} title="Waiting for a customer" desc="Their valued old gold appears here once you pick them above." />
            ) : olds.isLoading ? (
              <RowsSkeleton rows={2} />
            ) : oldRows.length === 0 ? (
              <Empty
                icon={GemIcon}
                title="Nothing valued yet"
                desc="Test and value their pieces on the Testing page first, then come back here."
                action={<HeadLink href="/old-gold/testing">Testing</HeadLink>}
              />
            ) : (
              <div className="grid gap-2 p-3 sm:grid-cols-2">
                {oldRows.map((r) => {
                  const on = oldIds.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      onClick={() => toggleOld(r.id)}
                      aria-pressed={on}
                      aria-label={`Take in ${r.number}`}
                      className={cn(
                        "group relative flex items-start gap-3 rounded-xl p-3 text-left ring-1 ring-inset transition-all duration-200 ease-brand",
                        on
                          ? "bg-gradient-to-br from-gold-pale/80 to-paper shadow-[0_12px_28px_-18px_rgba(205,168,83,0.9)] ring-gold/60"
                          : "bg-paper ring-ink/[0.09] hover:-translate-y-px hover:ring-gold/40 hover:shadow-2"
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md transition-all",
                          on ? "bg-gradient-to-b from-gold-light to-gold-deep text-void" : "ring-1 ring-inset ring-ink/20 group-hover:ring-gold/60"
                        )}
                      >
                        {on ? <CheckIcon size={12} /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="g-metric text-[11px] text-ink-4">{r.number}</span>
                          {r.karat ? <KaratTag k={permille(r.karat)} /> : null}
                        </span>
                        <span className="mt-0.5 block truncate text-[13.5px] font-medium text-ink">{r.description}</span>
                        <span className="mt-2 flex items-end justify-between gap-2">
                          <span className="text-[11px] text-ink-4">
                            <span className="g-metric text-ink-2">{grams(r.net_mg)}</span> g net
                          </span>
                          <span className={cn("g-metric text-[15px] font-semibold", on ? "text-gold-deep" : "text-ink")}>
                            {r.purchase_value_cents !== null ? `LKR ${fmt(r.purchase_value_cents)}` : "—"}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {/* 3. The new pieces they take home */}
          <Card>
            <CardHead
              icon={TagsIcon}
              title="New pieces sold"
              sub="Scan a tag or type to search"
              action={
                <>
                  <CameraScanButton onDetected={(code: string) => addCode(code)} />
                  <StepTag n={3} done={cart.length > 0} />
                </>
              }
            />
            <div className="p-4 pb-3">
              <div className="relative">
                <ScanBarcodeIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gold-deep" />
                <input
                  ref={scanRef}
                  className={cn(controlClass, "h-11 w-full pl-10 pr-20")}
                  placeholder="Scan tag / barcode, or type a name to search…"
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const pick = results[0];
                      if (pick) {
                        addCode(pick.barcode);
                      } else if (!isSearch) {
                        addCode(scan);
                      }
                    }
                  }}
                  autoFocus
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-bone px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-5">
                  {lookup.isPending ? "Looking…" : "Enter ↵"}
                </span>
              </div>
              {results.length > 0 ? (
                <div className="mt-2 animate-pop-in divide-y divide-ink/[0.06] overflow-hidden rounded-xl bg-paper shadow-pop">
                  {results.map((r, i) => (
                    <button
                      key={r.id}
                      onClick={() => addCode(r.barcode)}
                      className={cn("group flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gold-pale/40", i === 0 && "bg-gold-pale/20")}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <KaratTag k={r.karat} />
                        <span className="min-w-0 truncate font-medium text-ink">
                          {r.name} <span className="g-metric text-[11px] font-normal text-ink-4">· {r.barcode}</span>
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3 text-xs text-ink-4">
                        <span className="g-metric">{grams(r.net_mg)} g</span>
                        {r.price_cents !== null ? <span className="g-metric font-medium text-ink">LKR {fmt(r.price_cents)}</span> : null}
                        <PlusIcon size={14} className="text-gold-deep" />
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {cart.length > 0 ? (
              <div className="overflow-x-auto px-2 pb-2">
                <table className="w-full text-sm">
                  <thead className={thead}>
                    <tr>
                      <th className={cn(th, "pl-3")}>Piece</th>
                      <th className={cn(th, "text-right")}>Price LKR</th>
                      <th className={cn(th, "text-right")}>Discount LKR</th>
                      <th className={cn(th, "text-right")}>Line total</th>
                      <th className={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((l, i) => (
                      <tr key={l.productId} className={cn(tr, "animate-slide-in")}>
                        <td className="py-2.5 pl-3 pr-2">
                          <div className="flex items-center gap-2.5">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-gold-pale to-gold-soft/60 text-gold-deep ring-1 ring-inset ring-gold/30">
                              <GemIcon size={14} />
                            </span>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-ink">{l.name}</div>
                              <div className="flex items-center gap-1.5 text-[11px] text-ink-4">
                                <span className="g-metric">{l.barcode}</span>
                                <KaratTag k={l.karat} />
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          <input
                            className={cn(inputCls, "g-metric w-28 text-right")}
                            value={(l.priceCents / 100).toString()}
                            onChange={(e) => {
                              const n = Math.round(Number(e.target.value || 0) * 100);
                              if (Number.isFinite(n)) setLine(i, { priceCents: Math.max(0, n) });
                            }}
                            inputMode="decimal"
                            aria-label={`Price of ${l.name}`}
                          />
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          <input
                            className={cn(inputCls, "g-metric w-24 text-right")}
                            value={(l.discountCents / 100).toString()}
                            onChange={(e) => {
                              const n = Math.round(Number(e.target.value || 0) * 100);
                              if (Number.isFinite(n)) setLine(i, { discountCents: Math.max(0, Math.min(n, l.priceCents)) });
                            }}
                            inputMode="decimal"
                            aria-label={`Discount on ${l.name}`}
                          />
                        </td>
                        <td className="g-metric px-2 py-2.5 text-right font-medium text-ink">{fmt(l.priceCents - l.discountCents + lineTax(l))}</td>
                        <td className="px-2 py-2.5 text-right">
                          <button
                            onClick={() => setCart((c) => c.filter((_, j) => j !== i))}
                            className="rounded-lg p-1.5 text-ink-5 transition-colors hover:bg-rose-500/10 hover:text-rose-700"
                            aria-label={`Remove ${l.name}`}
                          >
                            <TrashIcon size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon={PlusIcon} title="Cart is empty" desc="Scan the pieces the customer is taking, then settle on the right." />
            )}
          </Card>
        </div>

        {/* 4. Settlement — whoever is short pays */}
        <aside className="min-w-0 lg:sticky lg:top-20">
          <Card>
            <div className="relative overflow-hidden bg-void px-5 pb-5 pt-4 text-paper">
              <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-30" />
              <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-gold/[0.2] blur-[80px]" />
              <div className="relative">
                <div className="flex items-center justify-between">
                  <span className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-paper/45">Settlement</span>
                  <StepTag n={4} done={canComplete} dark />
                </div>
                <div className="mt-3 text-[12px] font-medium text-gold-light">{direction}</div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-[11px] font-semibold text-paper/40">LKR</span>
                  <span className="g-metric text-[34px] leading-none text-paper">{fmt(Math.abs(diff))}</span>
                </div>

                <div className="mt-5 space-y-2.5">
                  {[
                    { k: "New pieces", v: total, bar: "bg-gradient-to-r from-paper/40 to-paper/80" },
                    { k: "Old gold", v: oldTotal, bar: "bg-gradient-to-r from-gold-deep to-gold-light" },
                  ].map((b) => (
                    <div key={b.k}>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-paper/55">{b.k}</span>
                        <span className="g-metric text-paper/85">{fmt(b.v)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paper/[0.08]">
                        <div className={cn("h-full rounded-full transition-[width] duration-700 ease-brand", b.bar)} style={{ width: `${(b.v / scale) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <dl className="space-y-1.5 px-5 py-4 text-[12.5px]">
              <Line k="Subtotal" v={`LKR ${fmt(subtotal)}`} />
              {discount > 0 ? <Line k="Discount" v={`− LKR ${fmt(discount)}`} /> : null}
              <Line k={taxConfig.data?.label ? `${taxConfig.data.label} (${taxRateBp / 100}%)` : "Tax"} v={`LKR ${fmt(tax)}`} />
              <Line k="New pieces total" v={`LKR ${fmt(total)}`} strong />
              <Line k={`Old gold · ${selected.length} ${selected.length === 1 ? "piece" : "pieces"}`} v={`− LKR ${fmt(oldTotal)}`} gold />
              <div className="!mt-3 border-t border-dashed border-ink/15 pt-3">
                <div className="flex items-center justify-between">
                  <dt className="font-semibold text-ink">{diff > 0 ? "Customer pays" : diff < 0 ? "Shop pays" : "Settled exactly"}</dt>
                  <dd className="g-metric text-[16px] font-semibold text-ink">LKR {fmt(Math.abs(diff))}</dd>
                </div>
              </div>
            </dl>

            {diff > 0 ? (
              <div className="space-y-2 border-t border-ink/[0.06] px-5 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-5">Payment</span>
                  <span className={cn("g-metric text-[11px]", paySum === diff ? "text-emerald-700" : "text-ink-4")}>
                    {fmt(paySum)} / {fmt(diff)}
                  </span>
                </div>
                {pays.map((p, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Select
                        className="w-28 shrink-0"
                        value={p.method}
                        onChange={(v: string) => setPay(i, { method: v, bankAccountId: undefined })}
                        options={METHODS.map((m) => ({ value: m, label: m[0]!.toUpperCase() + m.slice(1) }))}
                        ariaLabel={`Payment method ${i + 1}`}
                      />
                      <input
                        id={`ex-pay-${i}`}
                        className={cn(controlClass, "g-metric min-w-0 flex-1 text-right")}
                        value={p.amountLkr}
                        onChange={(e) => setPay(i, { amountLkr: e.target.value })}
                        inputMode="decimal"
                        placeholder="0"
                        aria-label={`Payment amount ${i + 1}`}
                      />
                      {pays.length > 1 ? (
                        <button
                          onClick={() => setPays((ps) => ps.filter((_, j) => j !== i))}
                          className="rounded-lg p-1.5 text-ink-5 transition-colors hover:bg-rose-500/10 hover:text-rose-700"
                          aria-label={`Remove payment ${i + 1}`}
                        >
                          <XIcon size={13} />
                        </button>
                      ) : null}
                    </div>
                    {p.method === "bank" && bankRows.length > 1 ? (
                      <Select
                        className="w-full"
                        value={p.bankAccountId ?? ""}
                        onChange={(v: string) => setPay(i, { bankAccountId: v || undefined })}
                        options={[{ value: "", label: "Choose bank…" }, ...bankRows.map((b) => ({ value: b.id, label: b.name }))]}
                        ariaLabel={`Bank account ${i + 1}`}
                      />
                    ) : null}
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs">
                  <button
                    onClick={() => setPays((ps) => [...ps, { method: "cash", amountLkr: "" }])}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 font-medium text-gold-deep transition-colors hover:bg-gold-pale/40"
                  >
                    <PlusIcon size={12} /> Split payment
                  </button>
                  <button onClick={autoBalance} className="rounded-lg px-2 py-1 font-medium text-ink-4 transition-colors hover:bg-ink/[0.04] hover:text-ink">
                    Fill the rest
                  </button>
                </div>
                {cart.length > 0 && paySum !== diff && paySum > 0 ? (
                  <Callout tone="warning" title={paySum > diff ? "Payments exceed the difference" : "Payments fall short"}>
                    They must sum to exactly LKR {fmt(diff)} — keyed {fmt(paySum)}.
                  </Callout>
                ) : null}
                {needsCustomer ? <Callout tone="warning" title="Credit needs a customer">Pick the customer taking the goods on credit.</Callout> : null}
                {needsBank ? <Callout tone="warning" title="Choose the bank account">A bank payment must name the account it went into.</Callout> : null}
              </div>
            ) : null}

            {diff < 0 ? (
              <div className="space-y-2 border-t border-ink/[0.06] px-5 py-4">
                <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-5">Pay the customer</span>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-bone/70 p-1">
                  {(
                    [
                      { v: "cash", label: "Cash", icon: BanknoteIcon },
                      { v: "store_credit", label: "Store credit", icon: GemIcon },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.v}
                      onClick={() => setPayout(o.v)}
                      aria-pressed={payout === o.v}
                      className={cn(
                        "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium transition-all",
                        payout === o.v ? "bg-void text-paper shadow-2" : "text-ink-3 hover:text-ink"
                      )}
                    >
                      <o.icon size={14} /> {o.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11.5px] leading-snug text-ink-4">
                  {payout === "cash"
                    ? `Hand LKR ${fmt(-diff)} over the counter — it posts as the old-gold settlement.`
                    : `LKR ${fmt(-diff)} stays on ${customer?.name ?? "the customer"}'s account, usable against a future bill.`}
                </p>
              </div>
            ) : null}

            <div className="space-y-3 border-t border-ink/[0.06] bg-bone/40 px-5 py-4">
              <textarea
                className={cn(controlClass, "h-auto min-h-[60px] w-full resize-none py-2")}
                placeholder="Notes (printed on the invoice)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
              <button
                disabled={!canComplete || submit.isPending}
                onClick={() => submit.mutate()}
                className="group relative flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-void text-[14px] font-semibold text-paper shadow-[inset_0_0_0_1px_rgba(205,168,83,0.35),0_14px_30px_-16px_rgba(6,42,34,0.8)] transition-all duration-200 ease-brand enabled:hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-gold-light/70 to-transparent" />
                <ArrowLeftRightIcon size={16} className="text-gold-light" />
                {submit.isPending ? "Posting…" : diff > 0 ? `Take LKR ${fmt(diff)} & complete` : diff < 0 ? `Pay out LKR ${fmt(-diff)} & complete` : "Complete exchange"}
              </button>
              {blocker && !submit.isPending ? (
                <p className="flex items-center justify-center gap-1.5 text-center text-[11.5px] text-ink-4">
                  <AlertCircleIcon size={13} className="shrink-0 text-gold-deep" /> {blocker}
                </p>
              ) : null}
            </div>
          </Card>
        </aside>
      </div>
    </Page>
  );
}

/** Numbered step marker for a card head; turns gold once the step is done. */
function StepTag({ n, done, dark }: { n: number; done: boolean; dark?: boolean }) {
  return (
    <span
      className={cn(
        "flex size-6 items-center justify-center rounded-full text-[10.5px] font-semibold transition-all duration-200",
        done ? "bg-gradient-to-b from-gold-light to-gold text-void shadow-[0_6px_14px_-8px_rgba(205,168,83,0.9)]" : dark ? "text-paper/50 ring-1 ring-inset ring-paper/20" : "text-ink-5 ring-1 ring-inset ring-ink/15"
      )}
      aria-label={done ? `Step ${n} done` : `Step ${n}`}
    >
      {done ? <CheckIcon size={12} /> : <span className="g-metric">{n}</span>}
    </span>
  );
}

function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold-light to-gold-deep font-semibold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]",
        size === "lg" ? "size-11 text-[14px]" : "size-7 text-[10.5px]"
      )}
    >
      {initials || "?"}
    </span>
  );
}

function Line({ k, v, strong, gold }: { k: string; v: string; strong?: boolean; gold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={cn("truncate", strong ? "font-medium text-ink" : "text-ink-4")}>{k}</dt>
      <dd className={cn("g-metric shrink-0", gold ? "text-gold-deep" : strong ? "font-medium text-ink" : "text-ink-2")}>{v}</dd>
    </div>
  );
}
