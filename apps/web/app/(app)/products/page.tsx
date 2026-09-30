"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { centsToLkr, mgToG } from "@goldos/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, Pager, StatusPill, Skeleton, EmptyBlock, controlClass } from "@/components/ui";
import {
  ArchiveIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  GemIcon,
  LayoutGridIcon,
  MenuIcon,
  PackageIcon,
  PlusIcon,
  ScanBarcodeIcon,
  SearchIcon,
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
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(231,198,90,0.28),transparent_60%)]" />
      <div className="home-grid-bg absolute inset-0 opacity-60" />
      <span className="g-display pointer-events-none absolute -bottom-3 -right-1 select-none text-[4.5rem] leading-none text-gold/[0.08]">
        {p.karat}
      </span>
      <svg viewBox="0 0 64 64" className="relative size-14 drop-shadow-[0_10px_20px_rgba(201,162,39,0.35)]" aria-hidden>
        <defs>
          <linearGradient id="pm-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FFF4C7" />
            <stop offset="0.5" stopColor="#E7C65A" />
            <stop offset="1" stopColor="#8C6D1F" />
          </linearGradient>
        </defs>
        <polygon points="18,20 46,20 56,30 32,56 8,30" fill="url(#pm-g)" />
        <polygon points="18,20 32,30 8,30" fill="#FFF4C7" opacity="0.7" />
        <polygon points="46,20 56,30 32,30" fill="#A8861B" opacity="0.8" />
        <polygon points="32,30 56,30 32,56" fill="#8C6D1F" opacity="0.55" />
        <polygon points="18,20 46,20 56,30 32,56 8,30" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.8" />
      </svg>
    </div>
  );
}

function ProductCard({ p, index }: { p: Product; index: number }) {
  return (
    <Link
      href={`/products/${p.id}`}
      className="group relative flex animate-fade-in flex-col overflow-hidden rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(28,25,23,0.07),0_16px_36px_-28px_rgba(28,25,23,0.3)] transition-all duration-320 ease-brand hover:-translate-y-1 hover:shadow-[inset_0_0_0_1px_rgba(168,134,27,0.35),0_28px_56px_-28px_rgba(140,109,31,0.45)]"
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
    >
      <div className="relative aspect-[16/10] overflow-hidden sm:aspect-[4/3]">
        <div className="size-full transition-transform duration-700 ease-cinematic group-hover:scale-105">
          <ProductMedia p={p} />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent" />
        <span className="g-metric absolute left-3 top-3 rounded-md bg-gradient-to-b from-gold-light to-gold px-2 py-0.5 text-[11px] font-semibold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
          {p.karat}
        </span>
        <span className="absolute right-3 top-3 rounded-full bg-paper/95 shadow-2 backdrop-blur">
          <StatusPill status={p.status} label={humanize(p.status)} />
        </span>
        <span className="absolute bottom-3 left-3 flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-wider text-paper/90">
          <ScanBarcodeIcon size={12} className="text-gold-light" />
          {p.barcode}
        </span>
        <span className="absolute bottom-3 right-3 flex translate-y-2 items-center gap-1 rounded-full bg-paper px-2.5 py-1 text-[11px] font-semibold text-ink opacity-0 shadow-2 transition-all duration-320 ease-brand group-hover:translate-y-0 group-hover:opacity-100">
          View
          <ArrowRightIcon size={11} />
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="truncate font-sans text-[15px] font-semibold tracking-normal text-ink">{p.name}</h3>
        <p className="mt-0.5 truncate text-xs text-ink-4">
          {p.category_name}
          {p.metal_name ? ` · ${p.metal_name}` : ""}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {[
            { l: "Net", v: mgToG(p.net_mg) },
            { l: "Fine", v: mgToG(p.fine_gold_mg) },
          ].map((m) => (
            <div key={m.l} className="rounded-lg bg-bone px-2.5 py-2 ring-1 ring-ink/[0.05]">
              <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-5">{m.l}</div>
              <div className="g-metric mt-0.5 text-sm text-ink">
                {m.v}
                <span className="ml-0.5 text-[10px] text-ink-4">g</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-end justify-between border-t border-ink/[0.06] pt-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-5">Price</span>
          {p.selling_price_cents !== null ? (
            <span className="flex items-baseline gap-1">
              <span className="text-[10px] text-ink-4">LKR</span>
              <span className="g-metric text-lg text-ink">{centsToLkr(p.selling_price_cents).toLocaleString("en-US")}</span>
            </span>
          ) : (
            <span className="text-xs font-medium text-gold-dark">Live rate</span>
          )}
        </div>
      </div>
    </Link>
  );
}

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(28,25,23,0.07)]">
      <Skeleton className="aspect-[4/3] rounded-none" />
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </div>
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
          ? "bg-ink text-paper shadow-[0_8px_18px_-10px_rgba(28,25,23,0.6)]"
          : "bg-paper text-ink-3 ring-1 ring-ink/10 hover:text-ink hover:ring-ink/25"
      )}
    >
      {children}
    </button>
  );
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
      className="relative w-full max-w-md"
    >
      <ScanBarcodeIcon size={16} className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-gold-light" />
      <input
        aria-label="Scan or type a barcode"
        placeholder="Scan or type a barcode…"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoComplete="off"
        className="h-12 w-full rounded-full bg-paper/[0.06] pl-11 pr-28 font-mono text-sm text-paper ring-1 ring-paper/15 backdrop-blur transition-all placeholder:font-sans placeholder:text-paper/35 focus:bg-paper/[0.1] focus:outline-none focus:ring-gold/60"
      />
      <button type="submit" className="home-btn-gold absolute right-1.5 top-1.5 h-9 px-4 text-xs">
        Look up
      </button>
    </form>
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
  const inputCls = controlClass;
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

  const stats: { label: string; value: string; icon: typeof GemIcon }[] = [
    { label: "Pieces", value: allCount.data ? allCount.data.total.toLocaleString("en-US") : "—", icon: PackageIcon },
    { label: "In stock", value: stockCount.data ? stockCount.data.total.toLocaleString("en-US") : "—", icon: ArchiveIcon },
    { label: "Categories", value: cats.data ? String(cats.data.total) : "—", icon: TagsIcon },
    { label: "Purities", value: purs.data ? String(purs.data.total) : "—", icon: GemIcon },
  ];

  return (
    <Page className="space-y-5">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-void text-paper shadow-4">
        <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-70" />
        <div className="home-drift pointer-events-none absolute -right-24 -top-32 size-[22rem] rounded-full bg-gold/20 blur-[120px]" />
        <div className="home-noise pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />

        <div className="relative flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between lg:px-7 lg:py-6">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
              <GemIcon size={11} />
              Catalog
            </span>
            <h1 className="g-display mt-3 text-3xl text-paper sm:text-4xl">
              Every piece, <span className="home-gold-text">on show.</span>
            </h1>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-paper/60">
              Unique pieces with barcodes, weights and live pricing. Scan to jump straight to a piece.
            </p>
            <div className="mt-4">
              <HeroScan />
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Link href="/products/new" className="home-btn-gold h-10 px-4 text-sm">
              <PlusIcon size={15} />
              New product
            </Link>
            <Link href="/scan" className="home-btn-ghost h-10 px-4 text-sm">
              <ScanBarcodeIcon size={15} />
              Scan mode
            </Link>
          </div>
        </div>

        <div className="relative grid grid-cols-2 border-t border-paper/[0.08] lg:grid-cols-4">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className={cn(
                "flex min-w-0 items-center gap-3 px-4 py-3 sm:px-6",
                i % 2 === 1 && "border-l border-paper/[0.08]",
                i >= 2 && "border-t border-paper/[0.08] lg:border-t-0",
                i === 2 && "lg:border-l"
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-paper/[0.05] text-gold-light ring-1 ring-paper/[0.08]">
                <s.icon size={14} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">{s.label}</span>
                <span className="g-metric mt-0.5 block text-base text-paper">{s.value}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Toolbar */}
      <section className="sticky top-14 z-20 -mx-1 rounded-2xl bg-bone/85 px-1 py-1 backdrop-blur-md">
        <div className="rounded-2xl bg-paper p-3 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.07),0_16px_36px_-28px_rgba(28,25,23,0.3)] sm:p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <SearchIcon size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4" />
              <input
                placeholder="Search name, barcode, SKU…"
                value={search}
                onChange={(e) => set(setSearch)(e.target.value)}
                className={cn(inputCls, "h-11 w-full rounded-xl pl-10")}
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
                  "inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors",
                  moreFilters ? "bg-ink text-paper" : "bg-bone text-ink ring-1 ring-ink/10 hover:ring-ink/25"
                )}
              >
                Filters
                {advancedCount > 0 ? (
                  <span className="g-metric flex size-5 items-center justify-center rounded-full bg-gold text-[10px] font-semibold text-void">
                    {advancedCount}
                  </span>
                ) : null}
                <ChevronDownIcon size={14} className={cn("transition-transform", moreFilters && "rotate-180")} />
              </button>
              <div className="flex h-11 items-center rounded-xl bg-bone p-1 ring-1 ring-ink/10" role="group" aria-label="View">
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
                      "flex h-full w-10 items-center justify-center rounded-lg transition-all",
                      view === o.v ? "bg-ink text-gold-light shadow-2" : "text-ink-4 hover:text-ink"
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
                {s === "IN_STOCK" ? <span className="size-1.5 rounded-full bg-emerald-500" /> : null}
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
                  "g-metric inline-flex h-8 shrink-0 items-center rounded-full px-3 text-xs font-semibold transition-all",
                  fPur === p.id
                    ? "bg-gradient-to-b from-gold-light to-gold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_8px_18px_-10px_rgba(201,162,39,0.8)]"
                    : "bg-gold-pale text-gold-deep ring-1 ring-gold-dark/15 hover:ring-gold-dark/40"
                )}
              >
                {p.karat}
              </button>
            ))}
          </div>

          {moreFilters ? (
            <div className="mt-3 grid animate-fade-in grid-cols-2 gap-2.5 border-t border-ink/[0.06] pt-3 md:grid-cols-4">
              <select value={fCat} onChange={(e) => set(setFCat)(e.target.value)} className={inputCls}>
                <option value="">All categories</option>
                {(cats.data?.rows ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <select value={fBranch} onChange={(e) => set(setFBranch)(e.target.value)} className={inputCls}>
                <option value="">All branches</option>
                {(branches.data?.rows ?? []).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <select value={fStatus} onChange={(e) => set(setFStatus)(e.target.value)} className={inputCls}>
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{humanize(s)}</option>
                ))}
              </select>
              <select value={fPur} onChange={(e) => set(setFPur)(e.target.value)} className={inputCls}>
                <option value="">All purities</option>
                {(purs.data?.rows ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.karat}</option>
                ))}
              </select>
              <input placeholder="Min grams" type="number" step="any" value={fMinG} onChange={(e) => set(setFMinG)(e.target.value)} className={inputCls} />
              <input placeholder="Max grams" type="number" step="any" value={fMaxG} onChange={(e) => set(setFMaxG)(e.target.value)} className={inputCls} />
              <input placeholder="Min price LKR" type="number" step="any" value={fMinP} onChange={(e) => set(setFMinP)(e.target.value)} className={inputCls} />
              <input placeholder="Max price LKR" type="number" step="any" value={fMaxP} onChange={(e) => set(setFMaxP)(e.target.value)} className={inputCls} />
            </div>
          ) : null}
        </div>
      </section>

      {/* Results bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <p className="text-sm text-ink-4">
          {list.isLoading ? (
            "Loading pieces…"
          ) : (
            <>
              <span className="g-metric font-medium text-ink">{(list.data?.total ?? 0).toLocaleString("en-US")}</span>{" "}
              {list.data?.total === 1 ? "piece" : "pieces"}
              {search ? (
                <>
                  {" "}matching <span className="font-medium text-ink">&ldquo;{search}&rdquo;</span>
                </>
              ) : null}
            </>
          )}
        </p>
        {active.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {active.map((f) => (
              <span key={f.key} className="inline-flex items-center gap-1 rounded-full bg-gold-pale py-1 pl-3 pr-1 text-xs font-medium text-gold-deep ring-1 ring-gold-dark/20">
                {f.label}
                <button
                  type="button"
                  aria-label={`Remove ${f.label}`}
                  onClick={() => {
                    f.clear();
                    setPage(1);
                  }}
                  className="flex size-5 items-center justify-center rounded-full hover:bg-gold-dark/15"
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
        <div className="rounded-2xl bg-paper p-6 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.07)]">
          <EmptyBlock title="Failed to load products" description="Check the API connection and retry." />
        </div>
      ) : !list.isLoading && rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-3xl border border-dashed border-ink/15 bg-paper/60 px-6 py-16 text-center">
          <span className="relative mb-5 flex size-16 items-center justify-center rounded-2xl bg-void text-gold-light shadow-4">
            <span className="absolute inset-0 animate-pulse-soft rounded-2xl ring-4 ring-gold/20" />
            <GemIcon size={26} />
          </span>
          <h2 className="g-display text-2xl text-ink">No pieces found</h2>
          <p className="mt-2 max-w-sm text-sm text-ink-4">
            {active.length || search ? "Nothing matches these filters. Try widening the search." : "Your catalog is empty. Add the first piece to get started."}
          </p>
          <div className="mt-6 flex gap-2">
            {active.length || search ? (
              <button type="button" onClick={clearAll} className="g-btn g-btn-secondary h-10 px-4 text-sm">
                Clear filters
              </button>
            ) : null}
            <Link href="/products/new" className="g-btn g-btn-primary h-10 px-4 text-sm">
              <PlusIcon size={14} />
              New product
            </Link>
          </div>
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {list.isLoading
            ? Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)
            : rows.map((p, i) => <ProductCard key={p.id} p={p} index={i} />)}
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(28,25,23,0.07),0_16px_36px_-28px_rgba(28,25,23,0.3)]">
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
                          <span className="size-11 shrink-0 overflow-hidden rounded-xl ring-1 ring-ink/[0.08]">
                            <ProductMedia p={r} className="[&_svg]:size-6" />
                          </span>
                          <span className="min-w-0">
                            <span className="block max-w-[16rem] truncate font-medium text-ink group-hover:text-gold-deep">{r.name}</span>
                            <span className="mt-0.5 block truncate text-xs text-ink-4">
                              {r.category_name}
                              {r.metal_name ? ` · ${r.metal_name}` : ""}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <span className="block font-mono text-xs font-medium text-gold-dark">{r.barcode}</span>
                        <span className="mt-0.5 block font-mono text-[11px] text-ink-5">{r.sku}</span>
                      </td>
                      <td>
                        <span className="g-metric rounded-md bg-gold-pale px-2 py-0.5 text-xs font-semibold text-gold-deep ring-1 ring-gold-dark/15">
                          {r.karat}
                        </span>
                      </td>
                      <td className="num">{mgToG(r.net_mg)}</td>
                      <td className="num">{mgToG(r.fine_gold_mg)}</td>
                      <td className="num font-medium text-ink">
                        {r.selling_price_cents !== null ? centsToLkr(r.selling_price_cents).toLocaleString("en-US") : <span className="text-xs text-gold-dark">Live</span>}
                      </td>
                      <td>
                        <StatusPill status={r.status} label={humanize(r.status)} />
                      </td>
                      <td>
                        <Link
                          href={`/products/${r.id}`}
                          aria-label={`Open ${r.name}`}
                          className="flex size-8 items-center justify-center rounded-full text-ink-5 transition-all group-hover:bg-ink group-hover:text-gold-light"
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-paper px-5 py-3 text-xs text-ink-4 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.07)]">
          <Pager page={page} onChange={setPage} pageSize={PAGE_SIZE} count={rows.length} total={list.data?.total ?? 0} unit="products" />
        </div>
      ) : null}

    </Page>
  );
}
