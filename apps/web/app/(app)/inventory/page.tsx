"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { centsToLkr, hasPermission, mgToG } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { DataTable, EmptyBlock, Page, TableCard, Tabs, type DataColumn } from "@/components/ui";
import { Building2Icon, GemIcon, PackageIcon } from "@/components/icons";
import { InventoryHero, StockByKarat, StockByBranch, AttentionCard } from "./panels";
import { stockColumns, type Insights, type StockRow } from "./columns";

const GROUP_LABEL: Record<"branch" | "purity" | "product", string> = {
  branch: "branch",
  purity: "purity",
  product: "product",
};

const g = (mg: number) => mgToG(mg).toLocaleString("en-US", { maximumFractionDigits: 3 });

export default function InventoryPage() {
  const [groupBy, setGroupBy] = useState<"branch" | "purity" | "product">("branch");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | undefined>(undefined);
  const [pendingType, setPendingType] = useState("");

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

  const columns = useMemo(() => stockColumns(groupBy), [groupBy]);

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

  function onSort(key: string) {
    setSort((s) =>
      s?.key === key
        ? s.dir === "asc"
          ? { key, dir: "desc" }
          : undefined
        : { key, dir: "desc" }
    );
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
          onFilter={(t) => setPendingType(t)}
        />
      </div>

      <TableCard
        title="Stock on hand"
        description={
          pendingType
            ? `Grouped by ${GROUP_LABEL[groupBy]} · alert filter: ${pendingType}`
            : `Grouped by ${GROUP_LABEL[groupBy]}`
        }
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
        />
      </TableCard>
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
}: {
  rows: StockRow[];
  columns: ReadonlyArray<DataColumn<StockRow>>;
  sort: { key: string; dir: "asc" | "desc" } | undefined;
  onSort: (key: string) => void;
  loading: boolean;
  totals: { pieces: number; net: number; fine: number; value: number; hasValue: boolean };
}) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      sort={sort}
      onSort={onSort}
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
