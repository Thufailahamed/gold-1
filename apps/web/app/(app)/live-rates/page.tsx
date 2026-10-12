"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
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
  BitcoinIcon,
  EthereumIcon,
  GoldCoinIcon,
  SilverCoinIcon,
  PlatinumCoinIcon,
  PalladiumCoinIcon,
  CopperCoinIcon,
  GoldBarIcon,
  SovereignPawnIcon,
  FxExchangeIcon,
  RatioScaleIcon,
  SpreadGaugeIcon,
  CountryFlag,
} from "@/components/market-icons";
import {
  ChangeChip,
  ChartTip,
  CurrencyBadge,
  Kpi,
  LiveNumber,
  MetalCoin,
  PanelHead,
  RefreshRing,
  Segmented,
  CardBody,
  HoverCard,
  HoverRow,
  Shimmer,
  Sparkline,
  SpreadMeter,
  seriesStats,
  useHoverCard,
  ago,
  currencyName,
  ccyTone,
  karatTone,
  money,
  REGIONS,
  spreadTone,
  symbolTone,
  useNow,
  usd,
} from "./parts";
import { BoardHistory, BuyBackDesk, GoldPerformance, RetailQuote, VaultValue } from "./business";
import { GoldMoves, KaratBars, RelativePerformance } from "./insights";

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
  changeFrom?: number | null;
};

type Karat = {
  purityId: string;
  karat: string;
  purity: number;
  lkrPerGram: number;
  lkrPerPawn: number;
  change24hPct: number | null;
  changeFrom?: number | null;
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
type Pt = History["points"][number];
/** Every market the feed quotes; each gets a 24h history for sparklines and hover cards. */
const SYMBOLS = ["XAU", "XAG", "XPT", "XPD", "HG", "BTC", "ETH"];

const REFRESH_MS = 60_000;
const CCY_KEY = "goldos.liveRates.currency";
/** Pinned to the top of the currency picker; everything else follows A–Z. */
const PINNED = ["LKR", "USD", "EUR", "GBP", "INR", "AED", "SAR", "QAR", "KWD", "OMR", "AUD", "CAD", "SGD", "JPY", "CNY"];
const RANGE_LABEL: Record<Range, string> = { "1d": "24 hours", "7d": "7 days", "30d": "30 days", "1y": "12 months" };
type WeightUnit = "g" | "pawn" | "tola" | "oz";
/** Grams per unit: Sri Lankan pawn (8 g), Indian tola, troy ounce. */
const UNIT_G: Record<WeightUnit, number> = { g: 1, pawn: 8, tola: 11.6638, oz: 31.1035 };
const UNIT_LABEL: Record<WeightUnit, string> = { g: "Gram", pawn: "Pawn", tola: "Tola", oz: "Troy oz" };
const inputCls =
  "g-metric h-9 w-full min-w-0 rounded-lg bg-paper px-3 text-sm text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12)] transition-shadow focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_3px_rgba(205,168,83,0.24)]";
const unitWord = (u: Quote["unit"] | undefined) => (u === "coin" ? "coin" : u === "lb" ? "lb" : "oz");
/** Weights a counter quotes most, smallest first. */
const LADDER = [
  { label: "1 gram", g: 1 },
  { label: "1 pawn", g: 8, hint: "8 g" },
  { label: "10 grams", g: 10 },
  { label: "1 tola", g: UNIT_G.tola, hint: "11.66 g" },
  { label: "1 troy oz", g: UNIT_G.oz, hint: "31.10 g" },
  { label: "5 pawn", g: 40, hint: "40 g" },
  { label: "100 grams", g: 100 },
  { label: "1 kilo bar", g: 1000 },
];

export default function LiveRatesPage() {
  const qc = useQueryClient();
  const now = useNow(1000);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canPublish = hasPermission(me.data?.permissions ?? [], "masters:create");
  const canSeeStock = hasPermission(me.data?.permissions ?? [], "gold:view");

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
    const high = Math.max(...vs);
    const low = Math.min(...vs);
    const avg = vs.reduce((a, v) => a + v, 0) / vs.length;
    // Spread of step-to-step returns: a plain read of how jumpy the period was.
    const rets = vs.slice(1).map((v, i) => (vs[i]! > 0 ? (v - vs[i]!) / vs[i]! : 0));
    const mean = rets.reduce((a, r) => a + r, 0) / rets.length;
    const vol = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length) * 100;
    return {
      open,
      close,
      high,
      low,
      avg,
      vol,
      pos: high > low ? (close - low) / (high - low) : 0.5,
      pct: open > 0 ? ((close - open) / open) * 100 : null,
    };
  }, [chart]);
  const tone = symbolTone(symbol);
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
  const [fxRegion, setFxRegion] = useState<string | null>(null);
  const shownFx = fxRegion ? fxRows.filter((f) => ccyTone(f.code) === REGIONS.find((r) => r.key === fxRegion)?.hex) : fxRows;
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
    from: q.changeFrom,
  }));
  const goldSilverRatio = gold && silver && silver.priceUsd > 0 ? gold.priceUsd / silver.priceUsd : null;
  const boarded = (data?.karats ?? []).filter((k) => k.boardDiffPct != null);
  const avgSpread = boarded.length ? boarded.reduce((a, k) => a + k.boardDiffPct!, 0) / boarded.length : null;
  /**
   * A karat without its own board rate is read off the nearest published one
   * by purity (same price per gram of fine gold), so every row has a figure.
   */
  const impliedBoard = (k: Karat): { rate: number; from: string } | null => {
    if (k.boardRate != null) return null;
    const ref = [...boarded].sort((a, b) => Math.abs(a.purity - k.purity) - Math.abs(b.purity - k.purity))[0];
    return ref?.boardRate != null ? { rate: (ref.boardRate / ref.purity) * k.purity, from: ref.karat } : null;
  };

  /* ---------- the last day for every market: sparklines, hover cards, insights */
  const dayHists = useQueries({
    queries: SYMBOLS.map((s) => ({
      queryKey: ["market-history", s, "1d"],
      queryFn: () => api<History>(`/api/v1/market/history?symbol=${s}&range=1d`),
      refetchInterval: REFRESH_MS * 5,
      staleTime: 60_000,
    })),
  });
  /** Day points per symbol, closed at the live quote so lines end at the cards' price. */
  const dayBy: Record<string, Pt[]> = {};
  SYMBOLS.forEach((s, i) => {
    const pts = [...(dayHists[i]?.data?.points ?? [])];
    const q = data?.quotes.find((x) => x.symbol === s);
    if (q && (!pts.length || q.updatedAt > pts[pts.length - 1]!.t))
      pts.push({ t: Math.max(q.updatedAt, pts[pts.length - 1]?.t ?? 0), priceUsd: q.priceUsd, priceLkr: q.priceLkr, lkrPerGram: q.lkrPerGram });
    dayBy[s] = pts;
  });
  /** Fine-gold LKR/g through the day, scaled to a purity and the display currency. */
  const goldLine = (purity: number, grams = 1) => dayBy.XAU!.filter((p) => p.lkrPerGram != null).map((p) => conv(p.lkrPerGram! * purity * grams));
  const spark = goldLine(k24?.purity ?? 1);
  const sparkLo = spark.length ? Math.min(...spark) : null;
  const sparkHi = spark.length ? Math.max(...spark) : null;
  const fxLine = dayBy.XAU!.map((p) => p.priceLkr / p.priceUsd);
  const ratioLine = (() => {
    const ag = new Map(dayBy.XAG!.map((p) => [p.t, p.priceUsd]));
    return dayBy.XAU!.flatMap((p) => (ag.get(p.t) ? [p.priceUsd / ag.get(p.t)!] : []));
  })();
  const spreadLine = boarded.length
    ? dayBy.XAU!.filter((p) => p.lkrPerGram != null).map(
        (p) => boarded.reduce((a, k) => a + ((k.boardRate! - p.lkrPerGram! * k.purity) / (p.lkrPerGram! * k.purity)) * 100, 0) / boarded.length
      )
    : [];
  const signed = (n: number, f: (n: number) => string = money) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${f(Math.abs(n))}`;
  /** Standard rows for a priced-gold hover card. */
  const goldRows = (k: Karat) => {
    const s = seriesStats(goldLine(k.purity));
    return [
      { k: "Per gram", v: money(conv(k.lkrPerGram)) },
      { k: "Pawn · 8 g", v: money(conv(k.lkrPerPawn)) },
      { k: "10 grams", v: money(conv(k.lkrPerGram * 10)) },
      { k: "Tola · 11.66 g", v: money(conv(k.lkrPerGram * UNIT_G.tola)) },
      { k: "Troy ounce", v: money(conv(k.lkrPerGram * UNIT_G.oz)) },
      { k: "Fine gold in a pawn", v: `${(8 * k.purity).toFixed(3)} g` },
      ...(s ? [{ k: "Move today / gram", v: signed(s.chg), tone: s.chg > 0 ? "text-emerald-300" : s.chg < 0 ? "text-rose-300" : undefined }] : []),
    ];
  };
  const fxTarget = display === "USD" ? "LKR" : display;
  const fxValue = data ? (fxTarget === "LKR" ? data.usdLkr : perUsd(fxTarget)) : null;

  /* ---------- gold value calculator */
  const [calcW, setCalcW] = useState("8");
  const [calcUnit, setCalcUnit] = useState<WeightUnit>("g");
  const [calcKarat, setCalcKarat] = useState("");
  const calcK = data?.karats.find((k) => k.purityId === calcKarat) ?? k22 ?? k24;
  const grams = (Number(calcW) || 0) * UNIT_G[calcUnit];
  const calcMarket = calcK ? conv(grams * calcK.lkrPerGram) : null;
  const calcImplied = calcK ? impliedBoard(calcK) : null;
  const calcBoardRate = calcK?.boardRate ?? calcImplied?.rate ?? null;
  const calcBoard = calcBoardRate != null ? conv(grams * calcBoardRate) : null;

  /* ---------- market pulse: movers, weight ladder, cross-market ratios */
  const movers = useMemo(
    () =>
      [...(data?.quotes ?? [])].sort((a, b) =>
        a.change24hPct == null ? 1 : b.change24hPct == null ? -1 : b.change24hPct - a.change24hPct
      ),
    [data?.quotes]
  );
  const maxMove = Math.max(0.5, ...movers.map((q) => Math.abs(q.change24hPct ?? 0)));
  const [ladderKarat, setLadderKarat] = useState("");
  const ladderK = data?.karats.find((k) => k.purityId === ladderKarat) ?? k24;
  const quote = (s: string) => data?.quotes.find((q) => q.symbol === s);
  const plat = quote("XPT");
  const pall = quote("XPD");
  const btc = quote("BTC");
  const eth = quote("ETH");
  const ratios: { label: string; hint: string; v: number | null; fmt: (n: number) => string; tone: string; icon: React.ReactNode }[] = [
    { label: "Gold / silver", hint: "oz of silver per oz of gold", v: goldSilverRatio, fmt: (n) => `${n.toFixed(1)} : 1`, tone: symbolTone("XAG"), icon: <RatioScaleIcon size={16} /> },
    { label: "Gold / platinum", hint: "oz of platinum per oz of gold", v: gold && plat ? gold.priceUsd / plat.priceUsd : null, fmt: (n) => `${n.toFixed(2)} : 1`, tone: symbolTone("XPT"), icon: <PlatinumCoinIcon size={16} /> },
    { label: "Gold / palladium", hint: "oz of palladium per oz of gold", v: gold && pall ? gold.priceUsd / pall.priceUsd : null, fmt: (n) => `${n.toFixed(2)} : 1`, tone: symbolTone("XPD"), icon: <PalladiumCoinIcon size={16} /> },
    { label: "1 Bitcoin buys", hint: "troy oz of gold", v: gold && btc ? btc.priceUsd / gold.priceUsd : null, fmt: (n) => `${n.toFixed(2)} oz`, tone: symbolTone("BTC"), icon: <BitcoinIcon size={16} /> },
    { label: "1 Ether buys", hint: "grams of gold", v: gold && eth ? eth.priceUsd / (gold.priceUsd / UNIT_G.oz) : null, fmt: (n) => `${n.toFixed(1)} g`, tone: symbolTone("ETH"), icon: <EthereumIcon size={16} /> },
    { label: "Spot gold per gram", hint: "international, USD", v: gold ? gold.priceUsd / UNIT_G.oz : null, fmt: (n) => `$${usd(n)}`, tone: symbolTone("XAU"), icon: <GoldBarIcon size={16} /> },
    { label: "24K − 22K per gram", hint: `purity premium, ${display}`, v: k24 && k22 ? conv(k24.lkrPerGram - k22.lkrPerGram) : null, fmt: money, tone: "#D97706", icon: <GoldCoinIcon size={16} /> },
    { label: "1 USD buys", hint: "milligrams of 24K gold", v: k24 && data ? (data.usdLkr / k24.lkrPerGram) * 1000 : null, fmt: (n) => `${n.toFixed(1)} mg`, tone: "#38BDF8", icon: <CountryFlag code="USD" size={16} /> },
  ];

  return (
    <Page className="space-y-4">
      {/* ================================================================ HERO */}
      {/* Not overflow-hidden: the currency dropdown must be free to open past the edge. */}
      <section className="relative z-10 rounded-[20px] bg-void text-paper shadow-5">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[20px]">
          <div className="home-grid-bg absolute inset-0 opacity-40" />
          <div className="absolute -right-24 -top-40 size-[380px] rounded-full bg-gold/[0.16] blur-[110px]" />
          <div className="absolute -bottom-40 left-[15%] size-72 rounded-full bg-gold-deep/25 blur-[120px]" />
          <GoldDust className="absolute inset-0 size-full opacity-60" density={0.00004} />
          <div className="home-noise absolute inset-0" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
        </div>

        {/* top bar */}
        <div className="relative flex flex-col gap-3 px-4 pt-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="relative">
              <MetalCoin symbol="XAU" size={42} />
              <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-void" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="g-display text-[24px] leading-none">
                  Live <span className="home-gold-text">Rates</span>
                </h1>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-gold-light">
                  <span className="relative flex size-1.5">
                    <span
                      className={cn(
                        "absolute inline-flex size-full rounded-full opacity-70",
                        data?.stale ? "bg-amber-400" : "animate-ping bg-emerald-400"
                      )}
                    />
                    <span className={cn("relative inline-flex size-1.5 rounded-full", data?.stale ? "bg-amber-400" : "bg-emerald-400")} />
                  </span>
                  {data?.stale ? "Delayed" : "Live"}
                </span>
              </div>
              <div className="mt-1 truncate text-[11px] text-paper/45">
                {data ? (
                  <>
                    Updated {ago(data.fetchedAt, now)} · next in <span className="g-metric">{secondsLeft}s</span> · FX{" "}
                    {ago(data.fxUpdatedAt, now)}
                  </>
                ) : (
                  "Connecting to market feed…"
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="w-[250px]">
              <Select
                value={display}
                onChange={setCcy}
                options={currencyOptions}
                ariaLabel="Display currency"
                icon={<CountryFlag code={display} size={16} />}
                hintInTrigger
                searchable
                size="sm"
                loading={live.isLoading}
              />
            </div>
            <RefreshRing
              progress={refreshProgress}
              spinning={live.isFetching}
              secondsLeft={secondsLeft}
              onClick={() => live.refetch()}
            />
            <Link href="/gold-rates" className="home-btn-gold h-9 px-3.5 text-[13px]">
              Board rates
              <ArrowRightIcon size={13} />
            </Link>
          </div>
        </div>

        {/* KPI strip: a featured 24K tile, then the supporting figures */}
        <div className="relative mx-4 mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-paper/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07),0_30px_60px_-30px_rgba(0,0,0,0.6)] sm:mx-5 sm:grid-cols-4 xl:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))]">
          <HoverCard
            width={320}
            className="relative col-span-2 flex min-w-0 cursor-default flex-col overflow-hidden bg-void px-5 pb-3 pt-4 sm:col-span-4 xl:col-span-1 xl:row-span-2"
            content={
              k24 ? (
                <CardBody
                  kicker={`${k24.karat} · ${(k24.purity * 1000).toFixed(0)}‰ fine · ${display}`}
                  value={money(conv(k24.lkrPerGram))}
                  unit={`${display}/g`}
                  chip={<ChangeChip pct={k24.change24hPct} from={k24.changeFrom} tone="dark" className="px-1.5 py-px text-[10px]" />}
                  spark={spark}
                  color="#E2C27A"
                  rows={goldRows(k24)}
                  note={`Spot ${gold ? `$${usd(gold.priceUsd)}/oz` : "—"} × USD/LKR ${data ? data.usdLkr.toFixed(2) : "—"} ÷ 31.1035 g × purity.`}
                />
              ) : (
                <CardBody kicker="24K gold" note="Waiting for the spot price…" />
              )
            }
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,rgba(226,194,122,0.22),transparent_60%)]" />
            <span className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-gold-light via-gold to-gold/0" aria-hidden />
            <div className="relative flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-gold-light/80">
                <GoldBarIcon size={14} /> {k24?.karat ?? "24K"} · fine gold per gram
              </span>
              <ChangeChip pct={k24?.change24hPct} from={k24?.changeFrom} tone="dark" className="px-1.5 py-px text-[10px]" />
            </div>
            <div className="relative mt-2 flex items-baseline gap-1.5">
              {k24 ? (
                <LiveNumber value={conv(k24.lkrPerGram)} tone="dark" className="home-gold-text truncate text-[38px] font-semibold leading-none" />
              ) : (
                <Shimmer dark className="h-9 w-40" />
              )}
              <span className="text-[11px] font-semibold text-paper/45">{display}</span>
            </div>
            <div className="relative mt-1 text-[10.5px] text-paper/45">
              {k24 ? (
                <>
                  Pawn <span className="g-metric text-paper/75">{money(conv(k24.lkrPerPawn))}</span> · 10 g{" "}
                  <span className="g-metric text-paper/75">{money(conv(k24.lkrPerGram * 10))}</span>
                </>
              ) : (
                "Waiting for spot…"
              )}
            </div>
            <Sparkline values={spark} className="relative mt-auto pt-3" />
            <div className="relative mt-1.5 flex items-center justify-between text-[10px] text-paper/40">
              <span>
                Low <span className="g-metric text-rose-300/80">{sparkLo != null ? money(sparkLo) : "—"}</span>
              </span>
              <span className="uppercase tracking-[0.16em]">{spark.length >= 2 ? "Last 24 h" : "Recording"}</span>
              <span>
                High <span className="g-metric text-emerald-300/80">{sparkHi != null ? money(sparkHi) : "—"}</span>
              </span>
            </div>
          </HoverCard>
          <Kpi
            className="bg-void"
            tone="#F59E0B"
            label={
              <span className="flex items-center gap-1.5">
                <GoldCoinIcon size={14} /> 22K · per gram
              </span>
            }
            value={k22 ? conv(k22.lkrPerGram) : null}
            unit={display}
            sub={<ChangeChip pct={k22?.change24hPct} from={k22?.changeFrom} tone="dark" className="px-1.5 py-px text-[10px]" />}
            spark={k22 ? goldLine(k22.purity) : undefined}
            detail={
              k22 ? (
                <CardBody
                  kicker={`22K · ${(k22.purity * 1000).toFixed(0)}‰ · ${display}/g`}
                  value={money(conv(k22.lkrPerGram))}
                  unit={`${display}/g`}
                  chip={<ChangeChip pct={k22.change24hPct} from={k22.changeFrom} tone="dark" className="px-1.5 py-px text-[10px]" />}
                  spark={goldLine(k22.purity)}
                  color="#F59E0B"
                  rows={[
                    ...goldRows(k22),
                    ...(k24 ? [{ k: "Discount to 24K / g", v: money(conv(k24.lkrPerGram - k22.lkrPerGram)) }] : []),
                    ...(k22.boardRate != null ? [{ k: "Your board / g", v: money(conv(k22.boardRate)) }] : []),
                  ]}
                />
              ) : null
            }
          />
          <Kpi
            className="bg-void"
            tone="#FB923C"
            label={
              <span className="flex items-center gap-1.5">
                <SovereignPawnIcon size={14} /> 22K · pawn (8g)
              </span>
            }
            value={k22 ? conv(k22.lkrPerPawn) : null}
            unit={display}
            sub={k22 ? <>10 g <span className="g-metric ml-1 text-paper/70">{money(conv(k22.lkrPerGram * 10))}</span></> : null}
            spark={k22 ? goldLine(k22.purity, 8) : undefined}
            detail={
              k22 ? (
                <CardBody
                  kicker={`22K sovereign · 8 g · ${display}`}
                  value={money(conv(k22.lkrPerPawn))}
                  unit={display}
                  spark={goldLine(k22.purity, 8)}
                  color="#FB923C"
                  rows={[
                    { k: "Fine gold content", v: `${(8 * k22.purity).toFixed(3)} g` },
                    { k: "Alloy content", v: `${(8 * (1 - k22.purity)).toFixed(3)} g` },
                    { k: "2 pawn · 16 g", v: money(conv(k22.lkrPerPawn * 2)) },
                    { k: "5 pawn · 40 g", v: money(conv(k22.lkrPerPawn * 5)) },
                    { k: "10 pawn · 80 g", v: money(conv(k22.lkrPerPawn * 10)) },
                    ...(k22.boardRate != null ? [{ k: "At your board", v: money(conv(k22.boardRate * 8)) }] : []),
                  ]}
                  note="A Sri Lankan pawn (sovereign) is 8 grams."
                />
              ) : null
            }
          />
          <Kpi
            className="bg-void"
            tone="#FACC15"
            label={
              <span className="flex items-center gap-1.5">
                <GoldBarIcon size={14} /> Spot gold · troy oz
              </span>
            }
            value={gold?.priceUsd}
            format={usd}
            unit="USD"
            sub={<ChangeChip pct={gold?.change24hPct} from={gold?.changeFrom} tone="dark" className="px-1.5 py-px text-[10px]" />}
            spark={dayBy.XAU!.map((p) => p.priceUsd)}
            detail={
              gold ? (
                <CardBody
                  kicker="International spot · XAU / USD"
                  value={`$${usd(gold.priceUsd)}`}
                  unit="/ troy oz"
                  chip={<ChangeChip pct={gold.change24hPct} from={gold.changeFrom} tone="dark" className="px-1.5 py-px text-[10px]" />}
                  spark={dayBy.XAU!.map((p) => p.priceUsd)}
                  color="#FACC15"
                  rows={[
                    { k: "Per gram (USD)", v: `$${usd(gold.priceUsd / UNIT_G.oz)}` },
                    { k: "Per kilo (USD)", v: `$${money((gold.priceUsd / UNIT_G.oz) * 1000)}` },
                    { k: `Per oz (${display})`, v: money(conv(gold.priceLkr)) },
                    { k: "Updated", v: ago(gold.updatedAt, now) },
                  ]}
                  note={gold.stale ? "Feed delayed — showing the last stored price." : "Source: gold-api.com"}
                />
              ) : null
            }
          />
          <Kpi
            className="bg-void"
            tone="#CBD5E1"
            label={
              <span className="flex items-center gap-1.5">
                <SilverCoinIcon size={14} /> Silver · per gram
              </span>
            }
            value={silver?.lkrPerGram != null ? conv(silver.lkrPerGram) : null}
            unit={display}
            sub={<ChangeChip pct={silver?.change24hPct} from={silver?.changeFrom} tone="dark" className="px-1.5 py-px text-[10px]" />}
            spark={dayBy.XAG!.filter((p) => p.lkrPerGram != null).map((p) => conv(p.lkrPerGram!))}
            detail={
              silver?.lkrPerGram != null ? (
                <CardBody
                  kicker={`Silver · XAG · ${display}`}
                  value={money(conv(silver.lkrPerGram))}
                  unit={`${display}/g`}
                  chip={<ChangeChip pct={silver.change24hPct} from={silver.changeFrom} tone="dark" className="px-1.5 py-px text-[10px]" />}
                  spark={dayBy.XAG!.filter((p) => p.lkrPerGram != null).map((p) => conv(p.lkrPerGram!))}
                  color="#CBD5E1"
                  rows={[
                    { k: "Spot (USD/oz)", v: `$${usd(silver.priceUsd)}` },
                    { k: "10 grams", v: money(conv(silver.lkrPerGram * 10)) },
                    { k: "100 grams", v: money(conv(silver.lkrPerGram * 100)) },
                    { k: "1 kilo", v: money(conv(silver.lkrPerGram * 1000)) },
                    { k: "Sterling 925 / g", v: money(conv(silver.lkrPerGram * 0.925)) },
                  ]}
                />
              ) : null
            }
          />
          <Kpi
            className="bg-void"
            tone="#38BDF8"
            label={
              <span className="flex items-center gap-1.5">
                <FxExchangeIcon size={14} /> USD → {fxTarget}
              </span>
            }
            value={fxValue}
            unit={fxTarget}
            sub={data ? <>{data.fx.length + 1} currencies tracked</> : null}
            spark={fxTarget === "LKR" ? fxLine : undefined}
            detail={
              data ? (
                <CardBody
                  kicker={`Exchange · USD / ${fxTarget}`}
                  value={fxValue != null ? money(fxValue) : "—"}
                  unit={fxTarget}
                  spark={fxTarget === "LKR" ? fxLine : undefined}
                  color="#38BDF8"
                  rows={[
                    { k: `1 ${fxTarget} in USD`, v: fxValue ? `$${(1 / fxValue).toFixed(6)}` : "—" },
                    { k: "USD 100", v: fxValue ? money(fxValue * 100) : "—" },
                    { k: "USD 1,000", v: fxValue ? money(fxValue * 1000) : "—" },
                    { k: "EUR → LKR", v: perUsd("EUR") > 0 ? money(data.usdLkr / perUsd("EUR")) : "—" },
                    { k: "GBP → LKR", v: perUsd("GBP") > 0 ? money(data.usdLkr / perUsd("GBP")) : "—" },
                    { k: "AED → LKR", v: perUsd("AED") > 0 ? money(data.usdLkr / perUsd("AED")) : "—" },
                    { k: "FX updated", v: ago(data.fxUpdatedAt, now) },
                  ]}
                  note="Source: ExchangeRate-API · refreshed daily."
                />
              ) : null
            }
          />
          <Kpi
            className="bg-void"
            tone="#A78BFA"
            label={
              <span className="flex items-center gap-1.5">
                <RatioScaleIcon size={14} /> Gold / silver ratio
              </span>
            }
            value={goldSilverRatio}
            format={(n) => n.toFixed(1)}
            unit=": 1"
            sub="oz of silver per oz of gold"
            spark={ratioLine}
            detail={
              goldSilverRatio != null ? (
                <CardBody
                  kicker="Gold / silver ratio"
                  value={goldSilverRatio.toFixed(2)}
                  unit=": 1"
                  spark={ratioLine}
                  color="#A78BFA"
                  rows={[
                    { k: "Gold / platinum", v: gold && plat ? `${(gold.priceUsd / plat.priceUsd).toFixed(2)} : 1` : "—" },
                    { k: "Gold / palladium", v: gold && pall ? `${(gold.priceUsd / pall.priceUsd).toFixed(2)} : 1` : "—" },
                    { k: "Long-run average", v: "≈ 60 : 1" },
                    { k: "Reading", v: goldSilverRatio > 80 ? "Silver cheap vs gold" : goldSilverRatio < 50 ? "Silver rich vs gold" : "Near normal" },
                  ]}
                  note="Ounces of silver one ounce of gold buys. A high ratio means silver is cheap relative to gold."
                />
              ) : null
            }
          />
          <Kpi
            className="bg-void"
            tone={avgSpread == null ? "#94A3B8" : Math.abs(avgSpread) <= 2 ? "#34D399" : Math.abs(avgSpread) <= 8 ? "#FBBF24" : "#FB7185"}
            label={
              <span className="flex items-center gap-1.5">
                <SpreadGaugeIcon size={14} /> Board vs market
              </span>
            }
            value={avgSpread}
            text={data && avgSpread == null ? "Not set" : undefined}
            format={(n) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`}
            sub={
              data ? (
                avgSpread != null ? (
                  <span className={avgSpread >= 0 ? "text-emerald-300/80" : "text-rose-300/80"}>
                    avg of {boarded.length} karat{boarded.length === 1 ? "" : "s"}
                  </span>
                ) : (
                  <Link href="/gold-rates" className="text-gold-light/80 hover:text-gold-light">
                    Publish a board rate →
                  </Link>
                )
              ) : null
            }
            spark={spreadLine}
            detail={
              data ? (
                <CardBody
                  kicker="Your board vs live market"
                  value={avgSpread != null ? `${avgSpread > 0 ? "+" : ""}${avgSpread.toFixed(2)}%` : "Not set"}
                  spark={spreadLine}
                  color={avgSpread == null ? "#94A3B8" : avgSpread >= 0 ? "#34D399" : "#FB7185"}
                  rows={data.karats.map((k) => {
                    const imp = impliedBoard(k);
                    const d = k.boardDiffPct ?? (imp ? ((imp.rate - k.lkrPerGram) / k.lkrPerGram) * 100 : null);
                    return {
                      k: `${k.karat}${k.boardRate == null ? (imp ? " · implied" : " · not set") : ""}`,
                      v: d == null ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(2)}%`,
                      tone: d == null ? "text-paper/40" : d >= 0 ? "text-emerald-300" : "text-rose-300",
                    };
                  })}
                  note="Positive: your board sells above spot (normal margin). Negative: the board is below market and should be raised."
                />
              ) : null
            }
          />
          <Kpi
            className="bg-void"
            tone="#F472B6"
            label={
              <span className="flex items-center gap-1.5">
                <GoldCoinIcon size={14} /> {k24?.karat ?? "24K"} · tola
              </span>
            }
            value={k24 ? conv(k24.lkrPerGram * UNIT_G.tola) : null}
            unit={display}
            sub={k24 ? <>11.66 g · troy oz <span className="g-metric ml-1 text-paper/70">{money(conv(k24.lkrPerGram * UNIT_G.oz))}</span></> : null}
            spark={k24 ? goldLine(k24.purity, UNIT_G.tola) : undefined}
            detail={
              k24 ? (
                <CardBody
                  kicker={`Tola · 11.6638 g · ${display}`}
                  value={money(conv(k24.lkrPerGram * UNIT_G.tola))}
                  unit={display}
                  spark={goldLine(k24.purity, UNIT_G.tola)}
                  color="#F472B6"
                  rows={(data?.karats ?? []).map((k) => ({ k: `${k.karat} tola`, v: money(conv(k.lkrPerGram * UNIT_G.tola)) }))}
                  note="The tola is the traditional South Asian weight, common in Gulf and Indian gold quotes."
                />
              ) : null
            }
          />
        </div>

        {/* ticker */}
        <div className="relative mt-3 overflow-hidden rounded-b-[20px] border-t border-paper/[0.07] bg-paper/[0.02]">
          {ticker.length ? (
            <div className="home-marquee overflow-hidden py-2">
              <div className="home-marquee-track flex w-max gap-8 pr-8">
                {[...ticker, ...ticker].map((t, i) => (
                  <button
                    key={`${t.key}-${i}`}
                    type="button"
                    onClick={() => setSymbol(t.key)}
                    className="flex items-center gap-2 whitespace-nowrap text-[11px] text-paper/60 transition-colors hover:text-paper"
                  >
                    <MetalCoin symbol={t.key} size={15} />
                    <span className="font-semibold text-paper/80">{t.label}</span>
                    <span className="g-metric text-paper">{money(t.value)}</span>
                    <span className="text-[9.5px] text-paper/35">{t.unit}</span>
                    <ChangeChip pct={t.change} from={t.from} tone="dark" className="px-1.5 py-px text-[10px]" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex gap-6 px-5 py-2">
              {[0, 1, 2, 3].map((i) => (
                <Shimmer key={i} dark className="h-4 w-36" />
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
      <section className="g-surface overflow-hidden">
        <PanelHead
          kicker="Gold by karat"
          title={`Market vs your board · ${display}`}
          right={
            <div className="flex flex-wrap items-center gap-3 text-[10.5px] text-ink-5">
              {data?.karats.length ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.04] px-2 py-0.5 font-semibold text-ink-3">
                  <span className="g-metric text-ink">{boarded.length}</span> of {data.karats.length} published
                </span>
              ) : null}
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-void" /> Published
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full border border-dashed border-ink-4" /> Implied by purity
              </span>
              <span className="hidden xl:inline">Spot × purity · excludes duty, premium and making</span>
            </div>
          }
        />
        {!live.isLoading && !data?.karats.length ? (
          <EmptyBlock title="No gold price" description="Gold spot is unavailable or no purities are active." />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[980px] text-[12.5px]">
              <thead>
                <tr className="bg-bone/60 text-left text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">
                  <th className="py-2.5 pl-5 pr-2 font-semibold">Karat</th>
                  <th className="px-2 text-right font-semibold">Per gram</th>
                  <th className="px-2 text-right font-semibold">Pawn · 8 g</th>
                  <th className="px-2 text-right font-semibold">10 g</th>
                  <th className="px-2 text-right font-semibold">Tola · 11.66 g</th>
                  <th className="px-2 text-right font-semibold">Troy oz</th>
                  <th className="border-l border-ink/[0.06] px-3 text-right font-semibold">Your board / g</th>
                  <th className="w-[220px] px-3 font-semibold">Board vs market</th>
                  {canPublish ? <th className="w-px pr-5" /> : null}
                </tr>
              </thead>
              <tbody>
                {live.isLoading
                  ? [0, 1, 2, 3].map((i) => (
                      <tr key={i} className="border-t border-ink/[0.05]">
                        <td colSpan={canPublish ? 9 : 8} className="px-5 py-3">
                          <Shimmer className="h-9 w-full" />
                        </td>
                      </tr>
                    ))
                  : data!.karats.map((k, i) => {
                      const top = i === 0;
                      const kt = karatTone(k.purity);
                      const implied = impliedBoard(k);
                      const boardV = k.boardRate ?? implied?.rate ?? null;
                      const diff = k.boardDiffPct ?? (implied ? ((implied.rate - k.lkrPerGram) / k.lkrPerGram) * 100 : null);
                      return (
                        <HoverRow
                          key={k.purityId}
                          width={320}
                          content={
                            <CardBody
                              kicker={`${k.karat} gold · ${(k.purity * 1000).toFixed(0)}‰ · ${display}`}
                              value={money(conv(k.lkrPerGram))}
                              unit={`${display}/g`}
                              chip={<ChangeChip pct={k.change24hPct} from={k.changeFrom} tone="dark" className="px-1.5 py-px text-[10px]" />}
                              spark={goldLine(k.purity)}
                              color={kt.hex}
                              rows={[
                                ...goldRows(k),
                                ...(boardV != null
                                  ? [
                                      { k: k.boardRate != null ? "Your board / g" : `Implied board (from ${implied!.from})`, v: money(conv(boardV)) },
                                      { k: "Board − market / g", v: signed(conv(boardV - k.lkrPerGram)), tone: boardV >= k.lkrPerGram ? "text-emerald-300" : "text-rose-300" },
                                      { k: "Board − market / pawn", v: signed(conv((boardV - k.lkrPerGram) * 8)), tone: boardV >= k.lkrPerGram ? "text-emerald-300" : "text-rose-300" },
                                    ]
                                  : [{ k: "Your board", v: "Not set", tone: "text-amber-300" }]),
                              ]}
                              note={
                                k.boardEffectiveFrom
                                  ? `Board published ${new Date(k.boardEffectiveFrom).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}.`
                                  : "Market = spot × purity; excludes duty, premium and making."
                              }
                            />
                          }
                          className={cn(
                            "group border-t border-ink/[0.05] transition-colors duration-150",
                            top ? "bg-gradient-to-r from-gold-pale/70 via-gold-pale/30 to-transparent hover:from-gold-pale" : "hover:bg-bone/70"
                          )}
                        >
                          <td className="relative py-3 pl-5 pr-2">
                            <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full" style={{ background: kt.hex }} aria-hidden />
                            <div className="flex items-center gap-3">
                              <span
                                className={cn(
                                  "relative flex h-9 w-12 items-center justify-center overflow-hidden rounded-xl font-display text-[12.5px] font-extrabold tracking-tight shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_8px_16px_-8px_rgba(16,32,27,0.55)]",
                                  kt.badge
                                )}
                              >
                                <span className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/35 to-transparent" aria-hidden />
                                <span className="relative">{k.karat}</span>
                              </span>
                              <div className="w-[112px] leading-tight">
                                <div className="flex items-baseline justify-between gap-1">
                                  <span className="text-[13px] font-semibold text-ink">{k.karat} gold</span>
                                  <span className="g-metric text-[10px] text-ink-5">{(k.purity * 1000).toFixed(0)}‰</span>
                                </div>
                                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/[0.07]">
                                  <div className={cn("h-full rounded-full", kt.bar)} style={{ width: `${k.purity * 100}%` }} />
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 text-right">
                            <div className="flex flex-col items-end gap-1 leading-none">
                              <LiveNumber value={conv(k.lkrPerGram)} className="text-[16px] font-semibold text-ink" />
                              <ChangeChip pct={k.change24hPct} from={k.changeFrom} className="px-1.5 py-px text-[9.5px]" />
                            </div>
                          </td>
                          <td className="g-metric px-2 text-right font-semibold text-ink-2">{money(conv(k.lkrPerPawn))}</td>
                          <td className="g-metric px-2 text-right text-ink-3">{money(conv(k.lkrPerGram * 10))}</td>
                          <td className="g-metric px-2 text-right text-ink-3">{money(conv(k.lkrPerGram * UNIT_G.tola))}</td>
                          <td className="g-metric px-2 text-right text-ink-3">{money(conv(k.lkrPerGram * UNIT_G.oz))}</td>
                          <td className="border-l border-ink/[0.06] px-3 text-right">
                            {k.boardRate != null ? (
                              <div className="leading-tight">
                                <span className="g-metric text-[13.5px] font-semibold text-ink">{money(conv(k.boardRate))}</span>
                                <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-ink-5" title={k.boardEffectiveFrom ? new Date(k.boardEffectiveFrom).toLocaleString() : undefined}>
                                  <span className="size-1.5 rounded-full bg-void" />
                                  {k.boardEffectiveFrom ? `set ${ago(k.boardEffectiveFrom, now)}` : "published"}
                                </div>
                              </div>
                            ) : implied ? (
                              <div className="leading-tight" title={`Not published — ${implied.from} board rate scaled to ${(k.purity * 1000).toFixed(0)}‰`}>
                                <span className="g-metric text-[13.5px] font-semibold text-ink-4">≈ {money(conv(implied.rate))}</span>
                                <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-ink-5">
                                  <span className="size-1.5 rounded-full border border-dashed border-ink-4" />
                                  implied from {implied.from}
                                </div>
                              </div>
                            ) : (
                              <div className="leading-tight">
                                <span className="inline-flex rounded-full border border-dashed border-gold/50 bg-gold-pale/50 px-2 py-0.5 text-[10.5px] font-semibold text-gold-deep">
                                  Not set
                                </span>
                                <div className="mt-0.5 text-[10px] text-ink-5">market {money(conv(k.lkrPerGram))}</div>
                              </div>
                            )}
                          </td>
                          <td className="px-3">
                            {diff != null && boardV != null ? (
                              <div className={cn("flex items-center gap-2.5", k.boardRate == null && "opacity-60")}>
                                <SpreadMeter pct={diff} className="flex-1" />
                                <span className="w-[84px] text-right leading-tight">
                                  <span className={cn("g-metric block text-[11.5px] font-semibold", spreadTone(diff))}>
                                    {diff > 0 ? "+" : ""}
                                    {diff.toFixed(2)}%
                                  </span>
                                  <span className="g-metric block text-[9.5px] text-ink-5" title="Board minus market, per 8 g pawn">
                                    {boardV - k.lkrPerGram > 0 ? "+" : ""}
                                    {money(conv((boardV - k.lkrPerGram) * 8))}/pawn
                                  </span>
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2.5">
                                <div className="relative h-1 flex-1 rounded-full border border-dashed border-ink/15">
                                  <span className="absolute -top-1 bottom-[-4px] left-1/2 w-px bg-ink/20" aria-hidden />
                                </div>
                                <span className="w-[84px] text-right text-[10.5px] leading-tight text-ink-5">Publish to compare</span>
                              </div>
                            )}
                          </td>
                          {canPublish ? (
                            <td className="py-3 pr-5">
                              <button
                                type="button"
                                onClick={() => setPublish({ karat: k, rate: String(Math.round(k.lkrPerGram)) })}
                                className={cn(
                                  "inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg px-3 text-[11.5px] font-semibold transition-all duration-200 ease-brand",
                                  k.boardRate == null
                                    ? "home-btn-gold !rounded-lg"
                                    : top
                                      ? "bg-void text-gold-light hover:bg-void/90"
                                      : "bg-bone text-ink-2 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.08)] hover:bg-void hover:text-gold-light"
                                )}
                              >
                                {k.boardRate == null ? "Publish" : "Update"}
                                <ArrowRightIcon size={11} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                              </button>
                            </td>
                          ) : null}
                        </HoverRow>
                      );
                    })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ================================================================ INSIGHTS */}
      <div className="grid gap-4 xl:grid-cols-12">
        <RelativePerformance dayBy={dayBy} quotes={data?.quotes ?? []} className="xl:col-span-7" />
        <KaratBars karats={data?.karats ?? []} conv={conv} display={display} implied={(k) => impliedBoard(k as Karat)} className="xl:col-span-5" />
      </div>
      <GoldMoves conv={conv} display={display} purity={k24?.purity ?? 1} />

      {/* ================================================================ PERFORMANCE */}
      <GoldPerformance pureLkrPerGram={gold?.lkrPerGram ?? null} change24hPct={gold?.change24hPct ?? null} conv={conv} display={display} />

      {/* ================================================================ PULSE */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-12">
        {/* 24h movers */}
        <section className="g-surface flex flex-col overflow-hidden xl:col-span-4">
          <PanelHead
            kicker="Market pulse"
            title="24h movers"
            right={
              <span className="flex items-center gap-2 text-[10px] font-semibold">
                <span className="text-emerald-700">▲ {movers.filter((q) => (q.change24hPct ?? 0) > 0).length}</span>
                <span className="text-rose-700">▼ {movers.filter((q) => (q.change24hPct ?? 0) < 0).length}</span>
              </span>
            }
          />
          <div className="flex-1 px-4 py-2">
            {live.isLoading
              ? [0, 1, 2, 3, 4, 5].map((i) => <Shimmer key={i} className="my-2 h-5" />)
              : movers.map((q) => {
                  const p = q.change24hPct;
                  const w = p == null ? 0 : (Math.abs(p) / maxMove) * 50;
                  return (
                    <button
                      key={q.symbol}
                      type="button"
                      onClick={() => setSymbol(q.symbol)}
                      title={`Chart ${q.name}`}
                      className="grid w-full grid-cols-[96px_1fr_58px] items-center gap-2.5 rounded-md py-[5px] text-left transition-colors hover:bg-bone/70"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <MetalCoin symbol={q.symbol} size={16} />
                        <span className="truncate text-[11.5px] font-semibold text-ink-2">{q.name}</span>
                      </span>
                      <span className="relative h-3 rounded-sm bg-ink/[0.035]">
                        <span className="absolute inset-y-[-2px] left-1/2 w-px bg-ink/20" aria-hidden />
                        {p != null && p !== 0 ? (
                          <span
                            className={cn(
                              "absolute inset-y-0.5 rounded-sm transition-[width] duration-700 ease-brand",
                              p > 0 ? "left-1/2 bg-gradient-to-r from-emerald-500/70 to-emerald-500" : "right-1/2 bg-gradient-to-l from-rose-500/70 to-rose-500"
                            )}
                            style={{ width: `${Math.max(1.5, w)}%` }}
                          />
                        ) : null}
                      </span>
                      <span
                        className={cn(
                          "g-metric text-right text-[11px] font-semibold",
                          p == null ? "text-ink-6" : p > 0 ? "text-emerald-700" : p < 0 ? "text-rose-700" : "text-ink-4"
                        )}
                      >
                        {p == null ? <span className="font-sans text-[10px] font-medium text-sky-700">tracking</span> : `${p > 0 ? "+" : ""}${p.toFixed(2)}%`}
                      </span>
                    </button>
                  );
                })}
          </div>
          <div className="border-t border-ink/[0.06] bg-bone/50 px-4 py-1.5 text-[10px] text-ink-5">
            Bars scaled to the largest move ({maxMove.toFixed(2)}%) · tap to chart
          </div>
        </section>

        {/* weight ladder */}
        <section className="g-surface flex flex-col overflow-hidden xl:col-span-5">
          <PanelHead
            kicker="Price ladder"
            title={`${ladderK?.karat ?? "Gold"} by weight · ${display}`}
            right={
              <div className="flex gap-1">
                {(data?.karats ?? []).map((k) => {
                  const on = k.purityId === ladderK?.purityId;
                  const kt = karatTone(k.purity);
                  return (
                    <button
                      key={k.purityId}
                      type="button"
                      onClick={() => setLadderKarat(k.purityId)}
                      className={cn(
                        "h-6 rounded-md px-2 font-display text-[10.5px] font-extrabold transition-all duration-200",
                        on ? cn(kt.badge, "shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]") : "bg-ink/[0.05] text-ink-4 hover:bg-ink/[0.09]"
                      )}
                    >
                      {k.karat}
                    </button>
                  );
                })}
              </div>
            }
          />
          <div className="flex-1 overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[420px] text-[12px]">
              <thead>
                <tr className="bg-bone/60 text-left text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">
                  <th className="py-1.5 pl-4 pr-2 font-semibold">Weight</th>
                  <th className="px-2 text-right font-semibold">Fine gold</th>
                  <th className="px-2 text-right font-semibold">Market</th>
                  <th className="px-2 pr-4 text-right font-semibold">Your board</th>
                </tr>
              </thead>
              <tbody>
                {LADDER.map((l, i) => (
                  <tr key={l.label} className="border-t border-ink/[0.05] transition-colors hover:bg-gold-pale/30">
                    <td className="py-[5px] pl-4 pr-2">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-3 rounded-sm"
                          style={{
                            width: 4 + i * 3,
                            background: ladderK ? karatTone(ladderK.purity).hex : "#CDA853",
                            opacity: 0.35 + i * 0.09,
                          }}
                          aria-hidden
                        />
                        {l.g >= 100 ? (
                          <GoldBarIcon size={14} className="shrink-0" />
                        ) : l.g === 8 || l.g === 40 ? (
                          <SovereignPawnIcon size={14} className="shrink-0" />
                        ) : (
                          <GoldCoinIcon size={13} className="shrink-0" />
                        )}
                        <span className="font-semibold text-ink-2">{l.label}</span>
                        {l.hint ? <span className="text-[10px] text-ink-5">{l.hint}</span> : null}
                      </span>
                    </td>
                    <td className="g-metric px-2 text-right text-ink-4">
                      {ladderK ? `${(l.g * ladderK.purity).toLocaleString("en-US", { maximumFractionDigits: 2 })} g` : "—"}
                    </td>
                    <td className="px-2 text-right">
                      {ladderK ? (
                        <LiveNumber value={conv(l.g * ladderK.lkrPerGram)} className="font-semibold text-ink" />
                      ) : (
                        <Shimmer className="ml-auto h-4 w-20" />
                      )}
                    </td>
                    <td className="g-metric px-2 pr-4 text-right text-ink-3">
                      {ladderK?.boardRate != null ? (
                        money(conv(l.g * ladderK.boardRate))
                      ) : ladderK && impliedBoard(ladderK) ? (
                        <span className="text-ink-5" title={`Implied from the ${impliedBoard(ladderK)!.from} board rate`}>
                          ≈ {money(conv(l.g * impliedBoard(ladderK)!.rate))}
                        </span>
                      ) : (
                        <span className="text-[10.5px] text-ink-5">not set</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* cross-market ratios */}
        <section className="g-surface flex flex-col overflow-hidden lg:col-span-2 xl:col-span-3">
          <PanelHead kicker="Cross-market" title="Ratios & equivalents" />
          <div className="grid flex-1 grid-cols-2 gap-px bg-ink/[0.05] lg:grid-cols-4 xl:grid-cols-1">
            {ratios.map((r) => (
              <div key={r.label} className="relative bg-paper py-[7px] pl-4 pr-3 transition-colors hover:bg-gold-pale/30">
                <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full" style={{ background: r.tone }} aria-hidden />
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0">{r.icon}</span>
                    <span className="truncate text-[11px] font-semibold text-ink-2">{r.label}</span>
                  </div>
                  {r.v != null && Number.isFinite(r.v) ? (
                    <span className="g-metric shrink-0 text-[12.5px] font-semibold text-ink">{r.fmt(r.v)}</span>
                  ) : live.isLoading ? (
                    <Shimmer className="h-3.5 w-14" />
                  ) : (
                    <span className="text-[11px] text-ink-6">—</span>
                  )}
                </div>
                <div className="truncate pl-[24px] text-[9.5px] text-ink-5">{r.hint}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ================================================================ CHART + MARKETS */}
      <div className="grid gap-4 xl:grid-cols-12">
        <section className="g-surface relative flex flex-col xl:col-span-8">
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
          <div className="flex flex-col gap-3 border-b border-ink/[0.06] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <MetalCoin symbol={symbol} size={32} />
              <div className="min-w-0">
                <div className="g-kicker !text-[9.5px]">
                  {history.data?.name ?? quoteFor?.name ?? symbol} · {RANGE_LABEL[range]}
                </div>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {liveChartValue != null ? (
                    <LiveNumber value={liveChartValue} className="text-[20px] leading-none text-ink" />
                  ) : (
                    <Shimmer className="h-5 w-28" />
                  )}
                  <span className="text-[11px] font-semibold text-ink-4">{chartUnit}</span>
                  {stats?.pct != null ? (
                    <ChangeChip
                      pct={Math.round(stats.pct * 100) / 100}
                      className="px-1.5 py-px text-[10px]"
                      suffix={<span className="ml-1 font-sans font-medium opacity-60">{range}</span>}
                    />
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="w-[160px]">
                <Select
                  value={symbol}
                  onChange={setSymbol}
                  ariaLabel="Market"
                  searchable={false}
                  size="sm"
                  icon={<TrendingUpIcon size={12} />}
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
                    { key: "g", label: "g" },
                    { key: "unit", label: quoteFor?.unit === "lb" ? "lb" : "oz" },
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

          <div className="flex-1 px-1 pt-3">
            {history.isLoading ? (
              <Shimmer className="mx-3 h-60" />
            ) : chart.length < 2 ? (
              <div className="relative mx-3 flex h-60 flex-col items-center justify-center overflow-hidden rounded-xl bg-gradient-to-b from-gold-pale to-paper text-center shadow-[inset_0_0_0_1px_rgba(168,138,62,0.15)]">
                <svg className="absolute inset-x-0 bottom-0 h-28 w-full text-gold/25" viewBox="0 0 400 100" preserveAspectRatio="none" aria-hidden>
                  <path d="M0 80 C 60 70, 90 40, 140 52 S 230 20, 280 34 S 360 10, 400 18 L400 100 L0 100Z" fill="currentColor" />
                </svg>
                <div className="relative">
                  <div className="font-display text-sm font-bold text-ink">History is building</div>
                  <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-ink-4">
                    Prices are recorded every hour, and whenever this page is open. The chart fills in as samples accumulate.
                  </p>
                </div>
              </div>
            ) : (
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chart} margin={{ top: 8, right: 10, left: 4, bottom: 0 }}>
                    <defs>
                      <linearGradient id="mkt-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor={tone} stopOpacity={0.38} />
                        <stop offset="0.7" stopColor={tone} stopOpacity={0.06} />
                        <stop offset="1" stopColor={tone} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="mkt-stroke" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0" stopColor={tone} stopOpacity={0.55} />
                        <stop offset="1" stopColor={tone} />
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
                      tick={{ fill: "#5d6e68", fontSize: 10 }}
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      orientation="right"
                      tickLine={false}
                      axisLine={false}
                      width={52}
                      tick={{ fill: "#93a29c", fontSize: 10 }}
                      tickFormatter={(v: number) => Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v)}
                    />
                    {stats ? <ReferenceLine y={stats.open} stroke="rgba(16,32,27,0.25)" strokeDasharray="2 4" /> : null}
                    {stats ? <ReferenceLine y={stats.high} stroke="rgba(5,150,105,0.35)" strokeDasharray="1 5" /> : null}
                    {stats ? <ReferenceLine y={stats.low} stroke="rgba(225,29,72,0.35)" strokeDasharray="1 5" /> : null}
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
                      strokeWidth={2}
                      fill="url(#mkt-fill)"
                      isAnimationActive={false}
                      activeDot={{ r: 4.5, fill: tone, stroke: "#fff", strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* where the last price sits between the period's low and high */}
          {stats ? (
            <div className="mx-4 mt-2 flex items-center gap-2.5 text-[10px]">
              <span className="g-metric text-rose-700">{money(stats.low)}</span>
              <div className="relative h-1.5 flex-1 rounded-full bg-gradient-to-r from-rose-500/25 via-ink/[0.06] to-emerald-500/25">
                <span
                  className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-paper transition-[left] duration-700 ease-brand"
                  style={{ left: `${stats.pos * 100}%`, background: tone }}
                />
              </div>
              <span className="g-metric text-emerald-700">{money(stats.high)}</span>
              <span className="w-[86px] text-right font-semibold text-ink-4">{Math.round(stats.pos * 100)}% of range</span>
            </div>
          ) : null}
          <div className="mt-2 grid grid-cols-4 gap-px border-t border-ink/[0.06] bg-ink/[0.06] sm:grid-cols-8">
            {[
              { label: "Open", v: stats?.open },
              { label: "High", v: stats?.high, cls: "text-emerald-700" },
              { label: "Low", v: stats?.low, cls: "text-rose-700" },
              { label: "Last", v: stats?.close },
              { label: "Average", v: stats?.avg },
              { label: "Range", v: stats ? stats.high - stats.low : undefined },
              { label: "Change", v: stats ? stats.close - stats.open : undefined, signed: true },
            ].map((s) => (
              <div key={s.label} className="bg-paper px-3 py-2">
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{s.label}</div>
                <div
                  className={cn(
                    "g-metric mt-0.5 truncate text-[12.5px]",
                    s.signed && s.v != null ? (s.v > 0 ? "text-emerald-700" : s.v < 0 ? "text-rose-700" : "text-ink") : (s.cls ?? "text-ink")
                  )}
                >
                  {s.v != null ? `${s.signed && s.v > 0 ? "+" : ""}${money(s.v)}` : "—"}
                </div>
              </div>
            ))}
            <div className="bg-paper px-3 py-2" title="Standard deviation of step-to-step moves over the period">
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">Volatility</div>
              <div className={cn("g-metric mt-0.5 text-[12.5px]", stats == null ? "text-ink" : stats.vol < 0.3 ? "text-emerald-700" : stats.vol < 1 ? "text-amber-700" : "text-rose-700")}>
                {stats ? `${stats.vol.toFixed(2)}%` : "—"}
              </div>
            </div>
          </div>
          {display !== "LKR" && stats ? (
            <div className="rounded-b-2xl border-t border-ink/[0.06] bg-bone/60 px-4 py-2 text-[10.5px] text-ink-4">
              Converted to {display} at today&apos;s rate; LKR history uses each day&apos;s own exchange rate.
            </div>
          ) : null}
        </section>

        <section className="g-surface flex flex-col overflow-hidden xl:col-span-4">
          <PanelHead
            kicker="Metals & markets"
            title={`Spot in ${display}`}
            right={<span className="text-[10.5px] text-ink-5">Tap to chart</span>}
          />
          <div className="flex-1 p-1.5">
            {live.isLoading
              ? [0, 1, 2, 3, 4, 5, 6].map((i) => <Shimmer key={i} className="m-1.5 h-10" />)
              : (data?.quotes ?? []).map((q) => {
                  const on = q.symbol === symbol;
                  const line = (dayBy[q.symbol] ?? []).map((p) => conv(p.lkrPerGram ?? p.priceLkr));
                  const usdLine = (dayBy[q.symbol] ?? []).map((p) => p.priceUsd);
                  const us = seriesStats(usdLine);
                  return (
                    <HoverCard
                      key={q.symbol}
                      width={300}
                      content={
                        <CardBody
                          kicker={`${q.name} · ${q.symbol} · ${q.kind === "crypto" ? "crypto" : "metal"}`}
                          value={money(conv(q.lkrPerGram ?? q.priceLkr))}
                          unit={`${display}/${q.lkrPerGram != null ? "g" : unitWord(q.unit)}`}
                          chip={<ChangeChip pct={q.change24hPct} from={q.changeFrom} tone="dark" className="px-1.5 py-px text-[10px]" />}
                          spark={line}
                          color={symbolTone(q.symbol)}
                          rows={[
                            { k: `USD / ${unitWord(q.unit)}`, v: `$${usd(q.priceUsd)}` },
                            { k: `${display} / ${unitWord(q.unit)}`, v: money(conv(q.priceLkr)) },
                            ...(q.lkrPerGram != null
                              ? [
                                  { k: `${display} / 10 g`, v: money(conv(q.lkrPerGram * 10)) },
                                  { k: `${display} / kilo`, v: money(conv(q.lkrPerGram * 1000)) },
                                ]
                              : []),
                            ...(us ? [{ k: "Day range (USD)", v: `${usd(us.lo)} – ${usd(us.hi)}` }] : []),
                            ...(gold && q.symbol !== "XAU" ? [{ k: "Gold equivalent", v: `${(q.priceUsd / gold.priceUsd).toFixed(4)} oz` }] : []),
                            { k: "Updated", v: ago(q.updatedAt, now) },
                          ]}
                          note={q.stale ? "Feed delayed — last stored price." : "Click to open in the main chart."}
                        />
                      }
                    >
                    <button
                      type="button"
                      onClick={() => setSymbol(q.symbol)}
                      className={cn(
                        "relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all duration-200 ease-brand",
                        on ? "bg-gold-pale shadow-[inset_0_0_0_1px_rgba(168,138,62,0.22)]" : "hover:bg-bone"
                      )}
                    >
                      <span
                        className={cn("absolute inset-y-2.5 left-0 w-[3px] rounded-full transition-opacity", on ? "opacity-100" : "opacity-30")}
                        style={{ background: symbolTone(q.symbol) }}
                      />
                      <MetalCoin symbol={q.symbol} size={28} />
                      <div className="min-w-0 flex-1 leading-tight">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[12.5px] font-semibold text-ink">{q.name}</span>
                          {q.stale ? (
                            <span className="rounded-full bg-amber-600/15 px-1.5 text-[9px] font-semibold text-amber-700">Delayed</span>
                          ) : null}
                        </div>
                        <div className="g-metric truncate text-[10.5px] text-ink-5">
                          {q.symbol} · ${usd(q.priceUsd)}/{unitWord(q.unit)}
                        </div>
                      </div>
                      <Sparkline values={line} color={symbolTone(q.symbol)} className="hidden h-7 w-16 shrink-0 sm:block [&>span]:hidden" />
                      <div className="text-right leading-tight">
                        <div className="flex items-baseline justify-end gap-1">
                          <LiveNumber value={conv(q.lkrPerGram ?? q.priceLkr)} className="text-[13px] font-semibold text-ink" />
                          <span className="text-[9.5px] font-semibold text-ink-5">/{q.lkrPerGram != null ? "g" : unitWord(q.unit)}</span>
                        </div>
                        <ChangeChip pct={q.change24hPct} from={q.changeFrom} className="mt-0.5 px-1.5 py-px text-[10px]" />
                      </div>
                    </button>
                    </HoverCard>
                  );
                })}
          </div>
        </section>
      </div>

      {/* ================================================================ BOARD + VAULT */}
      <div className="grid gap-4 xl:grid-cols-12">
        <BoardHistory karats={data?.karats ?? []} conv={conv} display={display} className={canSeeStock ? "xl:col-span-7" : "xl:col-span-12"} />
        {canSeeStock ? (
          <VaultValue
            pureLkrPerGram={gold?.lkrPerGram ?? null}
            change24hPct={gold?.change24hPct ?? null}
            conv={conv}
            display={display}
            className="xl:col-span-5"
          />
        ) : null}
      </div>

      {/* ================================================================ COUNTER DESK */}
      <div className="grid gap-4 xl:grid-cols-12">
        <BuyBackDesk karats={data?.karats ?? []} conv={conv} display={display} className="xl:col-span-7" />
        <RetailQuote karats={data?.karats ?? []} conv={conv} display={display} className="xl:col-span-5" />
      </div>

      {/* ================================================================ CALCULATOR + FX */}
      <div className="grid gap-4 xl:grid-cols-12">
        <section className="g-surface flex flex-col overflow-hidden xl:col-span-4">
          <PanelHead kicker="Calculator" title="Value a piece of gold" />
          <div className="flex flex-1 flex-col gap-3 p-4">
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={calcW}
                  onChange={(e) => setCalcW(e.target.value)}
                  aria-label="Weight"
                  className={inputCls}
                />
              </div>
              <div className="w-[128px] shrink-0">
                <Select
                  value={calcK?.purityId ?? ""}
                  onChange={setCalcKarat}
                  ariaLabel="Karat"
                  size="sm"
                  searchable={false}
                  loading={live.isLoading}
                  options={(data?.karats ?? []).map((k) => ({ value: k.purityId, label: k.karat, hint: `${(k.purity * 1000).toFixed(0)}` }))}
                />
              </div>
            </div>
            <Segmented
              ariaLabel="Weight unit"
              value={calcUnit}
              onChange={setCalcUnit}
              items={(Object.keys(UNIT_G) as WeightUnit[]).map((u) => ({ key: u, label: UNIT_LABEL[u] }))}
            />
            <div className="mt-auto rounded-xl bg-void p-3.5 text-paper shadow-[inset_0_0_0_1px_rgba(226,194,122,0.18)]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-gold-light/80">
                  <GoldBarIcon size={13} />
                  Market value
                </span>
                <span className="g-metric text-[10.5px] text-paper/40">
                  {grams.toLocaleString("en-US", { maximumFractionDigits: 3 })} g · {calcK?.karat ?? "—"}
                </span>
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                {calcMarket != null ? (
                  <LiveNumber value={calcMarket} tone="dark" className="text-[24px] leading-none text-paper" />
                ) : (
                  <Shimmer dark className="h-6 w-32" />
                )}
                <span className="text-[11px] font-semibold text-gold-light">{display}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-paper/[0.08] text-[10.5px]">
                <div className="bg-void px-2.5 py-2">
                  <div className="text-paper/40">{calcImplied ? `At board · implied from ${calcImplied.from}` : "At your board"}</div>
                  <div className="g-metric mt-0.5 text-[12.5px] text-paper">
                    {calcBoard != null ? `${calcImplied ? "≈ " : ""}${money(calcBoard)}` : <span className="font-sans text-paper/50">No board yet</span>}
                  </div>
                </div>
                <div className="bg-void px-2.5 py-2">
                  <div className="text-paper/40">Fine gold content</div>
                  <div className="g-metric mt-0.5 text-[12.5px] text-paper">
                    {calcK ? `${(grams * calcK.purity).toLocaleString("en-US", { maximumFractionDigits: 3 })} g` : "—"}
                  </div>
                </div>
              </div>
            </div>
            <div>
              <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-5">Same weight, every karat</div>
              <div className="space-y-1">
                {(data?.karats ?? []).map((k) => {
                  const kt = karatTone(k.purity);
                  const v = conv(grams * k.lkrPerGram);
                  const max = conv(grams * (k24?.lkrPerGram ?? k.lkrPerGram)) || 1;
                  const on = k.purityId === calcK?.purityId;
                  return (
                    <button
                      key={k.purityId}
                      type="button"
                      onClick={() => setCalcKarat(k.purityId)}
                      className={cn("grid w-full grid-cols-[34px_1fr_auto] items-center gap-2 rounded-md px-1 py-0.5 text-left", on ? "bg-gold-pale/60" : "hover:bg-bone")}
                    >
                      <span className={cn("rounded px-1 text-center font-display text-[10px] font-extrabold", kt.badge)}>{k.karat}</span>
                      <span className="h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                        <span className={cn("block h-full rounded-full", kt.bar)} style={{ width: `${Math.min(100, (v / max) * 100)}%` }} />
                      </span>
                      <span className="g-metric text-[11.5px] font-semibold text-ink">{money(v)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="g-surface flex flex-col overflow-hidden xl:col-span-8">
          <PanelHead
            kicker="Exchange"
            title={`Currency rates · 1 unit in ${display}`}
            right={
              <div className="flex flex-wrap items-center gap-1">
                {REGIONS.map((r) => {
                  const on = fxRegion === r.key;
                  return (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => setFxRegion(on ? null : r.key)}
                      className={cn(
                        "inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[10.5px] font-semibold transition-all duration-200",
                        on ? "text-paper" : "bg-ink/[0.04] text-ink-3 hover:bg-ink/[0.08]"
                      )}
                      style={on ? { background: r.hex } : undefined}
                    >
                      <span className="size-1.5 rounded-full" style={{ background: on ? "#fff" : r.hex }} />
                      {r.label}
                    </button>
                  );
                })}
              </div>
            }
          />
          {/* converter */}
          <div className="flex flex-wrap items-center gap-2 border-b border-ink/[0.06] bg-bone/50 px-4 py-2.5">
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-5">Convert</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={convAmount}
              onChange={(e) => setConvAmount(e.target.value)}
              aria-label="Amount"
              className={cn(inputCls, "w-28 flex-none")}
            />
            <div className="w-[112px]">
              <Select
                value={convFrom}
                onChange={setConvFrom}
                options={currencyOptions}
                ariaLabel="Convert from"
                size="sm"
                searchable
                icon={<CountryFlag code={convFrom} size={14} />}
              />
            </div>
            <ArrowRightIcon size={13} className="text-ink-5" />
            <span className="flex items-baseline gap-1.5">
              {converted != null && Number.isFinite(converted) ? (
                <LiveNumber value={converted} className="text-[18px] font-semibold leading-none text-ink" />
              ) : (
                <Shimmer className="h-5 w-24" />
              )}
              <span className="text-[11px] font-semibold text-gold-dark">{display}</span>
            </span>
            <span className="ml-auto text-[10px] text-ink-5">{data ? `FX ${ago(data.fxUpdatedAt, now)} · tap a rate to switch` : ""}</span>
          </div>
          <div className="max-h-[296px] flex-1 overflow-y-auto scrollbar-thin">
            <div className="grid grid-cols-1 gap-px bg-ink/[0.05] sm:grid-cols-2 lg:grid-cols-3">
              {live.isLoading
                ? Array.from({ length: 9 }, (_, i) => (
                    <div key={i} className="bg-paper p-2.5">
                      <Shimmer className="h-7" />
                    </div>
                  ))
                : shownFx.map((f) => {
                    const inCcy = (lkr: number) => (data ? (lkr / data.usdLkr) * f.perUsd : NaN);
                    const region = REGIONS.find((r) => (r.codes as readonly string[]).includes(f.code));
                    return (
                    <HoverCard
                      key={f.code}
                      width={290}
                      className="flex"
                      content={
                        <CardBody
                          kicker={`${currencyName(f.code)} · ${f.code}${region ? ` · ${region.label}` : ""}`}
                          value={money(f.value)}
                          unit={`${display} per 1 ${f.code}`}
                          rows={[
                            { k: `1 ${display} in ${f.code}`, v: f.value > 0 ? money(1 / f.value) : "—" },
                            { k: `100 ${f.code}`, v: `${money(f.value * 100)} ${display}` },
                            { k: `1,000 ${f.code}`, v: `${money(f.value * 1000)} ${display}` },
                            { k: "Per USD", v: f.perUsd.toLocaleString("en-US", { maximumFractionDigits: 4 }) },
                            ...(k24 ? [{ k: `24K / g in ${f.code}`, v: money(inCcy(k24.lkrPerGram)) }] : []),
                            ...(k22 ? [{ k: `22K pawn in ${f.code}`, v: money(inCcy(k22.lkrPerPawn)) }] : []),
                            ...(k22 ? [{ k: `22K tola in ${f.code}`, v: money(inCcy(k22.lkrPerGram * UNIT_G.tola)) }] : []),
                          ]}
                          note={`Click to show every price on this page in ${f.code}.`}
                        />
                      }
                    >
                    <button
                      type="button"
                      onClick={() => setCcy(f.code)}
                      className="group flex w-full items-center gap-2.5 bg-paper px-3 py-2 text-left transition-colors duration-150 hover:bg-gold-pale/40"
                    >
                      <CurrencyBadge code={f.code} />
                      <div className="min-w-0 flex-1 leading-tight">
                        <div className="truncate text-[11.5px] font-medium text-ink-2">{currencyName(f.code)}</div>
                        <div className="g-metric truncate text-[10px] text-ink-5">
                          {f.perUsd.toLocaleString("en-US", { maximumFractionDigits: 4 })} / USD
                        </div>
                      </div>
                      <span className="g-metric text-[12.5px] font-semibold text-ink">{money(f.value)}</span>
                    </button>
                    </HoverCard>
                    );
                  })}
              {/* pad the last grid row so the hairlines stay even */}
              {!live.isLoading && shownFx.length % 3
                ? Array.from({ length: 3 - (shownFx.length % 3) }, (_, i) => <div key={`pad-${i}`} className="hidden bg-paper lg:block" />)
                : null}
            </div>
          </div>
        </section>
      </div>

      {/* ================================================================ SOURCES */}
      {data ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[10.5px] text-ink-5">
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
