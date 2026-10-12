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
    <span className="flex items-center gap-2.5">
      <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-gold/30 via-gold/10 to-transparent shadow-[inset_0_0_0_1px_rgba(226,194,122,0.35),0_6px_18px_-6px_rgba(205,168,83,0.55)]">
        <GemIcon size={17} className="text-gold drop-shadow-[0_0_6px_rgba(226,194,122,0.6)]" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="g-display text-[16px] tracking-wide text-paper">
          Gold<span className="text-gold">OS</span>
        </span>
        <span className="mt-1.5 text-[9px] font-semibold uppercase tracking-[0.28em] text-gold/80">
          Console
        </span>
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
    <div className="relative shrink-0 px-3 pb-2">
      <div className="flex items-center gap-3 rounded-xl bg-gradient-to-br from-paper/[0.08] to-paper/[0.02] p-2.5 shadow-[inset_0_0_0_1px_rgba(246,245,240,0.09),inset_0_1px_0_rgba(255,255,255,0.08),0_10px_24px_-14px_rgba(0,0,0,0.6)]">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-gold/30 to-gold/10 text-gold shadow-[inset_0_0_0_1px_rgba(226,194,122,0.25)]">
          <Building2Icon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-paper">
            {branch?.name ?? "GoldOS Network"}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-paper/40">
            <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
            {branch ? branch.code : "HQ"} · Active
          </div>
        </div>
      </div>
    </div>
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
        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-200",
        active
          ? "bg-gradient-to-r from-gold/[0.22] via-gold/[0.08] to-transparent text-paper shadow-[inset_0_0_0_1px_rgba(226,194,122,0.22),inset_0_1px_0_rgba(255,255,255,0.06)] before:absolute before:-left-3 before:top-2.5 before:bottom-2.5 before:w-[3px] before:rounded-r-full before:bg-gold before:shadow-[0_0_12px_rgba(226,194,122,0.9)]"
          : "text-paper/55 hover:translate-x-0.5 hover:bg-paper/[0.06] hover:text-paper"
      )}
    >
      <span
        className={cn(
          "shrink-0 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:-rotate-6 group-hover:scale-125 group-active:rotate-0 group-active:scale-75 motion-reduce:transform-none motion-reduce:transition-none",
          active
            ? "scale-110 text-gold drop-shadow-[0_0_6px_rgba(226,194,122,0.55)]"
            : "text-paper/35 group-hover:text-gold group-hover:drop-shadow-[0_0_6px_rgba(226,194,122,0.5)]"
        )}
      >
        <item.icon size={16} />
      </span>
      <span className="flex-1 truncate">{item.label}</span>
      {badge ? (
        <span className="g-metric min-w-5 rounded-full bg-gradient-to-b from-gold to-gold/80 px-1.5 py-0.5 text-center text-[10px] font-bold text-ink shadow-[0_2px_8px_-2px_rgba(205,168,83,0.7)]">
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
    <aside className="relative flex h-full w-full shrink-0 select-none flex-col overflow-hidden bg-[linear-gradient(180deg,#0a3529_0%,#062a22_55%,#041f19_100%)] text-paper shadow-[inset_-1px_0_0_rgba(226,194,122,0.10)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(90%_100%_at_0%_0%,rgba(205,168,83,0.20),transparent_70%)]"
      />
      <div className="relative flex h-[72px] shrink-0 items-center justify-between px-5">
        <Link href="/dashboard" aria-label="GoldOS dashboard" onClick={onNavigate}>
          <GoldWordmark />
        </Link>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="flex size-8 items-center justify-center rounded-lg text-paper/50 transition-colors hover:bg-paper/10 hover:text-paper"
          >
            <XIcon size={18} />
          </button>
        ) : null}
      </div>

      <WorkspaceCard />

      <nav className="relative flex-1 space-y-6 overflow-y-auto px-3 py-4 scrollbar-thin" aria-label="Main">
        {SECTIONS.map((section) => {
          const visible = section.items.filter((i) => canSee(me, i));
          if (visible.length === 0) return null;
          return (
            <div key={section.title}>
              <div className="mb-2 flex items-center gap-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-gold/60">
                {section.title}
                <span className="h-px flex-1 bg-gradient-to-r from-gold/25 to-transparent" />
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

      <div className="relative shrink-0 space-y-3 border-t border-gold/15 bg-black/10 p-3">
        {footer.length > 0 ? (
          <div className="space-y-0.5">
            {footer.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={item.href === activeHref}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-3 rounded-xl bg-gradient-to-br from-paper/[0.08] to-paper/[0.02] p-2.5 shadow-[inset_0_0_0_1px_rgba(246,245,240,0.08)]">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#e2c27a] to-[#b8923f] font-display shadow-[0_4px_12px_-3px_rgba(205,168,83,0.6)] text-sm font-bold text-ink">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-paper" title={me.user.email}>
              {me.user.name}
            </div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-paper/40">{me.user.email}</div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-paper/40 transition-colors hover:bg-rose-500/15 hover:text-rose-400"
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
