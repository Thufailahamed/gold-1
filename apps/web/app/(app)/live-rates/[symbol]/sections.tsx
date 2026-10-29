"use client";

// Panels for the per-market page. Pure presentation: every figure arrives
// computed from /api/v1/market/asset/:symbol.
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { MetalCoin, Sparkline, ago, karatTone, money, symbolTone } from "../parts";

export type Asset = {
  symbol: string;
  name: string;
  kind: "metal" | "crypto";
  unit: "oz" | "lb" | "coin";
  gramsPerUnit: number | null;
  instrument: { ticker: string; venue: string; name: string; exchange: string; currency: string; since: number | null };
  usdLkr: number;
  stale: boolean;
  fetchedAt: number;
  spot: { priceUsd: number; priceLkr: number; lkrPerGram: number | null; lkrPerPawn: number | null; updatedAt: number; change24hPct: number | null } | null;
  quote: {
    price: number;
    prevClose: number | null;
    open: number | null;
    dayHigh: number | null;
    dayLow: number | null;
    volume: number | null;
    avgVolume30d: number | null;
    high52: number | null;
    low52: number | null;
    change: number | null;
    changePct: number | null;
    marketTime: number | null;
    basisPct: number | null;
  } | null;
  range: string;
  candles: { t: number; o: number; h: number; l: number; c: number; v: number; lkr: number }[];
  performance: { key: string; label: string; pct: number | null }[];
  stats: {
    athUsd: number | null;
    athAt: number | null;
    fromAthPct: number | null;
    atlUsd: number | null;
    atlAt: number | null;
    vol30d: number | null;
    vol1y: number | null;
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
    rsi14: number | null;
    maxDrawdown1yPct: number | null;
    bestDay: { at: number; pct: number } | null;
    worstDay: { at: number; pct: number } | null;
    upDays1y: number;
    downDays1y: number;
  };
  seasonality: { month: number; avgPct: number; upYears: number; years: number }[];
  yearly: { year: number; pct: number }[];
  related: { symbol: string; name: string; priceUsd: number | null; changePct: number | null; corr1y: number | null; spark: number[] }[];
  karats: { karat: string; purity: number; lkrPerGram: number; lkrPerPawn: number; boardRate: number | null; boardDiffPct: number | null }[];
  facts: { k: string; v: string }[];
  about: { extract: string; url: string; image: string | null } | null;
  news: { title: string; link: string; source: string; at: number; summary: string }[];
  sources: { name: string; url: string; what: string }[];
};

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dateShort = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
export const signedPct = (p: number | null | undefined, d = 2) => (p == null ? "—" : `${p > 0 ? "+" : ""}${p.toFixed(d)}%`);
export const pctTone = (p: number | null | undefined) => (p == null || p === 0 ? "text-ink-4" : p > 0 ? "text-emerald-700" : "text-rose-700");

/* ---------------------------------------------------------------- surfaces */

export function Panel({ id, title, sub, action, children, className }: { id?: string; title: string; sub?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section
      id={id}
      className={cn(
        "relative min-w-0 scroll-mt-24 overflow-hidden rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2),0_18px_40px_-30px_rgba(16,32,27,0.28)]",
        className
      )}
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/20 px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate font-sans text-[13.5px] font-semibold tracking-normal text-ink">{title}</h2>
          {sub ? <p className="truncate text-[11px] text-ink-4">{sub}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** Low → high bar with a marker where the current value sits. */
export function RangeBar({ lo, hi, value, labels = true, className }: { lo: number | null; hi: number | null; value: number | null; labels?: boolean; className?: string }) {
  if (lo == null || hi == null || value == null || hi <= lo) return <div className="text-[11px] text-ink-5">—</div>;
  const p = Math.max(0, Math.min(100, ((value - lo) / (hi - lo)) * 100));
  return (
    <div className={className}>
      <div className="relative h-1.5 rounded-full bg-gradient-to-r from-rose-400/70 via-amber-300/80 to-emerald-400/80">
        <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-paper shadow-[0_0_0_2px_#10201b]" style={{ left: `${p}%` }} />
      </div>
      {labels ? (
        <div className="mt-1 flex justify-between text-[10.5px] text-ink-4">
          <span className="g-metric">{money(lo)}</span>
          <span className="font-semibold text-ink-3">{p.toFixed(0)}%</span>
          <span className="g-metric">{money(hi)}</span>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- performance */

export function PerformancePanel({ a }: { a: Asset }) {
  const max = Math.max(1, ...a.performance.map((p) => Math.abs(p.pct ?? 0)));
  const ymax = Math.max(1, ...a.yearly.map((y) => Math.abs(y.pct)));
  const smax = Math.max(0.5, ...a.seasonality.map((m) => Math.abs(m.avgPct)));
  return (
    <Panel id="performance" title="Performance" sub={`${a.instrument.ticker} closes, USD · returns over each window`}>
      <div className="grid gap-px bg-ink/[0.06] lg:grid-cols-[1.1fr_1fr]">
        {/* windows */}
        <div className="space-y-1 bg-paper p-4">
          {a.performance.map((p) => {
            const v = p.pct ?? 0;
            const w = (Math.abs(v) / max) * 50;
            return (
              <div key={p.key} className="grid grid-cols-[84px_1fr_64px] items-center gap-2">
                <span className="text-[11.5px] text-ink-3">{p.label}</span>
                <div className="relative h-4">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-ink/10" />
                  {p.pct != null ? (
                    <span
                      className={cn("absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm", v >= 0 ? "bg-gradient-to-r from-emerald-500/60 to-emerald-500" : "bg-gradient-to-l from-rose-500/60 to-rose-500")}
                      style={v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
                    />
                  ) : null}
                </div>
                <span className={cn("g-metric text-right text-[12px] font-semibold", pctTone(p.pct))}>{signedPct(p.pct)}</span>
              </div>
            );
          })}
        </div>
        {/* calendar years */}
        <div className="bg-paper p-4">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">Calendar years</div>
          {a.yearly.length ? (
            <div className="mt-2 flex h-[132px] items-stretch gap-1">
              {a.yearly.map((y) => {
                const h = (Math.abs(y.pct) / ymax) * 50;
                return (
                  <div key={y.year} className="group relative flex min-w-0 flex-1 flex-col" title={`${y.year}: ${signedPct(y.pct)}`}>
                    <div className="relative flex-1">
                      <span className="absolute inset-x-0 top-1/2 h-px bg-ink/10" />
                      <span
                        className={cn("absolute inset-x-[12%] rounded-[3px] transition-opacity group-hover:opacity-80", y.pct >= 0 ? "bg-emerald-500" : "bg-rose-500")}
                        style={y.pct >= 0 ? { bottom: "50%", height: `${h}%` } : { top: "50%", height: `${h}%` }}
                      />
                      <span
                        className={cn("g-metric absolute inset-x-0 text-center text-[9px] font-semibold", pctTone(y.pct))}
                        style={y.pct >= 0 ? { bottom: `calc(50% + ${h}% + 2px)` } : { top: `calc(50% + ${h}% + 2px)` }}
                      >
                        {Math.round(y.pct)}
                      </span>
                    </div>
                    <span className="g-metric mt-1 text-center text-[9.5px] text-ink-5">’{String(y.year).slice(2)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-[11px] text-ink-4">Not enough history.</p>
          )}
        </div>
      </div>
      {/* seasonality */}
      <div className="border-t border-ink/20 px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">Seasonality · average month</span>
          <span className="text-[10.5px] text-ink-5">from {a.seasonality[0]?.years ?? 0} years of monthly closes</span>
        </div>
        <div className="mt-2 grid grid-cols-6 gap-1 sm:grid-cols-12">
          {a.seasonality.map((m) => {
            const k = Math.min(1, Math.abs(m.avgPct) / smax);
            const bg = m.avgPct >= 0 ? `rgba(16,185,129,${0.1 + k * 0.55})` : `rgba(244,63,94,${0.1 + k * 0.55})`;
            return (
              <div key={m.month} className="rounded-lg px-1 py-1.5 text-center" style={{ background: bg }} title={`${MONTHS[m.month]}: up in ${m.upYears} of ${m.years} years`}>
                <div className="text-[9.5px] font-semibold text-ink-3">{MONTHS[m.month]}</div>
                <div className={cn("g-metric text-[11px] font-semibold", k > 0.6 ? "text-white" : pctTone(m.avgPct))}>{signedPct(m.avgPct, 1)}</div>
                <div className={cn("text-[9px]", k > 0.6 ? "text-white/80" : "text-ink-5")}>
                  {m.upYears}/{m.years} up
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- technicals */

export function signals(a: Asset) {
  const px = a.quote?.price ?? a.spot?.priceUsd ?? 0;
  const s = a.stats;
  const perf = (k: string) => a.performance.find((p) => p.key === k)?.pct ?? null;
  const list: { k: string; bull: boolean | null; note: string }[] = [
    { k: "Price vs SMA 20", bull: s.sma20 != null ? px > s.sma20 : null, note: s.sma20 != null ? `${signedPct(((px - s.sma20) / s.sma20) * 100)} from ${money(s.sma20)}` : "—" },
    { k: "Price vs SMA 50", bull: s.sma50 != null ? px > s.sma50 : null, note: s.sma50 != null ? `${signedPct(((px - s.sma50) / s.sma50) * 100)} from ${money(s.sma50)}` : "—" },
    { k: "Price vs SMA 200", bull: s.sma200 != null ? px > s.sma200 : null, note: s.sma200 != null ? `${signedPct(((px - s.sma200) / s.sma200) * 100)} from ${money(s.sma200)}` : "—" },
    {
      k: "SMA 50 vs SMA 200",
      bull: s.sma50 != null && s.sma200 != null ? s.sma50 > s.sma200 : null,
      note: s.sma50 != null && s.sma200 != null ? (s.sma50 > s.sma200 ? "Golden-cross regime" : "Death-cross regime") : "—",
    },
    {
      k: "RSI (14)",
      bull: s.rsi14 != null ? (s.rsi14 >= 70 ? false : s.rsi14 <= 30 ? true : s.rsi14 >= 50) : null,
      note: s.rsi14 == null ? "—" : s.rsi14 >= 70 ? "Overbought" : s.rsi14 <= 30 ? "Oversold — bounce risk" : s.rsi14 >= 50 ? "Positive momentum" : "Soft momentum",
    },
    { k: "1-month trend", bull: perf("1m") != null ? perf("1m")! > 0 : null, note: signedPct(perf("1m")) },
    { k: "Year-to-date", bull: perf("ytd") != null ? perf("ytd")! > 0 : null, note: signedPct(perf("ytd")) },
  ];
  const known = list.filter((x) => x.bull != null);
  const bulls = known.filter((x) => x.bull).length;
  const score = known.length ? bulls / known.length : 0.5;
  const verdict = score >= 0.72 ? "Strong uptrend" : score >= 0.55 ? "Leaning bullish" : score > 0.45 ? "Neutral" : score > 0.28 ? "Leaning bearish" : "Strong downtrend";
  return { list, bulls, total: known.length, score, verdict };
}

export function TechnicalsPanel({ a }: { a: Asset }) {
  const s = a.stats;
  const sig = signals(a);
  const rsi = s.rsi14;
  const ud = s.upDays1y + s.downDays1y;
  return (
    <Panel id="technicals" title="Technicals & risk" sub="From daily closes · indicators, not advice">
      <div className="grid gap-px bg-ink/[0.06] lg:grid-cols-2">
        <div className="bg-paper">
          {sig.list.map((x) => (
            <div key={x.k} className="flex items-center justify-between gap-3 border-b border-ink/20 px-4 py-2 last:border-0">
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-ink-2">{x.k}</div>
                <div className="truncate text-[10.5px] text-ink-5">{x.note}</div>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                  x.bull == null ? "bg-ink/[0.05] text-ink-4" : x.bull ? "bg-emerald-600/10 text-emerald-700" : "bg-rose-600/10 text-rose-700"
                )}
              >
                {x.bull == null ? "n/a" : x.bull ? "Bull" : "Bear"}
              </span>
            </div>
          ))}
        </div>
        <div className="space-y-4 bg-paper p-4">
          {/* RSI meter */}
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">RSI 14</span>
              <span className="g-metric text-[15px] font-semibold text-ink">{rsi?.toFixed(1) ?? "—"}</span>
            </div>
            <div className="relative mt-1.5 h-2 rounded-full bg-gradient-to-r from-emerald-400 via-ink/10 to-rose-400">
              <span className="absolute inset-y-0 left-[30%] w-px bg-paper" />
              <span className="absolute inset-y-0 left-[70%] w-px bg-paper" />
              {rsi != null ? (
                <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-void ring-2 ring-paper" style={{ left: `${rsi}%` }} />
              ) : null}
            </div>
            <div className="mt-1 flex justify-between text-[9.5px] text-ink-5">
              <span>Oversold 30</span>
              <span>Overbought 70</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { k: "Volatility 30d", v: s.vol30d != null ? `${s.vol30d.toFixed(1)}%` : "—", hint: "annualised" },
              { k: "Volatility 1y", v: s.vol1y != null ? `${s.vol1y.toFixed(1)}%` : "—", hint: "annualised" },
              { k: "Max drawdown 1y", v: signedPct(s.maxDrawdown1yPct, 1), tone: "text-rose-700", hint: "peak to trough" },
              { k: "From all-time high", v: signedPct(s.fromAthPct, 1), tone: pctTone(s.fromAthPct), hint: s.athAt ? dateShort(s.athAt) : "" },
              { k: "Best day 1y", v: signedPct(s.bestDay?.pct), tone: "text-emerald-700", hint: s.bestDay ? dateShort(s.bestDay.at) : "" },
              { k: "Worst day 1y", v: signedPct(s.worstDay?.pct), tone: "text-rose-700", hint: s.worstDay ? dateShort(s.worstDay.at) : "" },
            ].map((m) => (
              <div key={m.k} className="rounded-xl bg-bone/60 px-3 py-2 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)]">
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-ink-5">{m.k}</div>
                <div className={cn("g-metric mt-0.5 text-[14px] font-semibold", m.tone ?? "text-ink")}>{m.v}</div>
                <div className="truncate text-[10px] text-ink-5">{m.hint}</div>
              </div>
            ))}
          </div>
          {ud ? (
            <div>
              <div className="flex justify-between text-[10.5px] text-ink-4">
                <span>
                  <b className="text-emerald-700">{s.upDays1y}</b> up days
                </span>
                <span>
                  <b className="text-rose-700">{s.downDays1y}</b> down days
                </span>
              </div>
              <div className="mt-1 flex h-1.5 overflow-hidden rounded-full">
                <span className="bg-emerald-500" style={{ width: `${(s.upDays1y / ud) * 100}%` }} />
                <span className="flex-1 bg-rose-500" />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- karats */

export function KaratsPanel({ a, lens, onLens }: { a: Asset; lens: string; onLens: (k: string) => void }) {
  if (!a.karats.length) return null;
  const top = a.karats[0]!.lkrPerGram;
  return (
    <Panel id="karats" title="Gold by karat" sub="Market value in LKR from spot · compared with your published board rate" action={<Link href="/gold-rates" className="text-[11px] font-semibold text-gold-deep hover:underline">Board rates →</Link>}>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-[12px]">
          <thead className="bg-bone/60 text-left">
            <tr className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">
              <th className="py-1.5 pl-4 pr-2">Karat</th>
              <th className="px-2">Purity</th>
              <th className="px-2 text-right">LKR / g</th>
              <th className="px-2 text-right">LKR / pawn</th>
              <th className="px-2 text-right">Board / g</th>
              <th className="px-2 pr-4 text-right">Board vs market</th>
            </tr>
          </thead>
          <tbody>
            {a.karats.map((k) => {
              const t = karatTone(k.purity);
              const on = lens === k.karat;
              return (
                <tr key={k.karat} onClick={() => onLens(k.karat)} className={cn("cursor-pointer border-t border-ink/20 transition-colors hover:bg-gold-pale/30", on && "bg-gold-pale/50")}>
                  <td className="py-1.5 pl-4 pr-2">
                    <span className={cn("inline-flex h-6 min-w-[38px] items-center justify-center rounded-md px-1.5 text-[11px] font-bold", t.badge)}>{k.karat}</span>
                  </td>
                  <td className="px-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink/[0.06]">
                        <div className={cn("h-full", t.bar)} style={{ width: `${(k.lkrPerGram / top) * 100}%` }} />
                      </div>
                      <span className="g-metric text-[11px] text-ink-4">{(k.purity * 100).toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="g-metric px-2 text-right font-semibold text-ink">{money(k.lkrPerGram)}</td>
                  <td className="g-metric px-2 text-right text-ink-2">{money(k.lkrPerPawn)}</td>
                  <td className="g-metric px-2 text-right text-ink-3">{k.boardRate != null ? money(k.boardRate) : <span className="text-ink-6">not set</span>}</td>
                  <td className="px-2 pr-4 text-right">
                    {k.boardDiffPct != null ? (
                      <span
                        className={cn(
                          "g-metric rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                          Math.abs(k.boardDiffPct) < 1 ? "bg-emerald-600/10 text-emerald-700" : k.boardDiffPct > 0 ? "bg-amber-500/10 text-amber-700" : "bg-rose-600/10 text-rose-700"
                        )}
                      >
                        {signedPct(k.boardDiffPct)}
                      </span>
                    ) : (
                      <span className="text-ink-6">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-ink/20 px-4 py-2 text-[10.5px] text-ink-5">Click a karat to view the whole page — chart, converter and figures — at that purity.</p>
    </Panel>
  );
}

/* ---------------------------------------------------------------- news */

const avatarHue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export function NewsPanel({ a }: { a: Asset }) {
  return (
    <Panel id="news" title={`${a.name} news`} sub="Latest headlines · Yahoo Finance feed">
      {a.news.length ? (
        <ul className="divide-y divide-ink/[0.05]">
          {a.news.map((n) => (
            <li key={n.link}>
              <a href={n.link} target="_blank" rel="noopener noreferrer" className="group flex gap-3 px-4 py-2.5 transition-colors hover:bg-gold-pale/25">
                <span
                  className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold uppercase text-white"
                  style={{ background: `hsl(${avatarHue(n.source)} 45% 42%)` }}
                  aria-hidden
                >
                  {n.source[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold leading-snug text-ink group-hover:text-gold-deep">{n.title}</div>
                  {n.summary ? <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-ink-4">{n.summary}</p> : null}
                  <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink-5">
                    <span className="font-medium text-ink-3">{n.source}</span>
                    <span>·</span>
                    <span>{n.at ? ago(n.at) : ""}</span>
                  </div>
                </div>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-[12px] text-ink-4">No headlines right now.</p>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- about */

export function AboutPanel({ a }: { a: Asset }) {
  return (
    <Panel id="about" title={`About ${a.name}`} sub="Reference facts and background">
      <div className="grid gap-4 p-4 md:grid-cols-[1fr_260px]">
        <div className="min-w-0">
          <div className="flex gap-3">
            {a.about?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.about.image} alt="" className="size-20 shrink-0 rounded-xl object-cover shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)]" />
            ) : (
              <MetalCoin symbol={a.symbol} size={64} />
            )}
            <p className="text-[12.5px] leading-relaxed text-ink-2">{a.about?.extract || `${a.name} — background is unavailable right now.`}</p>
          </div>
          {a.about ? (
            <p className="mt-2 text-[10.5px] text-ink-5">
              Text from{" "}
              <a href={a.about.url} target="_blank" rel="noopener noreferrer" className="font-medium text-gold-deep hover:underline">
                Wikipedia
              </a>{" "}
              (CC BY-SA 4.0).
            </p>
          ) : null}
        </div>
        <dl className="divide-y divide-ink/[0.05] overflow-hidden rounded-xl bg-bone/60 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)]">
          {a.facts.map((f) => (
            <div key={f.k} className="px-3 py-1.5">
              <dt className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-ink-5">{f.k}</dt>
              <dd className="text-[12px] font-medium text-ink-2">{f.v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- right rail */

export function MoodCard({ a }: { a: Asset }) {
  const sig = signals(a);
  const pos = sig.score * 100;
  const tone = sig.score >= 0.55 ? "text-emerald-700" : sig.score <= 0.45 ? "text-rose-700" : "text-amber-700";
  return (
    <Panel title="Market mood" sub="Technical read of trend & momentum">
      <div className="p-4">
        <div className="flex items-end justify-between">
          <div>
            <div className={cn("text-[18px] font-semibold leading-none", tone)}>{sig.verdict}</div>
            <div className="mt-1 text-[11px] text-ink-4">
              {sig.bulls} of {sig.total} signals bullish
            </div>
          </div>
          <div className="flex gap-1">
            <span className="rounded-md bg-emerald-600/10 px-2 py-1 text-[11px] font-bold text-emerald-700">▲ {sig.bulls}</span>
            <span className="rounded-md bg-rose-600/10 px-2 py-1 text-[11px] font-bold text-rose-700">▼ {sig.total - sig.bulls}</span>
          </div>
        </div>
        <div className="relative mt-3 h-2 rounded-full bg-gradient-to-r from-rose-500 via-amber-300 to-emerald-500">
          <span className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-void ring-2 ring-paper" style={{ left: `${pos}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[9.5px] font-semibold uppercase tracking-wide text-ink-5">
          <span>Bearish</span>
          <span>Neutral</span>
          <span>Bullish</span>
        </div>
      </div>
    </Panel>
  );
}

export function RelatedCard({ a }: { a: Asset }) {
  return (
    <Panel title="Other markets" sub="1-year daily correlation with this market">
      <ul className="divide-y divide-ink/[0.05]">
        {a.related.map((r) => {
          const c = r.corr1y;
          return (
            <li key={r.symbol}>
              <Link href={`/live-rates/${r.symbol}`} className="group grid grid-cols-[28px_1fr_64px] items-center gap-2.5 px-3 py-2 transition-colors hover:bg-gold-pale/30">
                <MetalCoin symbol={r.symbol} size={28} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-semibold text-ink group-hover:text-gold-deep">{r.name}</span>
                    <span className="text-[10px] font-semibold text-ink-5">{r.symbol}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="g-metric text-[11.5px] text-ink-3">${r.priceUsd != null ? money(r.priceUsd) : "—"}</span>
                    <span className={cn("g-metric text-[10.5px] font-semibold", pctTone(r.changePct))}>{signedPct(r.changePct)}</span>
                  </div>
                  {c != null ? (
                    <div className="mt-1 flex items-center gap-1.5" title="Correlation of daily returns over the last year">
                      <div className="h-1 w-14 overflow-hidden rounded-full bg-ink/[0.06]">
                        <div className={cn("h-full rounded-full", c >= 0 ? "bg-sky-500" : "bg-orange-500")} style={{ width: `${Math.abs(c) * 100}%` }} />
                      </div>
                      <span className="g-metric text-[9.5px] text-ink-5">ρ {c.toFixed(2)}</span>
                    </div>
                  ) : null}
                </div>
                <Sparkline values={r.spark} color={symbolTone(r.symbol)} className="h-8" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** What one unit of this market buys of every other one. */
export function EquivalentsCard({ a, price }: { a: Asset; price: number }) {
  const unit = (s: string) => (s === "BTC" ? "BTC" : s === "ETH" ? "ETH" : s === "HG" ? "lb" : "oz");
  const mine = a.unit === "coin" ? `1 ${a.symbol}` : `1 ${a.unit === "lb" ? "lb" : "oz"} ${a.name.toLowerCase()}`;
  return (
    <Panel title="Priced in other markets" sub={`What ${mine} buys today`}>
      <ul className="divide-y divide-ink/[0.05]">
        {a.related
          .filter((r) => r.priceUsd)
          .map((r) => {
            const n = price / r.priceUsd!;
            return (
              <li key={r.symbol} className="flex items-center justify-between gap-2 px-4 py-1.5">
                <span className="flex items-center gap-2 text-[12px] text-ink-3">
                  <span className="size-2 rounded-full" style={{ background: symbolTone(r.symbol) }} />
                  {r.name}
                </span>
                <span className="g-metric text-[12px] font-semibold text-ink">
                  {n >= 100 ? n.toLocaleString("en-US", { maximumFractionDigits: 1 }) : n.toLocaleString("en-US", { maximumFractionDigits: 4 })}{" "}
                  <span className="font-sans text-[10.5px] font-normal text-ink-5">{unit(r.symbol)}</span>
                </span>
              </li>
            );
          })}
      </ul>
    </Panel>
  );
}

export function HeadlinesCard({ a }: { a: Asset }) {
  if (!a.news.length) return null;
  return (
    <Panel title="Top headlines" action={<a href="#news" className="text-[11px] font-semibold text-gold-deep hover:underline">All →</a>}>
      <ul className="divide-y divide-ink/[0.05]">
        {a.news.slice(0, 4).map((n) => (
          <li key={n.link}>
            <a href={n.link} target="_blank" rel="noopener noreferrer" className="block px-4 py-2 transition-colors hover:bg-gold-pale/25">
              <div className="line-clamp-2 text-[12px] font-medium leading-snug text-ink">{n.title}</div>
              <div className="mt-0.5 text-[10.5px] text-ink-5">
                {n.source} · {n.at ? ago(n.at) : ""}
              </div>
            </a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

