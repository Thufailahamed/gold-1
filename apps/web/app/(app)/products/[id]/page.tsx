"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { centsToLkr, mgToG } from "@goldos/shared";
import { api, formApi } from "@/lib/api";
import { LineageChain, type LineageNode, type LineageEdge } from "@/components/lineage-chain";
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
  Modal,
  Skeleton,
  controlClass,
} from "@/components/ui";
import { EditIcon, GemIcon, PrinterIcon, RefreshCwIcon, TrashIcon } from "@/components/icons";

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
    subcategory_id?: string | null;
    design_id?: string | null;
    product_type_id?: string | null;
    stone_type_id?: string | null;
    image_keys: string[];
    status: string;
    branch_id: string;
    reserved_customer_id: string | null;
    reserved_customer_name: string | null;
    reserved_note: string | null;
    reserved_until: number | null;
    reserved_at: number | null;
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
  const [reserving, setReserving] = useState(false);
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

  const refreshProduct = () => {
    qc.invalidateQueries({ queryKey: ["product", id] });
    qc.invalidateQueries({ queryKey: ["product-moves", id] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  const release = useMutation({
    mutationFn: (reason: string) =>
      api(`/api/v1/products/${id}/release`, { method: "POST", body: JSON.stringify({ reason: reason || undefined }) }),
    onSuccess: () => {
      toast.success("Hold released — piece is back on the shelf");
      refreshProduct();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Release failed"),
  });

  function onRelease() {
    const reason = window.prompt("Why is the hold ending? (optional)");
    if (reason === null) return;
    release.mutate(reason);
  }

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return formApi(`/api/v1/products/${id}/images`, form);
    },
    onSuccess: () => {
      toast.success("Image added");
      refreshProduct();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Upload failed"),
  });

  const removeImage = useMutation({
    mutationFn: (img: string) => api(`/api/v1/products/${id}/images/${img}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Image removed");
      refreshProduct();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Remove failed"),
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
  const holdExpired = product.reserved_until !== null && product.reserved_until < Date.now();

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
            {product.status === "IN_STOCK" || product.status === "RESERVED" ? (
              <Link href={`/pos?add=${encodeURIComponent(product.barcode)}`} className={heroBtnGhost}>
                Sell at POS
              </Link>
            ) : null}
            {product.status === "IN_STOCK" ? (
              <button onClick={() => setReserving(true)} className={heroBtnGhost}>
                Reserve
              </button>
            ) : null}
            {product.status === "RESERVED" ? (
              <button onClick={onRelease} disabled={release.isPending} className={heroBtnGhost}>
                Release hold
              </button>
            ) : null}
            {product.status === "SOLD" || product.status === "RETURNED" ? (
              <Link href={`/sales/invoices/lookup/${encodeURIComponent(product.barcode)}`} className={heroBtnGhost}>
                Find sale
              </Link>
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

      {product.status === "RESERVED" ? (
        <Callout
          tone={holdExpired ? "danger" : "warning"}
          title={`Held for ${product.reserved_customer_name ?? "a customer"}${holdExpired ? " — hold expired" : ""}`}
        >
          {product.reserved_note ?? ""}
          {product.reserved_until !== null
            ? ` · until ${new Date(product.reserved_until).toLocaleDateString()}`
            : " · no end date"}
          {product.reserved_at !== null ? ` · since ${new Date(product.reserved_at).toLocaleDateString()}` : ""}
          . Only this customer can buy it at the POS; release the hold to sell it to anyone else.
        </Callout>
      ) : null}

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

      {product.image_keys.length > 0 || product.status !== "VOID" ? (
        <Panel
          title="Images"
          description={`${product.image_keys.length} of 10 attached`}
          actions={
            product.status !== "VOID" && product.image_keys.length < 10 ? (
              <label className="g-btn g-btn-secondary h-8 cursor-pointer px-3 text-xs">
                {upload.isPending ? "Uploading…" : "Add image"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={upload.isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) upload.mutate(file);
                  }}
                />
              </label>
            ) : null
          }
        >
          {product.image_keys.length === 0 ? (
            <p className="text-sm text-ink-4">No images yet. JPEG, PNG or WebP, up to 5 MB each.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {product.image_keys.map((k) => {
                const img = k.split("/").pop()!;
                return (
                  <div key={k} className="group relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${API}/api/v1/products/${id}/images/${img}`}
                      alt={product.barcode}
                      className="h-32 w-32 rounded-lg object-cover shadow-[inset_0_0_0_1px_rgba(28,25,23,0.1)]"
                    />
                    {product.status !== "VOID" ? (
                      <button
                        onClick={() => {
                          if (window.confirm("Remove this image?")) removeImage.mutate(img);
                        }}
                        disabled={removeImage.isPending}
                        aria-label="Remove image"
                        className="absolute right-1.5 top-1.5 inline-flex size-7 items-center justify-center rounded-md bg-paper/90 text-rose-600 shadow transition-colors hover:bg-rose-50"
                      >
                        <TrashIcon size={14} />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
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

      <Panel title="Gold lineage" description="Backwards and forwards through every transformation">
        <LineageSection refEntity="product" refId={id} />
      </Panel>

      {reserving ? (
        <ReserveDialog
          id={id}
          onClose={(saved) => {
            setReserving(false);
            if (saved) refreshProduct();
          }}
        />
      ) : null}

      {editing ? (
        <EditDialog
          product={product}
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

function EditDialog({
  product,
  onClose,
}: {
  product: Detail["product"];
  onClose: () => void;
}) {
  const [name, setName] = useState(product.name);
  const [makingLkr, setMakingLkr] = useState(String(centsToLkr(product.making_cents)));
  const [wastageG, setWastageG] = useState(String(mgToG(product.wastage_mg)));
  const [costLkr, setCostLkr] = useState(product.cost_cents !== null ? String(centsToLkr(product.cost_cents)) : "");
  const [sellingPriceLkr, setSellingPriceLkr] = useState(product.selling_price_cents !== null ? String(centsToLkr(product.selling_price_cents)) : "");
  const [location, setLocation] = useState(product.location ?? "");
  const [notes, setNotes] = useState(product.notes ?? "");
  const [subcategoryId, setSubcategoryId] = useState(product.subcategory_id ?? "");
  const [designId, setDesignId] = useState(product.design_id ?? "");
  const [productTypeId, setProductTypeId] = useState(product.product_type_id ?? "");
  const [stoneTypeId, setStoneTypeId] = useState(product.stone_type_id ?? "");
  const [pending, setPending] = useState(false);

  const subcats = useQuery({
    queryKey: ["subcats-all"],
    queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/masters/subcategories?limit=100"),
  });
  const designs = useQuery({
    queryKey: ["designs-all"],
    queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/masters/designs?limit=100"),
  });
  const ptypes = useQuery({
    queryKey: ["ptypes-all"],
    queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/masters/product-types?limit=100"),
  });
  const stones = useQuery({
    queryKey: ["stones-all"],
    queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/masters/stone-types?limit=100"),
  });

  async function save() {
    setPending(true);
    const body: Record<string, unknown> = {
      name: name.trim() || undefined,
      makingLkr: makingLkr !== "" ? Number(makingLkr) : 0,
      wastageG: wastageG !== "" ? Number(wastageG) : 0,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      subcategoryId: subcategoryId || undefined,
      designId: designId || undefined,
      productTypeId: productTypeId || undefined,
      stoneTypeId: stoneTypeId || undefined,
    };
    if (costLkr !== "") body.costLkr = Number(costLkr);
    if (sellingPriceLkr !== "") body.sellingPriceLkr = Number(sellingPriceLkr);

    try {
      await api(`/api/v1/products/${product.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast.success("Product updated");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setPending(false);
    }
  }

  const cls = controlClass;
  return (
    <Modal
      title={<>Edit piece <span className="text-ink-4">({product.barcode})</span></>}
      kicker="Edit Product"
      onClose={onClose}
      onSubmit={save}
      pending={pending}
      submitLabel="Save changes"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="mb-1.5 block text-xs font-medium text-ink-3">Product Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required className={cls} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-3">Making charge (LKR)</label>
          <input type="number" step="any" value={makingLkr} onChange={(e) => setMakingLkr(e.target.value)} className={cls} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-3">Wastage (g)</label>
          <input type="number" step="any" value={wastageG} onChange={(e) => setWastageG(e.target.value)} className={cls} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-3">Cost (LKR)</label>
          <input type="number" step="any" value={costLkr} onChange={(e) => setCostLkr(e.target.value)} className={cls} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-3">Selling price (LKR, optional)</label>
          <input type="number" step="any" value={sellingPriceLkr} onChange={(e) => setSellingPriceLkr(e.target.value)} placeholder="Live board rate" className={cls} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-3">Subcategory</label>
          <select value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)} className={cls}>
            <option value="">None</option>
            {(subcats.data?.rows ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-3">Design</label>
          <select value={designId} onChange={(e) => setDesignId(e.target.value)} className={cls}>
            <option value="">None</option>
            {(designs.data?.rows ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-3">Product Type</label>
          <select value={productTypeId} onChange={(e) => setProductTypeId(e.target.value)} className={cls}>
            <option value="">None</option>
            {(ptypes.data?.rows ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-3">Stone Type</label>
          <select value={stoneTypeId} onChange={(e) => setStoneTypeId(e.target.value)} className={cls}>
            <option value="">None</option>
            {(stones.data?.rows ?? []).map((st) => (
              <option key={st.id} value={st.id}>{st.name}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="mb-1.5 block text-xs font-medium text-ink-3">Location / Showcase / Tray</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Showcase A, Tray 3" className={cls} />
        </div>
        <div className="col-span-2">
          <label className="mb-1.5 block text-xs font-medium text-ink-3">Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes or comments" className={cls} />
        </div>
      </div>
    </Modal>
  );
}

type CustomerHit = { id: string; name: string; phone?: string | null };

function ReserveDialog({ id, onClose }: { id: string; onClose: (saved: boolean) => void }) {
  const [search, setSearch] = useState("");
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [note, setNote] = useState("");
  const [untilDate, setUntilDate] = useState("");
  const [pending, setPending] = useState(false);
  const hits = useQuery({
    queryKey: ["reserve-customers", search],
    queryFn: () =>
      api<{ rows: CustomerHit[]; total: number }>(`/api/v1/customers?search=${encodeURIComponent(search)}&limit=8`),
    enabled: search.trim().length > 0 && !customer,
  });

  async function save() {
    if (!customer || !note.trim()) {
      toast.error("Pick a customer and add a note");
      return;
    }
    setPending(true);
    try {
      await api(`/api/v1/products/${id}/reserve`, {
        method: "POST",
        body: JSON.stringify({ customerId: customer.id, note: note.trim(), untilDate: untilDate || undefined }),
      });
      toast.success(`Held for ${customer.name}`);
      onClose(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reserve failed");
    } finally {
      setPending(false);
    }
  }

  const cls = controlClass;
  return (
    <Modal
      title="Reserve for a customer"
      kicker="Hold"
      onClose={() => onClose(false)}
      onSubmit={save}
      pending={pending}
      submitDisabled={!customer || !note.trim()}
      submitLabel="Reserve"
    >
      <div>
        <label className="mb-1.5 block text-xs font-medium text-ink-3">Customer</label>
        {customer ? (
          <div className="flex items-center justify-between rounded-lg bg-bone px-3 py-2 text-sm">
            <span className="font-medium text-ink">
              {customer.name}
              {customer.phone ? <span className="text-ink-4"> · {customer.phone}</span> : null}
            </span>
            <button type="button" onClick={() => setCustomer(null)} className="text-xs font-medium underline">
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or phone…"
              className={cls}
            />
            {(hits.data?.rows ?? []).length > 0 ? (
              <ul className="mt-1.5 divide-y divide-mist rounded-lg shadow-[inset_0_0_0_1px_rgba(28,25,23,0.1)]">
                {hits.data!.rows.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setCustomer(c)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-bone"
                    >
                      {c.name}
                      {c.phone ? <span className="text-ink-4"> · {c.phone}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : search.trim() && !hits.isLoading ? (
              <p className="mt-1.5 text-xs text-ink-4">
                No match. <Link href="/customers" className="underline">Add the customer</Link> first.
              </p>
            ) : null}
          </>
        )}
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-ink-3">Note (required)</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Resizing to 7, collecting Friday"
          maxLength={500}
          className={cls}
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-ink-3">Hold until (optional)</label>
        <input type="date" value={untilDate} onChange={(e) => setUntilDate(e.target.value)} className={cls} />
      </div>
    </Modal>
  );
}

function LineageSection({ refEntity, refId }: { refEntity: string; refId: string }) {
  const lineage = useQuery({
    queryKey: ["lineage", refEntity, refId],
    queryFn: () =>
      api<{ nodes: LineageNode[]; edges: LineageEdge[] }>(
        `/api/v1/gold/lineage?refEntity=${refEntity}&refId=${refId}`
      ),
  });
  if (lineage.isLoading) return <p className="text-sm text-ink-4">Loading lineage…</p>;
  if (lineage.isError || !lineage.data) return <p className="text-sm text-ink-4">Lineage unavailable.</p>;
  return <LineageChain nodes={lineage.data.nodes} edges={lineage.data.edges} />;
}
