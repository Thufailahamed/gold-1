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
import { ArrowLeftRightIcon, BanknoteIcon, CheckCircleIcon, GemIcon, PlusIcon, ScaleIcon, SearchIcon, TagsIcon, TrashIcon, UserCheckIcon, XIcon } from "@/components/icons";
import { Card, CardHead, Empty, GoldHero, HeroBadge, lkr, grams, permille, th, thead, tr } from "../kit";

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

  return (
    <Page className="space-y-4">
      {done ? (
        <Card>
          <CardHead icon={CheckCircleIcon} title={`Exchange ${done.number} complete`} sub="The old gold was bought in and the new pieces sold in one batch" />
          <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
            <div className="rounded-xl bg-bone/50 px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-5">Old gold taken in</div>
              <div className="g-metric mt-1 text-ink">LKR {fmt(done.oldGoldValueCents)}</div>
            </div>
            <div className="rounded-xl bg-bone/50 px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-5">New pieces sold</div>
              <div className="g-metric mt-1 text-ink">LKR {fmt(done.saleTotalCents)}</div>
            </div>
            <div className={cn("rounded-xl px-4 py-3", done.shopPaysCents > 0 ? "bg-amber-500/10" : "bg-bone/50")}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-5">
                {done.shopPaysCents > 0 ? (done.payout === "cash" ? "Paid to customer (cash)" : "Left as store credit") : "Customer paid"}
              </div>
              <div className="g-metric mt-1 text-ink">LKR {fmt(done.shopPaysCents > 0 ? done.shopPaysCents : done.customerPaysCents)}</div>
            </div>
            <div className="flex items-end justify-between gap-3 px-4 py-3">
              <Link href={`/sales/invoices/${done.invoiceId}`} className="text-sm font-medium text-gold-deep underline">
                Open invoice {done.number}
              </Link>
              <button onClick={() => setDone(null)} className="rounded-xl bg-void px-4 py-2 text-sm font-medium text-paper">
                Next exchange
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      {/* 1. The customer whose gold is on the counter */}
      <Card>
        <CardHead icon={UserCheckIcon} title="Customer" sub="The valued old gold must belong to them" />
        {customer ? (
          <div className="flex items-center justify-between gap-3 px-4 pb-4">
            <div>
              <div className="font-medium text-ink">{customer.name}</div>
              <div className="text-xs text-ink-4">{customer.code || customer.phone || customer.id}</div>
            </div>
            <button
              onClick={() => {
                setCustomer(null);
                setOldIds([]);
              }}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-ink-4 hover:bg-ink/[0.04] hover:text-ink"
            >
              <XIcon size={13} /> Change
            </button>
          </div>
        ) : (
          <div className="px-4 pb-4">
            <input
              className={controlClass}
              placeholder="Search customers by name, code or phone…"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
            />
            {(customers.data?.rows ?? []).length > 0 ? (
              <div className="mt-2 divide-y divide-ink/[0.06] overflow-hidden rounded-xl ring-1 ring-ink/[0.08]">
                {(customers.data?.rows ?? []).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setCustomer(c);
                      setCustomerSearch("");
                    }}
                    className="flex w-full items-center justify-between gap-3 bg-paper px-3 py-2.5 text-left hover:bg-gold-pale/40"
                  >
                    <span className="font-medium text-ink">{c.name}</span>
                    <span className="text-xs text-ink-4">{c.code || c.phone}</span>
                  </button>
                ))}
              </div>
            ) : customerSearch.trim() ? (
              <p className="mt-2 text-xs text-ink-4">No customer matches “{customerSearch}”.</p>
            ) : null}
          </div>
        )}
      </Card>

      {/* 2. The old gold on the counter */}
      <Card>
        <CardHead icon={ScaleIcon} title="Old gold taken in" sub={customer ? "Their valued offers, not yet bought" : "Pick the customer first"} />
        {customer ? (
          olds.isLoading ? (
            <div className="px-4 pb-4 text-sm text-ink-4">Loading…</div>
          ) : (olds.data?.rows ?? []).length === 0 ? (
            <div className="px-4 pb-4">
              <Empty icon={GemIcon} title="Nothing valued yet" desc="Test and value their pieces on the Testing page first, then come back here." />
            </div>
          ) : (
            <div className="overflow-x-auto px-2 pb-4">
              <table className="w-full text-sm">
                <thead className={thead}>
                  <tr>
                    <th className={th}></th>
                    <th className={th}>Number</th>
                    <th className={th}>Description</th>
                    <th className={th}>Karat</th>
                    <th className={cn(th, "text-right")}>Net g</th>
                    <th className={cn(th, "text-right")}>Offered</th>
                  </tr>
                </thead>
                <tbody>
                  {(olds.data?.rows ?? []).map((r) => (
                    <tr key={r.id} className={cn(tr, oldIds.includes(r.id) && "bg-gold-pale/40")}>
                      <td className="px-2 py-2">
                        <input type="checkbox" checked={oldIds.includes(r.id)} onChange={() => toggleOld(r.id)} className="size-4 accent-gold-deep" aria-label={`Take in ${r.number}`} />
                      </td>
                      <td className="g-metric px-2 py-2">{r.number}</td>
                      <td className="px-2 py-2 text-ink">{r.description}</td>
                      <td className="px-2 py-2">{permille(r.karat)}</td>
                      <td className="g-metric px-2 py-2 text-right">{grams(r.net_mg)}</td>
                      <td className="g-metric px-2 py-2 text-right font-medium">{r.purchase_value_cents !== null ? `LKR ${fmt(r.purchase_value_cents)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </Card>

      {/* 3. The new pieces they take home */}
      <Card>
        <CardHead
          icon={TagsIcon}
          title="New pieces sold"
          sub="Scan a tag or type to search"
          action={
            <div className="flex items-center gap-2">
              <CameraScanButton onDetected={(code: string) => addCode(code)} />
            </div>
          }
        />
        <div className="px-4 pb-2">
          <div className="relative">
            <SearchIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-5" />
            <input
              ref={scanRef}
              className={cn(controlClass, "pl-9")}
              placeholder="Scan tag / barcode, or type name to search…"
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
          </div>
          {results.length > 0 ? (
            <div className="mt-2 divide-y divide-ink/[0.06] overflow-hidden rounded-xl ring-1 ring-ink/[0.08]">
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => addCode(r.barcode)}
                  className="flex w-full items-center justify-between gap-3 bg-paper px-3 py-2.5 text-left hover:bg-gold-pale/40"
                >
                  <span className="min-w-0 truncate font-medium text-ink">
                    {r.name} <span className="text-ink-4">· {r.barcode}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-ink-4">
                    {r.karat} · {grams(r.net_mg)}g
                    {r.price_cents !== null ? <span className="g-metric">LKR {fmt(r.price_cents)}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {cart.length > 0 ? (
          <div className="overflow-x-auto px-2 pb-4">
            <table className="w-full text-sm">
              <thead className={thead}>
                <tr>
                  <th className={th}>Piece</th>
                  <th className={cn(th, "text-right")}>Price LKR</th>
                  <th className={cn(th, "text-right")}>Discount LKR</th>
                  <th className={cn(th, "text-right")}>Line total</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((l, i) => (
                  <tr key={l.productId} className={tr}>
                    <td className="px-2 py-2">
                      <div className="font-medium text-ink">{l.name}</div>
                      <div className="text-[11px] text-ink-4">
                        {l.barcode} · {l.karat}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        className={cn(controlClass, "w-28 text-right g-metric")}
                        value={(l.priceCents / 100).toString()}
                        onChange={(e) => {
                          const n = Math.round(Number(e.target.value || 0) * 100);
                          if (Number.isFinite(n)) setLine(i, { priceCents: Math.max(0, n) });
                        }}
                        inputMode="decimal"
                        aria-label={`Price of ${l.name}`}
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        className={cn(controlClass, "w-24 text-right g-metric")}
                        value={(l.discountCents / 100).toString()}
                        onChange={(e) => {
                          const n = Math.round(Number(e.target.value || 0) * 100);
                          if (Number.isFinite(n)) setLine(i, { discountCents: Math.max(0, Math.min(n, l.priceCents)) });
                        }}
                        inputMode="decimal"
                        aria-label={`Discount on ${l.name}`}
                      />
                    </td>
                    <td className="g-metric px-2 py-2 text-right">
                      {fmt(l.priceCents - l.discountCents + lineTax(l))}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button onClick={() => setCart((c) => c.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-ink-5 hover:bg-rose-500/10 hover:text-rose-700" aria-label={`Remove ${l.name}`}>
                        <TrashIcon size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 pb-4">
            <Empty icon={PlusIcon} title="Cart is empty" desc="Scan the pieces the customer is taking, then settle below." />
          </div>
        )}
      </Card>

      {/* 4. Settlement — whoever is short pays */}
      <Card>
        <CardHead icon={ArrowLeftRightIcon} title="Settlement" sub="Old gold against the bill, to the cent" />
        <div className="space-y-1 px-4 pb-2 text-sm">
          <div className="flex items-center justify-between px-1 py-1">
            <span className="text-ink-4">New pieces (with tax)</span>
            <span className="g-metric text-ink">LKR {fmt(total)}</span>
          </div>
          <div className="flex items-center justify-between px-1 py-1">
            <span className="text-ink-4">Old gold offered</span>
            <span className="g-metric text-ink">− LKR {fmt(oldTotal)}</span>
          </div>
          <div className={cn("flex items-center justify-between rounded-xl px-3 py-2", diff > 0 ? "bg-bone/60" : "bg-amber-500/10")}>
            <span className="font-medium text-ink">{diff > 0 ? "Customer pays" : diff < 0 ? "Shop pays" : "Settled exactly"}</span>
            <span className="g-metric font-semibold text-ink">{diff !== 0 ? `LKR ${fmt(Math.abs(diff))}` : "LKR 0"}</span>
          </div>
        </div>

        {diff > 0 ? (
          <div className="space-y-2 px-4 pb-4">
            {pays.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select
                  className="w-32"
                  value={p.method}
                  onChange={(v: string) => setPay(i, { method: v, bankAccountId: undefined })}
                  options={METHODS.map((m) => ({ value: m, label: m[0]!.toUpperCase() + m.slice(1) }))}
                  aria-label={`Payment method ${i + 1}`}
                />
                <input
                  id={`ex-pay-${i}`}
                  className={cn(controlClass, "w-36 text-right g-metric")}
                  value={p.amountLkr}
                  onChange={(e) => setPay(i, { amountLkr: e.target.value })}
                  inputMode="decimal"
                  placeholder="0"
                  aria-label={`Payment amount ${i + 1}`}
                />
                {p.method === "bank" && bankRows.length > 1 ? (
                  <Select
                    className="w-56"
                    value={p.bankAccountId ?? ""}
                    onChange={(v: string) => setPay(i, { bankAccountId: v || undefined })}
                    options={[{ value: "", label: "Choose bank…" }, ...bankRows.map((b) => ({ value: b.id, label: b.name }))]}
                    aria-label={`Bank account ${i + 1}`}
                  />
                ) : null}
                {pays.length > 1 ? (
                  <button onClick={() => setPays((ps) => ps.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-ink-5 hover:bg-rose-500/10 hover:text-rose-700" aria-label={`Remove payment ${i + 1}`}>
                    <XIcon size={13} />
                  </button>
                ) : null}
              </div>
            ))}
            <div className="flex items-center justify-between text-xs">
              <button
                onClick={() => setPays((ps) => [...ps, { method: "cash", amountLkr: "" }])}
                className="rounded-lg px-2 py-1 font-medium text-gold-deep hover:bg-gold-pale/40"
              >
                + Split payment
              </button>
              <button onClick={autoBalance} className="rounded-lg px-2 py-1 font-medium text-ink-4 hover:bg-ink/[0.04] hover:text-ink">
                Fill the rest
              </button>
            </div>
            {paySum !== diff ? (
              <Callout tone="warning" title={paySum > diff ? "Payments exceed the difference" : "Payments fall short"}>
                They must sum to exactly LKR {fmt(diff)} — keyed {fmt(paySum)}.
              </Callout>
            ) : null}
            {needsCustomer ? <Callout tone="warning" title="Credit needs a customer">Pick the customer taking the goods on credit.</Callout> : null}
            {needsBank ? <Callout tone="warning" title="Choose the bank account">A bank payment must name the account it went into.</Callout> : null}
          </div>
        ) : null}

        {diff < 0 ? (
          <div className="space-y-2 px-4 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setPayout("cash")}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium ring-1 ring-inset transition-colors",
                  payout === "cash" ? "bg-void text-paper ring-void" : "bg-paper text-ink ring-ink/10 hover:bg-ink/[0.03]"
                )}
              >
                <BanknoteIcon size={15} /> Cash from the drawer
              </button>
              <button
                onClick={() => setPayout("store_credit")}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium ring-1 ring-inset transition-colors",
                  payout === "store_credit" ? "bg-void text-paper ring-void" : "bg-paper text-ink ring-ink/10 hover:bg-ink/[0.03]"
                )}
              >
                <GemIcon size={15} /> Leave on their account as store credit
              </button>
            </div>
            <p className="text-xs text-ink-4">
              {payout === "cash"
                ? `Hand LKR ${fmt(-diff)} over the counter — it posts as the old-gold settlement.`
                : `LKR ${fmt(-diff)} stays on ${customer?.name ?? "the customer"}'s account, usable against a future bill.`}
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/[0.06] px-4 py-3">
          <input className={cn(controlClass, "max-w-sm flex-1")} placeholder="Notes (printed on the invoice)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button
            disabled={!canComplete || submit.isPending}
            onClick={() => submit.mutate()}
            className="flex items-center gap-2 rounded-xl bg-void px-5 py-2.5 text-sm font-semibold text-paper shadow-[0_10px_24px_-14px_rgba(6,42,34,0.7)] transition-all disabled:opacity-40"
          >
            <ArrowLeftRightIcon size={15} />
            {submit.isPending ? "Posting…" : `Complete exchange`}
          </button>
        </div>
        {!canComplete && customer && cart.length > 0 && oldIds.length === 0 ? (
          <div className="px-4 pb-4">
            <Callout tone="info" title="Tick the old gold">Select at least one valued item to trade in.</Callout>
          </div>
        ) : null}
      </Card>
    </Page>
  );
}
