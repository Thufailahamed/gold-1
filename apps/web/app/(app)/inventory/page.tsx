"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { centsToLkr, mgToG } from "@goldos/shared";
import { api } from "@/lib/api";
import Link from "next/link";
import {
  Page,
  Hero,
  heroBtnGhost,
  Panel,
  Pill,
  Tabs,
  TableCard,
  TableSkeleton,
  EmptyBlock,
  controlClass,
} from "@/components/ui";
import { Building2Icon, GemIcon, PackageIcon, RefreshCwIcon, ScanBarcodeIcon } from "@/components/icons";

type StockRow = { key: string; pieces: number; net_mg: number; fine_mg: number; value_cents: number | null };
type Movement = {
  id: string; product_id: string; barcode: string | null; type: string;
  from_status: string | null; to_status: string; from_branch: string | null;
  to_branch: string | null; weight_mg: number; reason: string | null; created_at: number;
};

const STATUSES = ["IN_STOCK", "RETURNED", "TRANSFER_PENDING"];

export default function InventoryPage() {
  const [groupBy, setGroupBy] = useState<"branch" | "purity" | "product">("branch");
  const [mType, setMType] = useState("");
  const [mBranch, setMBranch] = useState("");
  const qc = useQueryClient();

  const stock = useQuery({
    queryKey: ["stock", groupBy],
    queryFn: () => api<StockRow[]>(`/api/v1/inventory/stock?groupBy=${groupBy}`),
  });
  const moves = useQuery({
    queryKey: ["moves", mType, mBranch],
    queryFn: () =>
      api<{ rows: Movement[]; total: number }>(
        `/api/v1/inventory/movements?limit=30${mType ? `&type=${mType}` : ""}${mBranch ? `&branchId=${mBranch}` : ""}`
      ),
  });

  const [barcode, setBarcode] = useState("");
  const [toStatus, setToStatus] = useState("RETURNED");
  const [toBranch, setToBranch] = useState("");
  const [reason, setReason] = useState("");
  const move = useMutation({
    mutationFn: async () => {
      const found = await api<{ product: { id: string } }>(
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
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Movement failed"),
  });

  const inputCls = controlClass;
  const moveRows = moves.data?.rows ?? [];

  const stockRows = stock.data ?? [];
  const totals = useMemo(
    () => ({
      pieces: stockRows.reduce((a, r) => a + r.pieces, 0),
      netG: stockRows.reduce((a, r) => a + r.net_mg, 0),
      fineG: stockRows.reduce((a, r) => a + r.fine_mg, 0),
      value: stockRows.reduce((a, r) => a + (r.value_cents ?? 0), 0),
      hasValue: stockRows.some((r) => r.value_cents !== null),
    }),
    [stockRows]
  );

  return (
    <Page>
      <Hero
        kicker="Catalog"
        title="Inventory"
        description="Stock on hand and movement history across branches."
        actions={
          <Link href="/scan" className={heroBtnGhost}>
            <ScanBarcodeIcon size={15} />
            Scan to move stock
          </Link>
        }
        stats={[
          {
            label: "Pieces on hand",
            value: stock.isLoading ? "—" : totals.pieces.toLocaleString("en-US"),
          },
          {
            label: "Net weight",
            value: stock.isLoading ? "—" : `${mgToG(totals.netG).toLocaleString("en-US")} g`,
          },
          {
            label: "Fine gold",
            value: stock.isLoading ? "—" : `${mgToG(totals.fineG).toLocaleString("en-US")} g`,
          },
          {
            label: "Stock value",
            value:
              stock.isLoading || !totals.hasValue
                ? "—"
                : `${centsToLkr(totals.value).toLocaleString("en-US")} LKR`,
          },
        ]}
        note="Movements post to stock immediately — scan the piece to verify before recording"
      />

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

      <TableCard title="Stock on hand" description={`Grouped by ${groupBy}`}>
        {stock.isLoading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : (stock.data ?? []).length === 0 ? (
          <EmptyBlock title="No stock" description="No pieces on hand for this grouping." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>{groupBy}</th>
                <th className="!text-right">Pieces</th>
                <th className="!text-right">Net g</th>
                <th className="!text-right">Fine g</th>
                <th className="!text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {(stock.data ?? []).map((r) => (
                <tr key={r.key}>
                  <td className="font-mono text-xs">{r.key}</td>
                  <td className="num">{r.pieces}</td>
                  <td className="num">{mgToG(r.net_mg).toLocaleString("en-US")}</td>
                  <td className="num">{mgToG(r.fine_mg).toLocaleString("en-US")}</td>
                  <td className="num">
                    {r.value_cents !== null
                      ? `${centsToLkr(r.value_cents).toLocaleString("en-US")} LKR`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      <Panel
        title="Record movement"
        description="Scan a barcode and post a status change. Sales via POS, shortages via Counts, voids via product page — this form handles restocks and same-branch moves only."
        icon={<RefreshCwIcon size={16} />}
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <input
            placeholder="Barcode"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            className={`${inputCls} font-mono`}
          />
          <select value={toStatus} onChange={(e) => setToStatus(e.target.value)} className={inputCls}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            placeholder="To branch (transfer)"
            value={toBranch}
            onChange={(e) => setToBranch(e.target.value)}
            className={inputCls}
          />
          <input
            placeholder="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputCls}
          />
          <button
            onClick={() => move.mutate()}
            disabled={move.isPending || !barcode.trim()}
            className="g-btn g-btn-primary h-10 px-4 text-sm"
          >
            Record
          </button>
        </div>
      </Panel>

      <TableCard
        title="Movement history"
        description="Latest 30 movements"
        toolbar={
          <div className="flex flex-wrap gap-2">
            <select
              value={mType}
              onChange={(e) => setMType(e.target.value)}
              className={`${inputCls} w-auto`}
            >
              <option value="">All types</option>
              {["INTAKE", "TRANSFER_OUT", "TRANSFER_IN", "RETURN", "LOSS", "VOID"].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input
              placeholder="Branch filter"
              value={mBranch}
              onChange={(e) => setMBranch(e.target.value)}
              className={`${inputCls} w-48`}
            />
          </div>
        }
      >
        {moves.isLoading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : moveRows.length === 0 ? (
          <EmptyBlock title="No movements" description="No movement records match the filters." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Barcode</th>
                <th>From → To</th>
                <th className="!text-right">Weight g</th>
                <th>Reason</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {moveRows.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Pill tone="neutral" className="font-mono normal-case tracking-normal">
                      {m.type}
                    </Pill>
                  </td>
                  <td className="font-mono text-xs">{m.barcode ?? m.product_id.slice(0, 8)}</td>
                  <td className="text-xs text-ink-3">
                    {m.from_status ?? "—"} → {m.to_status}
                  </td>
                  <td className="num">{mgToG(m.weight_mg)}</td>
                  <td className="text-ink-3">{m.reason ?? "—"}</td>
                  <td className="num text-xs">{new Date(m.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </Page>
  );
}
