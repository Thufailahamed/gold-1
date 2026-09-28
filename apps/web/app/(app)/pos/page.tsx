"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  Page,
  Hero,
  Panel,
  TableCard,
  EmptyBlock,
  Callout,
  Pill,
  controlClass,
  controlSmClass,
} from "@/components/ui";
import { PlusIcon, ScanBarcodeIcon, TrashIcon } from "@/components/icons";

type Lookup = {
  product: {
    id: string;
    barcode: string;
    name: string;
    karat: string;
    net_mg: number;
    selling_price_cents: number | null;
  };
  livePrice: { amount_cents: number } | null;
};

type CartLine = {
  productId: string;
  barcode: string;
  name: string;
  karat: string;
  priceCents: number;
  discountCents: number;
};

type PayRow = { method: string; amountLkr: string };

type Customer = { id: string; name: string; code: string };

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return (
    document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? ""
  );
}

const METHODS = ["cash", "card", "bank", "credit", "other"];
const fmt = (c: number) => (c / 100).toLocaleString("en-US");

export default function PosPage() {
  const [scan, setScan] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [approver, setApprover] = useState("");
  const [pays, setPays] = useState<PayRow[]>([{ method: "cash", amountLkr: "" }]);
  const [done, setDone] = useState<{ invoiceId: string; number: string } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const [branchId] = useState(branchDefault);

  const customers = useQuery({
    queryKey: ["pos-customers", customerSearch],
    queryFn: () =>
      api<{ rows: Customer[]; total: number }>(
        `/api/v1/customers?search=${encodeURIComponent(customerSearch)}&limit=10`
      ),
    enabled: customerSearch.length > 0,
  });

  const lookup = useMutation({
    mutationFn: (code: string) => api<Lookup>(`/api/v1/products/barcode/${encodeURIComponent(code)}`),
    onSuccess: (d) => {
      if (cart.some((l) => l.productId === d.product.id)) {
        toast.error("Already in cart");
        return;
      }
      const price = d.product.selling_price_cents ?? d.livePrice?.amount_cents ?? 0;
      setCart((c) => [
        ...c,
        {
          productId: d.product.id,
          barcode: d.product.barcode,
          name: d.product.name,
          karat: d.product.karat,
          priceCents: price,
          discountCents: 0,
        },
      ]);
      setScan("");
      scanRef.current?.focus();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Lookup failed");
      setScan("");
    },
  });

  const subtotal = cart.reduce((s, l) => s + l.priceCents, 0);
  const discount = cart.reduce((s, l) => s + l.discountCents, 0);
  const total = subtotal - discount;
  const paidSum = pays.reduce((s, p) => s + Math.round(Number(p.amountLkr || 0) * 100), 0);
  const pct = subtotal > 0 ? (discount / subtotal) * 100 : 0;

  const complete = useMutation({
    mutationFn: () =>
      api<{ invoiceId: string; number: string }>("/api/v1/sales/invoices", {
        method: "POST",
        body: JSON.stringify({
          customerId: customerId || undefined,
          branchId,
          items: cart.map((l) => ({
            productId: l.productId,
            priceLkr: l.priceCents / 100,
            discountLkr: l.discountCents / 100,
          })),
          payments: pays.map((p) => ({ method: p.method, amountLkr: Number(p.amountLkr) })),
          approvedBy: approver || undefined,
        }),
      }),
    onSuccess: (d) => {
      setDone(d);
      setCart([]);
      setPays([{ method: "cash", amountLkr: "" }]);
      setApprover("");
      toast.success(`Sale ${d.number} complete`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Sale failed"),
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

  function autoBalance() {
    const rest = total - pays.slice(0, -1).reduce((s, p) => s + Math.round(Number(p.amountLkr || 0) * 100), 0);
    setPays((ps) => ps.map((p, i) => (i === ps.length - 1 ? { ...p, amountLkr: String(rest / 100) } : p)));
  }

  return (
    <Page>
      <Hero
        kicker="Sales"
        title="Point of sale"
        description="Scan pieces, apply discounts, split payments — Enter completes the sale."
        note="F2 scan · F9 pay · Enter completes the sale"
        meta={
          <>
            <Pill tone="ghost" className="!text-paper">{cart.length} item{cart.length === 1 ? "" : "s"}</Pill>
            <Pill tone="ghost" className="!text-paper">{fmt(total)} LKR due</Pill>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (scan.trim()) lookup.mutate(scan.trim());
          }}
          className="relative mt-6 flex gap-2"
        >
          <div className="relative flex-1">
            <ScanBarcodeIcon size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold" />
            <input
              ref={scanRef}
              autoFocus
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              placeholder="Scan barcode…"
              autoComplete="off"
              className="h-13 w-full rounded-xl bg-paper/10 py-3.5 pl-11 pr-4 font-mono text-lg text-paper placeholder:text-paper/35 shadow-[inset_0_0_0_1px_rgba(201,162,39,0.45)] transition-shadow focus:outline-none focus:shadow-[inset_0_0_0_2px_#C9A227,0_0_0_4px_rgba(201,162,39,0.2)]"
            />
          </div>
          <button type="submit" className="g-btn h-auto rounded-xl bg-gold px-5 text-sm font-medium text-ink transition-colors hover:bg-gold-light">
            Add
          </button>
        </form>
      </Hero>

      {done ? (
        <Callout tone="success" title={`Sale ${done.number} complete`}>
          <span className="flex flex-wrap items-center gap-3">
            <Link href={`/sales/invoices/${done.invoiceId}/print`} className="font-medium underline">
              Print invoice
            </Link>
            <button onClick={() => setDone(null)} className="font-medium underline">New sale</button>
          </span>
        </Callout>
      ) : null}

      <TableCard title="Cart" description={`${cart.length} item${cart.length === 1 ? "" : "s"} scanned`}>
        {cart.length === 0 ? (
          <EmptyBlock title="Cart is empty" description="Scan the first piece to start the sale." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Barcode</th>
                <th>Item</th>
                <th className="!text-right">Price</th>
                <th className="!text-right">Discount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cart.map((l, i) => (
                <tr key={l.productId}>
                  <td className="g-metric text-xs">{l.barcode}</td>
                  <td className="font-medium text-ink">{l.name} <span className="text-ink-4">· {l.karat}</span></td>
                  <td className="!text-right num-tabular">{fmt(l.priceCents)}</td>
                  <td className="!text-right">
                    <input
                      type="number"
                      step="any"
                      min={0}
                      value={l.discountCents / 100}
                      onChange={(e) =>
                        setLine(i, { discountCents: Math.round(Number(e.target.value || 0) * 100) })
                      }
                      className={`${controlSmClass} w-24 !text-right num-tabular`}
                    />
                  </td>
                  <td className="!text-right">
                    <button
                      onClick={() => setCart((c) => c.filter((_, j) => j !== i))}
                      aria-label="Remove"
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
        <Panel title="Customer" description="Optional — required for credit">
          <input
            placeholder="Search customers…"
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            className={`w-full ${controlClass}`}
          />
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={`mt-2 w-full ${controlClass}`}>
            <option value="">Walk-in</option>
            {(customers.data?.rows ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
            ))}
          </select>
        </Panel>
        <Panel title="Discount" description={`${pct.toFixed(1)}% of subtotal`}>
          <p className="num-tabular text-lg font-semibold text-ink">{fmt(discount)} LKR</p>
          <label className="mt-3 block text-sm text-ink-2">Approver user ID (over limit)
            <input
              placeholder="Manager/owner ID"
              value={approver}
              onChange={(e) => setApprover(e.target.value)}
              className={`mt-1 w-full ${controlClass}`}
            />
          </label>
        </Panel>
        <Panel title="Payment" description={`Total ${fmt(total)} LKR`}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (cart.length > 0 && paidSum === total && total > 0) complete.mutate();
            }}
          >
            {pays.map((p, i) => (
              <div key={i} className="mt-2 flex gap-2">
                <select
                  value={p.method}
                  onChange={(e) => setPays((ps) => ps.map((x, j) => (j === i ? { ...x, method: e.target.value } : x)))}
                  className={controlClass}
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <input
                  id={i === 0 ? "pos-pay-0" : undefined}
                  type="number"
                  step="any"
                  placeholder="Amount"
                  value={p.amountLkr}
                  onChange={(e) => setPays((ps) => ps.map((x, j) => (j === i ? { ...x, amountLkr: e.target.value } : x)))}
                  className={`num-tabular flex-1 ${controlClass}`}
                />
              </div>
            ))}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setPays((ps) => [...ps, { method: "cash", amountLkr: "" }])}
                className="g-btn g-btn-secondary h-8 px-2.5 text-xs"
              >
                <PlusIcon size={12} /> Split
              </button>
              <button type="button" onClick={autoBalance} className="g-btn g-btn-secondary h-8 px-2.5 text-xs">
                Auto-balance last
              </button>
            </div>
            <p className={`mt-3 num-tabular text-sm ${paidSum === total && total > 0 ? "font-semibold text-emerald-700" : "text-ink-3"}`}>
              Paid {fmt(paidSum)} / {fmt(total)}
            </p>
            <button
              type="submit"
              disabled={complete.isPending || cart.length === 0 || paidSum !== total || total <= 0}
              className="g-btn g-btn-primary mt-3 h-11 w-full text-sm"
            >
              {complete.isPending ? "Posting…" : "Complete sale (Enter)"}
            </button>
          </form>
        </Panel>
      </div>
    </Page>
  );
}
