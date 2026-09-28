"use client";

import { use, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { LineageChain, type LineageNode, type LineageEdge } from "@/components/lineage-chain";
import {
  Page,
  Hero,
  Panel,
  StatGrid,
  StatCard,
  Pill,
  type PillTone,
  Modal,
  Skeleton,
  Callout,
  EmptyBlock,
  controlClass,
  heroBtnPrimary,
  heroBtnGhost,
} from "@/components/ui";

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

const TONES: Record<string, PillTone> = {
  RECEIVED: "warning",
  TESTED: "info",
  VALUED: "info",
  PURCHASED: "brand",
  AVAILABLE: "success",
  RESERVED_FOR_MELTING: "warning",
  MELTED: "dark",
  RESOLD: "neutral",
  TRANSFERRED: "info",
  VOID: "danger",
};

export default function OldGoldDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
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

  const fmt = (c: number) => (c / 100).toLocaleString("en-US");
  const g = (mg: number) => (mg / 1000).toLocaleString("en-US");

  if (detail.isLoading) {
    return (
      <Page>
        <Skeleton className="h-56" />
        <Skeleton className="h-64" />
      </Page>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Page>
        <Callout tone="danger" title="Item not found">
          This old-gold item does not exist or could not be loaded.{" "}
          <Link href="/old-gold/items" className="font-medium underline">Back to items</Link>
        </Callout>
      </Page>
    );
  }
  const { item, customer, tests, purchase, journal, gold, converted } = detail.data;

  return (
    <Page>
      <Hero
        back={{ href: "/old-gold/items", label: "Old gold items" }}
        kicker="Old gold"
        title={item.number}
        description={`${item.description} · ${customer?.name ?? "—"}${item.notes ? ` — ${item.notes}` : ""}`}
        meta={
          <>
            <Pill tone="ghost" className="!text-paper">{item.status.replace(/_/g, " ")}</Pill>
            {item.karat ? <Pill tone="ghost" className="!text-paper">{item.karat}</Pill> : null}
            {item.item_type ? <Pill tone="ghost" className="!text-paper">{item.item_type}</Pill> : null}
          </>
        }
        stats={[
          { label: "Net weight", value: `${g(item.net_mg)} g` },
          { label: "Fine gold", value: `${g(item.fine_mg)} g` },
          { label: "Value", value: item.purchase_value_cents !== null ? `${fmt(item.purchase_value_cents)} LKR` : "—" },
          { label: "Paid", value: `${fmt(item.paid_cents)} LKR` },
        ]}
        actions={
          <>
            {item.status === "TESTED" || item.status === "VALUED" ? (
              <button onClick={() => setDialog("value")} className={heroBtnPrimary}>Value</button>
            ) : null}
            {item.status === "VALUED" ? (
              <button onClick={() => setDialog("purchase")} className={heroBtnPrimary}>Purchase</button>
            ) : null}
            {item.status === "PURCHASED" ? (
              <button onClick={() => act("/release", {}, "Released")} className={heroBtnPrimary}>Release</button>
            ) : null}
            {item.status === "AVAILABLE" ? (
              <button onClick={() => setDialog("convert")} className={heroBtnGhost}>Convert to product</button>
            ) : null}
            {["RECEIVED", "TESTED", "VALUED"].includes(item.status) ? (
              <button onClick={() => setDialog("void")} className={`${heroBtnGhost} !text-rose-300`}>Void</button>
            ) : null}
          </>
        }
      />

      <StatGrid>
        <StatCard label="Gross" value={`${g(item.gross_mg)}g`} />
        <StatCard label="Net" value={`${g(item.net_mg)}g`} />
        <StatCard label="Tested" value={item.tested_permille !== null ? `${item.tested_permille}‰` : "—"} />
        <StatCard label="Board rate" value={item.rate_cents_per_g !== null ? `${fmt(item.rate_cents_per_g)}/g` : "—"} />
      </StatGrid>

      {item.negotiated_cents !== null ? (
        <Callout tone="info" title="Negotiated total">
          {fmt(item.negotiated_cents)} LKR overrides the computed value.
        </Callout>
      ) : null}
      {converted ? (
        <Callout tone="success" title="Converted to product">
          <Link className="font-medium underline" href={`/products/${converted.id}`}>
            {converted.barcode} — {converted.name}
          </Link>
        </Callout>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Tests" description={`${tests.length} recorded`}>
          {tests.length === 0 ? (
            <EmptyBlock title="No tests" description="Record a purity test from the testing queue." />
          ) : (
            <ul className="space-y-2.5 text-sm">
              {tests.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3">
                  <span className="text-ink-2">
                    <span className="capitalize">{t.method.replace(/_/g, " ")}</span>
                    <span className="g-metric ml-2 text-xs text-ink-4">{t.tested_permille}‰</span>
                    {t.approved_by ? <span className="ml-2 text-xs text-ink-4">· approved {t.approved_by.slice(0, 8)}</span> : null}
                  </span>
                  <Pill tone={t.result === "pass" ? "success" : t.result === "fail" ? "danger" : "warning"} dot>{t.result}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {purchase ? (
          <Panel title="Purchase" description={`Paid ${fmt(purchase.paid_cents)} of ${fmt(purchase.value_cents)} LKR`}>
            <ul className="space-y-2 g-metric text-xs">
              {journal.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-3">
                  <span className="text-ink-3">{j.account_code}</span>
                  <span className="text-ink">{j.debit_cents ? `DR ${fmt(j.debit_cents)}` : `CR ${fmt(j.credit_cents)}`}</span>
                </li>
              ))}
            </ul>
            <p className="g-kicker mt-4 !text-[10px]">Gold movements</p>
            <ul className="mt-2 space-y-2 g-metric text-xs">
              {gold.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3">
                  <span className="text-ink-3">{m.direction}</span>
                  <span className="text-ink">{g(m.fine_mg)}g fine</span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>

      <Panel title="Gold lineage" description="Intake → melt → lot → product">
        <OldGoldLineage id={id} />
      </Panel>

      {dialog === "value" ? <ValueDialog onSubmit={(b) => act("/value", b, "Valued")} onClose={() => setDialog(null)} /> : null}
      {dialog === "purchase" ? <PurchaseDialog maxLkr={item.purchase_value_cents !== null ? item.purchase_value_cents / 100 : 0} onSubmit={(b) => act("/purchase", b, "Purchased")} onClose={() => setDialog(null)} /> : null}
      {dialog === "convert" ? <ConvertDialog onSubmit={(b) => act("/convert", b, "Converted")} onClose={() => setDialog(null)} /> : null}
      {dialog === "void" ? <VoidDialog onSubmit={(r) => voidIt(r)} onClose={() => setDialog(null)} /> : null}
    </Page>
  );
}

function OldGoldLineage({ id }: { id: string }) {
  const lineage = useQuery({
    queryKey: ["og-lineage", id],
    queryFn: () =>
      api<{ nodes: LineageNode[]; edges: LineageEdge[] }>(
        `/api/v1/gold/lineage?refEntity=old_gold&refId=${id}`
      ),
  });
  if (lineage.isLoading) return <Skeleton className="h-10" />;
  if (lineage.isError || !lineage.data) return <EmptyBlock title="Lineage unavailable" description="Could not load the gold lineage." />;
  return <LineageChain nodes={lineage.data.nodes} edges={lineage.data.edges} />;
}

function ValueDialog({ onSubmit, onClose }: { onSubmit: (b: object) => void; onClose: () => void }) {
  const [buyPct, setBuyPct] = useState("");
  const [stone, setStone] = useState("");
  const [proc, setProc] = useState("");
  const [neg, setNeg] = useState("");
  const [reason, setReason] = useState("");
  return (
    <Modal kicker="Old gold" title="Valuation" onClose={onClose} onSubmit={() => onSubmit({
      ...(buyPct !== "" ? { buyPct: Number(buyPct) } : {}),
      stoneDeductionLkr: stone === "" ? 0 : Number(stone),
      processingDeductionLkr: proc === "" ? 0 : Number(proc),
      ...(neg !== "" ? { negotiatedLkr: Number(neg) } : {}),
      ...(reason !== "" ? { reason } : {}),
    })} submitLabel="Value">
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm text-ink-2">Buy % (blank = default)<input value={buyPct} onChange={(e) => setBuyPct(e.target.value)} type="number" step="any" className={`num-tabular ${controlClass}`} /></label>
        <label className="block text-sm text-ink-2">Stone deduction LKR<input value={stone} onChange={(e) => setStone(e.target.value)} type="number" step="any" className={`num-tabular ${controlClass}`} /></label>
        <label className="block text-sm text-ink-2">Processing deduction LKR<input value={proc} onChange={(e) => setProc(e.target.value)} type="number" step="any" className={`num-tabular ${controlClass}`} /></label>
        <label className="block text-sm text-ink-2">Negotiated total LKR<input value={neg} onChange={(e) => setNeg(e.target.value)} type="number" step="any" className={`num-tabular ${controlClass}`} /></label>
      </div>
      <label className="block text-sm text-ink-2">Reason (required for overrides)
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={controlClass} />
      </label>
    </Modal>
  );
}

function PurchaseDialog({ maxLkr, onSubmit, onClose }: { maxLkr: number; onSubmit: (b: object) => void; onClose: () => void }) {
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState("cash");
  return (
    <Modal
      kicker="Old gold"
      title={`Purchase — value ${maxLkr.toLocaleString("en-US")} LKR`}
      onClose={onClose}
      onSubmit={() => onSubmit({ paidLkr: Number(paid), method })}
      submitDisabled={!paid}
      submitLabel="Purchase"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm text-ink-2">Paid now LKR
          <input value={paid} onChange={(e) => setPaid(e.target.value)} type="number" step="any" className={`num-tabular ${controlClass}`} />
        </label>
        <label className="block text-sm text-ink-2">Method
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={controlClass}>
            <option value="cash">Cash</option>
            <option value="bank">Bank</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-ink-4">Remainder becomes a customer payable.</p>
    </Modal>
  );
}

function ConvertDialog({ onSubmit, onClose }: { onSubmit: (b: object) => void; onClose: () => void }) {
  const [categoryId, setCategoryId] = useState("");
  const [metalTypeId, setMetalTypeId] = useState("");
  const [name, setName] = useState("");
  return (
    <Modal kicker="Old gold" title="Convert to sellable product" onClose={onClose} onSubmit={() => onSubmit({ categoryId, metalTypeId, name })} submitLabel="Convert">
      <label className="block text-sm text-ink-2">Category ID<input value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={controlClass} /></label>
      <label className="block text-sm text-ink-2">Metal type ID<input value={metalTypeId} onChange={(e) => setMetalTypeId(e.target.value)} className={controlClass} /></label>
      <label className="block text-sm text-ink-2">Name<input value={name} onChange={(e) => setName(e.target.value)} className={controlClass} /></label>
    </Modal>
  );
}

function VoidDialog({ onSubmit, onClose }: { onSubmit: (r: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal kicker="Old gold" title="Void item" danger onClose={onClose} onSubmit={() => onSubmit(reason)} submitLabel="Void">
      <label className="block text-sm text-ink-2">Reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={controlClass} />
      </label>
    </Modal>
  );
}
