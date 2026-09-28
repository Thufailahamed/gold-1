"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  Page,
  Hero,
  Panel,
  StatGrid,
  StatCard,
  TableCard,
  TableSkeleton,
  EmptyBlock,
  Tabs,
} from "@/components/ui";
import { ArchiveIcon, GemIcon, ScaleIcon, StoreIcon } from "@/components/icons";

type Stock =
  | { stages: { old_gold_mg: number; melting_mg: number; refined_mg: number; for_sale_mg: number } }
  | { byPurity: { permille: number; fine_mg: number }[] }
  | { byBranch: { branch_id: string; fine_mg: number }[] };

const g = (mg: number) => (mg / 1000).toLocaleString("en-US");
type Group = "stage" | "purity" | "branch";

export default function GoldStockPage() {
  const [groupBy, setGroupBy] = useState<Group>("stage");
  const stock = useQuery({
    queryKey: ["gold-stock", groupBy],
    queryFn: () => api<Stock>(`/api/v1/gold/stock?groupBy=${groupBy}`),
  });

  const totalFine =
    stock.data && "stages" in stock.data
      ? stock.data.stages.old_gold_mg + stock.data.stages.melting_mg + stock.data.stages.refined_mg + stock.data.stages.for_sale_mg
      : stock.data && "byPurity" in stock.data
        ? stock.data.byPurity.reduce((n, r) => n + r.fine_mg, 0)
        : stock.data && "byBranch" in stock.data
          ? stock.data.byBranch.reduce((n, r) => n + r.fine_mg, 0)
          : 0;

  return (
    <Page>
      <Hero
        kicker="Gold · Vault"
        title="Gold stock"
        description="Fine gold across every stage, purity, and branch."
        note="Balances derive from the immutable gold ledger — reconciled per batch."
        stats={[
          { label: "Total fine", value: `${g(totalFine)} g` },
          { label: "Grouped by", value: groupBy },
        ]}
      />
      <Tabs<Group>
        ariaLabel="Group stock by"
        items={[
          { key: "stage", label: "Stage", icon: <ArchiveIcon size={15} /> },
          { key: "purity", label: "Purity", icon: <GemIcon size={15} /> },
          { key: "branch", label: "Branch", icon: <StoreIcon size={15} /> },
        ]}
        value={groupBy}
        onChange={setGroupBy}
      />
      {stock.isLoading ? (
        <TableCard><TableSkeleton rows={4} cols={2} /></TableCard>
      ) : stock.isError ? (
        <TableCard><EmptyBlock title="Failed to load" description="Check the API connection and retry." /></TableCard>
      ) : null}
      {stock.data && "stages" in stock.data ? (
        <StatGrid>
          <StatCard icon={<ScaleIcon size={18} />} label="Old gold" value={g(stock.data.stages.old_gold_mg)} sub="g fine" />
          <StatCard icon={<ArchiveIcon size={18} />} label="Melting" value={g(stock.data.stages.melting_mg)} sub="g fine" />
          <StatCard icon={<GemIcon size={18} />} label="Refined" value={g(stock.data.stages.refined_mg)} sub="g fine" />
          <StatCard icon={<StoreIcon size={18} />} label="For sale" value={g(stock.data.stages.for_sale_mg)} sub="g fine" />
        </StatGrid>
      ) : null}
      {stock.data && "byPurity" in stock.data ? (
        <TableCard title="By purity" icon={<GemIcon size={17} />}>
          {stock.data.byPurity.length === 0 ? (
            <EmptyBlock title="No stock" description="No fine gold on hand by purity." />
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>Permille</th>
                  <th className="!text-right">Fine g</th>
                </tr>
              </thead>
              <tbody>
                {stock.data.byPurity.map((r) => (
                  <tr key={r.permille}>
                    <td className="g-metric font-medium text-ink">{r.permille}‰</td>
                    <td className="!text-right num-tabular">{g(r.fine_mg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : null}
      {stock.data && "byBranch" in stock.data ? (
        <TableCard title="By branch" icon={<StoreIcon size={17} />}>
          {stock.data.byBranch.length === 0 ? (
            <EmptyBlock title="No stock" description="No fine gold on hand by branch." />
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>Branch</th>
                  <th className="!text-right">Fine g</th>
                </tr>
              </thead>
              <tbody>
                {stock.data.byBranch.map((r) => (
                  <tr key={r.branch_id}>
                    <td className="g-metric text-xs">{r.branch_id}</td>
                    <td className="!text-right num-tabular">{g(r.fine_mg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : null}
      {stock.data && !("stages" in stock.data) && !("byPurity" in stock.data) && !("byBranch" in stock.data) ? (
        <Panel title="Stock"><EmptyBlock title="No data" description="No stock breakdown returned." /></Panel>
      ) : null}
    </Page>
  );
}
