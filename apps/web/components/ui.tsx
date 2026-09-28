import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  InboxIcon,
  XIcon,
} from "./icons";

type Maybe<T> = T | undefined;

/* ---------------------------------------------------------------- Page layout */

export function Page({ children, className }: { children: ReactNode; className?: Maybe<string> }) {
  return <div className={cn("mx-auto max-w-7xl space-y-6 pb-16 animate-fade-in", className)}>{children}</div>;
}

export function PageHeader({
  kicker,
  title,
  description,
  actions,
  back,
  meta,
  className,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: Maybe<{ href: string; label: string }>;
  meta?: ReactNode;
  className?: Maybe<string>;
}) {
  return (
    <header className={cn("flex flex-col gap-5 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0 max-w-3xl">
        {back && (
          <Link
            href={back.href}
            className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-ink-4 transition-colors hover:text-ink"
          >
            <ArrowLeftIcon size={13} />
            {back.label}
          </Link>
        )}
        {kicker && <div className="g-kicker">{kicker}</div>}
        <h1 className="mt-1.5 g-display text-3xl text-ink text-balance sm:text-4xl">{title}</h1>
        {description && <p className="mt-2.5 max-w-2xl text-sm text-ink-3 text-pretty">{description}</p>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 md:shrink-0">{actions}</div>}
    </header>
  );
}

/* ---------------------------------------------------------------- Hero band */

export type HeroStat = { label: ReactNode; value: ReactNode };

const HERO_STAT_COLS: Record<number, string> = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
};

/** Button classes for use inside the dark Hero. */
export const heroBtnPrimary =
  "g-btn h-10 bg-gold px-4 text-sm text-ink transition-colors hover:bg-gold-light";
export const heroBtnGhost =
  "g-btn h-10 px-4 text-sm text-paper shadow-[inset_0_0_0_1px_rgba(250,250,249,0.25)] transition-colors hover:bg-paper/10";

/**
 * Dark page hero: kicker + display title + description on the left, actions on
 * the right, and an optional stat strip along the bottom. `children` renders
 * between the header row and the stat strip (e.g. a scan input or spotlight).
 */
export function Hero({
  kicker,
  title,
  description,
  actions,
  back,
  meta,
  stats,
  note,
  children,
  className,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: Maybe<{ href: string; label: string }>;
  meta?: ReactNode;
  stats?: ReadonlyArray<HeroStat>;
  /** Dashed mono notice strip at the bottom of the hero. */
  note?: ReactNode;
  children?: ReactNode;
  className?: Maybe<string>;
}) {
  return (
    <section
      className={cn("relative overflow-hidden rounded-xl bg-void p-6 text-paper sm:p-8", className)}
    >
      <div className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-gold/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 left-1/3 size-56 rounded-full bg-gold/10 blur-3xl" />
      <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 max-w-2xl">
          {back && (
            <Link
              href={back.href}
              className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-paper/50 transition-colors hover:text-paper"
            >
              <ArrowLeftIcon size={13} />
              {back.label}
            </Link>
          )}
          {kicker && (
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">
              <span className="size-1.5 rounded-full bg-gold animate-pulse-soft" />
              {kicker}
            </div>
          )}
          <h1 className="g-display mt-3 text-3xl text-paper text-balance sm:text-4xl">{title}</h1>
          {description && (
            <p className="mt-2.5 max-w-md text-sm text-paper/60 text-pretty">{description}</p>
          )}
          {meta && <div className="mt-3.5 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 md:shrink-0">{actions}</div>}
      </div>
      {children}
      {stats && stats.length > 0 && (
        <div
          className={cn(
            "relative mt-7 grid grid-cols-2 gap-3 border-t border-paper/10 pt-5",
            HERO_STAT_COLS[Math.min(stats.length, 4)]
          )}
        >
          {stats.map((s, i) => (
            <div key={i} className="min-w-0">
              <div className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">
                {s.label}
              </div>
              <div className="g-metric mt-1.5 truncate text-lg text-paper">{s.value}</div>
            </div>
          ))}
        </div>
      )}
      {note && (
        <div className="relative mt-6 rounded-lg border border-dashed border-paper/15 px-4 py-3 text-center font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-paper/40">
          {note}
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- Cards */

export function Card({
  children,
  className,
  padded = true,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children?: ReactNode; padded?: Maybe<boolean> }) {
  return (
    <div {...rest} className={cn("g-surface", padded && "p-5 sm:p-6", className)}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: Maybe<string>;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-bone text-ink-3">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="font-sans text-base font-semibold tracking-normal text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-ink-4 text-pretty">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A card with a header row and a divided body. */
export function Panel({
  title,
  description,
  actions,
  icon,
  children,
  footer,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: Maybe<string>;
  bodyClassName?: Maybe<string>;
}) {
  return (
    <section className={cn("g-surface overflow-hidden", className)}>
      <div className="px-5 pt-5 pb-4 sm:px-6">
        <CardHeader title={title} description={description} actions={actions} icon={icon} />
      </div>
      <div className={cn("border-t border-ink/[0.07] px-5 py-5 sm:px-6", bodyClassName)}>{children}</div>
      {footer && <div className="border-t border-ink/[0.07] bg-bone/60 px-5 py-3 sm:px-6">{footer}</div>}
    </section>
  );
}

/** Small uppercase label for grouping content inside a card or page. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: Maybe<string> }) {
  return (
    <div className={cn("text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4", className)}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- Stats */

export function StatGrid({
  children,
  className,
  cols = 4,
}: {
  children: ReactNode;
  className?: Maybe<string>;
  cols?: Maybe<2 | 3 | 4 | 5>;
}) {
  const colClass = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
    5: "sm:grid-cols-2 lg:grid-cols-5",
  }[cols];
  return <div className={cn("grid gap-4", colClass, className)}>{children}</div>;
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
  status,
  href,
  loading,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  /** Colours the value. Use sparingly: only when the number itself signals state. */
  tone?: Maybe<"neutral" | "success" | "warning" | "danger">;
  /** Optional pill beside the value (e.g. <Pill tone="danger">Elevated</Pill>). */
  status?: ReactNode;
  href?: Maybe<string>;
  loading?: Maybe<boolean>;
  className?: Maybe<string>;
}) {
  const valueTone = {
    neutral: "text-ink",
    success: "text-emerald-700",
    warning: "text-amber-700",
    danger: "text-rose-700",
  }[tone];

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-ink-3">{label}</span>
        {icon && (
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg bg-bone text-ink-3 transition-colors",
              href && "group-hover:bg-ink group-hover:text-gold"
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <div>
        {loading ? (
          <Skeleton className="h-9 w-24" />
        ) : (
          <div className="flex flex-wrap items-baseline gap-2.5">
            <span className={cn("g-metric text-3xl leading-none sm:text-4xl", valueTone)}>{value}</span>
            {status}
          </div>
        )}
        {sub && <div className="mt-2 truncate text-xs text-ink-4">{sub}</div>}
      </div>
    </>
  );

  const cls = cn("g-surface flex flex-col justify-between gap-5 p-5", className);
  if (href) {
    return (
      <Link
        href={href}
        className={cn(cls, "group transition-all duration-240 ease-brand hover:-translate-y-0.5 hover:shadow-2")}
      >
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}

/* ---------------------------------------------------------------- Pills & status */

export type PillTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "brand"
  | "dark"
  | "ghost";

const PILL_TONES: Record<PillTone, { cls: string; dot: string }> = {
  neutral: { cls: "bg-ink/[0.06] text-ink-3", dot: "bg-ink-4" },
  ghost: {
    cls: "bg-paper/10 text-paper/80 shadow-[inset_0_0_0_1px_rgba(250,250,249,0.14)]",
    dot: "bg-gold",
  },
  success: { cls: "bg-emerald-700/10 text-emerald-700", dot: "bg-emerald-600" },
  warning: { cls: "bg-amber-600/15 text-amber-700", dot: "bg-amber-600" },
  danger: { cls: "bg-rose-700/10 text-rose-700", dot: "bg-rose-600" },
  info: { cls: "bg-gold/15 text-gold-dark", dot: "bg-gold" },
  brand: { cls: "bg-gold-soft text-ink", dot: "bg-gold-dark" },
  dark: { cls: "bg-ink text-paper", dot: "bg-gold" },
};

export function Pill({
  children,
  tone = "neutral",
  dot = false,
  icon,
  className,
  title,
}: {
  children: ReactNode;
  tone?: Maybe<PillTone>;
  dot?: Maybe<boolean>;
  icon?: ReactNode;
  className?: Maybe<string>;
  title?: Maybe<string>;
}) {
  const t = PILL_TONES[tone];
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-5",
        t.cls,
        className
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", t.dot)} aria-hidden />}
      {icon}
      {children}
    </span>
  );
}

/**
 * Maps common workflow statuses to a pill tone. Unknown statuses fall back to
 * neutral, so it is safe to pass any string straight from the API.
 */
export function statusTone(status: string | null | undefined): PillTone {
  const s = (status ?? "").toLowerCase();
  if (/(fail|error|reject|cancel|disput|suspend|block|ban|revok|overdue|breach|critical|declin|fraud|expired|lost|void|melt)/.test(s))
    return "danger";
  if (/(pend|review|await|hold|queue|draft|warn|processing|progress|open|retry|partial|unverified|flag|repair|manufacturing|reserved)/.test(s))
    return "warning";
  if (/(success|succeed|complete|deliver|paid|approv|verif|active|resolv|settled|healthy|ok|enabled|live|accept|confirm|sent|published|clear|in_stock|sold)/.test(s))
    return "success";
  if (/(transit|ship|prepar|dispatch|scheduled|refund|return|transfer)/.test(s)) return "info";
  return "neutral";
}

export function StatusPill({
  status,
  label,
  className,
}: {
  status: string | null | undefined;
  label?: ReactNode;
  className?: Maybe<string>;
}) {
  const text = label ?? (status ?? "-").replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  return (
    <Pill tone={statusTone(status)} dot className={className}>
      {text}
    </Pill>
  );
}

/* ---------------------------------------------------------------- Tabs & toolbars */

export interface TabItem<K extends string = string> {
  key: K;
  label: ReactNode;
  count?: number | null;
  icon?: ReactNode;
}

export function Tabs<K extends string>({
  items,
  value,
  onChange,
  className,
  ariaLabel = "Sections",
}: {
  items: ReadonlyArray<TabItem<K>>;
  value: K;
  onChange: (key: K) => void;
  className?: Maybe<string>;
  ariaLabel?: Maybe<string>;
}) {
  return (
    <div className={cn("-mx-1 overflow-x-auto scrollbar-thin", className)}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="mx-1 flex min-w-max gap-1 rounded-2xl bg-ink/[0.05] p-1.5"
      >
        {items.map((t) => {
          const active = t.key === value;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.key)}
              className={cn(
                "inline-flex h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-[13px] font-medium transition-all duration-200 ease-brand",
                active ? "bg-ink text-paper shadow-pop" : "text-ink-4 hover:text-ink"
              )}
            >
              {t.icon && (
                <span className={active ? "text-gold" : "text-ink-4"}>{t.icon}</span>
              )}
              {t.label}
              {t.count != null && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] font-semibold leading-4 num-tabular",
                    active ? "bg-paper/15 text-paper" : "bg-ink/10 text-ink-3"
                  )}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A single row that holds search / filters on the left and actions on the right. */
export function Toolbar({
  children,
  actions,
  className,
}: {
  children?: ReactNode;
  actions?: ReactNode;
  className?: Maybe<string>;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Class string for native <input>/<select> controls placed in toolbars and forms. */
export const controlClass =
  "h-10 rounded-lg bg-paper px-3 text-sm text-ink placeholder:text-ink-5 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.14)] transition-shadow duration-200 focus:outline-none focus:shadow-[inset_0_0_0_1px_#1c1917,0_0_0_3px_rgba(201,162,39,0.3)] disabled:cursor-not-allowed disabled:opacity-60";

/** Smaller variant for dense toolbars. */
export const controlSmClass =
  "h-9 rounded-lg bg-paper px-3 text-sm text-ink placeholder:text-ink-5 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.14)] transition-shadow duration-200 focus:outline-none focus:shadow-[inset_0_0_0_1px_#1c1917,0_0_0_3px_rgba(201,162,39,0.3)] disabled:cursor-not-allowed disabled:opacity-60";

/* ---------------------------------------------------------------- Buttons */

export function ButtonPrimary({
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) {
  return (
    <button {...rest} className={cn("g-btn g-btn-primary h-10 px-4 text-sm", className)}>
      {children}
    </button>
  );
}

export function ButtonSecondary({
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) {
  return (
    <button {...rest} className={cn("g-btn g-btn-secondary h-10 px-4 text-sm", className)}>
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- Tables */

/**
 * Wraps a <table className="g-table"> in a card with optional header and
 * footer (pagination). Horizontal overflow scrolls inside the card.
 */
export function TableCard({
  title,
  description,
  actions,
  icon,
  toolbar,
  footer,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: Maybe<string>;
}) {
  const hasHeader = Boolean(title || actions || icon);
  return (
    <section className={cn("g-surface overflow-hidden", className)}>
      {hasHeader && (
        <div className="px-5 pt-5 pb-4 sm:px-6">
          <CardHeader title={title} description={description} actions={actions} icon={icon} />
        </div>
      )}
      {toolbar && <div className={cn("px-5 pb-4 sm:px-6", !hasHeader && "pt-4")}>{toolbar}</div>}
      <div className="overflow-x-auto scrollbar-thin">{children}</div>
      {footer && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/[0.07] px-5 py-3 text-xs text-ink-4 sm:px-6">
          {footer}
        </div>
      )}
    </section>
  );
}

/** Table footer pagination: "Showing x–y of n" + prev/next controls. */
export function Pager({
  page,
  onChange,
  pageSize,
  count,
  total,
  unit = "rows",
  className,
}: {
  page: number;
  onChange: (page: number) => void;
  pageSize: number;
  /** Rows on the current page. */
  count: number;
  total: number;
  unit?: Maybe<string>;
  className?: Maybe<string>;
}) {
  const from = count === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = (page - 1) * pageSize + count;
  const btn =
    "g-btn g-btn-secondary h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <>
      <span className="num-tabular">
        {total === 0 ? `No ${unit}` : `Showing ${from}–${to} of ${total.toLocaleString("en-US")} ${unit}`}
      </span>
      <div className={cn("flex items-center gap-2", className)}>
        <button disabled={page <= 1} onClick={() => onChange(page - 1)} className={btn}>
          Prev
        </button>
        <span className="min-w-14 text-center num-tabular text-ink-3">Page {page}</span>
        <button disabled={count < pageSize} onClick={() => onChange(page + 1)} className={btn}>
          Next
        </button>
      </div>
    </>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: Maybe<number>; cols?: Maybe<number> }) {
  return (
    <div className="divide-y divide-ink/[0.06]">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-6 px-6 py-4">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn("h-4", c === 0 ? "w-40" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Cell content: a primary line with an optional muted secondary line. */
export function CellStack({
  primary,
  secondary,
  mono,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  mono?: Maybe<boolean>;
}) {
  return (
    <div className="min-w-0">
      <div className={cn("truncate font-medium text-ink", mono && "font-mono text-xs")}>{primary}</div>
      {secondary && <div className="mt-0.5 truncate text-xs text-ink-4">{secondary}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- Detail lists */

export function DetailList({
  items,
  columns = 1,
  className,
}: {
  items: Array<{ label: ReactNode; value: ReactNode; key?: Maybe<string> }>;
  columns?: Maybe<1 | 2 | 3>;
  className?: Maybe<string>;
}) {
  const colClass = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3" }[columns];
  return (
    <dl className={cn("grid gap-x-8 gap-y-4", colClass, className)}>
      {items.map((it, i) => (
        <div key={it.key ?? i} className="min-w-0">
          <dt className="text-xs font-medium text-ink-4">{it.label}</dt>
          <dd className="mt-1 break-words text-sm text-ink">{it.value ?? "-"}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------------------------------------------------------- Feedback */

export function Skeleton({ className }: { className?: Maybe<string> }) {
  return <div className={cn("rounded-md bg-mist/70 animate-pulse", className)} aria-hidden />;
}

export function EmptyBlock({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: Maybe<string>;
}) {
  return (
    <div
      className={cn(
        "m-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-ink/15 bg-bone/40 px-6 py-14 text-center sm:m-5",
        className
      )}
    >
      <span className="mb-4 flex size-12 items-center justify-center rounded-xl bg-paper text-ink-4 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.08)]">
        {icon ?? <InboxIcon size={22} />}
      </span>
      <h3 className="font-sans text-base font-semibold tracking-normal text-ink">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-ink-4 text-pretty">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: Maybe<"info" | "success" | "warning" | "danger">;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: Maybe<string>;
}) {
  const cfg = {
    info: {
      cls: "bg-gold/[0.07] shadow-[inset_0_0_0_1px_rgba(168,134,27,0.22)]",
      icon: <AlertCircleIcon size={16} className="text-gold-dark" />,
    },
    success: {
      cls: "bg-emerald-700/[0.07] shadow-[inset_0_0_0_1px_rgba(4,120,87,0.22)]",
      icon: <CheckCircleIcon size={16} className="text-emerald-700" />,
    },
    warning: {
      cls: "bg-amber-600/[0.08] shadow-[inset_0_0_0_1px_rgba(180,83,9,0.25)]",
      icon: <AlertCircleIcon size={16} className="text-amber-700" />,
    },
    danger: {
      cls: "bg-rose-700/[0.07] shadow-[inset_0_0_0_1px_rgba(190,18,60,0.25)]",
      icon: <AlertCircleIcon size={16} className="text-rose-700" />,
    },
  }[tone];
  return (
    <div
      className={cn("flex items-start gap-3 rounded-xl p-4 text-ink", cfg.cls, className)}
      role={tone === "danger" ? "alert" : undefined}
    >
      <span className="mt-0.5 shrink-0">{cfg.icon}</span>
      <div className="min-w-0 flex-1 text-sm">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn("text-ink-3", title && "mt-0.5")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- Modal */

/**
 * Centered floating dialog with backdrop blur, kicker/title header and an
 * optional Cancel/Confirm footer. Wrap plain content or a <form> in children.
 */
export function Modal({
  title,
  kicker,
  onClose,
  onSubmit,
  submitLabel = "Save",
  pending = false,
  submitDisabled = false,
  danger = false,
  wide = false,
  footer = true,
  children,
}: {
  title: ReactNode;
  kicker?: ReactNode;
  onClose: () => void;
  onSubmit?: () => void;
  submitLabel?: Maybe<string>;
  pending?: Maybe<boolean>;
  submitDisabled?: Maybe<boolean>;
  /** Confirm button turns rose for destructive actions. */
  danger?: Maybe<boolean>;
  wide?: Maybe<boolean>;
  /** Set false to render your own footer buttons. */
  footer?: Maybe<boolean>;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={cn(
          "g-floating max-h-[90vh] w-full animate-fade-in space-y-4 overflow-y-auto p-6 scrollbar-thin",
          wide ? "max-w-2xl" : "max-w-md"
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            {kicker ? <div className="g-kicker">{kicker}</div> : null}
            <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-ink">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-ink-4 transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <XIcon size={16} />
          </button>
        </div>
        {children}
        {footer && onSubmit ? (
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="g-btn g-btn-secondary h-10 px-4 text-sm">
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={pending || submitDisabled}
              className={cn(
                "g-btn h-10 px-4 text-sm",
                danger
                  ? "bg-rose-700 text-paper hover:bg-rose-800"
                  : "g-btn-primary"
              )}
            >
              {pending ? "Saving…" : submitLabel}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Misc */

/** Inline "View all" style link for card headers. */
export function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-xs font-medium text-gold-dark transition-colors hover:text-ink"
    >
      {children}
      <ArrowRightIcon size={12} />
    </Link>
  );
}
