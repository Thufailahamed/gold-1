"use client";

/**
 * Building blocks shared by the module overview dashboards (old gold, sales):
 * a dark hero with a metric strip, workspace entry cards, and light cards.
 */

import { type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { useCountUp } from "@/lib/count-up";
import { Skeleton } from "@/components/ui";
import { ArrowRightIcon } from "@/components/icons";

export type IconCmp = (props: { size?: number | string; className?: string }) => ReactNode;

export const lkr = (c: number) => Math.round(c / 100).toLocaleString("en-US");
export const grams = (mg: number) => (mg / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });
export const count = (n: number) => Math.round(n).toLocaleString("en-US");
export const ago = (ms: number) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};
const longDate = () =>
  new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

const surface =
  "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("relative overflow-hidden rounded-[22px] bg-paper", surface, className)}>
      <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
      {children}
    </section>
  );
}

export function IconChip({ icon: Icon, size = "md" }: { icon: IconCmp; size?: "md" | "lg" }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)] transition-all duration-320",
        "group-hover:bg-gradient-to-b group-hover:from-gold-light group-hover:to-gold group-hover:text-void",
        size === "lg" ? "size-12" : "size-10"
      )}
    >
      <Icon size={size === "lg" ? 20 : 17} />
    </span>
  );
}

export function CardHead({ icon, title, sub, action }: { icon: IconCmp; title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-5 sm:px-6">
      <div className="flex min-w-0 items-center gap-3.5">
        <IconChip icon={icon} />
        <div className="min-w-0">
          <h2 className="truncate font-sans text-[15px] font-semibold tracking-normal text-ink">{title}</h2>
          {sub ? <p className="truncate text-xs text-ink-4">{sub}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

export function HeadLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-ink-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)] transition-all hover:-translate-y-px hover:bg-void hover:text-paper hover:shadow-none"
    >
      {children}
      <ArrowRightIcon size={12} className="transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export function Empty({ icon: Icon, title, desc }: { icon: IconCmp; title: string; desc: string }) {
  return (
    <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-ink/[0.12] bg-gradient-to-b from-bone/70 to-paper px-6 py-10 text-center">
      <div aria-hidden className="pointer-events-none absolute -top-16 left-1/2 size-48 -translate-x-1/2 rounded-full bg-gold/10 blur-[60px]" />
      <span className="relative mb-3 flex size-11 items-center justify-center rounded-xl bg-void text-gold-light shadow-[0_10px_20px_-12px_rgba(6,42,34,0.8)]">
        <Icon size={18} />
      </span>
      <p className="relative text-sm font-semibold text-ink">{title}</p>
      <p className="relative mt-1 max-w-[16rem] text-xs leading-relaxed text-ink-4">{desc}</p>
    </div>
  );
}

export function ListSkeleton({ rows = 3, className = "h-14 rounded-xl" }: { rows?: number; className?: string }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={className} />
      ))}
    </div>
  );
}

export function SectionHead({ index, title, sub }: { index: string; title: ReactNode; sub?: ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3.5 pt-4">
      <span className="g-metric flex h-7 min-w-9 items-center justify-center rounded-lg bg-void px-2 text-[11px] font-semibold tracking-[0.14em] text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.3)]">
        {index}
      </span>
      <div className="flex items-center gap-4">
        <h2 className="font-display text-xl font-semibold tracking-tight text-ink">{title}</h2>
        <span className="hidden h-px flex-1 bg-gradient-to-r from-gold/40 via-ink/[0.08] to-transparent sm:block" aria-hidden />
      </div>
      {sub ? <p className="col-start-2 mt-1 text-xs text-ink-4">{sub}</p> : null}
    </div>
  );
}

/** Large entry card for one of a module's workspaces. */
export function ModuleCard({
  href,
  index,
  icon,
  title,
  description,
  metric,
  metricLabel,
  cta,
  loading,
  alert,
  delay = 0,
}: {
  href: string;
  index: string;
  icon: IconCmp;
  title: string;
  description: string;
  metric: ReactNode;
  metricLabel: string;
  cta: string;
  loading?: boolean;
  alert?: boolean;
  delay?: number;
}) {
  return (
    <Link
      href={href}
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        "group relative flex h-full animate-fade-in flex-col overflow-hidden rounded-[22px] bg-paper p-5 transition-all duration-320 ease-brand sm:p-6",
        surface,
        "hover:-translate-y-1 hover:shadow-[inset_0_0_0_1px_rgba(168,138,62,0.4),0_32px_64px_-30px_rgba(126,98,35,0.5)]"
      )}
    >
      <span aria-hidden className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent opacity-0 transition-opacity duration-320 group-hover:opacity-100" />
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-40 rounded-full bg-gold/10 opacity-0 blur-2xl transition-opacity duration-320 group-hover:opacity-100" />
      <span aria-hidden className="g-display pointer-events-none absolute -bottom-5 right-3 select-none text-[5.5rem] leading-none text-gold/[0.07] transition-colors duration-320 group-hover:text-gold/[0.12]">
        {index}
      </span>

      <div className="relative flex items-start justify-between gap-3">
        <IconChip icon={icon} size="lg" />
        <span className="flex size-8 items-center justify-center rounded-full text-ink-5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)] transition-all duration-320 group-hover:bg-void group-hover:text-gold-light group-hover:shadow-none">
          <ArrowRightIcon size={13} className="transition-transform duration-320 group-hover:-rotate-45" />
        </span>
      </div>
      <h3 className="relative mt-5 font-sans text-base font-semibold tracking-normal text-ink transition-colors group-hover:text-gold-deep">{title}</h3>
      <p className="relative mt-1 text-xs leading-relaxed text-ink-4">{description}</p>

      <div className="relative mt-auto pt-6">
        <div className="flex items-end justify-between gap-3 rounded-2xl bg-bone/70 px-3.5 py-3 ring-1 ring-ink/[0.05] transition-colors group-hover:bg-gold-pale/60">
          <div className="min-w-0">
            {loading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <span className="g-metric flex items-center gap-2 text-2xl leading-none text-ink">
                {metric}
                {alert ? (
                  <span className="relative flex size-2.5" aria-hidden>
                    <span className="absolute inset-0 animate-ping rounded-full bg-amber-400/60" />
                    <span className="relative size-2.5 rounded-full bg-amber-500" />
                  </span>
                ) : null}
              </span>
            )}
            <span className="mt-1.5 block truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4">{metricLabel}</span>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-paper px-3 py-1.5 text-xs font-medium text-ink-3 ring-1 ring-ink/[0.08] transition-all group-hover:bg-void group-hover:text-paper group-hover:ring-transparent">
            {cta}
            <ArrowRightIcon size={12} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
      <span className="absolute inset-x-6 bottom-0 h-0.5 origin-left scale-x-0 rounded-full bg-gradient-to-r from-gold-dark via-gold-light to-transparent transition-transform duration-500 ease-brand group-hover:scale-x-100" />
    </Link>
  );
}

/** Compact entry tile for one of a module's workspaces, with its headline figure. */
export function Shortcut({
  href,
  icon,
  title,
  desc,
  metric,
  label,
  loading,
  alert,
  delay,
}: {
  href: string;
  icon: IconCmp;
  title: string;
  desc: string;
  metric: ReactNode;
  label: string;
  loading?: boolean;
  alert?: boolean;
  delay: number;
}) {
  return (
    <Link
      href={href}
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        "group relative flex animate-fade-in flex-col overflow-hidden rounded-[22px] bg-paper p-5 transition-all duration-320 ease-brand",
        surface,
        "hover:-translate-y-1 hover:shadow-[inset_0_0_0_1px_rgba(168,138,62,0.4),0_30px_60px_-30px_rgba(126,98,35,0.45)]"
      )}
    >
      <span aria-hidden className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent opacity-0 transition-opacity duration-320 group-hover:opacity-100" />
      <div className="flex items-start justify-between">
        <IconChip icon={icon} size="lg" />
        <span className="flex size-8 items-center justify-center rounded-full text-ink-5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)] transition-all duration-240 group-hover:bg-void group-hover:text-gold-light group-hover:shadow-none">
          <ArrowRightIcon size={13} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
      <h3 className="mt-4 font-sans text-[15px] font-semibold tracking-normal text-ink transition-colors group-hover:text-gold-deep">{title}</h3>
      <p className="mt-0.5 line-clamp-1 text-xs text-ink-4">{desc}</p>
      <div className="mt-4 flex items-baseline gap-2 rounded-xl bg-bone/70 px-3 py-2.5 ring-1 ring-ink/[0.05] transition-colors group-hover:bg-gold-pale/60">
        {loading ? (
          <Skeleton className="h-6 w-12" />
        ) : (
          <span className="g-metric flex items-center gap-2 text-xl leading-none text-ink">
            {metric}
            {alert ? <span className="size-1.5 animate-pulse-soft rounded-full bg-amber-500" aria-hidden /> : null}
          </span>
        )}
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-5">{label}</span>
      </div>
      <span className="absolute inset-x-5 bottom-0 h-0.5 origin-left scale-x-0 rounded-full bg-gradient-to-r from-gold-dark via-gold-light to-transparent transition-transform duration-500 ease-brand group-hover:scale-x-100" />
    </Link>
  );
}

export type BoardState = { status: string; label: string; hint: string; bar: string };

/** A proportion bar over a grid of status cells, each linking to its filtered list. */
export function StatusBoard({
  icon,
  title,
  sub,
  action,
  states,
  counts,
  loading,
  href,
  format = (n) => String(n),
  cols = "grid-cols-2",
}: {
  icon: IconCmp;
  title: string;
  sub: ReactNode;
  action?: ReactNode;
  states: BoardState[];
  counts: (number | undefined)[];
  loading: boolean;
  href: (status: string) => string;
  format?: (n: number) => string;
  cols?: string;
}) {
  const total = counts.reduce<number>((a, c) => a + (c ?? 0), 0);
  return (
    <Card>
      <CardHead icon={icon} title={title} sub={sub} action={action} />
      <div className="px-5 sm:px-6">
        <div className="flex h-3 gap-[2px] overflow-hidden rounded-full bg-ink/[0.06] p-[2px]" aria-hidden>
          {total > 0
            ? states.map((s, i) => {
                const c = counts[i] ?? 0;
                return c > 0 ? (
                  <span
                    key={s.status}
                    className={cn("h-full rounded-full transition-[width] duration-700 ease-brand", s.bar)}
                    style={{ width: `${(c / total) * 100}%` }}
                  />
                ) : null;
              })
            : null}
        </div>
      </div>
      <ol className={cn("mt-5 grid gap-px border-t border-ink/[0.06] bg-ink/[0.06]", cols)}>
        {states.map((s, i) => (
          <li key={s.status} className="bg-paper">
            <Link href={href(s.status)} className="group flex h-full items-center gap-4 px-5 py-4 transition-colors hover:bg-gold-pale/50">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", s.bar)} />
                  <span className="text-[13px] font-semibold text-ink transition-colors group-hover:text-gold-deep">{s.label}</span>
                </span>
                <span className="mt-1 block truncate text-[11px] text-ink-4">{s.hint}</span>
              </span>
              {loading ? (
                <Skeleton className="h-7 w-10" />
              ) : (
                <span className="g-metric text-2xl leading-none text-ink">{counts[i] === undefined ? "—" : format(counts[i] ?? 0)}</span>
              )}
              <ArrowRightIcon size={13} className="shrink-0 -translate-x-1 text-gold-dark opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export type HeroMetricDef = {
  label: string;
  value: number | undefined;
  format: (n: number) => string;
  unit?: string;
  icon: IconCmp;
  href: string;
};

function HeroMetric({ label, value, format, unit, icon: Icon, href, index }: HeroMetricDef & { index: number }) {
  const shown = useCountUp(value);
  return (
    <Link
      href={href}
      className={cn(
        "group flex min-w-0 items-center gap-3.5 bg-void/95 px-4 py-4 transition-colors hover:bg-[#0d3a2c] sm:px-6",
        index === 0 && "bg-gradient-to-br from-void/95 to-[#0d3a2c]/95"
      )}
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 transition-all duration-240",
          index === 0
            ? "bg-gradient-to-b from-gold-light to-gold text-void ring-gold/40"
            : "bg-gradient-to-b from-paper/[0.09] to-paper/[0.03] text-gold-light ring-paper/[0.09] group-hover:from-gold-light group-hover:to-gold group-hover:text-void"
        )}
      >
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">{label}</span>
        <span className={cn("g-metric mt-1 flex items-baseline gap-1.5 truncate text-xl leading-none", index === 0 ? "text-gold-light" : "text-paper")}>
          {value === undefined ? "—" : format(shown)}
          {unit && value !== undefined ? <span className="text-[11px] font-medium text-paper/45">{unit}</span> : null}
        </span>
      </span>
      <ArrowRightIcon size={12} className="shrink-0 -translate-x-1 text-gold-light opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
    </Link>
  );
}

/** Dark module hero: kicker + date, headline, blurb, actions, and a 4-up metric strip. */
export function ModuleHero({
  kicker,
  title,
  description,
  actions,
  aside,
  metrics,
}: {
  kicker: string;
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  /** Optional panel on the right of the headline, e.g. the module's key balance. */
  aside?: ReactNode;
  metrics: HeroMetricDef[];
}) {
  return (
    <section className="relative overflow-hidden rounded-[28px] bg-void text-paper shadow-5 ring-1 ring-gold/10">
      <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-60" />
      <div className="home-drift pointer-events-none absolute -right-24 -top-32 size-[22rem] rounded-full bg-gold/20 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 -left-24 size-80 rounded-full bg-emerald-400/10 blur-[110px]" />
      <div className="home-noise pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />

      <div className="relative flex flex-col gap-7 px-5 py-6 sm:px-8 sm:py-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 max-w-xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
              <span className="size-1.5 animate-pulse-soft rounded-full bg-gold" />
              {kicker}
            </span>
            <span className="rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-paper/45 ring-1 ring-paper/10">{longDate()}</span>
          </div>
          <h1 className="g-display mt-4 text-[30px] leading-[1.05] text-paper sm:text-[42px]">{title}</h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-paper/60">{description}</p>
          {actions ? <div className="mt-6 flex flex-wrap items-center gap-2.5">{actions}</div> : null}
        </div>
        {aside ? <div className="min-w-0 lg:w-[22rem] lg:shrink-0">{aside}</div> : null}
      </div>

      <div className="relative grid grid-cols-2 gap-px border-t border-paper/[0.08] bg-paper/[0.06] lg:grid-cols-4">
        {metrics.map((m, i) => (
          <HeroMetric key={m.label} {...m} index={i} />
        ))}
      </div>
    </section>
  );
}
