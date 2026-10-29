"use client";

// Compact console building blocks: a slim dark command header with a
// figures strip, dense light panels, tables and filter pills. Shared by the
// gold vault and workshop modules so they read as one system.
import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { useCountUp } from "@/lib/count-up";
import { Skeleton } from "@/components/ui";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/icons";

export type IconCmp = (props: { size?: number | string; className?: string }) => ReactNode;

export const grams = (mg: number) => (mg / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });
export const count = (n: number) => Math.round(n).toLocaleString("en-US");
export const pct = (n: number, d = 1) => `${n.toFixed(d)}%`;
export const ago = (ms: number) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};
export const stamp = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
export const pretty = (k: string) => k.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
/** Permille to the nearest karat, for reading purities at a glance. */
export const karat = (permille: number) => `${Math.round((permille / 1000) * 24)}K`;

/* ------------------------------------------------------------- the hero */

export type HeroStat = {
  label: string;
  value: number | undefined | null;
  format?: (n: number) => string;
  text?: string;
  unit?: string;
  sub?: ReactNode;
  href?: string;
  accent?: boolean;
  tone?: "good" | "bad" | "warn";
  loading?: boolean;
};

function StatCell({ s }: { s: HeroStat }) {
  const shown = useCountUp(s.value ?? undefined);
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-[9.5px] font-semibold uppercase tracking-[0.16em] text-paper/40">{s.label}</span>
        {s.href ? (
          <ArrowRightIcon size={11} className="shrink-0 -translate-x-1 text-paper/30 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-gold-light group-hover:opacity-100" />
        ) : null}
      </span>
      {s.loading ? (
        <Skeleton className="mt-1.5 h-5 w-20 bg-paper/10" />
      ) : (
        <span className="mt-1 flex items-baseline gap-1 whitespace-nowrap">
          <span
            className={cn(
              "g-metric truncate leading-none",
              s.accent ? "text-[21px] text-gold-light" : "text-[17px]",
              !s.accent && (s.tone === "good" ? "text-emerald-300" : s.tone === "bad" ? "text-rose-300" : s.tone === "warn" ? "text-amber-300" : "text-paper")
            )}
          >
            {s.text ?? (s.value == null ? "—" : (s.format ?? count)(shown))}
          </span>
          {s.unit ? <span className="text-[9.5px] font-semibold text-paper/35">{s.unit}</span> : null}
        </span>
      )}
      {s.sub ? <span className="mt-1 block truncate text-[10.5px] text-paper/40">{s.sub}</span> : null}
    </>
  );
  const cls = cn(
    "group block min-w-0 px-4 py-2.5 transition-colors",
    s.accent ? "bg-void bg-gradient-to-br from-gold/[0.16] via-void to-void" : "bg-void",
    s.href && "hover:bg-[#0a3a2f]"
  );
  return s.href ? (
    <Link href={s.href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

const COLS: Record<number, string> = {
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  5: "sm:grid-cols-3 lg:grid-cols-5",
  6: "sm:grid-cols-3 xl:grid-cols-6",
  7: "sm:grid-cols-4 2xl:grid-cols-7",
  8: "sm:grid-cols-4 2xl:grid-cols-8",
};

/** Slim dark command header: identity and actions on top, figures below. */
export function GoldHero({
  icon: Icon,
  title,
  accent,
  badge,
  sub,
  back,
  actions,
  stats,
  children,
}: {
  icon: IconCmp;
  title: ReactNode;
  accent?: ReactNode;
  badge?: ReactNode;
  sub?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
  stats?: HeroStat[];
  children?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-[20px] bg-void text-paper shadow-5">
      <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-40" />
      <div className="home-drift pointer-events-none absolute -right-24 -top-40 size-80 rounded-full bg-gold/[0.18] blur-[100px]" />
      <div className="pointer-events-none absolute -bottom-40 left-1/4 size-72 rounded-full bg-gold-deep/20 blur-[110px]" />
      <div className="home-noise pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />

      <div className="relative flex flex-col gap-3 px-4 pt-4 sm:px-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {back ? (
            <Link
              href={back.href}
              aria-label={`Back to ${back.label}`}
              title={back.label}
              className="flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-paper/[0.06] text-paper/70 ring-1 ring-inset ring-paper/15 transition hover:bg-paper/[0.1] hover:text-gold-light"
            >
              <ArrowLeftIcon size={16} />
            </Link>
          ) : null}
          <span className="flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold-deep text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_10px_24px_-10px_rgba(205,168,83,0.7)]">
            <Icon size={18} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="g-display text-[24px] leading-none">
                {title} {accent ? <span className="home-gold-text">{accent}</span> : null}
              </h1>
              {badge}
            </div>
            {sub ? <div className="mt-1 truncate text-[11px] text-paper/45">{sub}</div> : null}
          </div>
        </div>
        {actions ? <div className="no-print flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      {children ? <div className="relative px-4 pt-3 sm:px-5">{children}</div> : null}

      {stats?.length ? (
        <div
          className={cn(
            "relative mx-4 mb-4 mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-paper/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] sm:mx-5",
            COLS[stats.length] ?? "sm:grid-cols-4"
          )}
        >
          {stats.map((s) => (
            <StatCell key={s.label} s={s} />
          ))}
        </div>
      ) : (
        <div className="h-4" />
      )}
    </section>
  );
}

export function HeroBadge({ children, tone = "gold" }: { children: ReactNode; tone?: "gold" | "good" | "warn" | "bad" | "muted" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.16em]",
        tone === "gold" && "border-gold/25 bg-gold/[0.08] text-gold-light",
        tone === "good" && "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
        tone === "warn" && "border-amber-400/30 bg-amber-400/10 text-amber-300",
        tone === "bad" && "border-rose-400/30 bg-rose-400/10 text-rose-300",
        tone === "muted" && "border-paper/15 bg-paper/5 text-paper/55"
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          tone === "gold" && "animate-pulse-soft bg-gold",
          tone === "good" && "bg-emerald-400",
          tone === "warn" && "animate-pulse-soft bg-amber-400",
          tone === "bad" && "bg-rose-400",
          tone === "muted" && "bg-paper/40"
        )}
      />
      {children}
    </span>
  );
}

export const heroGold = "home-btn-gold h-8 px-3.5 text-[12.5px]";
export const heroGhost = "home-btn-ghost h-8 px-3 text-[12.5px]";

/* ------------------------------------------------------------- surfaces */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "relative flex min-w-0 flex-col overflow-hidden rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2),0_18px_40px_-30px_rgba(16,32,27,0.28)]",
        className
      )}
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
      {children}
    </section>
  );
}

export function CardHead({ icon: Icon, title, sub, action }: { icon: IconCmp; title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-ink/20 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25)]">
          <Icon size={14} />
        </span>
        <div className="min-w-0 leading-tight">
          <h2 className="truncate font-sans text-[13.5px] font-semibold tracking-normal text-ink">{title}</h2>
          {sub ? <p className="truncate text-[11px] text-ink-4">{sub}</p> : null}
        </div>
      </div>
      {action ? <div className="flex flex-wrap items-center gap-1.5">{action}</div> : null}
    </div>
  );
}

export function HeadLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="group inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-ink-4 transition-colors hover:bg-ink/[0.05] hover:text-ink">
      {children}
      <ArrowRightIcon size={11} className="transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export function Empty({ icon: Icon, title, desc, action }: { icon: IconCmp; title: string; desc: string; action?: ReactNode }) {
  return (
    <div className="m-3 flex items-center gap-3 rounded-xl border border-dashed border-ink/20 bg-bone/60 px-4 py-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-void text-gold-light">
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        <p className="text-[11px] leading-snug text-ink-4">{desc}</p>
      </div>
      {action}
    </div>
  );
}

export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 rounded-lg" />
      ))}
    </div>
  );
}

/** Small strip of figures under a panel header. */
export function MiniStats({ items }: { items: { k: string; v: ReactNode; tone?: string }[] }) {
  return (
    <div className={cn("grid grid-cols-2 border-b border-ink/20", items.length >= 4 ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
      {items.map((it, i) => (
        <div key={it.k} className={cn("min-w-0 px-4 py-2", i % 2 === 1 && "border-l border-ink/20", i >= 2 && "border-t border-ink/20 sm:border-t-0", i > 0 && "sm:border-l")}>
          <div className="truncate text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{it.k}</div>
          <div className={cn("g-metric mt-0.5 truncate text-[13px]", it.tone ?? "text-ink")}>{it.v}</div>
        </div>
      ))}
    </div>
  );
}

/** Share bar used in breakdown tables. */
export function ShareBar({ value, className, color = "bg-gradient-to-r from-gold-deep to-gold-light" }: { value: number; className?: string; color?: string }) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-ink/[0.06]", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-700 ease-brand", color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export const th = "py-1.5 px-2 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5";
export const thead = "bg-bone/60 text-left";
export const tr = "border-t border-ink/20 transition-colors hover:bg-gold-pale/30";
export const inputCls =
  "h-8 rounded-lg bg-paper px-2.5 text-[12.5px] text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)] transition-shadow placeholder:text-ink-5 focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_3px_rgba(205,168,83,0.24)]";

/** A row of pill filters with counts. */
export function FilterPills<K extends string>({
  items,
  value,
  onChange,
}: {
  items: { key: K; label: string; count?: number; dot?: string }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <div role="tablist" className="flex flex-wrap items-center gap-1">
      {items.map((it) => {
        const on = it.key === value;
        return (
          <button
            key={it.key}
            role="tab"
            aria-selected={on}
            type="button"
            onClick={() => onChange(it.key)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium transition-all duration-200",
              on ? "bg-void text-gold-light shadow-[0_6px_16px_-8px_rgba(6,42,34,0.8)]" : "text-ink-3 ring-1 ring-inset ring-ink/20 hover:bg-bone hover:text-ink"
            )}
          >
            {it.dot ? <span className={cn("size-1.5 rounded-full", it.dot)} /> : null}
            {it.label}
            {it.count !== undefined ? (
              <span className={cn("g-metric rounded-full px-1.5 text-[10px]", on ? "bg-paper/10 text-paper/80" : "bg-ink/[0.05] text-ink-4")}>{it.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
