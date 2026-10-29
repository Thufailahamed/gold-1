"use client";

import { use, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { LineageChain, type LineageNode, type LineageEdge } from "@/components/lineage-chain";
import { Page, Modal, Skeleton, Callout, controlClass } from "@/components/ui";
import {
  CheckIcon,
  PlusIcon,
  TrashIcon,
  GemIcon,
  PackageIcon,
  BookOpenIcon,
  HammerIcon,
  ClipboardCheckIcon,
  LayersIcon,
  PrinterIcon,
  BanknoteIcon,
} from "@/components/icons";
import { cn } from "@/lib/cn";
import { Card, CardHead, Empty, GoldHero, HeroBadge, ORDER_META, TypeChip, grams, heroGhost, heroGold, lkrFromCents, pretty, th, thead, tr } from "../../kit";

type Detail = {
  order: {
    id: string; number: string; type: string; design: string; description: string | null;
    status: string; labour_cents: number; making_cents: number; stone_cost_cents: number;
    loss_mg: number; loss_reason: string | null; branch_id: string;
  };
  materials: { lot_batch_id: string; lot_number: string; fine_mg: number }[];
  outputs: { id: string; product_id: string | null; name: string; gross_mg: number; net_mg: number; cost_cents: number }[];
  ledger: { type: string; fine_mg: number }[];
};

const STAGES = [
  { label: "Draft", hint: "Design briefed" },
  { label: "Allocated", hint: "Gold issued" },
  { label: "Production", hint: "On the bench" },
  { label: "QC", hint: "Inspection" },
  { label: "Complete", hint: "Finished" },
];

function stageOf(status: string): number {
  if (status === "DRAFT") return 0;
  if (status === "ALLOCATED") return 1;
  if (status === "IN_PRODUCTION") return 2;
  if (status === "QC_PASSED" || status === "QC_FAILED") return 3;
  return 4;
}

const g = (mg: number) => (mg / 1000).toLocaleString("en-US");
const fmt = (c: number) => (c / 100).toLocaleString("en-US");

export default function MfgOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<null | "materials" | "produce" | "qc" | "void">(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["mfg-order", id] });
    qc.invalidateQueries({ queryKey: ["mfg-orders"] });
    setDialog(null);
  };

  const detail = useQuery({
    queryKey: ["mfg-order", id],
    queryFn: () => api<Detail>(`/api/v1/manufacturing/orders/${id}`),
  });
  const lineage = useQuery({
    queryKey: ["mfg-lineage", id],
    queryFn: () => api<{ nodes: LineageNode[]; edges: LineageEdge[] }>(`/api/v1/gold/lineage?refEntity=manufacturing_order&refId=${id}`),
  });

  if (detail.isLoading) {
    return (
      <Page className="space-y-4">
        <Skeleton className="h-48 rounded-[20px]" />
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
      </Page>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Page>
        <Callout tone="danger" title="Order not found">
          This manufacturing order does not exist or could not be loaded.{" "}
          <Link href="/manufacturing/orders" className="font-medium underline">Back to orders</Link>
        </Callout>
      </Page>
    );
  }
  const { order, materials, outputs, ledger } = detail.data;
  const stage = stageOf(order.status);
  const allocatedMg = materials.reduce((n, m) => n + m.fine_mg, 0);
  const producedMg = outputs.reduce((n, o) => n + o.net_mg, 0);
  const grossMg = outputs.reduce((n, o) => n + o.gross_mg, 0);
  const outputCost = outputs.reduce((n, o) => n + o.cost_cents, 0);
  const extraCost = order.labour_cents + order.making_cents + order.stone_cost_cents;
  const yieldPct = allocatedMg > 0 && producedMg > 0 ? (producedMg / allocatedMg) * 100 : undefined;
  const lossPct = allocatedMg > 0 ? (order.loss_mg / allocatedMg) * 100 : undefined;
  const isVoid = order.status === "VOID";
  const failed = order.status === "QC_FAILED";
  const meta = ORDER_META[order.status];
  const productIds = outputs.flatMap((o) => (o.product_id ? [o.product_id] : []));

  return (
    <Page className="space-y-4">
      <GoldHero
        back={{ href: "/manufacturing/orders", label: "Manufacturing orders" }}
        icon={HammerIcon}
        title={<span className="g-metric tracking-tight">{order.number}</span>}
        badge={
          <span className="flex items-center gap-1.5">
            <HeroBadge tone={isVoid ? "muted" : failed ? "bad" : order.status === "COMPLETE" ? "good" : order.status === "QC_PASSED" ? "warn" : "gold"}>
              {meta?.label ?? order.status}
            </HeroBadge>
            <TypeChip type={order.type} />
          </span>
        }
        sub={
          <>
            <span className="text-paper/75">{order.design}</span>
            {order.description ? ` — ${order.description}` : ""}
          </>
        }
        actions={
          <>
            {order.status === "DRAFT" ? (
              <button onClick={() => setDialog("materials")} className={heroGold}>
                <GemIcon size={13} /> Add materials
              </button>
            ) : null}
            {order.status === "ALLOCATED" || order.status === "QC_FAILED" ? (
              <button onClick={() => setDialog("produce")} className={heroGold}>
                <HammerIcon size={13} /> {failed ? "Rework & produce" : "Produce"}
              </button>
            ) : null}
            {order.status === "IN_PRODUCTION" ? (
              <button onClick={() => setDialog("qc")} className={heroGold}>
                <ClipboardCheckIcon size={13} /> QC check
              </button>
            ) : null}
            {order.status === "QC_PASSED" ? <FinishButton id={id} onDone={refresh} /> : null}
            {productIds.length ? (
              <Link href={`/products/labels?ids=${productIds.join(",")}&back=${encodeURIComponent(`/manufacturing/orders/${id}`)}`} className={heroGhost}>
                <PrinterIcon size={13} /> Labels
              </Link>
            ) : null}
            {order.status === "DRAFT" || order.status === "ALLOCATED" ? (
              <button onClick={() => setDialog("void")} className={cn(heroGhost, "!text-rose-300")}>
                Void
              </button>
            ) : null}
          </>
        }
        stats={[
          { label: "Allocated fine", value: allocatedMg, format: grams, unit: "g", accent: true, sub: `${materials.length} lot${materials.length === 1 ? "" : "s"}` },
          { label: "Produced fine", value: producedMg || null, format: grams, unit: "g", sub: outputs.length ? `${outputs.length} piece${outputs.length === 1 ? "" : "s"} · ${grams(grossMg)} g gross` : "Not produced yet" },
          {
            label: "Yield",
            value: yieldPct,
            format: (n) => n.toFixed(2),
            unit: "%",
            tone: yieldPct === undefined ? undefined : yieldPct >= 98 ? "good" : yieldPct >= 95 ? "warn" : "bad",
            sub: "Produced ÷ allocated",
          },
          { label: "Loss", value: order.loss_mg, format: grams, unit: "g", tone: order.loss_mg > 0 ? "bad" : undefined, sub: lossPct !== undefined && order.loss_mg ? `${lossPct.toFixed(2)}% · ${order.loss_reason ?? "no reason"}` : "None recorded" },
          { label: "Labour + making", value: order.labour_cents + order.making_cents, format: lkrFromCents, unit: "LKR", sub: order.stone_cost_cents ? `+ ${lkrFromCents(order.stone_cost_cents)} stones` : "No stones" },
          { label: "Pieces cost", value: outputCost || null, format: lkrFromCents, unit: "LKR", sub: outputs.length && outputCost ? `≈ ${lkrFromCents(outputCost / outputs.length)} each` : "After production" },
        ]}
      >
        <ol className="flex flex-wrap items-center gap-1.5">
          {STAGES.map((st, i) => {
            const done = !isVoid && i < stage;
            const current = !isVoid && i === stage;
            const bad = current && failed;
            return (
              <li key={st.label} className="flex items-center gap-1.5">
                {i > 0 ? <span className={cn("h-px w-5 sm:w-10", done || current ? "bg-gold/60" : "bg-paper/15")} aria-hidden /> : null}
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset",
                    bad
                      ? "bg-rose-500 text-paper ring-rose-500"
                      : current
                        ? "bg-gold text-void ring-gold"
                        : done
                          ? "bg-gold/10 text-gold-light ring-gold/30"
                          : "bg-paper/[0.03] text-paper/40 ring-paper/10"
                  )}
                >
                  <span className={cn("g-metric flex size-4 items-center justify-center rounded-full text-[9px]", current ? "bg-void text-gold-light" : done ? "bg-gold/25" : "bg-paper/10")}>
                    {done ? <CheckIcon size={9} /> : i + 1}
                  </span>
                  {bad ? "QC failed" : st.label}
                  <span className={cn("hidden lg:inline", current ? "opacity-60" : "opacity-50")}>· {bad ? "Rework" : st.hint}</span>
                </span>
              </li>
            );
          })}
          {isVoid ? <li className="ml-2 text-[11px] font-medium text-rose-300">Voided — gold returned, nothing produced</li> : null}
        </ol>
      </GoldHero>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-5">
          <CardHead icon={GemIcon} title="Materials" sub={`${materials.length} refined lot${materials.length === 1 ? "" : "s"} · ${grams(allocatedMg)} g fine`} />
          {materials.length === 0 ? (
            <Empty
              icon={GemIcon}
              title="No materials"
              desc="Allocate refined lots from approved melting batches."
              action={
                order.status === "DRAFT" ? (
                  <button type="button" onClick={() => setDialog("materials")} className="inline-flex h-8 items-center gap-1 rounded-lg bg-void px-3 text-[12px] font-semibold text-gold-light">
                    <PlusIcon size={12} /> Add
                  </button>
                ) : null
              }
            />
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Lot</th>
                  <th className={cn(th, "text-right")}>Share</th>
                  <th className={cn(th, "pr-4 text-right")}>Fine g</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m) => (
                  <tr key={`${m.lot_batch_id}:${m.lot_number}`} className={tr}>
                    <td className="py-1.5 pl-4 pr-2">
                      <Link href={`/gold/melting/${m.lot_batch_id}`} className="g-metric font-semibold text-ink hover:text-gold-dark">
                        {m.lot_number}
                      </Link>
                    </td>
                    <td className="g-metric px-2 text-right text-[11px] text-ink-5">{allocatedMg ? `${((m.fine_mg / allocatedMg) * 100).toFixed(1)}%` : "—"}</td>
                    <td className="g-metric py-1.5 pl-2 pr-4 text-right font-semibold text-ink">{grams(m.fine_mg)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-ink/20 bg-bone text-[12px] font-semibold text-ink">
                  <td className="py-1.5 pl-4" colSpan={2}>
                    Total allocated
                  </td>
                  <td className="g-metric py-1.5 pr-4 text-right">{grams(allocatedMg)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </Card>

        <Card className="xl:col-span-7">
          <CardHead
            icon={PackageIcon}
            title="Outputs"
            sub={outputs.length ? `${outputs.length} piece${outputs.length === 1 ? "" : "s"} produced` : "Recorded at production"}
          />
          {outputs.length === 0 ? (
            <Empty icon={HammerIcon} title="Nothing produced yet" desc={order.status === "DRAFT" ? "Allocate materials, then produce the pieces." : "Record production to create the finished pieces."} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-[12px]">
                <thead>
                  <tr className={thead}>
                    <th className={cn(th, "pl-4")}>Piece</th>
                    <th className={cn(th, "text-right")}>Gross g</th>
                    <th className={cn(th, "text-right")}>Net g</th>
                    <th className={cn(th, "pr-4 text-right")}>Cost LKR</th>
                  </tr>
                </thead>
                <tbody>
                  {outputs.map((o) => (
                    <tr key={o.id} className={tr}>
                      <td className="max-w-[240px] truncate py-1.5 pl-4 pr-2">
                        {o.product_id ? (
                          <Link href={`/products/${o.product_id}`} className="font-semibold text-ink hover:text-gold-dark">
                            {o.name}
                          </Link>
                        ) : (
                          <span className="font-semibold text-ink">{o.name}</span>
                        )}
                        {o.product_id ? null : <span className="ml-1.5 text-[10px] text-ink-5">not in stock yet</span>}
                      </td>
                      <td className="g-metric px-2 text-right text-ink-3">{grams(o.gross_mg)}</td>
                      <td className="g-metric px-2 text-right text-ink">{grams(o.net_mg)}</td>
                      <td className="g-metric py-1.5 pl-2 pr-4 text-right font-semibold text-ink">{lkrFromCents(o.cost_cents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-ink/20 bg-bone text-[12px] font-semibold text-ink">
                    <td className="py-1.5 pl-4">Total</td>
                    <td className="g-metric px-2 text-right">{grams(grossMg)}</td>
                    <td className="g-metric px-2 text-right">{grams(producedMg)}</td>
                    <td className="g-metric py-1.5 pr-4 text-right">{lkrFromCents(outputCost)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-4">
          <CardHead icon={BanknoteIcon} title="Costs" sub="Workshop charges on this order" />
          <dl className="flex-1 px-4 py-2 text-[12.5px]">
            {[
              ["Labour", order.labour_cents],
              ["Making", order.making_cents],
              ["Stones", order.stone_cost_cents],
            ].map(([k, v]) => (
              <div key={k as string} className="flex items-baseline justify-between border-b border-dashed border-ink/20 py-1.5">
                <dt className="text-ink-3">{k}</dt>
                <dd className="g-metric text-ink">{lkrFromCents(v as number)} LKR</dd>
              </div>
            ))}
            <div className="mt-1.5 flex items-baseline justify-between rounded-lg bg-bone px-3 py-2 font-semibold text-ink">
              <dt>Total charges</dt>
              <dd className="g-metric">{lkrFromCents(extraCost)} LKR</dd>
            </div>
          </dl>
        </Card>

        <Card className="xl:col-span-4">
          <CardHead icon={LayersIcon} title="Gold balance" sub="Allocated fine against produced fine" />
          <dl className="flex-1 px-4 py-2 text-[12.5px]">
            {[
              { k: "Allocated", v: allocatedMg, sign: "" },
              { k: "Produced", v: producedMg, sign: "−" },
              { k: "Loss", v: order.loss_mg, sign: "−", tone: order.loss_mg > 0 ? "text-rose-700" : undefined },
            ].map((r) => (
              <div key={r.k} className="flex items-baseline justify-between border-b border-dashed border-ink/20 py-1.5">
                <dt className="text-ink-3">{r.k}</dt>
                <dd className={cn("g-metric", r.tone ?? "text-ink")}>
                  {r.sign}
                  {grams(r.v)} g
                </dd>
              </div>
            ))}
            <div className="mt-1.5 flex items-baseline justify-between rounded-lg bg-bone px-3 py-2 font-semibold text-ink">
              <dt>Still on the bench</dt>
              <dd className="g-metric">{grams(Math.max(0, allocatedMg - producedMg - order.loss_mg))} g</dd>
            </div>
          </dl>
        </Card>

        <Card className="xl:col-span-4">
          <CardHead icon={BookOpenIcon} title="Gold postings" sub={ledger.length ? `${ledger.length} ledger line${ledger.length === 1 ? "" : "s"}` : "Posted as gold moves"} />
          {ledger.length === 0 ? (
            <Empty icon={BookOpenIcon} title="Nothing posted yet" desc="Ledger lines appear as gold is issued and pieces are made." />
          ) : (
            <table className="w-full text-[12px]">
              <tbody>
                {ledger.map((l, i) => (
                  <tr key={i} className={tr}>
                    <td className="py-1.5 pl-4 font-medium text-ink-2">{pretty(l.type)}</td>
                    <td className="g-metric py-1.5 pr-4 text-right text-ink">{grams(l.fine_mg)} g</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card>
        <CardHead icon={LayersIcon} title="Gold lineage" sub="From refined lot to finished piece" />
        <div className="p-4">{lineage.data ? <LineageChain nodes={lineage.data.nodes} edges={lineage.data.edges} /> : <Skeleton className="h-10" />}</div>
      </Card>

      {dialog === "materials" ? <MaterialsDialog orderId={id} onClose={refresh} /> : null}
      {dialog === "produce" ? <ProduceDialog orderId={id} onClose={refresh} /> : null}
      {dialog === "qc" ? <QcDialog orderId={id} onClose={refresh} /> : null}
      {dialog === "void" ? <VoidDialog orderId={id} onClose={refresh} /> : null}
    </Page>
  );
}

function FinishButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [pending, setPending] = useState(false);
  async function finish() {
    setPending(true);
    try {
      const res = await api<{ barcodes: string[] }>(`/api/v1/manufacturing/orders/${id}/finish`, { method: "POST" });
      toast.success(`Finished: ${res.barcodes.join(", ")}`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Finish failed");
    } finally {
      setPending(false);
    }
  }
  return (
    <button onClick={finish} disabled={pending} className={cn(heroGold, "disabled:opacity-50")}>
      <CheckIcon size={13} /> {pending ? "Finishing…" : "Finish into stock"}
    </button>
  );
}

function MaterialsDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [batchId, setBatchId] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [fineMg, setFineMg] = useState("");
  const [pending, setPending] = useState(false);
  const batches = useQuery({
    queryKey: ["approved-batches"],
    queryFn: () => api<{ rows: { id: string; number: string }[] }>(`/api/v1/melting/batches?status=APPROVED&limit=50`),
  });
  async function save() {
    setPending(true);
    try {
      await api(`/api/v1/manufacturing/orders/${orderId}/materials`, {
        method: "POST",
        body: JSON.stringify({ lots: [{ lotBatchId: batchId, lotNumber, fineMg: Number(fineMg) }] }),
      });
      toast.success("Materials added");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Add failed");
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal kicker="Workshop" title="Allocate refined lot" onClose={onClose} onSubmit={save} pending={pending} submitDisabled={!batchId || !lotNumber || !fineMg}>
      <label className="block text-sm text-ink-2">Batch
        <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className={controlClass}>
          <option value="">Select approved batch…</option>
          {(batches.data?.rows ?? []).map((b) => (
            <option key={b.id} value={b.id}>{b.number}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm text-ink-2">Lot number (e.g. MLT-000001-01)
        <input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} className={`g-metric ${controlClass}`} />
      </label>
      <label className="block text-sm text-ink-2">Fine mg to allocate
        <input value={fineMg} onChange={(e) => setFineMg(e.target.value)} type="number" className={`num-tabular ${controlClass}`} />
      </label>
    </Modal>
  );
}

type OutDraft = { key: number; categoryId: string; metalTypeId: string; purityId: string; name: string; grossG: string; stoneG: string; makingLkr: string; location: string };

function ProduceDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [outputs, setOutputs] = useState<OutDraft[]>([
    { key: 1, categoryId: "", metalTypeId: "", purityId: "", name: "", grossG: "", stoneG: "", makingLkr: "", location: "" },
  ]);
  const [labour, setLabour] = useState("");
  const [making, setMaking] = useState("");
  const [stones, setStones] = useState("");
  const [loss, setLoss] = useState("");
  const [lossReason, setLossReason] = useState("");
  const [pending, setPending] = useState(false);
  const cats = useQuery({ queryKey: ["cats"], queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/masters/categories?limit=100") });
  const metals = useQuery({ queryKey: ["metals"], queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/masters/metal-types?limit=100") });
  const purs = useQuery({ queryKey: ["purs"], queryFn: () => api<{ rows: { id: string; karat: string }[] }>("/api/v1/masters/purities?limit=100") });

  function set(key: number, patch: Partial<OutDraft>) {
    setOutputs((os) => os.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  }

  async function save() {
    setPending(true);
    try {
      const res = await api<{ outputFineMg: number; lossPct: number }>(`/api/v1/manufacturing/orders/${orderId}/produce`, {
        method: "POST",
        body: JSON.stringify({
          outputs: outputs.map((o) => ({
            categoryId: o.categoryId,
            metalTypeId: o.metalTypeId,
            purityId: o.purityId,
            name: o.name,
            grossG: Number(o.grossG),
            stoneG: o.stoneG === "" ? 0 : Number(o.stoneG),
            makingLkr: o.makingLkr === "" ? 0 : Number(o.makingLkr),
            location: o.location || undefined,
          })),
          labourLkr: labour === "" ? 0 : Number(labour),
          makingLkr: making === "" ? 0 : Number(making),
          stoneCostLkr: stones === "" ? 0 : Number(stones),
          lossMg: loss === "" ? 0 : Number(loss),
          lossReason: lossReason || undefined,
        }),
      });
      toast.success(`Produced ${g(res.outputFineMg)}g, loss ${res.lossPct.toFixed(2)}%`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Produce failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      wide
      kicker="Workshop"
      title="Produce outputs"
      onClose={onClose}
      onSubmit={save}
      pending={pending}
      submitLabel="Produce"
    >
      {outputs.map((o, idx) => (
        <div key={o.key} className="g-surface rounded-xl p-3">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="g-kicker !text-[10px]">Output {idx + 1}</span>
            {outputs.length > 1 ? (
              <button
                type="button"
                onClick={() => setOutputs((os) => os.filter((x) => x.key !== o.key))}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-50"
              >
                <TrashIcon size={12} /> Remove
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <input placeholder="Name" value={o.name} onChange={(e) => set(o.key, { name: e.target.value })} className={controlClass} />
            <select value={o.categoryId} onChange={(e) => set(o.key, { categoryId: e.target.value })} className={controlClass}>
              <option value="">Category…</option>
              {(cats.data?.rows ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select value={o.metalTypeId} onChange={(e) => set(o.key, { metalTypeId: e.target.value })} className={controlClass}>
              <option value="">Metal…</option>
              {(metals.data?.rows ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select value={o.purityId} onChange={(e) => set(o.key, { purityId: e.target.value })} className={controlClass}>
              <option value="">Purity…</option>
              {(purs.data?.rows ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.karat}</option>
              ))}
            </select>
            <input placeholder="Gross g" type="number" step="any" value={o.grossG} onChange={(e) => set(o.key, { grossG: e.target.value })} className={`num-tabular ${controlClass}`} />
            <input placeholder="Stone g" type="number" step="any" value={o.stoneG} onChange={(e) => set(o.key, { stoneG: e.target.value })} className={`num-tabular ${controlClass}`} />
            <input placeholder="Making LKR" type="number" step="any" value={o.makingLkr} onChange={(e) => set(o.key, { makingLkr: e.target.value })} className={`num-tabular ${controlClass}`} />
            <input placeholder="Location" value={o.location} onChange={(e) => set(o.key, { location: e.target.value })} className={controlClass} />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setOutputs((os) => [...os, { key: Date.now(), categoryId: "", metalTypeId: "", purityId: "", name: "", grossG: "", stoneG: "", makingLkr: "", location: "" }])}
        className="g-btn g-btn-secondary h-9 px-3 text-xs"
      >
        <PlusIcon size={13} /> Add output
      </button>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <label className="block text-sm text-ink-2">Labour LKR<input value={labour} onChange={(e) => setLabour(e.target.value)} type="number" step="any" className={`num-tabular ${controlClass}`} /></label>
        <label className="block text-sm text-ink-2">Making LKR<input value={making} onChange={(e) => setMaking(e.target.value)} type="number" step="any" className={`num-tabular ${controlClass}`} /></label>
        <label className="block text-sm text-ink-2">Stones LKR<input value={stones} onChange={(e) => setStones(e.target.value)} type="number" step="any" className={`num-tabular ${controlClass}`} /></label>
        <label className="block text-sm text-ink-2">Loss mg<input value={loss} onChange={(e) => setLoss(e.target.value)} type="number" className={`num-tabular ${controlClass}`} /></label>
      </div>
      <label className="block text-sm text-ink-2">Loss reason (required if loss &gt; 0)
        <input value={lossReason} onChange={(e) => setLossReason(e.target.value)} className={controlClass} />
      </label>
    </Modal>
  );
}

function QcDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [pass, setPass] = useState(true);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  async function save() {
    setPending(true);
    try {
      await api(`/api/v1/manufacturing/orders/${orderId}/qc`, {
        method: "POST",
        body: JSON.stringify({ pass, reason: reason || undefined }),
      });
      toast.success(pass ? "QC passed" : "Sent back for rework");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "QC failed");
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal
      kicker="Workshop"
      title="Quality check"
      danger={!pass}
      onClose={onClose}
      onSubmit={save}
      pending={pending}
      submitLabel={pass ? "Pass" : "Fail to rework"}
    >
      <label className="g-surface flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm text-ink-2">
        <input type="checkbox" checked={pass} onChange={(e) => setPass(e.target.checked)} className="accent-gold" />
        Pass inspection
      </label>
      <label className="block text-sm text-ink-2">Reason (required to fail)
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={controlClass} />
      </label>
    </Modal>
  );
}

function VoidDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  async function save() {
    setPending(true);
    try {
      await api(`/api/v1/manufacturing/orders/${orderId}/void`, {
        method: "PATCH",
        body: JSON.stringify({ reason }),
      });
      toast.success("Order voided");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Void failed");
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal kicker="Workshop" title="Void order" danger onClose={onClose} onSubmit={save} pending={pending} submitLabel="Void">
      <label className="block text-sm text-ink-2">Reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={controlClass} />
      </label>
    </Modal>
  );
}
