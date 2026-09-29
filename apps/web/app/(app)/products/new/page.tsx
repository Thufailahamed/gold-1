"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, controlClass } from "@/components/ui";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ScanBarcodeIcon,
  XIcon,
} from "@/components/icons";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

type Option = { id: string; name?: string; karat?: string; permille?: number };

const productSchema = z.object({
  name: z.string().min(1).max(100),
  categoryId: z.string().min(1),
  subcategoryId: z.string().optional(),
  designId: z.string().optional(),
  productTypeId: z.string().optional(),
  metalTypeId: z.string().min(1),
  stoneTypeId: z.string().optional(),
  purityId: z.string().min(1),
  grossG: z.coerce.number().gt(0),
  stoneG: z.coerce.number().min(0).optional().default(0),
  makingLkr: z.coerce.number().min(0).optional().default(0),
  wastageG: z.coerce.number().min(0).optional().default(0),
  costLkr: z.coerce.number().min(0).optional(),
  sellingPriceLkr: z.coerce.number().min(0).optional(),
  location: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  branchId: z.string().min(1),
});
type FormValues = z.infer<typeof productSchema>;

function branchDefault(): Partial<FormValues> | undefined {
  if (typeof document === "undefined") return undefined;
  const saved = document.cookie
    .split("; ")
    .find((c) => c.startsWith("goldos_branch="))
    ?.split("=")[1];
  return saved ? { branchId: saved } : undefined;
}

const fieldCls = cn(controlClass, "w-full");

/* ---------------------------------------------------------------- controls */

function Field({
  label,
  required,
  error,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-xs font-medium text-ink-3">
        {label}
        {required ? <span className="ml-0.5 text-gold-dark">*</span> : null}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-rose-700">{error}</span> : null}
    </label>
  );
}

function FormSection({ id, n, title, children }: { id: string; n: string; title: string; children: ReactNode }) {
  return (
    <fieldset
      id={id}
      className="scroll-mt-24 rounded-2xl bg-paper p-4 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.07),0_16px_36px_-28px_rgba(28,25,23,0.3)] sm:p-6"
    >
      <legend className="sr-only">{title}</legend>
      <div className="mb-4 flex items-center gap-2.5">
        <span className="g-metric flex size-6 items-center justify-center rounded-full bg-ink text-[10px] text-gold-light">
          {n}
        </span>
        <span className="text-sm font-semibold text-ink">{title}</span>
      </div>
      {children}
    </fieldset>
  );
}

function Select({ className, children, ...rest }: React.ComponentProps<"select">) {
  return (
    <span className="relative block">
      <select {...rest} className={cn(fieldCls, "appearance-none pr-9", className)}>
        {children}
      </select>
      <ChevronDownIcon
        size={14}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-5"
      />
    </span>
  );
}

function UnitInput({ unit, className, ...rest }: React.ComponentProps<"input"> & { unit: string }) {
  return (
    <span className="relative block">
      <input type="number" step="any" {...rest} className={cn(fieldCls, "num-tabular pr-11", className)} />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-ink-5">
        {unit}
      </span>
    </span>
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
          "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center transition-colors",
          drag
            ? "border-gold-dark/60 bg-gold-pale"
            : "border-ink/20 bg-bone/60 hover:border-gold-dark/40 hover:bg-gold-pale/40"
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
            "flex size-10 items-center justify-center rounded-full transition-colors",
            drag ? "bg-gold text-void" : "bg-ink text-gold-light"
          )}
        >
          <ImageIcon className="size-4" />
        </span>
        <span className="text-sm font-medium text-ink">
          {drag ? "Drop to add" : "Drop photos here or browse"}
        </span>
        <span className="text-xs text-ink-5">JPG · PNG · WebP — up to 5 MB each</span>
      </label>
      {files.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {previews.map((src, i) => (
            <span key={src} className="group relative block size-16 overflow-hidden rounded-xl ring-1 ring-ink/10">
              <img src={src} alt={files[i]?.name ?? ""} className="size-full object-cover" />
              {i === 0 ? (
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent pb-0.5 pt-3 text-center text-[8px] font-semibold uppercase tracking-[0.14em] text-gold-light">
                  Cover
                </span>
              ) : null}
              <button
                type="button"
                aria-label={`Remove ${files[i]?.name ?? "image"}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-ink/80 text-paper opacity-0 backdrop-blur transition-opacity hover:bg-rose-700 group-hover:opacity-100"
              >
                <XIcon size={10} />
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
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(231,198,90,0.28),transparent_60%)]" />
      <div className="home-grid-bg absolute inset-0 opacity-60" />
      {karat ? (
        <span className="g-display pointer-events-none absolute -bottom-3 -right-1 select-none text-[4.5rem] leading-none text-gold/[0.08]">
          {karat}
        </span>
      ) : null}
      <svg viewBox="0 0 64 64" className="relative size-14 drop-shadow-[0_10px_20px_rgba(201,162,39,0.35)]" aria-hidden>
        <defs>
          <linearGradient id="np-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FFF4C7" />
            <stop offset="0.5" stopColor="#E7C65A" />
            <stop offset="1" stopColor="#8C6D1F" />
          </linearGradient>
        </defs>
        <polygon points="18,20 46,20 56,30 32,56 8,30" fill="url(#np-g)" />
        <polygon points="18,20 32,30 8,30" fill="#FFF4C7" opacity="0.7" />
        <polygon points="46,20 56,30 32,30" fill="#A8861B" opacity="0.8" />
        <polygon points="32,30 56,30 32,56" fill="#8C6D1F" opacity="0.55" />
        <polygon points="18,20 46,20 56,30 32,56 8,30" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.8" />
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------- page */

export default function NewProductPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [images, setImages] = useState<File[]>([]);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: branchDefault() as FormValues | undefined,
  });
  const vals = watch();

  const opt = <T,>(key: string, path: string) =>
    useQuery({ queryKey: [key], queryFn: () => api<{ rows: T[]; total: number }>(path) });
  const cats = opt<Option>("categories-all", "/api/v1/masters/categories?limit=100");
  const subcats = opt<Option>("subcats-all", "/api/v1/masters/subcategories?limit=100");
  const designs = opt<Option>("designs-all", "/api/v1/masters/designs?limit=100");
  const ptypes = opt<Option>("ptypes-all", "/api/v1/masters/product-types?limit=100");
  const metals = opt<Option>("metals-all", "/api/v1/masters/metal-types?limit=100");
  const stones = opt<Option>("stones-all", "/api/v1/masters/stone-types?limit=100");
  const purs = opt<Option>("purities-all", "/api/v1/masters/purities?limit=100");
  const branches = opt<Option>("branches", "/api/v1/branches?limit=100");

  const previews = useMemo(() => images.map((f) => URL.createObjectURL(f)), [images]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const create = useMutation({
    mutationFn: async (v: FormValues) => {
      const created = await api<{ id: string }>("/api/v1/products", {
        method: "POST",
        body: JSON.stringify(v),
      });
      for (const f of images.slice(0, 10)) {
        const form = new FormData();
        form.append("file", f);
        await fetch(`${API}/api/v1/products/${created.id}/images`, {
          method: "POST",
          body: form,
          credentials: "include",
        });
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

  const karat = purs.data?.rows.find((p) => p.id === vals.purityId)?.karat;
  const catName = cats.data?.rows.find((c) => c.id === vals.categoryId)?.name;
  const metalName = metals.data?.rows.find((m) => m.id === vals.metalTypeId)?.name;
  const permille = purs.data?.rows.find((p) => p.id === vals.purityId)?.permille;
  const grossN = Number(vals.grossG);
  const stoneN = Number(vals.stoneG);
  const net = Number.isFinite(grossN) && grossN > 0 ? grossN - (Number.isFinite(stoneN) ? stoneN : 0) : null;
  const fine = net !== null && permille ? (net * permille) / 1000 : null;
  const priceN = Number(vals.sellingPriceLkr);
  const price = Number.isFinite(priceN) && priceN > 0 ? priceN : null;

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const steps = [
    { id: "np-s1", n: "1", t: "Identity", d: "Name & classification", done: Boolean(vals.name?.trim() && vals.categoryId) },
    { id: "np-s2", n: "2", t: "Material", d: "Metal, purity & stone", done: Boolean(vals.metalTypeId && vals.purityId) },
    { id: "np-s3", n: "3", t: "Weights & pricing", d: "Grams and rupees", done: Number(vals.grossG) > 0 },
    { id: "np-s4", n: "4", t: "Location & media", d: "Branch, tray & photos", done: Boolean(vals.branchId) },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const secOf: Partial<Record<keyof FormValues, string>> = {
    name: "np-s1",
    categoryId: "np-s1",
    metalTypeId: "np-s2",
    purityId: "np-s2",
    grossG: "np-s3",
    branchId: "np-s4",
  };

  return (
    <Page className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link href="/products" className="g-btn g-btn-secondary h-9 px-3.5 text-xs">
          <ArrowLeftIcon size={13} />
          Catalog
        </Link>
        <p className="hidden text-xs text-ink-4 sm:block">
          Barcode &amp; SKU are minted automatically on save
        </p>
      </div>

      <form
        onSubmit={handleSubmit(
          (v) => create.mutate(v),
          (errs) => {
            const key = (Object.keys(secOf) as (keyof FormValues)[]).find((k) => errs[k]);
            if (key) scrollTo(secOf[key] as string);
          }
        )}
        className="grid items-start gap-5 lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)]"
      >
        {/* Rail */}
        <aside className="relative hidden overflow-hidden rounded-3xl bg-void text-paper shadow-5 lg:sticky lg:top-24 lg:block lg:max-h-[calc(100vh-8rem)]">
          <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-70" />
          <div className="home-drift pointer-events-none absolute -left-24 -top-28 size-72 rounded-full bg-gold/20 blur-[100px]" />
          <div className="home-noise pointer-events-none absolute inset-0" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />

          <div className="scrollbar-thin relative max-h-[calc(100vh-8rem)] overflow-y-auto p-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
              Catalog
            </span>
            <h1 className="g-display mt-3 text-2xl text-paper">New product</h1>
            <p className="mt-1 text-xs leading-relaxed text-paper/50">
              Weigh it, tag it, shelve it — the barcode and SKU are minted on save.
            </p>

            {/* Live preview */}
            <div className="mt-5 rounded-2xl bg-paper/[0.05] p-2.5 ring-1 ring-paper/10">
              <div className="relative aspect-[16/10] overflow-hidden rounded-xl">
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
              </div>
              <div className="px-1.5 pb-1 pt-3">
                <p className="truncate text-sm font-semibold text-paper">
                  {vals.name?.trim() || "Untitled piece"}
                </p>
                <p className="mt-0.5 truncate text-xs text-paper/45">
                  {catName || "Category"}
                  {metalName ? ` · ${metalName}` : ""}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  {[
                    { l: "Net", v: net },
                    { l: "Fine", v: fine },
                  ].map((m) => (
                    <div key={m.l} className="rounded-lg bg-paper/[0.05] px-2.5 py-1.5 ring-1 ring-paper/[0.08]">
                      <div className="text-[8px] font-semibold uppercase tracking-[0.16em] text-paper/40">{m.l}</div>
                      <div className="g-metric mt-0.5 text-sm text-gold-light">
                        {m.v !== null && Number.isFinite(m.v) ? m.v.toFixed(3) : "—"}
                        <span className="ml-0.5 text-[9px] text-paper/40">g</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2.5 flex items-end justify-between border-t border-paper/10 pt-2.5">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-paper/40">Price</span>
                  {price !== null ? (
                    <span className="flex items-baseline gap-1">
                      <span className="text-[9px] text-paper/40">LKR</span>
                      <span className="g-metric text-base text-paper">{price.toLocaleString("en-US")}</span>
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-gold-light">Live rate</span>
                  )}
                </div>
              </div>
            </div>
            <p className="mt-2 text-center text-[10px] text-paper/35">Live preview of the catalog card</p>

            {/* Steps */}
            <nav aria-label="Form sections" className="mt-5 space-y-1">
              {steps.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => scrollTo(s.id)}
                  className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-paper/[0.06]"
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold transition-colors",
                      s.done
                        ? "bg-gradient-to-b from-gold-light to-gold text-void"
                        : "text-paper/50 ring-1 ring-paper/20 group-hover:ring-gold/40"
                    )}
                  >
                    {s.done ? <CheckIcon size={11} /> : s.n}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block truncate text-xs font-medium", s.done ? "text-paper" : "text-paper/70")}>
                      {s.t}
                    </span>
                    <span className="block truncate text-[10px] text-paper/35">{s.d}</span>
                  </span>
                </button>
              ))}
            </nav>

            <div className="mt-5 flex items-center gap-2.5 rounded-xl bg-paper/[0.04] px-3 py-2.5 ring-1 ring-paper/[0.08]">
              <ScanBarcodeIcon size={15} className="shrink-0 text-gold-light" />
              <p className="text-[10px] leading-snug text-paper/45">
                {doneCount}/4 sections complete — required fields are marked *
              </p>
            </div>
          </div>
        </aside>

        {/* Form column */}
        <div className="min-w-0 space-y-4">
          {/* Mobile header */}
          <div className="flex items-center gap-4 rounded-2xl bg-void p-4 text-paper shadow-4 lg:hidden">
            <div className="min-w-0 flex-1">
              <div className="g-kicker !text-gold-light">Catalog</div>
              <h1 className="mt-0.5 font-display text-lg font-bold tracking-tight">New product</h1>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {steps.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-label={s.t}
                  onClick={() => scrollTo(s.id)}
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-[10px] font-semibold transition-colors",
                    s.done ? "bg-gold text-void" : "text-paper/50 ring-1 ring-paper/25"
                  )}
                >
                  {s.done ? <CheckIcon size={11} /> : s.n}
                </button>
              ))}
            </div>
          </div>

          <FormSection id="np-s1" n="1" title="Identity">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" required error={errors.name ? "Required" : undefined} className="col-span-2">
                <input autoFocus className={fieldCls} placeholder="e.g. Kandyan bridal necklace" {...register("name")} />
              </Field>
              <Field label="Category" required error={errors.categoryId ? "Required" : undefined}>
                <Select {...register("categoryId")}>
                  <option value="">Select…</option>
                  {(cats.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Subcategory">
                <Select {...register("subcategoryId")}>
                  <option value="">None</option>
                  {(subcats.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Design">
                <Select {...register("designId")}>
                  <option value="">None</option>
                  {(designs.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Product type">
                <Select {...register("productTypeId")}>
                  <option value="">None</option>
                  {(ptypes.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </FormSection>

          <FormSection id="np-s2" n="2" title="Material">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Metal" required error={errors.metalTypeId ? "Required" : undefined}>
                <Select {...register("metalTypeId")}>
                  <option value="">Select…</option>
                  {(metals.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Purity" required error={errors.purityId ? "Required" : undefined}>
                <Select {...register("purityId")}>
                  <option value="">Select…</option>
                  {(purs.data?.rows ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.karat}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Stone" className="col-span-2 sm:col-span-1">
                <Select {...register("stoneTypeId")}>
                  <option value="">None</option>
                  {(stones.data?.rows ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </FormSection>

          <FormSection id="np-s3" n="3" title="Weights & pricing">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Gross" required error={errors.grossG ? "Must be > 0" : undefined}>
                <UnitInput unit="g" {...register("grossG")} />
              </Field>
              <Field label="Stone">
                <UnitInput unit="g" {...register("stoneG")} />
              </Field>
              <Field label="Wastage">
                <UnitInput unit="g" {...register("wastageG")} />
              </Field>
              <Field label="Making">
                <UnitInput unit="LKR" {...register("makingLkr")} />
              </Field>
              <Field label="Cost">
                <UnitInput unit="LKR" {...register("costLkr")} />
              </Field>
              <Field label="Price">
                <UnitInput unit="LKR" {...register("sellingPriceLkr")} />
              </Field>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-void p-3 text-paper">
              {[
                { l: "Net weight", v: net },
                { l: "Fine gold", v: fine },
              ].map((m) => (
                <div key={m.l} className="rounded-lg bg-paper/[0.04] px-3 py-2 ring-1 ring-paper/[0.08]">
                  <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-paper/40">{m.l}</div>
                  <div className="g-metric mt-0.5 text-lg text-gold-light">
                    {m.v !== null && Number.isFinite(m.v) ? m.v.toFixed(3) : "—"}
                    <span className="ml-1 text-xs text-paper/40">g</span>
                  </div>
                </div>
              ))}
            </div>
          </FormSection>

          <FormSection id="np-s4" n="4" title="Location & media">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Branch" required error={errors.branchId ? "Required" : undefined}>
                <Select {...register("branchId")}>
                  <option value="">Select…</option>
                  {(branches.data?.rows ?? []).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Location">
                <input className={fieldCls} placeholder="Tray, showcase…" {...register("location")} />
              </Field>
              <Field label="Notes" className="col-span-2">
                <input className={fieldCls} {...register("notes")} />
              </Field>
              <Field label="Images" className="col-span-2">
                <ImagePicker files={images} previews={previews} onChange={setImages} />
              </Field>
            </div>
          </FormSection>

          {/* Floating action bar */}
          <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-2xl bg-paper/95 px-4 py-3 shadow-[0_20px_44px_-20px_rgba(28,25,23,0.4),inset_0_0_0_1px_rgba(28,25,23,0.08)] backdrop-blur sm:px-5">
            <p className="min-w-0 truncate text-xs text-ink-4">
              Net <span className="g-metric font-medium text-ink">{net !== null && Number.isFinite(net) ? net.toFixed(3) : "—"} g</span>
              <span className="mx-1.5 text-ink/20">·</span>
              Fine <span className="g-metric font-medium text-gold-deep">{fine !== null && Number.isFinite(fine) ? fine.toFixed(3) : "—"} g</span>
            </p>
            <div className="flex shrink-0 gap-2">
              <Link href="/products" className="g-btn g-btn-secondary h-10 px-4 text-sm">
                Cancel
              </Link>
              <button type="submit" disabled={create.isPending} className="g-btn g-btn-primary h-10 px-5 text-sm">
                {create.isPending ? "Saving…" : "Save product"}
                {!create.isPending ? <ArrowRightIcon size={14} className="g-btn-arrow" /> : null}
              </button>
            </div>
          </div>
        </div>
      </form>
    </Page>
  );
}
