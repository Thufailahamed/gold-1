"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { LineageChain, type LineageNode, type LineageEdge } from "@/components/lineage-chain";

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

type ApprovedBatch = { id: string; number: string };
type Lot = { lot_number: string; fine_mg: number };

const inputCls = "w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold";
const STAGES = ["DRAFT", "ALLOCATED", "IN_PRODUCTION", "QC", "COMPLETE"];

function stageOf(status: string): number {
  if (status === "DRAFT") return 0;
  if (status === "ALLOCATED") return 1;
  if (status === "IN_PRODUCTION") return 2;
  if (status === "QC_PASSED" || status === "QC_FAILED") return 3;
  return 4;
}

export default function MfgOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
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

  if (detail.isLoading) return <div className="h-64 animate-pulse rounded-xl bg-stone-200" />;
  if (detail.isError || !detail.data)
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Order not found. <button onClick={() => router.push("/manufacturing/orders")} className="underline">Back</button>
      </div>
    );
  const { order, materials, outputs, ledger } = detail.data;
  const stage = stageOf(order.status);

  return (
    <div className="space-y-4">
      <button onClick={() => router.push("/manufacturing/orders")} className="text-sm text-stone-500 hover:underline">← Orders</button>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-mono text-xl font-semibold">{order.number}</h1>
          <p className="text-sm text-stone-500">{order.type} · {order.design} · {order.status}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {order.status === "DRAFT" ? (
            <button onClick={() => setDialog("materials")} className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white">Add materials</button>
          ) : null}
          {order.status === "ALLOCATED" || order.status === "QC_FAILED" ? (
            <button onClick={() => setDialog("produce")} className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white">Produce</button>
          ) : null}
          {order.status === "IN_PRODUCTION" ? (
            <button onClick={() => setDialog("qc")} className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white">QC check</button>
          ) : null}
          {order.status === "QC_PASSED" ? (
            <FinishButton id={id} onDone={refresh} />
          ) : null}
          {order.status === "DRAFT" || order.status === "ALLOCATED" ? (
            <button onClick={() => setDialog("void")} className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600">Void</button>
          ) : null}
        </div>
      </div>

      <ol className="flex flex-wrap gap-2">
        {["Draft", "Allocated", "Production", "QC", "Complete"].map((s, i) => (
          <li key={s} className={`rounded-full px-3 py-1 text-xs font-medium ${i <= stage ? "bg-stone-900 text-white" : "border text-stone-500"}`}>
            {s}
          </li>
        ))}
      </ol>

      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="font-medium">Materials ({materials.length})</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {materials.map((m) => (
            <li key={`${m.lot_batch_id}:${m.lot_number}`} className="flex justify-between">
              <span className="font-mono text-xs">{m.lot_number}</span>
              <span>{(m.fine_mg / 1000).toLocaleString("en-US")}g fine</span>
            </li>
          ))}
        </ul>
      </div>

      {outputs.length > 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="font-medium">Outputs</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {outputs.map((o) => (
              <li key={o.id} className="flex justify-between">
                <span>{o.name} · {(o.net_mg / 1000).toLocaleString("en-US")}g</span>
                <span>{(o.cost_cents / 100).toLocaleString("en-US")} LKR</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-stone-500">Loss {order.loss_mg}mg{order.loss_reason ? ` — ${order.loss_reason}` : ""}</p>
        </div>
      ) : null}

      {ledger.length > 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="font-medium">Gold postings</h2>
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

      {dialog === "materials" ? <MaterialsDialog orderId={id} onClose={refresh} /> : null}
      {dialog === "produce" ? <ProduceDialog orderId={id} onClose={refresh} /> : null}
      {dialog === "qc" ? <QcDialog orderId={id} onClose={refresh} /> : null}
      {dialog === "void" ? <VoidDialog orderId={id} onClose={refresh} /> : null}
    </div>
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
    <button onClick={finish} disabled={pending} className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
      Finish
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
    <Dialog title="Allocate refined lot" onClose={onClose} onSubmit={save} pending={pending}>
      <label className="block text-sm">Batch
        <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className={inputCls}>
          <option value="">Select approved batch…</option>
          {(batches.data?.rows ?? []).map((b) => (
            <option key={b.id} value={b.id}>{b.number}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm">Lot number (e.g. MLT-000001-01)<input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} className={inputCls} /></label>
      <label className="block text-sm">Fine mg to allocate<input value={fineMg} onChange={(e) => setFineMg(e.target.value)} type="number" className={inputCls} /></label>
    </Dialog>
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
  const [approver, setApprover] = useState("");
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
          approvedBy: approver || undefined,
        }),
      });
      toast.success(`Produced ${(res.outputFineMg / 1000).toLocaleString("en-US")}g, loss ${res.lossPct.toFixed(2)}%`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Produce failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <h2 className="font-semibold">Produce outputs</h2>
        {outputs.map((o) => (
          <div key={o.key} className="grid grid-cols-2 gap-2 rounded-lg border border-stone-200 p-3 md:grid-cols-4">
            <input placeholder="Name" value={o.name} onChange={(e) => set(o.key, { name: e.target.value })} className={inputCls} />
            <select value={o.categoryId} onChange={(e) => set(o.key, { categoryId: e.target.value })} className={inputCls}>
              <option value="">Category…</option>
              {(cats.data?.rows ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select value={o.metalTypeId} onChange={(e) => set(o.key, { metalTypeId: e.target.value })} className={inputCls}>
              <option value="">Metal…</option>
              {(metals.data?.rows ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select value={o.purityId} onChange={(e) => set(o.key, { purityId: e.target.value })} className={inputCls}>
              <option value="">Purity…</option>
              {(purs.data?.rows ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.karat}</option>
              ))}
            </select>
            <input placeholder="Gross g" type="number" step="any" value={o.grossG} onChange={(e) => set(o.key, { grossG: e.target.value })} className={inputCls} />
            <input placeholder="Stone g" type="number" step="any" value={o.stoneG} onChange={(e) => set(o.key, { stoneG: e.target.value })} className={inputCls} />
            <input placeholder="Making LKR" type="number" step="any" value={o.makingLkr} onChange={(e) => set(o.key, { makingLkr: e.target.value })} className={inputCls} />
            <input placeholder="Location" value={o.location} onChange={(e) => set(o.key, { location: e.target.value })} className={inputCls} />
          </div>
        ))}
        <button
          type="button"
          onClick={() => setOutputs((os) => [...os, { key: Date.now(), categoryId: "", metalTypeId: "", purityId: "", name: "", grossG: "", stoneG: "", makingLkr: "", location: "" }])}
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          + Add output
        </button>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <label className="block text-sm">Labour LKR<input value={labour} onChange={(e) => setLabour(e.target.value)} type="number" step="any" className={inputCls} /></label>
          <label className="block text-sm">Making LKR<input value={making} onChange={(e) => setMaking(e.target.value)} type="number" step="any" className={inputCls} /></label>
          <label className="block text-sm">Stones LKR<input value={stones} onChange={(e) => setStones(e.target.value)} type="number" step="any" className={inputCls} /></label>
          <label className="block text-sm">Loss mg<input value={loss} onChange={(e) => setLoss(e.target.value)} type="number" className={inputCls} /></label>
        </div>
        <label className="block text-sm">Loss reason (required if loss &gt; 0)<input value={lossReason} onChange={(e) => setLossReason(e.target.value)} className={inputCls} /></label>
        <label className="block text-sm">Approver ID (if over threshold)<input value={approver} onChange={(e) => setApprover(e.target.value)} className={inputCls} /></label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-2 text-sm">Cancel</button>
          <button onClick={save} disabled={pending} className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50">
            Produce
          </button>
        </div>
      </div>
    </div>
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
    <Dialog title="Quality check" onClose={onClose} onSubmit={save} pending={pending} submitLabel={pass ? "Pass" : "Fail to rework"}>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={pass} onChange={(e) => setPass(e.target.checked)} />
        Pass
      </label>
      <label className="block text-sm">Reason (required to fail)<input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} /></label>
    </Dialog>
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
    <Dialog title="Void order" onClose={onClose} onSubmit={save} pending={pending} submitLabel="Void">
      <label className="block text-sm">Reason<input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} /></label>
    </Dialog>
  );
}

function Dialog({ title, children, onClose, onSubmit, pending, submitLabel = "Save" }: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  pending: boolean;
  submitLabel?: string;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-lg">
        <h2 className="font-semibold">{title}</h2>
        {children}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-2 text-sm">Cancel</button>
          <button onClick={onSubmit} disabled={pending} className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50">
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}