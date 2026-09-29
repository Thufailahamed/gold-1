"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { centsToLkr, hasPermission, mgToG } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  ButtonPrimary,
  ButtonSecondary,
  Callout,
  controlClass,
  DataTable,
  EmptyBlock,
  Field,
  Page,
  Pager,
  Panel,
  TableCard,
  Tabs,
  type DataColumn,
} from "@/components/ui";
import {
  Building2Icon,
  GemIcon,
  PackageIcon,
  RefreshCwIcon,
} from "@/components/icons";
import {
  AttentionCard,
  InventoryHero,
  MovementFilters,
  PieceDetail,
  PiecePreview,
  StockByBranch,
  StockByKarat,
} from "./panels";
import {
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

const g = (mg: number) => mgToG(mg).toLocaleString("en-US", { maximumFractionDigits: 3 });

const MOVE_STATUSES = ["IN_STOCK", "RETURNED", "TRANSFER_PENDING"];

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
  const [toStatus, setToStatus] = useState("RETURNED");
  const [toBranch, setToBranch] = useState("");
  const [reason, setReason] = useState("");
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
    return (key: string): ReactNode => {
      if (groupBy === "branch") return <span className="font-medium text-ink">{bNames.get(key) ?? key.slice(0, 8)}</span>;
      if (groupBy === "purity")
        return (
          <span className="g-metric rounded-md bg-gold-pale px-2 py-0.5 text-xs font-semibold text-gold-deep ring-1 ring-gold-dark/15">
            {pKarat.get(key) ?? key.slice(0, 8)}
          </span>
        );
      return <span className="font-mono text-xs text-ink">{key.slice(0, 10)}…</span>;
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

  const qc = useQueryClient();
  const move = useMutation({
    mutationFn: async () => {
      const found = await api<Piece>(
        `/api/v1/products/barcode/${encodeURIComponent(barcode.trim())}`
      );
      return api("/api/v1/inventory/movements", {
        method: "POST",
        body: JSON.stringify({
          productId: found.product.id,
          toStatus,
          toBranchId: toBranch || undefined,
          reason: reason || undefined,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Movement recorded");
      setBarcode("");
      setReason("");
      qc.invalidateQueries({ queryKey: ["moves"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["inventory", "insights"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Movement failed"),
  });

  const needsBranch = toStatus === "TRANSFER_PENDING";
  const moveInvalid = !barcode.trim() || (needsBranch && !toBranch.trim());

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
      hasValue: base.some((r) => r.value_cents !== null),
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
    <Page className="space-y-5">
      <InventoryHero
        insights={insights.data}
        loading={insights.isLoading}
        error={insightsError}
        onRecord={() =>
          document.getElementById("record-movement")?.scrollIntoView({ behavior: "smooth" })
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
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

      <TableCard
        title="Stock on hand"
        description={`Grouped by ${GROUP_LABEL[groupBy]}`}
        icon={<PackageIcon size={16} />}
        toolbar={
          <Tabs
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
      </TableCard>

      <div id="record-movement">
        <Panel
          title="Record movement"
          description="Scan a barcode and post a status change."
          icon={<RefreshCwIcon size={16} />}
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="min-w-0 space-y-3">
              <Field
                label="Barcode"
                htmlFor="mv-barcode"
                hint="Press Enter to post. Scans are picked up automatically."
              >
                <input
                  id="mv-barcode"
                  ref={barcodeRef}
                  autoFocus
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !moveInvalid) move.mutate();
                  }}
                  placeholder="JW-XXXXXX"
                  className={cn(controlClass, "font-mono")}
                  aria-describedby="mv-barcode-hint"
                />
              </Field>
              <PiecePreview
                code={barcode}
                branchName={(id) => branches.data?.rows.find((b) => b.id === id)?.name ?? id.slice(0, 8)}
              />
            </div>

            <div className="min-w-0 space-y-3">
              <Field label="To status" htmlFor="mv-status">
                <select
                  id="mv-status"
                  value={toStatus}
                  onChange={(e) => setToStatus(e.target.value)}
                  className={controlClass}
                >
                  {MOVE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="To branch"
                htmlFor="mv-branch"
                hint={needsBranch ? "Required for a transfer." : "Only used for transfers."}
                error={
                  needsBranch && !toBranch.trim() ? "Pick a branch to transfer to" : undefined
                }
              >
                <select
                  id="mv-branch"
                  value={toBranch}
                  onChange={(e) => setToBranch(e.target.value)}
                  className={controlClass}
                  aria-invalid={needsBranch && !toBranch.trim()}
                  aria-describedby="mv-branch-hint"
                >
                  <option value="">No change</option>
                  {(branches.data?.rows ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Reason"
                htmlFor="mv-reason"
                hint="Optional, kept on the movement record."
              >
                <input
                  id="mv-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Customer return, workshop move…"
                  className={controlClass}
                />
              </Field>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <ButtonPrimary
                  type="button"
                  onClick={() => move.mutate()}
                  disabled={move.isPending || moveInvalid}
                >
                  {move.isPending ? "Recording…" : "Record movement"}
                </ButtonPrimary>
                <ButtonSecondary
                  type="button"
                  onClick={() => {
                    setBarcode("");
                    setToBranch("");
                    setReason("");
                  }}
                >
                  Clear
                </ButtonSecondary>
              </div>
            </div>
          </div>

          <Callout tone="info" className="mt-5">
            Sales go through the POS, shortages through counts, and voids through the product page.
            This panel handles restocks and same-branch moves.
          </Callout>
        </Panel>
      </div>

      <div id="movement-history">
        <TableCard
          title="Movement history"
          description={mType ? `Filtered to ${mType.replace(/_/g, " ")}` : "Latest movements"}
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
        </TableCard>
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
        <div className="flex flex-wrap items-baseline justify-between gap-3 text-xs text-ink-3">
          <span className="font-semibold uppercase tracking-[0.14em] text-ink-4">Total</span>
          <span className="num-tabular">{totals.pieces.toLocaleString("en-US")} pieces</span>
          <span className="num-tabular">{g(totals.net)} g net</span>
          <span className="num-tabular">{g(totals.fine)} g fine</span>
          <span className="num-tabular">
            {totals.hasValue
              ? `LKR ${centsToLkr(totals.value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
              : "—"}
          </span>
        </div>
      }
    />
  );
}
