"use client";

// Extra market graphs for the Live Rates board: every market indexed on one
// chart, gold's step-by-step moves, and the shop's board against the market
// per karat. Each chart has a rich hover tooltip with the underlying figures.
import { useMemo, useState } from "react";
import { useMarketSeries } from "./series";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/cn";
import { MetalCoin, PanelHead, Segmented, Shimmer, karatTone, money, symbolTone } from "./parts";

type Pt = { t: number; priceUsd: number; priceLkr: number; lkrPerGram: number | null };
type QuoteLite = { symbol: string; name: string; change24hPct: number | null };
type KaratLite = { purityId: string; karat: string; purity: number; lkrPerGram: number; boardRate: number | null };

const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtWhen = (t: number) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const sgn = (n: number, dp = 2) => `${n > 0 ? "+" : ""}${n.toFixed(dp)}%`;
const toneOf = (n: number) => (n > 0 ? "text-emerald-300" : n < 0 ? "text-rose-300" : "text-paper/70");

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-[200px] rounded-xl bg-void/[0.97] px-3.5 py-2.5 text-paper shadow-[0_24px_48px_-16px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(226,194,122,0.22)] backdrop-blur">
      {children}
    </div>
  );
}

/** Calm placeholder that still looks like a chart while samples accumulate. */
function Building({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("relative mx-3 flex flex-col items-center justify-center overflow-hidden rounded-xl bg-gradient-to-b from-gold-pale/70 to-paper text-center shadow-[inset_0_0_0_1px_rgba(168,138,62,0.15)]", className)}>
      <svg className="absolute inset-x-0 bottom-0 h-24 w-full text-gold/25" viewBox="0 0 400 100" preserveAspectRatio="none" aria-hidden>
        <path d="M0 70 C 60 62, 90 44, 140 52 S 230 30, 280 40 S 360 22, 400 28 L400 100 L0 100Z" fill="currentColor" />
      </svg>
      <div className="relative px-6">
        <div className="font-display text-sm font-bold text-ink">Recording samples</div>
        <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-ink-4">{text}</p>
      </div>
    </div>
  );
}

/* ================================================================ RELATIVE PERFORMANCE */

/** Every market rebased to 100 at the start of the day, so moves compare directly. */
export function RelativePerformance({ dayBy, quotes, className }: { dayBy: Record<string, Pt[]>; quotes: QuoteLite[]; className?: string }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const symbols = quotes.map((q) => q.symbol).filter((s) => (dayBy[s]?.length ?? 0) > 0);
  const { rows, last } = useMemo(() => {
    const byT = new Map<number, Record<string, number>>();
    const last: Record<string, number> = {};
    for (const s of symbols) {
      const pts = dayBy[s] ?? [];
      const base = pts[0]?.priceUsd;
      if (!base) continue;
      for (const p of pts) {
        // Snapshots for all markets share a timestamp; the live close may differ by a few seconds.
        const key = Math.round(p.t / 60_000) * 60_000;
        const row = byT.get(key) ?? {};
        row[s] = (p.priceUsd / base) * 100;
        byT.set(key, row);
        last[s] = row[s]!;
      }
    }
    return { rows: [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, r]) => ({ t, ...r })), last };
  }, [dayBy, symbols.join()]);
  const name = (s: string) => quotes.find((q) => q.symbol === s)?.name ?? s;
  const ranked = [...symbols].sort((a, b) => (last[b] ?? 100) - (last[a] ?? 100));
  const toggle = (s: string) =>
    setHidden((h) => {
      const n = new Set(h);
      n.has(s) ? n.delete(s) : n.add(s);
      return n;
    });

  return (
    <section className={cn("g-surface flex flex-col overflow-hidden", className)}>
      <PanelHead kicker="Relative performance" title="All markets · indexed to 100 · last 24 h" right={<span className="text-[10.5px] text-ink-5">Tap a market to hide it</span>} />
      <div className="flex flex-wrap gap-1.5 px-4 pt-3">
        {ranked.map((s, i) => {
          const chg = (last[s] ?? 100) - 100;
          const off = hidden.has(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold transition-all duration-200",
                off ? "bg-ink/[0.03] text-ink-6 line-through" : "bg-paper text-ink-2 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)] hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.25)]"
              )}
            >
              <span className="g-metric text-[9.5px] text-ink-5">#{i + 1}</span>
              <MetalCoin symbol={s} size={14} />
              {name(s)}
              <span className={cn("g-metric", off ? "" : chg > 0 ? "text-emerald-700" : chg < 0 ? "text-rose-700" : "text-ink-4")}>{sgn(chg)}</span>
            </button>
          );
        })}
      </div>
      <div className="h-[260px] flex-1 px-1 pb-2 pt-2">
        {rows.length < 2 ? (
          <Building className="h-full" text="Each market is sampled every 10 minutes. Lines appear after the second sample." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 10, right: 14, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(16,32,27,0.06)" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={fmtTime} tick={{ fontSize: 10, fill: "#93A29C" }} axisLine={false} tickLine={false} minTickGap={48} />
              <YAxis domain={["auto", "auto"]} width={44} tick={{ fontSize: 10, fill: "#93A29C" }} axisLine={false} tickLine={false} tickFormatter={(v) => Number(v).toFixed(1)} />
              <ReferenceLine y={100} stroke="rgba(16,32,27,0.3)" strokeDasharray="3 3" />
              <Tooltip
                cursor={{ stroke: "rgba(168,138,62,0.5)", strokeDasharray: "3 3" }}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <Tip>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-light/80">{fmtWhen(Number(label))}</div>
                      <div className="mt-1.5 space-y-1">
                        {[...payload]
                          .sort((a, b) => Number(b.value) - Number(a.value))
                          .map((p) => {
                            const v = Number(p.value) - 100;
                            return (
                              <div key={String(p.dataKey)} className="flex items-center justify-between gap-4 text-[11.5px]">
                                <span className="flex items-center gap-1.5 text-paper/65">
                                  <span className="size-2 rounded-full" style={{ background: p.color }} />
                                  {name(String(p.dataKey))}
                                </span>
                                <span className={cn("g-metric", toneOf(v))}>{sgn(v)}</span>
                              </div>
                            );
                          })}
                      </div>
                      <div className="mt-2 border-t border-paper/10 pt-1.5 text-[10px] text-paper/40">Change since the first sample of the day, in USD.</div>
                    </Tip>
                  ) : null
                }
              />
              {symbols
                .filter((s) => !hidden.has(s))
                .map((s) => (
                  <Line
                    key={s}
                    type="monotone"
                    dataKey={s}
                    stroke={symbolTone(s)}
                    strokeWidth={s === "XAU" ? 2.6 : 1.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                    activeDot={{ r: 3.5, stroke: "#fff", strokeWidth: 1.5 }}
                  />
                ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

/* ================================================================ GOLD MOVES */

/** Gold's step-by-step returns as green/red bars, with the biggest moves called out. */
export function GoldMoves({ conv, display, purity, className }: { conv: (lkr: number) => number; display: string; purity: number; className?: string }) {
  const [range, setRange] = useState<"1d" | "7d">("7d");
  const hist = useMarketSeries("XAU", range);
  // Even steps whatever the source: the last price in each hour (24H) or 4-hour block (7D).
  const bucketMs = range === "1d" ? 3_600_000 : 4 * 3_600_000;
  const model = useMemo(() => {
    const raw = (hist.data?.points ?? []).filter((p) => p.lkrPerGram != null);
    const pts = [...new Map(raw.map((p) => [Math.floor(p.t / bucketMs), p])).values()];
    const rows = pts.slice(1).map((p, i) => {
      const prev = pts[i]!;
      const price = conv(p.lkrPerGram! * purity);
      const before = conv(prev.lkrPerGram! * purity);
      return { t: p.t, from: prev.t, price, before, amt: price - before, pct: before ? ((price - before) / before) * 100 : 0 };
    });
    if (!rows.length) return null;
    const up = rows.filter((r) => r.pct > 0);
    const down = rows.filter((r) => r.pct < 0);
    const best = rows.reduce((a, r) => (r.pct > a.pct ? r : a));
    const worst = rows.reduce((a, r) => (r.pct < a.pct ? r : a));
    const avgAbs = rows.reduce((a, r) => a + Math.abs(r.pct), 0) / rows.length;
    const net = rows[rows.length - 1]!.price - rows[0]!.before;
    let streak = 0;
    const dir = Math.sign(rows[rows.length - 1]!.pct);
    for (let i = rows.length - 1; i >= 0 && dir !== 0 && Math.sign(rows[i]!.pct) === dir; i--) streak++;
    return { rows, up: up.length, down: down.length, best, worst, avgAbs, net, streak, dir };
  }, [hist.data, conv, purity, bucketMs]);
  const step = range === "7d" ? "4h block" : "hour";

  return (
    <section className={cn("g-surface flex flex-col overflow-hidden", className)}>
      <PanelHead
        kicker="Momentum"
        title={`Gold moves per ${step} · ${display}/g`}
        right={<Segmented ariaLabel="Range" value={range} onChange={setRange} items={[{ key: "1d", label: "24H" }, { key: "7d", label: "7D" }]} />}
      />
      <div className="grid flex-1 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="grid grid-cols-2 gap-px border-b border-ink/[0.06] bg-ink/[0.05] lg:grid-cols-1 lg:border-b-0 lg:border-r">
          {hist.isLoading
            ? [0, 1, 2, 3].map((i) => (
                <div key={i} className="bg-paper p-3">
                  <Shimmer className="h-8" />
                </div>
              ))
            : [
                {
                  k: "Up / down",
                  v: model ? (
                    <>
                      <span className="text-emerald-700">▲ {model.up}</span> <span className="text-ink-6">/</span> <span className="text-rose-700">▼ {model.down}</span>
                    </>
                  ) : (
                    "—"
                  ),
                  sub: model ? `${Math.round((model.up / Math.max(1, model.up + model.down)) * 100)}% of ${step}s rose` : "waiting for samples",
                },
                {
                  k: `Best ${step}`,
                  v: model ? <span className="text-emerald-700">{sgn(model.best.pct, 3)}</span> : "—",
                  sub: model ? `${fmtWhen(model.best.t)} · +${money(model.best.amt)}` : "—",
                },
                {
                  k: `Worst ${step}`,
                  v: model ? <span className="text-rose-700">{sgn(model.worst.pct, 3)}</span> : "—",
                  sub: model ? `${fmtWhen(model.worst.t)} · ${money(model.worst.amt)}` : "—",
                },
                {
                  k: "Net · streak",
                  v: model ? <span className={model.net >= 0 ? "text-emerald-700" : "text-rose-700"}>{`${model.net >= 0 ? "+" : ""}${money(model.net)}`}</span> : "—",
                  sub: model ? (model.dir === 0 ? `avg move ${model.avgAbs.toFixed(3)}%` : `${model.streak} ${step}${model.streak === 1 ? "" : "s"} ${model.dir > 0 ? "up" : "down"} in a row`) : "—",
                },
              ].map((s) => (
                <div key={s.k} className="bg-paper px-4 py-2.5">
                  <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{s.k}</div>
                  <div className="g-metric mt-0.5 text-[15px] font-semibold text-ink">{s.v}</div>
                  <div className="truncate text-[10.5px] text-ink-5">{s.sub}</div>
                </div>
              ))}
        </div>
        <div className="h-[240px] px-1 pb-2 pt-3">
          {hist.isLoading ? (
            <Shimmer className="mx-3 h-full" />
          ) : !model ? (
            <Building className="h-full" text="Bars appear once two price samples are stored — one every 10 minutes while the board is open." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={model.rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barCategoryGap={1}>
                <CartesianGrid stroke="rgba(16,32,27,0.06)" vertical={false} />
                <XAxis dataKey="t" tickFormatter={(t) => (range === "1d" ? fmtTime(Number(t)) : new Date(Number(t)).toLocaleDateString([], { weekday: "short" }))} tick={{ fontSize: 10, fill: "#93A29C" }} axisLine={false} tickLine={false} minTickGap={40} />
                <YAxis width={48} tick={{ fontSize: 10, fill: "#93A29C" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Number(v).toFixed(2)}%`} />
                <ReferenceLine y={0} stroke="rgba(16,32,27,0.3)" />
                <Tooltip
                  cursor={{ fill: "rgba(205,168,83,0.08)" }}
                  content={({ active, payload }) => {
                    const r = payload?.[0]?.payload as (typeof model.rows)[number] | undefined;
                    return active && r ? (
                      <Tip>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-light/80">
                          {fmtWhen(r.from)} → {fmtTime(r.t)}
                        </div>
                        <div className="mt-1 flex items-baseline gap-1.5">
                          <span className="g-metric text-lg leading-none">{money(r.price)}</span>
                          <span className="text-[10.5px] text-paper/45">{display}/g</span>
                        </div>
                        <div className="mt-1.5 space-y-0.5 text-[11.5px]">
                          <div className="flex justify-between gap-4">
                            <span className="text-paper/55">Change</span>
                            <span className={cn("g-metric", toneOf(r.pct))}>{sgn(r.pct, 3)}</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-paper/55">Per gram</span>
                            <span className={cn("g-metric", toneOf(r.amt))}>{`${r.amt >= 0 ? "+" : ""}${money(r.amt)}`}</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-paper/55">Per pawn</span>
                            <span className={cn("g-metric", toneOf(r.amt))}>{`${r.amt >= 0 ? "+" : ""}${money(r.amt * 8)}`}</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-paper/55">Previous</span>
                            <span className="g-metric text-paper/80">{money(r.before)}</span>
                          </div>
                        </div>
                      </Tip>
                    ) : null;
                  }}
                />
                <Bar dataKey="pct" radius={[2, 2, 2, 2]} isAnimationActive={false}>
                  {model.rows.map((r) => (
                    <Cell key={r.t} fill={r.pct >= 0 ? "#059669" : "#E11D48"} fillOpacity={0.35 + Math.min(0.6, (Math.abs(r.pct) / Math.max(0.0001, Math.abs(model.best.pct), Math.abs(model.worst.pct))) * 0.6)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </section>
  );
}

/* ================================================================ KARAT BARS */

/** Market vs board per karat as paired bars; unpublished karats show their implied board, faded. */
export function KaratBars({
  karats,
  conv,
  display,
  implied,
  className,
}: {
  karats: KaratLite[];
  conv: (lkr: number) => number;
  display: string;
  implied: (k: KaratLite) => { rate: number; from: string } | null;
  className?: string;
}) {
  const [basis, setBasis] = useState<"g" | "pawn">("pawn");
  const w = basis === "pawn" ? 8 : 1;
  const rows = karats.map((k) => {
    const imp = implied(k);
    const board = k.boardRate ?? imp?.rate ?? null;
    return {
      karat: k.karat,
      hex: karatTone(k.purity).hex,
      purity: k.purity,
      market: conv(k.lkrPerGram * w),
      board: board != null ? conv(board * w) : 0,
      hasBoard: board != null,
      implied: k.boardRate == null ? imp : null,
      diff: board != null ? ((board - k.lkrPerGram) / k.lkrPerGram) * 100 : null,
    };
  });

  return (
    <section className={cn("g-surface flex flex-col overflow-hidden", className)}>
      <PanelHead
        kicker="Board check"
        title={`Market vs board · ${display}/${basis === "pawn" ? "pawn" : "g"}`}
        right={<Segmented ariaLabel="Basis" value={basis} onChange={setBasis} items={[{ key: "pawn", label: "Pawn" }, { key: "g", label: "Gram" }]} />}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-3 text-[10.5px] text-ink-4">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[#CDA853]" /> Market
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-void" /> Your board
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-void/30" /> Implied
        </span>
      </div>
      <div className="h-[260px] flex-1 px-1 pb-2 pt-2">
        {!rows.length ? (
          <Shimmer className="mx-3 h-full" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={3} barCategoryGap="24%">
              <CartesianGrid stroke="rgba(16,32,27,0.06)" vertical={false} />
              <XAxis dataKey="karat" tick={{ fontSize: 11, fill: "#5d6e68", fontWeight: 700 }} axisLine={false} tickLine={false} />
              <YAxis width={58} tick={{ fontSize: 10, fill: "#93A29C" }} axisLine={false} tickLine={false} tickFormatter={(v) => Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(v))} />
              <Tooltip
                cursor={{ fill: "rgba(205,168,83,0.08)" }}
                content={({ active, payload }) => {
                  const r = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                  return active && r ? (
                    <Tip>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-light/80">
                          {r.karat} · {(r.purity * 1000).toFixed(0)}‰ · per {basis === "pawn" ? "pawn" : "gram"}
                        </span>
                        <span className="size-2.5 rounded-full" style={{ background: r.hex }} />
                      </div>
                      <div className="mt-1.5 space-y-0.5 text-[11.5px]">
                        <div className="flex justify-between gap-4">
                          <span className="text-paper/55">Market</span>
                          <span className="g-metric">{money(r.market)}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-paper/55">{r.implied ? `Board · implied from ${r.implied.from}` : "Your board"}</span>
                          <span className="g-metric">{r.hasBoard ? money(r.board) : "Not set"}</span>
                        </div>
                        {r.diff != null ? (
                          <>
                            <div className="flex justify-between gap-4">
                              <span className="text-paper/55">Difference</span>
                              <span className={cn("g-metric", toneOf(r.diff))}>{`${r.board - r.market >= 0 ? "+" : ""}${money(r.board - r.market)}`}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-paper/55">Board vs market</span>
                              <span className={cn("g-metric", toneOf(r.diff))}>{sgn(r.diff)}</span>
                            </div>
                          </>
                        ) : null}
                      </div>
                      <div className="mt-2 border-t border-paper/10 pt-1.5 text-[10px] text-paper/40">
                        {r.diff == null ? "Publish a board rate to compare." : r.diff < 0 ? "Board is below market — selling under spot." : "Board covers spot plus margin."}
                      </div>
                    </Tip>
                  ) : null;
                }}
              />
              <Bar dataKey="market" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                {rows.map((r) => (
                  <Cell key={r.karat} fill={r.hex} />
                ))}
              </Bar>
              <Bar dataKey="board" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                {rows.map((r) => (
                  <Cell key={r.karat} fill="#062a22" fillOpacity={r.implied ? 0.3 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="grid grid-cols-2 gap-px border-t border-ink/[0.06] bg-ink/[0.05] sm:grid-cols-4">
        {rows.map((r) => (
          <div key={r.karat} className="bg-paper px-3 py-2">
            <div className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">
              <span className="size-1.5 rounded-full" style={{ background: r.hex }} />
              {r.karat}
              {r.implied ? <span className="normal-case tracking-normal text-ink-6">· implied</span> : null}
            </div>
            <div className={cn("g-metric mt-0.5 text-[12.5px] font-semibold", r.diff == null ? "text-ink-5" : r.diff >= 0 ? "text-emerald-700" : "text-rose-700")}>
              {r.diff == null ? "not set" : sgn(r.diff)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
