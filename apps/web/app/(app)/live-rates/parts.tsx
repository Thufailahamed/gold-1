"use client";

// Visual building blocks for the Live Rates board. Everything here draws from
// the Emerald Vault tokens (void / gold / ink / paper / bone) and the shared
// surfaces in globals.css, so the board reads as part of the console.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { SpotlightCard } from "@/components/home/motion";
import { ArrowRightIcon, RefreshCwIcon } from "@/components/icons";

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

export function ChangeChip({
  pct,
  tone = "light",
  className,
  suffix,
}: {
  pct: number | null | undefined;
  tone?: "light" | "dark";
  className?: string;
  suffix?: ReactNode;
}) {
  if (pct == null)
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
          tone === "dark" ? "bg-paper/[0.06] text-paper/40" : "bg-ink/[0.05] text-ink-5",
          className
        )}
        title="Not enough history yet"
      >
        24h —
      </span>
    );
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
    <span className={cn("g-metric inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", cls, className)}>
      {flat ? null : (
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden className={cn(!up && "rotate-180")}>
          <path d="M4 1 7.5 6.5h-7z" fill="currentColor" />
        </svg>
      )}
      {Math.abs(pct).toFixed(2)}%{suffix}
    </span>
  );
}

const COIN: Record<string, { bg: string; fg: string; glyph: string }> = {
  XAU: { bg: "linear-gradient(145deg,#fbf0d5 0%,#e2c27a 35%,#cda853 60%,#7e6223 100%)", fg: "#3d2f0e", glyph: "Au" },
  XAG: { bg: "linear-gradient(145deg,#ffffff 0%,#e5e7eb 40%,#a8b0b9 75%,#6b7280 100%)", fg: "#1f2937", glyph: "Ag" },
  XPT: { bg: "linear-gradient(145deg,#f8fafc 0%,#dbe3ea 40%,#9fb0bf 75%,#5d6e7e 100%)", fg: "#1e293b", glyph: "Pt" },
  XPD: { bg: "linear-gradient(145deg,#fafaf9 0%,#d6d3d1 40%,#a8a29e 75%,#57534e 100%)", fg: "#292524", glyph: "Pd" },
  HG: { bg: "linear-gradient(145deg,#fde3cf 0%,#f0a46e 40%,#c26a2f 75%,#7c3a12 100%)", fg: "#3b1a06", glyph: "Cu" },
  BTC: { bg: "linear-gradient(145deg,#fde68a 0%,#f7b84b 40%,#f7931a 75%,#a85b00 100%)", fg: "#3b2100", glyph: "₿" },
  ETH: { bg: "linear-gradient(145deg,#e0e7ff 0%,#a5b4fc 40%,#6d7ae0 75%,#3730a3 100%)", fg: "#1e1b4b", glyph: "Ξ" },
};

/** Minted-coin glyph for a market: metal-toned gradient with the element symbol. */
export function MetalCoin({ symbol, size = 36 }: { symbol: string; size?: number }) {
  const c = COIN[symbol] ?? { bg: "linear-gradient(145deg,#f3ebd7,#a88a3e)", fg: "#10201b", glyph: symbol.slice(0, 2) };
  return (
    <span
      aria-hidden
      className="relative flex shrink-0 items-center justify-center rounded-full font-display font-bold"
      style={{
        width: size,
        height: size,
        background: c.bg,
        color: c.fg,
        fontSize: size * 0.36,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7), inset 0 -2px 4px rgba(0,0,0,0.18), 0 6px 14px -6px rgba(16,32,27,0.45)",
      }}
    >
      <span className="absolute inset-[3px] rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]" />
      {c.glyph}
    </span>
  );
}

/** Code badge for a currency row. */
export function CurrencyBadge({ code, active }: { code: string; active?: boolean }) {
  return (
    <span
      className={cn(
        "g-metric flex h-9 w-12 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold tracking-wide transition-colors duration-200",
        active
          ? "bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(226,194,122,0.35)]"
          : "bg-bone text-ink-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07)] group-hover:bg-gold-pale group-hover:text-gold-deep"
      )}
    >
      {code}
    </span>
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
      className="group relative flex size-10 shrink-0 items-center justify-center rounded-full bg-paper/[0.05] text-paper/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] transition-all duration-200 ease-brand hover:bg-paper/[0.1] hover:text-gold-light disabled:cursor-wait"
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
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-xl bg-ink/[0.05] p-1 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.05)]">
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
              "h-8 rounded-lg px-3 text-[12px] font-semibold transition-all duration-200 ease-brand",
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

/** Section heading used between the board's blocks. */
export function SectionHead({
  kicker,
  title,
  aside,
}: {
  kicker: ReactNode;
  title: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 px-1">
      <div>
        <div className="g-kicker">{kicker}</div>
        <h2 className="mt-1 font-display text-xl font-bold tracking-tight text-ink">{title}</h2>
      </div>
      {aside ? <div className="text-xs text-ink-4">{aside}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- karat card */

/** Board-vs-market meter: centre is market, ±10% at the ends. */
function SpreadMeter({ pct }: { pct: number }) {
  const clamped = Math.max(-10, Math.min(10, pct));
  const left = 50 + clamped * 5;
  const tone = Math.abs(pct) <= 2 ? "bg-emerald-600" : Math.abs(pct) <= 8 ? "bg-amber-500" : "bg-rose-600";
  return (
    <div className="relative h-1.5 rounded-full bg-ink/[0.07]">
      <span className="absolute inset-y-0 left-[40%] right-[40%] rounded-full bg-emerald-600/15" aria-hidden />
      <span className="absolute -top-1 bottom-[-4px] left-1/2 w-px bg-ink/25" aria-hidden />
      <span
        className={cn("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-paper transition-[left] duration-700 ease-brand", tone)}
        style={{ left: `${left}%` }}
      />
    </div>
  );
}

export function KaratCard({
  karat,
  purity,
  perGram,
  perPawn,
  change,
  board,
  boardDiffPct,
  boardSince,
  ccy,
  onPublish,
  featured,
}: {
  karat: string;
  purity: number;
  perGram: number;
  perPawn: number;
  change: number | null;
  board: number | null;
  boardDiffPct: number | null;
  boardSince: number | null;
  ccy: string;
  onPublish?: () => void;
  featured?: boolean;
}) {
  return (
    <div className="group h-full rounded-[22px]">
      <SpotlightCard tone={featured ? "dark" : "light"}>
        <div className="relative flex h-full flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "flex size-11 items-center justify-center rounded-2xl font-display text-[15px] font-extrabold tracking-tight",
                  featured
                    ? "bg-gradient-to-br from-gold-light via-gold to-gold-deep text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_10px_24px_-10px_rgba(205,168,83,0.8)]"
                    : "bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(226,194,122,0.3)]"
                )}
              >
                {karat}
              </span>
              <div>
                <div className={cn("text-sm font-semibold", featured ? "text-paper" : "text-ink")}>{karat} gold</div>
                <div className={cn("g-metric text-[11px]", featured ? "text-paper/45" : "text-ink-5")}>
                  {(purity * 1000).toFixed(0)} fine
                </div>
              </div>
            </div>
            <ChangeChip pct={change} tone={featured ? "dark" : "light"} />
          </div>

          <div className="mt-6">
            <div className={cn("text-[10px] font-semibold uppercase tracking-[0.16em]", featured ? "text-paper/40" : "text-ink-5")}>
              Market per gram
            </div>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <LiveNumber
                value={perGram}
                tone={featured ? "dark" : "light"}
                className={cn("text-[30px] leading-none", featured ? "text-paper" : "text-ink")}
              />
              <span className={cn("text-xs font-semibold", featured ? "text-gold-light/80" : "text-ink-4")}>{ccy}</span>
            </div>
            <div className={cn("mt-2 text-xs", featured ? "text-paper/55" : "text-ink-4")}>
              Pawn (8g) <span className={cn("g-metric font-medium", featured ? "text-paper/85" : "text-ink-2")}>{money(perPawn)}</span>
            </div>
          </div>

          <div className={cn("mt-5 border-t pt-4", featured ? "border-paper/[0.08]" : "border-ink/[0.07]")}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className={featured ? "text-paper/50" : "text-ink-4"}>Your board</span>
              {board != null ? (
                <span
                  className={cn("g-metric font-semibold", featured ? "text-paper" : "text-ink")}
                  title={boardSince ? `Effective ${new Date(boardSince).toLocaleString()}` : undefined}
                >
                  {money(board)} <span className={cn("font-sans text-[10px]", featured ? "text-paper/45" : "text-ink-5")}>{ccy}</span>
                </span>
              ) : (
                <span className={featured ? "text-paper/40" : "text-ink-5"}>Not published</span>
              )}
            </div>
            {boardDiffPct != null ? (
              <div className="mt-3 space-y-1.5">
                <SpreadMeter pct={boardDiffPct} />
                <div className={cn("flex justify-between text-[10px]", featured ? "text-paper/40" : "text-ink-5")}>
                  <span>−10%</span>
                  <span
                    className={cn(
                      "font-semibold",
                      Math.abs(boardDiffPct) <= 2
                        ? featured ? "text-emerald-300" : "text-emerald-700"
                        : Math.abs(boardDiffPct) <= 8
                          ? featured ? "text-amber-300" : "text-amber-700"
                          : featured ? "text-rose-300" : "text-rose-700"
                    )}
                  >
                    {boardDiffPct > 0 ? "+" : ""}
                    {boardDiffPct.toFixed(2)}% {boardDiffPct >= 0 ? "above" : "below"} market
                  </span>
                  <span>+10%</span>
                </div>
              </div>
            ) : null}
          </div>

          {onPublish ? (
            <button
              type="button"
              onClick={onPublish}
              className={cn(
                "mt-5 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold transition-all duration-200 ease-brand",
                featured
                  ? "home-btn-gold"
                  : "bg-bone text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.08)] hover:bg-void hover:text-gold-light"
              )}
            >
              Set board rate
              <ArrowRightIcon size={13} className="transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
          ) : null}
        </div>
      </SpotlightCard>
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
