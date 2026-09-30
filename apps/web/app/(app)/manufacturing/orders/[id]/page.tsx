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
  CardLink,
  Pill,
  Modal,
  Skeleton,
  Callout,
  EmptyBlock,
  controlClass,
  heroBtnPrimary,
  heroBtnGhost,
} from "@/components/ui";
import { CheckIcon, PlusIcon, TrashIcon, GemIcon, PackageIcon, BookOpenIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

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

const STAGES = ["Draft", "Allocated", "Production", "QC", "Complete"];

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
      <Page>
        <Skeleton className="h-56" />
        <Skeleton className="h-64" />
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

  return (
    <Page>
      <Hero
        back={{ href: "/manufacturing/orders", label: "Manufacturing orders" }}
        kicker="Workshop"
        title={order.number}
        description={`${order.type} · ${order.design}${order.description ? ` — ${order.description}` : ""}`}
        meta={
          <>
            <Pill tone="ghost" className="!text-paper">{order.status}</Pill>
            <Pill tone="ghost" className="!text-paper">{order.type}</Pill>
          </>
        }
        stats={[
          { label: "Allocated", value: `${g(allocatedMg)} g` },
          { label: "Produced", value: `${g(producedMg)} g` },
          { label: "Loss", value: `${order.loss_mg} mg` },
          { label: "Labour+making", value: `${fmt(order.labour_cents + order.making_cents)} LKR` },
        ]}
        actions={
          <>
            {order.status === "DRAFT" ? (
              <button onClick={() => setDialog("materials")} className={heroBtnPrimary}>Add materials</button>
            ) : null}
            {order.status === "ALLOCATED" || order.status === "QC_FAILED" ? (
              <button onClick={() => setDialog("produce")} className={heroBtnPrimary}>Produce</button>
            ) : null}
            {order.status === "IN_PRODUCTION" ? (
              <button onClick={() => setDialog("qc")} className={heroBtnPrimary}>QC check</button>
            ) : null}
            {order.status === "QC_PASSED" ? (
              <FinishButton id={id} onDone={refresh} />
            ) : null}
            {order.status === "DRAFT" || order.status === "ALLOCATED" ? (
              <button onClick={() => setDialog("void")} className={`${heroBtnGhost} !text-rose-300`}>Void</button>
            ) : null}
          </>
        }
      />

      <ol className="flex flex-wrap gap-2">
        {STAGES.map((s, i) => (
          <li
            key={s}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
              i < stage
                ? "bg-ink text-paper"
                : i === stage
                  ? "bg-gold-soft text-ink shadow-[inset_0_0_0_1px_rgba(168,134,27,0.3)]"
                  : "bg-ink/[0.05] text-ink-4"
            )}
          >
            {i < stage ? <CheckIcon size={12} className="text-gold" /> : null}
            {s}
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Materials" icon={<GemIcon size={17} />} description={`${materials.length} lot${materials.length === 1 ? "" : "s"} allocated`}>
          {materials.length === 0 ? (
            <EmptyBlock title="No materials" description="Allocate refined lots from approved melting batches." />
          ) : (
            <ul className="space-y-2.5 text-sm">
              {materials.map((m) => (
                <li key={`${m.lot_batch_id}:${m.lot_number}`} className="flex items-center justify-between gap-3">
                  <span className="g-metric text-xs text-ink-3">{m.lot_number}</span>
                  <span className="num-tabular font-medium text-ink">{g(m.fine_mg)}g fine</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {outputs.length > 0 ? (
          <Panel
            title="Outputs"
            icon={<PackageIcon size={17} />}
            description={`${outputs.length} produced`}
            actions={
              outputs.some((o) => o.product_id) ? (
                <CardLink
                  href={`/products/labels?ids=${outputs.flatMap((o) => (o.product_id ? [o.product_id] : [])).join(",")}&back=${encodeURIComponent(`/manufacturing/orders/${id}`)}`}
                >
                  Print labels
                </CardLink>
              ) : null
            }
          >
            <ul className="space-y-2.5 text-sm">
              {outputs.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-ink-2">
                    {o.product_id ? (
                      <Link href={`/products/${o.product_id}`} className="font-medium text-ink hover:text-gold-700">{o.name}</Link>
                    ) : (
                      <span className="font-medium text-ink">{o.name}</span>
                    )}{" "}
                    · {g(o.net_mg)}g
                  </span>
                  <span className="num-tabular shrink-0 text-ink">{fmt(o.cost_cents)} LKR</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-ink/10 pt-3 text-xs text-ink-4">
              Loss {order.loss_mg}mg{order.loss_reason ? ` — ${order.loss_reason}` : ""}
            </p>
          </Panel>
        ) : null}
      </div>

      {ledger.length > 0 ? (
        <Panel title="Gold postings" icon={<BookOpenIcon size={17} />}>
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

      <Panel title="Gold lineage" description="From refined lot to finished piece">
        {lineage.data ? (
          <LineageChain nodes={lineage.data.nodes} edges={lineage.data.edges} />
        ) : (
          <Skeleton className="h-10" />
        )}
      </Panel>

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
    <button onClick={finish} disabled={pending} className={cn(heroBtnPrimary, "disabled:opacity-50")}>
      {pending ? "Finishing…" : "Finish"}
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
      <label className="block text-sm text-ink-2">Approver ID (if over threshold)
        <input value={approver} onChange={(e) => setApprover(e.target.value)} className={controlClass} />
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
