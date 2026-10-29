"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { LineageChain, type LineageNode, type LineageEdge } from "@/components/lineage-chain";
import { Page, Modal, Skeleton, Callout, controlClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  ScanBarcodeIcon,
  GemIcon,
  BookOpenIcon,
  RefreshCwIcon,
  FlaskConicalIcon,
  LayersIcon,
  CheckIcon,
  PrinterIcon,
  ShieldIcon,
  ScaleIcon,
} from "@/components/icons";
import { BATCH_META, Card, CardHead, Empty, GoldHero, HeroBadge, grams, heroGhost, heroGold, karat, pretty, th, thead, tr } from "../../kit";

type Detail = {
  batch: {
    id: string; number: string; status: string; input_fine_mg: number;
    output_fine_mg: number; waste_mg: number; loss_mg: number; recovery_mg: number;
  };
  inputs: { old_gold_id: string; number: string; description: string; fine_mg: number }[];
  outputs: { lot_number: string; weight_mg: number; permille: number; fine_mg: number; output_type: string }[];
  ledger: { type: string; fine_mg: number }[];
};

const STEPS = ["DRAFT", "LOCKED", "MELTED", "APPROVED"] as const;
const STEP_HINT: Record<string, string> = {
  DRAFT: "Scan old gold in",
  LOCKED: "Ready for the furnace",
  MELTED: "Assay recorded",
  APPROVED: "Reconciled",
};

const g = (mg: number) => (mg / 1000).toLocaleString("en-US");
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export default function MeltDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [scan, setScan] = useState("");
  const [dialog, setDialog] = useState<null | "melt" | "approve" | "void">(null);
  const [outG, setOutG] = useState("");
  const [assay, setAssay] = useState("");
  const [waste, setWaste] = useState("");
  const [otype, setOtype] = useState("grain");
  const [reason, setReason] = useState("");

  const detail = useQuery({
    queryKey: ["melt", id],
    queryFn: () => api<Detail>(`/api/v1/melting/batches/${id}`),
  });
  const lineage = useQuery({
    queryKey: ["melt-lineage", id],
    queryFn: () => api<{ nodes: LineageNode[]; edges: LineageEdge[] }>(`/api/v1/gold/lineage?refEntity=melting_batch&refId=${id}`),
  });

  async function call(path: string, method: string, body?: unknown, ok = "Done") {
    try {
      await api(`/api/v1/melting/batches/${id}${path}`, { method, body: body ? JSON.stringify(body) : undefined });
      toast.success(ok);
      qc.invalidateQueries({ queryKey: ["melt", id] });
      qc.invalidateQueries({ queryKey: ["melt-lineage", id] });
      setDialog(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    }
  }

  const addItems = useMutation({
    mutationFn: async (codes: string[]) => {
      const ids: string[] = [];
      for (const code of codes) {
        const found = await api<{ item: { id: string } }>(`/api/v1/oldgold/items/barcode/${encodeURIComponent(code)}`);
        ids.push(found.item.id);
      }
      return api(`/api/v1/melting/batches/${id}/items`, { method: "POST", body: JSON.stringify({ oldGoldIds: ids }) });
    },
    onSuccess: () => {
      toast.success("Items added");
      setScan("");
      qc.invalidateQueries({ queryKey: ["melt", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Add failed"),
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
        <Callout tone="danger" title="Batch not found">
          This melting batch does not exist or could not be loaded.
        </Callout>
      </Page>
    );
  }
  const { batch, inputs, outputs, ledger } = detail.data;
  const preview = outG && assay ? Math.round((Number(outG) * 1000 * Number(assay)) / 1000) : null;
  const previewLoss = preview !== null ? batch.input_fine_mg - preview - Math.round(Number(waste || 0) * 1000) : null;

  const yieldPct = batch.input_fine_mg > 0 && batch.output_fine_mg > 0 ? (batch.output_fine_mg / batch.input_fine_mg) * 100 : undefined;
  const stepIndex = STEPS.indexOf(batch.status as (typeof STEPS)[number]);
  const isVoid = batch.status === "VOID";
  const meta = BATCH_META[batch.status];
  const outFine = outputs.reduce((n, o) => n + o.fine_mg, 0);
  const outGross = outputs.reduce((n, o) => n + o.weight_mg, 0);
  const net = batch.recovery_mg - batch.loss_mg;

  return (
    <Page className="space-y-4">
      <GoldHero
        back={{ href: "/gold/melting", label: "Melting batches" }}
        icon={FlaskConicalIcon}
        title={<span className="g-metric tracking-tight">{batch.number}</span>}
        badge={
          <HeroBadge tone={isVoid ? "bad" : batch.status === "APPROVED" ? "good" : batch.status === "MELTED" ? "warn" : "gold"}>{meta?.label ?? batch.status}</HeroBadge>
        }
        sub={<>Melting batch · old gold in, assayed lots out · {meta?.hint ?? ""}</>}
        actions={
          <>
            {batch.status === "DRAFT" ? (
              <button onClick={() => call("/lock", "POST", {}, "Locked")} disabled={inputs.length === 0} className={cn(heroGold, "disabled:opacity-50")} title={inputs.length === 0 ? "Scan at least one item first" : undefined}>
                <ShieldIcon size={13} /> Lock batch
              </button>
            ) : null}
            {batch.status === "LOCKED" ? (
              <button onClick={() => setDialog("melt")} className={heroGold}>
                <FlaskConicalIcon size={13} /> Record melt
              </button>
            ) : null}
            {batch.status === "MELTED" ? (
              <button onClick={() => setDialog("approve")} className={heroGold}>
                <CheckIcon size={13} /> Approve
              </button>
            ) : null}
            <a href={`${API}/api/v1/melting/batches/${id}/label`} target="_blank" rel="noreferrer" className={heroGhost}>
              <PrinterIcon size={13} /> Label
            </a>
            {batch.status === "DRAFT" ? (
              <button onClick={() => setDialog("void")} className={cn(heroGhost, "!text-rose-300")}>
                Void
              </button>
            ) : null}
          </>
        }
        stats={[
          { label: "Input fine", value: batch.input_fine_mg, format: grams, unit: "g", accent: true, sub: `${inputs.length} item${inputs.length === 1 ? "" : "s"}` },
          { label: "Output fine", value: batch.output_fine_mg || null, format: grams, unit: "g", sub: outputs.length ? `${outputs.length} lot${outputs.length === 1 ? "" : "s"} · ${grams(outGross)} g gross` : "Not melted yet" },
          {
            label: "Yield",
            value: yieldPct,
            format: (n) => n.toFixed(2),
            unit: "%",
            tone: yieldPct === undefined ? undefined : yieldPct >= 99 ? "good" : yieldPct >= 97 ? "warn" : "bad",
            sub: "Output ÷ input fine",
          },
          { label: "Waste", value: batch.waste_mg, format: grams, unit: "g", sub: "Recorded at melt" },
          { label: "Loss", value: batch.loss_mg, format: grams, unit: "g", tone: batch.loss_mg > 0 ? "bad" : undefined, sub: "Unexplained shortfall" },
          {
            label: "Recovery",
            value: batch.recovery_mg,
            format: grams,
            unit: "g",
            tone: batch.recovery_mg > 0 ? "good" : undefined,
            sub: net === 0 ? "Balanced" : `Net ${net > 0 ? "+" : "−"}${grams(Math.abs(net))} g`,
          },
        ]}
      >
        {/* status stepper */}
        <ol className="flex flex-wrap items-center gap-1.5">
          {STEPS.map((s, i) => {
            const done = !isVoid && stepIndex >= i;
            const current = !isVoid && stepIndex === i;
            return (
              <li key={s} className="flex items-center gap-1.5">
                {i > 0 ? <span className={cn("h-px w-5 sm:w-10", done ? "bg-gold/60" : "bg-paper/15")} aria-hidden /> : null}
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset",
                    current
                      ? "bg-gold text-void ring-gold"
                      : done
                        ? "bg-gold/10 text-gold-light ring-gold/30"
                        : "bg-paper/[0.03] text-paper/40 ring-paper/10"
                  )}
                >
                  <span className={cn("g-metric flex size-4 items-center justify-center rounded-full text-[9px]", current ? "bg-void text-gold-light" : done ? "bg-gold/25" : "bg-paper/10")}>
                    {done && !current ? <CheckIcon size={9} /> : i + 1}
                  </span>
                  {BATCH_META[s]?.label}
                  <span className={cn("hidden lg:inline", current ? "text-void/60" : "opacity-60")}>· {STEP_HINT[s]}</span>
                </span>
              </li>
            );
          })}
          {isVoid ? <li className="ml-2 text-[11px] font-medium text-rose-300">Voided — no gold moved</li> : null}
        </ol>
      </GoldHero>

      {batch.status === "DRAFT" ? (
        <Card>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (scan.trim()) addItems.mutate([scan.trim()]);
            }}
            className="flex flex-wrap items-center gap-2 px-4 py-3"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-void text-gold-light">
              <ScanBarcodeIcon size={14} />
            </span>
            <div className="mr-1 leading-tight">
              <p className="text-[13px] font-semibold text-ink">Add old-gold items</p>
              <p className="text-[11px] text-ink-4">Scan or type OG- item numbers</p>
            </div>
            <div className="relative min-w-[220px] flex-1">
              <ScanBarcodeIcon size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gold" />
              <input
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                placeholder="Scan OG- item…"
                autoComplete="off"
                autoFocus
                className={`w-full pl-9 font-mono ${controlClass} !h-9`}
              />
            </div>
            <button type="submit" disabled={addItems.isPending || !scan.trim()} className="g-btn g-btn-primary h-9 px-4 text-[13px] disabled:opacity-50">
              {addItems.isPending ? "Adding…" : "Add item"}
            </button>
          </form>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-7">
          <CardHead icon={GemIcon} title="Inputs" sub={`${inputs.length} old-gold item${inputs.length === 1 ? "" : "s"} · ${grams(batch.input_fine_mg)} g fine`} />
          {inputs.length === 0 ? (
            <Empty icon={ScanBarcodeIcon} title="No inputs yet" desc="Scan old-gold items into the batch while it is a draft." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className={thead}>
                    <th className={cn(th, "pl-4")}>Item</th>
                    <th className={th}>Description</th>
                    <th className={cn(th, "text-right")}>Share</th>
                    <th className={cn(th, "pr-4 text-right")}>Fine g</th>
                  </tr>
                </thead>
                <tbody>
                  {inputs.map((i) => (
                    <tr key={i.old_gold_id} className={tr}>
                      <td className="py-1.5 pl-4 pr-2">
                        <a href={`/old-gold/items/${i.old_gold_id}`} className="g-metric font-semibold text-ink hover:text-gold-dark">
                          {i.number}
                        </a>
                      </td>
                      <td className="max-w-[260px] truncate px-2 text-ink-3" title={i.description}>
                        {i.description}
                      </td>
                      <td className="g-metric px-2 text-right text-[11px] text-ink-5">
                        {batch.input_fine_mg ? `${((i.fine_mg / batch.input_fine_mg) * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="g-metric py-1.5 pl-2 pr-4 text-right font-semibold text-ink">{grams(i.fine_mg)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-ink/20 bg-bone text-[12px] font-semibold text-ink">
                    <td className="py-1.5 pl-4" colSpan={3}>
                      Total input
                    </td>
                    <td className="g-metric py-1.5 pr-4 text-right">{grams(batch.input_fine_mg)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        <Card className="xl:col-span-5">
          <CardHead icon={RefreshCwIcon} title="Outputs" sub={outputs.length ? `${outputs.length} assayed lot${outputs.length === 1 ? "" : "s"}` : "Recorded when the batch is melted"} />
          {outputs.length === 0 ? (
            <Empty icon={FlaskConicalIcon} title="Not melted yet" desc={batch.status === "LOCKED" ? "Record the melt and assay to create output lots." : "Lock the batch, then record the melt."} />
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Lot</th>
                  <th className={cn(th, "text-right")}>Gross g</th>
                  <th className={cn(th, "text-right")}>Assay</th>
                  <th className={cn(th, "pr-4 text-right")}>Fine g</th>
                </tr>
              </thead>
              <tbody>
                {outputs.map((o) => (
                  <tr key={o.lot_number} className={tr}>
                    <td className="py-1.5 pl-4 pr-2">
                      <span className="g-metric font-semibold text-ink">{o.lot_number}</span>
                      <span className="ml-1.5 rounded bg-bone px-1 text-[10px] text-ink-4 ring-1 ring-inset ring-ink/20">{o.output_type}</span>
                    </td>
                    <td className="g-metric px-2 text-right text-ink-3">{grams(o.weight_mg)}</td>
                    <td className="g-metric px-2 text-right text-ink-3">
                      {o.permille}‰ <span className="text-[10px] text-ink-5">{karat(o.permille)}</span>
                    </td>
                    <td className="g-metric py-1.5 pl-2 pr-4 text-right font-semibold text-ink">{grams(o.fine_mg)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-ink/20 bg-bone text-[12px] font-semibold text-ink">
                  <td className="py-1.5 pl-4">Total</td>
                  <td className="g-metric px-2 text-right">{grams(outGross)}</td>
                  <td />
                  <td className="g-metric py-1.5 pr-4 text-right">{grams(outFine)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-5">
          <CardHead icon={ScaleIcon} title="Reconciliation" sub="Every milligram of input accounted for" />
          <dl className="flex-1 px-4 py-2 text-[12.5px]">
            {[
              { k: "Input fine", v: batch.input_fine_mg, sign: "" },
              { k: "Output fine", v: -batch.output_fine_mg, sign: "−" },
              { k: "Waste", v: -batch.waste_mg, sign: "−" },
              { k: "Loss", v: -batch.loss_mg, sign: "−", tone: batch.loss_mg > 0 ? "text-rose-700" : undefined },
              { k: "Recovery", v: batch.recovery_mg, sign: "+", tone: batch.recovery_mg > 0 ? "text-emerald-700" : undefined },
            ].map((r) => (
              <div key={r.k} className="flex items-baseline justify-between border-b border-dashed border-ink/20 py-1.5">
                <dt className="text-ink-3">{r.k}</dt>
                <dd className={cn("g-metric", r.tone ?? "text-ink")}>
                  {r.sign}
                  {grams(Math.abs(r.v))} g
                </dd>
              </div>
            ))}
            <div className="mt-1.5 flex items-baseline justify-between rounded-lg bg-bone px-3 py-2 font-semibold text-ink">
              <dt>Unaccounted</dt>
              <dd className="g-metric">
                {grams(batch.input_fine_mg - batch.output_fine_mg - batch.waste_mg - batch.loss_mg + batch.recovery_mg)} g
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="xl:col-span-7">
          <CardHead icon={BookOpenIcon} title="Ledger postings" sub={ledger.length ? `${ledger.length} line${ledger.length === 1 ? "" : "s"} on the gold ledger` : "Posted when the batch moves gold"} />
          {ledger.length === 0 ? (
            <Empty icon={BookOpenIcon} title="Nothing posted yet" desc="Ledger lines appear as the batch is locked, melted and approved." />
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Type</th>
                  <th className={cn(th, "pr-4 text-right")}>Fine g</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l, i) => (
                  <tr key={i} className={tr}>
                    <td className="py-1.5 pl-4 font-medium text-ink-2">{pretty(l.type)}</td>
                    <td className="g-metric py-1.5 pr-4 text-right text-ink">{grams(l.fine_mg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card>
        <CardHead icon={LayersIcon} title="Gold lineage" sub="Where this gold came from and where it went" />
        <div className="p-4">{lineage.data ? <LineageChain nodes={lineage.data.nodes} edges={lineage.data.edges} /> : <Skeleton className="h-10" />}</div>
      </Card>

      {dialog === "melt" ? (
        <Modal
          kicker="Gold"
          title="Record melt + assay"
          onClose={() => setDialog(null)}
          onSubmit={() => call("/melt", "POST", { outputWeightG: Number(outG), assayPermille: Number(assay), wasteG: Number(waste || 0), outputType: otype }, "Melt recorded")}
          submitDisabled={!outG || !assay}
          submitLabel="Record"
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-ink-2">Output weight g
              <input value={outG} onChange={(e) => setOutG(e.target.value)} type="number" step="any" className={`num-tabular ${controlClass}`} />
            </label>
            <label className="block text-sm text-ink-2">Assay permille
              <input value={assay} onChange={(e) => setAssay(e.target.value)} type="number" className={`num-tabular ${controlClass}`} />
            </label>
            <label className="block text-sm text-ink-2">Waste g
              <input value={waste} onChange={(e) => setWaste(e.target.value)} type="number" step="any" className={`num-tabular ${controlClass}`} />
            </label>
            <label className="block text-sm text-ink-2">Output type
              <select value={otype} onChange={(e) => setOtype(e.target.value)} className={controlClass}>
                <option value="grain">grain</option>
                <option value="bar">bar</option>
              </select>
            </label>
          </div>
          {previewLoss !== null ? (
            <Callout tone={previewLoss >= 0 ? "warning" : "info"}>
              Output fine ≈ {g(preview!)}g · {previewLoss >= 0 ? `Loss ${previewLoss}mg` : `Recovery ${-previewLoss}mg`}
            </Callout>
          ) : null}
        </Modal>
      ) : null}
      {dialog === "approve" ? (
        <Modal
          kicker="Gold"
          title="Approve reconciliation"
          onClose={() => setDialog(null)}
          onSubmit={() => call("/approve", "POST", { reason }, "Approved")}
          submitDisabled={!reason}
          submitLabel="Approve"
        >
          <Callout tone="info">
            Loss {batch.loss_mg}mg · Recovery {batch.recovery_mg}mg
          </Callout>
          <label className="block text-sm text-ink-2">Reason (required)
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={controlClass} />
          </label>
        </Modal>
      ) : null}
      {dialog === "void" ? (
        <Modal
          kicker="Gold"
          title="Void batch"
          danger
          onClose={() => setDialog(null)}
          onSubmit={() => call("/void", "PATCH", { reason }, "Voided")}
          submitLabel="Void"
        >
          <label className="block text-sm text-ink-2">Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={controlClass} />
          </label>
        </Modal>
      ) : null}
    </Page>
  );
}
