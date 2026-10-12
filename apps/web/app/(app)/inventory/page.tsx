"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { centsToLkr, hasPermission, mgToG } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { DataTable, EmptyBlock, Page, Pager, type DataColumn } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  Building2Icon,
  ClipboardCheckIcon,
  GemIcon,
  TruckIcon,
  HistoryIcon,
  PackageIcon,
} from "@/components/icons";
import {
  AttentionCard,
  InventoryHero,
  MovementFilters,
  PieceDetail,
  StockByBranch,
  StockByKarat,
} from "./panels";
import { MovementComposer } from "./movement-composer";
import {
  humanize,
  movementColumns,
  stockColumns,
  type Insights,
  type Movement,
  type Piece,
  type StockRow,
} from "./columns";

const GROUP_LABEL: Record<"branch" | "purity" | "product", string> = {
  branch: "branch",
  purity: "purity",
  product: "product",
};

const GROUP_NOUN: Record<"branch" | "purity" | "product", [string, string]> = {
  branch: ["branch", "branches"],
  purity: ["purity", "purities"],
  product: ["piece", "pieces"],
};

const g = (mg: number) => mgToG(mg).toLocaleString("en-US", { maximumFractionDigits: 3 });

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function InventoryPage() {
  const [groupBy, setGroupBy] = useState<"branch" | "purity" | "product">("branch");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | undefined>(undefined);

  const [barcode, setBarcode] = useState("");
  const [detail, setDetail] = useState<Piece | null>(null);
  const [mType, setMType] = useState("");
  const [mBranch, setMBranch] = useState("");
  const [mSearch, setMSearch] = useState("");
  const [mPage, setMPage] = useState(1);
  const barcodeRef = useRef<HTMLInputElement>(null);

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
    queryKey: ["stock", groupBy],
    queryFn: () => api<StockRow[]>(`/api/v1/inventory/stock?groupBy=${groupBy}`),
    enabled: canView,
  });

  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () =>
      api<{ rows: Array<{ id: string; name: string }>; total: number }>(
        "/api/v1/branches?limit=100"
      ),
    staleTime: 60_000,
  });
  const purities = useQuery({
    queryKey: ["purities-all"],
    queryFn: () =>
      api<{ rows: Array<{ id: string; karat: string }>; total: number }>(
        "/api/v1/masters/purities?limit=100"
      ),
    staleTime: 60_000,
  });
  const labelFor = useMemo(() => {
    const bNames = new Map((branches.data?.rows ?? []).map((b) => [b.id, b.name]));
    const pKarat = new Map((purities.data?.rows ?? []).map((p) => [p.id, p.karat]));
    return (row: StockRow): ReactNode => {
      const key = row.key;
      if (groupBy === "branch")
        return (
          <span className="flex items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-bone text-ink-4 ring-1 ring-ink/[0.06]">
              <Building2Icon size={13} />
            </span>
            <span className="font-medium text-ink">{bNames.get(key) ?? row.name ?? key.slice(0, 8)}</span>
          </span>
        );
      if (groupBy === "purity")
        return (
          <span className="g-metric rounded-md bg-gold-pale px-2 py-0.5 text-xs font-semibold text-gold-deep ring-1 ring-gold-dark/15">
            {pKarat.get(key) ?? row.name ?? key.slice(0, 8)}
          </span>
        );
      return (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-ink">{row.name ?? "Unnamed piece"}</span>
          <span className="block font-mono text-[11px] text-ink-4">{row.barcode ?? key.slice(0, 10)}</span>
        </span>
      );
    };
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

  const columns = useMemo(() => stockColumns(groupBy, labelFor), [groupBy, labelFor]);

  const rows = useMemo(() => {
    const base = stock.data ?? [];
    if (!sort) return base;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.value) return base;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => {
      const av = col.value!(a);
      const bv = col.value!(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [stock.data, sort, columns]);

  const totals = useMemo(() => {
    const base = stock.data ?? [];
    return {
      pieces: base.reduce((s, r) => s + r.pieces, 0),
      net: base.reduce((s, r) => s + r.net_mg, 0),
      fine: base.reduce((s, r) => s + r.fine_mg, 0),
      value: base.reduce((s, r) => s + (r.value_cents ?? 0), 0),
      hasValue: base.some((r) => (r.value_cents ?? 0) > 0),
    };
  }, [stock.data]);

  const moveCols = useMemo(
    () =>
      movementColumns(
        (id) =>
          branches.data?.rows.find((b) => b.id === id)?.name ?? (id ? id.slice(0, 8) : "—")
      ),
    [branches.data]
  );

  function onSort(key: string) {
    setSort((s) =>
      s?.key === key
        ? s.dir === "asc"
          ? { key, dir: "desc" }
          : undefined
        : { key, dir: "desc" }
    );
  }

  // The stock row key is a branch id, purity id or product id depending on the
  // grouping. Only the product grouping yields a fetchable product id.
  async function openPiece(key: string) {
    try {
      const piece = await api<Piece>(`/api/v1/products/${encodeURIComponent(key)}`);
      setDetail(piece);
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

  return (
    <Page className="space-y-6">
      <InventoryHero
        insights={insights.data}
        loading={insights.isLoading}
        error={insightsError}
        onRecord={() =>
          document.getElementById("record-movement")?.scrollIntoView({ behavior: "smooth" })
        }
      />

      <WorkflowLinks />

      <div className="grid gap-5 lg:grid-cols-3">
        <StockByKarat
          data={insights.data}
          loading={insights.isLoading}
          error={insightsError}
          onRetry={() => void insights.refetch()}
        />
        <StockByBranch
          data={insights.data}
          loading={insights.isLoading}
          error={insightsError}
          onRetry={() => void insights.refetch()}
        />
        <AttentionCard
          data={insights.data}
          loading={insights.isLoading}
          error={insightsError}
          onRetry={() => void insights.refetch()}
          onFilter={focusHistory}
        />
      </div>

      <LuxeTableCard
        title="Stock on hand"
        description={
          stock.data
            ? `${rows.length.toLocaleString("en-US")} ${GROUP_NOUN[groupBy][rows.length === 1 ? 0 : 1]} in stock${
                groupBy === "product" ? " · click a row for details" : ""
              }`
            : `Grouped by ${GROUP_LABEL[groupBy]}`
        }
        icon={<PackageIcon size={16} />}
        toolbar={
          <Segmented
            ariaLabel="Group stock by"
            items={[
              { key: "branch" as const, label: "By branch", icon: <Building2Icon size={15} /> },
              { key: "purity" as const, label: "By purity", icon: <GemIcon size={15} /> },
              { key: "product" as const, label: "By product", icon: <PackageIcon size={15} /> },
            ]}
            value={groupBy}
            onChange={setGroupBy}
          />
        }
      >
        <StockTableBody
          rows={rows}
          columns={columns}
          sort={sort}
          onSort={onSort}
          loading={stock.isLoading}
          totals={totals}
          onRowClick={groupBy === "product" ? (r) => void openPiece(r.key) : undefined}
        />
      </LuxeTableCard>

      <MovementComposer
        barcode={barcode}
        onBarcode={setBarcode}
        inputRef={barcodeRef}
        branchName={(id) => branches.data?.rows.find((b) => b.id === id)?.name ?? id.slice(0, 8)}
      />

      <div id="movement-history" className="scroll-mt-24">
        <LuxeTableCard
          title="Movement history"
          description={
            moves.data
              ? `${moves.data.total.toLocaleString("en-US")} ${mType ? humanize(mType).toLowerCase() : ""} movements${
                  mBranch ? ` at ${branches.data?.rows.find((b) => b.id === mBranch)?.name ?? "this branch"}` : ""
                }`.replace(/\s+/g, " ")
              : "Latest movements"
          }
          icon={<HistoryIcon size={16} />}
          toolbar={
            <MovementFilters
              type={mType}
              branch={mBranch}
              search={mSearch}
              onType={(t) => {
                setMType(t);
                setMPage(1);
              }}
              onBranch={(b) => {
                setMBranch(b);
                setMPage(1);
              }}
              onSearch={setMSearch}
              onClear={() => {
                setMType("");
                setMBranch("");
                setMSearch("");
                setMPage(1);
              }}
              branches={branches.data?.rows ?? []}
            />
          }
          footer={
            moves.data ? (
              <Pager
                page={mPage}
                onChange={setMPage}
                pageSize={25}
                count={moves.data.rows.length}
                total={moves.data.total}
                unit="movements"
              />
            ) : null
          }
        >
          <DataTable
            columns={moveCols}
            rows={moves.data?.rows ?? []}
            rowKey={(m) => m.id}
            loading={moves.isLoading}
            caption="Inventory movement history"
            empty={
              <EmptyBlock
                title="No movements"
                description="Nothing matches these filters. Clear them to see the full ledger."
              />
            }
          />
        </LuxeTableCard>
      </div>

      {detail ? (
        <PieceDetail
          piece={detail}
          onClose={() => setDetail(null)}
          onMove={focusMovement}
          branchName={(id) => branches.data?.rows.find((b) => b.id === id)?.name ?? id.slice(0, 8)}
        />
      ) : null}
    </Page>
  );
}

function StockTableBody({
  rows,
  columns,
  sort,
  onSort,
  loading,
  totals,
  onRowClick,
}: {
  rows: StockRow[];
  columns: ReadonlyArray<DataColumn<StockRow>>;
  sort: { key: string; dir: "asc" | "desc" } | undefined;
  onSort: (key: string) => void;
  loading: boolean;
  totals: { pieces: number; net: number; fine: number; value: number; hasValue: boolean };
  onRowClick?: (r: StockRow) => void;
}) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      sort={sort}
      onSort={onSort}
      onRowClick={onRowClick}
      loading={loading}
      caption="Stock on hand, grouped"
      empty={
        <EmptyBlock
          title="No stock on hand"
          description="No pieces are in stock for this grouping."
          action={
            <Link href="/products" className="g-btn g-btn-primary h-10 px-4 text-sm">
              Open catalog
            </Link>
          }
        />
      }
      totals={
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-4">
          <span className="mr-1 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-dark">
            <span className="size-1.5 rounded-full bg-gold" />
            Total
          </span>
          {[
            ["Pieces", totals.pieces.toLocaleString("en-US"), false],
            ["Net", `${g(totals.net)} g`, false],
            ["Fine", `${g(totals.fine)} g`, true],
            [
              "Value",
              totals.hasValue
                ? `LKR ${centsToLkr(totals.value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
                : "—",
              false,
            ],
          ].map(([k, v, gold]) => (
            <span
              key={String(k)}
              className={cn(
                "inline-flex items-baseline gap-1.5 rounded-lg px-2.5 py-1.5 ring-1",
                gold ? "bg-gold-pale text-gold-deep ring-gold-dark/15" : "bg-paper ring-ink/[0.07]"
              )}
            >
              {k}
              <span className={cn("g-metric text-sm", gold ? "text-gold-deep" : "text-ink")}>{v}</span>
            </span>
          ))}
        </div>
      }
    />
  );
}

const WORKFLOWS = [
  {
    href: "/inventory/counts",
    title: "Stock counts",
    body: "Scan the shelf against a frozen snapshot; approve write-offs with a second person.",
    icon: ClipboardCheckIcon,
  },
  {
    href: "/inventory/transfers",
    title: "Branch transfers",
    body: "Request, approve, dispatch and receive pieces between branches by scan.",
    icon: TruckIcon,
  },
  {
    href: "/inventory/discrepancies",
    title: "Discrepancies",
    body: "Missing and unexpected pieces, overdue transfers and gold consistency.",
    icon: AlertCircleIcon,
  },
] as const;

function WorkflowLinks() {
  return (
    <nav aria-label="Inventory workflows" className="grid gap-4 sm:grid-cols-3">
      {WORKFLOWS.map(({ href, title, body, icon: Icon }, i) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "group relative flex animate-fade-in flex-col overflow-hidden rounded-[22px] bg-paper p-5 transition-all duration-320 ease-brand",
            "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]",
            "hover:-translate-y-1 hover:shadow-[inset_0_0_0_1px_rgba(168,138,62,0.4),0_30px_60px_-30px_rgba(126,98,35,0.45)]"
          )}
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent opacity-0 transition-opacity duration-320 group-hover:opacity-100"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -right-14 -top-14 size-36 rounded-full bg-gold/10 opacity-0 blur-2xl transition-opacity duration-320 group-hover:opacity-100"
          />
          <span className="relative flex items-center justify-between">
            <span className="flex size-11 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_10px_20px_-12px_rgba(6,42,34,0.8)] transition-transform duration-320 group-hover:scale-105">
              <Icon size={18} />
            </span>
            <span className="flex size-8 items-center justify-center rounded-full text-ink-5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)] transition-all duration-320 group-hover:bg-gradient-to-b group-hover:from-gold-light group-hover:to-gold group-hover:text-void group-hover:shadow-none">
              <ArrowRightIcon size={14} className="transition-transform duration-320 group-hover:-rotate-45" />
            </span>
          </span>
          <span className="relative mt-4 text-[15px] font-semibold text-ink transition-colors group-hover:text-gold-deep">
            {title}
          </span>
          <span className="relative mt-1 block text-xs leading-relaxed text-ink-4">{body}</span>
        </Link>
      ))}
    </nav>
  );
}

/** Page-local table shell: the shared TableCard with the catalog's premium chrome. */
function LuxeTableCard({
  title,
  description,
  icon,
  toolbar,
  footer,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-[22px] bg-paper shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]">
      <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
      <div className="flex flex-col gap-4 border-b border-ink/[0.06] px-5 py-4 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)]">
            {icon}
          </span>
          <div className="min-w-0">
            <h2 className="font-sans tracking-normal truncate text-[15px] font-semibold text-ink">{title}</h2>
            {description ? <p className="truncate text-xs text-ink-4">{description}</p> : null}
          </div>
        </div>
        {toolbar ? <div className="min-w-0 xl:max-w-[70%]">{toolbar}</div> : null}
      </div>
      <div className="overflow-x-auto scrollbar-thin">{children}</div>
      {footer ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/[0.06] bg-bone/40 px-5 py-3 text-xs text-ink-4 sm:px-6">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

/** Sliding-pill segmented control for the stock grouping. */
function Segmented<K extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: ReadonlyArray<{ key: K; label: string; icon: ReactNode }>;
  value: K;
  onChange: (k: K) => void;
  ariaLabel: string;
}) {
  const idx = Math.max(
    0,
    items.findIndex((i) => i.key === value)
  );
  return (
    <div className="-mx-1 overflow-x-auto px-1 scrollbar-thin">
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="relative grid min-w-max rounded-xl bg-bone p-1 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07)]"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 rounded-lg bg-void shadow-[inset_0_0_0_1px_rgba(205,168,83,0.3),0_8px_18px_-10px_rgba(6,42,34,0.8)] transition-transform duration-320 ease-brand"
          style={{ width: `calc((100% - 0.5rem) / ${items.length})`, transform: `translateX(${idx * 100}%)` }}
        />
        {items.map((t) => {
          const active = t.key === value;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.key)}
              className={cn(
                "relative inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-[13px] font-medium transition-colors duration-200",
                active ? "text-paper" : "text-ink-4 hover:text-ink"
              )}
            >
              <span className={active ? "text-gold-light" : "text-ink-5"}>{t.icon}</span>
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
