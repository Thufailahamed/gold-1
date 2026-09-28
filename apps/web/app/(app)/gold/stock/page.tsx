"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Page, Hero, Panel } from "@/components/ui";

type Stock =
  | { stages: { old_gold_mg: number; melting_mg: number; refined_mg: number; for_sale_mg: number } }
  | { byPurity: { permille: number; fine_mg: number }[] }
  | { byBranch: { branch_id: string; fine_mg: number }[] };

const g = (mg: number) => (mg / 1000).toLocaleString("en-US");

export default function GoldStockPage() {
  const [groupBy, setGroupBy] = useState<"purity" | "branch" | "stage">("stage");
  const stock = useQuery({
    queryKey: ["gold-stock", groupBy],
    queryFn: () => api<Stock>(`/api/v1/gold/stock?groupBy=${groupBy}`),
  });

  return (
    <Page>
      <Hero
        kicker="Gold"
        title="Gold stock"
        description="Fine gold across every stage, purity, and branch."
      />
      <div className="flex gap-2">
        {(["stage", "purity", "branch"] as const).map((x) => (
          <button
            key={x}
            onClick={() => setGroupBy(x)}
            className={`rounded-md px-3 py-1.5 text-sm ${groupBy === x ? "bg-stone-900 text-white" : "border"}`}
          >
            {x}
          </button>
        ))}
      </div>
      {"stages" in (stock.data ?? {}) && stock.data && "stages" in stock.data ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            ["Old gold", stock.data.stages.old_gold_mg],
            ["Melting", stock.data.stages.melting_mg],
            ["Refined", stock.data.stages.refined_mg],
            ["For sale", stock.data.stages.for_sale_mg],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-xl border border-stone-200 bg-white p-5">
              <p className="text-sm text-stone-500">{k}</p>
              <p className="mt-1 text-2xl font-semibold">{g(v as number)}<span className="text-sm font-normal"> g fine</span></p>
            </div>
          ))}
        </div>
      ) : null}
      {"byPurity" in (stock.data ?? {}) && stock.data && "byPurity" in stock.data ? (
        <Panel title="By purity">
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
                  <td>{r.permille}</td>
                  <td className="!text-right">{g(r.fine_mg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : null}
      {"byBranch" in (stock.data ?? {}) && stock.data && "byBranch" in stock.data ? (
        <Panel title="By branch">
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
                  <td className="font-mono text-xs">{r.branch_id}</td>
                  <td className="!text-right">{g(r.fine_mg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : null}
    </Page>
  );
}
