"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { logout } from "@/lib/auth";
import { cn } from "@/lib/cn";
import {
  LayoutGridIcon,
  PackageIcon,
  ArchiveIcon,
  GemIcon,
  CoinsIcon,
  TruckIcon,
  Building2Icon,
  SettingsIcon,
  ScaleIcon,
  TrendingUpIcon,
  LogOutIcon,
  XIcon,
  GaugeIcon,
  HammerIcon,
  BookOpenIcon,
  SparklesIcon,
  ChevronRightIcon,
} from "./icons";

type IconCmp = (props: { size?: number | string; className?: string }) => React.ReactNode;

interface NavItem {
  href: string;
  label: string;
  icon: IconCmp;
  perm: string | null;
  anyPerm?: string[];
  /** Other route prefixes that belong to this entry, e.g. /pos for the sales dashboard. */
  also?: string[];
}

interface NavSection {
  title: string;
  items: NavItem[];
}

/** Routes reached through the Setup hub rather than their own sidebar entry. */
const SETUP_ROUTES = [
  "/categories",
  "/subcategories",
  "/designs",
  "/product-types",
  "/metal-types",
  "/stone-types",
  "/purities",
  "/gold-rates",
  "/suppliers",
  "/customers",
  "/branches",
  "/users",
  "/settings",
  "/audit",
  "/support",
];

// Kept to one entry per module on purpose: sub-pages are reached through each
// module's own tabs (ModuleNav) or the Setup hub.
const SECTIONS: NavSection[] = [
  {
    title: "Work",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutGridIcon, perm: null },
      {
        href: "/sales",
        label: "Sales",
        icon: GaugeIcon,
        perm: "sales:view",
        anyPerm: ["sales:create"],
        also: ["/pos", "/repairs"],
      },
      {
        href: "/old-gold",
        label: "Old Gold",
        icon: ScaleIcon,
        perm: "oldgold:view",
        anyPerm: ["oldgold:create", "oldgold:edit"],
      },
      { href: "/live-rates", label: "Live Rates", icon: TrendingUpIcon, perm: "masters:view" },
    ],
  },
  {
    title: "Stock",
    items: [
      { href: "/products", label: "Products", icon: PackageIcon, perm: "products:view", also: ["/scan"] },
      { href: "/inventory", label: "Inventory", icon: ArchiveIcon, perm: "products:view" },
      { href: "/purchases", label: "Purchasing", icon: TruckIcon, perm: "purchases:view" },
      { href: "/manufacturing", label: "Manufacturing", icon: HammerIcon, perm: "mfg:view", also: ["/custom-orders"] },
      { href: "/gold", label: "Gold", icon: CoinsIcon, perm: "gold:view" },
    ],
  },
  {
    title: "Money",
    items: [
      {
        href: "/accounts",
        label: "Accounts",
        icon: BookOpenIcon,
        perm: "accounts:view",
        also: ["/expenses", "/day-closing"],
      },
      {
        href: "/accounts/assistant",
        label: "Assistant",
        icon: SparklesIcon,
        perm: "accounts:view",
        anyPerm: ["accounts:manage"],
      },
      { href: "/analytics", label: "Reports", icon: TrendingUpIcon, perm: "branches:manage", also: ["/reports"] },
    ],
  },
];

/** Pinned below the module list. */
const FOOTER_ITEMS: NavItem[] = [
  { href: "/setup", label: "Setup", icon: SettingsIcon, perm: null, also: SETUP_ROUTES },
];

function canSee(me: MeData, i: NavItem) {
  if (!i.perm && !i.anyPerm) return true;
  return (
    (!!i.perm && hasPermission(me.permissions, i.perm)) ||
    (i.anyPerm ?? []).some((p) => hasPermission(me.permissions, p))
  );
}

export function GoldWordmark() {
  return (
    <span className="flex items-center gap-3">
      <span className="sb-gem relative flex size-9 items-center justify-center rounded-[11px]">
        <GemIcon size={16} className="text-[#022c22]" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="g-display text-[16px] font-semibold tracking-[-0.01em] text-white">
          Gold<span className="sb-mint-text">OS</span>
        </span>
        <span className="mt-1.5 text-[8.5px] font-medium uppercase tracking-[0.34em] text-emerald-200/40">Console</span>
      </span>
    </span>
  );
}

function WorkspaceCard() {
  const [branch, setBranch] = useState<{ name: string; code: string } | null>(null);

  useEffect(() => {
    api<{ rows: { id: string; name: string; code: string }[] }>("/api/v1/branches?limit=100")
      .then((d) => {
        const saved = document.cookie
          .split("; ")
          .find((c) => c.startsWith("goldos_branch="))
          ?.split("=")[1];
        setBranch(d.rows.find((b) => b.id === saved) ?? d.rows[0] ?? null);
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="relative shrink-0 px-3.5 pb-2 pt-1">
      <div className="sb-card flex items-center gap-3 px-3 py-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-emerald-300/[0.1] text-emerald-200 shadow-[inset_0_0_0_1px_rgba(167,243,208,0.14)]">
          <Building2Icon size={14} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold text-white">{branch?.name ?? "GoldOS Network"}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-medium text-emerald-200/45">
            <span className="relative flex size-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-300/60" />
              <span className="relative size-1.5 rounded-full bg-emerald-300" />
            </span>
            <span className="font-mono uppercase tracking-wider">{branch ? branch.code : "HQ"}</span>
            <span className="text-emerald-200/25">·</span>
            Open
          </div>
        </div>
      </div>
    </div>
  );
}

type LiveKarat = { purityId: string; karat: string; purity: number; lkrPerGram: number; change24hPct: number | null };

/** Today's gold at a glance; shares its cache with the Live Rates page. */
function RateStrip({ onNavigate }: { onNavigate?: () => void }) {
  const live = useQuery({
    queryKey: ["market-live"],
    queryFn: () => api<{ stale: boolean; karats: LiveKarat[] }>("/api/v1/market/live"),
    staleTime: 60_000,
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
  });
  const ks = live.data?.karats ?? [];
  const k24 = ks.find((k) => k.purity >= 0.999) ?? ks[0];
  const k22 = ks.find((k) => k.karat === "22K");
  const shown = [k24, k22].filter((k, i, a): k is LiveKarat => !!k && a.indexOf(k) === i);
  if (live.isError || (!live.isLoading && !shown.length)) return null;
  return (
    <Link href="/live-rates" onClick={onNavigate} className="sb-card group block px-3 py-2.5 transition-transform duration-300 hover:-translate-y-px">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.2em] text-emerald-200/45">
          <span className={cn("size-1.5 rounded-full", live.data?.stale ? "bg-emerald-200/25" : "animate-pulse-soft bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.9)]")} />
          Live gold
        </span>
        <span className="flex items-center gap-0.5 text-[9.5px] font-medium text-emerald-200/35 transition-colors group-hover:text-emerald-200">
          LKR/g
          <ChevronRightIcon size={11} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 divide-x divide-emerald-200/[0.08]">
        {live.isLoading
          ? [0, 1].map((i) => <span key={i} className={cn("h-8 animate-pulse rounded-md bg-emerald-300/[0.07]", i ? "ml-3" : "mr-3")} />)
          : shown.map((k, i) => {
              const p = k.change24hPct;
              return (
                <div key={k.purityId} className={cn("min-w-0 leading-none", i ? "pl-3" : "pr-3")}>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-semibold text-emerald-300">{k.karat}</span>
                    {p != null && p !== 0 ? (
                      <span className={cn("g-metric text-[9.5px] font-medium", p > 0 ? "text-emerald-300" : "text-emerald-100/40")}>
                        {p > 0 ? "+" : "−"}
                        {Math.abs(p).toFixed(1)}%
                      </span>
                    ) : null}
                  </div>
                  <div className="g-metric mt-1.5 truncate text-[15px] font-semibold tracking-tight text-white">
                    {Math.round(k.lkrPerGram).toLocaleString("en-US")}
                  </div>
                </div>
              );
            })}
      </div>
    </Link>
  );
}

function NavLink({
  item,
  active,
  badge,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  badge?: number;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-[38px] items-center gap-3 rounded-[11px] px-3 text-[13.5px] transition-all duration-200",
        active
          ? "sb-link-active font-semibold text-white"
          : "font-medium text-emerald-50/55 hover:bg-emerald-200/[0.045] hover:text-emerald-50"
      )}
    >
      {active ? (
        <span
          aria-hidden
          className="absolute -left-3.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-emerald-200 to-emerald-400 shadow-[0_0_14px_2px_rgba(52,211,153,0.6)]"
        />
      ) : null}
      <item.icon
        size={16}
        className={cn(
          "shrink-0 transition-all duration-200",
          active
            ? "text-emerald-300 drop-shadow-[0_0_8px_rgba(110,231,183,0.7)]"
            : "text-emerald-200/40 group-hover:text-emerald-200/80"
        )}
      />
      <span className="flex-1 truncate">{item.label}</span>
      {badge ? (
        <span className="g-metric min-w-5 rounded-full bg-emerald-300 px-1.5 py-0.5 text-center text-[10px] font-bold text-[#022c22]">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
}

export function AppSidebar({
  me,
  onNavigate,
  onClose,
}: {
  me: MeData;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const initial = (me.user.name || me.user.email || "G").charAt(0).toUpperCase();
  const footer = FOOTER_ITEMS.filter((i) => canSee(me, i));
  const seesRates = hasPermission(me.permissions, "masters:view");

  // Nested routes (/inventory and /inventory/counts) both prefix-match; only
  // the most specific entry is the current page.
  const activeHref = [...SECTIONS.flatMap((s) => s.items), ...FOOTER_ITEMS]
    .flatMap((i) => [i.href, ...(i.also ?? [])].map((p) => ({ p, href: i.href })))
    .filter(({ p }) => pathname === p || pathname.startsWith(`${p}/`))
    .sort((a, b) => b.p.length - a.p.length)[0]?.href;

  async function onSignOut() {
    await logout().catch(() => undefined);
    window.location.href = "/login";
  }

  return (
    <aside className="sb-shell relative flex h-full w-full shrink-0 select-none flex-col overflow-hidden text-white">
      <div aria-hidden className="home-noise pointer-events-none absolute inset-0" />

      <div className="relative flex h-16 shrink-0 items-center justify-between px-5">
        <Link href="/dashboard" aria-label="GoldOS dashboard" onClick={onNavigate}>
          <GoldWordmark />
        </Link>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="flex size-8 items-center justify-center rounded-lg text-emerald-100/50 transition-colors hover:bg-emerald-200/10 hover:text-white"
          >
            <XIcon size={18} />
          </button>
        ) : null}
      </div>

      <WorkspaceCard />

      <nav
        className="relative flex-1 space-y-5 overflow-y-auto px-3.5 pb-4 pt-3 scrollbar-thin [mask-image:linear-gradient(180deg,transparent,#000_14px,#000_calc(100%-20px),transparent)]"
        aria-label="Main"
      >
        {SECTIONS.map((section) => {
          const visible = section.items.filter((i) => canSee(me, i));
          if (visible.length === 0) return null;
          return (
            <div key={section.title}>
              <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-200/30">
                {section.title}
              </div>
              <div className="space-y-0.5">
                {visible.map((item) => (
                  <NavLink key={item.href} item={item} active={item.href === activeHref} onNavigate={onNavigate} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="relative shrink-0 space-y-2.5 px-3.5 pb-3.5">
        <div className="sb-rule -mx-3.5 mb-3" />
        {seesRates ? <RateStrip onNavigate={onNavigate} /> : null}
        {footer.length > 0 ? (
          <div className="space-y-0.5">
            {footer.map((item) => (
              <NavLink key={item.href} item={item} active={item.href === activeHref} onNavigate={onNavigate} />
            ))}
          </div>
        ) : null}
        <div className="sb-card flex items-center gap-3 p-2 pr-2.5">
          <div className="relative shrink-0">
            <div className="sb-gem flex size-9 items-center justify-center rounded-[10px] font-display text-[14px] font-bold text-[#022c22]">
              {initial}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-300 ring-2 ring-[#031b15]" aria-hidden />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-semibold text-white" title={me.user.email}>
              {me.user.name}
            </div>
            <div className="mt-1 truncate text-[10.5px] text-emerald-200/40">{me.user.email}</div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-emerald-200/40 transition-colors hover:bg-emerald-200/[0.08] hover:text-emerald-200"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOutIcon size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}
