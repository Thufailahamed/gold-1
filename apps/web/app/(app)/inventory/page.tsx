"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { centsToLkr, hasPermission, mgToG } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { Page, Pager } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  Building2Icon,
  ClipboardCheckIcon,
  HistoryIcon,
  PackageIcon,
  RefreshCwIcon,
  ScanBarcodeIcon,
  TagsIcon,
  TruckIcon,
} from "@/components/icons";
import { AttentionCard, MovementFilters, PieceDetail, StockByBranch, StockByKarat } from "./panels";
import { MovementComposer } from "./movement-composer";
import { MovementTypeIcon, humanize, type CategoryCount, type Insights, type Movement, type Piece, type StockRow } from "./columns";
import {
  Card,
  CardHead,
  Empty,
  FilterPills,
  GoldHero,
  HeroBadge,
  PieceChip,
  RowsSkeleton,
  ShareBar,
  ago,
  heroGhost,
  heroGold,
  th,
  thead,
  tr,
} from "./kit";

type GroupBy = "branch" | "purity" | "product" | "category";
const GROUP_NOUN: Record<GroupBy, [string, string]> = {
  branch: ["branch", "branches"],
  purity: ["purity", "purities"],
  product: ["piece", "pieces"],
  category: ["category", "categories"],
};

const g = (mg: number) => mgToG(mg).toLocaleString("en-US", { maximumFractionDigits: 3 });
const lkr = (cents: number) => centsToLkr(cents).toLocaleString("en-US", { maximumFractionDigits: 0 });

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function InventoryPage() {
  const [groupBy, setGroupBy] = useState<GroupBy>("branch");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | undefined>(undefined);

  const [barcode, setBarcode] = useState("");
  const [detail, setDetail] = useState<Piece | null>(null);
  const [mType, setMType] = useState("");
  const [mBranch, setMBranch] = useState("");
  const [mSearch, setMSearch] = useState("");
  const [mPage, setMPage] = useState(1);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const [today, setToday] = useState("");
  // Render the date after mount so server and client timezones cannot disagree.
  useEffect(() => {
    setToday(new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }));
  }, []);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canView = hasPermission(me.data?.permissions ?? [], "products:view");

  const insights = useQuery({
    queryKey: ["inventory", "insights"],
    queryFn: () => api<Insights>("/api/v1/inventory/insights"),
    enabled: canView,
    staleTime: 60_000,
    retry: false,
  });

  const stock = useQuery({
    queryKey: ["stock", groupBy, category],
    queryFn: () => api<StockRow[]>(`/api/v1/inventory/stock?groupBy=${groupBy}${category ? `&categoryId=${encodeURIComponent(category)}` : ""}`),
    enabled: canView,
  });

  // Pieces on hand per category. Shared by every grouping, so it is fetched once
  // and only the table below narrows to the chosen category.
  const categories = useQuery({
    queryKey: ["stock", "categories"],
    queryFn: () => api<CategoryCount[]>("/api/v1/inventory/stock/categories"),
    enabled: canView,
  });
  const categoryTotal = (categories.data ?? []).reduce((s, c) => s + c.pieces, 0);
  const categoryName = categories.data?.find((c) => c.id === category)?.name ?? "this category";

  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () => api<{ rows: Array<{ id: string; name: string }>; total: number }>("/api/v1/branches?limit=100"),
    staleTime: 60_000,
  });
  const purities = useQuery({
    queryKey: ["purities-all"],
    queryFn: () => api<{ rows: Array<{ id: string; karat: string }>; total: number }>("/api/v1/masters/purities?limit=100"),
    staleTime: 60_000,
  });
  const branchName = (id: string | null) => (id ? branches.data?.rows.find((b) => b.id === id)?.name ?? id.slice(0, 8) : "—");

  const nameFor = useMemo(() => {
    const bNames = new Map((branches.data?.rows ?? []).map((b) => [b.id, b.name]));
    const pKarat = new Map((purities.data?.rows ?? []).map((p) => [p.id, p.karat]));
    return (row: StockRow): string =>
      groupBy === "branch"
        ? bNames.get(row.key) ?? row.name ?? row.key.slice(0, 8)
        : groupBy === "purity"
          ? pKarat.get(row.key) ?? row.name ?? row.key.slice(0, 8)
          : row.name ?? "Unnamed piece";
  }, [groupBy, branches.data, purities.data]);

  const mSearchDebounced = useDebounced(mSearch);
  const moves = useQuery({
    queryKey: ["moves", mPage, mType, mBranch, mSearchDebounced],
    queryFn: () => {
      const q = new URLSearchParams({ limit: "25", page: String(mPage) });
      if (mType) q.set("type", mType);
      if (mBranch) q.set("branchId", mBranch);
      if (mSearchDebounced.trim()) q.set("search", mSearchDebounced.trim());
      return api<{ rows: Movement[]; total: number }>(`/api/v1/inventory/movements?${q}`);
    },
    enabled: canView,
  });

  const rows = useMemo(() => {
    const base = stock.data ?? [];
    if (!sort) return base;
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (r: StockRow): number | string => (sort.key === "name" ? nameFor(r) : sort.key === "value_cents" ? r.value_cents ?? -1 : r[sort.key]);
    return [...base].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [stock.data, sort, nameFor]);

  const totals = useMemo(() => {
    const base = stock.data ?? [];
    return {
      pieces: base.reduce((s, r) => s + r.pieces, 0),
      net: base.reduce((s, r) => s + r.net_mg, 0),
      fine: base.reduce((s, r) => s + r.fine_mg, 0),
      value: base.reduce((s, r) => s + (r.value_cents ?? 0), 0),
    };
  }, [stock.data]);

  function onSort(key: SortKey) {
    setSort((s) => (s?.key === key ? (s.dir === "desc" ? { key, dir: "asc" } : undefined) : { key, dir: "desc" }));
  }

  // The stock row key is a branch, purity or product id depending on the
  // grouping. Only the product grouping yields a fetchable product id.
  async function openPiece(key: string) {
    try {
      setDetail(await api<Piece>(`/api/v1/products/${encodeURIComponent(key)}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the piece");
    }
  }

  function focusMovement(code: string) {
    setDetail(null);
    setBarcode(code);
    document.getElementById("record-movement")?.scrollIntoView({ behavior: "smooth" });
    window.setTimeout(() => barcodeRef.current?.focus(), 300);
  }

  function focusHistory(type: string) {
    setMType(type);
    setMPage(1);
    document.getElementById("movement-history")?.scrollIntoView({ behavior: "smooth" });
  }

  const insightsError = insights.isError ? (insights.error as Error).message : undefined;
  const t = insights.data?.totals;
  const a = insights.data?.attention;
  // An error must not render as "0 pieces": that reads as a real, wrong number.
  const dash = insights.isLoading || !!insightsError;
  const hasValue = (t?.value_cents ?? 0) > 0;
  const avgPurity = t && t.net_mg > 0 ? (t.fine_mg / t.net_mg) * 100 : 0;
  const perGram = t && hasValue && t.fine_mg > 0 ? centsToLkr(t.value_cents) / mgToG(t.fine_mg) : 0;
  const openItems = (a?.transfer_pending ?? 0) + (a?.in_repair ?? 0) + (a?.reserved ?? 0);
  const v = (n: number | undefined) => (dash ? null : n ?? 0);

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={PackageIcon}
        title="Every gram,"
        accent="accounted for"
        badge={
          insightsError ? (
            <HeroBadge tone="bad">Data unavailable</HeroBadge>
          ) : a ? (
            openItems > 0 ? (
              <HeroBadge tone="warn">{openItems} off the shelf</HeroBadge>
            ) : (
              <HeroBadge tone="good">All clear</HeroBadge>
            )
          ) : (
            <HeroBadge>Inventory</HeroBadge>
          )
        }
        sub={
          insightsError ? (
            <span className="inline-flex items-center gap-2">
              {insightsError}
              <button type="button" onClick={() => void insights.refetch()} className="inline-flex items-center gap-1 text-gold-light hover:text-paper">
                <RefreshCwIcon size={10} /> Retry
              </button>
            </span>
          ) : (
            <>
              {today ? `${today} · ` : ""}Live weights, fine gold and value across every branch
            </>
          )
        }
        actions={
          <>
            <Link href="/scan" className={heroGold}>
              <ScanBarcodeIcon size={13} /> Scan to move
            </Link>
            <button type="button" onClick={() => document.getElementById("record-movement")?.scrollIntoView({ behavior: "smooth" })} className={heroGhost}>
              Record movement
            </button>
            <Link href="/inventory/counts" className={heroGhost}>
              <ClipboardCheckIcon size={13} /> Counts
            </Link>
            <Link href="/inventory/transfers" className={heroGhost}>
              <TruckIcon size={13} /> Transfers
            </Link>
            <Link href="/inventory/discrepancies" className={heroGhost}>
              <AlertCircleIcon size={13} /> Discrepancies
            </Link>
          </>
        }
        stats={[
          { label: "Pieces on hand", value: v(t?.pieces), sub: dash ? undefined : `${insights.data?.byBranch.length ?? 0} branches`, loading: insights.isLoading },
          { label: "Net weight", value: v(t?.net_mg), format: g, unit: "g", sub: dash ? undefined : `${insights.data?.byKarat.length ?? 0} purities`, loading: insights.isLoading },
          {
            label: "Fine gold",
            value: v(t?.fine_mg),
            format: g,
            unit: "g",
            accent: true,
            sub: dash || !avgPurity ? undefined : `${avgPurity.toFixed(1)}% average purity`,
            loading: insights.isLoading,
          },
          {
            label: "Stock value",
            value: dash ? null : hasValue ? centsToLkr(t!.value_cents) : null,
            text: !dash && !hasValue ? "Not priced" : undefined,
            format: (n) => Math.round(n).toLocaleString("en-US"),
            unit: hasValue ? "LKR" : undefined,
            sub: dash ? undefined : hasValue ? `≈ LKR ${Math.round(perGram).toLocaleString("en-US")} / g fine` : "Set board rates",
            href: hasValue ? undefined : "/gold-rates",
            loading: insights.isLoading,
          },
          {
            label: "In transit",
            value: v(a?.transfer_pending),
            tone: a?.transfer_pending ? "warn" : undefined,
            sub: "Between branches",
            href: "/inventory/transfers",
            loading: insights.isLoading,
          },
          { label: "In repair", value: v(a?.in_repair), sub: "At the workshop", href: "/products?status=IN_REPAIR", loading: insights.isLoading },
          { label: "Reserved", value: v(a?.reserved), sub: "Held for customers", href: "/products?status=RESERVED", loading: insights.isLoading },
          {
            label: "Moves · 24h",
            value: v(a?.movements_24h),
            sub: dash ? undefined : a?.last_movement_at ? `Last ${ago(a.last_movement_at)}` : "None logged yet",
            loading: insights.isLoading,
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <StockByKarat data={insights.data} loading={insights.isLoading} error={insightsError} onRetry={() => void insights.refetch()} />
        <StockByBranch data={insights.data} loading={insights.isLoading} error={insightsError} onRetry={() => void insights.refetch()} />
        <AttentionCard data={insights.data} loading={insights.isLoading} error={insightsError} onRetry={() => void insights.refetch()} onFilter={focusHistory} />
      </div>

      <Card>
        <CardHead
          icon={PackageIcon}
          title="Stock on hand"
          sub={
            stock.data
              ? category
                ? `${totals.pieces.toLocaleString("en-US")} ${totals.pieces === 1 ? "piece" : "pieces"} in ${categoryName}`
                : `${rows.length.toLocaleString("en-US")} ${GROUP_NOUN[groupBy][rows.length === 1 ? 0 : 1]}${groupBy === "product" ? " · click a row for details" : ""}`
              : `Grouped by ${groupBy}`
          }
          action={
            <FilterPills
              items={[
                { key: "branch" as const, label: "By branch" },
                { key: "purity" as const, label: "By purity" },
                { key: "category" as const, label: "By category" },
                { key: "product" as const, label: "By product" },
              ]}
              value={groupBy}
              onChange={(k) => {
                setGroupBy(k);
                setSort(undefined);
              }}
            />
          }
        />
        {categories.data && categories.data.length > 0 ? (
          <CategoryPills items={categories.data} total={categoryTotal} value={category} onChange={setCategory} />
        ) : null}
        <StockTable
          rows={rows}
          groupBy={groupBy}
          nameFor={nameFor}
          sort={sort}
          onSort={onSort}
          loading={stock.isLoading}
          totals={totals}
          onRowClick={groupBy === "product" ? (r) => void openPiece(r.key) : undefined}
        />
      </Card>

      <MovementComposer barcode={barcode} onBarcode={setBarcode} inputRef={barcodeRef} branchName={(id) => branchName(id)} />

      <div id="movement-history" className="scroll-mt-24">
        <Card>
          <CardHead
            icon={HistoryIcon}
            title="Movement history"
            sub={
              moves.data
                ? `${moves.data.total.toLocaleString("en-US")} ${mType ? humanize(mType).toLowerCase() : ""} movements${mBranch ? ` at ${branchName(mBranch)}` : ""}`.replace(/\s+/g, " ")
                : "Latest movements"
            }
          />
          <MovementFilters
            type={mType}
            branch={mBranch}
            search={mSearch}
            onType={(x) => {
              setMType(x);
              setMPage(1);
            }}
            onBranch={(b) => {
              setMBranch(b);
              setMPage(1);
            }}
            onSearch={(s) => {
              setMSearch(s);
              setMPage(1);
            }}
            onClear={() => {
              setMType("");
              setMBranch("");
              setMSearch("");
              setMPage(1);
            }}
            branches={branches.data?.rows ?? []}
          />
          <MovementTable rows={moves.data?.rows ?? []} loading={moves.isLoading} branchName={branchName} />
          {moves.data && moves.data.total > 0 ? (
            <div className="border-t border-ink/20 bg-bone/40 px-4 py-2 text-xs text-ink-4">
              <Pager page={mPage} onChange={setMPage} pageSize={25} count={moves.data.rows.length} total={moves.data.total} unit="movements" />
            </div>
          ) : null}
        </Card>
      </div>

      {detail ? <PieceDetail piece={detail} onClose={() => setDetail(null)} onMove={focusMovement} branchName={(id) => branchName(id)} /> : null}
    </Page>
  );
}

/* ---------------------------------------------------------------- filters */

/** Category filter: "All" plus one pill per category with pieces on hand. Click again to clear. */
function CategoryPills({ items, total, value, onChange }: { items: CategoryCount[]; total: number; value: string; onChange: (id: string) => void }) {
  const options: CategoryCount[] = [{ id: "", name: "All", pieces: total }, ...items];
  return (
    <div role="group" aria-label="Filter by category" className="flex gap-1.5 overflow-x-auto border-b border-ink/20 px-4 py-2.5 scrollbar-thin">
      {options.map((c) => {
        const on = value === c.id;
        return (
          <button
            key={c.id || "all"}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? "" : c.id)}
            className={cn(
              "g-metric inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold transition-all duration-200",
              on
                ? "bg-gradient-to-b from-gold-light to-gold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_8px_18px_-10px_rgba(205,168,83,0.8)]"
                : "bg-gold-pale text-gold-deep ring-1 ring-gold-dark/15 hover:-translate-y-px hover:ring-gold-dark/40"
            )}
          >
            {c.name}
            <span className={cn("text-[10.5px] font-medium tabular-nums", on ? "text-void/70" : "text-gold-dark/70")}>{c.pieces.toLocaleString("en-US")}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- tables */

type SortKey = "name" | "pieces" | "net_mg" | "fine_mg" | "value_cents";

function SortTh({
  k,
  label,
  sort,
  onSort,
  right,
  className,
}: {
  k: SortKey;
  label: string;
  sort?: { key: SortKey; dir: "asc" | "desc" };
  onSort: (k: SortKey) => void;
  right?: boolean;
  className?: string;
}) {
  const on = sort?.key === k;
  return (
    <th className={cn(th, right && "text-right", className)} aria-sort={on ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 uppercase hover:text-ink", right && "flex-row-reverse", on && "text-ink")}>
        {label}
        <span className={cn("text-[8px]", on ? "text-gold-dark" : "text-ink-5/60")}>{on && sort!.dir === "asc" ? "▲" : "▼"}</span>
      </button>
    </th>
  );
}

function StockTable({
  rows,
  groupBy,
  nameFor,
  sort,
  onSort,
  loading,
  totals,
  onRowClick,
}: {
  rows: StockRow[];
  groupBy: GroupBy;
  nameFor: (r: StockRow) => string;
  sort?: { key: SortKey; dir: "asc" | "desc" };
  onSort: (k: SortKey) => void;
  loading: boolean;
  totals: { pieces: number; net: number; fine: number; value: number };
  onRowClick?: (r: StockRow) => void;
}) {
  if (loading) return <RowsSkeleton rows={5} />;
  if (rows.length === 0)
    return (
      <Empty
        icon={PackageIcon}
        title="No stock on hand"
        desc="No pieces are in stock for this grouping."
        action={
          <Link href="/products" className="g-btn g-btn-primary h-8 rounded-lg px-3 text-[12px]">
            Open catalog
          </Link>
        }
      />
    );
  const first = groupBy === "branch" ? "Branch" : groupBy === "purity" ? "Purity" : groupBy === "category" ? "Category" : "Product";
  return (
    <div className="max-h-[30rem] overflow-auto scrollbar-thin">
      <table className="w-full text-[12.5px]">
        <thead className={cn(thead, "sticky top-0 z-10 backdrop-blur")}>
          <tr>
            <SortTh k="name" label={first} sort={sort} onSort={onSort} className="pl-4" />
            <SortTh k="pieces" label="Pieces" sort={sort} onSort={onSort} right />
            <SortTh k="net_mg" label="Net g" sort={sort} onSort={onSort} right />
            <SortTh k="fine_mg" label="Fine g" sort={sort} onSort={onSort} right />
            <th className={cn(th, "hidden text-right md:table-cell")}>Purity</th>
            <th className={cn(th, "hidden md:table-cell")}>Share of fine</th>
            <SortTh k="value_cents" label="Value LKR" sort={sort} onSort={onSort} right className="pr-4" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const purity = r.net_mg > 0 ? (r.fine_mg / r.net_mg) * 100 : 0;
            const share = totals.fine > 0 ? (r.fine_mg / totals.fine) * 100 : 0;
            return (
              <tr key={r.key} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cn(tr, onRowClick && "cursor-pointer")}>
                <td className="py-1.5 pl-4 pr-2">
                  {groupBy === "purity" ? (
                    <span className="g-metric rounded-md bg-gold-pale px-1.5 py-px text-[11px] font-semibold text-gold-deep ring-1 ring-gold-dark/15">{nameFor(r)}</span>
                  ) : groupBy === "branch" ? (
                    <span className="flex items-center gap-2">
                      <Building2Icon size={12} className="shrink-0 text-ink-5" />
                      <span className="font-medium text-ink">{nameFor(r)}</span>
                    </span>
                  ) : groupBy === "category" ? (
                    <span className="flex items-center gap-2">
                      <TagsIcon size={12} className="shrink-0 text-ink-5" />
                      <span className="font-medium text-ink">{nameFor(r)}</span>
                    </span>
                  ) : (
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium text-ink">{nameFor(r)}</span>
                      <span className="shrink-0 font-mono text-[10.5px] text-ink-5">{r.barcode ?? r.key.slice(0, 10)}</span>
                    </span>
                  )}
                </td>
                <td className="g-metric px-2 py-1.5 text-right text-ink-3">{r.pieces.toLocaleString("en-US")}</td>
                <td className="g-metric px-2 py-1.5 text-right text-ink-3">{g(r.net_mg)}</td>
                <td className="g-metric px-2 py-1.5 text-right font-medium text-ink">{g(r.fine_mg)}</td>
                <td className="g-metric hidden px-2 py-1.5 text-right text-ink-4 md:table-cell">{purity ? `${purity.toFixed(1)}%` : "—"}</td>
                <td className="hidden px-2 py-1.5 md:table-cell">
                  <span className="flex items-center gap-2">
                    <ShareBar value={share} className="h-1 w-24" />
                    <span className="g-metric text-[10.5px] text-ink-5">{share.toFixed(1)}%</span>
                  </span>
                </td>
                <td className="g-metric py-1.5 pl-2 pr-4 text-right text-ink-2">
                  {r.value_cents ? lkr(r.value_cents) : <span className="text-ink-5" title="No board rate for this purity">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="sticky bottom-0 bg-bone/90 backdrop-blur">
          <tr className="border-t border-ink/20 text-[12px] font-semibold">
            <td className="py-1.5 pl-4 pr-2 text-[9.5px] uppercase tracking-[0.14em] text-gold-dark">Total</td>
            <td className="g-metric px-2 py-1.5 text-right text-ink">{totals.pieces.toLocaleString("en-US")}</td>
            <td className="g-metric px-2 py-1.5 text-right text-ink">{g(totals.net)}</td>
            <td className="g-metric px-2 py-1.5 text-right text-gold-deep">{g(totals.fine)}</td>
            <td className="g-metric hidden px-2 py-1.5 text-right text-ink-4 md:table-cell">{totals.net > 0 ? `${((totals.fine / totals.net) * 100).toFixed(1)}%` : "—"}</td>
            <td className="hidden md:table-cell" />
            <td className="g-metric py-1.5 pl-2 pr-4 text-right text-ink">{totals.value ? lkr(totals.value) : "—"}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function MovementTable({ rows, loading, branchName }: { rows: Movement[]; loading: boolean; branchName: (id: string | null) => string }) {
  if (loading) return <RowsSkeleton rows={6} />;
  if (rows.length === 0) return <Empty icon={HistoryIcon} title="No movements" desc="Nothing matches these filters. Clear them to see the full ledger." />;
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-[12.5px]">
        <thead className={thead}>
          <tr>
            <th className={cn(th, "pl-4")}>Type</th>
            <th className={th}>Barcode</th>
            <th className={th}>From → to</th>
            <th className={th}>Branch</th>
            <th className={cn(th, "text-right")}>Weight g</th>
            <th className={cn(th, "hidden lg:table-cell")}>Reason</th>
            <th className={cn(th, "pr-4 text-right")}>When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} className={tr}>
              <td className="py-1.5 pl-4 pr-2">
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <span className="scale-[0.85]">
                    <MovementTypeIcon type={m.type} />
                  </span>
                  <span className="text-[12px] font-medium text-ink">{humanize(m.type)}</span>
                </span>
              </td>
              <td className="px-2 py-1.5">
                <span className="rounded bg-bone px-1.5 py-px font-mono text-[10.5px] text-ink-2 ring-1 ring-ink/20">{m.barcode ?? m.product_id.slice(0, 8)}</span>
              </td>
              <td className="px-2 py-1.5">
                <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-ink-4">
                  {m.from_status ? humanize(m.from_status) : "New"}
                  <ArrowRightIcon size={10} className="text-ink-5" />
                  <PieceChip status={m.to_status} />
                </span>
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-[11.5px] text-ink-3">{branchName(m.to_branch ?? m.from_branch)}</td>
              <td className="g-metric px-2 py-1.5 text-right text-ink">{g(m.weight_mg)}</td>
              <td className="hidden max-w-[16rem] px-2 py-1.5 lg:table-cell">
                {m.reason ? (
                  <span className="line-clamp-1 text-[11.5px] text-ink-3" title={m.reason}>
                    {m.reason}
                  </span>
                ) : (
                  <span className="text-ink-5">—</span>
                )}
              </td>
              <td className="whitespace-nowrap py-1.5 pl-2 pr-4 text-right text-[11px] text-ink-4" title={new Date(m.created_at).toLocaleString()}>
                {new Date(m.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
