"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { centsToLkr, mgToG } from "@goldos/shared";
import { api, formApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Select } from "@/components/select";
import { LineageChain, type LineageNode, type LineageEdge } from "@/components/lineage-chain";
import { Page, Callout, Modal, Skeleton, controlClass } from "@/components/ui";
import { Card, CardHead, Empty, GoldHero, HeroBadge, RowsSkeleton, ago, heroGhost, heroGold, stamp } from "@/components/console-kit";
import {
  AlertCircleIcon,
  BanknoteIcon,
  CameraIcon,
  EditIcon,
  GemIcon,
  HistoryIcon,
  LayersIcon,
  PlusIcon,
  PrinterIcon,
  ScaleIcon,
  StoreIcon,
  TagsIcon,
  TrashIcon,
} from "@/components/icons";

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
    cost_cents?: number | null;
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

const g = (mg: number) => (mg / 1000).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const whole = (cents: number) => centsToLkr(cents).toLocaleString("en-US");
const humanize = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "muted" | "gold"> = {
  IN_STOCK: "good",
  RESERVED: "warn",
  SOLD: "gold",
  IN_REPAIR: "bad",
  LOST: "bad",
  VOID: "muted",
  MELTED: "muted",
};

/** One labelled line in a breakdown, optionally the bold total. */
function Line({ k, v, sub, total, tone }: { k: string; v: React.ReactNode; sub?: React.ReactNode; total?: boolean; tone?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 px-4 py-1.5", total && "border-t border-ink/[0.08] bg-gold-pale/40 py-2")}>
      <span className={cn("text-[12px]", total ? "font-semibold text-ink" : "text-ink-3")}>
        {k}
        {sub ? <span className="ml-1.5 text-[10.5px] text-ink-5">{sub}</span> : null}
      </span>
      <span className={cn("g-metric text-right", total ? "text-[15px] font-semibold" : "text-[12.5px]", tone ?? "text-ink")}>{v}</span>
    </div>
  );
}

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [shot, setShot] = useState(0);
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
  });
  const branches = useQuery({
    queryKey: ["branches-names"],
    queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/branches?limit=100"),
    staleTime: 5 * 60_000,
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
      <Page className="space-y-4">
        <Skeleton className="h-40 rounded-[20px]" />
        <div className="grid gap-4 xl:grid-cols-12">
          <Skeleton className="h-80 rounded-2xl xl:col-span-4" />
          <Skeleton className="h-80 rounded-2xl xl:col-span-8" />
        </div>
      </Page>
    );
  if (detail.isError || !detail.data)
    return (
      <Page>
        <Callout
          tone="danger"
          title="Product not found"
          action={
            <button onClick={() => router.push("/products")} className="g-btn g-btn-secondary h-8 px-3 text-xs">
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
  const branchName = branches.data?.rows.find((b) => b.id === product.branch_id)?.name;
  const price = product.selling_price_cents ?? livePrice?.amount_cents ?? null;
  // cost_cents is absent (undefined) when the viewer may not see book cost;
  // null means the piece genuinely has no cost recorded yet.
  const costHidden = product.cost_cents === undefined;
  const margin = price !== null && product.cost_cents != null ? price - product.cost_cents : null;
  const marginPct = margin !== null && price ? (margin / price) * 100 : null;
  const metalValue = livePrice ? livePrice.amount_cents - product.making_cents : null;
  const imgs = product.image_keys.map((k) => k.split("/").pop()!);
  const current = imgs[Math.min(shot, imgs.length - 1)];
  const editable = product.status !== "VOID";
  const pct = (part: number) => (product.gross_mg > 0 ? (part / product.gross_mg) * 100 : 0);
  const fixedVsLive =
    product.selling_price_cents !== null && livePrice ? ((product.selling_price_cents - livePrice.amount_cents) / livePrice.amount_cents) * 100 : null;
  const moveRows = moves.data?.rows ?? [];

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={GemIcon}
        title={product.name}
        badge={<HeroBadge tone={STATUS_TONE[product.status] ?? "muted"}>{humanize(product.status)}</HeroBadge>}
        sub={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="g-metric rounded bg-gold/15 px-1.5 text-gold-light">{product.barcode}</span>
            <span className="g-metric">{product.sku}</span>
            <span>·</span>
            <span>{product.category_name}</span>
            {branchName ? (
              <>
                <span>·</span>
                <span>{branchName}</span>
              </>
            ) : null}
            {product.location ? (
              <>
                <span>·</span>
                <span>@ {product.location}</span>
              </>
            ) : null}
          </span>
        }
        back={{ href: "/products", label: "Products" }}
        actions={
          <>
            {editable ? (
              <button onClick={() => setEditing(true)} className={heroGhost}>
                <EditIcon size={13} />
                Edit
              </button>
            ) : null}
            {product.status === "IN_STOCK" ? (
              <button onClick={() => setReserving(true)} className={heroGhost}>
                Reserve
              </button>
            ) : null}
            {product.status === "RESERVED" ? (
              <button onClick={onRelease} disabled={release.isPending} className={heroGhost}>
                Release hold
              </button>
            ) : null}
            {product.status === "SOLD" || product.status === "RETURNED" ? (
              <Link href={`/sales/invoices/lookup/${encodeURIComponent(product.barcode)}`} className={heroGhost}>
                Find sale
              </Link>
            ) : null}
            {product.status === "IN_STOCK" ? (
              <button
                onClick={onVoid}
                className="home-btn-ghost h-8 px-3 text-[12.5px] !text-rose-300 shadow-[inset_0_0_0_1px_rgba(251,113,133,0.35)] hover:!bg-rose-600/20"
              >
                Void
              </button>
            ) : null}
            {product.status === "IN_STOCK" || product.status === "RESERVED" ? (
              <Link href={`/pos?add=${encodeURIComponent(product.barcode)}`} className={heroGold}>
                <BanknoteIcon size={13} />
                Sell at POS
              </Link>
            ) : null}
          </>
        }
        stats={[
          {
            label: product.selling_price_cents !== null ? "Fixed price" : "Live price",
            value: price !== null ? centsToLkr(price) : null,
            format: (n) => Math.round(n).toLocaleString("en-US"),
            unit: "LKR",
            accent: true,
            sub: product.selling_price_cents !== null ? "manual override" : livePrice ? "net × board + making" : "no board rate",
          },
          {
            label: `Board · ${product.karat}`,
            value: livePrice ? centsToLkr(livePrice.rate_cents_per_g) : null,
            format: (n) => Math.round(n).toLocaleString("en-US"),
            unit: "LKR/g",
            sub: livePrice ? `set ${ago(livePrice.rate_effective_from)}` : undefined,
          },
          { label: "Gross", value: product.gross_mg, format: g, unit: "g" },
          { label: "Net", value: product.net_mg, format: g, unit: "g", sub: product.stone_mg ? `${g(product.stone_mg)} g stones` : "no stones" },
          { label: "Fine gold", value: product.fine_gold_mg, format: g, unit: "g", sub: `${product.permille}‰` },
          { label: "Making", value: centsToLkr(product.making_cents), format: (n) => Math.round(n).toLocaleString("en-US"), unit: "LKR" },
          ...(costHidden
            ? []
            : [
                {
                  label: "Book cost",
                  value:
                    product.cost_cents !== null && product.cost_cents !== undefined
                      ? centsToLkr(product.cost_cents)
                      : null,
                  format: (n: number) => Math.round(n).toLocaleString("en-US"),
                  unit: "LKR",
                },
                {
                  label: "Margin",
                  value: marginPct,
                  format: (n: number) => `${n.toFixed(1)}%`,
                  tone: margin === null ? undefined : margin < 0 ? ("bad" as const) : ("good" as const),
                  sub: margin !== null ? `LKR ${whole(margin)}` : "needs cost and price",
                },
              ]),
        ]}
      />

      {product.status === "RESERVED" ? (
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-2.5 text-[12px] ring-1 ring-inset",
            holdExpired ? "bg-rose-500/10 text-rose-900 ring-rose-500/25" : "bg-amber-500/10 text-amber-900 ring-amber-500/25"
          )}
        >
          <span className={cn("size-1.5 rounded-full", holdExpired ? "bg-rose-500" : "animate-pulse-soft bg-amber-500")} />
          <span className="font-semibold">
            Held for {product.reserved_customer_name ?? "a customer"}
            {holdExpired ? " · hold expired" : ""}
          </span>
          {product.reserved_note ? <span>“{product.reserved_note}”</span> : null}
          <span className="text-current/70">
            {product.reserved_until !== null ? `until ${new Date(product.reserved_until).toLocaleDateString()}` : "no end date"}
            {product.reserved_at !== null ? ` · since ${new Date(product.reserved_at).toLocaleDateString()}` : ""}
          </span>
          <span className="ml-auto text-[11px] opacity-75">Only this customer can buy it at the POS</span>
        </div>
      ) : null}
      {noRate || !livePrice ? (
        <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-4 py-2.5 text-[12px] text-amber-900 ring-1 ring-inset ring-amber-500/25">
          <AlertCircleIcon size={14} />
          No board rate published for {product.karat}, so live pricing is off.
          <Link href="/gold-rates" className="ml-auto rounded-md bg-void px-2.5 py-1 text-[11px] font-semibold text-gold-light">
            Publish rate
          </Link>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-12">
        {/* ---------------- left: photos + label */}
        <div className="space-y-4 xl:col-span-4">
          <Card>
            <div className="relative m-1.5 aspect-square overflow-hidden rounded-xl bg-void">
              {current ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${API}/api/v1/products/${id}/images/${current}`} alt={product.name} className="size-full object-cover" />
              ) : (
                <div className="relative flex size-full flex-col items-center justify-center text-center">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(226,194,122,0.3),transparent_60%)]" />
                  <div className="home-grid-bg absolute inset-0 opacity-60" />
                  <span className="g-display pointer-events-none absolute -bottom-4 -right-1 select-none text-[7rem] leading-none text-gold/[0.08]">{product.karat}</span>
                  <GemIcon size={40} className="relative text-gold-light drop-shadow-[0_10px_20px_rgba(205,168,83,0.45)]" />
                  <p className="relative mt-3 text-[12px] font-semibold text-paper/80">No photos yet</p>
                  <p className="relative text-[10.5px] text-paper/40">JPEG, PNG or WebP · up to 5 MB</p>
                </div>
              )}
              <span className="g-metric absolute left-2.5 top-2.5 rounded-md bg-gradient-to-b from-gold-light to-gold px-1.5 py-0.5 text-[11px] font-bold text-void">{product.karat}</span>
              {current && editable ? (
                <button
                  onClick={() => {
                    if (window.confirm("Remove this image?")) removeImage.mutate(current);
                  }}
                  disabled={removeImage.isPending}
                  aria-label="Remove image"
                  className="absolute right-2.5 top-2.5 inline-flex size-7 items-center justify-center rounded-md bg-paper/90 text-rose-600 shadow transition-colors hover:bg-rose-50"
                >
                  <TrashIcon size={13} />
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5 px-2 pb-2 pt-1">
              {imgs.map((img, i) => (
                <button
                  key={img}
                  type="button"
                  onClick={() => setShot(i)}
                  className={cn(
                    "size-12 shrink-0 overflow-hidden rounded-lg ring-2 transition-all",
                    img === current ? "ring-gold" : "ring-transparent opacity-70 hover:opacity-100"
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${API}/api/v1/products/${id}/images/${img}`} alt="" className="size-full object-cover" />
                </button>
              ))}
              {editable && imgs.length < 10 ? (
                <label className="flex size-12 shrink-0 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-ink/20 text-ink-4 transition-colors hover:border-gold hover:bg-gold-pale/40 hover:text-gold-deep">
                  {upload.isPending ? <span className="size-3.5 animate-spin rounded-full border-2 border-gold/30 border-t-gold" /> : <PlusIcon size={14} />}
                  <span className="text-[8.5px] font-semibold">Add</span>
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
              ) : null}
              <span className="g-metric ml-auto pr-1 text-[10px] text-ink-5">
                <CameraIcon size={11} className="mr-1 inline" />
                {imgs.length}/10
              </span>
            </div>
          </Card>

          <Card>
            <CardHead
              icon={PrinterIcon}
              title="Barcode label"
              sub="Print-ready tag for this piece"
              action={
                <>
                  <button onClick={() => router.push(`/products/${id}/print`)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-ink-3 ring-1 ring-inset ring-ink/10 hover:bg-bone">
                    Print view
                  </button>
                  <button onClick={() => window.print()} className="inline-flex items-center gap-1 rounded-md bg-void px-2 py-1 text-[11px] font-semibold text-gold-light">
                    <PrinterIcon size={11} />
                    Print
                  </button>
                </>
              }
            />
            <div className="print-area flex justify-center bg-[repeating-linear-gradient(45deg,rgba(16,32,27,0.025)_0_8px,transparent_8px_16px)] p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={labelUrl} alt={`Label for ${product.barcode}`} className="max-w-full rounded-md bg-white shadow-[0_12px_28px_-18px_rgba(16,32,27,0.5)]" />
            </div>
          </Card>
        </div>

        {/* ---------------- right: the numbers */}
        <div className="grid content-start gap-4 lg:grid-cols-2 xl:col-span-8">
          <Card>
            <CardHead icon={BanknoteIcon} title="Price build-up" sub={product.selling_price_cents !== null ? "Fixed price, with the live figure for comparison" : "How the till prices this piece"} />
            <div className="py-1.5">
              {livePrice ? (
                <>
                  <Line k="Net weight" v={`${g(product.net_mg)} g`} />
                  <Line k={`× ${product.karat} board rate`} v={`${whole(livePrice.rate_cents_per_g)} /g`} />
                  <Line k="= Metal value" v={metalValue !== null ? whole(metalValue) : "—"} />
                  <Line k="+ Making charge" v={whole(product.making_cents)} />
                  <Line k="Live price" v={`LKR ${whole(livePrice.amount_cents)}`} total tone="text-gold-deep" />
                </>
              ) : (
                <Line k="Live price" v="No board rate" />
              )}
              {product.selling_price_cents !== null ? (
                <Line
                  k="Fixed price"
                  sub={fixedVsLive !== null ? `${fixedVsLive > 0 ? "+" : ""}${fixedVsLive.toFixed(1)}% vs live` : undefined}
                  v={`LKR ${whole(product.selling_price_cents)}`}
                  total
                />
              ) : null}
            </div>
            {costHidden ? null : (
            <div className="mt-auto border-t border-ink/[0.06] px-4 py-2.5">
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="text-ink-4">
                  Cost <span className="g-metric text-ink-2">{product.cost_cents != null ? whole(product.cost_cents) : "—"}</span>
                </span>
                <span className={cn("g-metric font-semibold", margin === null ? "text-ink-5" : margin < 0 ? "text-rose-700" : "text-emerald-700")}>
                  {margin !== null ? `${margin > 0 ? "+" : ""}${whole(margin)}${marginPct !== null ? ` · ${marginPct.toFixed(1)}%` : ""}` : "Margin needs a cost"}
                </span>
              </div>
              {marginPct !== null ? (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                  <div
                    className={cn("h-full rounded-full", marginPct < 0 ? "bg-rose-500" : "bg-gradient-to-r from-emerald-600 to-emerald-400")}
                    style={{ width: `${Math.min(100, Math.abs(marginPct))}%` }}
                  />
                </div>
              ) : null}
            </div>
            )}
          </Card>

          <Card>
            <CardHead icon={ScaleIcon} title="Weights" sub={`${product.karat} · ${product.permille}‰ fine`} />
            <div className="px-4 pt-3">
              <div className="flex h-3 overflow-hidden rounded-full bg-ink/[0.06]" title="Gross weight split">
                <div className="bg-gradient-to-r from-gold-deep to-gold" style={{ width: `${pct(product.fine_gold_mg)}%` }} title="Fine gold" />
                <div className="bg-gold-light/60" style={{ width: `${pct(product.net_mg - product.fine_gold_mg)}%` }} title="Alloy" />
                <div className="bg-sky-400/70" style={{ width: `${pct(product.stone_mg)}%` }} title="Stones" />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 text-[10px] text-ink-5">
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-gold" /> Fine {pct(product.fine_gold_mg).toFixed(1)}%
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-gold-light/60" /> Alloy
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-sky-400/70" /> Stones {pct(product.stone_mg).toFixed(1)}%
                </span>
              </div>
            </div>
            <div className="py-1.5">
              <Line k="Gross" v={`${g(product.gross_mg)} g`} />
              <Line k="− Stones" v={`${g(product.stone_mg)} g`} tone="text-sky-700" />
              <Line k="= Net" v={`${g(product.net_mg)} g`} />
              <Line k="Wastage" sub="allowance" v={`${g(product.wastage_mg)} g`} tone="text-ink-3" />
              <Line k="Fine gold" sub={`net × ${product.permille}‰`} v={`${g(product.fine_gold_mg)} g`} total tone="text-gold-deep" />
            </div>
          </Card>

          <Card>
            <CardHead icon={TagsIcon} title="Identity" sub="Where it sits in the catalogue" />
            <dl className="grid grid-cols-2 gap-px bg-ink/[0.05]">
              {[
                { k: "Category", v: product.category_name },
                { k: "Karat", v: `${product.karat} · ${product.permille}‰` },
                { k: "Branch", v: branchName ?? "—", icon: StoreIcon },
                { k: "Location", v: product.location ?? "—" },
                { k: "Barcode", v: product.barcode, mono: true },
                { k: "SKU", v: product.sku, mono: true },
              ].map((f) => (
                <div key={f.k} className="bg-paper px-4 py-2">
                  <dt className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{f.k}</dt>
                  <dd className={cn("mt-0.5 truncate text-[12.5px] font-medium text-ink", f.mono && "g-metric")}>{f.v}</dd>
                </div>
              ))}
            </dl>
            {product.notes ? (
              <div className="border-t border-ink/[0.06] bg-gold-pale/30 px-4 py-2.5">
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-gold-dark">Notes</div>
                <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-2">{product.notes}</p>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHead icon={HistoryIcon} title="Movements" sub={moves.data ? `${moves.data.total} status changes` : "Every status change"} />
            {moves.isLoading ? (
              <RowsSkeleton rows={3} />
            ) : moveRows.length === 0 ? (
              <Empty icon={HistoryIcon} title="No movements" desc="This piece has no recorded movements yet." />
            ) : (
              <ol className="max-h-[300px] space-y-0 overflow-y-auto px-4 py-2 scrollbar-thin">
                {moveRows.map((m, i) => (
                  <li key={m.id} className="relative flex gap-3 pb-3 last:pb-1">
                    {i < moveRows.length - 1 ? <span className="absolute left-[5px] top-3 h-full w-px bg-ink/10" aria-hidden /> : null}
                    <span className="relative mt-1.5 size-[11px] shrink-0 rounded-full bg-gold ring-2 ring-paper" />
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="g-metric text-[11.5px] font-semibold text-ink">{m.type}</span>
                        <span className="text-[10.5px] text-ink-5" title={stamp(m.created_at)}>
                          {ago(m.created_at)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-ink-4">
                        {m.from_status ? humanize(m.from_status) : "—"} → <span className="font-medium text-ink-2">{humanize(m.to_status)}</span>
                      </div>
                      {m.reason ? <div className="mt-0.5 truncate text-[10.5px] text-ink-5">{m.reason}</div> : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card className="lg:col-span-2">
            <CardHead icon={LayersIcon} title="Gold lineage" sub="Backwards and forwards through every transformation" />
            <div className="p-4">
              <LineageSection refEntity="product" refId={id} />
            </div>
          </Card>
        </div>
      </div>

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

const withNone = (rows?: { id: string; name: string }[]) => [
  { value: "", label: "None" },
  ...(rows ?? []).map((r) => ({ value: r.id, label: r.name })),
];

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
  const [costLkr, setCostLkr] = useState(product.cost_cents != null ? String(centsToLkr(product.cost_cents)) : "");
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

  const cls = `${controlClass} w-full !h-9 !rounded-lg !px-3`;
  return (
    <Modal
      title={<>Edit piece <span className="text-ink-4">({product.barcode})</span></>}
      kicker="Edit Product"
      wide
      onClose={onClose}
      onSubmit={save}
      pending={pending}
      submitLabel="Save changes"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Product Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required className={cls} />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Making charge (LKR)</label>
          <input type="number" step="any" value={makingLkr} onChange={(e) => setMakingLkr(e.target.value)} className={cls} />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Wastage (g)</label>
          <input type="number" step="any" value={wastageG} onChange={(e) => setWastageG(e.target.value)} className={cls} />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Cost (LKR)</label>
          <input type="number" step="any" value={costLkr} onChange={(e) => setCostLkr(e.target.value)} className={cls} />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Selling price (LKR, optional)</label>
          <input type="number" step="any" value={sellingPriceLkr} onChange={(e) => setSellingPriceLkr(e.target.value)} placeholder="Live board rate" className={cls} />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Subcategory</label>
          <Select value={subcategoryId} onChange={setSubcategoryId} options={withNone(subcats.data?.rows)} />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Design</label>
          <Select value={designId} onChange={setDesignId} options={withNone(designs.data?.rows)} />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Product Type</label>
          <Select value={productTypeId} onChange={setProductTypeId} options={withNone(ptypes.data?.rows)} />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Stone Type</label>
          <Select value={stoneTypeId} onChange={setStoneTypeId} options={withNone(stones.data?.rows)} />
        </div>
        <div className="col-span-2">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Location / Showcase / Tray</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Showcase A, Tray 3" className={cls} />
        </div>
        <div className="col-span-2">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Notes</label>
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

  const cls = `${controlClass} w-full !h-9 !rounded-lg !px-3`;
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
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Customer</label>
        {customer ? (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-gold-pale/60 px-3.5 py-3 text-sm shadow-[inset_0_0_0_1px_rgba(205,168,83,0.35)]">
            <span className="font-medium text-ink">
              {customer.name}
              {customer.phone ? <span className="text-ink-4"> · {customer.phone}</span> : null}
            </span>
            <button type="button" onClick={() => setCustomer(null)} className="rounded-lg px-2 py-1 text-xs font-semibold text-gold-dark transition-colors hover:bg-gold/15">
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
              <ul className="g-floating mt-2 max-h-56 space-y-0.5 overflow-y-auto p-1.5 scrollbar-thin">
                {hits.data!.rows.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setCustomer(c)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-ink-2 transition-colors hover:bg-void/[0.06] hover:text-ink"
                    >
                      <span className="font-medium">{c.name}</span>
                      {c.phone ? <span className="num-tabular text-xs text-ink-4">{c.phone}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : search.trim() && !hits.isLoading ? (
              <p className="mt-2 rounded-lg bg-bone px-3 py-2 text-xs text-ink-4">
                No match. <Link href="/customers" className="underline">Add the customer</Link> first.
              </p>
            ) : null}
          </>
        )}
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Note (required)</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Resizing to 7, collecting Friday"
          maxLength={500}
          className={cls}
        />
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Hold until (optional)</label>
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
