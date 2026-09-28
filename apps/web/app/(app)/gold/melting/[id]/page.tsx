"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { LineageChain, type LineageNode, type LineageEdge } from "@/components/lineage-chain";

type Detail = {
  batch: {
    id: string; number: string; status: string; input_fine_mg: number;
    output_fine_mg: number; waste_mg: number; loss_mg: number; recovery_mg: number;
  };
  inputs: { old_gold_id: string; number: string; description: string; fine_mg: number }[];
  outputs: { lot_number: string; weight_mg: number; permille: number; fine_mg: number; output_type: string }[];
  ledger: { type: string; fine_mg: number }[];
};

const inputCls = "w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold";

export default function MeltDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
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

  if (detail.isLoading) return <div className="h-64 animate-pulse rounded-xl bg-stone-200" />;
  if (detail.isError || !detail.data) return <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">Batch not found.</div>;
  const { batch, inputs, outputs, ledger } = detail.data;
  const preview = outG && assay ? Math.round((Number(outG) * 1000 * Number(assay)) / 1000) : null;
  const previewLoss = preview !== null ? batch.input_fine_mg - preview - Math.round(Number(waste || 0) * 1000) : null;

  return (
    <div className="space-y-4">
      <button onClick={() => router.push("/gold/melting")} className="text-sm text-stone-500 hover:underline">← Batches</button>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-mono text-xl font-semibold">{batch.number}</h1>
          <p className="text-sm text-stone-500">{batch.status} · input {(batch.input_fine_mg / 1000).toLocaleString("en-US")}g fine</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {batch.status === "DRAFT" ? (
            <button onClick={() => call("/lock", "POST", {}, "Locked")} className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white">Lock</button>
          ) : null}
          {batch.status === "LOCKED" ? (
            <button onClick={() => setDialog("melt")} className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white">Record melt</button>
          ) : null}
          {batch.status === "MELTED" ? (
            <button onClick={() => setDialog("approve")} className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white">Approve</button>
          ) : null}
          {batch.status === "DRAFT" ? (
            <button onClick={() => setDialog("void")} className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600">Void</button>
          ) : null}
          <a href={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787"}/api/v1/melting/batches/${id}/label`} target="_blank" rel="noreferrer" className="rounded-md border px-3 py-1.5 text-sm hover:bg-stone-100">
            Label
          </a>
        </div>
      </div>

      {batch.status === "DRAFT" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (scan.trim()) addItems.mutate([scan.trim()]);
          }}
          className="flex gap-2"
        >
          <input value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Scan OG- item…" autoComplete="off" className="w-full max-w-sm rounded-md border-2 border-gold px-4 py-2 font-mono outline-none" />
          <button type="submit" className="rounded-md bg-stone-900 px-4 py-2 text-sm text-white">Add</button>
        </form>
      ) : null}

      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="font-medium">Inputs ({inputs.length})</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {inputs.map((i) => (
            <li key={i.old_gold_id} className="flex justify-between">
              <a href={`/old-gold/items/${i.old_gold_id}`} className="font-mono text-xs hover:underline">{i.number} · {i.description}</a>
              <span>{(i.fine_mg / 1000).toLocaleString("en-US")}g fine</span>
            </li>
          ))}
        </ul>
      </div>

      {outputs.length > 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="font-medium">Outputs</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {outputs.map((o) => (
              <li key={o.lot_number} className="flex justify-between">
                <span className="font-mono text-xs">{o.lot_number} · {o.output_type} · {o.permille}</span>
                <span>{(o.fine_mg / 1000).toLocaleString("en-US")}g fine</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-stone-500">Waste {(batch.waste_mg / 1000).toLocaleString("en-US")}g · Loss {batch.loss_mg}mg · Recovery {batch.recovery_mg}mg</p>
        </div>
      ) : null}

      {ledger.length > 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="font-medium">Ledger postings</h2>
          <ul className="mt-2 space-y-1 font-mono text-xs">
            {ledger.map((l, i) => (
              <li key={i} className="flex justify-between"><span>{l.type}</span><span>{l.fine_mg}mg</span></li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="font-medium">Lineage</h2>
        <div className="mt-2">
          {lineage.data ? <LineageChain nodes={lineage.data.nodes} edges={lineage.data.edges} /> : <p className="text-sm text-stone-400">Loading…</p>}
        </div>
      </div>

      {dialog === "melt" ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-lg">
            <h2 className="font-semibold">Record melt + assay</h2>
            <label className="block text-sm">Output weight g<input value={outG} onChange={(e) => setOutG(e.target.value)} type="number" step="any" className={inputCls} /></label>
            <label className="block text-sm">Assay permille<input value={assay} onChange={(e) => setAssay(e.target.value)} type="number" className={inputCls} /></label>
            <label className="block text-sm">Waste g<input value={waste} onChange={(e) => setWaste(e.target.value)} type="number" step="any" className={inputCls} /></label>
            <label className="block text-sm">Output type<select value={otype} onChange={(e) => setOtype(e.target.value)} className={inputCls}><option value="grain">grain</option><option value="bar">bar</option></select></label>
            {previewLoss !== null ? <p className="text-sm">Output fine ≈ {(preview! / 1000).toLocaleString("en-US")}g · {previewLoss >= 0 ? `Loss ${previewLoss}mg` : `Recovery ${-previewLoss}mg`}</p> : null}
            <div className="flex justify-end gap-2">
              <button onClick={() => setDialog(null)} className="rounded-md border px-3 py-2 text-sm">Cancel</button>
              <button onClick={() => call("/melt", "POST", { outputWeightG: Number(outG), assayPermille: Number(assay), wasteG: Number(waste || 0), outputType: otype }, "Melt recorded")} className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white">Record</button>
            </div>
          </div>
        </div>
      ) : null}
      {dialog === "approve" ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-lg">
            <h2 className="font-semibold">Approve reconciliation</h2>
            <p className="text-sm text-stone-500">Loss {batch.loss_mg}mg · Recovery {batch.recovery_mg}mg</p>
            <label className="block text-sm">Reason (required)<input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} /></label>
            <label className="block text-sm">Approver ID (if over threshold)<input value={approver} onChange={(e) => setApprover(e.target.value)} className={inputCls} /></label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDialog(null)} className="rounded-md border px-3 py-2 text-sm">Cancel</button>
              <button onClick={() => call("/approve", "POST", { reason, approvedBy: approver || undefined }, "Approved")} className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white">Approve</button>
            </div>
          </div>
        </div>
      ) : null}
      {dialog === "void" ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-lg">
            <h2 className="font-semibold">Void batch</h2>
            <label className="block text-sm">Reason<input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} /></label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDialog(null)} className="rounded-md border px-3 py-2 text-sm">Cancel</button>
              <button onClick={() => call("/void", "PATCH", { reason }, "Voided")} className="rounded-md bg-red-700 px-3 py-2 text-sm text-white">Void</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
