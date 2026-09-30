"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PLATFORM_PERMISSIONS as P, PLATFORM_ROLES } from "@goldos/shared";
import { cn } from "@/lib/cn";
import { can, papi, type PlatformMe } from "@/lib/platform";
import {
  AlertCircleIcon,
  Building2Icon,
  ChevronDownIcon,
  CoinsIcon,
  FlagIcon,
  GemIcon,
  HistoryIcon,
  KeyIcon,
  LayersIcon,
  LayoutGridIcon,
  LifeBuoyIcon,
  LogOutIcon,
  MegaphoneIcon,
  MenuIcon,
  ServerIcon,
  SettingsIcon,
  ShieldIcon,
  UsersIcon,
  XIcon,
} from "@/components/icons";

type IconCmp = (props: { size?: number | string; className?: string }) => ReactNode;
type NavItem = { href: string; label: string; icon: IconCmp; perm: string | null };

const SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  { title: "Overview", items: [{ href: "/platform", label: "Dashboard", icon: LayoutGridIcon, perm: P.TENANTS_VIEW }] },
  {
    title: "Customers",
    items: [
      { href: "/platform/tenants", label: "Accounts", icon: Building2Icon, perm: P.TENANTS_VIEW },
      { href: "/platform/support", label: "Support desk", icon: LifeBuoyIcon, perm: P.SUPPORT_VIEW },
    ],
  },
  {
    title: "Revenue",
    items: [
      { href: "/platform/billing", label: "Billing", icon: CoinsIcon, perm: P.BILLING_VIEW },
      { href: "/platform/plans", label: "Plans & pricing", icon: LayersIcon, perm: P.TENANTS_VIEW },
    ],
  },
  {
    title: "Product",
    items: [
      { href: "/platform/flags", label: "Feature flags", icon: FlagIcon, perm: P.TENANTS_VIEW },
      { href: "/platform/announcements", label: "Announcements", icon: MegaphoneIcon, perm: P.TENANTS_VIEW },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/platform/team", label: "Team", icon: UsersIcon, perm: P.ADMINS_VIEW },
      { href: "/platform/audit", label: "Audit log", icon: HistoryIcon, perm: P.AUDIT_VIEW },
      { href: "/platform/system", label: "System health", icon: ServerIcon, perm: P.SYSTEM_VIEW },
      { href: "/platform/settings", label: "Settings", icon: SettingsIcon, perm: P.SYSTEM_VIEW },
    ],
  },
];

export function PlatformWordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-gold/15 shadow-[inset_0_0_0_1px_rgba(201,162,39,0.35)]">
        <GemIcon size={16} className="text-gold" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="g-display text-[15px] tracking-wide text-paper">
          Gold<span className="text-gold">OS</span>
        </span>
        <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-gold">Platform admin</span>
      </span>
    </span>
  );
}

function roleLabel(role: string): string {
  return (PLATFORM_ROLES as Record<string, { label: string }>)[role]?.label ?? role;
}

async function signOut() {
  await papi("/auth/logout", { method: "POST" }).catch(() => undefined);
  window.location.href = "/platform/login";
}

function Sidebar({ me, onNavigate, onClose }: { me: PlatformMe; onNavigate?: () => void; onClose?: () => void }) {
  const pathname = usePathname();
  const activeHref = SECTIONS.flatMap((s) => s.items.map((i) => i.href))
    .filter((h) => pathname === h || (h !== "/platform" && pathname.startsWith(`${h}/`)))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <aside className="flex h-full w-full select-none flex-col bg-void text-paper">
      <div className="flex h-16 shrink-0 items-center justify-between px-5">
        <Link href="/platform" onClick={onNavigate} aria-label="Platform dashboard">
          <PlatformWordmark />
        </Link>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="flex size-8 items-center justify-center rounded-lg text-paper/50 hover:bg-paper/10 hover:text-paper"
          >
            <XIcon size={18} />
          </button>
        ) : null}
      </div>

      <div className="shrink-0 px-3 pb-2">
        <div className="flex items-center gap-3 rounded-xl bg-paper/[0.04] p-2.5 shadow-[inset_0_0_0_1px_rgba(250,250,249,0.07)]">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gold/15 text-gold">
            <ShieldIcon size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-paper">{me.company} control plane</div>
            <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-paper/40">
              <span className={cn("size-1 rounded-full", me.maintenance ? "bg-amber-400" : "bg-emerald-400")} />
              {me.maintenance ? "Maintenance on" : "All systems normal"}
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4 scrollbar-thin" aria-label="Platform">
        {SECTIONS.map((section) => {
          const visible = section.items.filter((i) => !i.perm || can(me, i.perm));
          if (visible.length === 0) return null;
          return (
            <div key={section.title}>
              <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/30">{section.title}</div>
              <div className="space-y-0.5">
                {visible.map((item) => {
                  const active = item.href === activeHref;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-150",
                        active
                          ? "bg-paper/[0.09] text-paper before:absolute before:-left-3 before:bottom-2 before:top-2 before:w-[3px] before:rounded-r-full before:bg-gold"
                          : "text-paper/55 hover:bg-paper/[0.05] hover:text-paper"
                      )}
                    >
                      <span className={cn("shrink-0", active ? "text-gold" : "text-paper/35 group-hover:text-paper/75")}>
                        <item.icon size={16} />
                      </span>
                      <span className="flex-1 truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-paper/[0.07] p-3">
        <div className="flex items-center gap-3 rounded-xl bg-paper/[0.04] p-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gold font-display text-sm font-bold text-ink">
            {(me.admin.name || me.admin.email).charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-paper">{me.admin.name}</div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-paper/40">{roleLabel(me.admin.role)}</div>
          </div>
          <button
            type="button"
            onClick={signOut}
            title="Sign out"
            aria-label="Sign out"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-paper/40 transition-colors hover:bg-rose-500/15 hover:text-rose-400"
          >
            <LogOutIcon size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function StaffMenu({ me }: { me: PlatformMe }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const initials = (me.admin.name || me.admin.email).slice(0, 2).toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn("flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-ink/5", open && "bg-ink/5")}
      >
        <span className="flex size-8 items-center justify-center rounded-lg bg-ink font-mono text-[11px] font-bold text-gold shadow-pop">{initials}</span>
        <span className="hidden max-w-[10rem] truncate text-sm font-medium text-ink sm:block">{me.admin.name}</span>
        <ChevronDownIcon size={14} className={cn("hidden text-ink-4 transition-transform sm:block", open && "rotate-180")} />
      </button>
      {open ? (
        <div role="menu" className="g-floating absolute right-0 z-40 mt-2 w-72 animate-fade-in overflow-hidden">
          <div className="border-b border-ink/[0.07] px-4 py-3.5">
            <div className="truncate text-sm font-semibold text-ink">{me.admin.name}</div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-ink-4">{me.admin.email}</div>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-4">
              <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 font-semibold text-ink-3">{roleLabel(me.admin.role)}</span>
              {me.admin.mfa_enabled ? (
                <span className="rounded-full bg-emerald-700/10 px-2 py-0.5 font-semibold text-emerald-700">2FA on</span>
              ) : (
                <span className="rounded-full bg-amber-600/15 px-2 py-0.5 font-semibold text-amber-700">2FA off</span>
              )}
            </div>
          </div>
          <div className="p-1.5">
            <Link
              href="/platform/account"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-ink/5"
            >
              <KeyIcon size={15} className="text-ink-4" />
              Security & sessions
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink-2 hover:bg-rose-50 hover:text-rose-700"
            >
              <LogOutIcon size={15} className="text-ink-4" />
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PlatformShell({ me, children }: { me: PlatformMe; children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();
  useEffect(() => setDrawer(false), [pathname]);

  return (
    <div className="min-h-dvh bg-bone text-ink lg:flex">
      <a
        href="#platform-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-gold"
      >
        Skip to main content
      </a>
      <div className="sticky top-0 hidden h-dvh w-64 shrink-0 lg:block">
        <Sidebar me={me} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30">
          <div className="flex h-14 items-center gap-2.5 border-b border-ink/[0.08] bg-bone/85 px-4 backdrop-blur-md lg:px-6">
            <button
              type="button"
              aria-label="Open navigation"
              onClick={() => setDrawer(true)}
              className="flex size-9 items-center justify-center rounded-lg hover:bg-ink/5 lg:hidden"
            >
              <MenuIcon size={19} />
            </button>
            <span className="hidden items-center gap-2 rounded-full border border-ink/10 bg-paper px-2.5 py-1 sm:inline-flex">
              <ShieldIcon size={12} className="text-gold-dark" />
              <span className="g-metric text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4">Staff only · every action audited</span>
            </span>
            <div className="flex-1" />
            <StaffMenu me={me} />
          </div>
          <div aria-hidden className="h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
          {me.maintenance ? (
            <div className="flex items-center gap-2 bg-amber-100 px-4 py-2 text-xs font-medium text-amber-900 lg:px-6">
              <AlertCircleIcon size={14} />
              Maintenance mode is on — every shop is seeing the maintenance screen.
              {can(me, P.SETTINGS_MANAGE) ? (
                <Link href="/platform/settings" className="ml-auto underline">
                  Turn off
                </Link>
              ) : null}
            </div>
          ) : null}
        </header>
        <main id="platform-main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
      {drawer ? (
        <div className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm lg:hidden" onClick={() => setDrawer(false)}>
          <div
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] animate-fade-in flex-col shadow-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Navigation"
          >
            <Sidebar me={me} onNavigate={() => setDrawer(false)} onClose={() => setDrawer(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
