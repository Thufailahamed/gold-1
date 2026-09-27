"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { centsToLkr, mgToG } from "@goldos/shared";
import { api } from "@/lib/api";
import {
  Page,
  Hero,
  heroBtnGhost,
  Panel,
  Pill,
  Tabs,
  TableCard,
  EmptyBlock,
  Callout,
  Skeleton,
  controlClass,
} from "@/components/ui";
import { EditIcon, GemIcon, PrinterIcon, RefreshCwIcon, XIcon } from "@/components/icons";

type Detail = {
  product: {
    id: string;
    barcode: string;
    sku: string;
    name: string;
    category_name: string;
    karat: string;
    permille: number;
    gross_mg: number;
    stone_mg: number;
    net_mg: number;
    fine_gold_mg: number;
    making_cents: number;
    wastage_mg: number;
    cost_cents: number | null;
    selling_price_cents: number | null;
    location: string | null;
    notes: string | null;
    image_keys: string[];
    status: string;
    branch_id: string;
  };
  livePrice: { amount_cents: number; rate_cents_per_g: number; rate_effective_from: number } | null;
  noRate: boolean;
};

type Movement = {
  id: string;
  type: string;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  created_at: number;
};

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"specs" | "moves">("specs");
  const [editing, setEditing] = useState(false);
  const detail = useQuery({
    queryKey: ["product", id],
    queryFn: () => api<Detail>(`/api/v1/products/${id}`),
  });
  const moves = useQuery({
    queryKey: ["product-moves", id],
    queryFn: () =>
      api<{ rows: Movement[]; total: number }>(`/api/v1/inventory/movements?productId=${id}&limit=50`),
    enabled: tab === "moves",
  });
  const labelUrl = `${API}/api/v1/products/${id}/label`;

  const voidIt = useMutation({
    mutationFn: (reason: string) =>
      api(`/api/v1/products/${id}/void`, { method: "PATCH", body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      toast.success("Product voided");
      qc.invalidateQueries({ queryKey: ["product", id] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Void failed"),
  });

  function onVoid() {
    const reason = window.prompt("Reason for void (required):");
    if (!reason) return;
    voidIt.mutate(reason);
  }

  if (detail.isLoading)
    return (
      <Page>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </Page>
    );
  if (detail.isError || !detail.data)
    return (
      <Page>
        <Callout
          tone="danger"
          title="Product not found"
          action={
            <button
              onClick={() => router.push("/products")}
              className="g-btn g-btn-secondary h-8 px-3 text-xs"
            >
              Back to list
            </button>
          }
        >
          The requested product could not be loaded.
        </Callout>
      </Page>
    );
  const { product, livePrice, noRate } = detail.data;

  return (
    <Page>
      <Hero
        back={{ href: "/products", label: "Products" }}
        kicker="Catalog · Piece detail"
        title={product.name}
        meta={
          <>
            <Pill tone="ghost" className="font-mono normal-case tracking-normal">
              {product.barcode}
            </Pill>
            <Pill tone="ghost" className="font-mono normal-case tracking-normal">
              {product.sku}
            </Pill>
            <Pill tone="ghost" dot>
              {product.status.replace(/_/g, " ")}
            </Pill>
          </>
        }
        actions={
          <>
            {product.status !== "VOID" ? (
              <button onClick={() => setEditing(true)} className={heroBtnGhost}>
                <EditIcon size={14} />
                Edit
              </button>
            ) : null}
            {product.status === "IN_STOCK" ? (
              <button
                onClick={onVoid}
                className="g-btn h-10 px-4 text-sm text-rose-300 shadow-[inset_0_0_0_1px_rgba(251,113,133,0.35)] transition-colors hover:bg-rose-600/20"
              >
                Void
              </button>
            ) : null}
          </>
        }
        stats={[
          {
            label: "Live price",
            value: livePrice
              ? `${centsToLkr(livePrice.amount_cents).toLocaleString("en-US")} LKR`
              : "—",
          },
          { label: "Net weight", value: `${mgToG(product.net_mg)} g` },
          { label: "Karat", value: product.karat },
          {
            label: "Making",
            value: `${centsToLkr(product.making_cents).toLocaleString("en-US")} LKR`,
          },
        ]}
        note={
          livePrice
            ? "Live price = net weight × board rate + making"
            : "Publish a board rate to enable live pricing for this piece"
        }
      />

      {noRate || !livePrice ? (
        <Callout tone="warning" title="Price unavailable">
          No rate published for {product.karat} — publish a board rate to enable live pricing.
        </Callout>
      ) : null}

      <Tabs
        ariaLabel="Product detail sections"
        items={[
          { key: "specs" as const, label: "Specs", icon: <GemIcon size={15} /> },
          { key: "moves" as const, label: "Movements", icon: <RefreshCwIcon size={15} /> },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "specs" ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Category", product.category_name],
            ["Karat", `${product.karat} (${product.permille})`],
            ["Gross", `${mgToG(product.gross_mg)}g`],
            ["Stone", `${mgToG(product.stone_mg)}g`],
            ["Net", `${mgToG(product.net_mg)}g`],
            ["Fine gold", `${mgToG(product.fine_gold_mg)}g`],
            ["Wastage", `${mgToG(product.wastage_mg)}g`],
            ["Making", `${centsToLkr(product.making_cents).toLocaleString("en-US")} LKR`],
            [
              "Cost",
              product.cost_cents !== null
                ? `${centsToLkr(product.cost_cents).toLocaleString("en-US")} LKR`
                : "—",
            ],
            [
              "Selling",
              product.selling_price_cents !== null
                ? `${centsToLkr(product.selling_price_cents).toLocaleString("en-US")} LKR`
                : "—",
            ],
            ["Location", product.location ?? "—"],
            ["Status", product.status],
            ["Branch", product.branch_id],
            ["Notes", product.notes ?? "—"],
          ].map(([k, v]) => (
            <div key={k} className="g-surface p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-4">{k}</p>
              <p className="mt-1.5 break-words text-sm font-medium text-ink">{v}</p>
            </div>
          ))}
        </div>
      ) : (
        <TableCard title="Movement history" description="Every status change for this piece">
          {(moves.data?.rows ?? []).length === 0 && !moves.isLoading ? (
            <EmptyBlock title="No movements" description="This piece has no recorded movements yet." />
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>From → To</th>
                  <th>Reason</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {(moves.data?.rows ?? []).map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Pill tone="neutral" className="font-mono normal-case tracking-normal">
                        {m.type}
                      </Pill>
                    </td>
                    <td className="text-xs text-ink-3">
                      {m.from_status ?? "—"} → {m.to_status}
                    </td>
                    <td className="text-ink-3">{m.reason ?? "—"}</td>
                    <td className="num text-xs">{new Date(m.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      )}

      {product.image_keys.length > 0 ? (
        <Panel title="Images" description={`${product.image_keys.length} attached`}>
          <div className="flex flex-wrap gap-3">
            {product.image_keys.map((k) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={k}
                src={`${API}/api/v1/products/${id}/images/${k.split("/").pop()}`}
                alt={product.barcode}
                className="h-32 w-32 rounded-lg object-cover shadow-[inset_0_0_0_1px_rgba(28,25,23,0.1)]"
              />
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel title="Barcode label" description="Print-ready label for this piece" icon={<PrinterIcon size={16} />}>
        <div className="print-area">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={labelUrl} alt={`Label for ${product.barcode}`} className="max-w-sm" />
        </div>
        <div className="mt-4 flex gap-2 print:hidden">
          <button
            onClick={() => router.push(`/products/${id}/print`)}
            className="g-btn g-btn-secondary h-9 px-3.5 text-sm"
          >
            Print view
          </button>
          <button onClick={() => window.print()} className="g-btn g-btn-primary h-9 px-3.5 text-sm">
            <PrinterIcon size={14} />
            Print label
          </button>
        </div>
      </Panel>

      {editing ? (
        <EditDialog
          id={id}
          onClose={() => {
            setEditing(false);
            qc.invalidateQueries({ queryKey: ["product", id] });
            qc.invalidateQueries({ queryKey: ["products"] });
          }}
        />
      ) : null}
    </Page>
  );
}

function EditDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [makingLkr, setMakingLkr] = useState("");
  const [wastageG, setWastageG] = useState("");
  const [costLkr, setCostLkr] = useState("");
  const [sellingPriceLkr, setSellingPriceLkr] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    const body: Record<string, unknown> = {};
    if (makingLkr !== "") body.makingLkr = Number(makingLkr);
    if (wastageG !== "") body.wastageG = Number(wastageG);
    if (costLkr !== "") body.costLkr = Number(costLkr);
    if (sellingPriceLkr !== "") body.sellingPriceLkr = Number(sellingPriceLkr);
    if (location !== "") body.location = location;
    if (notes !== "") body.notes = notes;
    try {
      if (Object.keys(body).length > 0) {
        await api(`/api/v1/products/${id}`, { method: "PATCH", body: JSON.stringify(body) });
        toast.success("Product updated");
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setPending(false);
    }
  }

  const cls = controlClass;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="g-floating w-full max-w-md animate-fade-in space-y-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="g-kicker">Edit</div>
            <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-ink">
              Edit product <span className="text-ink-4">(weights locked)</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-ink-4 transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <XIcon size={16} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-3">Making LKR</label>
            <input type="number" step="any" value={makingLkr} onChange={(e) => setMakingLkr(e.target.value)} className={cls} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-3">Wastage g</label>
            <input type="number" step="any" value={wastageG} onChange={(e) => setWastageG(e.target.value)} className={cls} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-3">Cost LKR</label>
            <input type="number" step="any" value={costLkr} onChange={(e) => setCostLkr(e.target.value)} className={cls} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-3">Selling LKR</label>
            <input type="number" step="any" value={sellingPriceLkr} onChange={(e) => setSellingPriceLkr(e.target.value)} className={cls} />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-3">Location</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} className={cls} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-3">Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={cls} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="g-btn g-btn-secondary h-10 px-4 text-sm">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={pending}
            className="g-btn g-btn-primary h-10 px-4 text-sm"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
