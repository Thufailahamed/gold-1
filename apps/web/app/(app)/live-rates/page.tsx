"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, errorCode, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, Callout, Modal, EmptyBlock, controlClass } from "@/components/ui";
import { Select } from "@/components/select";
import { GoldDust } from "@/components/home/effects";
import { ArrowRightIcon, CoinsIcon, TrendingUpIcon } from "@/components/icons";
import {
  ChangeChip,
  ChartTip,
  CurrencyBadge,
  KaratCard,
  LiveNumber,
  MetalCoin,
  RefreshRing,
  SectionHead,
  Segmented,
  Shimmer,
  ago,
  currencyName,
  money,
  useNow,
  usd,
} from "./parts";

type Quote = {
  symbol: string;
  name: string;
  kind: "metal" | "crypto";
  unit: "oz" | "lb" | "coin";
  priceUsd: number;
  priceLkr: number;
  lkrPerGram: number | null;
  updatedAt: number;
  stale: boolean;
  change24hPct: number | null;
};

type Karat = {
  purityId: string;
  karat: string;
  purity: number;
  lkrPerGram: number;
  lkrPerPawn: number;
  change24hPct: number | null;
  boardRate: number | null;
  boardEffectiveFrom: number | null;
  boardDiffPct: number | null;
};

type Live = {
  fetchedAt: number;
  stale: boolean;
  usdLkr: number;
  fxUpdatedAt: number;
  sources: { name: string; url: string }[];
  quotes: Quote[];
  karats: Karat[];
  fx: { code: string; perUsd: number; lkrPer: number }[];
  rates: Record<string, number>;
};

type History = {
  symbol: string;
  name: string;
  unit: Quote["unit"];
  points: { t: number; priceUsd: number; priceLkr: number; lkrPerGram: number | null }[];
};

type Range = "1d" | "7d" | "30d" | "1y";

const REFRESH_MS = 60_000;
const CCY_KEY = "goldos.liveRates.currency";
/** Pinned to the top of the currency picker; everything else follows A–Z. */
const PINNED = ["LKR", "USD", "EUR", "GBP", "INR", "AED", "SAR", "QAR", "KWD", "OMR", "AUD", "CAD", "SGD", "JPY", "CNY"];
const RANGE_LABEL: Record<Range, string> = { "1d": "24 hours", "7d": "7 days", "30d": "30 days", "1y": "12 months" };
const unitWord = (u: Quote["unit"] | undefined) => (u === "coin" ? "coin" : u === "lb" ? "lb" : "oz");

export default function LiveRatesPage() {
  const qc = useQueryClient();
  const now = useNow(1000);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canPublish = hasPermission(me.data?.permissions ?? [], "masters:create");

  const live = useQuery({
    queryKey: ["market-live"],
    queryFn: () => api<Live>("/api/v1/market/live"),
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
  });
  const data = live.data;

  /* ---------- display currency (a per-viewer preference, kept by the browser) */
  const [ccy, setCcyState] = useState("LKR");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CCY_KEY);
      if (saved) setCcyState(saved);
    } catch {}
  }, []);
  const setCcy = (c: string) => {
    setCcyState(c);
    try {
      localStorage.setItem(CCY_KEY, c);
    } catch {}
  };
  const currencyOptions = useMemo(() => {
    const codes = Object.keys(data?.rates ?? { LKR: 1, USD: 1 });
    const pinned = PINNED.filter((c) => codes.includes(c));
    return [...pinned, ...codes.filter((c) => !pinned.includes(c)).sort()].map((c) => ({
      value: c,
      label: c,
      hint: currencyName(c),
    }));
  }, [data?.rates]);
  // A saved currency the feed can't price right now (e.g. FX outage) falls back to LKR.
  const display = data && !(ccy in data.rates) ? "LKR" : ccy;
  const perUsd = (code: string) => data?.rates[code] ?? (code === "USD" ? 1 : NaN);
  /** Multiply an LKR amount by this to get the display currency. */
  const fromLkr = data ? (display === "LKR" ? 1 : perUsd(display) / data.usdLkr) : 1;
  const conv = (lkrAmount: number) => lkrAmount * fromLkr;

  /* ---------- chart */
  const [symbol, setSymbol] = useState("XAU");
  const [range, setRange] = useState<Range>("7d");
  const [basis, setBasis] = useState<"g" | "unit">("g");
  const history = useQuery({
    queryKey: ["market-history", symbol, range],
    queryFn: () => api<History>(`/api/v1/market/history?symbol=${symbol}&range=${range}`),
    refetchInterval: REFRESH_MS * 5,
  });
  const quoteFor = data?.quotes.find((q) => q.symbol === symbol);
  const hasGram = quoteFor ? quoteFor.lkrPerGram != null : !["BTC", "ETH"].includes(symbol);
  const perUnit = basis === "unit" || !hasGram;

  // History is stored in USD with that day's USD/LKR, so LKR is exact through
  // time; any other currency uses today's cross rate.
  const chart = useMemo(() => {
    if (!data) return [];
    const ccyPerUsd = display === "LKR" ? null : perUsd(display);
    const value = (p: { priceUsd: number; priceLkr: number; lkrPerGram: number | null }) => {
      const lkr = perUnit || p.lkrPerGram == null ? p.priceLkr : p.lkrPerGram;
      return ccyPerUsd == null ? lkr : (lkr / p.priceLkr) * p.priceUsd * ccyPerUsd;
    };
    const rows = (history.data?.points ?? []).map((p) => ({ t: p.t, v: value(p) }));
    // Close the line at the live price so the chart never lags the cards.
    if (quoteFor && rows.length && quoteFor.updatedAt > rows[rows.length - 1]!.t)
      rows.push({ t: quoteFor.updatedAt, v: value(quoteFor) });
    return rows;
  }, [history.data, quoteFor, perUnit, display, data]);
  const chartUnit = perUnit ? `${display}/${unitWord(history.data?.unit ?? quoteFor?.unit)}` : `${display}/g`;
  const stats = useMemo(() => {
    if (chart.length < 2) return null;
    const vs = chart.map((r) => r.v);
    const open = vs[0]!;
    const close = vs[vs.length - 1]!;
    return { open, close, high: Math.max(...vs), low: Math.min(...vs), pct: open > 0 ? ((close - open) / open) * 100 : null };
  }, [chart]);
  const liveChartValue = quoteFor
    ? conv(perUnit || quoteFor.lkrPerGram == null ? quoteFor.priceLkr : quoteFor.lkrPerGram)
    : null;
  const fmtTick = (t: number) =>
    range === "1d"
      ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });

  /* ---------- FX board + converter */
  const fxRows = useMemo(() => {
    if (!data) return [];
    const base = perUsd(display);
    return ["LKR", ...data.fx.map((f) => f.code)]
      .filter((c, i, a) => a.indexOf(c) === i && c !== display && perUsd(c) > 0)
      .map((code) => ({ code, value: base / perUsd(code), perUsd: perUsd(code) }));
  }, [data, display]);
  const [convAmount, setConvAmount] = useState("1");
  const [convFrom, setConvFrom] = useState("USD");
  const converted = data ? (Number(convAmount) || 0) * (perUsd(display) / perUsd(convFrom)) : null;

  /* ---------- publish a board rate from the market */
  const [publish, setPublish] = useState<{ karat: Karat; rate: string } | null>(null);
  const create = useMutation({
    mutationFn: (v: { purityId: string; ratePerGram: number }) =>
      api("/api/v1/gold-rates", {
        method: "POST",
        body: JSON.stringify({ purityId: v.purityId, ratePerGram: v.ratePerGram, effectiveFrom: Date.now() }),
      }),
    onSuccess: () => {
      toast.success("Board rate published");
      setPublish(null);
      qc.invalidateQueries({ queryKey: ["market-live"] });
      qc.invalidateQueries({ queryKey: ["gold-rates-current"] });
      qc.invalidateQueries({ queryKey: ["gold-rates-history"] });
    },
    onError: (e) => {
      if (errorCode(e) === "PENDING") {
        toast.info("Rate change sent for approval");
        setPublish(null);
        return;
      }
      toast.error(e instanceof Error ? e.message : "Publish failed");
    },
  });

  /* ---------- headline figures */
  const gold = data?.quotes.find((q) => q.symbol === "XAU");
  const silver = data?.quotes.find((q) => q.symbol === "XAG");
  const k24 = data?.karats.find((k) => k.purity >= 0.999) ?? data?.karats[0];
  const k22 = data?.karats.find((k) => k.karat === "22K");
  const since = live.dataUpdatedAt || now;
  const refreshProgress = (now - since) / REFRESH_MS;
  const secondsLeft = Math.max(0, Math.ceil((REFRESH_MS - (now - since)) / 1000));
  const ticker = (data?.quotes ?? []).map((q) => ({
    key: q.symbol,
    label: q.name,
    value: conv(q.lkrPerGram ?? q.priceLkr),
    unit: q.lkrPerGram != null ? `${display}/g` : `${display}/${unitWord(q.unit)}`,
    change: q.change24hPct,
  }));

  return (
    <Page>
      {/* ================================================================ HERO */}
      {/* Not overflow-hidden: the currency dropdown must be free to open past the edge. */}
      <section className="relative z-10 rounded-[24px] bg-void text-paper shadow-5">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[24px]">
          <div className="home-grid-bg absolute inset-0 opacity-50" />
          <div className="absolute -right-24 -top-32 size-[420px] rounded-full bg-gold/[0.18] blur-[110px]" />
          <div className="absolute -bottom-40 left-[20%] size-80 rounded-full bg-gold-deep/25 blur-[120px]" />
          <GoldDust className="absolute inset-0 size-full opacity-70" density={0.00005} />
          <div className="home-noise absolute inset-0" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
        </div>

        <div className="relative px-5 pb-6 pt-5 sm:px-8 sm:pb-8 sm:pt-7">
          {/* top bar */}
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
                <span className="relative flex size-2">
                  <span
                    className={cn(
                      "absolute inline-flex size-full rounded-full opacity-70",
                      data?.stale ? "bg-amber-400" : "animate-ping bg-emerald-400"
                    )}
                  />
                  <span className={cn("relative inline-flex size-2 rounded-full", data?.stale ? "bg-amber-400" : "bg-emerald-400")} />
                </span>
                {data?.stale ? "Delayed feed" : "Live market"}
              </span>
              <span className="text-xs text-paper/45">
                {data ? `Updated ${ago(data.fetchedAt, now)} · next in ${secondsLeft}s` : "Connecting to market feed…"}
              </span>
            </div>

            <div className="home-glass flex flex-wrap items-center gap-2 !rounded-2xl p-2">
              <div className="min-w-[210px] flex-1">
                <Select
                  value={display}
                  onChange={setCcy}
                  options={currencyOptions}
                  ariaLabel="Display currency"
                  icon={<CoinsIcon size={13} />}
                  hintInTrigger
                  searchable
                  loading={live.isLoading}
                />
              </div>
              <RefreshRing
                progress={refreshProgress}
                spinning={live.isFetching}
                secondsLeft={secondsLeft}
                onClick={() => live.refetch()}
              />
              <Link href="/gold-rates" className="home-btn-gold h-10 px-4 text-sm">
                Board rates
                <ArrowRightIcon size={14} />
              </Link>
            </div>
          </div>

          {/* headline */}
          <div className="mt-8 grid gap-8 lg:grid-cols-[1.35fr_1fr] lg:items-end">
            <div className="min-w-0">
              <h1 className="g-display text-[30px] leading-[1.05] sm:text-[40px]">
                Live <span className="home-gold-text">Rates</span>
              </h1>
              <p className="mt-2 max-w-lg text-sm leading-relaxed text-paper/55">
                International spot prices, converted at today&apos;s exchange rates, side by side with the rates on your
                board.
              </p>

              <div className="mt-7">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-paper/45">
                  <MetalCoin symbol="XAU" size={18} />
                  Fine gold {k24 ? `· ${k24.karat}` : ""} · per gram
                </div>
                {k24 ? (
                  <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
                    <div className="flex items-baseline gap-2">
                      <LiveNumber value={conv(k24.lkrPerGram)} tone="dark" className="text-[44px] leading-none text-paper sm:text-[60px]" />
                      <span className="text-base font-semibold text-gold-light">{display}</span>
                    </div>
                    <ChangeChip pct={k24.change24hPct} tone="dark" suffix={<span className="ml-1 font-sans font-medium opacity-60">24h</span>} className="mb-2" />
                  </div>
                ) : (
                  <Shimmer dark className="mt-3 h-14 w-72" />
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {[
                {
                  label: `24K · pawn (8g)`,
                  value: k24 ? conv(k24.lkrPerPawn) : null,
                  unit: display,
                },
                {
                  label: `22K · pawn (8g)`,
                  value: k22 ? conv(k22.lkrPerPawn) : null,
                  unit: display,
                },
                { label: "Spot gold", value: gold?.priceUsd ?? null, unit: "USD/oz", fmt: usd },
                display === "USD"
                  ? { label: "USD → LKR", value: data?.usdLkr ?? null, unit: "LKR" }
                  : silver
                    ? { label: "Silver · per gram", value: silver.lkrPerGram != null ? conv(silver.lkrPerGram) : null, unit: display }
                    : { label: `USD → ${display}`, value: data ? perUsd(display) : null, unit: display },
              ].map((s) => (
                <div key={s.label} className="home-glass !rounded-2xl px-4 py-3.5">
                  <div className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-paper/40">{s.label}</div>
                  {s.value != null ? (
                    <div className="mt-1.5 flex items-baseline gap-1.5">
                      <LiveNumber value={s.value} format={s.fmt ?? money} tone="dark" className="truncate text-xl leading-none text-paper" />
                      <span className="text-[10px] font-semibold text-paper/40">{s.unit}</span>
                    </div>
                  ) : (
                    <Shimmer dark className="mt-2 h-5 w-24" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ticker */}
        <div className="relative overflow-hidden rounded-b-[24px] border-t border-paper/[0.08] bg-paper/[0.02]">
          {ticker.length ? (
            <div className="home-marquee overflow-hidden py-3">
              <div className="home-marquee-track flex w-max gap-10 pr-10">
                {[...ticker, ...ticker].map((t, i) => (
                  <button
                    key={`${t.key}-${i}`}
                    type="button"
                    onClick={() => setSymbol(t.key)}
                    className="flex items-center gap-2.5 whitespace-nowrap text-xs text-paper/60 transition-colors hover:text-paper"
                  >
                    <MetalCoin symbol={t.key} size={18} />
                    <span className="font-semibold text-paper/80">{t.label}</span>
                    <span className="g-metric text-paper">{money(t.value)}</span>
                    <span className="text-[10px] text-paper/35">{t.unit}</span>
                    <ChangeChip pct={t.change} tone="dark" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex gap-6 px-8 py-3">
              {[0, 1, 2, 3].map((i) => (
                <Shimmer key={i} dark className="h-5 w-40" />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ================================================================ STATUS */}
      {live.isError ? (
        <Callout
          tone="danger"
          title="Market data unavailable"
          action={
            <button onClick={() => live.refetch()} className="g-btn g-btn-secondary h-9 px-3 text-sm">
              Retry
            </button>
          }
        >
          {live.error instanceof Error ? live.error.message : "Check the API connection and retry."}
        </Callout>
      ) : data?.stale ? (
        <Callout tone="warning" title="Showing last known prices">
          The market feed did not answer just now, so some figures come from the most recent stored snapshot
          {Object.keys(data.rates).length <= 2 ? " and only LKR and USD can be shown" : ""}. They update automatically
          when the feed is back.
        </Callout>
      ) : null}

      {/* ================================================================ KARATS */}
      <section className="space-y-4">
        <SectionHead
          kicker="Gold by karat"
          title={`Market vs your board · ${display}`}
          aside="Spot × purity · excludes duty, premium and making"
        />
        {live.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="g-surface space-y-4 p-5">
                <Shimmer className="h-11 w-28" />
                <Shimmer className="h-8 w-40" />
                <Shimmer className="h-16 w-full" />
              </div>
            ))}
          </div>
        ) : !data?.karats.length ? (
          <div className="g-surface">
            <EmptyBlock title="No gold price" description="Gold spot is unavailable or no purities are active." />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {data.karats.map((k, i) => (
              <KaratCard
                key={k.purityId}
                featured={i === 0}
                karat={k.karat}
                purity={k.purity}
                perGram={conv(k.lkrPerGram)}
                perPawn={conv(k.lkrPerPawn)}
                change={k.change24hPct}
                board={k.boardRate != null ? conv(k.boardRate) : null}
                boardDiffPct={k.boardDiffPct}
                boardSince={k.boardEffectiveFrom}
                ccy={display}
                onPublish={canPublish ? () => setPublish({ karat: k, rate: String(Math.round(k.lkrPerGram)) }) : undefined}
              />
            ))}
          </div>
        )}
      </section>

      {/* ================================================================ CHART */}
      <section className="g-surface relative">
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
        <div className="flex flex-col gap-4 px-5 pt-5 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3.5">
            <MetalCoin symbol={symbol} size={44} />
            <div className="min-w-0">
              <div className="g-kicker">Price history · {RANGE_LABEL[range]}</div>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                {liveChartValue != null ? (
                  <LiveNumber value={liveChartValue} className="text-[28px] leading-none text-ink" />
                ) : (
                  <Shimmer className="h-7 w-36" />
                )}
                <span className="text-xs font-semibold text-ink-4">{chartUnit}</span>
                {stats?.pct != null ? (
                  <ChangeChip pct={Math.round(stats.pct * 100) / 100} suffix={<span className="ml-1 font-sans font-medium opacity-60">{range}</span>} />
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-[190px]">
              <Select
                value={symbol}
                onChange={setSymbol}
                ariaLabel="Market"
                searchable={false}
                icon={<TrendingUpIcon size={13} />}
                options={(data?.quotes ?? [{ symbol: "XAU", name: "Gold", kind: "metal" as const }]).map((q) => ({
                  value: q.symbol,
                  label: q.name,
                  hint: q.kind === "crypto" ? "Crypto" : "Metal",
                }))}
              />
            </div>
            {hasGram ? (
              <Segmented
                ariaLabel="Price basis"
                value={basis}
                onChange={setBasis}
                items={[
                  { key: "g", label: "Per g" },
                  { key: "unit", label: `Per ${quoteFor?.unit === "lb" ? "lb" : "oz"}` },
                ]}
              />
            ) : null}
            <Segmented
              ariaLabel="Range"
              value={range}
              onChange={setRange}
              items={[
                { key: "1d", label: "1D" },
                { key: "7d", label: "7D" },
                { key: "30d", label: "30D" },
                { key: "1y", label: "1Y" },
              ]}
            />
          </div>
        </div>

        <div className="px-2 pb-2 pt-4 sm:px-3">
          {history.isLoading ? (
            <Shimmer className="mx-3 h-72" />
          ) : chart.length < 2 ? (
            <div className="relative mx-3 flex h-72 flex-col items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-b from-gold-pale to-paper text-center shadow-[inset_0_0_0_1px_rgba(168,138,62,0.15)]">
              <svg className="absolute inset-x-0 bottom-0 h-32 w-full text-gold/25" viewBox="0 0 400 100" preserveAspectRatio="none" aria-hidden>
                <path d="M0 80 C 60 70, 90 40, 140 52 S 230 20, 280 34 S 360 10, 400 18 L400 100 L0 100Z" fill="currentColor" />
              </svg>
              <div className="relative">
                <div className="font-display text-base font-bold text-ink">History is building</div>
                <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-ink-4">
                  Prices are recorded every hour, and whenever this page is open. The chart fills in as samples accumulate.
                </p>
              </div>
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ top: 10, right: 14, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="mkt-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#CDA853" stopOpacity={0.38} />
                      <stop offset="0.7" stopColor="#CDA853" stopOpacity={0.06} />
                      <stop offset="1" stopColor="#CDA853" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="mkt-stroke" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0" stopColor="#E2C27A" />
                      <stop offset="0.6" stopColor="#CDA853" />
                      <stop offset="1" stopColor="#7E6223" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(16,32,27,0.06)" strokeDasharray="3 6" vertical={false} />
                  <XAxis
                    dataKey="t"
                    type="number"
                    scale="time"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={fmtTick}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={40}
                    tick={{ fill: "#5d6e68", fontSize: 11 }}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    width={60}
                    tick={{ fill: "#93a29c", fontSize: 11 }}
                    tickFormatter={(v: number) => Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v)}
                  />
                  {stats ? <ReferenceLine y={stats.open} stroke="rgba(16,32,27,0.25)" strokeDasharray="2 4" /> : null}
                  <Tooltip
                    cursor={{ stroke: "rgba(168,138,62,0.5)", strokeDasharray: "3 3" }}
                    content={(p) => (
                      <ChartTip
                        {...(p as unknown as { active?: boolean; payload?: { value?: number }[]; label?: number })}
                        unit={chartUnit}
                        name={history.data?.name ?? symbol}
                      />
                    )}
                  />
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke="url(#mkt-stroke)"
                    strokeWidth={2.25}
                    fill="url(#mkt-fill)"
                    isAnimationActive={false}
                    activeDot={{ r: 5, fill: "#CDA853", stroke: "#fff", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 border-t border-ink/[0.07] sm:grid-cols-4">
          {[
            { label: "Open", v: stats?.open },
            { label: "High", v: stats?.high },
            { label: "Low", v: stats?.low },
            { label: "Last", v: stats?.close },
          ].map((s, i) => (
            <div key={s.label} className={cn("px-5 py-3.5 sm:px-6", i > 0 && "sm:border-l sm:border-ink/[0.07]", i % 2 === 1 && "border-l border-ink/[0.07]", i >= 2 && "border-t border-ink/[0.07] sm:border-t-0")}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-5">{s.label}</div>
              <div className="g-metric mt-1 text-[15px] text-ink">{s.v != null ? money(s.v) : "—"}</div>
            </div>
          ))}
        </div>
        {display !== "LKR" && stats ? (
          <div className="rounded-b-2xl border-t border-ink/[0.07] bg-bone/60 px-5 py-2.5 text-[11px] text-ink-4 sm:px-6">
            Converted to {display} at today&apos;s rate; LKR history uses each day&apos;s own exchange rate.
          </div>
        ) : null}
      </section>

      {/* ================================================================ MARKETS + FX */}
      <div className="grid gap-4 lg:grid-cols-5">
        <section className="g-surface overflow-hidden lg:col-span-3">
          <div className="flex items-end justify-between gap-3 px-5 pb-3 pt-5 sm:px-6">
            <div>
              <div className="g-kicker">Metals & markets</div>
              <h3 className="mt-1 font-display text-lg font-bold tracking-tight text-ink">International spot in {display}</h3>
            </div>
            <span className="hidden text-xs text-ink-5 sm:block">Tap a row to chart it</span>
          </div>
          <div className="px-2 pb-2 sm:px-3">
            {live.isLoading
              ? [0, 1, 2, 3, 4].map((i) => <Shimmer key={i} className="m-2 h-14" />)
              : (data?.quotes ?? []).map((q) => {
                  const on = q.symbol === symbol;
                  return (
                    <button
                      key={q.symbol}
                      type="button"
                      onClick={() => setSymbol(q.symbol)}
                      className={cn(
                        "group relative flex w-full items-center gap-3.5 rounded-2xl px-3 py-3 text-left transition-all duration-200 ease-brand",
                        on ? "bg-gold-pale shadow-[inset_0_0_0_1px_rgba(168,138,62,0.22)]" : "hover:bg-bone"
                      )}
                    >
                      {on ? <span className="absolute inset-y-3 left-0 w-[3px] rounded-full bg-gradient-to-b from-gold-light to-gold-dark" /> : null}
                      <MetalCoin symbol={q.symbol} size={38} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-ink">{q.name}</span>
                          {q.stale ? (
                            <span className="rounded-full bg-amber-600/15 px-1.5 py-px text-[10px] font-semibold text-amber-700">Delayed</span>
                          ) : null}
                        </div>
                        <div className="g-metric text-[11px] text-ink-5">
                          {q.symbol} · {usd(q.priceUsd)} USD/{unitWord(q.unit)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-baseline justify-end gap-1">
                          <LiveNumber value={conv(q.lkrPerGram ?? q.priceLkr)} className="text-[15px] font-semibold text-ink" />
                          <span className="text-[10px] font-semibold text-ink-5">
                            {display}/{q.lkrPerGram != null ? "g" : unitWord(q.unit)}
                          </span>
                        </div>
                        <div className="mt-1 flex justify-end">
                          <ChangeChip pct={q.change24hPct} />
                        </div>
                      </div>
                    </button>
                  );
                })}
          </div>
        </section>

        <section className="g-surface lg:col-span-2">
          <div className="px-5 pb-4 pt-5 sm:px-6">
            <div className="g-kicker">Exchange</div>
            <h3 className="mt-1 font-display text-lg font-bold tracking-tight text-ink">Currency rates</h3>

            {/* converter */}
            <div className="mt-4 rounded-2xl bg-void p-4 text-paper shadow-[inset_0_0_0_1px_rgba(226,194,122,0.18)]">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-light/80">Quick convert</div>
              <div className="mt-3 flex gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={convAmount}
                  onChange={(e) => setConvAmount(e.target.value)}
                  aria-label="Amount"
                  className="g-metric h-11 w-0 min-w-0 flex-1 rounded-xl bg-paper/[0.06] px-3.5 text-base text-paper shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] placeholder:text-paper/30 focus:outline-none focus:shadow-[inset_0_0_0_1px_rgba(226,194,122,0.7),0_0_0_4px_rgba(205,168,83,0.18)]"
                />
                <div className="w-[118px] shrink-0">
                  <Select value={convFrom} onChange={setConvFrom} options={currencyOptions} ariaLabel="Convert from" searchable />
                </div>
              </div>
              <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-paper/[0.08] pt-3">
                <span className="text-xs text-paper/45">= in {display}</span>
                {converted != null && Number.isFinite(converted) ? (
                  <span className="flex items-baseline gap-1.5">
                    <LiveNumber value={converted} tone="dark" className="text-2xl leading-none text-paper" />
                    <span className="text-xs font-semibold text-gold-light">{display}</span>
                  </span>
                ) : (
                  <Shimmer dark className="h-6 w-28" />
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-ink/[0.07] px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-5 sm:px-6">
            <span>1 unit in {display}</span>
            <span>{data ? `Updated ${ago(data.fxUpdatedAt, now)}` : ""}</span>
          </div>
          <div className="max-h-[420px] overflow-y-auto px-2 pb-2 scrollbar-thin sm:px-3">
            {live.isLoading
              ? [0, 1, 2, 3, 4, 5].map((i) => <Shimmer key={i} className="m-2 h-11" />)
              : fxRows.map((f) => (
                  <button
                    key={f.code}
                    type="button"
                    onClick={() => setCcy(f.code)}
                    title={`Show all prices in ${f.code}`}
                    className="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-200 hover:bg-bone"
                  >
                    <CurrencyBadge code={f.code} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{currencyName(f.code)}</div>
                      <div className="g-metric text-[11px] text-ink-5">{f.perUsd.toLocaleString("en-US", { maximumFractionDigits: 4 })} per USD</div>
                    </div>
                    <div className="text-right">
                      <span className="g-metric text-sm font-semibold text-ink">{money(f.value)}</span>
                      <span className="ml-1 text-[10px] font-semibold text-ink-5">{display}</span>
                    </div>
                  </button>
                ))}
          </div>
        </section>
      </div>

      {/* ================================================================ SOURCES */}
      {data ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-ink/[0.03] px-5 py-3 text-[11px] text-ink-4 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.05)]">
          <span>
            Sources:{" "}
            {data.sources.map((s, i) => (
              <span key={s.url}>
                {i > 0 ? " · " : ""}
                <a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-ink-3 underline decoration-gold/40 underline-offset-2 hover:text-gold-deep">
                  {s.name}
                </a>
              </span>
            ))}
          </span>
          <span>Indicative international spot prices, not a quote to buy or sell.</span>
        </div>
      ) : null}

      {/* ================================================================ PUBLISH */}
      {publish ? (
        <PublishDialog
          karat={publish.karat}
          rate={publish.rate}
          setRate={(rate) => setPublish({ ...publish, rate })}
          pending={create.isPending}
          onClose={() => setPublish(null)}
          onSubmit={() => {
            const n = Number(publish.rate);
            if (!(n > 0)) return void toast.error("Rate must be above 0");
            create.mutate({ purityId: publish.karat.purityId, ratePerGram: n });
          }}
        />
      ) : null}
    </Page>
  );
}

/** Board rates are always LKR: the till prices in it, whatever currency the viewer reads. */
function PublishDialog({
  karat,
  rate,
  setRate,
  pending,
  onClose,
  onSubmit,
}: {
  karat: Karat;
  rate: string;
  setRate: (r: string) => void;
  pending: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const n = Number(rate);
  const vsMarket = n > 0 ? ((n - karat.lkrPerGram) / karat.lkrPerGram) * 100 : null;
  const vsBoard = n > 0 && karat.boardRate ? ((n - karat.boardRate) / karat.boardRate) * 100 : null;
  const presets = [
    { label: "Market", v: karat.lkrPerGram },
    { label: "+1%", v: karat.lkrPerGram * 1.01 },
    { label: "+2%", v: karat.lkrPerGram * 1.02 },
    { label: "+3%", v: karat.lkrPerGram * 1.03 },
    ...(karat.boardRate ? [{ label: "Keep board", v: karat.boardRate }] : []),
  ];
  return (
    <Modal
      title={`Set ${karat.karat} board rate`}
      kicker="From live market"
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Publish now"
      pending={pending}
      submitDisabled={!(n > 0)}
    >
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-void px-3.5 py-3 text-paper">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-light/80">Market</div>
            <div className="g-metric mt-1 text-lg leading-none">{money(karat.lkrPerGram)}</div>
            <div className="mt-1 text-[10px] text-paper/40">LKR per gram</div>
          </div>
          <div className="rounded-xl bg-bone px-3.5 py-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.06)]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-5">Current board</div>
            <div className="g-metric mt-1 text-lg leading-none text-ink">{karat.boardRate != null ? money(karat.boardRate) : "—"}</div>
            <div className="mt-1 text-[10px] text-ink-5">LKR per gram</div>
          </div>
        </div>

        <div>
          <label htmlFor="board-rate" className="mb-1.5 block text-xs font-medium text-ink-3">
            New board rate per gram
          </label>
          <div className="relative">
            <input
              id="board-rate"
              type="number"
              step="any"
              className={cn(controlClass, "g-metric h-12 w-full rounded-xl pr-14 text-lg")}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              autoFocus
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-5">LKR</span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {presets.map((p) => {
              const on = Math.round(p.v) === Math.round(n);
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setRate(String(Math.round(p.v)))}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all duration-200",
                    on ? "bg-void text-gold-light" : "bg-ink/[0.05] text-ink-3 hover:bg-gold-pale hover:text-gold-deep"
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-gold-pale/70 px-3.5 py-2.5 text-xs text-ink-3 shadow-[inset_0_0_0_1px_rgba(168,138,62,0.18)]">
          <span>vs market</span>
          <ChangeChip pct={vsMarket != null ? Math.round(vsMarket * 100) / 100 : null} />
          {karat.boardRate ? (
            <>
              <span className="ml-2">vs current board</span>
              <ChangeChip pct={vsBoard != null ? Math.round(vsBoard * 100) / 100 : null} />
            </>
          ) : null}
        </div>
        <p className="text-xs leading-relaxed text-ink-4">
          The board is always priced in LKR. It takes effect immediately; large changes may need approval.
        </p>
      </div>
    </Modal>
  );
}
