"use client";

// Trade-desk panels for the Live Rates board: how gold has moved and why,
// what the vault is worth today, buy-back and pawning prices, a retail quote
// builder, and the shop's published board against the market over time.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMarketSeries } from "./series";
import {
  Area,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { EmptyBlock } from "@/components/ui";
import { Select } from "@/components/select";
import { ChangeChip, LiveNumber, PanelHead, Segmented, Shimmer, karatTone, money } from "./parts";

export type BizKarat = {
  purityId: string;
  karat: string;
  purity: number;
  lkrPerGram: number;
  change24hPct: number | null;
  boardRate: number | null;
};

type HistoryPoint = { t: number; priceUsd: number; priceLkr: number; lkrPerGram: number | null };

const DAY = 86_400_000;
const PAWN_G = 8;
const inputCls =
  "g-metric h-9 w-full min-w-0 rounded-lg bg-paper px-3 text-sm text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)] transition-shadow focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_3px_rgba(205,168,83,0.24)]";
const pct = (n: number | null | undefined, dp = 2) => (n == null || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(dp)}%`);
const pctTone = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) || n === 0 ? "text-ink-4" : n > 0 ? "text-emerald-700" : "text-rose-700";
const fmtDay = (t: number) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });

/** Gold history: our spot snapshots when they cover the range, else Yahoo's (shared cache with the main chart). */
function useGoldHistory(range: "30d" | "1y") {
  return useMarketSeries("XAU", range);
}

/** A per-viewer number setting, remembered by the browser. */
function useStoredNumber(key: string, fallback: number) {
  const [v, setV] = useState(fallback);
  useEffect(() => {
    try {
      const s = localStorage.getItem(key);
      if (s != null && Number.isFinite(Number(s))) setV(Number(s));
    } catch {}
  }, [key]);
  const set = (n: number) => {
    setV(n);
    try {
      localStorage.setItem(key, String(n));
    } catch {}
  };
  return [v, set] as const;
}

function DarkTip({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-[170px] rounded-xl bg-void/95 px-3.5 py-2.5 text-paper shadow-[0_24px_48px_-16px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(226,194,122,0.22)] backdrop-blur">
      {children}
    </div>
  );
}

function Stat({ label, value, sub, className }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 bg-paper px-4 py-3", className)}>
      <div className="truncate text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{label}</div>
      <div className="g-metric mt-1 truncate text-[16px] font-semibold text-ink">{value}</div>
      {sub ? <div className="mt-0.5 truncate text-[10.5px] text-ink-5">{sub}</div> : null}
    </div>
  );
}

/* ================================================================ PERFORMANCE */

const LOOKBACKS = [
  { label: "7 days", d: 7 },
  { label: "30 days", d: 30 },
  { label: "90 days", d: 90 },
  { label: "6 months", d: 182 },
  { label: "1 year", d: 365 },
];

/**
 * Gold over a year in rupees and in dollars. For a Sri Lankan shop the gap
 * between the two lines is the rupee: it shows how much of a price move was
 * gold itself and how much was the exchange rate.
 */
export function GoldPerformance({
  pureLkrPerGram,
  change24hPct,
  conv,
  display,
}: {
  pureLkrPerGram: number | null;
  change24hPct: number | null;
  conv: (lkr: number) => number;
  display: string;
}) {
  const hist = useGoldHistory("1y");
  const points = useMemo(() => (hist.data?.points ?? []).filter((p) => p.priceUsd > 0 && p.priceLkr > 0), [hist.data]);

  const model = useMemo(() => {
    if (points.length < 2) return null;
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const fx = (p: HistoryPoint) => p.priceLkr / p.priceUsd;
    const series = points.map((p) => ({
      t: p.t,
      lkr: (p.priceLkr / first.priceLkr) * 100,
      usd: (p.priceUsd / first.priceUsd) * 100,
      fx: (fx(p) / fx(first)) * 100,
    }));
    const change = (d: number) => {
      const from = points.find((p) => p.t >= last.t - d * DAY);
      // Only report a period the history actually covers (with a day's slack).
      if (!from || from.t - (last.t - d * DAY) > DAY || from === last) return null;
      return {
        lkr: ((last.priceLkr - from.priceLkr) / from.priceLkr) * 100,
        usd: ((last.priceUsd - from.priceUsd) / from.priceUsd) * 100,
        fx: ((fx(last) - fx(from)) / fx(from)) * 100,
      };
    };
    const perG = points.map((p) => p.lkrPerGram ?? p.priceLkr / 31.1035);
    const hi = Math.max(...perG);
    const lo = Math.min(...perG);
    const hiAt = points[perG.indexOf(hi)]!.t;
    const loAt = points[perG.indexOf(lo)]!.t;
    const total = {
      lkr: (last.priceLkr / first.priceLkr - 1) * 100,
      usd: (last.priceUsd / first.priceUsd - 1) * 100,
      fx: (fx(last) / fx(first) - 1) * 100,
    };
    return { series, change, hi, lo, hiAt, loAt, total, from: first.t, days: Math.round((last.t - first.t) / DAY) };
  }, [points]);

  const nowG = pureLkrPerGram ?? (model ? model.hi : null);
  const pos = model && nowG != null && model.hi > model.lo ? Math.min(1, Math.max(0, (nowG - model.lo) / (model.hi - model.lo))) : null;

  return (
    <section className="g-surface overflow-hidden">
      <PanelHead
        kicker="Performance"
        title="Gold over the year · rupee vs dollar"
        right={
          model ? (
            <span className="text-[11px] text-ink-5">
              {model.days} days since {new Date(model.from).toLocaleDateString()} · {hist.source === "yahoo" ? "Yahoo Finance history" : "recorded spot"}
            </span>
          ) : null
        }
      />
      {hist.isLoading ? (
        <div className="space-y-3 p-4">
          <Shimmer className="h-16" />
          <Shimmer className="h-52" />
        </div>
      ) : !model ? (
        <EmptyBlock title="Not enough history yet" description="Performance builds up as the market feed keeps running. Check back after a few days." />
      ) : (
        <div className="grid xl:grid-cols-12">
          {/* period returns + range */}
          <div className="border-b border-ink/20 xl:col-span-5 xl:border-b-0 xl:border-r">
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 px-4 pb-1 pt-3 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">
              <span>Period</span>
              <span className="w-16 text-right">In LKR</span>
              <span className="w-14 text-right">In USD</span>
              <span className="w-14 text-right" title="Change in USD/LKR; positive means the rupee weakened">Rupee</span>
            </div>
            {[{ label: "24 hours", d: 1 }, ...LOOKBACKS].map((l) => {
              const c = l.d === 1 ? (change24hPct != null ? { lkr: change24hPct, usd: null, fx: null } : model.change(1)) : model.change(l.d);
              return (
                <div key={l.label} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 border-t border-ink/20 px-4 py-[7px] text-[12px]">
                  <span className="font-semibold text-ink-2">{l.label}</span>
                  <span className={cn("g-metric w-16 text-right font-semibold", pctTone(c?.lkr))}>{pct(c?.lkr)}</span>
                  <span className={cn("g-metric w-14 text-right", pctTone(c?.usd))}>{pct(c?.usd)}</span>
                  <span className={cn("g-metric w-14 text-right", c?.fx == null ? "text-ink-6" : "text-sky-700")}>{pct(c?.fx)}</span>
                </div>
              );
            })}
            {/* 52-week range */}
            <div className="border-t border-ink/20 bg-bone/40 px-4 py-3.5">
              <div className="flex items-center justify-between text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">
                <span>Range · pure gold per gram</span>
                {pos != null ? <span className="text-ink-4">{Math.round(pos * 100)}% of range</span> : null}
              </div>
              <div className="relative mt-3 h-2 rounded-full bg-gradient-to-r from-rose-500/25 via-amber-400/30 to-emerald-500/30">
                {pos != null ? (
                  <span
                    className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-void ring-[3px] ring-paper shadow-[0_2px_8px_rgba(6,42,34,0.5)] transition-[left] duration-700 ease-brand"
                    style={{ left: `${pos * 100}%` }}
                    title={`Now ${money(conv(nowG!))} ${display}/g`}
                  />
                ) : null}
              </div>
              <div className="mt-2 flex justify-between text-[11px]">
                <span>
                  <span className="block text-[9.5px] uppercase tracking-wider text-ink-5">Low · {fmtDay(model.loAt)}</span>
                  <span className="g-metric font-semibold text-ink">{money(conv(model.lo))}</span>
                </span>
                {nowG != null ? (
                  <span className="text-center">
                    <span className="block text-[9.5px] uppercase tracking-wider text-ink-5">Now</span>
                    <LiveNumber value={conv(nowG)} className="font-semibold text-ink" />
                  </span>
                ) : null}
                <span className="text-right">
                  <span className="block text-[9.5px] uppercase tracking-wider text-ink-5">High · {fmtDay(model.hiAt)}</span>
                  <span className="g-metric font-semibold text-ink">{money(conv(model.hi))}</span>
                </span>
              </div>
            </div>
          </div>

          {/* indexed chart */}
          <div className="flex flex-col xl:col-span-7">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-3 text-[11px]">
              <Legend color="#CDA853" label="Gold in LKR" value={pct(model.total.lkr, 1)} />
              <Legend color="#64748B" label="Gold in USD" value={pct(model.total.usd, 1)} />
              <Legend color="#0284C7" label="USD/LKR" value={pct(model.total.fx, 1)} dashed />
              <span className="ml-auto text-[10px] text-ink-5">Start of history = 100</span>
            </div>
            <div className="h-[230px] px-1 pb-2 pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={model.series} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(16,32,27,0.06)" vertical={false} />
                  <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={fmtDay} tick={{ fontSize: 10, fill: "#93A29C" }} axisLine={false} tickLine={false} minTickGap={40} />
                  <YAxis tick={{ fontSize: 10, fill: "#93A29C" }} axisLine={false} tickLine={false} width={36} domain={["auto", "auto"]} tickFormatter={(v) => Number(v).toFixed(0)} />
                  <ReferenceLine y={100} stroke="rgba(16,32,27,0.25)" strokeDasharray="3 3" />
                  <Tooltip
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <DarkTip>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-light/80">{fmtDay(Number(label))}</div>
                          {payload.map((p) => (
                            <div key={String(p.dataKey)} className="mt-1 flex items-center justify-between gap-4 text-[11.5px]">
                              <span className="flex items-center gap-1.5 text-paper/60">
                                <span className="size-2 rounded-full" style={{ background: p.color }} />
                                {p.name}
                              </span>
                              <span className="g-metric">{pct(Number(p.value) - 100, 1)}</span>
                            </div>
                          ))}
                        </DarkTip>
                      ) : null
                    }
                  />
                  <Line type="monotone" dataKey="fx" name="USD/LKR" stroke="#0284C7" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                  <Line type="monotone" dataKey="usd" name="Gold in USD" stroke="#64748B" strokeWidth={1.75} dot={false} />
                  <Line type="monotone" dataKey="lkr" name="Gold in LKR" stroke="#CDA853" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="border-t border-ink/20 bg-bone/50 px-4 py-2 text-[11px] text-ink-4">
              {Math.abs(model.total.fx) < 0.05 ? (
                <>The rupee was steady, so the rupee price simply followed world gold.</>
              ) : (
                <>
                  Gold moved <b className={pctTone(model.total.usd)}>{pct(model.total.usd, 1)}</b> in dollars; the rupee{" "}
                  {model.total.fx > 0 ? "weakened" : "strengthened"} <b className="text-sky-700">{Math.abs(model.total.fx).toFixed(1)}%</b>, which{" "}
                  {(model.total.fx > 0) === (model.total.usd >= 0) ? "added to" : "offset"} the move, for{" "}
                  <b className={pctTone(model.total.lkr)}>{pct(model.total.lkr, 1)}</b> in LKR.
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Legend({ color, label, value, dashed }: { color: string; label: string; value: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-0.5 w-4 rounded-full", dashed && "bg-[length:5px_2px]")} style={{ background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 6px)` : color }} />
      <span className="text-ink-4">{label}</span>
      <span className="g-metric font-semibold text-ink">{value}</span>
    </span>
  );
}

/* ================================================================ VAULT VALUE */

type Stages = { stages: { old_gold_mg: number; melting_mg: number; refined_mg: number; for_sale_mg: number } };
type ByPurity = { byPurity: { permille: number; fine_mg: number }[] };

const STAGES = [
  { key: "for_sale_mg", label: "For sale", hint: "Finished pieces", color: "#059669" },
  { key: "old_gold_mg", label: "Old gold", hint: "Bought in, awaiting melt", color: "#D97706" },
  { key: "melting_mg", label: "Melting", hint: "Locked or melted batches", color: "#CDA853" },
  { key: "refined_mg", label: "Refined", hint: "Approved melt output", color: "#7E6223" },
] as const;

/** The shop's fine gold, valued at live spot. */
export function VaultValue({
  pureLkrPerGram,
  change24hPct,
  conv,
  display,
  className,
}: {
  pureLkrPerGram: number | null;
  change24hPct: number | null;
  conv: (lkr: number) => number;
  display: string;
  className?: string;
}) {
  const opt = { retry: false, staleTime: 60_000 } as const;
  const stages = useQuery({ ...opt, queryKey: ["gold-stock", "stage"], queryFn: () => api<Stages>("/api/v1/gold/stock?groupBy=stage") });
  const purity = useQuery({ ...opt, queryKey: ["gold-stock", "purity"], queryFn: () => api<ByPurity>("/api/v1/gold/stock?groupBy=purity") });

  const rows = STAGES.map((s) => {
    const g = (stages.data?.stages[s.key] ?? 0) / 1000;
    return { ...s, g, value: pureLkrPerGram != null ? conv(g * pureLkrPerGram) : null };
  });
  const totalG = rows.reduce((a, r) => a + r.g, 0);
  const total = pureLkrPerGram != null ? conv(totalG * pureLkrPerGram) : null;
  // Yesterday's value at yesterday's price: today ÷ (1 + move).
  const dayMove = total != null && change24hPct != null ? total - total / (1 + change24hPct / 100) : null;
  const pie = rows.filter((r) => r.g > 0);

  return (
    <section className={cn("g-surface flex flex-col overflow-hidden", className)}>
      <PanelHead
        kicker="Vault"
        title={`Your gold at today's rate · ${display}`}
        right={<a href="/gold/stock" className="text-[11px] font-semibold text-gold-dark hover:text-ink">Stock →</a>}
      />
      {stages.isLoading ? (
        <div className="space-y-3 p-4">
          <Shimmer className="h-40" />
          <Shimmer className="h-20" />
        </div>
      ) : stages.isError ? (
        <EmptyBlock title="Stock unavailable" description="Gold stock could not be loaded." />
      ) : totalG <= 0 ? (
        <EmptyBlock title="No gold in stock" description="Fine gold held across stages will be valued here at the live rate." />
      ) : (
        <>
          <div className="flex items-center gap-4 px-4 pt-4">
            <div className="relative size-[132px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pie} dataKey="g" nameKey="label" innerRadius={44} outerRadius={64} paddingAngle={pie.length > 1 ? 2 : 0} stroke="none" startAngle={90} endAngle={-270}>
                    {pie.map((r) => (
                      <Cell key={r.key} fill={r.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center leading-none">
                <span className="g-metric text-[15px] font-bold text-ink">{totalG.toLocaleString("en-US", { maximumFractionDigits: 1 })}</span>
                <span className="mt-1 text-[9.5px] uppercase tracking-wider text-ink-5">fine g</span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">Market value</div>
              {total != null ? <LiveNumber value={total} className="mt-1 block truncate text-[24px] font-bold leading-none text-ink" /> : <Shimmer className="mt-1 h-6 w-32" />}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-5">
                <ChangeChip pct={change24hPct} className="px-1.5 py-px text-[10px]" />
                {dayMove != null ? (
                  <span className={cn("g-metric font-semibold", pctTone(dayMove))}>
                    {dayMove > 0 ? "+" : ""}
                    {money(dayMove)} today
                  </span>
                ) : null}
              </div>
              <div className="mt-1.5 text-[10.5px] text-ink-5">Fine weight × pure spot · before making & premium</div>
            </div>
          </div>
          <div className="mt-3 flex-1 px-4 pb-2">
            {rows.map((r) => (
              <div key={r.key} className="flex items-center gap-2.5 border-t border-ink/20 py-[7px] text-[12px]">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ background: r.color }} />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-ink-2">{r.label}</span>
                  <span className="ml-1.5 text-[10px] text-ink-5">{r.hint}</span>
                </span>
                <span className="g-metric w-16 text-right text-ink-4">{r.g.toLocaleString("en-US", { maximumFractionDigits: 1 })} g</span>
                <span className="g-metric w-24 text-right font-semibold text-ink">{r.value != null ? money(r.value) : "—"}</span>
              </div>
            ))}
          </div>
          {purity.data?.byPurity.length ? (
            <div className="border-t border-ink/20 bg-bone/50 px-4 py-2.5">
              <div className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">By purity · fine grams</div>
              <div className="flex h-2 overflow-hidden rounded-full bg-ink/[0.06]">
                {purity.data.byPurity.map((p) => (
                  <span key={p.permille} style={{ width: `${(p.fine_mg / 1000 / totalG) * 100}%`, background: karatTone(p.permille / 1000).hex }} title={`${p.permille}‰ · ${(p.fine_mg / 1000).toFixed(1)} g`} />
                ))}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-ink-4">
                {purity.data.byPurity.map((p) => (
                  <span key={p.permille} className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full" style={{ background: karatTone(p.permille / 1000).hex }} />
                    {p.permille}‰ <span className="g-metric font-semibold text-ink-2">{(p.fine_mg / 1000).toFixed(1)} g</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/* ================================================================ BUY-BACK & PAWNING */

/**
 * Counter prices for gold coming in: what to pay for old gold after the melt
 * deduction, and how much to lend against it as a pawn.
 */
export function BuyBackDesk({
  karats,
  conv,
  display,
  className,
}: {
  karats: BizKarat[];
  conv: (lkr: number) => number;
  display: string;
  className?: string;
}) {
  const [deduct, setDeduct] = useStoredNumber("goldos.desk.deduct", 5);
  const [ltv, setLtv] = useStoredNumber("goldos.desk.ltv", 75);
  const [basis, setBasis] = useState<"g" | "pawn">("pawn");
  const w = basis === "pawn" ? PAWN_G : 1;
  const maxBoard = Math.max(1, ...karats.map((k) => Math.max(k.lkrPerGram, k.boardRate ?? 0)));

  return (
    <section className={cn("g-surface flex flex-col overflow-hidden", className)}>
      <PanelHead
        kicker="Counter desk"
        title={`Buy-back & pawning · ${display}`}
        right={<Segmented ariaLabel="Price basis" value={basis} onChange={setBasis} items={[{ key: "pawn", label: "Per pawn" }, { key: "g", label: "Per gram" }]} />}
      />
      <div className="grid gap-px bg-ink/[0.05] sm:grid-cols-2">
        <Slider label="Old-gold deduction" hint="melt loss, testing & margin" value={deduct} min={0} max={20} step={0.5} suffix="%" onChange={setDeduct} />
        <Slider label="Pawn loan-to-value" hint="advance as share of market" value={ltv} min={40} max={95} step={1} suffix="%" onChange={setLtv} />
      </div>
      {!karats.length ? (
        <EmptyBlock title="No karats" description="Gold spot is unavailable or no purities are active." />
      ) : (
        <div className="flex-1 overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[620px] text-[12px]">
            <thead>
              <tr className="bg-bone/60 text-left text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">
                <th className="py-2 pl-4 pr-2 font-semibold">Karat</th>
                <th className="px-2 text-right font-semibold">Market</th>
                <th className="px-2 text-right font-semibold">We buy</th>
                <th className="px-2 text-right font-semibold">Pawn advance</th>
                <th className="px-2 text-right font-semibold">Board sell</th>
                <th className="w-[150px] px-3 pr-4 font-semibold">Buy → sell spread</th>
              </tr>
            </thead>
            <tbody>
              {karats.map((k) => {
                const kt = karatTone(k.purity);
                const buy = k.lkrPerGram * (1 - deduct / 100);
                const pawn = k.lkrPerGram * (ltv / 100);
                const sell = k.boardRate;
                const margin = sell != null && buy > 0 ? ((sell - buy) / buy) * 100 : null;
                return (
                  <tr key={k.purityId} className="border-t border-ink/20 transition-colors hover:bg-bone/60">
                    <td className="py-2 pl-4 pr-2">
                      <span className={cn("inline-flex h-6 w-10 items-center justify-center rounded-md font-display text-[11px] font-extrabold shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]", kt.badge)}>{k.karat}</span>
                    </td>
                    <td className="g-metric px-2 text-right text-ink-4">{money(conv(k.lkrPerGram * w))}</td>
                    <td className="px-2 text-right">
                      <LiveNumber value={conv(buy * w)} className="font-semibold text-ink" />
                    </td>
                    <td className="g-metric px-2 text-right font-semibold text-sky-800">{money(conv(pawn * w))}</td>
                    <td className="g-metric px-2 text-right text-ink-3">{sell != null ? money(conv(sell * w)) : <span className="font-sans text-[10.5px] text-ink-5">not set</span>}</td>
                    <td className="px-3 pr-4">
                      {/* buy, market and board on one scale */}
                      <div className="relative h-2 rounded-full bg-ink/[0.05]">
                        <span
                          className="absolute inset-y-0 rounded-full bg-gradient-to-r from-amber-400/60 to-emerald-500/70"
                          style={{ left: `${(buy / maxBoard) * 100}%`, width: `${Math.max(1, (((sell ?? k.lkrPerGram) - buy) / maxBoard) * 100)}%` }}
                        />
                        <span className="absolute -top-0.5 h-3 w-px bg-ink/50" style={{ left: `${(k.lkrPerGram / maxBoard) * 100}%` }} title="Market" />
                      </div>
                      <div className={cn("g-metric mt-1 text-right text-[10px] font-semibold", margin == null ? "text-ink-5" : margin >= 0 ? "text-emerald-700" : "text-rose-700")}>
                        {margin == null ? "no board rate" : `${pct(margin, 1)} gross`}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-ink/20 bg-bone/50 px-4 py-1.5 text-[10px] text-ink-5">
        We buy = market × (1 − deduction) · advance = market × LTV · settings saved on this device
      </div>
    </section>
  );
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (n: number) => void;
}) {
  return (
    <label className="block bg-paper px-4 py-2.5">
      <span className="flex items-baseline justify-between">
        <span className="text-[11.5px] font-semibold text-ink-2">
          {label} <span className="font-normal text-ink-5">· {hint}</span>
        </span>
        <span className="g-metric text-[13px] font-bold text-ink">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-ink/[0.08] accent-[#062a22]"
      />
    </label>
  );
}

/* ================================================================ RETAIL QUOTE */

/** Price a finished piece for a customer: gold + wastage + making + stones + tax. */
export function RetailQuote({
  karats,
  conv,
  display,
  className,
}: {
  karats: BizKarat[];
  conv: (lkr: number) => number;
  display: string;
  className?: string;
}) {
  const [weight, setWeight] = useState("10");
  const [karatId, setKaratId] = useState("");
  const [rateBasis, setRateBasis] = useState<"board" | "market">("board");
  const [makingMode, setMakingMode] = useState<"pct" | "perg">("pct");
  const [making, setMaking] = useStoredNumber("goldos.quote.making", 12);
  const [makingPerG, setMakingPerG] = useStoredNumber("goldos.quote.makingPerG", 2500);
  const [wastage, setWastage] = useStoredNumber("goldos.quote.wastage", 3);
  const [tax, setTax] = useStoredNumber("goldos.quote.tax", 0);
  const [stones, setStones] = useState("0");

  const k = karats.find((x) => x.purityId === karatId) ?? karats.find((x) => x.karat === "22K") ?? karats[0];
  const g = Math.max(0, Number(weight) || 0);
  const rate = k ? conv(rateBasis === "board" && k.boardRate != null ? k.boardRate : k.lkrPerGram) : 0;
  const usingMarket = rateBasis === "market" || k?.boardRate == null;
  const goldV = g * rate;
  const wasteV = goldV * (wastage / 100);
  const makeV = makingMode === "pct" ? goldV * (making / 100) : conv(g * makingPerG);
  const stoneV = Math.max(0, Number(stones) || 0);
  const sub = goldV + wasteV + makeV + stoneV;
  const taxV = sub * (tax / 100);
  const total = sub + taxV;
  const parts = [
    { label: "Gold", v: goldV, color: "#CDA853" },
    { label: "Wastage", v: wasteV, color: "#D97706" },
    { label: "Making", v: makeV, color: "#059669" },
    { label: "Stones", v: stoneV, color: "#7C3AED" },
    { label: "Tax", v: taxV, color: "#64748B" },
  ];
  const marketGold = k ? g * conv(k.lkrPerGram) : 0;
  const overMarket = marketGold > 0 ? ((total - marketGold) / marketGold) * 100 : null;

  return (
    <section className={cn("g-surface flex flex-col overflow-hidden", className)}>
      <PanelHead
        kicker="Quote builder"
        title={`Price a piece · ${display}`}
        right={<Segmented ariaLabel="Gold rate" value={rateBasis} onChange={setRateBasis} items={[{ key: "board", label: "Board" }, { key: "market", label: "Market" }]} />}
      />
      <div className="grid grid-cols-2 gap-3 px-4 pt-3">
        <Field label="Weight (g)">
          <input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Karat">
          <Select ariaLabel="Karat" value={k?.purityId ?? ""} onChange={setKaratId} options={karats.map((x) => ({ value: x.purityId, label: x.karat }))} />
        </Field>
        <Field
          label={
            <span className="flex items-center justify-between">
              Making
              <span className="flex gap-0.5">
                {(["pct", "perg"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMakingMode(m)}
                    className={cn("rounded px-1.5 text-[9.5px] font-bold", makingMode === m ? "bg-void text-gold-light" : "text-ink-5 hover:text-ink")}
                  >
                    {m === "pct" ? "%" : "/g"}
                  </button>
                ))}
              </span>
            </span>
          }
        >
          {makingMode === "pct" ? (
            <input inputMode="decimal" value={making} onChange={(e) => setMaking(Number(e.target.value) || 0)} className={inputCls} />
          ) : (
            <input inputMode="decimal" value={makingPerG} onChange={(e) => setMakingPerG(Number(e.target.value) || 0)} className={inputCls} title="LKR per gram" />
          )}
        </Field>
        <Field label="Wastage %">
          <input inputMode="decimal" value={wastage} onChange={(e) => setWastage(Number(e.target.value) || 0)} className={inputCls} />
        </Field>
        <Field label={`Stones (${display})`}>
          <input inputMode="decimal" value={stones} onChange={(e) => setStones(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Tax / VAT %">
          <input inputMode="decimal" value={tax} onChange={(e) => setTax(Number(e.target.value) || 0)} className={inputCls} />
        </Field>
      </div>

      <div className="mx-4 mt-4 rounded-xl bg-void p-3.5 text-paper shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="flex items-baseline justify-between">
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-gold-light/70">Customer price</span>
          {overMarket != null ? <span className="g-metric text-[10.5px] text-paper/50">{pct(overMarket, 1)} over metal value</span> : null}
        </div>
        <LiveNumber value={total} tone="dark" className="mt-1 block text-[26px] font-bold leading-none text-gold-light" />
        <div className="mt-1 text-[10.5px] text-paper/45">
          {g > 0 ? `${money(total / g)} ${display}/g effective` : "Enter a weight"} · {usingMarket ? "market" : "board"} rate {money(rate)}
        </div>
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-paper/10">
          {total > 0 ? parts.map((p) => (p.v > 0 ? <span key={p.label} style={{ width: `${(p.v / total) * 100}%`, background: p.color }} /> : null)) : null}
        </div>
      </div>
      <div className="flex-1 px-4 py-2">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center justify-between border-t border-ink/20 py-[5px] text-[12px] first:border-t-0">
            <span className="flex items-center gap-2 text-ink-3">
              <span className="size-2 rounded-sm" style={{ background: p.color }} />
              {p.label}
              {total > 0 && p.v > 0 ? <span className="text-[10px] text-ink-5">{((p.v / total) * 100).toFixed(1)}%</span> : null}
            </span>
            <span className="g-metric font-semibold text-ink">{money(p.v)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-5">{label}</div>
      {children}
    </div>
  );
}

/* ================================================================ BOARD HISTORY */

type RateRow = { id: string; purity_id: string; karat: string; rate_per_gram: number; effective_from: number };

/** The shop's published board as a step line over the market for that karat. */
export function BoardHistory({
  karats,
  conv,
  display,
  className,
}: {
  karats: BizKarat[];
  conv: (lkr: number) => number;
  display: string;
  className?: string;
}) {
  const [karatId, setKaratId] = useState("");
  const [range, setRange] = useState<"30d" | "1y">("30d");
  const k = karats.find((x) => x.purityId === karatId) ?? karats.find((x) => x.karat === "22K") ?? karats[0];
  const hist = useGoldHistory(range);
  const rates = useQuery({
    queryKey: ["gold-rates-history", "karat", k?.karat],
    queryFn: () => api<{ rows: RateRow[] }>(`/api/v1/gold-rates?limit=100&search=${encodeURIComponent(k!.karat)}`),
    enabled: !!k,
    staleTime: 60_000,
  });

  const model = useMemo(() => {
    if (!k) return null;
    const board = (rates.data?.rows ?? []).filter((r) => r.purity_id === k.purityId).sort((a, b) => a.effective_from - b.effective_from);
    const pts = (hist.data?.points ?? []).filter((p) => p.lkrPerGram != null);
    if (pts.length < 2) return { series: [], board, changes: 0, avgSpread: null as number | null };
    const start = pts[0]!.t;
    let bi = -1;
    const series = pts.map((p) => {
      while (bi + 1 < board.length && board[bi + 1]!.effective_from <= p.t) bi++;
      const market = conv(p.lkrPerGram! * k.purity);
      const b = bi >= 0 ? conv(board[bi]!.rate_per_gram) : null;
      return { t: p.t, market, board: b, spread: b != null ? ((b - market) / market) * 100 : null };
    });
    const withBoard = series.filter((s) => s.spread != null);
    return {
      series,
      board,
      changes: board.filter((r) => r.effective_from >= start).length,
      avgSpread: withBoard.length ? withBoard.reduce((a, s) => a + s.spread!, 0) / withBoard.length : null,
    };
  }, [k, rates.data, hist.data, conv]);

  const last = model?.board[model.board.length - 1];

  return (
    <section className={cn("g-surface flex flex-col overflow-hidden", className)}>
      <PanelHead
        kicker="Board history"
        title={`Your ${k?.karat ?? ""} board vs market · ${display}/g`}
        right={
          <>
            <div className="flex gap-1">
              {karats.map((x) => {
                const on = x.purityId === k?.purityId;
                return (
                  <button
                    key={x.purityId}
                    type="button"
                    onClick={() => setKaratId(x.purityId)}
                    className={cn(
                      "h-6 rounded-md px-2 font-display text-[10.5px] font-extrabold transition-all duration-200",
                      on ? cn(karatTone(x.purity).badge, "shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]") : "bg-ink/[0.05] text-ink-4 hover:bg-ink/[0.09]"
                    )}
                  >
                    {x.karat}
                  </button>
                );
              })}
            </div>
            <Segmented ariaLabel="Range" value={range} onChange={setRange} items={[{ key: "30d", label: "30D" }, { key: "1y", label: "1Y" }]} />
          </>
        }
      />
      <div className="grid grid-cols-3 gap-px border-b border-ink/20 bg-ink/[0.05]">
        <Stat
          label="Current board"
          value={k?.boardRate != null ? money(conv(k.boardRate)) : <span className="font-sans text-[13px] text-ink-4">Not set</span>}
          sub={last ? `set ${new Date(last.effective_from).toLocaleDateString()}` : k ? `market ${money(conv(k.lkrPerGram))}` : "Not published"}
        />
        <Stat
          label="Avg board vs market"
          value={<span className={model?.avgSpread == null ? undefined : model.avgSpread >= 0 ? "text-emerald-700" : "text-rose-700"}>{pct(model?.avgSpread, 2)}</span>}
          sub={`over ${range === "30d" ? "30 days" : "the year"}`}
        />
        <Stat label="Rate changes" value={model?.changes ?? "—"} sub={`published in ${range === "30d" ? "30 days" : "the year"}`} />
      </div>
      <div className="h-[240px] flex-1 px-1 pb-2 pt-3">
        {hist.isLoading || rates.isLoading ? (
          <Shimmer className="mx-3 h-full" />
        ) : !model?.series.length ? (
          <EmptyBlock title="Not enough history yet" description="The chart fills in as the market feed records prices." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={model.series} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="bh-market" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#CDA853" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#CDA853" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(16,32,27,0.06)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={fmtDay} tick={{ fontSize: 10, fill: "#93A29C" }} axisLine={false} tickLine={false} minTickGap={40} />
              <YAxis tick={{ fontSize: 10, fill: "#93A29C" }} axisLine={false} tickLine={false} width={58} domain={["auto", "auto"]} tickFormatter={(v) => money(Number(v))} />
              <Tooltip
                content={({ active, payload, label }) => {
                  const row = payload?.[0]?.payload as (typeof model.series)[number] | undefined;
                  return active && row ? (
                    <DarkTip>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-light/80">
                        {new Date(Number(label)).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div className="mt-1 flex justify-between gap-4 text-[11.5px]">
                        <span className="text-paper/55">Market</span>
                        <span className="g-metric">{money(row.market)}</span>
                      </div>
                      <div className="flex justify-between gap-4 text-[11.5px]">
                        <span className="text-paper/55">Your board</span>
                        <span className="g-metric">{row.board != null ? money(row.board) : "—"}</span>
                      </div>
                      {row.spread != null ? (
                        <div className={cn("mt-0.5 text-right text-[11px] font-semibold", row.spread >= 0 ? "text-emerald-300" : "text-rose-300")}>{pct(row.spread)}</div>
                      ) : null}
                    </DarkTip>
                  ) : null;
                }}
              />
              <Area type="monotone" dataKey="market" name="Market" stroke="#CDA853" strokeWidth={2} fill="url(#bh-market)" dot={false} />
              <Line type="stepAfter" dataKey="board" name="Your board" stroke="#062A22" strokeWidth={2} dot={false} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="flex items-center gap-4 border-t border-ink/20 bg-bone/50 px-4 py-1.5 text-[10.5px] text-ink-5">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-gradient-to-b from-gold/50 to-gold/10" /> Market (spot × purity)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-void" /> Your published board
        </span>
      </div>
    </section>
  );
}
