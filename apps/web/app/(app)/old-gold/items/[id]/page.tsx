"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";

type Detail = {
  item: {
    id: string; number: string; customer_id: string; item_type: string; description: string;
    gross_mg: number; stone_mg: number; net_mg: number; purity_id: string | null;
    tested_permille: number | null; karat: string | null; fine_mg: number;
    rate_cents_per_g: number | null; buy_pct: number | null; stone_deduction_cents: number;
    processing_deduction_cents: number; negotiated_cents: number | null;
    purchase_value_cents: number | null; paid_cents: number; status: string;
    converted_product_id: string | null; notes: string | null;
    image_keys: string[]; doc_keys: string[];
  };
  customer: { name: string; code: string; phone: string | null } | null;
  tests: { id: string; method: string; tested_permille: number; result: string; approved_by: string | null; created_at: number }[];
  purchase: { value_cents: number; paid_cents: number; method: string } | null;
  journal: { id: string; account_code: string; debit_cents: number; credit_cents: number }[];
  gold: { id: string; direction: string; fine_mg: number }[];
  converted: { id: string; barcode: string; name: string; status: string } | null;
};

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
const inputCls = "mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold";

export default function OldGoldDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<null | "value" | "purchase" | "convert" | "void">(null);
  const detail = useQuery({
    queryKey: ["og-item", id],
    queryFn: () => api<Detail>(`/api/v1/oldgold/items/${id}`),
  });

  async function act(path: string, body: unknown, ok: string) {
    try {
      await api(`/api/v1/oldgold/items/${id}${path}`, { method: "POST", body: JSON.stringify(body) });
      toast.success(ok);
      qc.invalidateQueries({ queryKey: ["og-item", id] });
      qc.invalidateQueries({ queryKey: ["og-items"] });
      setDialog(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    }
  }

  async function voidIt(reason: string) {
    try {
      await api(`/api/v1/oldgold/items/${id}/void`, { method: "PATCH", body: JSON.stringify({ reason }) });
      toast.success("Voided");
      qc.invalidateQueries({ queryKey: ["og-item", id] });
      setDialog(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Void failed");
    }
  }

  if (detail.isLoading) return <div className="h-64 animate-pulse rounded-xl bg-stone-200" />;
  if (detail.isError || !detail.data) return <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">Item not found.</div>;
  const { item, customer, tests, purchase, journal, gold, converted } = detail.data;
  const fmt = (c: number) => (c / 100).toLocaleString("en-US");
  const g = (mg: number) => (mg / 1000).toLocaleString("en-US");

  return (
    <div className="space-y-4">
      <button onClick={() => router.push("/old-gold/items")} className="text-sm text-stone-500 hover:underline">← Items</button>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-mono text-xl font-semibold">{item.number}</h1>
          <p className="text-sm text-stone-500">{item.description} · {customer?.name ?? "—"} · {item.status}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {item.status === "TESTED" || item.status === "VALUED" ? (
            <button onClick={() => setDialog("value")} className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white">Value</button>
          ) : null}
          {item.status === "VALUED" ? (
            <button onClick={() => setDialog("purchase")} className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white">Purchase</button>
          ) : null}
          {item.status === "PURCHASED" ? (
            <ActionButton label="Release" onClick={() => act("/release", {}, "Released")} />
          ) : null}
          {item.status === "AVAILABLE" ? (
            <button onClick={() => setDialog("convert")} className="rounded-md border px-3 py-1.5 text-sm hover:bg-stone-100">Convert to product</button>
          ) : null}
          {["RECEIVED", "TESTED", "VALUED"].includes(item.status) ? (
            <button onClick={() => setDialog("void")} className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600">Void</button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["Gross", `${g(item.gross_mg)}g`],
          ["Net", `${g(item.net_mg)}g`],
          ["Tested", item.tested_permille !== null ? `${item.tested_permille}` : "—"],
          ["Fine gold", `${g(item.fine_mg)}g`],
          ["Board rate", item.rate_cents_per_g !== null ? `${fmt(item.rate_cents_per_g)}/g` : "—"],
          ["Buy %", item.buy_pct !== null ? `${item.buy_pct}%` : "—"],
          ["Value", item.purchase_value_cents !== null ? `${fmt(item.purchase_value_cents)} LKR` : "—"],
          ["Paid", `${fmt(item.paid_cents)} LKR`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-xs text-stone-500">{k}</p>
            <p className="mt-1 font-medium">{v}</p>
          </div>
        ))}
      </div>

      {item.negotiated_cents !== null ? <p className="text-sm text-stone-500">Negotiated total: {fmt(item.negotiated_cents)} LKR</p> : null}
      {converted ? <p className="text-sm">Converted → <a className="underline" href={`/products/${converted.id}`}>{converted.barcode} {converted.name}</a></p> : null}

      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="font-medium">Tests ({tests.length})</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {tests.map((t) => (
            <li key={t.id}>{t.method} · {t.tested_permille} · {t.result}{t.approved_by ? ` · approved ${t.approved_by.slice(0, 8)}` : ""}</li>
          ))}
        </ul>
      </div>

      {purchase ? (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="font-medium">Purchase</h2>
          <p className="mt-1 text-sm">Value {fmt(purchase.value_cents)} · Paid {fmt(purchase.paid_cents)} ({purchase.method})</p>
          <h3 className="mt-3 font-medium">Journal</h3>
          <ul className="mt-1 space-y-1 font-mono text-xs">
            {journal.map((j) => (
              <li key={j.id} className="flex justify-between"><span>{j.account_code}</span><span>{j.debit_cents ? `DR ${fmt(j.debit_cents)}` : `CR ${fmt(j.credit_cents)}`}</span></li>
            ))}
          </ul>
          <h3 className="mt-3 font-medium">Gold</h3>
          <ul className="mt-1 space-y-1 font-mono text-xs">
            {gold.map((m) => (
              <li key={m.id}>{m.direction} {g(m.fine_mg)}g fine</li>
            ))}
          </ul>
        </div>
      ) : null}

      {dialog === "value" ? <ValueDialog onSubmit={(b) => act("/value", b, "Valued")} onClose={() => setDialog(null)} /> : null}
      {dialog === "purchase" ? <PurchaseDialog maxLkr={item.purchase_value_cents !== null ? item.purchase_value_cents / 100 : 0} onSubmit={(b) => act("/purchase", b, "Purchased")} onClose={() => setDialog(null)} /> : null}
      {dialog === "convert" ? <ConvertDialog onSubmit={(b) => act("/convert", b, "Converted")} onClose={() => setDialog(null)} /> : null}
      {dialog === "void" ? <VoidDialog onSubmit={(r) => voidIt(r)} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button onClick={onClick} className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white">{label}</button>;
}

function ValueDialog({ onSubmit, onClose }: { onSubmit: (b: object) => void; onClose: () => void }) {
  const [buyPct, setBuyPct] = useState("");
  const [stone, setStone] = useState("");
  const [proc, setProc] = useState("");
  const [neg, setNeg] = useState("");
  const [reason, setReason] = useState("");
  return (
    <Dialog title="Valuation" onClose={onClose} onSubmit={() => onSubmit({
      ...(buyPct !== "" ? { buyPct: Number(buyPct) } : {}),
      stoneDeductionLkr: stone === "" ? 0 : Number(stone),
      processingDeductionLkr: proc === "" ? 0 : Number(proc),
      ...(neg !== "" ? { negotiatedLkr: Number(neg) } : {}),
      ...(reason !== "" ? { reason } : {}),
    })}>
      <label className="text-sm">Buy % (blank = settings default)<input value={buyPct} onChange={(e) => setBuyPct(e.target.value)} type="number" step="any" className={inputCls} /></label>
      <label className="text-sm">Stone deduction LKR<input value={stone} onChange={(e) => setStone(e.target.value)} type="number" step="any" className={inputCls} /></label>
      <label className="text-sm">Processing deduction LKR<input value={proc} onChange={(e) => setProc(e.target.value)} type="number" step="any" className={inputCls} /></label>
      <label className="text-sm">Negotiated total LKR (optional)<input value={neg} onChange={(e) => setNeg(e.target.value)} type="number" step="any" className={inputCls} /></label>
      <label className="text-sm">Reason (required for overrides)<input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} /></label>
    </Dialog>
  );
}

function PurchaseDialog({ maxLkr, onSubmit, onClose }: { maxLkr: number; onSubmit: (b: object) => void; onClose: () => void }) {
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState("cash");
  return (
    <Dialog title={`Purchase (value ${maxLkr.toLocaleString("en-US")} LKR)`} onClose={onClose} onSubmit={() => onSubmit({ paidLkr: Number(paid), method })}>
      <label className="text-sm">Paid now LKR<input value={paid} onChange={(e) => setPaid(e.target.value)} type="number" step="any" className={inputCls} /></label>
      <label className="text-sm">Method<select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}><option value="cash">Cash</option><option value="bank">Bank</option></select></label>
      <p className="text-xs text-stone-500">Remainder becomes a customer payable.</p>
    </Dialog>
  );
}

function ConvertDialog({ onSubmit, onClose }: { onSubmit: (b: object) => void; onClose: () => void }) {
  const [categoryId, setCategoryId] = useState("");
  const [metalTypeId, setMetalTypeId] = useState("");
  const [name, setName] = useState("");
  return (
    <Dialog title="Convert to sellable product" onClose={onClose} onSubmit={() => onSubmit({ categoryId, metalTypeId, name })}>
      <label className="text-sm">Category ID<input value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls} /></label>
      <label className="text-sm">Metal type ID<input value={metalTypeId} onChange={(e) => setMetalTypeId(e.target.value)} className={inputCls} /></label>
      <label className="text-sm">Name<input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></label>
    </Dialog>
  );
}

function VoidDialog({ onSubmit, onClose }: { onSubmit: (r: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog title="Void item" onClose={onClose} onSubmit={() => onSubmit(reason)}>
      <label className="text-sm">Reason<input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} /></label>
    </Dialog>
  );
}

function Dialog({ title, children, onClose, onSubmit }: { title: string; children: React.ReactNode; onClose: () => void; onSubmit: () => void }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-lg">
        <h2 className="font-semibold">{title}</h2>
        {children}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-2 text-sm">Cancel</button>
          <button onClick={onSubmit} className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white">Confirm</button>
        </div>
      </div>
    </div>
  );
}
