"use client";

// One market in depth — gold, silver, platinum, palladium, copper, bitcoin or
// ether. Spot and LKR come from the board feed; chart, ranges, volume, news
// and background from free public sources (see the Sources card). Gold adds a
// karat lens that re-prices the whole page at the chosen purity.
import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, errorCode } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ArrowLeftIcon, CopyIcon, RefreshCwIcon } from "@/components/icons";
import { ChangeChip, LiveNumber, MetalCoin, Shimmer, ago, karatTone, money, symbolTone, useNow } from "../parts";
import { AssetChart, type ChartRange, type Measure } from "./chart";
import {
  AboutPanel,
  EquivalentsCard,
  HeadlinesCard,
  KaratsPanel,
  MoodCard,
  NewsPanel,
  Panel,
  PerformancePanel,
  RangeBar,
  RelatedCard,
  TechnicalsPanel,
  dateShort,
  pctTone,
  signedPct,
  type Asset,
} from "./sections";

const BOARD = [
  { symbol: "XAU", name: "Gold" },
  { symbol: "XAG", name: "Silver" },
  { symbol: "XPT", name: "Platinum" },
  { symbol: "XPD", name: "Palladium" },
  { symbol: "HG", name: "Copper" },
  { symbol: "BTC", name: "Bitcoin" },
  { symbol: "ETH", name: "Ethereum" },
];
const RANGES: { key: ChartRange; label: string }[] = [
  { key: "1d", label: "1D" },
  { key: "7d", label: "1W" },
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "1y", label: "1Y" },
  { key: "5y", label: "5Y" },
  { key: "max", label: "All" },
];
const SECTIONS = [
  { id: "chart", label: "Chart" },
  { id: "performance", label: "Performance" },
  { id: "technicals", label: "Technicals" },
  { id: "karats", label: "Karats", gold: true },
  { id: "news", label: "News" },
  { id: "about", label: "About" },
];
const PAWN_G = 8;
const TOLA_G = 11.6638;

const compact = (n: number | null | undefined) =>
  n == null ? "—" : n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n));

function Seg<K extends string>({ value, onChange, items }: { value: K; onChange: (k: K) => void; items: { key: K; label: string }[] }) {
  return (
    <div className="inline-flex rounded-lg bg-ink/[0.05] p-0.5">
      {items.map((it) => (
        <button
          key={it.key}
          onClick={() => onChange(it.key)}
          className={cn(
            "h-7 rounded-md px-2.5 text-[11.5px] font-semibold transition-colors",
            value === it.key ? "bg-paper text-ink shadow-[0_1px_2px_rgba(16,32,27,0.12),inset_0_0_0_1px_rgba(16,32,27,0.06)]" : "text-ink-4 hover:text-ink"
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ k, v, sub, tone }: { k: string; v: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 px-3 py-2.5 text-center">
      <div className="truncate text-[10.5px] text-ink-4">{k}</div>
      <div className={cn("g-metric mt-0.5 truncate text-[14px] font-semibold", tone ?? "text-ink")}>{v}</div>
      {sub ? <div className="truncate text-[10.5px]">{sub}</div> : null}
    </div>
  );
}

export default function MarketAssetPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = use(params);
  const symbol = raw.toUpperCase();
  const now = useNow(1000);
  const [range, setRange] = useState<ChartRange>("1y");
  const [measureKey, setMeasureKey] = useState("usd");
  const [chartKind, setChartKind] = useState<"area" | "candle">("area");
  const [log, setLog] = useState(false);
  const [overlays, setOverlays] = useState(false);
  const [lens, setLens] = useState("24K");
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState("base");
  const [copied, setCopied] = useState(false);

  // ?karat=22K deep-links the gold lens; read after mount so the page stays static-friendly.
  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get("karat");
    if (k) setLens(k.toUpperCase());
  }, []);
  const pickLens = (k: string) => {
    setLens(k);
    const url = new URL(window.location.href);
    if (k === "24K") url.searchParams.delete("karat");
    else url.searchParams.set("karat", k);
    window.history.replaceState(null, "", url);
  };

  const q = useQuery({
    queryKey: ["market-asset", symbol, range],
    queryFn: () => api<Asset>(`/api/v1/market/asset/${symbol}?range=${range}`),
    placeholderData: keepPreviousData,
    refetchInterval: range === "1d" ? 60_000 : 5 * 60_000,
    retry: (n, e) => errorCode(e) !== "VALIDATION" && n < 2,
  });
  const a = q.data && q.data.symbol === symbol ? q.data : undefined;
  const tone = symbolTone(symbol);
  const meta = BOARD.find((b) => b.symbol === symbol);
  const isGold = symbol === "XAU";
  const karat = isGold ? a?.karats.find((k) => k.karat === lens) : undefined;
  const purity = karat?.purity ?? 1;
  const gpu = a?.gramsPerUnit ?? null;
  const unitWord = a?.unit === "coin" ? symbol : a?.unit === "lb" ? "lb" : "oz";

  const measures: Measure[] = useMemo(() => {
    const fx = (c: { c: number; lkr: number }) => (c.c ? c.lkr / c.c : (a?.usdLkr ?? 0));
    const list: Measure[] = [
      { key: "usd", label: `USD / ${unitWord}`, ccy: "USD", factor: () => 1 },
      { key: "lkr", label: `LKR / ${unitWord}`, ccy: "LKR", factor: fx },
    ];
    if (gpu) {
      list.push({ key: "lkr_g", label: `LKR / g${isGold && purity < 1 ? ` ${lens}` : ""}`, ccy: "LKR", factor: (c) => (fx(c) / gpu) * purity });
      if (isGold) list.push({ key: "lkr_pawn", label: `LKR / pawn${purity < 1 ? ` ${lens}` : ""}`, ccy: "LKR", factor: (c) => ((fx(c) * PAWN_G) / gpu) * purity });
    }
    return list;
  }, [a?.usdLkr, gpu, isGold, purity, lens, unitWord]);
  const measure = measures.find((m) => m.key === measureKey) ?? measures[0]!;

  // Headline: spot from the board feed, falling back to the futures last.
  const priceUsd = a?.spot?.priceUsd ?? a?.quote?.price ?? 0;
  const changePct = a?.quote?.changePct ?? a?.spot?.change24hPct ?? null;
  const lkrPerGram = a?.spot?.lkrPerGram != null ? a.spot.lkrPerGram * purity : null;

  // Range figures from the candles on screen.
  const rangeStats = useMemo(() => {
    const cs = a?.candles ?? [];
    if (cs.length < 2) return null;
    const f = (c: (typeof cs)[number]) => c.c * measure.factor(c);
    const vals = cs.map(f);
    const hi = Math.max(...cs.map((c) => c.h * measure.factor(c)));
    const lo = Math.min(...cs.map((c) => c.l * measure.factor(c)));
    const open = vals[0]!;
    const close = vals[vals.length - 1]!;
    return { open, close, hi, lo, avg: vals.reduce((s, v) => s + v, 0) / vals.length, pct: ((close - open) / open) * 100, fromHi: ((close - hi) / hi) * 100 };
  }, [a?.candles, measure]);

  // Converter: amount in a weight or coin unit → USD and LKR at spot.
  const convUnits = gpu
    ? [
        { key: "base", label: a?.unit === "lb" ? "Pound (lb)" : "Troy oz", g: gpu },
        { key: "g", label: "Gram", g: 1 },
        ...(isGold ? [{ key: "pawn", label: "Pawn (8 g)", g: PAWN_G }, { key: "tola", label: "Tola", g: TOLA_G }] : []),
        { key: "kg", label: "Kilogram", g: 1000 },
      ]
    : [{ key: "base", label: symbol, g: 1 }];
  const cu = convUnits.find((u) => u.key === unit) ?? convUnits[0]!;
  const amt = Number(amount) || 0;
  const convUsd = gpu ? (amt * cu.g * priceUsd * purity) / gpu : amt * priceUsd;
  const convLkr = convUsd * (a?.usdLkr ?? 0);

  const position52 = a?.quote?.high52 && a.quote.low52 && a.quote.price ? ((a.quote.price - a.quote.low52) / (a.quote.high52 - a.quote.low52)) * 100 : null;

  if (!meta)
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <p className="text-[15px] font-semibold text-ink">No market called “{raw}”.</p>
        <Link href="/live-rates" className="mt-3 inline-block text-[12.5px] font-semibold text-gold-deep hover:underline">
          Back to Live rates
        </Link>
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-3 pb-10">
      {/* ------------------------------------------------ market switcher */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/live-rates"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold text-ink-3 transition-colors hover:bg-ink/[0.05] hover:text-ink"
        >
          <ArrowLeftIcon size={13} /> Live rates
        </Link>
        <span className="h-5 w-px bg-ink/10" />
        <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto scrollbar-thin">
          {BOARD.map((b) => {
            const on = b.symbol === symbol;
            return (
              <Link
                key={b.symbol}
                href={`/live-rates/${b.symbol}`}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg pl-1 pr-2.5 text-[12px] font-semibold transition-colors",
                  on ? "bg-void text-paper shadow-[inset_0_0_0_1px_rgba(205,168,83,0.35)]" : "text-ink-3 hover:bg-ink/[0.05] hover:text-ink"
                )}
              >
                <MetalCoin symbol={b.symbol} size={22} />
                {b.name}
                <span className={cn("text-[10px]", on ? "text-gold-light/80" : "text-ink-5")}>{b.symbol}</span>
              </Link>
            );
          })}
        </nav>
        <button
          onClick={() => q.refetch()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-medium text-ink-4 transition-colors hover:bg-ink/[0.05] hover:text-ink"
          title="Refresh"
        >
          <RefreshCwIcon size={12} className={cn(q.isFetching && "animate-spin")} />
          {a ? ago(a.fetchedAt, now) : "loading"}
        </button>
      </div>

      {q.isError && !a ? (
        <div className="rounded-2xl bg-rose-50 px-4 py-6 text-center text-[13px] text-rose-800 ring-1 ring-inset ring-rose-200">
          Market data is unavailable right now.{" "}
          <button onClick={() => q.refetch()} className="font-semibold underline">
            Try again
          </button>
        </div>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[320px_minmax(0,1fr)_300px]">
        {/* ================================================= left column */}
        <aside className="min-w-0 space-y-3 xl:sticky xl:top-3 xl:self-start">
          {/* identity + price */}
          <section className="relative overflow-hidden rounded-2xl bg-void p-4 text-paper shadow-[0_24px_50px_-30px_rgba(16,32,27,0.7)]">
            <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full blur-[70px]" style={{ background: `${tone}40` }} />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
            <div className="relative flex items-center gap-3">
              <MetalCoin symbol={symbol} size={44} />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-[18px] font-semibold leading-tight">
                  {meta.name}
                  {isGold && purity < 1 ? <span className="text-gold-light"> {lens}</span> : null}
                </h1>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="g-metric rounded bg-paper/[0.08] px-1.5 py-px text-paper/80">{symbol}</span>
                  <span className="rounded px-1.5 py-px font-semibold" style={{ background: `${tone}30`, color: tone }}>
                    #{BOARD.findIndex((b) => b.symbol === symbol) + 1} on board
                  </span>
                  <span className="text-paper/45">{a ? (a.kind === "crypto" ? "Crypto" : symbol === "HG" ? "Base metal" : "Precious metal") : ""}</span>
                </div>
              </div>
            </div>

            <div className="relative mt-4">
              {a ? (
                <>
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="text-[13px] font-semibold text-paper/45">$</span>
                    <LiveNumber value={priceUsd * purity} tone="dark" className="-ml-2 text-[34px] font-semibold leading-none tracking-tight" />
                    <ChangeChip pct={changePct} tone="dark" suffix={<span className="ml-1 font-sans font-medium opacity-60">24h</span>} />
                  </div>
                  <div className="mt-1 text-[11px] text-paper/45">
                    per {a.unit === "coin" ? "coin" : a.unit === "lb" ? "pound" : "troy ounce"}
                    {isGold && purity < 1 ? ` of ${lens} (${(purity * 100).toFixed(1)}% pure)` : ""} · spot
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-paper/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
                    <div className="bg-void px-3 py-2">
                      <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-paper/40">LKR / {a.unit === "coin" ? "coin" : unitWord}</div>
                      <div className="g-metric mt-0.5 text-[14px] text-paper">{money((a.spot?.priceLkr ?? priceUsd * a.usdLkr) * purity)}</div>
                    </div>
                    {lkrPerGram != null ? (
                      <div className="bg-gradient-to-br from-gold/[0.16] via-void to-void px-3 py-2">
                        <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-paper/40">{isGold ? "LKR / pawn" : "LKR / gram"}</div>
                        <div className="g-metric mt-0.5 text-[14px] text-gold-light">{money(isGold ? lkrPerGram * PAWN_G : lkrPerGram)}</div>
                      </div>
                    ) : (
                      <div className="bg-void px-3 py-2">
                        <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-paper/40">USD / LKR</div>
                        <div className="g-metric mt-0.5 text-[14px] text-paper">{a.usdLkr.toFixed(2)}</div>
                      </div>
                    )}
                    {lkrPerGram != null ? (
                      <>
                        <div className="bg-void px-3 py-2">
                          <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-paper/40">LKR / gram</div>
                          <div className="g-metric mt-0.5 text-[14px] text-paper">{money(lkrPerGram)}</div>
                        </div>
                        <div className="bg-void px-3 py-2">
                          <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-paper/40">USD / LKR</div>
                          <div className="g-metric mt-0.5 text-[14px] text-paper">{a.usdLkr.toFixed(2)}</div>
                        </div>
                      </>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <Shimmer dark className="h-9 w-48" />
                  <Shimmer dark className="h-3 w-32" />
                  <Shimmer dark className="h-24 w-full" />
                </div>
              )}
            </div>

            {isGold && a?.karats.length ? (
              <div className="relative mt-3">
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-paper/40">Karat lens</div>
                <div className="flex flex-wrap gap-1">
                  {a.karats.map((k) => {
                    const on = k.karat === lens;
                    return (
                      <button
                        key={k.karat}
                        onClick={() => pickLens(k.karat)}
                        className={cn(
                          "h-6 rounded-md px-2 text-[11px] font-bold transition-all",
                          on ? karatTone(k.purity).badge : "bg-paper/[0.07] text-paper/60 hover:bg-paper/[0.12] hover:text-paper"
                        )}
                      >
                        {k.karat}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>

          {/* market stats */}
          <section className="overflow-hidden rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07)]">
            {a?.quote ? (
              <>
                <div className="border-b border-ink/[0.06]">
                  <Stat
                    k={`${a.instrument.venue} futures`}
                    v={`$${money(a.quote.price * purity)}`}
                    sub={
                      <span className="text-ink-4">
                        {a.quote.basisPct != null ? (
                          <>
                            basis <span className={pctTone(a.quote.basisPct)}>{signedPct(a.quote.basisPct)}</span> vs spot
                          </>
                        ) : (
                          <span className={pctTone(a.quote.changePct)}>{signedPct(a.quote.changePct)} today</span>
                        )}
                      </span>
                    }
                  />
                </div>
                <div className="grid grid-cols-2 divide-x divide-ink/[0.06] border-b border-ink/[0.06]">
                  <Stat
                    k="Volume (session)"
                    v={compact(a.quote.volume)}
                    sub={
                      a.quote.volume && a.quote.avgVolume30d ? (
                        <span className={pctTone(a.quote.volume - a.quote.avgVolume30d)}>{signedPct(((a.quote.volume - a.quote.avgVolume30d) / a.quote.avgVolume30d) * 100, 0)} vs avg</span>
                      ) : null
                    }
                  />
                  <Stat k="Avg volume 30d" v={compact(a.quote.avgVolume30d)} sub={<span className="text-ink-5">{a.kind === "crypto" ? "USD" : "contracts"}</span>} />
                </div>
                <div className="grid grid-cols-2 divide-x divide-ink/[0.06] border-b border-ink/[0.06]">
                  <Stat k="Previous close" v={a.quote.prevClose != null ? money(a.quote.prevClose * purity) : "—"} />
                  <Stat
                    k="Change today"
                    v={a.quote.change != null ? `${a.quote.change >= 0 ? "+" : ""}${money(a.quote.change * purity)}` : "—"}
                    tone={pctTone(a.quote.change)}
                  />
                </div>
                <div className="space-y-3 px-4 py-3">
                  <div>
                    <div className="mb-1 flex justify-between text-[10.5px] text-ink-4">
                      <span>Day range</span>
                      <span>open {a.quote.open != null ? money(a.quote.open * purity) : "—"}</span>
                    </div>
                    <RangeBar lo={a.quote.dayLow} hi={a.quote.dayHigh} value={a.quote.price} />
                  </div>
                  <div>
                    <div className="mb-1 text-[10.5px] text-ink-4">52-week range</div>
                    <RangeBar lo={a.quote.low52} hi={a.quote.high52} value={a.quote.price} />
                  </div>
                </div>
                <div className="grid grid-cols-2 divide-x divide-ink/[0.06] border-t border-ink/[0.06]">
                  <Stat
                    k="All-time high"
                    v={a.stats.athUsd != null ? `$${money(a.stats.athUsd * purity)}` : "—"}
                    sub={<span className="text-ink-5">{a.stats.athAt ? dateShort(a.stats.athAt) : ""}</span>}
                  />
                  <Stat k="From ATH" v={signedPct(a.stats.fromAthPct, 1)} tone={pctTone(a.stats.fromAthPct)} sub={<span className="text-ink-5">since peak</span>} />
                </div>
                <div className="grid grid-cols-2 divide-x divide-ink/[0.06] border-t border-ink/[0.06]">
                  <Stat
                    k="All-time low"
                    v={a.stats.atlUsd != null ? `$${money(a.stats.atlUsd * purity)}` : "—"}
                    sub={<span className="text-ink-5">{a.stats.atlAt ? dateShort(a.stats.atlAt) : ""}</span>}
                  />
                  <Stat k="Volatility 1y" v={a.stats.vol1y != null ? `${a.stats.vol1y.toFixed(1)}%` : "—"} sub={<span className="text-ink-5">annualised</span>} />
                </div>
              </>
            ) : (
              <div className="space-y-2 p-4">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Shimmer key={i} className="h-10" />
                ))}
              </div>
            )}
          </section>

          {/* 52-week position, like a profile score */}
          {position52 != null ? (
            <div className="flex items-center gap-3 rounded-xl bg-paper px-4 py-2.5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07)]">
              <span className="text-[11.5px] text-ink-3">52-week position</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/[0.06]">
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, position52))}%`, background: tone }} />
              </div>
              <span className="g-metric text-[12px] font-semibold" style={{ color: tone }}>
                {position52.toFixed(0)}%
              </span>
            </div>
          ) : null}

          {/* instrument & sources */}
          <section className="overflow-hidden rounded-2xl bg-paper text-[12px] shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07)]">
            {a ? (
              <dl className="divide-y divide-ink/[0.05]">
                <div className="flex items-center justify-between gap-2 px-4 py-2">
                  <dt className="text-ink-4">Instrument</dt>
                  <dd className="truncate text-right font-medium text-ink-2">{a.instrument.name}</dd>
                </div>
                <div className="flex items-center justify-between gap-2 px-4 py-2">
                  <dt className="text-ink-4">Ticker</dt>
                  <dd className="flex items-center gap-1">
                    <span className="g-metric rounded-md bg-bone px-2 py-0.5 text-[11.5px] font-semibold text-ink">{a.instrument.ticker}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(a.instrument.ticker).then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1200);
                        });
                      }}
                      className="rounded p-1 text-ink-5 hover:bg-ink/[0.05] hover:text-ink"
                      aria-label="Copy ticker"
                    >
                      <CopyIcon size={12} />
                    </button>
                    {copied ? <span className="text-[10px] text-emerald-700">copied</span> : null}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2 px-4 py-2">
                  <dt className="text-ink-4">Exchange</dt>
                  <dd className="font-medium text-ink-2">{a.instrument.exchange}</dd>
                </div>
                {a.instrument.since ? (
                  <div className="flex items-center justify-between gap-2 px-4 py-2">
                    <dt className="text-ink-4">Trading since</dt>
                    <dd className="font-medium text-ink-2">{dateShort(a.instrument.since)}</dd>
                  </div>
                ) : null}
                <div className="px-4 py-2">
                  <dt className="mb-1.5 text-ink-4">Sources</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {a.sources.map((s) => (
                      <a
                        key={s.name}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={s.what}
                        className="inline-flex items-center gap-1 rounded-full bg-bone px-2.5 py-1 text-[11px] font-medium text-ink-2 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.06)] transition-colors hover:bg-gold-pale hover:text-ink"
                      >
                        {s.name}
                        <span className="text-ink-5">· {s.what}</span>
                      </a>
                    ))}
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="space-y-2 p-4">
                <Shimmer className="h-6" />
                <Shimmer className="h-6" />
              </div>
            )}
          </section>

          {/* converter */}
          <section className="overflow-hidden rounded-2xl bg-paper p-4 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07)]">
            <div className="text-[12.5px] font-semibold text-ink">
              {meta.name}
              {isGold && purity < 1 ? ` ${lens}` : ""} converter
            </div>
            <div className="mt-2 flex overflow-hidden rounded-lg shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12)] focus-within:shadow-[inset_0_0_0_1px_#10201b,0_0_0_3px_rgba(205,168,83,0.24)]">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                className="g-metric h-9 min-w-0 flex-1 bg-transparent px-3 text-[13px] text-ink focus:outline-none"
                aria-label="Amount"
              />
              <select
                value={cu.key}
                onChange={(e) => setUnit(e.target.value)}
                className="h-9 border-l border-ink/10 bg-bone/60 px-2 text-[12px] font-medium text-ink-2 focus:outline-none"
                aria-label="Unit"
              >
                {convUnits.map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between rounded-lg bg-bone/60 px-3 py-2">
                <span className="text-[11px] font-semibold text-ink-4">LKR</span>
                <span className="g-metric text-[15px] font-semibold text-ink">{a ? money(convLkr) : "—"}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-bone/60 px-3 py-2">
                <span className="text-[11px] font-semibold text-ink-4">USD</span>
                <span className="g-metric text-[13px] font-medium text-ink-2">{a ? money(convUsd) : "—"}</span>
              </div>
            </div>
          </section>
        </aside>

        {/* ================================================= centre column */}
        <main className="min-w-0 space-y-3">
          {/* section tabs */}
          <nav className="sticky top-0 z-10 -mx-1 flex gap-1 overflow-x-auto bg-bone/85 px-1 py-1 backdrop-blur scrollbar-thin">
            {SECTIONS.filter((s) => !s.gold || isGold).map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="h-8 shrink-0 rounded-lg px-3 text-[12.5px] font-semibold leading-8 text-ink-3 transition-colors hover:bg-paper hover:text-ink"
              >
                {s.label}
              </a>
            ))}
          </nav>

          {/* source note */}
          <div className="flex items-start gap-2 rounded-xl bg-gradient-to-r from-gold-pale/80 to-gold-pale/30 px-3.5 py-2 text-[11.5px] text-ink-2 ring-1 ring-inset ring-gold/25">
            <span className="mt-0.5 size-1.5 shrink-0 rounded-full" style={{ background: tone }} />
            <span>
              Headline price is <b>spot</b> from gold-api.com, converted at today’s USD/LKR.{" "}
              {a?.kind === "metal"
                ? `The chart, ranges and volume follow ${a.instrument.venue} ${a.instrument.ticker} front-month futures from Yahoo Finance, which trade a little above spot.`
                : "The chart, ranges and volume come from Yahoo Finance."}
            </span>
          </div>

          {/* chart */}
          <Panel
            id="chart"
            title={`${meta.name} price chart`}
            sub={rangeStats ? `${measure.label} · ${RANGES.find((r) => r.key === range)?.label} change ${signedPct(rangeStats.pct)}` : measure.label}
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-ink/[0.06] px-3 py-2">
              <Seg value={measure.key} onChange={setMeasureKey} items={measures.map((m) => ({ key: m.key, label: m.label }))} />
              <Seg
                value={chartKind}
                onChange={setChartKind}
                items={[
                  { key: "area", label: "Line" },
                  { key: "candle", label: "Candles" },
                ]}
              />
              <button
                onClick={() => setOverlays((v) => !v)}
                className={cn("h-7 rounded-md px-2.5 text-[11.5px] font-semibold transition-colors", overlays ? "bg-void text-gold-light" : "bg-ink/[0.05] text-ink-4 hover:text-ink")}
              >
                SMA
              </button>
              <button
                onClick={() => setLog((v) => !v)}
                className={cn("h-7 rounded-md px-2.5 text-[11.5px] font-semibold transition-colors", log ? "bg-void text-gold-light" : "bg-ink/[0.05] text-ink-4 hover:text-ink")}
              >
                Log
              </button>
              <div className="ml-auto">
                <Seg value={range} onChange={setRange} items={RANGES} />
              </div>
            </div>
            <div className={cn("px-3 pb-2 pt-3 transition-opacity", q.isFetching && q.isPlaceholderData && "opacity-60")}>
              <AssetChart candles={a?.candles ?? []} range={range} measure={measure} kind={chartKind} log={log} overlays={overlays} tone={tone} loading={q.isLoading} />
            </div>
            {rangeStats ? (
              <div className="grid grid-cols-3 border-t border-ink/[0.06] sm:grid-cols-6">
                {[
                  { k: "Open", v: money(rangeStats.open) },
                  { k: "High", v: money(rangeStats.hi), tone: "text-emerald-700" },
                  { k: "Low", v: money(rangeStats.lo), tone: "text-rose-700" },
                  { k: "Last", v: money(rangeStats.close) },
                  { k: "Average", v: money(rangeStats.avg) },
                  { k: "From high", v: signedPct(rangeStats.fromHi), tone: pctTone(rangeStats.fromHi) },
                ].map((s, i) => (
                  <div key={s.k} className={cn("px-3 py-2", i > 0 && "border-l border-ink/[0.06]", i >= 3 && "border-t border-ink/[0.06] sm:border-t-0")}>
                    <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{s.k}</div>
                    <div className={cn("g-metric mt-0.5 text-[13px] font-semibold", s.tone ?? "text-ink")}>{s.v}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </Panel>

          {a ? (
            <>
              <PerformancePanel a={a} />
              <TechnicalsPanel a={a} />
              {isGold ? <KaratsPanel a={a} lens={lens} onLens={pickLens} /> : null}
              <NewsPanel a={a} />
              <AboutPanel a={a} />
            </>
          ) : (
            <div className="space-y-3">
              <Shimmer className="h-64 rounded-2xl" />
              <Shimmer className="h-64 rounded-2xl" />
            </div>
          )}
        </main>

        {/* ================================================= right rail */}
        <aside className="min-w-0 space-y-3 xl:sticky xl:top-3 xl:self-start">
          {a ? (
            <>
              <MoodCard a={a} />
              <RelatedCard a={a} />
              <EquivalentsCard a={a} price={priceUsd} />
              <HeadlinesCard a={a} />
            </>
          ) : (
            <>
              <Shimmer className="h-32 rounded-2xl" />
              <Shimmer className="h-80 rounded-2xl" />
            </>
          )}
          <p className="px-1 text-[10.5px] leading-snug text-ink-5">
            Reference data for pricing decisions; not investment advice. Publishing a shop rate still goes through{" "}
            <Link href="/gold-rates" className="font-medium text-gold-deep hover:underline">
              Gold rates
            </Link>
            .
          </p>
        </aside>
      </div>
    </div>
  );
}
