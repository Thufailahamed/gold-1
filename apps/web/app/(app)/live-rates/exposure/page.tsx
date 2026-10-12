"use client";

// Exposure: how much gold the shop is long or short at today's price, and
// what its stock is worth against what was paid for it.
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PERMISSIONS } from "@goldos/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Card, CardHead, Empty, GoldHero, HeroBadge, RowsSkeleton } from "@/components/console-kit";
import { AlertCircleIcon, LayersIcon, PackageIcon, ScaleIcon } from "@/components/icons";
import { karatTone } from "../parts";
import { DeskTabs, NumInput, gramsOf, lkr, num, signed, toneOf, useMe, when } from "../desk-kit";

type Position = {
  fineLkrPerG: number;
  usdLkr: number;
  spotUsd: number | null;
  orderPermille: number;
  stages: { oldGoldMg: number; meltingMg: number; refinedMg: number; forSaleMg: number };
  byPurity: { permille: number; fineMg: number; valueLkr: number }[];
  longMg: number;
  committed: { count: number; fineMg: number; valueLkr: number };
  custody: { count: number; fineMg: number };
  owed: { id: string; number: string; status: string; source: string; fineMg: number; quoteLkr: number; advanceLkr: number; createdAt: number; valueLkr: number }[];
  owedMg: number;
  netMg: number;
  netValueLkr: number;
  perPctLkr: number;
  perTenUsdLkr: number;
};
type Gains = {
  fineLkrPerG: number;
  lines: { key: string; label: string; branch: string; kind: "products" | "old_gold"; karat: string | null; count: number; costed: number; fineMg: number; costedFineMg: number; costLkr: number; valueLkr: number; gainLkr: number; gainPct: number | null }[];
  totals: { costLkr: number; valueLkr: number; gainLkr: number; gainPct: number | null; items: number; uncosted: number; uncostedFineMg: number };
};

const STAGES = [
  { key: "forSaleMg", label: "Jewellery for sale", tone: "#CDA853" },
  { key: "oldGoldMg", label: "Old gold bought", tone: "#D97706" },
  { key: "meltingMg", label: "In melting", tone: "#F97316" },
  { key: "refinedMg", label: "Refined bars", tone: "#0EA5E9" },
] as const;

export default function ExposurePage() {
  const { can, me } = useMe();
  const allowed = can(PERMISSIONS.GOLD_VIEW);
  const pos = useQuery({ queryKey: ["desk-position"], queryFn: () => api<Position>("/api/v1/market-desk/position"), enabled: allowed, refetchInterval: 120_000 });
  const gains = useQuery({ queryKey: ["desk-gains"], queryFn: () => api<Gains>("/api/v1/market-desk/gains"), enabled: allowed, refetchInterval: 120_000 });
  const [move, setMove] = useState("2");
  const p = pos.data;
  const g = gains.data;
  const loading = pos.isLoading;
  const net = p?.netMg ?? 0;
  const long = net >= 0;
  const what = num(move);

  if (me.data && !allowed)
    return (
      <div className="space-y-3">
        <GoldHero icon={ScaleIcon} title="Gold" accent="exposure" back={{ href: "/live-rates", label: "Live rates" }}>
          <DeskTabs />
        </GoldHero>
        <Card>
          <Empty icon={AlertCircleIcon} title="Needs gold:view" desc="Exposure reads stock and orders. Ask an owner to grant the gold:view permission." />
        </Card>
      </div>
    );

  const total = p ? Math.max(p.longMg + p.committed.fineMg, p.owedMg, 1) : 1;

  return (
    <div className="space-y-3">
      <GoldHero
        icon={ScaleIcon}
        title="Gold"
        accent="exposure"
        back={{ href: "/live-rates", label: "Live rates" }}
        badge={p ? <HeroBadge tone={long ? "good" : "bad"}>{long ? "Net long" : "Net short"}</HeroBadge> : null}
        sub={p ? `Valued at fine gold Rs ${lkr(p.fineLkrPerG)}/g · spot $${lkr(p.spotUsd, 2)} · USD/LKR ${p.usdLkr.toFixed(2)}` : "Stock vs gold owed, at today's price"}
        stats={[
          { label: "Net position", value: p ? net / 1000 : undefined, format: (n) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`, unit: "g fine", accent: true, loading },
          { label: "Net value", value: p?.netValueLkr, format: (n) => lkr(n), unit: "LKR", loading },
          { label: "Gold +1% means", value: p?.perPctLkr, format: (n) => `${n >= 0 ? "+" : ""}${lkr(n)}`, tone: p ? (p.perPctLkr >= 0 ? "good" : "bad") : undefined, unit: "LKR", loading },
          { label: "Gold +$10/oz means", value: p?.perTenUsdLkr, format: (n) => `${n >= 0 ? "+" : ""}${lkr(n)}`, tone: p ? (p.perTenUsdLkr >= 0 ? "good" : "bad") : undefined, unit: "LKR", loading },
          { label: "Stock gain at market", value: g?.totals.gainLkr, format: (n) => `${n >= 0 ? "+" : ""}${lkr(n)}`, tone: g ? (g.totals.gainLkr >= 0 ? "good" : "bad") : undefined, loading: gains.isLoading },
          { label: "Gain on cost", value: g?.totals.gainPct ?? null, format: (n) => signed(n, 1), loading: gains.isLoading },
        ]}
      >
        <DeskTabs />
      </GoldHero>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        {/* ---------------------------------------- position */}
        <Card>
          <CardHead icon={ScaleIcon} title="Gold position" sub="What you hold vs what you've promised, in fine grams" />
          {loading || !p ? (
            <RowsSkeleton rows={5} />
          ) : (
            <div className="space-y-4 p-4">
              {/* long vs owed bars */}
              <div className="space-y-2">
                <div>
                  <div className="mb-1 flex justify-between text-[11px]">
                    <span className="font-semibold text-ink-2">You hold</span>
                    <span className="g-metric text-ink">{gramsOf(p.longMg + p.committed.fineMg)} g</span>
                  </div>
                  <div className="flex h-3 overflow-hidden rounded-full bg-ink/[0.05]">
                    {STAGES.map((s) => (
                      <span key={s.key} title={`${s.label}: ${gramsOf(p.stages[s.key])} g`} style={{ width: `${(p.stages[s.key] / total) * 100}%`, background: s.tone }} />
                    ))}
                    <span title={`Valued, not yet paid: ${gramsOf(p.committed.fineMg)} g`} className="bg-emerald-500/60" style={{ width: `${(p.committed.fineMg / total) * 100}%` }} />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-[11px]">
                    <span className="font-semibold text-ink-2">You owe</span>
                    <span className="g-metric text-ink">{gramsOf(p.owedMg)} g</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-ink/[0.05]">
                    <span className="block h-full bg-rose-500" style={{ width: `${(p.owedMg / total) * 100}%` }} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[10.5px] text-ink-4">
                  {STAGES.map((s) => (
                    <span key={s.key} className="flex items-center gap-1">
                      <i className="size-2 rounded-sm" style={{ background: s.tone }} />
                      {s.label} <b className="g-metric font-semibold text-ink-2">{gramsOf(p.stages[s.key])} g</b>
                    </span>
                  ))}
                  <span className="flex items-center gap-1">
                    <i className="size-2 rounded-sm bg-emerald-500/60" />
                    Valued, not yet paid <b className="g-metric font-semibold text-ink-2">{gramsOf(p.committed.fineMg)} g</b>
                  </span>
                </div>
              </div>

              {/* what-if */}
              <div className="rounded-xl bg-bone/60 p-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.05)]">
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
                  If gold moves
                  <NumInput value={move} onChange={setMove} suffix="%" className="w-24" />
                  your position changes by
                  <b className={cn("g-metric text-[14px]", toneOf(net * what))}>
                    {net * what >= 0 ? "+" : "−"}Rs {lkr(Math.abs(p.perPctLkr * what))}
                  </b>
                </div>
                <div className="mt-2 grid grid-cols-5 gap-1">
                  {[-5, -2, -1, 1, 2].map((m) => (
                    <div key={m} className="rounded-lg bg-paper px-2 py-1.5 text-center shadow-[inset_0_0_0_1px_rgba(16,32,27,0.05)]">
                      <div className="text-[10px] font-semibold text-ink-5">{m > 0 ? "+" : ""}{m}%</div>
                      <div className={cn("g-metric text-[11.5px] font-semibold", toneOf(p.perPctLkr * m))}>{lkr(p.perPctLkr * m)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="rounded-xl px-3 py-2 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.06)]">
                  <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">Valued, unpaid</div>
                  <div className="g-metric text-[14px] font-semibold text-ink">{gramsOf(p.committed.fineMg)} g</div>
                  <div className="text-[10.5px] text-ink-5">
                    {p.committed.count} item{p.committed.count === 1 ? "" : "s"} · Rs {lkr(p.committed.valueLkr)} fixed
                  </div>
                </div>
                <div className="rounded-xl px-3 py-2 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.06)]">
                  <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">Customer gold held</div>
                  <div className="g-metric text-[14px] font-semibold text-ink">{gramsOf(p.custody.fineMg)} g</div>
                  <div className="text-[10.5px] text-ink-5">{p.custody.count} received / testing · not yours</div>
                </div>
                <div className="rounded-xl px-3 py-2 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.06)]">
                  <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">Owed on orders</div>
                  <div className="g-metric text-[14px] font-semibold text-rose-700">{gramsOf(p.owedMg)} g</div>
                  <div className="text-[10.5px] text-ink-5">{p.owed.length} fixed-price order{p.owed.length === 1 ? "" : "s"}</div>
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* ---------------------------------------- by purity + orders */}
        <div className="space-y-3">
          <Card>
            <CardHead icon={LayersIcon} title="Stock by purity" sub="Fine gold and its value today" />
            {!p ? (
              <RowsSkeleton rows={4} />
            ) : !p.byPurity.length ? (
              <Empty icon={LayersIcon} title="No gold in stock" desc="Products, bought old gold and refined bars show here." />
            ) : (
              <ul className="divide-y divide-ink/[0.05]">
                {p.byPurity.map((r) => {
                  const kt = karatTone(r.permille / 1000);
                  const share = (r.fineMg / Math.max(1, p.longMg)) * 100;
                  return (
                    <li key={r.permille} className="grid grid-cols-[52px_1fr_auto] items-center gap-3 px-4 py-2">
                      <span className={cn("flex h-6 items-center justify-center rounded-md text-[10.5px] font-bold", kt.badge)}>{r.permille}‰</span>
                      <div className="h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                        <div className={cn("h-full", kt.bar)} style={{ width: `${share}%` }} />
                      </div>
                      <div className="text-right">
                        <div className="g-metric text-[12px] font-semibold text-ink">{gramsOf(r.fineMg)} g</div>
                        <div className="g-metric text-[10.5px] text-ink-5">Rs {lkr(r.valueLkr)}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card>
            <CardHead icon={PackageIcon} title="Gold owed on custom orders" sub={p ? `Shop-supplied gold at ${p.orderPermille}‰, less customer gold received` : undefined} />
            {!p ? (
              <RowsSkeleton rows={3} />
            ) : !p.owed.length ? (
              <Empty icon={PackageIcon} title="Nothing owed" desc="Open custom orders where the shop supplies the gold appear here." />
            ) : (
              <table className="w-full text-[12px]">
                <thead className="bg-bone/60 text-left">
                  <tr className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">
                    <th className="py-1.5 pl-4 pr-2">Order</th>
                    <th className="px-2 text-right">Fine owed</th>
                    <th className="px-2 text-right">Cost today</th>
                    <th className="px-2 pr-4 text-right">Quoted</th>
                  </tr>
                </thead>
                <tbody>
                  {p.owed.map((o) => (
                    <tr key={o.id} className="border-t border-ink/[0.05] hover:bg-gold-pale/30">
                      <td className="py-1.5 pl-4 pr-2">
                        <Link href={`/custom-orders/${o.id}`} className="g-metric font-semibold text-ink hover:text-gold-deep">
                          {o.number}
                        </Link>
                        <div className="text-[10px] text-ink-5">
                          {o.status.replace(/_/g, " ").toLowerCase()} · {when(o.createdAt)}
                        </div>
                      </td>
                      <td className="g-metric px-2 text-right text-rose-700">{gramsOf(o.fineMg)} g</td>
                      <td className="g-metric px-2 text-right text-ink-2">{lkr(o.valueLkr)}</td>
                      <td className="g-metric px-2 pr-4 text-right text-ink-3">{lkr(o.quoteLkr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </div>

      {/* ---------------------------------------- stock gains */}
      <Card>
        <CardHead
          icon={LayersIcon}
          title="Stock gains at today's price"
          sub="Metal value now vs what you paid (jewellery cost less making charge; old gold at purchase value)"
        />
        {gains.isLoading || !g ? (
          <RowsSkeleton rows={5} />
        ) : !g.lines.length ? (
          <Empty icon={LayersIcon} title="No stock to value" desc="In-stock jewellery and bought old gold appear here." />
        ) : (
          <>
            {g.totals.uncosted ? (
              <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11.5px] text-amber-900">
                <AlertCircleIcon size={13} />
                {g.totals.uncosted} item{g.totals.uncosted === 1 ? "" : "s"} ({gramsOf(g.totals.uncostedFineMg)} g fine) have no cost recorded and are left out of the gain.
              </div>
            ) : null}
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-[12px]">
                <thead className="bg-bone/60 text-left">
                  <tr className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">
                    <th className="py-1.5 pl-4 pr-2">Stock</th>
                    <th className="px-2">Branch</th>
                    <th className="px-2 text-right">Items</th>
                    <th className="px-2 text-right">Fine (costed)</th>
                    <th className="px-2 text-right">Cost</th>
                    <th className="px-2 text-right">Value now</th>
                    <th className="px-2 pr-4 text-right">Gain</th>
                  </tr>
                </thead>
                <tbody>
                  {g.lines.map((l) => (
                    <tr key={l.key} className="relative border-t border-ink/[0.05] hover:bg-gold-pale/30">
                      <td className="py-1.5 pl-4 pr-2 font-medium text-ink">{l.label}</td>
                      <td className="px-2 text-ink-3">{l.branch}</td>
                      <td className="g-metric px-2 text-right text-ink-3">
                        {l.costed}
                        {l.costed !== l.count ? <span className="text-ink-5">/{l.count}</span> : null}
                      </td>
                      <td className="g-metric px-2 text-right text-ink-3">{gramsOf(l.costedFineMg)} g</td>
                      <td className="g-metric px-2 text-right text-ink-2">{lkr(l.costLkr)}</td>
                      <td className="g-metric px-2 text-right text-ink">{lkr(l.valueLkr)}</td>
                      <td className="px-2 pr-4 text-right">
                        <div className={cn("g-metric font-semibold", toneOf(l.gainLkr))}>
                          {l.gainLkr >= 0 ? "+" : ""}
                          {lkr(l.gainLkr)}
                        </div>
                        <div className={cn("g-metric text-[10px]", toneOf(l.gainPct))}>{signed(l.gainPct, 1)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-ink/10 bg-bone/50 font-semibold">
                    <td className="py-2 pl-4 pr-2 text-ink" colSpan={2}>
                      Total
                    </td>
                    <td className="g-metric px-2 text-right text-ink-3">{g.totals.items - g.totals.uncosted}</td>
                    <td />
                    <td className="g-metric px-2 text-right text-ink-2">{lkr(g.totals.costLkr)}</td>
                    <td className="g-metric px-2 text-right text-ink">{lkr(g.totals.valueLkr)}</td>
                    <td className={cn("g-metric px-2 pr-4 text-right", toneOf(g.totals.gainLkr))}>
                      {g.totals.gainLkr >= 0 ? "+" : ""}
                      {lkr(g.totals.gainLkr)} <span className="text-[10.5px]">({signed(g.totals.gainPct, 1)})</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
        <p className="border-t border-ink/[0.06] px-4 py-2 text-[10.5px] text-ink-5">
          A management view at spot, before selling costs and making income. It does not post anything to the books.
        </p>
      </Card>
    </div>
  );
}
