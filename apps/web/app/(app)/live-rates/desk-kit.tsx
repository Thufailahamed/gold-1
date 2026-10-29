"use client";

// Shared pieces for the Live Rates tool pages (pricing, alerts, exposure,
// drivers, records, share): the tool tabs, permission hook and small inputs.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { BellIcon, CoinsIcon, GaugeIcon, HistoryIcon, ScaleIcon, SendIcon, TrendingUpIcon } from "@/components/icons";

export const TOOLS = [
  { href: "/live-rates", label: "Board", icon: TrendingUpIcon, hint: "Live market" },
  { href: "/live-rates/pricing", label: "Pricing", icon: CoinsIcon, hint: "Suggested rates · import" },
  { href: "/live-rates/alerts", label: "Alerts", icon: BellIcon, hint: "Price watches" },
  { href: "/live-rates/exposure", label: "Exposure", icon: ScaleIcon, hint: "Position · gains" },
  { href: "/live-rates/drivers", label: "Drivers", icon: GaugeIcon, hint: "Drivers · calendar" },
  { href: "/live-rates/records", label: "Records", icon: HistoryIcon, hint: "Rate log · other shops" },
  { href: "/live-rates/share", label: "Share", icon: SendIcon, hint: "Card · TV · Gulf" },
] as const;

export function useMe() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const can = (p: string) => !!me.data && hasPermission(me.data.permissions, p);
  return { me, can };
}

export type AlertsData = {
  alerts: {
    id: string;
    kind: "PRICE_ABOVE" | "PRICE_BELOW" | "MOVE_PCT" | "BOARD_GAP";
    symbol: string | null;
    purityId: string | null;
    karat: string | null;
    threshold: number;
    note: string | null;
    isActive: boolean;
    isTripped: boolean;
    lastValue: number | null;
    lastCheckedAt: number | null;
    lastFiredAt: number | null;
    createdAt: number;
  }[];
  events: { id: string; alertId: string; firedAt: number; value: number; message: string; seen: boolean; kind: string; target: string | null }[];
  unseen: number;
};

export function useAlerts(enabled = true) {
  return useQuery({
    queryKey: ["market-alerts"],
    queryFn: () => api<AlertsData>("/api/v1/market-desk/alerts"),
    refetchInterval: 60_000,
    enabled,
  });
}

/** Tool switcher shown under each tool page's header. */
export function DeskTabs({ dark = true }: { dark?: boolean }) {
  const path = usePathname();
  const alerts = useAlerts();
  const unseen = alerts.data?.unseen ?? 0;
  return (
    <nav className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-thin">
      {TOOLS.map((t) => {
        const on = path === t.href;
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            title={t.hint}
            className={cn(
              "relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold transition-colors",
              dark
                ? on
                  ? "bg-paper text-void"
                  : "text-paper/60 hover:bg-paper/[0.08] hover:text-paper"
                : on
                  ? "bg-void text-gold-light"
                  : "text-ink-3 hover:bg-ink/[0.05] hover:text-ink"
            )}
          >
            <Icon size={13} />
            {t.label}
            {t.href === "/live-rates/alerts" && unseen > 0 ? (
              <span className="g-metric rounded-full bg-rose-500 px-1.5 text-[10px] font-bold leading-4 text-white">{unseen}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/* ---------------------------------------------------------------- formatting */

export const lkr = (n: number | null | undefined, dp?: number) => {
  if (n == null || !Number.isFinite(n)) return "—";
  const d = dp ?? (Math.abs(n) >= 1000 ? 0 : 2);
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};
export const signed = (n: number | null | undefined, dp = 2, suffix = "%") =>
  n == null || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(dp)}${suffix}`;
export const toneOf = (n: number | null | undefined, invert = false) =>
  n == null || n === 0 ? "text-ink-4" : (n > 0) !== invert ? "text-emerald-700" : "text-rose-700";
export const gramsOf = (mg: number) => (mg / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });
export const when = (t: number) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/* ---------------------------------------------------------------- inputs */

export const fieldCls =
  "g-metric h-8 w-full min-w-0 rounded-lg bg-paper px-2.5 text-[12.5px] text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)] transition-shadow placeholder:text-ink-5 focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_3px_rgba(205,168,83,0.24)] disabled:bg-bone/60 disabled:text-ink-4";

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-5">{label}</span>
      {children}
      {hint ? <span className="mt-0.5 block text-[10.5px] text-ink-5">{hint}</span> : null}
    </label>
  );
}

/** Numeric input that keeps the user's text while typing and reports a number. */
export function NumInput({
  value,
  onChange,
  suffix,
  disabled,
  step,
  className,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  disabled?: boolean;
  step?: string;
  className?: string;
  placeholder?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.\-]/g, ""))}
        inputMode="decimal"
        step={step}
        disabled={disabled}
        placeholder={placeholder}
        className={cn(fieldCls, suffix && "pr-10")}
      />
      {suffix ? <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10.5px] font-semibold text-ink-5">{suffix}</span> : null}
    </div>
  );
}

export const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

export const btnDark =
  "inline-flex h-8 items-center gap-1.5 rounded-lg bg-void px-3 text-[12px] font-semibold text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.3)] transition-colors hover:bg-void/85 disabled:cursor-not-allowed disabled:opacity-50";
export const btnSoft =
  "inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink/[0.05] px-3 text-[12px] font-semibold text-ink-2 transition-colors hover:bg-ink/[0.09] hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";

export function Stripe({ tone }: { tone: string }) {
  return <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full" style={{ background: tone }} aria-hidden />;
}

/** Tool tiles on the main board, so the desk pages are one click away. */
export function ToolStrip() {
  const alerts = useAlerts();
  const unseen = alerts.data?.unseen ?? 0;
  const armed = alerts.data?.alerts.filter((a) => a.isActive).length ?? 0;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {TOOLS.slice(1).map((t) => {
        const Icon = t.icon;
        const badge = t.href === "/live-rates/alerts" ? (unseen ? `${unseen} new` : armed ? `${armed} armed` : null) : null;
        return (
          <Link
            key={t.href}
            href={t.href}
            className="group relative flex items-center gap-2.5 overflow-hidden rounded-xl bg-paper px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)] transition-all hover:-translate-y-px hover:shadow-[inset_0_0_0_1px_rgba(168,138,62,0.35),0_10px_24px_-16px_rgba(16,32,27,0.4)]"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25)] transition-transform group-hover:scale-105">
              <Icon size={15} />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                {t.label}
                {badge ? (
                  <span className={cn("rounded-full px-1.5 text-[9.5px] font-bold leading-4", unseen ? "bg-rose-500 text-white" : "bg-emerald-600/10 text-emerald-700")}>{badge}</span>
                ) : null}
              </span>
              <span className="block truncate text-[10.5px] text-ink-4">{t.hint}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
