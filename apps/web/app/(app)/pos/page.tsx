"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";

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

  const inputCls =
    "rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">POS</h1>
        <p className="text-sm text-stone-500">F2 scan · F9 pay · Enter completes</p>
      </div>
      {done ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm">
          Sale <span className="font-mono font-semibold">{done.number}</span> complete.{" "}
          <Link href={`/sales/invoices/${done.invoiceId}/print`} className="underline">
            Print invoice
          </Link>{" "}
          <button onClick={() => setDone(null)} className="ml-2 underline">New sale</button>
        </div>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (scan.trim()) lookup.mutate(scan.trim());
        }}
        className="flex gap-2"
      >
        <input
          ref={scanRef}
          autoFocus
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          placeholder="Scan barcode…"
          autoComplete="off"
          className="w-full max-w-md rounded-md border-2 border-gold px-4 py-3 font-mono text-lg outline-none"
        />
        <button type="submit" className="rounded-md bg-stone-900 px-4 py-2 text-sm text-white">
          Add
        </button>
      </form>
      {cart.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
          Cart is empty — scan the first piece.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
                <th className="px-4 py-2">Barcode</th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2 text-right">Price</th>
                <th className="px-4 py-2 text-right">Discount</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {cart.map((l, i) => (
                <tr key={l.productId} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{l.barcode}</td>
                  <td className="px-4 py-2">{l.name} · {l.karat}</td>
                  <td className="px-4 py-2 text-right">{(l.priceCents / 100).toLocaleString("en-US")}</td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      step="any"
                      min={0}
                      value={l.discountCents / 100}
                      onChange={(e) =>
                        setLine(i, { discountCents: Math.round(Number(e.target.value || 0) * 100) })
                      }
                      className="w-24 rounded border border-stone-300 px-2 py-1 text-right text-sm"
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => setCart((c) => c.filter((_, j) => j !== i))}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="font-medium">Customer (optional)</h2>
          <input
            placeholder="Search customers…"
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            className={`mt-2 ${inputCls}`}
          />
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={`mt-2 ${inputCls}`}>
            <option value="">Walk-in</option>
            {(customers.data?.rows ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
            ))}
          </select>
          <p className="mt-2 text-xs text-stone-500">Required for credit payments.</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="font-medium">Discount · {pct.toFixed(1)}%</h2>
          <p className="mt-1 text-sm text-stone-500">Total discount {(discount / 100).toLocaleString("en-US")} LKR</p>
          <label className="mt-2 block text-sm">Approver user ID (over limit)</label>
          <input
            placeholder="Manager/owner ID if over limit"
            value={approver}
            onChange={(e) => setApprover(e.target.value)}
            className={`mt-1 ${inputCls}`}
          />
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="font-medium">Total: {(total / 100).toLocaleString("en-US")} LKR</h2>
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
                className={inputCls}
              >
                {["cash", "card", "bank", "credit", "other"].map((m) => (
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
                className={inputCls}
              />
            </div>
          ))}
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => setPays((ps) => [...ps, { method: "cash", amountLkr: "" }])}
              className="rounded border px-2 py-1 text-xs"
            >
              + Split
            </button>
            <button onClick={autoBalance} className="rounded border px-2 py-1 text-xs">
              Auto-balance last
            </button>
          </div>
          <p className={`mt-2 text-sm ${paidSum === total ? "text-green-700" : "text-stone-500"}`}>
            Paid {(paidSum / 100).toLocaleString("en-US")} / {(total / 100).toLocaleString("en-US")}
          </p>
          <button
            type="submit"
            disabled={complete.isPending || cart.length === 0 || paidSum !== total || total <= 0}
            className="mt-2 w-full rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            Complete sale (Enter)
          </button>
          </form>
        </div>
      </div>
    </div>
  );
}
