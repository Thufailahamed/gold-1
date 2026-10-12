"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { centsToLkr, mgToG } from "@goldos/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, StatusPill, Skeleton, EmptyBlock } from "@/components/ui";
import { Select } from "@/components/select";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BanknoteIcon,
  ChevronDownIcon,
  GemIcon,
  LayersIcon,
  LayoutGridIcon,
  MenuIcon,
  PackageIcon,
  PlusIcon,
  RefreshCwIcon,
  ScaleIcon,
  ScanBarcodeIcon,
  SearchIcon,
  StoreIcon,
  TagsIcon,
  XIcon,
} from "@/components/icons";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

type Product = {
  id: string;
  barcode: string;
  sku: string;
  name: string;
  category_name: string;
  metal_name?: string;
  karat: string;
  net_mg: number;
  fine_gold_mg: number;
  selling_price_cents: number | null;
  image_keys?: string[];
  location?: string | null;
  status: string;
};

type Option = { id: string; name?: string; karat?: string; code?: string; permille?: number };

const STATUSES = [
  "IN_STOCK",
  "RESERVED",
  "SOLD",
  "RETURNED",
  "IN_REPAIR",
  "IN_MANUFACTURING",
  "TRANSFER_PENDING",
  "MELTING",
  "MELTED",
  "LOST",
  "VOID",
];
const QUICK_STATUSES = ["IN_STOCK", "RESERVED", "SOLD", "IN_REPAIR", "IN_MANUFACTURING"];
const STATUS_DOT: Record<string, string> = {
  IN_STOCK: "bg-emerald-500",
  RESERVED: "bg-amber-500",
  SOLD: "bg-sky-500",
  IN_REPAIR: "bg-rose-500",
  IN_MANUFACTURING: "bg-violet-500",
};
const PAGE_SIZE = 20;

const humanize = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/* ------------------------------------------------------------------ pieces */

function ProductMedia({ p, className }: { p: Product; className?: string }) {
  const key = p.image_keys?.[0];
  const [failed, setFailed] = useState(false);
  if (key && !failed) {
    return (
      <img
        src={`${API}/api/v1/products/${p.id}/images/${key.split("/").pop()}`}
        alt={p.name}
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn("size-full object-cover", className)}
      />
    );
  }
  return (
    <div className={cn("relative flex size-full items-center justify-center overflow-hidden bg-void", className)}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(226,194,122,0.3),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(205,168,83,0.18),transparent_55%)]" />
      <div className="home-grid-bg absolute inset-0 opacity-60" />
      <span className="g-display pointer-events-none absolute -bottom-3 -right-1 select-none text-[4.5rem] leading-none text-gold/[0.08]">
        {p.karat}
      </span>
      <svg viewBox="0 0 64 64" className="relative size-14 drop-shadow-[0_10px_20px_rgba(205,168,83,0.35)]" aria-hidden>
        <defs>
          <linearGradient id="pm-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FBF0D5" />
            <stop offset="0.5" stopColor="#E2C27A" />
            <stop offset="1" stopColor="#7E6223" />
          </linearGradient>
        </defs>
        <polygon points="18,20 46,20 56,30 32,56 8,30" fill="url(#pm-g)" />
        <polygon points="18,20 32,30 8,30" fill="#FBF0D5" opacity="0.7" />
        <polygon points="46,20 56,30 32,30" fill="#A88A3E" opacity="0.8" />
        <polygon points="32,30 56,30 32,56" fill="#7E6223" opacity="0.55" />
        <polygon points="18,20 46,20 56,30 32,56 8,30" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.8" />
      </svg>
    </div>
  );
}

function ProductCard({ p, index }: { p: Product; index: number }) {
  return (
    <Link
      href={`/products/${p.id}`}
      className={cn(
        "group relative flex animate-fade-in flex-col overflow-hidden rounded-[22px] bg-paper transition-all duration-320 ease-brand",
        "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]",
        "hover:-translate-y-1 hover:shadow-[inset_0_0_0_1px_rgba(168,138,62,0.4),0_32px_64px_-30px_rgba(126,98,35,0.5)]"
      )}
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
    >
      <div className="relative m-1.5 mb-0 aspect-[16/10] overflow-hidden rounded-[17px] sm:aspect-[4/3]">
        <div className="size-full transition-transform duration-700 ease-cinematic group-hover:scale-[1.06]">
          <ProductMedia p={p} />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/55 to-transparent" />
        <div className="pointer-events-none absolute inset-0 rounded-[17px] ring-1 ring-inset ring-black/10" />
        <span className="g-metric absolute left-3 top-3 rounded-lg bg-gradient-to-b from-gold-light to-gold px-2 py-0.5 text-[11px] font-semibold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_6px_14px_-6px_rgba(0,0,0,0.5)]">
          {p.karat}
        </span>
        <span className="absolute right-3 top-3 rounded-full bg-paper/95 shadow-2 backdrop-blur">
          <StatusPill status={p.status} label={humanize(p.status)} />
        </span>
        <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md bg-black/30 px-2 py-1 font-mono text-[11px] font-medium tracking-wider text-paper/95 backdrop-blur-sm">
          <ScanBarcodeIcon size={12} className="text-gold-light" />
          {p.barcode}
        </span>
        <span className="absolute bottom-3 right-3 flex size-8 translate-y-2 items-center justify-center rounded-full bg-gradient-to-b from-gold-light to-gold text-void opacity-0 shadow-[0_8px_18px_-8px_rgba(0,0,0,0.6)] transition-all duration-320 ease-brand group-hover:translate-y-0 group-hover:opacity-100">
          <ArrowRightIcon size={14} />
        </span>
      </div>

      <div className="flex flex-1 flex-col px-4 pb-4 pt-3.5">
        <h3 className="truncate font-sans text-[15px] font-semibold tracking-normal text-ink transition-colors group-hover:text-gold-deep">
          {p.name}
        </h3>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
          {[p.category_name, p.metal_name].filter(Boolean).map((t) => (
            <span key={t} className="truncate rounded-md bg-bone px-1.5 py-0.5 text-[10.5px] font-medium text-ink-3 ring-1 ring-ink/[0.05]">
              {t}
            </span>
          ))}
          {p.location ? (
            <span className="truncate rounded-md px-1.5 py-0.5 text-[10.5px] text-ink-5">@ {p.location}</span>
          ) : null}
        </div>

        <div className="mt-3.5 grid grid-cols-2 overflow-hidden rounded-xl bg-bone/70 ring-1 ring-ink/[0.05]">
          {[
            { l: "Net", v: mgToG(p.net_mg), c: "text-ink" },
            { l: "Fine", v: mgToG(p.fine_gold_mg), c: "text-gold-deep" },
          ].map((m, i) => (
            <div key={m.l} className={cn("px-3 py-2", i === 1 && "border-l border-ink/[0.06]")}>
              <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-5">{m.l}</div>
              <div className={cn("g-metric mt-0.5 text-sm", m.c)}>
                {m.v}
                <span className="ml-0.5 text-[10px] text-ink-4">g</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-auto flex items-end justify-between pt-3.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-5">Price</span>
          {p.selling_price_cents !== null ? (
            <span className="flex items-baseline gap-1">
              <span className="text-[10px] font-medium text-ink-4">LKR</span>
              <span className="g-metric text-lg text-ink">{centsToLkr(p.selling_price_cents).toLocaleString("en-US")}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-pale px-2 py-0.5 text-[11px] font-semibold text-gold-deep ring-1 ring-gold-dark/15">
              <span className="size-1.5 animate-pulse-soft rounded-full bg-gold" />
              Live rate
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[22px] bg-paper p-1.5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07)]">
      <Skeleton className="aspect-[4/3] rounded-[17px]" />
      <div className="space-y-3 p-2.5 pt-3.5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-6 w-full" />
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-xs font-medium transition-all duration-200 ease-brand",
        active
          ? "bg-void text-paper shadow-[inset_0_0_0_1px_rgba(205,168,83,0.35),0_8px_18px_-10px_rgba(6,42,34,0.8)]"
          : "bg-paper text-ink-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)] hover:-translate-y-px hover:text-ink hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.24)]"
      )}
    >
      {children}
    </button>
  );
}

/** Two numbers sharing one pill — min on the left, max on the right. */
function RangeField({
  label,
  unit,
  icon,
  min,
  max,
  onMin,
  onMax,
}: {
  label: string;
  unit: string;
  icon: ReactNode;
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
}) {
  const box =
    "g-metric h-full w-full min-w-0 bg-transparent px-2 text-sm text-ink placeholder:font-sans placeholder:text-ink-5 focus:outline-none";
  return (
    <div className="min-w-0">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4">{label}</span>
      <div className="flex h-11 items-center rounded-xl bg-paper pl-2 pr-1.5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12),0_1px_2px_rgba(16,32,27,0.04)] transition-shadow duration-200 focus-within:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)] hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.26)]">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
            min || max ? "bg-void text-gold-light" : "bg-bone text-ink-5"
          )}
        >
          {icon}
        </span>
        <input aria-label={`Min ${label}`} placeholder="Min" type="number" step="any" inputMode="decimal" value={min} onChange={(e) => onMin(e.target.value)} className={box} />
        <span className="shrink-0 text-ink-6">—</span>
        <input aria-label={`Max ${label}`} placeholder="Max" type="number" step="any" inputMode="decimal" value={max} onChange={(e) => onMax(e.target.value)} className={box} />
        <span className="shrink-0 rounded-md bg-bone px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4">{unit}</span>
      </div>
    </div>
  );
}

function FilterLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4">{children}</span>;
}

function HeroScan() {
  const [code, setCode] = useState("");
  const router = useRouter();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const c = code.trim();
        if (!c) return;
        setCode("");
        router.push(`/products/barcode/${encodeURIComponent(c)}`);
      }}
      className="group relative w-full max-w-md"
    >
      <span className="pointer-events-none absolute -inset-px rounded-full bg-gradient-to-r from-gold/0 via-gold/40 to-gold/0 opacity-0 blur-sm transition-opacity duration-320 group-focus-within:opacity-100" />
      <ScanBarcodeIcon size={16} className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-gold-light" />
      <input
        aria-label="Scan or type a barcode"
        placeholder="Scan or type a barcode…"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoComplete="off"
        className="relative h-12 w-full rounded-full bg-black/20 pl-11 pr-28 font-mono text-sm text-paper shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)] ring-1 ring-paper/15 backdrop-blur transition-all placeholder:font-sans placeholder:text-paper/35 focus:bg-black/30 focus:outline-none focus:ring-gold/60"
      />
      <button type="submit" className="home-btn-gold absolute right-1.5 top-1.5 h-9 px-4 text-xs">
        Look up
      </button>
    </form>
  );
}

function PageNav({
  page,
  onChange,
  count,
  total,
}: {
  page: number;
  onChange: (p: number) => void;
  count: number;
  total: number;
}) {
  const from = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = (page - 1) * PAGE_SIZE + count;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const btn =
    "flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-ink transition-all shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12)] hover:-translate-y-px hover:bg-void hover:text-paper hover:shadow-none disabled:pointer-events-none disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] bg-paper px-4 py-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_16px_36px_-30px_rgba(16,32,27,0.3)] sm:px-5">
      <span className="text-xs text-ink-4">
        Showing <span className="g-metric font-medium text-ink">{from}–{to}</span> of{" "}
        <span className="g-metric font-medium text-ink">{total.toLocaleString("en-US")}</span> pieces
      </span>
      <div className="flex items-center gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className={btn}>
          <ArrowLeftIcon size={12} />
          Prev
        </button>
        <span className="g-metric flex h-9 min-w-[4.5rem] items-center justify-center rounded-xl bg-bone px-3 text-xs text-ink-3">
          <span className="text-ink">{page}</span>
          <span className="mx-1 text-ink-5">/</span>
          {pages}
        </span>
        <button type="button" disabled={count < PAGE_SIZE} onClick={() => onChange(page + 1)} className={btn}>
          Next
          <ArrowRightIcon size={12} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export default function ProductsPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [fCat, setFCat] = useState("");
  const [fPur, setFPur] = useState("");
  const [fBranch, setFBranch] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fMinG, setFMinG] = useState("");
  const [fMaxG, setFMaxG] = useState("");
  const [fMinP, setFMinP] = useState("");
  const [fMaxP, setFMaxP] = useState("");
  const [moreFilters, setMoreFilters] = useState(false);
  const [view, setView] = useState<"grid" | "table">("grid");


  useEffect(() => {
    const saved = localStorage.getItem("goldos_products_view");
    if (saved === "grid" || saved === "table") setView(saved);
  }, []);

  // Deep links like /products?status=IN_REPAIR (from the inventory attention
  // card) preselect the matching status filter. Read after mount so SSR and
  // hydration agree.
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("status");
    if (s && STATUSES.includes(s)) setFStatus(s);
  }, []);
  function changeView(v: "grid" | "table") {
    setView(v);
    localStorage.setItem("goldos_products_view", v);
  }

  function query(): string {
    const p = new URLSearchParams({
      search,
      page: String(page),
      limit: String(PAGE_SIZE),
    });
    if (fCat) p.set("categoryId", fCat);
    if (fPur) p.set("purityId", fPur);
    if (fBranch) p.set("branchId", fBranch);
    if (fStatus) p.set("status", fStatus);
    if (fMinG) p.set("minG", fMinG);
    if (fMaxG) p.set("maxG", fMaxG);
    if (fMinP) p.set("minPriceLkr", fMinP);
    if (fMaxP) p.set("maxPriceLkr", fMaxP);
    return `/api/v1/products?${p.toString()}`;
  }

  const list = useQuery({
    queryKey: ["products", search, page, fCat, fPur, fBranch, fStatus, fMinG, fMaxG, fMinP, fMaxP],
    queryFn: () => api<{ rows: Product[]; total: number }>(query()),
  });
  const allCount = useQuery({
    queryKey: ["products-count", "all"],
    queryFn: () => api<{ rows: Product[]; total: number }>("/api/v1/products?limit=1&page=1"),
  });
  const stockCount = useQuery({
    queryKey: ["products-count", "IN_STOCK"],
    queryFn: () => api<{ rows: Product[]; total: number }>("/api/v1/products?limit=1&page=1&status=IN_STOCK"),
  });
  const cats = useQuery({
    queryKey: ["categories-all"],
    queryFn: () => api<{ rows: Option[]; total: number }>("/api/v1/masters/categories?limit=100"),
  });
  const purs = useQuery({
    queryKey: ["purities-all"],
    queryFn: () => api<{ rows: Option[]; total: number }>("/api/v1/masters/purities?limit=100"),
  });
  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () => api<{ rows: Option[]; total: number }>("/api/v1/branches?limit=100"),
  });
  const rows = list.data?.rows ?? [];
  const nameOf = (opts: Option[] | undefined, id: string) => {
    const o = opts?.find((x) => x.id === id);
    return o?.name ?? o?.karat ?? id;
  };

  const active: { key: string; label: string; clear: () => void }[] = [
    fCat && { key: "cat", label: nameOf(cats.data?.rows, fCat), clear: () => setFCat("") },
    fPur && { key: "pur", label: nameOf(purs.data?.rows, fPur), clear: () => setFPur("") },
    fStatus && { key: "status", label: humanize(fStatus), clear: () => setFStatus("") },
    fBranch && { key: "branch", label: nameOf(branches.data?.rows, fBranch), clear: () => setFBranch("") },
    (fMinG || fMaxG) && {
      key: "g",
      label: `${fMinG || "0"}–${fMaxG || "∞"} g`,
      clear: () => {
        setFMinG("");
        setFMaxG("");
      },
    },
    (fMinP || fMaxP) && {
      key: "p",
      label: `LKR ${fMinP || "0"}–${fMaxP || "∞"}`,
      clear: () => {
        setFMinP("");
        setFMaxP("");
      },
    },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];
  const advancedCount = [fCat, fBranch, fMinG || fMaxG, fMinP || fMaxP].filter(Boolean).length;

  function set(fn: (v: string) => void) {
    return (v: string) => {
      fn(v);
      setPage(1);
    };
  }
  function clearAll() {
    [setFCat, setFPur, setFBranch, setFStatus, setFMinG, setFMaxG, setFMinP, setFMaxP].forEach((f) => f(""));
    setSearch("");
    setPage(1);
  }

  const allN = allCount.data?.total;
  const stockN = stockCount.data?.total;
  const stockShare = allN && stockN !== undefined ? stockN / allN : null;
  const stats: { label: string; value: string; icon: typeof GemIcon; sub?: string; bar?: number | null }[] = [
    { label: "Pieces", value: allN !== undefined ? allN.toLocaleString("en-US") : "—", icon: PackageIcon, sub: "Across all branches" },
    {
      label: "In stock",
      value: stockN !== undefined ? stockN.toLocaleString("en-US") : "—",
      icon: ArchiveIcon,
      sub: stockShare !== null ? `${Math.round(stockShare * 100)}% of catalog` : undefined,
      bar: stockShare,
    },
    { label: "Categories", value: cats.data ? String(cats.data.total) : "—", icon: TagsIcon, sub: "Ways to browse" },
    { label: "Purities", value: purs.data ? String(purs.data.total) : "—", icon: GemIcon, sub: (purs.data?.rows ?? []).map((p) => p.karat).filter(Boolean).slice(0, 4).join(" · ") || undefined },
  ];

  return (
    <Page className="space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[28px] bg-void text-paper shadow-5 ring-1 ring-gold/10">
        <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-70" />
        <div className="home-drift pointer-events-none absolute -right-24 -top-32 size-[22rem] rounded-full bg-gold/20 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-40 -left-24 size-80 rounded-full bg-emerald-400/10 blur-[110px]" />
        <div className="home-noise pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />

        <div className="relative flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-end lg:justify-between lg:px-8 lg:py-7">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
              <GemIcon size={11} />
              Catalog
            </span>
            <h1 className="g-display mt-3.5 text-3xl text-paper sm:text-[2.6rem]">
              Every piece, <span className="home-gold-text">on show.</span>
            </h1>
            <p className="mt-2.5 max-w-lg text-sm leading-relaxed text-paper/60">
              Unique pieces with barcodes, weights and live pricing. Scan to jump straight to a piece.
            </p>
            <div className="mt-5">
              <HeroScan />
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Link href="/products/new" className="home-btn-gold h-11 px-5 text-sm">
              <PlusIcon size={15} />
              New product
            </Link>
            <Link href="/scan" className="home-btn-ghost h-11 px-5 text-sm">
              <ScanBarcodeIcon size={15} />
              Scan mode
            </Link>
          </div>
        </div>

        <div className="relative grid grid-cols-2 gap-px border-t border-paper/[0.08] bg-paper/[0.06] lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="group flex min-w-0 items-center gap-3.5 bg-void/95 px-4 py-4 transition-colors hover:bg-void/80 sm:px-6">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-paper/[0.09] to-paper/[0.03] text-gold-light shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 ring-paper/[0.09] transition-colors group-hover:text-gold">
                <s.icon size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">{s.label}</span>
                <span className="g-metric mt-0.5 block text-xl leading-tight text-paper">{s.value}</span>
                {s.bar !== undefined && s.bar !== null ? (
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-paper/10">
                    <span
                      className="block h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-[width] duration-700 ease-brand"
                      style={{ width: `${Math.round(s.bar * 100)}%` }}
                    />
                  </span>
                ) : null}
                {s.sub ? <span className="mt-1 block truncate text-[10px] text-paper/35">{s.sub}</span> : null}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Toolbar */}
      <section className="sticky top-14 z-20 -mx-1 rounded-[24px] bg-bone/80 px-1 py-1 backdrop-blur-xl">
        <div className="relative rounded-[22px] bg-paper p-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)] sm:p-4">
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="group relative flex-1">
              <SearchIcon size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-5 transition-colors group-focus-within:text-gold-dark" />
              <input
                placeholder="Search name, barcode, SKU…"
                value={search}
                onChange={(e) => set(setSearch)(e.target.value)}
                className="h-11 w-full rounded-xl bg-bone/60 pl-11 pr-12 text-sm text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.08)] transition-all duration-200 placeholder:text-ink-5 hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)] focus:bg-paper focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)]"
              />
              {search ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => set(setSearch)("")}
                  className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-ink-4 hover:bg-ink/5 hover:text-ink"
                >
                  <XIcon size={14} />
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMoreFilters((v) => !v)}
                aria-expanded={moreFilters}
                className={cn(
                  "inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-all duration-200 md:flex-none",
                  moreFilters
                    ? "bg-void text-paper shadow-[inset_0_0_0_1px_rgba(205,168,83,0.35),0_10px_22px_-12px_rgba(6,42,34,0.8)]"
                    : "bg-paper text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12)] hover:-translate-y-px hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.26)]"
                )}
              >
                <LayersIcon size={15} className={moreFilters ? "text-gold-light" : "text-ink-4"} />
                Filters
                {advancedCount > 0 ? (
                  <span className="g-metric flex size-5 items-center justify-center rounded-full bg-gradient-to-b from-gold-light to-gold text-[10px] font-semibold text-void">
                    {advancedCount}
                  </span>
                ) : null}
                <ChevronDownIcon size={14} className={cn("transition-transform duration-200", moreFilters && "rotate-180")} />
              </button>
              <div className="relative flex h-11 items-center rounded-xl bg-bone p-1 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.08)]" role="group" aria-label="View">
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-y-1 left-1 w-10 rounded-lg bg-void shadow-[0_6px_14px_-6px_rgba(6,42,34,0.8)] transition-transform duration-320 ease-brand",
                    view === "table" && "translate-x-10"
                  )}
                />
                {(
                  [
                    { v: "grid", icon: LayoutGridIcon, label: "Grid view" },
                    { v: "table", icon: MenuIcon, label: "Table view" },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    aria-label={o.label}
                    aria-pressed={view === o.v}
                    onClick={() => changeView(o.v)}
                    className={cn(
                      "relative flex h-full w-10 items-center justify-center rounded-lg transition-colors duration-200",
                      view === o.v ? "text-gold-light" : "text-ink-4 hover:text-ink"
                    )}
                  >
                    <o.icon size={15} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="scrollbar-thin -mx-1 mt-3 flex items-center gap-2 overflow-x-auto px-1 pb-0.5">
            <Chip active={!fStatus} onClick={() => set(setFStatus)("")}>
              All
            </Chip>
            {QUICK_STATUSES.map((s) => (
              <Chip key={s} active={fStatus === s} onClick={() => set(setFStatus)(fStatus === s ? "" : s)}>
                <span className={cn("size-1.5 rounded-full", STATUS_DOT[s] ?? "bg-ink-5")} />
                {humanize(s)}
              </Chip>
            ))}
            {(purs.data?.rows.length ?? 0) > 0 ? <span className="mx-1 h-5 w-px shrink-0 bg-ink/10" /> : null}
            {(purs.data?.rows ?? []).map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={fPur === p.id}
                onClick={() => set(setFPur)(fPur === p.id ? "" : p.id)}
                className={cn(
                  "g-metric inline-flex h-8 shrink-0 items-center rounded-full px-3.5 text-xs font-semibold transition-all duration-200",
                  fPur === p.id
                    ? "bg-gradient-to-b from-gold-light to-gold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_8px_18px_-10px_rgba(205,168,83,0.8)]"
                    : "bg-gold-pale text-gold-deep ring-1 ring-gold-dark/15 hover:-translate-y-px hover:ring-gold-dark/40"
                )}
              >
                {p.karat}
              </button>
            ))}
          </div>

          {moreFilters ? (
            <div className="mt-4 animate-fade-in border-t border-ink/[0.06] pt-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="min-w-0">
                  <FilterLabel>Category</FilterLabel>
                  <Select
                    value={fCat}
                    onChange={set(setFCat)}
                    icon={<TagsIcon size={13} />}
                    loading={cats.isLoading}
                    options={[{ value: "", label: "All categories" }, ...(cats.data?.rows ?? []).map((c) => ({ value: c.id, label: c.name ?? c.id }))]}
                  />
                </div>
                <div className="min-w-0">
                  <FilterLabel>Branch</FilterLabel>
                  <Select
                    value={fBranch}
                    onChange={set(setFBranch)}
                    icon={<StoreIcon size={13} />}
                    loading={branches.isLoading}
                    options={[{ value: "", label: "All branches" }, ...(branches.data?.rows ?? []).map((b) => ({ value: b.id, label: b.name ?? b.id }))]}
                  />
                </div>
                <div className="min-w-0">
                  <FilterLabel>Status</FilterLabel>
                  <Select
                    value={fStatus}
                    onChange={set(setFStatus)}
                    icon={<ArchiveIcon size={13} />}
                    options={[{ value: "", label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: humanize(s) }))]}
                  />
                </div>
                <div className="min-w-0">
                  <FilterLabel>Purity</FilterLabel>
                  <Select
                    value={fPur}
                    onChange={set(setFPur)}
                    icon={<GemIcon size={13} />}
                    loading={purs.isLoading}
                    options={[
                      { value: "", label: "All purities" },
                      ...(purs.data?.rows ?? []).map((p) => ({
                        value: p.id,
                        label: p.karat ?? p.id,
                        hint: p.permille ? `${p.permille}‰ fine` : undefined,
                      })),
                    ]}
                  />
                </div>
                <div className="sm:col-span-1 lg:col-span-2">
                  <RangeField label="Net weight" unit="g" icon={<ScaleIcon size={13} />} min={fMinG} max={fMaxG} onMin={set(setFMinG)} onMax={set(setFMaxG)} />
                </div>
                <div className="sm:col-span-1 lg:col-span-2">
                  <RangeField label="Price" unit="LKR" icon={<BanknoteIcon size={13} />} min={fMinP} max={fMaxP} onMin={set(setFMinP)} onMax={set(setFMaxP)} />
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-xs text-ink-4">
                  {active.length > 0 ? (
                    <>
                      <span className="g-metric font-medium text-ink">{active.length}</span> filter{active.length === 1 ? "" : "s"} applied
                    </>
                  ) : (
                    "Narrow the catalog by any combination"
                  )}
                </p>
                <button
                  type="button"
                  onClick={clearAll}
                  disabled={active.length === 0 && !search}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-ink-3 transition-colors hover:bg-bone hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                >
                  <RefreshCwIcon size={12} />
                  Reset all
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* Results bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <p className="flex items-center gap-2 text-sm text-ink-4">
          {list.isLoading ? (
            <>
              <span className="size-3.5 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
              Loading pieces…
            </>
          ) : (
            <>
              <span className="g-metric rounded-lg bg-paper px-2 py-0.5 font-medium text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.08)]">
                {(list.data?.total ?? 0).toLocaleString("en-US")}
              </span>
              <span>
                {list.data?.total === 1 ? "piece" : "pieces"}
                {search ? (
                  <>
                    {" "}matching <span className="font-medium text-ink">&ldquo;{search}&rdquo;</span>
                  </>
                ) : null}
              </span>
              {list.isFetching ? <span className="size-3 animate-spin rounded-full border-2 border-gold/30 border-t-gold" /> : null}
            </>
          )}
        </p>
        {active.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {active.map((f) => (
              <span key={f.key} className="inline-flex animate-pop-in items-center gap-1 rounded-full bg-gold-pale py-1 pl-3 pr-1 text-xs font-medium text-gold-deep ring-1 ring-gold-dark/20">
                {f.label}
                <button
                  type="button"
                  aria-label={`Remove ${f.label}`}
                  onClick={() => {
                    f.clear();
                    setPage(1);
                  }}
                  className="flex size-5 items-center justify-center rounded-full transition-colors hover:bg-gold-deep hover:text-paper"
                >
                  <XIcon size={11} />
                </button>
              </span>
            ))}
            <button type="button" onClick={clearAll} className="px-2 text-xs font-medium text-ink-4 underline-offset-2 hover:text-ink hover:underline">
              Clear all
            </button>
          </div>
        ) : null}
      </div>

      {/* Results */}
      {list.isError ? (
        <div className="rounded-[22px] bg-paper p-6 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07)]">
          <EmptyBlock title="Failed to load products" description="Check the API connection and retry." />
        </div>
      ) : !list.isLoading && rows.length === 0 ? (
        <div className="relative flex flex-col items-center overflow-hidden rounded-[28px] border border-dashed border-ink/15 bg-paper/70 px-6 py-16 text-center">
          <div className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-gold/10 blur-[80px]" />
          <span className="relative mb-5 flex size-16 items-center justify-center rounded-2xl bg-void text-gold-light shadow-4">
            <span className="absolute inset-0 animate-pulse-soft rounded-2xl ring-4 ring-gold/20" />
            <GemIcon size={26} />
          </span>
          <h2 className="g-display relative text-2xl text-ink">No pieces found</h2>
          <p className="relative mt-2 max-w-sm text-sm text-ink-4">
            {active.length || search ? "Nothing matches these filters. Try widening the search." : "Your catalog is empty. Add the first piece to get started."}
          </p>
          <div className="relative mt-6 flex gap-2">
            {active.length || search ? (
              <button type="button" onClick={clearAll} className="g-btn g-btn-secondary h-10 rounded-xl px-4 text-sm">
                Clear filters
              </button>
            ) : null}
            <Link href="/products/new" className="g-btn g-btn-primary h-10 rounded-xl px-4 text-sm">
              <PlusIcon size={14} />
              New product
            </Link>
          </div>
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {list.isLoading
            ? Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)
            : rows.map((p, i) => <ProductCard key={p.id} p={p} index={i} />)}
        </div>
      ) : (
        <section className="overflow-hidden rounded-[22px] bg-paper shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]">
          <div className="scrollbar-thin overflow-x-auto">
            {list.isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            ) : (
              <table className="g-table">
                <thead>
                  <tr>
                    <th>Piece</th>
                    <th>Barcode · SKU</th>
                    <th>Karat</th>
                    <th className="!text-right">Net g</th>
                    <th className="!text-right">Fine g</th>
                    <th className="!text-right">Price LKR</th>
                    <th>Status</th>
                    <th aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="group">
                      <td>
                        <Link href={`/products/${r.id}`} className="flex items-center gap-3">
                          <span className="size-12 shrink-0 overflow-hidden rounded-xl shadow-[0_6px_14px_-8px_rgba(16,32,27,0.5)] ring-1 ring-ink/[0.08] transition-transform duration-320 group-hover:scale-105">
                            <ProductMedia p={r} className="[&_svg]:size-6" />
                          </span>
                          <span className="min-w-0">
                            <span className="block max-w-[16rem] truncate font-medium text-ink transition-colors group-hover:text-gold-deep">{r.name}</span>
                            <span className="mt-0.5 block truncate text-xs text-ink-4">
                              {r.category_name}
                              {r.metal_name ? ` · ${r.metal_name}` : ""}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-gold-deep">
                          <ScanBarcodeIcon size={11} className="text-gold-dark" />
                          {r.barcode}
                        </span>
                        <span className="mt-0.5 block font-mono text-[11px] text-ink-5">{r.sku}</span>
                      </td>
                      <td>
                        <span className="g-metric rounded-md bg-gradient-to-b from-gold-light to-gold px-2 py-0.5 text-xs font-semibold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
                          {r.karat}
                        </span>
                      </td>
                      <td className="num">{mgToG(r.net_mg)}</td>
                      <td className="num text-gold-deep">{mgToG(r.fine_gold_mg)}</td>
                      <td className="num font-medium text-ink">
                        {r.selling_price_cents !== null ? (
                          centsToLkr(r.selling_price_cents).toLocaleString("en-US")
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gold-pale px-2 py-0.5 text-[11px] font-semibold text-gold-deep">
                            <span className="size-1.5 rounded-full bg-gold" />
                            Live
                          </span>
                        )}
                      </td>
                      <td>
                        <StatusPill status={r.status} label={humanize(r.status)} />
                      </td>
                      <td>
                        <Link
                          href={`/products/${r.id}`}
                          aria-label={`Open ${r.name}`}
                          className="flex size-8 items-center justify-center rounded-full text-ink-5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)] transition-all group-hover:bg-void group-hover:text-gold-light group-hover:shadow-none"
                        >
                          <ArrowRightIcon size={13} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {rows.length > 0 ? (
        <PageNav page={page} onChange={setPage} count={rows.length} total={list.data?.total ?? 0} />
      ) : null}
    </Page>
  );
}
