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
import { SpotlightCard } from "@/components/home/motion";
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

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(28,25,23,0.07),0_18px_40px_-28px_rgba(28,25,23,0.25)]",
        className
      )}
    >
      {children}
    </section>
  );
}

export function IconChip({ icon: Icon, size = "md" }: { icon: IconCmp; size?: "md" | "lg" }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-soft to-gold-pale text-gold-deep shadow-[inset_0_0_0_1px_rgba(168,134,27,0.2)] transition-all duration-320 group-hover:from-void group-hover:to-ink-2 group-hover:text-gold-light",
        size === "lg" ? "size-11" : "size-9"
      )}
    >
      <Icon size={size === "lg" ? 19 : 16} />
    </span>
  );
}

export function CardHead({ icon, title, sub, action }: { icon: IconCmp; title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-5 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
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
      className="group inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-ink-4 transition-colors hover:bg-ink/[0.05] hover:text-ink"
    >
      {children}
      <ArrowRightIcon size={12} className="transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export function Empty({ icon: Icon, title, desc }: { icon: IconCmp; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink/[0.12] bg-bone/60 px-6 py-10 text-center">
      <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-paper text-ink-4 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.08)]">
        <Icon size={18} />
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-[16rem] text-xs leading-relaxed text-ink-4">{desc}</p>
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
    <div className="flex flex-wrap items-end gap-3 pt-2 sm:gap-4">
      <span className="g-metric pb-0.5 text-[11px] font-semibold tracking-[0.22em] text-gold-dark">{index}</span>
      <div className="min-w-0">
        <h2 className="font-display text-lg font-bold tracking-tight text-ink">{title}</h2>
        {sub ? <p className="mt-0.5 text-xs text-ink-4">{sub}</p> : null}
      </div>
      <div className="hidden h-px flex-1 translate-y-[-6px] bg-ink/[0.08] sm:block" />
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
    <Link href={href} className="group block h-full animate-fade-in rounded-[22px]" style={{ animationDelay: `${delay}ms` }}>
      <SpotlightCard tone="light" className="flex h-full flex-col p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <IconChip icon={icon} size="lg" />
          <span className="g-metric text-[10px] tracking-[0.22em] text-ink-5">{index}</span>
        </div>
        <h3 className="mt-5 text-base font-semibold text-ink transition-colors group-hover:text-gold-dark">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-4">{description}</p>

        <div className="mt-auto pt-6">
          <div className="flex items-end justify-between gap-3 border-t border-ink/[0.06] pt-4">
            <div className="min-w-0">
              {loading ? (
                <Skeleton className="h-7 w-16" />
              ) : (
                <span className="g-metric flex items-center gap-2 text-2xl leading-none text-ink">
                  {metric}
                  {alert ? <span className="size-2 animate-pulse-soft rounded-full bg-amber-500" aria-hidden /> : null}
                </span>
              )}
              <span className="mt-1.5 block truncate text-[11px] font-medium uppercase tracking-[0.12em] text-ink-4">{metricLabel}</span>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink/[0.04] px-3 py-1.5 text-xs font-medium text-ink-3 transition-colors group-hover:bg-ink group-hover:text-paper">
              {cta}
              <ArrowRightIcon size={12} className="transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>
        <span className="absolute inset-x-6 bottom-0 h-0.5 origin-left scale-x-0 rounded-full bg-gradient-to-r from-gold-dark via-gold-light to-transparent transition-transform duration-500 ease-brand group-hover:scale-x-100" />
      </SpotlightCard>
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
        <div className="flex h-2.5 overflow-hidden rounded-full bg-ink/[0.06]" aria-hidden>
          {total > 0
            ? states.map((s, i) => {
                const c = counts[i] ?? 0;
                return c > 0 ? (
                  <span
                    key={s.status}
                    className={cn("h-full border-r-2 border-paper last:border-r-0 transition-[width] duration-700 ease-brand", s.bar)}
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
                  <span className="text-[13px] font-semibold text-ink transition-colors group-hover:text-gold-dark">{s.label}</span>
                </span>
                <span className="mt-1 block truncate text-[11px] text-ink-4">{s.hint}</span>
              </span>
              {loading ? (
                <Skeleton className="h-7 w-10" />
              ) : (
                <span className="g-metric text-2xl leading-none text-ink">{counts[i] === undefined ? "—" : format(counts[i] ?? 0)}</span>
              )}
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
        "group flex min-w-0 items-center gap-3 px-4 py-4 transition-colors hover:bg-paper/[0.04] sm:px-6",
        index % 2 === 1 && "border-l border-paper/[0.08]",
        index >= 2 && "border-t border-paper/[0.08] lg:border-t-0",
        index === 2 && "lg:border-l"
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-paper/[0.05] text-gold-light ring-1 ring-paper/[0.08] transition-colors group-hover:bg-gold group-hover:text-void">
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">{label}</span>
        <span className="g-metric mt-1 flex items-baseline gap-1.5 truncate text-lg leading-none text-paper">
          {value === undefined ? "—" : format(shown)}
          {unit && value !== undefined ? <span className="text-[11px] font-medium text-paper/45">{unit}</span> : null}
        </span>
      </span>
    </Link>
  );
}

/** Dark module hero: kicker + date, headline, blurb, actions, and a 4-up metric strip. */
export function ModuleHero({
  kicker,
  title,
  description,
  actions,
  metrics,
}: {
  kicker: string;
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  metrics: HeroMetricDef[];
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-void text-paper shadow-4">
      <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-50" />
      <div className="home-drift pointer-events-none absolute -right-24 -top-32 size-80 rounded-full bg-gold/20 blur-[100px]" />
      <div className="home-drift pointer-events-none absolute -bottom-40 left-1/3 size-72 rounded-full bg-gold-deep/20 blur-[110px]" />
      <div className="home-noise pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />

      <div className="relative flex flex-col gap-6 px-5 py-6 sm:px-7 sm:py-7 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 max-w-xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
              <span className="size-1.5 animate-pulse-soft rounded-full bg-gold" />
              {kicker}
            </span>
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-paper/40">{longDate()}</span>
          </div>
          <h1 className="g-display mt-3 text-[26px] leading-tight text-paper sm:text-[34px]">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-paper/55">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      <div className="relative grid grid-cols-2 border-t border-paper/[0.08] lg:grid-cols-4">
        {metrics.map((m, i) => (
          <HeroMetric key={m.label} {...m} index={i} />
        ))}
      </div>
    </section>
  );
}
