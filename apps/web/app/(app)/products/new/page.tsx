"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm, type Control, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ratePriceLkr } from "@/lib/pricing";
import { Page } from "@/components/ui";
import { GoldHero, HeroBadge, heroGhost, heroGold } from "@/components/console-kit";
import { Select, type SelectOption } from "@/components/select";
import { Field, FormSection, UnitInput, fmtG, inputCls, toOptions, type Option } from "../product-form-kit";
import {
  ArrowRightIcon,
  CheckIcon,
  CoinsIcon,
  FileTextIcon,
  GemIcon,
  LayersIcon,
  PackageIcon,
  ScaleIcon,
  ScanBarcodeIcon,
  SparklesIcon,
  StoreIcon,
  TagsIcon,
  XIcon,
} from "@/components/icons";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

const productSchema = z.object({
  categoryId: z.string().min(1),
  subcategoryName: z.string().max(100).optional(),
  designId: z.string().optional(),
  productTypeId: z.string().optional(),
  metalTypeId: z.string().min(1),
  stoneTypeId: z.string().optional(),
  purityId: z.string().min(1),
  grossG: z.coerce.number().gt(0),
  stoneG: z.coerce.number().min(0).optional().default(0),
  makingLkr: z.coerce.number().min(0).optional().default(0),
  /** Gold rate per gram typed at the counter; prices the piece when no selling price is given. Not saved itself. */
  ratePerGLkr: z.coerce.number().min(0).optional(),
  wastageG: z.coerce.number().min(0).optional().default(0),
  costLkr: z.coerce.number().min(0).optional(),
  sellingPriceLkr: z.coerce.number().min(0).optional(),
  location: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  branchId: z.string().min(1),
});
type FormValues = z.infer<typeof productSchema>;

/**
 * The selling price a typed gold rate gives: net weight × rate per gram, plus
 * making charge, rounded to the nearest 100 LKR. Null when no rate has been
 * typed or there is no net weight.
 */
function priceFromRate(v: Partial<FormValues>): number | null {
  const rate = Number(v.ratePerGLkr);
  const gross = Number(v.grossG);
  const stone = Number(v.stoneG) || 0;
  if (!(rate > 0) || !(gross > stone)) return null;
  const making = Number(v.makingLkr) || 0;
  return ratePriceLkr(gross - stone, rate, making);
}

function branchDefault(): Partial<FormValues> | undefined {
  if (typeof document === "undefined") return undefined;
  const saved = document.cookie
    .split("; ")
    .find((c) => c.startsWith("goldos_branch="))
    ?.split("=")[1];
  return saved ? { branchId: saved } : undefined;
}

/* ---------------------------------------------------------------- controls */

function SelectField({
  control,
  name,
  options,
  placeholder,
  icon,
  invalid,
  loading,
  hintInTrigger,
}: {
  control: Control<FormValues>;
  name: FieldPath<FormValues>;
  options: SelectOption[];
  placeholder?: string;
  icon?: ReactNode;
  invalid?: boolean;
  loading?: boolean;
  hintInTrigger?: boolean;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Select
          buttonRef={field.ref}
          value={(field.value as string | undefined) ?? ""}
          onChange={field.onChange}
          onBlur={field.onBlur}
          options={options}
          placeholder={placeholder}
          icon={icon}
          invalid={invalid}
          loading={loading}
          hintInTrigger={hintInTrigger}
          size="sm"
        />
      )}
    />
  );
}

/** Purity as tactile karat chips — reads faster than a dropdown for a short list. */
function KaratPicker({
  control,
  rows,
  invalid,
  rates,
}: {
  control: Control<FormValues>;
  rows: Option[];
  invalid?: boolean;
  /** Board rate (LKR/g) per purity id, shown under each chip. */
  rates?: Record<string, number>;
}) {
  return (
    <Controller
      control={control}
      name="purityId"
      render={({ field }) => (
        <div
          role="radiogroup"
          aria-label="Purity"
          aria-invalid={invalid || undefined}
          className={cn(
            "flex flex-wrap gap-2 rounded-xl p-1",
            invalid && "shadow-[inset_0_0_0_1px_#e11d48,0_0_0_4px_rgba(225,29,72,0.12)]"
          )}
        >
          {rows.map((p, i) => {
            const on = field.value === p.id;
            return (
              <button
                key={p.id}
                ref={i === 0 ? field.ref : undefined}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => field.onChange(p.id)}
                onBlur={field.onBlur}
                className={cn(
                  "group relative flex min-w-[5.5rem] flex-col items-start rounded-lg px-3 py-2 text-left transition-all duration-200",
                  on
                    ? "bg-void text-paper shadow-[inset_0_0_0_1px_rgba(205,168,83,0.5),0_12px_24px_-14px_rgba(6,42,34,0.8)]"
                    : "bg-paper text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12)] hover:-translate-y-px hover:bg-gold-pale/50 hover:shadow-[inset_0_0_0_1px_rgba(168,138,62,0.45)]"
                )}
              >
                <span className={cn("g-metric text-base font-semibold", on ? "text-gold-light" : "text-ink")}>
                  {p.karat ?? p.name}
                </span>
                {p.permille ? (
                  <span className={cn("g-metric text-[10px]", on ? "text-paper/55" : "text-ink-5")}>{p.permille}‰ fine</span>
                ) : null}
                {rates?.[p.id] ? (
                  <span className={cn("g-metric mt-0.5 text-[10px] font-semibold", on ? "text-gold-light" : "text-gold-deep")}>
                    {Math.round(rates[p.id]!).toLocaleString("en-US")}/g
                  </span>
                ) : null}
                {on ? (
                  <span className="absolute right-2 top-2 flex size-4 items-center justify-center rounded-full bg-gold text-void">
                    <CheckIcon size={9} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    />
  );
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function ImagePicker({
  files,
  previews,
  onChange,
}: {
  files: File[];
  previews: string[];
  onChange: (f: File[]) => void;
}) {
  const [drag, setDrag] = useState(false);
  const add = (list: FileList | File[] | null) => {
    const imgs = Array.from(list ?? []).filter((f) => /^image\//.test(f.type));
    if (imgs.length) onChange([...files, ...imgs].slice(0, 10));
  };
  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          add(e.dataTransfer?.files ?? null);
        }}
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-dashed px-4 py-8 text-center transition-all duration-200",
          drag
            ? "scale-[1.01] border-gold-dark/70 bg-gold-pale"
            : "border-ink/15 bg-gradient-to-b from-bone/40 to-bone/80 hover:border-gold-dark/50 hover:from-gold-pale/40 hover:to-gold-pale/70"
        )}
      >
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
        <span
          className={cn(
            "flex size-12 items-center justify-center rounded-2xl transition-all duration-200 group-hover:-translate-y-0.5",
            drag
              ? "bg-gradient-to-b from-gold-light to-gold text-void"
              : "bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_10px_22px_-12px_rgba(6,42,34,0.8)]"
          )}
        >
          <ImageIcon className="size-5" />
        </span>
        <span className="text-sm font-semibold text-ink">
          {drag ? "Drop to add" : (
            <>
              Drop photos here or <span className="text-gold-deep underline decoration-gold/50 underline-offset-4">browse</span>
            </>
          )}
        </span>
        <span className="text-xs text-ink-5">JPG · PNG · WebP — up to 5 MB each · max 10 · first is the cover</span>
      </label>
      {files.length > 0 ? (
        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
          {previews.map((src, i) => (
            <span
              key={src}
              className={cn(
                "group relative block aspect-square overflow-hidden rounded-xl",
                i === 0 ? "ring-2 ring-gold" : "ring-1 ring-ink/10"
              )}
            >
              <img src={src} alt={files[i]?.name ?? ""} className="size-full object-cover transition-transform duration-320 group-hover:scale-105" />
              {i === 0 ? (
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent pb-1 pt-4 text-center text-[8px] font-semibold uppercase tracking-[0.16em] text-gold-light">
                  Cover
                </span>
              ) : null}
              <button
                type="button"
                aria-label={`Remove ${files[i]?.name ?? "image"}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-ink/80 text-paper opacity-0 backdrop-blur transition-opacity hover:bg-rose-700 focus-visible:opacity-100 group-hover:opacity-100"
              >
                <XIcon size={11} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PreviewGem({ karat }: { karat?: string }) {
  return (
    <div className="relative flex size-full items-center justify-center overflow-hidden bg-ink">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(226,194,122,0.3),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(205,168,83,0.18),transparent_55%)]" />
      <div className="home-grid-bg absolute inset-0 opacity-60" />
      {karat ? (
        <span className="g-display pointer-events-none absolute -bottom-3 -right-1 select-none text-[4.5rem] leading-none text-gold/[0.08]">
          {karat}
        </span>
      ) : null}
      <svg viewBox="0 0 64 64" className="relative size-14 drop-shadow-[0_10px_20px_rgba(205,168,83,0.35)]" aria-hidden>
        <defs>
          <linearGradient id="np-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FBF0D5" />
            <stop offset="0.5" stopColor="#E2C27A" />
            <stop offset="1" stopColor="#7E6223" />
          </linearGradient>
        </defs>
        <polygon points="18,20 46,20 56,30 32,56 8,30" fill="url(#np-g)" />
        <polygon points="18,20 32,30 8,30" fill="#FBF0D5" opacity="0.7" />
        <polygon points="46,20 56,30 32,30" fill="#A88A3E" opacity="0.8" />
        <polygon points="32,30 56,30 32,56" fill="#7E6223" opacity="0.55" />
        <polygon points="18,20 46,20 56,30 32,56 8,30" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.8" />
      </svg>
    </div>
  );
}

function ProgressRing({ value, total }: { value: number; total: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative flex size-10 shrink-0 items-center justify-center">
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(16,32,27,0.08)" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="rgb(var(--c-gold))"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / total)}
          className="transition-[stroke-dashoffset] duration-500 ease-brand"
        />
      </svg>
      <span className="g-metric text-[10px] text-ink">
        {value}/{total}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------- page */

export default function NewProductPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [images, setImages] = useState<File[]>([]);
  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: branchDefault() as FormValues | undefined,
  });
  const vals = watch();

  const opt = <T,>(key: string, path: string) =>
    useQuery({ queryKey: [key], queryFn: () => api<{ rows: T[]; total: number }>(path) });
  const cats = opt<Option>("categories-all", "/api/v1/masters/categories?limit=100");
  // The category's code is fixed; it starts every barcode, and the next piece's barcode is previewed.
  const catCode = cats.data?.rows.find((c) => c.id === vals.categoryId)?.code;
  const nextBarcode = useQuery({
    queryKey: ["next-barcode", vals.categoryId],
    queryFn: () => api<{ barcode: string }>(`/api/v1/products/next-barcode?categoryId=${encodeURIComponent(vals.categoryId)}`),
    enabled: Boolean(vals.categoryId),
    staleTime: 0,
  });
  const subcats = useQuery({
    queryKey: ["subcats-by-cat", vals.categoryId],
    enabled: Boolean(vals.categoryId),
    queryFn: () =>
      api<{ rows: Option[]; total: number }>(`/api/v1/masters/subcategories?limit=100&categoryId=${vals.categoryId}`),
  });
  const designs = opt<Option>("designs-all", "/api/v1/masters/designs?limit=100");
  const ptypes = opt<Option>("ptypes-all", "/api/v1/masters/product-types?limit=100");
  const metals = opt<Option>("metals-all", "/api/v1/masters/metal-types?limit=100");
  const stones = opt<Option>("stones-all", "/api/v1/masters/stone-types?limit=100");
  const purs = opt<Option>("purities-all", "/api/v1/masters/purities?limit=100");
  const branches = opt<Option>("branches", "/api/v1/branches?limit=100");
  const board = useQuery({
    queryKey: ["gold-rates-current"],
    queryFn: () => api<{ purity_id: string; rate_per_gram: number }[]>("/api/v1/gold-rates/current"),
  });
  const rates = Object.fromEntries((board.data ?? []).map((r) => [r.purity_id, r.rate_per_gram]));

  // Gold · 22K are the shop's usual piece, so they start selected.
  useEffect(() => {
    if (!getValues("metalTypeId")) {
      const gold = metals.data?.rows.find((m) => m.name?.trim().toLowerCase() === "gold");
      if (gold) setValue("metalTypeId", gold.id);
    }
  }, [metals.data, getValues, setValue]);
  useEffect(() => {
    if (!getValues("purityId")) {
      const k22 = purs.data?.rows.find((p) => p.karat?.trim().toLowerCase() === "22k");
      if (k22) setValue("purityId", k22.id);
    }
  }, [purs.data, getValues, setValue]);

  const previews = useMemo(() => images.map((f) => URL.createObjectURL(f)), [images]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const create = useMutation({
    mutationFn: async (v: FormValues) => {
      const payload: Record<string, unknown> = {
        categoryId: v.categoryId,
        branchId: v.branchId,
        metalTypeId: v.metalTypeId,
        purityId: v.purityId,
        grossG: Number(v.grossG),
        stoneG: v.stoneG ? Number(v.stoneG) : 0,
        makingLkr: v.makingLkr ? Number(v.makingLkr) : 0,
        wastageG: v.wastageG ? Number(v.wastageG) : 0,
      };
      if (v.subcategoryName?.trim()) payload.subcategoryName = v.subcategoryName.trim();
      if (v.designId) payload.designId = v.designId;
      if (v.productTypeId) payload.productTypeId = v.productTypeId;
      if (v.stoneTypeId) payload.stoneTypeId = v.stoneTypeId;
      if (v.costLkr !== undefined && v.costLkr !== null && !Number.isNaN(Number(v.costLkr))) {
        payload.costLkr = Number(v.costLkr);
      }
      // A blank selling price reads as 0, so only a real amount counts; otherwise the rate prices it.
      const typed = Number(v.sellingPriceLkr);
      const fromRate = priceFromRate(v);
      if (typed > 0) {
        payload.sellingPriceLkr = typed;
      } else if (fromRate !== null) {
        payload.sellingPriceLkr = fromRate;
      }
      if (v.location?.trim()) payload.location = v.location.trim();
      if (v.notes?.trim()) payload.notes = v.notes.trim();

      const created = await api<{ id: string }>("/api/v1/products", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      // The product is saved; photos upload in parallel in the background so
      // the screen moves on at once. The detail page refreshes as they land.
      const files = images.slice(0, 10);
      if (files.length) {
        void Promise.all(
          files.map(async (f) => {
            const form = new FormData();
            form.append("file", f);
            const res = await fetch(`${API}/api/v1/products/${created.id}/images`, {
              method: "POST",
              body: form,
              credentials: "include",
            });
            if (!res.ok) throw new Error(f.name);
          })
        )
          .catch(() => toast.error("Some photos did not upload — add them from the product page"))
          .finally(() => qc.invalidateQueries({ queryKey: ["product", created.id] }));
      }
      return created;
    },
    onSuccess: (created) => {
      toast.success("Product created");
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["products-count"] });
      router.push(`/products/${created.id}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  const purity = purs.data?.rows.find((p) => p.id === vals.purityId);
  const karat = purity?.karat;
  const permille = purity?.permille;
  const catName = cats.data?.rows.find((c) => c.id === vals.categoryId)?.name;
  const metalName = metals.data?.rows.find((m) => m.id === vals.metalTypeId)?.name;
  const stoneName = stones.data?.rows.find((s) => s.id === vals.stoneTypeId)?.name;
  const grossN = Number(vals.grossG);
  const stoneN = Number(vals.stoneG);
  const net = Number.isFinite(grossN) && grossN > 0 ? grossN - (Number.isFinite(stoneN) ? stoneN : 0) : null;
  const fine = net !== null && permille ? (net * permille) / 1000 : null;
  const priceN = Number(vals.sellingPriceLkr);
  const price = Number.isFinite(priceN) && priceN > 0 ? priceN : null;
  const costN = Number(vals.costLkr);
  const cost = Number.isFinite(costN) && costN > 0 ? costN : null;
  const margin = price !== null && cost !== null ? ((price - cost) / price) * 100 : null;
  // The rate per gram: the one typed here, otherwise today's board rate for the purity.
  const typedRate = Number(vals.ratePerGLkr);
  const boardRate = vals.purityId ? rates[vals.purityId] : undefined;
  const rate = Number.isFinite(typedRate) && typedRate > 0 ? typedRate : boardRate;
  const makingN = Number(vals.makingLkr);
  const estimate = net !== null && rate ? net * rate + (Number.isFinite(makingN) ? makingN : 0) : null;
  // Typed rate: the price it gives, used when no selling price is typed.
  const typedPrice = priceFromRate(vals as FormValues);
  const liveMargin = estimate !== null && cost !== null ? ((estimate - cost) / estimate) * 100 : null;
  const stoneShare = net !== null && grossN > 0 ? Math.min(Math.max((grossN - net) / grossN, 0), 1) : 0;

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const steps = [
    { id: "np-s1", n: "1", t: "Identity", d: "Category & classification", done: Boolean(vals.categoryId) },
    { id: "np-s2", n: "2", t: "Weight & cost", d: "Grams and rupees", done: Number(vals.grossG) > 0 },
    { id: "np-s3", n: "3", t: "Material", d: "Metal, purity & stone", done: Boolean(vals.metalTypeId && vals.purityId) },
    { id: "np-s4", n: "4", t: "Location & media", d: "Branch, tray & photos", done: Boolean(vals.branchId) },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const secOf: Partial<Record<keyof FormValues, string>> = {
    categoryId: "np-s1",
    grossG: "np-s2",
    metalTypeId: "np-s3",
    purityId: "np-s3",
    branchId: "np-s4",
  };
  const purityRows = purs.data?.rows ?? [];

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={PackageIcon}
        title="New"
        accent="product"
        badge={<HeroBadge tone={doneCount === steps.length ? "good" : "gold"}>{doneCount}/{steps.length} sections</HeroBadge>}
        sub="Weigh it, tag it, shelve it · barcode and SKU are minted automatically on save"
        back={{ href: "/products", label: "Products" }}
        actions={
          <>
            <Link href="/products/bulk" className={heroGhost}>
              Many pieces?
            </Link>
            <Link href="/products" className={heroGhost}>
              Cancel
            </Link>
            <button type="submit" form="np-form" disabled={create.isPending} className={heroGold}>
              {create.isPending ? "Saving…" : "Save product"}
            </button>
          </>
        }
        stats={[
          { label: "Gross", value: grossN > 0 ? grossN : null, format: (n) => n.toFixed(3), unit: "g" },
          { label: "Net", value: net, format: (n) => n.toFixed(3), unit: "g", sub: stoneShare ? `${(stoneShare * 100).toFixed(1)}% stones` : "no stones" },
          { label: "Fine gold", value: fine, format: (n) => n.toFixed(3), unit: "g", sub: permille ? `${karat} · ${permille}‰` : "pick a purity" },
          {
            label: karat ? `Board · ${karat}` : "Board rate",
            value: rate ?? null,
            format: (n) => Math.round(n).toLocaleString("en-US"),
            unit: "LKR/g",
            sub: vals.purityId && !rate ? "not published" : undefined,
            tone: vals.purityId && !rate ? "warn" : undefined,
          },
          { label: "Est. live price", value: estimate, format: (n) => Math.round(n).toLocaleString("en-US"), unit: "LKR", accent: true, sub: "net × board + making" },
          { label: "Fixed price", value: price, format: (n) => Math.round(n).toLocaleString("en-US"), unit: "LKR", sub: price === null ? "uses live board" : undefined },
          { label: "Cost", value: cost, format: (n) => Math.round(n).toLocaleString("en-US"), unit: "LKR" },
          {
            label: "Margin",
            value: margin ?? liveMargin,
            format: (n) => `${n.toFixed(1)}%`,
            tone: (margin ?? liveMargin) == null ? undefined : (margin ?? liveMargin)! < 0 ? "bad" : "good",
            sub: margin !== null ? "on fixed price" : liveMargin !== null ? "on live estimate" : "needs a cost",
          },
        ]}
      />

      <form
        id="np-form"
        noValidate
        onSubmit={handleSubmit(
          (v) => create.mutate(v),
          (errs) => {
            const key = (Object.keys(secOf) as (keyof FormValues)[]).find((k) => errs[k]);
            if (key) scrollTo(secOf[key] as string);
            toast.error("A few required fields still need you");
          }
        )}
        className="grid items-start gap-4 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)]"
      >
        {/* Rail */}
        <aside className="relative hidden overflow-hidden rounded-[20px] bg-void text-paper shadow-5 ring-1 ring-gold/10 lg:sticky lg:top-24 lg:block lg:max-h-[calc(100vh-8rem)]">
          <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-70" />
          <div className="home-drift pointer-events-none absolute -left-24 -top-28 size-72 rounded-full bg-gold/20 blur-[100px]" />
          <div className="pointer-events-none absolute -bottom-32 -right-24 size-64 rounded-full bg-emerald-400/10 blur-[90px]" />
          <div className="home-noise pointer-events-none absolute inset-0" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />

          <div className="scrollbar-thin relative max-h-[calc(100vh-8rem)] overflow-y-auto p-4">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-2.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-gold-light">
              <SparklesIcon size={10} />
              Card preview
            </span>

            {/* Live preview */}
            <div className="mt-3 rounded-[16px] bg-gradient-to-b from-paper/[0.08] to-paper/[0.03] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 ring-paper/10">
              <div className="relative aspect-[16/10] overflow-hidden rounded-[14px] ring-1 ring-black/20">
                {previews[0] ? (
                  <img src={previews[0]} alt="" className="size-full object-cover" />
                ) : (
                  <PreviewGem karat={karat} />
                )}
                {karat ? (
                  <span className="g-metric absolute left-2.5 top-2.5 rounded-md bg-gradient-to-b from-gold-light to-gold px-2 py-0.5 text-[11px] font-semibold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
                    {karat}
                  </span>
                ) : null}
                {images.length > 1 ? (
                  <span className="absolute right-2.5 top-2.5 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-paper backdrop-blur">
                    +{images.length - 1}
                  </span>
                ) : null}
              </div>
              <div className="px-1.5 pb-1 pt-3">
                <p className="truncate text-[15px] font-semibold text-paper">
                  {vals.subcategoryName?.trim() || catName || <span className="text-paper/45">Untitled piece</span>}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {[catName ?? "Category", metalName, stoneName].filter(Boolean).map((t, i) => (
                    <span
                      key={`${t}-${i}`}
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1",
                        i === 0 && !catName ? "text-paper/40 ring-paper/10" : "bg-paper/[0.06] text-paper/75 ring-paper/10"
                      )}
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  {[
                    { l: "Net", v: net },
                    { l: "Fine", v: fine },
                  ].map((m) => (
                    <div key={m.l} className="rounded-xl bg-black/20 px-3 py-2 ring-1 ring-paper/[0.08]">
                      <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-paper/40">{m.l}</div>
                      <div className="g-metric mt-0.5 text-[15px] text-gold-light">
                        {fmtG(m.v)}
                        <span className="ml-0.5 text-[10px] text-paper/40">g</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-end justify-between border-t border-paper/10 pt-3">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-paper/40">Price</span>
                  {price !== null || estimate !== null ? (
                    <span className="flex items-baseline gap-1">
                      <span className="text-[10px] text-paper/40">{price !== null ? "LKR" : "≈ LKR"}</span>
                      <span className="g-metric text-lg text-paper">{Math.round(price ?? estimate!).toLocaleString("en-US")}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gold-light">
                      <span className="size-1.5 animate-pulse-soft rounded-full bg-gold" />
                      Live rate
                    </span>
                  )}
                </div>
              </div>
            </div>
            <p className="mt-2 text-center text-[10px] text-paper/35">{price === null && estimate !== null ? "Price is today's live estimate" : "Live preview of the catalogue card"}</p>

            {/* Progress */}
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.16em]">
                <span className="text-paper/45">Progress</span>
                <span className="g-metric text-gold-light">
                  {doneCount}/{steps.length}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-paper/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-gold-dark via-gold to-gold-light transition-[width] duration-500 ease-brand"
                  style={{ width: `${(doneCount / steps.length) * 100}%` }}
                />
              </div>
            </div>

            {/* Steps */}
            <nav aria-label="Form sections" className="relative mt-4">
              <span aria-hidden className="absolute bottom-5 left-[1.4rem] top-5 w-px bg-paper/10" />
              {steps.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => scrollTo(s.id)}
                  className="group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-paper/[0.06]"
                >
                  <span
                    className={cn(
                      "relative flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold transition-all duration-320",
                      s.done
                        ? "bg-gradient-to-b from-gold-light to-gold text-void shadow-[0_0_0_4px_rgba(205,168,83,0.12)]"
                        : "bg-void text-paper/50 ring-1 ring-paper/20 group-hover:ring-gold/50"
                    )}
                  >
                    {s.done ? <CheckIcon size={11} /> : s.n}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-xs font-medium", s.done ? "text-paper" : "text-paper/70")}>
                      {s.t}
                    </span>
                    <span className="block truncate text-[10px] text-paper/35">{s.d}</span>
                  </span>
                  <ArrowRightIcon
                    size={12}
                    className="shrink-0 -translate-x-1 text-gold-light opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100"
                  />
                </button>
              ))}
            </nav>

            <div className="mt-5 flex items-center gap-2.5 rounded-xl bg-paper/[0.04] px-3 py-2.5 ring-1 ring-paper/[0.08]">
              <ScanBarcodeIcon size={15} className="shrink-0 text-gold-light" />
              <p className="text-[10px] leading-snug text-paper/50">
                Required fields are marked <span className="text-gold-light">*</span> — everything else can wait.
              </p>
            </div>
          </div>
        </aside>

        {/* Form column */}
        <div className="min-w-0 space-y-5">
          {/* Mobile header */}
          <div className="relative overflow-hidden rounded-[22px] bg-void p-4 text-paper shadow-4 lg:hidden">
            <div className="pointer-events-none absolute -left-16 -top-20 size-48 rounded-full bg-gold/20 blur-[70px]" />
            <div className="relative flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="g-kicker !text-gold-light">Catalog</div>
                <h1 className="g-display mt-1 text-xl">New product</h1>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {steps.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-label={s.t}
                    onClick={() => scrollTo(s.id)}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full text-[10px] font-semibold transition-colors",
                      s.done ? "bg-gradient-to-b from-gold-light to-gold text-void" : "text-paper/50 ring-1 ring-paper/25"
                    )}
                  >
                    {s.done ? <CheckIcon size={11} /> : s.n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <FormSection
            id="np-s1"
            n="1"
            title="Identity"
            description="What it is and where it sits in the catalog"
            icon={<TagsIcon size={17} />}
            done={steps[0]!.done}
            required
          >
            <div className="grid gap-x-3 gap-y-3.5 sm:grid-cols-2">
              <Field label="Category" required error={errors.categoryId ? "Pick a category" : undefined}>
                <SelectField
                  control={control}
                  name="categoryId"
                  options={toOptions(cats.data?.rows)}
                  placeholder="Choose category"
                  icon={<LayersIcon size={13} />}
                  invalid={Boolean(errors.categoryId)}
                  loading={cats.isLoading}
                />
              </Field>
              <Field label="Category code" hint="Set by the category; it cannot be changed here">
                <div className={cn(inputCls, "g-metric flex h-11 items-center text-[14px] text-ink-3")} aria-readonly="true">
                  {vals.categoryId ? catCode ?? "—" : "Pick a category"}
                </div>
              </Field>
              <Field label="Barcode" hint="The next piece in this category gets this barcode">
                <div className={cn(inputCls, "g-metric flex h-11 items-center text-[14px] font-semibold text-ink")} aria-readonly="true">
                  {!vals.categoryId ? "—" : nextBarcode.isError ? "Unavailable" : nextBarcode.data?.barcode ?? "…"}
                </div>
              </Field>
              <Field label="Subcategory" optional hint="Type a new one and it is created on save">
                <input
                  list="np-subcats"
                  autoComplete="off"
                  className={inputCls}
                  placeholder="e.g. Bangles"
                  {...register("subcategoryName")}
                />
                <datalist id="np-subcats">
                  {(subcats.data?.rows ?? []).map((r) => (
                    <option key={r.id} value={r.name} />
                  ))}
                </datalist>
              </Field>
              <Field label="Design" optional>
                <SelectField
                  control={control}
                  name="designId"
                  options={toOptions(designs.data?.rows, "None")}
                  placeholder="None"
                  icon={<SparklesIcon size={13} />}
                  loading={designs.isLoading}
                />
              </Field>
              <Field label="Product type" optional>
                <SelectField
                  control={control}
                  name="productTypeId"
                  options={toOptions(ptypes.data?.rows, "None")}
                  placeholder="None"
                  icon={<PackageIcon size={13} />}
                  loading={ptypes.isLoading}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection
            id="np-s2"
            n="2"
            title="Weight & cost"
            description="Grams on the scale, rupees on the tag"
            icon={<ScaleIcon size={17} />}
            done={steps[1]!.done}
            required
          >
            <div className="space-y-6">
              <div>
                <div className="g-kicker mb-3 flex items-center gap-2">
                  Weight
                  <span className="h-px flex-1 bg-gradient-to-r from-gold/30 to-transparent" />
                </div>
                <div className="grid gap-x-3 gap-y-3.5 sm:grid-cols-3">
                  <Field label="Gross" required error={errors.grossG ? "Must be more than 0" : undefined}>
                    <UnitInput unit="g" aria-invalid={errors.grossG ? true : undefined} {...register("grossG")} />
                  </Field>
                  <Field label="Stone" optional>
                    <UnitInput unit="g" {...register("stoneG")} />
                  </Field>
                  <Field label="Wastage" optional>
                    <UnitInput unit="g" {...register("wastageG")} />
                  </Field>
                </div>

                {/* Derived weights */}
                <div className="relative mt-4 overflow-hidden rounded-2xl bg-void p-4 text-paper shadow-[0_18px_36px_-24px_rgba(6,42,34,0.9)]">
                  <div className="pointer-events-none absolute -right-10 -top-16 size-40 rounded-full bg-gold/20 blur-[60px]" />
                  <div className="relative grid grid-cols-2 gap-3">
                    {[
                      { l: "Net weight", v: net, s: "Gross − stone" },
                      { l: "Fine gold", v: fine, s: permille ? `Net × ${permille}‰` : "Pick a purity" },
                    ].map((m) => (
                      <div key={m.l} className="rounded-xl bg-paper/[0.05] px-3.5 py-2.5 ring-1 ring-paper/[0.08]">
                        <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-paper/45">{m.l}</div>
                        <div className="g-metric mt-1 text-xl text-gold-light">
                          {fmtG(m.v)}
                          <span className="ml-1 text-xs text-paper/40">g</span>
                        </div>
                        <div className="mt-0.5 text-[10px] text-paper/35">{m.s}</div>
                      </div>
                    ))}
                  </div>
                  <div className="relative mt-3">
                    <div className="flex h-1.5 overflow-hidden rounded-full bg-paper/10">
                      <div
                        className="h-full bg-gradient-to-r from-gold-dark to-gold-light transition-[width] duration-500 ease-brand"
                        style={{ width: net !== null ? `${(1 - stoneShare) * 100}%` : "0%" }}
                      />
                      <div
                        className="h-full bg-paper/35 transition-[width] duration-500 ease-brand"
                        style={{ width: `${stoneShare * 100}%` }}
                      />
                    </div>
                    <div className="mt-1.5 flex justify-between text-[10px] text-paper/40">
                      <span className="flex items-center gap-1">
                        <span className="size-1.5 rounded-full bg-gold" /> Metal
                      </span>
                      <span className="flex items-center gap-1">
                        Stone <span className="size-1.5 rounded-full bg-paper/40" />
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="g-kicker mb-3 flex items-center gap-2">
                  Pricing
                  <span className="h-px flex-1 bg-gradient-to-r from-gold/30 to-transparent" />
                  {margin !== null ? (
                    <span
                      className={cn(
                        "g-metric rounded-full px-2 py-0.5 text-[10px] normal-case tracking-normal",
                        margin >= 0 ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/15" : "bg-rose-50 text-rose-700 ring-1 ring-rose-600/15"
                      )}
                    >
                      {margin.toFixed(1)}% margin
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-x-3 gap-y-3.5 sm:grid-cols-2 xl:grid-cols-4">
                  <Field label="Gold rate / g" optional hint={typedPrice !== null ? "Typed rate — price is net × rate + making" : undefined}>
                    <UnitInput unit="LKR/g" placeholder={boardRate ? String(Math.round(boardRate)) : undefined} {...register("ratePerGLkr")} />
                  </Field>
                  <Field label="Making charge" optional>
                    <UnitInput unit="LKR" {...register("makingLkr")} />
                  </Field>
                  <Field label="Cost" optional>
                    <UnitInput unit="LKR" {...register("costLkr")} />
                  </Field>
                  <Field
                    label="Selling price"
                    optional
                    hint={
                      price !== null
                        ? undefined
                        : typedPrice !== null
                          ? `Calculated: ${typedPrice.toLocaleString("en-US")} LKR`
                          : "Type a gold rate or a price"
                    }
                  >
                    <UnitInput unit="LKR" placeholder={typedPrice !== null ? String(typedPrice) : undefined} {...register("sellingPriceLkr")} />
                  </Field>
                </div>
              </div>
            </div>
          </FormSection>

          <FormSection
            id="np-s3"
            n="3"
            title="Material"
            description="Metal, karat and any set stones"
            icon={<GemIcon size={17} />}
            done={steps[2]!.done}
            required
          >
            <div className="grid gap-x-3 gap-y-3.5 sm:grid-cols-2">
              <Field label="Metal" required error={errors.metalTypeId ? "Pick a metal" : undefined}>
                <SelectField
                  control={control}
                  name="metalTypeId"
                  options={toOptions(metals.data?.rows)}
                  placeholder="Choose metal"
                  icon={<CoinsIcon size={13} />}
                  invalid={Boolean(errors.metalTypeId)}
                  loading={metals.isLoading}
                />
              </Field>
              <Field label="Stone" optional>
                <SelectField
                  control={control}
                  name="stoneTypeId"
                  options={toOptions(stones.data?.rows, "None")}
                  placeholder="None"
                  icon={<GemIcon size={13} />}
                  loading={stones.isLoading}
                />
              </Field>
              <Field
                label="Purity"
                required
                error={errors.purityId ? "Pick a karat" : undefined}
                hint={permille ? `${permille}‰ fine — used for the fine-gold figure` : undefined}
                className="sm:col-span-2"
              >
                {purs.isLoading ? (
                  <div className="flex gap-2">
                    {[0, 1, 2, 3].map((i) => (
                      <span key={i} className="h-14 w-[5.25rem] animate-pulse rounded-xl bg-bone" />
                    ))}
                  </div>
                ) : purityRows.length > 0 && purityRows.length <= 8 ? (
                  <KaratPicker control={control} rows={purityRows} invalid={Boolean(errors.purityId)} rates={rates} />
                ) : (
                  <Controller
                    control={control}
                    name="purityId"
                    render={({ field }) => (
                      <Select
                        buttonRef={field.ref}
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        options={purityRows.map((p) => ({
                          value: p.id,
                          label: p.karat ?? p.name ?? p.id,
                          hint: p.permille ? `${p.permille}‰` : undefined,
                        }))}
                        placeholder="Choose karat"
                        size="sm"
                        icon={<SparklesIcon size={13} />}
                        invalid={Boolean(errors.purityId)}
                        hintInTrigger
                      />
                    )}
                  />
                )}
              </Field>
            </div>
          </FormSection>

          <FormSection
            id="np-s4"
            n="4"
            title="Location & media"
            description="Where it lives and how it looks"
            icon={<StoreIcon size={17} />}
            done={steps[3]!.done}
            required
          >
            <div className="grid gap-x-3 gap-y-3.5 sm:grid-cols-2">
              <Field label="Branch" required error={errors.branchId ? "Pick a branch" : undefined}>
                <SelectField
                  control={control}
                  name="branchId"
                  options={toOptions(branches.data?.rows)}
                  placeholder="Choose branch"
                  icon={<StoreIcon size={13} />}
                  invalid={Boolean(errors.branchId)}
                  loading={branches.isLoading}
                />
              </Field>
              <Field label="Location" optional>
                <input className={inputCls} placeholder="Tray, showcase…" {...register("location")} />
              </Field>
              <Field label="Notes" optional className="sm:col-span-2">
                <span className="relative block">
                  <FileTextIcon size={14} className="pointer-events-none absolute left-3.5 top-3.5 text-ink-5" />
                  <textarea
                    rows={3}
                    placeholder="Hallmark, provenance, customer order reference…"
                    className={cn(inputCls, "h-auto min-h-[5.5rem] resize-y py-3 pl-10 leading-relaxed")}
                    {...register("notes")}
                  />
                </span>
              </Field>
              <Field label="Images" optional className="sm:col-span-2">
                <ImagePicker files={images} previews={previews} onChange={setImages} />
              </Field>
            </div>
          </FormSection>

          {/* Floating action bar */}
          <div className="sticky bottom-4 z-20 flex items-center justify-between gap-3 rounded-2xl bg-paper/90 px-3 py-2 shadow-[0_24px_48px_-20px_rgba(16,32,27,0.45),inset_0_0_0_1px_rgba(16,32,27,0.08)] backdrop-blur-xl sm:px-4">
            <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
            <div className="flex min-w-0 items-center gap-3">
              <ProgressRing value={doneCount} total={steps.length} />
              <div className="hidden min-w-0 gap-1.5 sm:flex">
                <span className="rounded-lg bg-bone px-2.5 py-1 text-xs text-ink-4">
                  Net <span className="g-metric font-medium text-ink">{fmtG(net)} g</span>
                </span>
                <span className="rounded-lg bg-gold-pale px-2.5 py-1 text-xs text-gold-deep">
                  Fine <span className="g-metric font-medium">{fmtG(fine)} g</span>
                </span>
                {estimate !== null ? (
                  <span className="rounded-lg bg-void px-2.5 py-1 text-xs text-paper/70">
                    ≈ LKR <span className="g-metric font-medium text-gold-light">{Math.round(estimate).toLocaleString("en-US")}</span>
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Link
                href="/products"
                className="g-btn h-9 rounded-lg px-4 text-sm text-ink-3 hover:bg-bone hover:text-ink"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={create.isPending}
                className="g-btn g-btn-primary h-9 rounded-lg px-5 text-sm"
              >
                {create.isPending ? (
                  <>
                    <span className="size-3.5 animate-spin rounded-full border-2 border-gold-light/30 border-t-gold-light" />
                    Saving…
                  </>
                ) : (
                  <>
                    Save product
                    <ArrowRightIcon size={14} className="g-btn-arrow text-gold-light" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
    </Page>
  );
}
