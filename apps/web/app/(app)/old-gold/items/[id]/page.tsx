"use client";

import { use, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { LineageChain, type LineageNode, type LineageEdge } from "@/components/lineage-chain";
import {
  Page,
  Pill,
  Modal,
  Skeleton,
  Callout,
  EmptyBlock,
  controlClass,
} from "@/components/ui";
import { ArchiveIcon, BanknoteIcon, CheckIcon, CreditCardIcon, FlaskConicalIcon, GemIcon, HistoryIcon, PackageIcon, ScaleIcon, UsersIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { Card, CardHead, Empty, GoldHero, HeroBadge, STAGES, ShareBar, grams, heroGhost, heroGold, lkr, stamp, statusText, th, thead, tr } from "../../kit";

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

export default function OldGoldDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<null | "value" | "purchase" | "convert" | "void">(null);
  const detail = useQuery({
    queryKey: ["og-item", id],
    queryFn: () => api<Detail>(`/api/v1/oldgold/items/${id}`),
  });

  const [busy, setBusy] = useState(false);

  // Every old-gold list and report reads these keys; a step here moves the item
  // between them.
  function refresh() {
    for (const key of ["og-item", "og-items", "og-lineage", "og-summary", "og-breakdown", "og-pending", "og-dash", "og-queue", "og-retest"])
      qc.invalidateQueries({ queryKey: [key] });
  }

  async function act(path: string, body: unknown, ok: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/v1/oldgold/items/${id}${path}`, { method: "POST", body: JSON.stringify(body) });
      toast.success(ok);
      refresh();
      setDialog(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function voidIt(reason: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/v1/oldgold/items/${id}/void`, { method: "PATCH", body: JSON.stringify({ reason }) });
      toast.success("Voided");
      refresh();
      setDialog(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Void failed");
    } finally {
      setBusy(false);
    }
  }

  const fmt = (c: number) => (c / 100).toLocaleString("en-US");
  const g = (mg: number) => (mg / 1000).toLocaleString("en-US");

  if (detail.isLoading) {
    return (
      <Page className="space-y-4">
        <Skeleton className="h-44 rounded-[20px]" />
        <Skeleton className="h-72 rounded-2xl" />
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
  const owed = purchase ? purchase.value_cents - purchase.paid_cents : 0;
  const paidShare = purchase && purchase.value_cents > 0 ? Math.min(1, purchase.paid_cents / purchase.value_cents) : 0;
  const stoneShare = item.gross_mg > 0 ? (item.stone_mg / item.gross_mg) * 100 : 0;
  const atBoard = item.rate_cents_per_g !== null ? (item.fine_mg / 1000) * item.rate_cents_per_g : null;
  const atBuy = atBoard !== null && item.buy_pct !== null ? atBoard * (item.buy_pct / 100) : null;
  const perFineG = item.purchase_value_cents !== null && item.fine_mg > 0 ? (item.purchase_value_cents / item.fine_mg) * 1000 : null;
  const stageIdx = STAGES.findIndex((s) => s.status === item.status);
  const offFlow = stageIdx < 0;
  const debit = journal.reduce((n, j) => n + j.debit_cents, 0);
  const credit = journal.reduce((n, j) => n + j.credit_cents, 0);
  const row = (k: string, v: string, tone = "text-ink") => (
    <div key={k} className="flex items-center justify-between gap-3 px-4 py-1.5">
      <dt className="text-ink-4">{k}</dt>
      <dd className={cn("g-metric", tone)}>{v}</dd>
    </div>
  );

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={ScaleIcon}
        title={<span className={cn(item.status === "VOID" && "line-through decoration-paper/40")}>{item.number}</span>}
        back={{ href: "/old-gold/items", label: "Old gold items" }}
        badge={
          <>
            <HeroBadge tone={item.status === "VOID" ? "bad" : item.status === "AVAILABLE" ? "good" : item.status === "MELTED" || item.status === "RESOLD" ? "muted" : "gold"}>{statusText(item.status)}</HeroBadge>
            {item.karat ? <HeroBadge tone="muted">{item.karat}</HeroBadge> : null}
          </>
        }
        sub={
          <>
            {item.description}
            {item.item_type ? ` · ${item.item_type}` : ""} · {customer ? `${customer.name} (${customer.code})` : "No customer"}
            {item.notes ? ` · ${item.notes}` : ""}
          </>
        }
        actions={
          <>
            {item.status === "RECEIVED" || item.status === "TESTED" ? (
              <Link href="/old-gold/testing" className={item.status === "RECEIVED" ? heroGold : heroGhost}>
                <FlaskConicalIcon size={13} /> {item.status === "RECEIVED" ? "Test purity" : "Retest"}
              </Link>
            ) : null}
            {item.status === "TESTED" || item.status === "VALUED" ? (
              <button onClick={() => setDialog("value")} className={item.status === "TESTED" ? heroGold : heroGhost}>
                <GemIcon size={13} /> Value
              </button>
            ) : null}
            {item.status === "VALUED" ? (
              <button onClick={() => setDialog("purchase")} className={heroGold}>
                <BanknoteIcon size={13} /> Purchase
              </button>
            ) : null}
            {item.status === "PURCHASED" ? (
              <button onClick={() => act("/release", {}, "Released")} disabled={busy} className={heroGold}>
                <ArchiveIcon size={13} /> Release to stock
              </button>
            ) : null}
            {item.status === "AVAILABLE" ? (
              <button onClick={() => setDialog("convert")} className={heroGhost}>
                <PackageIcon size={13} /> Convert to product
              </button>
            ) : null}
            {["RECEIVED", "TESTED", "VALUED"].includes(item.status) ? (
              <button onClick={() => setDialog("void")} className={`${heroGhost} !text-rose-300`}>
                Void
              </button>
            ) : null}
          </>
        }
        stats={[
          { label: "Gross", value: item.gross_mg, format: grams, unit: "g", sub: "As handed over" },
          { label: "Stones", value: item.stone_mg, format: grams, unit: "g", sub: `${stoneShare.toFixed(1)}% of gross` },
          { label: "Net", value: item.net_mg, format: grams, unit: "g", sub: "Gross less stones" },
          { label: "Purity", value: null, text: item.tested_permille !== null ? `${item.tested_permille}‰` : "Untested", sub: item.karat ?? `${tests.length} test${tests.length === 1 ? "" : "s"}` },
          { label: "Fine gold", value: item.fine_mg, format: grams, unit: "g", accent: true, sub: item.net_mg ? `${((item.fine_mg / item.net_mg) * 100).toFixed(1)}% of net` : undefined },
          { label: "Value", value: item.purchase_value_cents, format: lkr, unit: item.purchase_value_cents !== null ? "LKR" : undefined, sub: perFineG ? `${lkr(perFineG)} / g fine` : "Not valued yet" },
          purchase
            ? { label: "Owed", value: owed, format: lkr, unit: "LKR", tone: owed > 0 ? "warn" : "good", sub: owed > 0 ? "To the customer" : "Paid in full" }
            : { label: "Paid", value: item.paid_cents, format: lkr, unit: "LKR", sub: "Nothing purchased yet" },
        ]}
      >
        {offFlow ? (
          <p className="text-[11.5px] text-paper/55">This item left the buy-back flow: {statusText(item.status).toLowerCase()}.</p>
        ) : (
          <ol className="flex flex-wrap items-center gap-1.5" aria-label="Item lifecycle">
            {STAGES.map((s, i) => {
              const done = i < stageIdx;
              const current = i === stageIdx;
              return (
                <li key={s.status} className="flex items-center gap-1.5" aria-current={current ? "step" : undefined}>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset",
                      done ? "bg-gold/[0.14] text-gold-light ring-gold/40" : current ? "bg-paper/10 text-paper ring-paper/25" : "text-paper/35 ring-paper/10"
                    )}
                  >
                    {done ? <CheckIcon size={11} aria-hidden /> : <span className={cn("size-1.5 rounded-full", current ? "animate-pulse-soft bg-gold" : "bg-paper/25")} />}
                    {s.label}
                  </span>
                  {i < STAGES.length - 1 ? <span aria-hidden className={cn("h-px w-4", done ? "bg-gold/50" : "bg-paper/15")} /> : null}
                </li>
              );
            })}
          </ol>
        )}
      </GoldHero>

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

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHead icon={ScaleIcon} title="Weights" sub="Grams · as weighed and assayed" />
              <dl className="divide-y divide-ink/[0.05] text-[12.5px]">
                {row("Gross", `${g(item.gross_mg)} g`)}
                {row("Stones", `− ${g(item.stone_mg)} g`, "text-ink-3")}
                {row("Net", `${g(item.net_mg)} g`)}
                {row("Tested purity", item.tested_permille !== null ? `× ${item.tested_permille}‰` : "—", "text-ink-3")}
                <div className="flex items-center justify-between gap-3 bg-gold-pale/40 px-4 py-2">
                  <dt className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-gold-dark">Fine gold</dt>
                  <dd className="g-metric text-[15px] text-gold-deep">{g(item.fine_mg)} g</dd>
                </div>
              </dl>
            </Card>
            <Card>
              <CardHead icon={GemIcon} title="Valuation" sub="LKR · how the offer was built" />
              <dl className="divide-y divide-ink/[0.05] text-[12.5px]">
                {row("Board rate", item.rate_cents_per_g !== null ? `${fmt(item.rate_cents_per_g)} / g` : "—")}
                {row("Fine at board", atBoard !== null ? fmt(Math.round(atBoard)) : "—")}
                {row("Buy %", item.buy_pct !== null ? `× ${item.buy_pct}%` : "—", "text-ink-3")}
                {atBuy !== null ? row("At buy %", fmt(Math.round(atBuy))) : null}
                {row("Stone deduction", item.stone_deduction_cents ? `− ${fmt(item.stone_deduction_cents)}` : "—", "text-ink-3")}
                {row("Processing", item.processing_deduction_cents ? `− ${fmt(item.processing_deduction_cents)}` : "—", "text-ink-3")}
                {item.negotiated_cents !== null ? row("Negotiated", fmt(item.negotiated_cents), "text-amber-700") : null}
                <div className="flex items-center justify-between gap-3 bg-gold-pale/40 px-4 py-2">
                  <dt className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-gold-dark">Purchase value</dt>
                  <dd className="g-metric text-[15px] text-gold-deep">{item.purchase_value_cents !== null ? fmt(item.purchase_value_cents) : "—"}</dd>
                </div>
              </dl>
            </Card>
          </div>

          <Card>
            <CardHead icon={FlaskConicalIcon} title="Tests" sub={`${tests.length} recorded`} />
            {tests.length === 0 ? (
              <Empty icon={FlaskConicalIcon} title="No tests" desc="Record a purity test from the testing queue." />
            ) : (
              <table className="w-full text-[12.5px]">
                <thead className={thead}>
                  <tr>
                    <th className={cn(th, "pl-4")}>Method</th>
                    <th className={cn(th, "text-right")}>Purity</th>
                    <th className={th}>Approved by</th>
                    <th className={th}>When</th>
                    <th className={cn(th, "pr-4 text-right")}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {tests.map((t) => (
                    <tr key={t.id} className={tr}>
                      <td className="py-1.5 pl-4 pr-2 font-medium capitalize text-ink">{t.method.replace(/_/g, " ")}</td>
                      <td className="g-metric px-2 py-1.5 text-right text-ink">{t.tested_permille}‰</td>
                      <td className="px-2 py-1.5 text-ink-4">{t.approved_by ? t.approved_by.slice(0, 8) : "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-[11px] text-ink-4">{stamp(t.created_at)}</td>
                      <td className="py-1.5 pl-2 pr-4 text-right">
                        <Pill tone={t.result === "pass" ? "success" : t.result === "fail" ? "danger" : "warning"} dot>
                          {t.result}
                        </Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card>
            <CardHead icon={HistoryIcon} title="Gold lineage" sub="Intake → melt → lot → product" />
            <div className="p-4">
              <OldGoldLineage id={id} />
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHead icon={UsersIcon} title="Customer" />
            {customer ? (
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold-light to-gold text-[11px] font-bold text-void">
                  {customer.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-ink">{customer.name}</span>
                  <span className="block truncate text-[11px] text-ink-4">
                    <span className="g-metric">{customer.code}</span>
                    {customer.phone ? ` · ${customer.phone}` : ""}
                  </span>
                </span>
              </div>
            ) : (
              <p className="px-4 py-3 text-[12px] text-ink-4">No customer on this item.</p>
            )}
          </Card>

          <Card>
            <CardHead icon={CreditCardIcon} title="Purchase" sub={purchase ? `Paid ${fmt(purchase.paid_cents)} of ${fmt(purchase.value_cents)} LKR` : "Not purchased yet"} />
            {purchase ? (
              <>
                <div className="px-4 pt-3">
                  <ShareBar value={paidShare * 100} className="h-2" color="bg-gradient-to-r from-emerald-700 to-emerald-400" />
                  <p className="mt-1 flex justify-between text-[10.5px] text-ink-4">
                    <span className="capitalize">{purchase.method}</span>
                    <span className="g-metric">{Math.round(paidShare * 100)}% paid</span>
                  </p>
                </div>
                <dl className="mt-2 divide-y divide-ink/[0.05] border-t border-ink/[0.06] text-[12.5px]">
                  {row("Value", fmt(purchase.value_cents))}
                  {row("Paid", fmt(purchase.paid_cents), "text-emerald-700")}
                  {row("Owed to customer", fmt(owed), owed > 0 ? "text-amber-700" : "text-ink")}
                </dl>
              </>
            ) : (
              <p className="px-4 py-3 text-[12px] text-ink-4">Value and purchase the item to settle with the customer.</p>
            )}
          </Card>

          {journal.length > 0 ? (
            <Card>
              <CardHead
                icon={CreditCardIcon}
                title="Journal"
                sub={`${journal.length} lines`}
                action={
                  <span className={cn("rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset", debit === credit ? "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25" : "bg-rose-500/10 text-rose-800 ring-rose-500/25")}>
                    {debit === credit ? "Balanced" : "Out of balance"}
                  </span>
                }
              />
              <table className="w-full text-[12px]">
                <thead className={thead}>
                  <tr>
                    <th className={cn(th, "pl-4")}>Account</th>
                    <th className={cn(th, "text-right")}>Dr</th>
                    <th className={cn(th, "pr-4 text-right")}>Cr</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.map((j) => (
                    <tr key={j.id} className={tr}>
                      <td className="g-metric py-1.5 pl-4 pr-2 text-ink-3">{j.account_code}</td>
                      <td className="g-metric px-2 py-1.5 text-right text-ink">{j.debit_cents ? fmt(j.debit_cents) : "—"}</td>
                      <td className="g-metric py-1.5 pl-2 pr-4 text-right text-ink">{j.credit_cents ? fmt(j.credit_cents) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}

          {gold.length > 0 ? (
            <Card>
              <CardHead icon={GemIcon} title="Gold movements" sub={`${gold.length} on the gold ledger`} />
              <ul className="divide-y divide-ink/[0.05] text-[12px]">
                {gold.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-1.5">
                    <span className="text-ink-3">{m.direction}</span>
                    <span className="g-metric text-ink">{g(m.fine_mg)} g fine</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>

      {dialog === "value" ? <ValueDialog pending={busy} onSubmit={(b) => act("/value", b, "Valued")} onClose={() => setDialog(null)} /> : null}
      {dialog === "purchase" ? <PurchaseDialog pending={busy} maxLkr={item.purchase_value_cents !== null ? item.purchase_value_cents / 100 : 0} onSubmit={(b) => act("/purchase", b, "Purchased")} onClose={() => setDialog(null)} /> : null}
      {dialog === "convert" ? <ConvertDialog pending={busy} onSubmit={(b) => act("/convert", b, "Converted")} onClose={() => setDialog(null)} /> : null}
      {dialog === "void" ? <VoidDialog pending={busy} onSubmit={(r) => voidIt(r)} onClose={() => setDialog(null)} /> : null}
    </Page>
  );
}

function OldGoldLineage({ id }: { id: string }) {
  const lineage = useQuery({
    queryKey: ["og-lineage", id],
    queryFn: () => api<{ nodes: LineageNode[]; edges: LineageEdge[] }>(`/api/v1/gold/lineage?refEntity=old_gold&refId=${id}`),
  });
  if (lineage.isLoading) return <Skeleton className="h-10" />;
  if (lineage.isError || !lineage.data) return <EmptyBlock title="Lineage unavailable" description="Could not load the gold lineage." />;
  return <LineageChain nodes={lineage.data.nodes} edges={lineage.data.edges} />;
}

function ValueDialog({ pending, onSubmit, onClose }: { pending: boolean; onSubmit: (b: object) => void; onClose: () => void }) {
  const [buyPct, setBuyPct] = useState("");
  const [stone, setStone] = useState("");
  const [proc, setProc] = useState("");
  const [neg, setNeg] = useState("");
  const [reason, setReason] = useState("");
  // A custom buy % or a negotiated total is an override; the server refuses it without a reason.
  const override = buyPct !== "" || neg !== "";
  return (
    <Modal kicker="Old gold" title="Valuation" onClose={onClose} pending={pending} submitDisabled={override && reason.trim() === ""} onSubmit={() => onSubmit({
      ...(buyPct !== "" ? { buyPct: Number(buyPct) } : {}),
      stoneDeductionLkr: stone === "" ? 0 : Number(stone),
      processingDeductionLkr: proc === "" ? 0 : Number(proc),
      ...(neg !== "" ? { negotiatedLkr: Number(neg) } : {}),
      ...(reason.trim() !== "" ? { reason: reason.trim() } : {}),
    })} submitLabel="Value">
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm text-ink-2">Buy % (blank = default)<input value={buyPct} onChange={(e) => setBuyPct(e.target.value)} type="number" min="0" max="100" step="any" className={`num-tabular ${controlClass}`} /></label>
        <label className="block text-sm text-ink-2">Stone deduction LKR<input value={stone} onChange={(e) => setStone(e.target.value)} type="number" min="0" step="any" className={`num-tabular ${controlClass}`} /></label>
        <label className="block text-sm text-ink-2">Processing deduction LKR<input value={proc} onChange={(e) => setProc(e.target.value)} type="number" min="0" step="any" className={`num-tabular ${controlClass}`} /></label>
        <label className="block text-sm text-ink-2">Negotiated total LKR<input value={neg} onChange={(e) => setNeg(e.target.value)} type="number" min="0" step="any" className={`num-tabular ${controlClass}`} /></label>
      </div>
      <label className="block text-sm text-ink-2">Reason {override ? "(required for this override)" : "(only for overrides)"}
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={controlClass} />
      </label>
      <p className="text-xs text-ink-4">Value = net weight × tested purity at the board rate × buy %, less deductions. A negotiated total replaces the formula.</p>
    </Modal>
  );
}

function PurchaseDialog({ pending, maxLkr, onSubmit, onClose }: { pending: boolean; maxLkr: number; onSubmit: (b: object) => void; onClose: () => void }) {
  const [paid, setPaid] = useState(String(maxLkr));
  const [method, setMethod] = useState("cash");
  const paidN = paid === "" ? NaN : Number(paid);
  const valid = Number.isFinite(paidN) && paidN >= 0 && paidN <= maxLkr;
  const owed = valid ? Math.round((maxLkr - paidN) * 100) / 100 : null;
  return (
    <Modal
      kicker="Old gold"
      title={`Purchase — value ${maxLkr.toLocaleString("en-US")} LKR`}
      onClose={onClose}
      onSubmit={() => onSubmit({ paidLkr: paidN, method })}
      pending={pending}
      submitDisabled={!valid}
      submitLabel="Purchase"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm text-ink-2">Paid now LKR
          <input value={paid} onChange={(e) => setPaid(e.target.value)} type="number" min="0" max={maxLkr} step="any" className={`num-tabular ${controlClass}`} />
        </label>
        <label className="block text-sm text-ink-2">Method
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={controlClass}>
            <option value="cash">Cash</option>
            <option value="bank">Bank</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-ink-4">
        {!valid
          ? `Enter an amount from 0 to ${maxLkr.toLocaleString("en-US")} LKR.`
          : owed
            ? `${owed.toLocaleString("en-US")} LKR stays owed to the customer (account 1200).`
            : "Paid in full."}
      </p>
    </Modal>
  );
}

type Option = { id: string; name: string };

function ConvertDialog({ pending, onSubmit, onClose }: { pending: boolean; onSubmit: (b: object) => void; onClose: () => void }) {
  const [categoryId, setCategoryId] = useState("");
  const [metalTypeId, setMetalTypeId] = useState("metal-gold");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const cats = useQuery({ queryKey: ["categories-all"], queryFn: () => api<{ rows: Option[] }>("/api/v1/masters/categories?limit=100") });
  const metals = useQuery({ queryKey: ["metals-all"], queryFn: () => api<{ rows: Option[] }>("/api/v1/masters/metal-types?limit=100") });
  return (
    <Modal
      kicker="Old gold"
      title="Convert to sellable product"
      onClose={onClose}
      pending={pending}
      submitDisabled={!categoryId || !metalTypeId || name.trim() === ""}
      onSubmit={() => onSubmit({ categoryId, metalTypeId, name: name.trim(), ...(location.trim() ? { location: location.trim() } : {}) })}
      submitLabel="Convert"
    >
      <label className="block text-sm text-ink-2">
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Category</span>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`${controlClass} w-full`}>
          <option value="">Select…</option>
          {(cats.data?.rows ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="block text-sm text-ink-2">
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Metal</span>
        <select value={metalTypeId} onChange={(e) => setMetalTypeId(e.target.value)} className={`${controlClass} w-full`}>
          <option value="">Select…</option>
          {(metals.data?.rows ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      <label className="block text-sm text-ink-2">
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Product name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={`${controlClass} w-full`} />
      </label>
      <label className="block text-sm text-ink-2">
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Location <span className="normal-case tracking-normal text-ink-4">(optional)</span></span>
        <input value={location} onChange={(e) => setLocation(e.target.value)} className={`${controlClass} w-full`} />
      </label>
      <p className="text-xs text-ink-4">The product takes the item&apos;s net weight and tested purity, at the purchase value as cost.</p>
    </Modal>
  );
}

function VoidDialog({ pending, onSubmit, onClose }: { pending: boolean; onSubmit: (r: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal kicker="Old gold" title="Void item" danger pending={pending} submitDisabled={reason.trim() === ""} onClose={onClose} onSubmit={() => onSubmit(reason.trim())} submitLabel="Void">
      <label className="block text-sm text-ink-2">Reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={controlClass} />
      </label>
    </Modal>
  );
}
