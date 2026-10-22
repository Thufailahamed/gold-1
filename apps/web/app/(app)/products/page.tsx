"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { centsToLkr } from "@goldos/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, Skeleton, EmptyBlock } from "@/components/ui";
import { GoldHero, HeroBadge, heroGhost, heroGold, th, thead, tr } from "@/components/console-kit";
import { Select } from "@/components/select";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  PrinterIcon,
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
  PackagePlusIcon,
} from "@/components/icons";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

type Product = {
  id: string;
  barcode: string;
  sku: string;
  name: string;
  category_name: string;
  subcategory_name?: string | null;
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
  RETURNED: "bg-teal-500",
  TRANSFER_PENDING: "bg-indigo-500",
  MELTING: "bg-orange-500",
  MELTED: "bg-ink/40",
  LOST: "bg-rose-700",
  VOID: "bg-ink/30",
};
const STATUS_CHIP: Record<string, string> = {
  IN_STOCK: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25",
  RESERVED: "bg-amber-500/10 text-amber-800 ring-amber-500/25",
  SOLD: "bg-sky-500/10 text-sky-800 ring-sky-500/25",
  IN_REPAIR: "bg-rose-500/10 text-rose-800 ring-rose-500/25",
  IN_MANUFACTURING: "bg-violet-500/10 text-violet-800 ring-violet-500/25",
};

/** Status chip; `solid` sits on photos so it stays legible. */
function StatusChip({ status, solid }: { status: string; solid?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset",
        solid ? "bg-paper/95 text-ink-2 shadow-2 ring-black/5 backdrop-blur" : (STATUS_CHIP[status] ?? "bg-ink/[0.05] text-ink-3 ring-ink/10")
      )}
    >
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status] ?? "bg-ink/30")} />
      {humanize(status)}
    </span>
  );
}
const PAGE_SIZE = 20;

const g = (mg: number) => (mg / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });
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
        "group relative flex animate-fade-in flex-col overflow-hidden rounded-2xl bg-paper transition-all duration-320 ease-brand",
        "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_18px_40px_-30px_rgba(16,32,27,0.35)]",
        "hover:-translate-y-0.5 hover:shadow-[inset_0_0_0_1px_rgba(168,138,62,0.4),0_28px_56px_-30px_rgba(126,98,35,0.5)]"
      )}
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      <div className="relative m-1 mb-0 aspect-[4/3] overflow-hidden rounded-xl">
        <div className="size-full transition-transform duration-700 ease-cinematic group-hover:scale-[1.06]">
          <ProductMedia p={p} />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/55 to-transparent" />
        <span className="g-metric absolute left-2 top-2 rounded-md bg-gradient-to-b from-gold-light to-gold px-1.5 py-px text-[10.5px] font-bold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_6px_14px_-6px_rgba(0,0,0,0.5)]">
          {p.karat}
        </span>
        <span className="absolute right-2 top-2">
          <StatusChip status={p.status} solid />
        </span>
        <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/35 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wider text-paper/95 backdrop-blur-sm">
          <ScanBarcodeIcon size={10} className="text-gold-light" />
          {p.barcode}
        </span>
        {p.selling_price_cents === null ? (
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-gold/90 px-1.5 py-px text-[9.5px] font-bold text-void">
            <span className="size-1 animate-pulse-soft rounded-full bg-void" />
            Live rate
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col px-3 pb-3 pt-2.5">
        <h3 className="truncate text-[13.5px] font-semibold text-ink transition-colors group-hover:text-gold-deep">{p.name}</h3>
        <div className="mt-0.5 truncate text-[11px] text-ink-4">
          {[p.category_name, p.metal_name, p.location ? `@ ${p.location}` : null].filter(Boolean).join(" · ")}
        </div>
        <div className="mt-2 flex items-end justify-between gap-2 border-t border-ink/[0.06] pt-2">
          <div className="flex gap-3 leading-none">
            <span>
              <span className="block text-[8.5px] font-semibold uppercase tracking-[0.16em] text-ink-5">Net</span>
              <span className="g-metric mt-1 block text-[12.5px] text-ink">{g(p.net_mg)}<span className="text-[9.5px] text-ink-5">g</span></span>
            </span>
            <span>
              <span className="block text-[8.5px] font-semibold uppercase tracking-[0.16em] text-ink-5">Fine</span>
              <span className="g-metric mt-1 block text-[12.5px] text-gold-deep">{g(p.fine_gold_mg)}<span className="text-[9.5px] text-ink-5">g</span></span>
            </span>
          </div>
          {p.selling_price_cents !== null ? (
            <span className="text-right leading-none">
              <span className="block text-[8.5px] font-semibold uppercase tracking-[0.16em] text-ink-5">LKR</span>
              <span className="g-metric mt-1 block text-[14px] font-semibold text-ink">{centsToLkr(p.selling_price_cents).toLocaleString("en-US")}</span>
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl bg-paper p-1 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07)]">
      <Skeleton className="aspect-[4/3] rounded-xl" />
      <div className="space-y-2 p-2 pt-2.5">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-8 rounded-lg" />
      </div>
    </div>
  );
}

function Chip({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-medium transition-all duration-200 ease-brand",
        active
          ? "bg-void text-paper shadow-[inset_0_0_0_1px_rgba(205,168,83,0.35),0_8px_18px_-10px_rgba(6,42,34,0.8)]"
          : "bg-paper text-ink-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)] hover:-translate-y-px hover:text-ink hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.24)]"
      )}
    >
      {children}
      {count !== undefined ? (
        <span className={cn("g-metric rounded-full px-1.5 text-[10px]", active ? "bg-paper/10 text-paper/80" : "bg-ink/[0.05] text-ink-4")}>{count.toLocaleString("en-US")}</span>
      ) : null}
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
      <div className="flex h-9 items-center rounded-lg bg-paper pl-1.5 pr-1 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12),0_1px_2px_rgba(16,32,27,0.04)] transition-shadow duration-200 focus-within:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)] hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.26)]">
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
      className="group relative w-full max-w-sm"
    >
      <span className="pointer-events-none absolute -inset-px rounded-lg bg-gradient-to-r from-gold/0 via-gold/40 to-gold/0 opacity-0 blur-sm transition-opacity duration-320 group-focus-within:opacity-100" />
      <ScanBarcodeIcon size={13} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-gold-light" />
      <input
        aria-label="Scan or type a barcode"
        placeholder="Scan or type a barcode…"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoComplete="off"
        className="relative h-8 w-full rounded-lg bg-paper/[0.07] pl-8 pr-20 font-mono text-[12.5px] text-paper shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)] ring-1 ring-paper/15 backdrop-blur transition-all placeholder:font-sans placeholder:text-paper/35 focus:bg-black/30 focus:outline-none focus:ring-gold/60"
      />
      <button type="submit" className="home-btn-gold absolute right-1 top-1 h-6 px-2.5 text-[11px]">
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
    "flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-ink transition-all shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12)] hover:-translate-y-px hover:bg-void hover:text-paper hover:shadow-none disabled:pointer-events-none disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-paper px-4 py-2 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_16px_36px_-30px_rgba(16,32,27,0.3)] sm:px-5">
      <span className="text-xs text-ink-4">
        Showing <span className="g-metric font-medium text-ink">{from}–{to}</span> of{" "}
        <span className="g-metric font-medium text-ink">{total.toLocaleString("en-US")}</span> pieces
      </span>
      <div className="flex items-center gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className={btn}>
          <ArrowLeftIcon size={12} />
          Prev
        </button>
        <span className="g-metric flex h-8 min-w-[4.5rem] items-center justify-center rounded-lg bg-bone px-3 text-xs text-ink-3">
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

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? "";
}

export default function ProductsPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [fCat, setFCat] = useState("");
  const [fPur, setFPur] = useState("");
  // Default to the shop the user is working in (the branch switcher's choice);
  // "All branches" stays available as an explicit filter choice.
  const [fBranch, setFBranch] = useState(branchDefault);
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
    queryKey: ["products-count", "all", fBranch],
    queryFn: () => api<{ rows: Product[]; total: number }>(`/api/v1/products?limit=1&page=1${fBranch ? `&branchId=${fBranch}` : ""}`),
  });
  // One `limit=1` read per quick status: the pill counts and header figures.
  const statusCounts = useQueries({
    queries: QUICK_STATUSES.map((st) => ({
      queryKey: ["products-count", st, fBranch],
      queryFn: () => api<{ rows: Product[]; total: number }>(`/api/v1/products?limit=1&page=1&status=${st}${fBranch ? `&branchId=${fBranch}` : ""}`),
    })),
  });
  const countOf = (st: string) => statusCounts[QUICK_STATUSES.indexOf(st)]?.data?.total;
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
  const stockN = countOf("IN_STOCK");
  const stockShare = allN && stockN !== undefined ? stockN / allN : null;
  const pageNet = rows.reduce((a, r) => a + r.net_mg, 0);
  const pageFine = rows.reduce((a, r) => a + r.fine_gold_mg, 0);
  const priced = rows.filter((r) => r.selling_price_cents !== null);
  const pageValue = priced.reduce((a, r) => a + (r.selling_price_cents ?? 0), 0);
  const counting = statusCounts.some((q) => q.isLoading);

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={PackageIcon}
        title="Products"
        accent="catalogue"
        badge={<HeroBadge tone="gold">{allN !== undefined ? `${allN.toLocaleString("en-US")} pieces` : "Catalogue"}</HeroBadge>}
        sub="Unique pieces with barcodes, weights and live pricing · scan to jump straight to a piece"
        actions={
          <>
            <Link href="/scan" className={heroGhost}>
              <ScanBarcodeIcon size={13} />
              Scan mode
            </Link>
            <Link href="/products/labels" className={heroGhost}>
              <PrinterIcon size={13} />
              Labels
            </Link>
            <Link href="/products/bulk" className={heroGhost}>
              <PackagePlusIcon size={13} />
              Bulk add
            </Link>
            <Link href="/products/new" className={heroGold}>
              <PlusIcon size={13} />
              New product
            </Link>
          </>
        }
        stats={[
          { label: "Pieces", value: allN, loading: allCount.isLoading, accent: true, sub: fBranch ? "this shop" : "all branches" },
          {
            label: "In stock",
            value: stockN,
            loading: counting,
            tone: "good",
            sub: stockShare !== null ? `${Math.round(stockShare * 100)}% of catalogue` : undefined,
          },
          { label: "Reserved", value: countOf("RESERVED"), loading: counting, tone: countOf("RESERVED") ? "warn" : undefined },
          { label: "Sold", value: countOf("SOLD"), loading: counting },
          { label: "In repair", value: countOf("IN_REPAIR"), loading: counting, tone: countOf("IN_REPAIR") ? "bad" : undefined, href: "/repairs" },
          { label: "In workshop", value: countOf("IN_MANUFACTURING"), loading: counting, href: "/manufacturing" },
          { label: "Categories", value: cats.data?.total, loading: cats.isLoading, href: "/categories" },
          {
            label: "Purities",
            value: purs.data?.total,
            loading: purs.isLoading,
            sub: (purs.data?.rows ?? []).map((p) => p.karat).filter(Boolean).slice(0, 4).join(" · ") || undefined,
          },
        ]}
      >
        <div className="flex flex-wrap items-center gap-3">
          <HeroScan />
          {stockShare !== null ? (
            <div className="flex min-w-[220px] flex-1 items-center gap-2.5 text-[10.5px] text-paper/45">
              <span>Catalogue mix</span>
              <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-paper/10">
                {QUICK_STATUSES.map((st) => {
                  const n = countOf(st) ?? 0;
                  return n && allN ? <div key={st} className={STATUS_DOT[st]} style={{ width: `${(n / allN) * 100}%` }} title={`${humanize(st)} · ${n}`} /> : null;
                })}
              </div>
            </div>
          ) : null}
        </div>
      </GoldHero>

      {/* Toolbar */}
      <section className="sticky top-14 z-20 -mx-1 rounded-[20px] bg-bone/80 px-1 py-1 backdrop-blur-xl">
        <div className="relative rounded-2xl bg-paper p-2.5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_18px_40px_-30px_rgba(16,32,27,0.35)]">
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <div className="group relative flex-1">
              <SearchIcon size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-5 transition-colors group-focus-within:text-gold-dark" />
              <input
                placeholder="Search name, barcode, SKU…"
                value={search}
                onChange={(e) => set(setSearch)(e.target.value)}
                className="h-9 w-full rounded-lg bg-bone/60 pl-9 pr-10 text-[13px] text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.08)] transition-all duration-200 placeholder:text-ink-5 hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)] focus:bg-paper focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)]"
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
                  "inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-[12.5px] font-medium transition-all duration-200 md:flex-none",
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
              <div className="relative flex h-9 items-center rounded-lg bg-bone p-0.5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.08)]" role="group" aria-label="View">
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-y-0.5 left-0.5 w-9 rounded-md bg-void shadow-[0_6px_14px_-6px_rgba(6,42,34,0.8)] transition-transform duration-320 ease-brand",
                    view === "table" && "translate-x-9"
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
                      "relative flex h-full w-9 items-center justify-center rounded-md transition-colors duration-200",
                      view === o.v ? "text-gold-light" : "text-ink-4 hover:text-ink"
                    )}
                  >
                    <o.icon size={15} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="scrollbar-thin -mx-1 mt-2 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5">
            <Chip active={!fStatus} onClick={() => set(setFStatus)("")} count={allN}>
              All
            </Chip>
            {QUICK_STATUSES.map((s) => (
              <Chip key={s} active={fStatus === s} onClick={() => set(setFStatus)(fStatus === s ? "" : s)} count={countOf(s)}>
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
                  "g-metric inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-[11.5px] font-semibold transition-all duration-200",
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
            <div className="mt-3 animate-fade-in border-t border-ink/[0.06] pt-3">
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
        {rows.length > 0 ? (
          <div className="flex items-center gap-3 text-[11px] text-ink-4">
            <span>
              Net <span className="g-metric font-semibold text-ink">{g(pageNet)} g</span>
            </span>
            <span>
              Fine <span className="g-metric font-semibold text-gold-deep">{g(pageFine)} g</span>
            </span>
            {priced.length ? (
              <span>
                Priced <span className="g-metric font-semibold text-ink">LKR {centsToLkr(pageValue).toLocaleString("en-US")}</span>
                <span className="text-ink-5"> · {priced.length} of {rows.length}</span>
              </span>
            ) : null}
          </div>
        ) : null}
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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {list.isLoading
            ? Array.from({ length: 10 }).map((_, i) => <CardSkeleton key={i} />)
            : rows.map((p, i) => <ProductCard key={p.id} p={p} index={i} />)}
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_18px_40px_-30px_rgba(16,32,27,0.35)]">
          <div className="scrollbar-thin overflow-x-auto">
            {list.isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 rounded-lg" />
                ))}
              </div>
            ) : (
              <table className="w-full min-w-[1040px] text-[12.5px]">
                <thead className={thead}>
                  <tr>
                    <th className={cn(th, "pl-4")}>Barcode</th>
                    <th className={th}>Category</th>
                    <th className={th}>Sub-category</th>
                    <th className={th}>Karat</th>
                    <th className={cn(th, "text-right")}>Net g</th>
                    <th className={cn(th, "text-right")}>Fine g</th>
                    <th className={cn(th, "text-right")}>Price LKR</th>
                    <th className={th}>Status</th>
                    <th className={cn(th, "pr-4")} aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={cn(tr, "group")}>
                      <td className="relative py-1.5 pl-4 pr-2">
                        <span className={cn("absolute inset-y-1.5 left-0 w-[3px] rounded-r-full", STATUS_DOT[r.status] ?? "bg-ink/20")} aria-hidden />
                        <Link href={`/products/${r.id}`} className="flex items-center gap-2.5">
                          <span className="size-9 shrink-0 overflow-hidden rounded-lg ring-1 ring-ink/[0.08]">
                            <ProductMedia p={r} className="[&_svg]:size-5" />
                          </span>
                          <span className="min-w-0 leading-tight">
                            <span className="g-metric block text-[12px] font-semibold text-gold-deep transition-colors group-hover:text-gold-dark">{r.barcode}</span>
                            <span className="g-metric block text-[10.5px] text-ink-5">{r.sku}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-2 leading-tight">
                        <span className="block max-w-[12rem] truncate font-medium text-ink">{r.category_name}</span>
                        {r.location ? <span className="block truncate text-[10.5px] text-ink-4">@ {r.location}</span> : null}
                      </td>
                      <td className="px-2">
                        <span className="block max-w-[10rem] truncate text-ink-3">{r.subcategory_name ?? "—"}</span>
                      </td>
                      <td className="px-2">
                        <span className="g-metric rounded bg-gradient-to-b from-gold-light to-gold px-1.5 py-px text-[10px] font-bold text-void">{r.karat}</span>
                      </td>
                      <td className="g-metric px-2 text-right text-ink-2">{g(r.net_mg)}</td>
                      <td className="g-metric px-2 text-right text-gold-deep">{g(r.fine_gold_mg)}</td>
                      <td className="g-metric px-2 text-right font-semibold text-ink">
                        {r.selling_price_cents !== null ? (
                          centsToLkr(r.selling_price_cents).toLocaleString("en-US")
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gold-pale px-1.5 py-px font-sans text-[10px] font-semibold text-gold-deep">
                            <span className="size-1.5 rounded-full bg-gold" />
                            Live
                          </span>
                        )}
                      </td>
                      <td className="px-2">
                        <StatusChip status={r.status} />
                      </td>
                      <td className="py-1.5 pl-2 pr-4 text-right">
                        <Link
                          href={`/products/${r.id}`}
                          aria-label={`Open ${r.barcode}`}
                          className="inline-flex size-7 items-center justify-center rounded-full text-ink-5 ring-1 ring-inset ring-ink/10 transition-all group-hover:bg-void group-hover:text-gold-light group-hover:ring-0"
                        >
                          <ArrowRightIcon size={12} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-ink/10 bg-bone/50 text-[12px] font-semibold">
                    <td className="py-2 pl-4 pr-2 text-ink-3" colSpan={3}>
                      Page total · {rows.length} pieces
                    </td>
                    <td className="g-metric px-2 text-right text-ink">{g(pageNet)}</td>
                    <td className="g-metric px-2 text-right text-gold-deep">{g(pageFine)}</td>
                    <td className="g-metric px-2 text-right text-ink">{priced.length ? centsToLkr(pageValue).toLocaleString("en-US") : "—"}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
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
