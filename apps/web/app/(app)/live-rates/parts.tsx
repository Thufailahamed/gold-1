"use client";

// Visual building blocks for the Live Rates board. Everything here draws from
// the Emerald Vault tokens (void / gold / ink / paper / bone) and the shared
// surfaces in globals.css, so the board reads as part of the console.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { RefreshCwIcon } from "@/components/icons";

/* ---------------------------------------------------------------- formatting */

/** Adaptive precision: big amounts whole, everyday amounts 2dp, tiny ones 4dp. */
export function money(n: number) {
  if (!Number.isFinite(n)) return "—";
  const dp = Math.abs(n) >= 10_000 ? 0 : Math.abs(n) >= 1 ? 2 : 4;
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export const usd = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 });

let currencyNames: Intl.DisplayNames | null = null;
export function currencyName(code: string) {
  try {
    currencyNames ??= new Intl.DisplayNames(["en"], { type: "currency" });
    return currencyNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export function ago(ms: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

/* ---------------------------------------------------------------- colour */

/** Line / accent colour per market, matching its coin. */
export const SYMBOL_TONE: Record<string, string> = {
  XAU: "#CDA853",
  XAG: "#8C98A6",
  XPT: "#5D7E9A",
  XPD: "#9A8478",
  HG: "#C26A2F",
  BTC: "#F7931A",
  ETH: "#6D7AE0",
};
export const symbolTone = (s: string) => SYMBOL_TONE[s] ?? "#A88A3E";

/** Purer karats read richer: 24K full gold, then amber, copper, rose. */
export function karatTone(purity: number) {
  if (purity >= 0.995) return { hex: "#CDA853", badge: "bg-gradient-to-br from-gold-light via-gold to-gold-deep text-void", bar: "bg-gradient-to-r from-gold-dark to-gold-light" };
  if (purity >= 0.9) return { hex: "#D97706", badge: "bg-gradient-to-br from-amber-300 to-amber-600 text-amber-950", bar: "bg-gradient-to-r from-amber-600 to-amber-300" };
  if (purity >= 0.85) return { hex: "#EA7A3B", badge: "bg-gradient-to-br from-orange-300 to-orange-600 text-orange-950", bar: "bg-gradient-to-r from-orange-600 to-orange-300" };
  if (purity >= 0.7) return { hex: "#E0607E", badge: "bg-gradient-to-br from-rose-300 to-rose-600 text-rose-950", bar: "bg-gradient-to-r from-rose-600 to-rose-300" };
  return { hex: "#94A3B8", badge: "bg-gradient-to-br from-slate-200 to-slate-500 text-slate-900", bar: "bg-gradient-to-r from-slate-500 to-slate-300" };
}

/** Currency regions, so the FX board groups by colour at a glance. */
export const REGIONS = [
  { key: "gulf", label: "Gulf", hex: "#059669", codes: ["AED", "SAR", "QAR", "KWD", "OMR", "BHD", "JOD"] },
  { key: "south", label: "South Asia", hex: "#D97706", codes: ["LKR", "INR", "PKR", "BDT", "NPR", "MVR"] },
  { key: "asia", label: "East Asia & Pacific", hex: "#7C3AED", codes: ["JPY", "CNY", "SGD", "HKD", "MYR", "THB", "KRW", "AUD", "NZD", "IDR", "PHP"] },
  { key: "europe", label: "Europe", hex: "#0284C7", codes: ["EUR", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "TRY", "RUB"] },
  { key: "americas", label: "Americas", hex: "#4F46E5", codes: ["USD", "CAD", "MXN", "BRL"] },
] as const;
export const ccyTone = (code: string) => REGIONS.find((r) => (r.codes as readonly string[]).includes(code))?.hex ?? "#64748B";

/* ---------------------------------------------------------------- hooks */

/** Re-renders every `ms` so relative times and the refresh ring keep moving. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * Glides from the previous value to the new one (not from zero, unlike
 * useCountUp) and reports which way it moved, so a ticking price can flash.
 */
function useTween(target: number, ms = 650) {
  const [v, setV] = useState(target);
  const [dir, setDir] = useState<-1 | 0 | 1>(0);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target) return;
    setDir(target > start ? 1 : -1);
    const clear = setTimeout(() => setDir(0), 1400);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(target);
      from.current = target;
      return () => clearTimeout(clear);
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const next = start + (target - start) * (1 - Math.pow(1 - p, 3));
      setV(next);
      from.current = next;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(clear);
    };
  }, [target, ms]);
  return { v, dir };
}

/** A number that glides to new values and briefly flashes green/red on a tick. */
export function LiveNumber({
  value,
  format = money,
  className,
  tone = "light",
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  tone?: "light" | "dark";
}) {
  const { v, dir } = useTween(value);
  return (
    <span
      className={cn(
        "g-metric transition-colors duration-700 ease-brand",
        dir === 1 && (tone === "dark" ? "text-emerald-300" : "text-emerald-700"),
        dir === -1 && (tone === "dark" ? "text-rose-300" : "text-rose-700"),
        className
      )}
    >
      {format(v)}
    </span>
  );
}

/* ---------------------------------------------------------------- chips & glyphs */

/**
 * Short label for how far back a change is measured: nothing for a full day,
 * otherwise "3h" / "40m" so a young feed's figure is read honestly.
 */
export function changeWindow(from: number | null | undefined, now = Date.now()) {
  if (from == null) return null;
  const m = Math.max(1, Math.round((now - from) / 60_000));
  if (m >= 20 * 60) return null;
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

export function ChangeChip({
  pct,
  tone = "light",
  className,
  suffix,
  from,
}: {
  pct: number | null | undefined;
  tone?: "light" | "dark";
  className?: string;
  suffix?: ReactNode;
  /** Baseline timestamp; under ~a day the window is shown next to the figure. */
  from?: number | null;
}) {
  if (pct == null)
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
          tone === "dark" ? "bg-sky-400/10 text-sky-200/80 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.18)]" : "bg-sky-600/[0.08] text-sky-800",
          className
        )}
        title="The first price sample is in; the change appears once a second sample is recorded"
      >
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-400 opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-sky-400" />
        </span>
        Tracking
      </span>
    );
  const win = changeWindow(from);
  const up = pct > 0;
  const flat = pct === 0;
  const cls =
    tone === "dark"
      ? flat
        ? "bg-paper/[0.08] text-paper/60"
        : up
          ? "bg-emerald-400/15 text-emerald-300 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.25)]"
          : "bg-rose-400/15 text-rose-300 shadow-[inset_0_0_0_1px_rgba(251,113,133,0.25)]"
      : flat
        ? "bg-ink/[0.05] text-ink-4"
        : up
          ? "bg-emerald-700/10 text-emerald-700"
          : "bg-rose-700/10 text-rose-700";
  return (
    <span
      className={cn("g-metric inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", cls, className)}
      title={win ? `Change over the last ${win} — the feed has less than a day of history` : "Change over 24 hours"}
    >
      {flat ? null : (
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden className={cn(!up && "rotate-180")}>
          <path d="M4 1 7.5 6.5h-7z" fill="currentColor" />
        </svg>
      )}
      {Math.abs(pct).toFixed(2)}%{suffix}
      {win && !suffix ? <span className="ml-0.5 font-sans font-medium opacity-60">{win}</span> : null}
    </span>
  );
}

import { MarketIcon, CountryFlag } from "@/components/market-icons";

/** Minted-coin glyph for a market: renders official crypto logos (BTC, ETH) and minted metal coins. */
export function MetalCoin({ symbol, size = 36 }: { symbol: string; size?: number }) {
  return <MarketIcon symbol={symbol} size={size} />;
}

/** Code badge for a currency row with national flag. */
export function CurrencyBadge({ code, active }: { code: string; active?: boolean }) {
  const hex = ccyTone(code);
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <CountryFlag code={code} size={20} className="shadow-sm" />
      <span
        style={active ? undefined : { boxShadow: `inset 3px 0 0 ${hex}, inset 0 0 0 1px ${hex}33`, backgroundColor: `${hex}12`, color: hex }}
        className={cn(
          "g-metric flex h-7 min-w-[42px] px-1 shrink-0 items-center justify-center rounded-md text-[10.5px] font-bold tracking-wide transition-colors duration-200",
          active
            ? "bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(226,194,122,0.35)]"
            : "group-hover:brightness-90"
        )}
      >
        {code}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- controls */

/** Countdown ring to the next auto-refresh; click to refresh now. */
export function RefreshRing({
  progress,
  spinning,
  onClick,
  secondsLeft,
}: {
  progress: number;
  spinning: boolean;
  onClick: () => void;
  secondsLeft: number;
}) {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={spinning}
      title={spinning ? "Refreshing…" : `Auto-refresh in ${secondsLeft}s — click to refresh now`}
      aria-label="Refresh prices"
      className="group relative flex size-9 shrink-0 items-center justify-center rounded-full bg-paper/[0.05] text-paper/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] transition-all duration-200 ease-brand hover:bg-paper/[0.1] hover:text-gold-light disabled:cursor-wait"
    >
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 40 40" aria-hidden>
        <circle cx="20" cy="20" r={r} fill="none" stroke="rgba(226,194,122,0.14)" strokeWidth="2" />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke="url(#ring-gold)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, Math.max(0, progress)))}
          className="transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
        <defs>
          <linearGradient id="ring-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fbf0d5" />
            <stop offset="1" stopColor="#cda853" />
          </linearGradient>
        </defs>
      </svg>
      <RefreshCwIcon size={15} className={cn("transition-transform duration-500 group-hover:rotate-90", spinning && "animate-spin")} />
    </button>
  );
}

/** Compact segmented control in the console's ink/gold idiom. */
export function Segmented<K extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: { key: K; label: ReactNode }[];
  value: K;
  onChange: (k: K) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-lg bg-ink/[0.05] p-0.5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.05)]">
      {items.map((it) => {
        const on = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(it.key)}
            className={cn(
              "h-7 rounded-md px-2.5 text-[11.5px] font-semibold transition-all duration-200 ease-brand",
              on ? "bg-void text-gold-light shadow-[0_6px_16px_-8px_rgba(6,42,34,0.8)]" : "text-ink-4 hover:bg-paper hover:text-ink"
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- dense blocks */

/** Board-vs-market meter: centre is market, ±10% at the ends. */
export function SpreadMeter({ pct, className }: { pct: number; className?: string }) {
  const clamped = Math.max(-10, Math.min(10, pct));
  const left = 50 + clamped * 5;
  const tone = Math.abs(pct) <= 2 ? "bg-emerald-600" : Math.abs(pct) <= 8 ? "bg-amber-500" : "bg-rose-600";
  return (
    <div className={cn("relative h-1 rounded-full bg-ink/[0.07]", className)}>
      <span className="absolute inset-y-0 left-[40%] right-[40%] rounded-full bg-emerald-600/15" aria-hidden />
      <span className="absolute -top-1 bottom-[-4px] left-1/2 w-px bg-ink/25" aria-hidden />
      <span
        className={cn("absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-paper transition-[left] duration-700 ease-brand", tone)}
        style={{ left: `${left}%` }}
      />
    </div>
  );
}

export function spreadTone(pct: number) {
  return Math.abs(pct) <= 2 ? "text-emerald-700" : Math.abs(pct) <= 8 ? "text-amber-700" : "text-rose-700";
}

/** One figure in the hero's KPI strip. */
export function Kpi({
  label,
  value,
  text,
  unit,
  format = money,
  sub,
  accent,
  tone,
  className,
  spark,
  detail,
}: {
  label: ReactNode;
  value: number | null | undefined;
  /** Shown in place of a missing value once loaded, instead of a shimmer. */
  text?: ReactNode;
  unit?: ReactNode;
  format?: (n: number) => string;
  sub?: ReactNode;
  accent?: boolean;
  /** Accent colour: a hairline across the top and a wash in the corner. */
  tone?: string;
  className?: string;
  /** Recent values, drawn as a faint line along the bottom of the tile. */
  spark?: number[];
  /** Hover card body. */
  detail?: ReactNode;
}) {
  const hover = useHoverCard(300);
  return (
    <div
      {...(detail ? hover.bind : {})}
      tabIndex={detail ? 0 : undefined}
      className={cn("group/kpi relative min-w-0 overflow-hidden px-4 pb-3 pt-3 transition-colors", detail && "cursor-default hover:bg-[#0a3a2f] focus:outline-none", className)}
      style={tone ? { backgroundImage: `radial-gradient(120% 90% at 100% 0%, ${tone}26, transparent 60%)` } : undefined}
    >
      {detail ? hover.render(detail) : null}
      {spark && spark.length >= 2 ? (
        <Sparkline
          values={spark}
          color={tone}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-9 opacity-40 transition-opacity group-hover/kpi:opacity-80 [&>span]:hidden"
        />
      ) : null}
      {tone ? <span className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, ${tone}, ${tone}00)` }} aria-hidden /> : null}
      <div className="relative flex items-center gap-1.5 truncate text-[9.5px] font-semibold uppercase tracking-[0.16em] text-paper/45">
        {tone ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: tone, boxShadow: `0 0 8px ${tone}` }} /> : null}
        {label}
      </div>
      {value != null && Number.isFinite(value) ? (
        <div className="relative mt-1 flex items-baseline gap-1">
          <LiveNumber
            value={value}
            format={format}
            tone="dark"
            className={cn("truncate leading-none", accent ? "text-[22px] text-gold-light" : "text-[17px] text-paper")}
          />
          {unit ? <span className="shrink-0 text-[9.5px] font-semibold text-paper/35">{unit}</span> : null}
        </div>
      ) : text != null ? (
        <div className={cn("g-metric relative mt-1 truncate leading-none", accent ? "text-[22px] text-gold-light" : "text-[17px] text-paper/80")}>{text}</div>
      ) : (
        <Shimmer dark className="mt-1.5 h-4 w-20" />
      )}
      {sub ? <div className="relative mt-1.5 flex min-h-[18px] items-center text-[10.5px] text-paper/40">{sub}</div> : null}
    </div>
  );
}

/** Title row shared by the light panels. */
export function PanelHead({
  kicker,
  title,
  right,
  className,
}: {
  kicker: ReactNode;
  title: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-ink/[0.06] px-4 py-3", className)}>
      <div className="min-w-0">
        <div className="g-kicker !text-[9.5px]">{kicker}</div>
        <h3 className="mt-0.5 truncate font-display text-[15px] font-bold tracking-tight text-ink">{title}</h3>
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- chart tooltip */

export function ChartTip({
  active,
  payload,
  label,
  unit,
  name,
}: {
  active?: boolean;
  payload?: { value?: number | string }[];
  label?: number | string;
  unit: string;
  name: string;
}) {
  const v = Number(payload?.[0]?.value);
  if (!active || !Number.isFinite(v)) return null;
  return (
    <div className="min-w-[160px] rounded-xl bg-void/95 px-3.5 py-2.5 text-paper shadow-[0_24px_48px_-16px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(226,194,122,0.22)] backdrop-blur">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-light/80">
        {new Date(Number(label)).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="g-metric text-lg leading-none">{money(v)}</span>
        <span className="text-[11px] text-paper/50">{unit}</span>
      </div>
      <div className="mt-0.5 text-[11px] text-paper/45">{name}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- hover cards */

/**
 * Rich hover detail for any element (tiles, table rows, list items). The card
 * is portalled to <body> with fixed positioning, so rounded `overflow-hidden`
 * panels and scrolling tables never clip it.
 */
export function useHoverCard(width = 300) {
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const el = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pos]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const open = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = el.current?.getBoundingClientRect();
      if (!r) return;
      const up = r.bottom + 320 > window.innerHeight && r.top > 320;
      const x = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8);
      setPos({ x, y: up ? r.top - 8 : r.bottom + 8, up });
    }, 140);
  };
  const close = () => {
    window.clearTimeout(timer.current);
    setPos(null);
  };
  return {
    bind: {
      ref: (n: HTMLElement | null) => {
        el.current = n;
      },
      onMouseEnter: open,
      onMouseLeave: close,
      onFocus: open,
      onBlur: close,
    },
    render: (content: ReactNode) =>
      pos && typeof document !== "undefined"
        ? createPortal(
            <div
              role="tooltip"
              style={{ left: pos.x, top: pos.y, width, transform: pos.up ? "translateY(-100%)" : undefined }}
              className="pointer-events-none fixed z-[100] animate-pop-in overflow-hidden rounded-2xl bg-void/[0.97] text-paper shadow-[0_32px_64px_-20px_rgba(0,0,0,0.65),inset_0_0_0_1px_rgba(226,194,122,0.22)] backdrop-blur-md"
            >
              <span className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" aria-hidden />
              {content}
            </div>,
            document.body
          )
        : null,
  };
}

/** Wrapper form of useHoverCard for block elements. */
export function HoverCard({ content, width, className, children }: { content: ReactNode; width?: number; className?: string; children: ReactNode }) {
  const h = useHoverCard(width);
  return (
    <div {...h.bind} className={className}>
      {children}
      {h.render(content)}
    </div>
  );
}

/** Table-row form of useHoverCard. */
export function HoverRow({ content, width, className, children }: { content: ReactNode; width?: number; className?: string; children: ReactNode }) {
  const h = useHoverCard(width);
  return (
    <tr {...h.bind} className={className}>
      {children}
      {h.render(content)}
    </tr>
  );
}

/** Standard body of a hover card: kicker, headline figure, optional sparkline and rows. */
export function CardBody({
  kicker,
  value,
  unit,
  chip,
  spark,
  color,
  rows,
  note,
}: {
  kicker: ReactNode;
  value?: ReactNode;
  unit?: ReactNode;
  chip?: ReactNode;
  spark?: number[];
  color?: string;
  rows?: { k: ReactNode; v: ReactNode; tone?: string }[];
  note?: ReactNode;
}) {
  return (
    <div className="p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[9.5px] font-semibold uppercase tracking-[0.16em] text-gold-light/80">{kicker}</span>
        {chip}
      </div>
      {value != null ? (
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="g-metric text-[22px] leading-none text-paper">{value}</span>
          {unit ? <span className="text-[10.5px] font-semibold text-paper/45">{unit}</span> : null}
        </div>
      ) : null}
      {spark && spark.length >= 2 ? (
        <div className="mt-2.5">
          <Sparkline values={spark} color={color} className="h-14" />
          <SeriesStrip values={spark} />
        </div>
      ) : null}
      {rows?.length ? (
        <div className="mt-2.5 divide-y divide-paper/[0.06] border-t border-paper/[0.08]">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-3 py-[5px] text-[11.5px]">
              <span className="truncate text-paper/50">{r.k}</span>
              <span className={cn("g-metric shrink-0 text-paper", r.tone)}>{r.v}</span>
            </div>
          ))}
        </div>
      ) : null}
      {note ? <p className="mt-2 text-[10.5px] leading-snug text-paper/40">{note}</p> : null}
    </div>
  );
}

/** Open / low / high / change for a series, as tiny figures under a sparkline. */
export function seriesStats(values: number[]) {
  if (values.length < 2) return null;
  const open = values[0]!;
  const last = values[values.length - 1]!;
  return { open, last, lo: Math.min(...values), hi: Math.max(...values), chg: last - open, pct: open ? ((last - open) / open) * 100 : 0 };
}

function SeriesStrip({ values }: { values: number[] }) {
  const s = seriesStats(values);
  if (!s) return null;
  const cell = (k: string, v: string, tone?: string) => (
    <div className="min-w-0">
      <div className="text-[8.5px] font-semibold uppercase tracking-[0.14em] text-paper/35">{k}</div>
      <div className={cn("g-metric truncate text-[11px] text-paper/85", tone)}>{v}</div>
    </div>
  );
  return (
    <div className="mt-1.5 grid grid-cols-4 gap-2">
      {cell("Open", money(s.open))}
      {cell("Low", money(s.lo), "text-rose-300")}
      {cell("High", money(s.hi), "text-emerald-300")}
      {cell("Chg", `${s.pct >= 0 ? "+" : ""}${s.pct.toFixed(2)}%`, s.pct > 0 ? "text-emerald-300" : s.pct < 0 ? "text-rose-300" : undefined)}
    </div>
  );
}

/* ---------------------------------------------------------------- sparkline */

/**
 * Tiny area line for a hero figure. With fewer than two samples it draws a
 * calm flat line through the middle so the tile never reads as broken.
 */
export function Sparkline({ values, color = "#E2C27A", className }: { values: number[]; color?: string; className?: string }) {
  const id = `spark${useId().replace(/:/g, "")}`;
  const w = 200;
  const h = 48;
  const pts = values.length >= 2 ? values : [1, 1];
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const span = hi - lo || 1;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * w, hi === lo ? h / 2 : h - 4 - ((v - lo) / span) * (h - 8)] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = xy[xy.length - 1]!;
  return (
    <div className={cn("relative h-12 w-full", className)} aria-hidden>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.35" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L${w} ${h} L0 ${h}Z`} fill={`url(#${id})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          strokeDasharray={values.length >= 2 ? undefined : "3 4"}
        />
      </svg>
      <span className="absolute size-2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${(last[0] / w) * 100}%`, top: `${(last[1] / h) * 100}%` }}>
        <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: color }} />
        <span className="absolute inset-0 rounded-full ring-2 ring-void" style={{ background: color }} />
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- skeleton */

export function Shimmer({ className, dark }: { className?: string; dark?: boolean }) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded-lg bg-[length:200%_100%]",
        dark
          ? "bg-[linear-gradient(90deg,rgba(255,255,255,0.04),rgba(255,255,255,0.1),rgba(255,255,255,0.04))]"
          : "bg-[linear-gradient(90deg,rgba(16,32,27,0.04),rgba(16,32,27,0.08),rgba(16,32,27,0.04))]",
        className
      )}
    />
  );
}
