"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { LineageChain, type LineageNode, type LineageEdge } from "@/components/lineage-chain";
import {
  Page,
  Hero,
  Panel,
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
import { ScanBarcodeIcon } from "@/components/icons";

type Detail = {
  batch: {
    id: string; number: string; status: string; input_fine_mg: number;
    output_fine_mg: number; waste_mg: number; loss_mg: number; recovery_mg: number;
  };
  inputs: { old_gold_id: string; number: string; description: string; fine_mg: number }[];
  outputs: { lot_number: string; weight_mg: number; permille: number; fine_mg: number; output_type: string }[];
  ledger: { type: string; fine_mg: number }[];
};

const TONES: Record<string, PillTone> = {
  DRAFT: "neutral",
  LOCKED: "warning",
  MELTED: "info",
  APPROVED: "success",
  VOID: "danger",
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
  const [approver, setApprover] = useState("");

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
      <Page>
        <Skeleton className="h-56" />
        <Skeleton className="h-64" />
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

  return (
    <Page>
      <Hero
        back={{ href: "/gold/melting", label: "Melting batches" }}
        kicker="Gold · Vault"
        title={batch.number}
        description="Old gold in, assayed lots out — every milligram reconciled."
        meta={<Pill tone="ghost" className="!text-paper">{batch.status}</Pill>}
        stats={[
          { label: "Input fine", value: `${g(batch.input_fine_mg)} g` },
          { label: "Output fine", value: `${g(batch.output_fine_mg)} g` },
          { label: "Waste", value: `${g(batch.waste_mg)} g` },
          { label: batch.loss_mg > 0 ? "Loss" : "Recovery", value: `${batch.loss_mg > 0 ? batch.loss_mg : batch.recovery_mg} mg` },
        ]}
        actions={
          <>
            {batch.status === "DRAFT" ? (
              <button onClick={() => call("/lock", "POST", {}, "Locked")} className={heroBtnPrimary}>Lock</button>
            ) : null}
            {batch.status === "LOCKED" ? (
              <button onClick={() => setDialog("melt")} className={heroBtnPrimary}>Record melt</button>
            ) : null}
            {batch.status === "MELTED" ? (
              <button onClick={() => setDialog("approve")} className={heroBtnPrimary}>Approve</button>
            ) : null}
            {batch.status === "DRAFT" ? (
              <button onClick={() => setDialog("void")} className={`${heroBtnGhost} !text-rose-300`}>Void</button>
            ) : null}
            <a href={`${API}/api/v1/melting/batches/${id}/label`} target="_blank" rel="noreferrer" className={heroBtnGhost}>
              Label
            </a>
          </>
        }
      />

      {batch.status === "DRAFT" ? (
        <Panel title="Add old-gold items" description="Scan OG- item numbers into this batch">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (scan.trim()) addItems.mutate([scan.trim()]);
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <ScanBarcodeIcon size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gold" />
              <input
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                placeholder="Scan OG- item…"
                autoComplete="off"
                className={`w-full pl-10 font-mono ${controlClass}`}
              />
            </div>
            <button type="submit" disabled={addItems.isPending} className="g-btn g-btn-primary h-10 px-4 text-sm">
              {addItems.isPending ? "Adding…" : "Add"}
            </button>
          </form>
        </Panel>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Inputs" description={`${inputs.length} item${inputs.length === 1 ? "" : "s"}`}>
          {inputs.length === 0 ? (
            <EmptyBlock title="No inputs yet" description="Scan old-gold items into the batch." />
          ) : (
            <ul className="space-y-2.5 text-sm">
              {inputs.map((i) => (
                <li key={i.old_gold_id} className="flex items-center justify-between gap-3">
                  <a href={`/old-gold/items/${i.old_gold_id}`} className="min-w-0 truncate text-ink-2 hover:text-gold-700">
                    <span className="g-metric text-xs text-ink">{i.number}</span> · {i.description}
                  </a>
                  <span className="num-tabular shrink-0 font-medium text-ink">{g(i.fine_mg)}g fine</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {outputs.length > 0 ? (
          <Panel title="Outputs" description={`${outputs.length} lot${outputs.length === 1 ? "" : "s"}`}>
            <ul className="space-y-2.5 text-sm">
              {outputs.map((o) => (
                <li key={o.lot_number} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-ink-2">
                    <span className="g-metric text-xs text-ink">{o.lot_number}</span> · {o.output_type} · {o.permille}‰
                  </span>
                  <span className="num-tabular shrink-0 font-medium text-ink">{g(o.fine_mg)}g fine</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-ink/10 pt-3 text-xs text-ink-4">
              Waste {g(batch.waste_mg)}g · Loss {batch.loss_mg}mg · Recovery {batch.recovery_mg}mg
            </p>
          </Panel>
        ) : null}
      </div>

      {ledger.length > 0 ? (
        <Panel title="Ledger postings">
          <ul className="space-y-2 g-metric text-xs">
            {ledger.map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <span className="text-ink-3">{l.type}</span>
                <span className="text-ink">{l.fine_mg}mg</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="Gold lineage" description="Where this gold came from and where it went">
        {lineage.data ? (
          <LineageChain nodes={lineage.data.nodes} edges={lineage.data.edges} />
        ) : (
          <Skeleton className="h-10" />
        )}
      </Panel>

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
          onSubmit={() => call("/approve", "POST", { reason, approvedBy: approver || undefined }, "Approved")}
          submitDisabled={!reason}
          submitLabel="Approve"
        >
          <Callout tone="info">
            Loss {batch.loss_mg}mg · Recovery {batch.recovery_mg}mg
          </Callout>
          <label className="block text-sm text-ink-2">Reason (required)
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={controlClass} />
          </label>
          <label className="block text-sm text-ink-2">Approver ID (if over threshold)
            <input value={approver} onChange={(e) => setApprover(e.target.value)} className={controlClass} />
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
