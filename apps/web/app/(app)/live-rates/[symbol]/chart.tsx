"use client";

// Price chart for one market: area or candles, USD or LKR in any weight unit,
// optional moving averages and log scale, volume underneath and a range
// navigator — the market-page chart, drawn with the board's tokens.
import { useMemo, useState } from "react";
import { Area, Bar, Brush, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/cn";
import { money } from "../parts";

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number; lkr: number };
export type ChartRange = "1d" | "7d" | "1m" | "3m" | "1y" | "5y" | "max";
export type Measure = { key: string; label: string; ccy: "USD" | "LKR"; /** Multiplier on a USD-per-quoted-unit price. */ factor: (c: Candle) => number };

const UP = "#10B981";
const DOWN = "#F43F5E";

function tick(t: number, range: ChartRange) {
  const d = new Date(t);
  if (range === "1d") return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (range === "7d" || range === "1m") return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (range === "3m" || range === "1y") return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n));

function smaSeries(xs: number[], n: number) {
  let sum = 0;
  return xs.map((x, i) => {
    sum += x;
    if (i >= n) sum -= xs[i - n]!;
    return i >= n - 1 ? sum / n : null;
  });
}

type Row = { t: number; o: number; h: number; l: number; c: number; v: number; band: [number, number]; sma20: number | null; sma50: number | null };

/** Wick and body for one candle; recharts hands us the [low, high] box. */
function CandleShape(props: { x?: number; y?: number; width?: number; height?: number; payload?: Row }) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  if (!payload) return null;
  const { o, c, h, l } = payload;
  const span = h - l || 1;
  const yOf = (v: number) => y + ((h - v) / span) * height;
  const up = c >= o;
  const color = up ? UP : DOWN;
  const bw = Math.max(1, Math.min(10, width * 0.7));
  const cx = x + width / 2;
  const top = yOf(Math.max(o, c));
  const bot = yOf(Math.min(o, c));
  return (
    <g>
      <line x1={cx} x2={cx} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={cx - bw / 2} y={top} width={bw} height={Math.max(1, bot - top)} fill={color} fillOpacity={up ? 0.85 : 1} rx={0.5} />
    </g>
  );
}

export function AssetChart({
  candles,
  range,
  measure,
  kind,
  log,
  overlays,
  tone,
  loading,
}: {
  candles: Candle[];
  range: ChartRange;
  measure: Measure;
  kind: "area" | "candle";
  log: boolean;
  overlays: boolean;
  tone: string;
  loading?: boolean;
}) {
  const [hover, setHover] = useState<Row | null>(null);
  const rows: Row[] = useMemo(() => {
    const base = candles.map((c) => {
      const f = measure.factor(c);
      return { t: c.t, o: c.o * f, h: c.h * f, l: c.l * f, c: c.c * f, v: c.v };
    });
    const s20 = smaSeries(base.map((r) => r.c), 20);
    const s50 = smaSeries(base.map((r) => r.c), 50);
    return base.map((r, i) => ({ ...r, band: [r.l, r.h] as [number, number], sma20: s20[i] ?? null, sma50: s50[i] ?? null }));
  }, [candles, measure]);

  if (loading && !rows.length) return <div className="h-[380px] animate-pulse rounded-xl bg-ink/[0.04]" />;
  if (rows.length < 2)
    return (
      <div className="flex h-[380px] items-center justify-center rounded-xl border border-dashed border-ink/15 text-[12px] text-ink-4">
        No chart data for this range yet.
      </div>
    );

  const first = rows[0]!.c;
  const last = rows[rows.length - 1]!.c;
  const up = last >= first;
  const line = up ? UP : DOWN;
  const lo = Math.min(...rows.map((r) => r.l));
  const hi = Math.max(...rows.map((r) => r.h));
  const pad = (hi - lo) * 0.08 || hi * 0.01;
  const vmax = Math.max(...rows.map((r) => r.v));
  const shown = hover ?? rows[rows.length - 1]!;
  const showChg = ((shown.c - first) / first) * 100;
  const gid = `ag-${tone.replace("#", "")}-${up ? "u" : "d"}`;

  return (
    <div className="relative">
      {/* OHLC readout for the hovered (or latest) bar */}
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 px-1 text-[11px] text-ink-4">
        <span className="font-medium text-ink-3">
          {new Date(shown.t).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: range === "5y" || range === "max" ? "numeric" : undefined,
            hour: range === "1d" || range === "7d" || range === "1m" ? "numeric" : undefined,
            minute: range === "1d" || range === "7d" || range === "1m" ? "2-digit" : undefined,
          })}
        </span>
        {[
          ["O", shown.o],
          ["H", shown.h],
          ["L", shown.l],
          ["C", shown.c],
        ].map(([k, v]) => (
          <span key={k as string}>
            {k} <span className="g-metric text-ink-2">{money(v as number)}</span>
          </span>
        ))}
        <span className={cn("g-metric font-semibold", showChg >= 0 ? "text-emerald-700" : "text-rose-700")}>
          {showChg >= 0 ? "+" : ""}
          {showChg.toFixed(2)}%
        </span>
        {shown.v ? (
          <span>
            Vol <span className="g-metric text-ink-2">{compact(shown.v)}</span>
          </span>
        ) : null}
        {overlays ? (
          <span className="ml-auto flex items-center gap-2">
            <span className="flex items-center gap-1">
              <i className="h-0.5 w-3 rounded bg-sky-500" /> SMA 20
            </span>
            <span className="flex items-center gap-1">
              <i className="h-0.5 w-3 rounded bg-violet-500" /> SMA 50
            </span>
          </span>
        ) : null}
      </div>

      <div className="relative h-[380px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
            onMouseMove={(s) => {
              const i = typeof s?.activeTooltipIndex === "number" ? s.activeTooltipIndex : Number(s?.activeTooltipIndex);
              setHover(Number.isFinite(i) ? (rows[i] ?? null) : null);
            }}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={line} stopOpacity={0.32} />
                <stop offset="0.75" stopColor={line} stopOpacity={0.04} />
                <stop offset="1" stopColor={line} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgba(16,32,27,0.06)" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t) => tick(t, range)}
              tick={{ fontSize: 10.5, fill: "#7B867F" }}
              axisLine={false}
              tickLine={false}
              minTickGap={48}
            />
            <YAxis
              yAxisId="p"
              orientation="right"
              scale={log ? "log" : "auto"}
              domain={log ? ["auto", "auto"] : [lo - pad, hi + pad]}
              allowDataOverflow
              tickFormatter={(v: number) => money(v)}
              tick={{ fontSize: 10.5, fill: "#7B867F" }}
              axisLine={false}
              tickLine={false}
              width={72}
            />
            <YAxis yAxisId="v" hide domain={[0, vmax * 4.5 || 1]} />
            {vmax > 0 ? <Bar yAxisId="v" dataKey="v" fill="rgba(16,32,27,0.12)" isAnimationActive={false} maxBarSize={8} /> : null}
            <ReferenceLine
              yAxisId="p"
              y={first}
              stroke="#7B867F"
              strokeDasharray="2 3"
              label={{ value: money(first), position: "insideBottomLeft", fontSize: 10, fill: "#7B867F" }}
            />
            {kind === "area" ? (
              <Area
                yAxisId="p"
                type="monotone"
                dataKey="c"
                stroke={line}
                strokeWidth={1.8}
                fill={`url(#${gid})`}
                isAnimationActive={false}
                dot={false}
                activeDot={{ r: 4, fill: line, stroke: "#fff", strokeWidth: 2 }}
              />
            ) : (
              <Bar yAxisId="p" dataKey="band" shape={CandleShape} isAnimationActive={false} />
            )}
            {overlays ? (
              <>
                <Line yAxisId="p" dataKey="sma20" stroke="#0EA5E9" strokeWidth={1.2} dot={false} isAnimationActive={false} connectNulls />
                <Line yAxisId="p" dataKey="sma50" stroke="#8B5CF6" strokeWidth={1.2} dot={false} isAnimationActive={false} connectNulls />
              </>
            ) : null}
            <ReferenceLine
              yAxisId="p"
              y={last}
              stroke={line}
              strokeOpacity={0.5}
              strokeDasharray="1 3"
            />
            <Tooltip cursor={{ stroke: "rgba(16,32,27,0.25)", strokeDasharray: "3 3" }} content={() => null} />
            {rows.length > 40 ? (
              <Brush dataKey="t" height={30} stroke={tone} fill="rgba(16,32,27,0.03)" travellerWidth={8} tickFormatter={(t) => tick(t, range)}>
                <ComposedChart data={rows}>
                  <Area dataKey="c" stroke={tone} fill={tone} fillOpacity={0.12} isAnimationActive={false} dot={false} />
                </ComposedChart>
              </Brush>
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
        {/* current price tag, the way market sites pin it to the axis */}
        <span
          className="g-metric pointer-events-none absolute right-0 top-2 rounded px-1.5 py-0.5 text-[10.5px] font-semibold text-white shadow"
          style={{ background: line }}
        >
          {measure.ccy} {money(last)}
        </span>
      </div>
    </div>
  );
}
