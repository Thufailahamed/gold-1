"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { logout } from "@/lib/auth";
import { cn } from "@/lib/cn";
import {
  LayoutGridIcon,
  PackageIcon,
  ScanBarcodeIcon,
  ArchiveIcon,
  TagsIcon,
  GemIcon,
  CoinsIcon,
  TruckIcon,
  UserCheckIcon,
  Building2Icon,
  UsersIcon,
  SettingsIcon,
  HistoryIcon,
  ScaleIcon,
  TrendingUpIcon,
  LogOutIcon,
  XIcon,
} from "./icons";

type IconCmp = (props: { size?: number | string; className?: string }) => React.ReactNode;

interface NavItem {
  href: string;
  label: string;
  icon: IconCmp;
  perm: string | null;
  tag?: string;
}

interface NavSection {
  title: string;
  tag?: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [{ href: "/", label: "Dashboard", icon: LayoutGridIcon, perm: null }],
  },
  {
    title: "Catalog",
    tag: "Core",
    items: [
      { href: "/products", label: "Products", icon: PackageIcon, perm: "products:view" },
      { href: "/scan", label: "Scan", icon: ScanBarcodeIcon, perm: "products:view", tag: "New" },
      { href: "/inventory", label: "Inventory", icon: ArchiveIcon, perm: "products:view" },
    ],
  },
  {
    title: "Masters",
    tag: "Setup",
    items: [
      { href: "/categories", label: "Categories", icon: TagsIcon, perm: "masters:view" },
      { href: "/purities", label: "Purities", icon: GemIcon, perm: "masters:view" },
      { href: "/gold-rates", label: "Gold Rates", icon: CoinsIcon, perm: "masters:view" },
      { href: "/suppliers", label: "Suppliers", icon: TruckIcon, perm: "masters:view" },
      { href: "/customers", label: "Customers", icon: UserCheckIcon, perm: "masters:view" },
    ],
  },
  {
    title: "Purchasing",
    tag: "Trade",
    items: [
      { href: "/purchases/orders", label: "Orders", icon: TruckIcon, perm: "purchases:view" },
      { href: "/purchases/invoices", label: "Invoices", icon: CoinsIcon, perm: "purchases:view" },
      { href: "/purchases/reports", label: "Reports", icon: HistoryIcon, perm: "purchases:view" },
    ],
  },
  {
    title: "Sales",
    tag: "Counter",
    items: [
      { href: "/pos", label: "POS", icon: ScanBarcodeIcon, perm: "sales:create" },
      { href: "/sales/invoices", label: "Invoices", icon: CoinsIcon, perm: "sales:view" },
      { href: "/sales/returns", label: "Returns", icon: HistoryIcon, perm: "sales:view" },
      { href: "/sales/reports", label: "Reports", icon: TrendingUpIcon, perm: "sales:view" },
    ],
  },
  {
    title: "Gold",
    tag: "Vault",
    items: [
      { href: "/gold/ledger", label: "Ledger", icon: HistoryIcon, perm: "gold:view" },
      { href: "/gold/melting", label: "Melting", icon: GemIcon, perm: "gold:view" },
      { href: "/gold/stock", label: "Stock", icon: CoinsIcon, perm: "gold:view" },
    ],
  },
  {
    title: "Old Gold",
    tag: "Counter",
    items: [
      { href: "/old-gold/intake", label: "Intake", icon: ScanBarcodeIcon, perm: "oldgold:create" },
      { href: "/old-gold/testing", label: "Testing", icon: GemIcon, perm: "oldgold:edit" },
      { href: "/old-gold/items", label: "Items", icon: ArchiveIcon, perm: "oldgold:view" },
      { href: "/old-gold/reports", label: "Reports", icon: TrendingUpIcon, perm: "oldgold:view" },
    ],
  },
  {
    title: "Organisation",
    tag: "Org",
    items: [
      { href: "/branches", label: "Branches", icon: Building2Icon, perm: "branches:view" },
      { href: "/users", label: "Users", icon: UsersIcon, perm: "users:view" },
    ],
  },
  {
    title: "System",
    tag: "Admin",
    items: [
      { href: "/settings", label: "Settings", icon: SettingsIcon, perm: "settings:view" },
      { href: "/audit", label: "Audit", icon: HistoryIcon, perm: "audit:view" },
      { href: "/accounts", label: "Accounts", icon: ScaleIcon, perm: "accounts:view" },
    ],
  },
];

export function GoldWordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-paper/[0.06] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
        <GemIcon size={16} className="text-gold" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="g-display text-[15px] tracking-wide text-paper">
          Gold<span className="text-gold">OS</span>
        </span>
        <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-gold">
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
    <div className="shrink-0 px-3 pb-2">
      <div className="mb-1.5 flex items-center justify-between px-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/30">
          Workspace
        </span>
        <span className="rounded bg-gold/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-gold">
          Verified
        </span>
      </div>
      <div className="flex items-center gap-3 rounded-xl bg-paper/[0.04] p-2.5 shadow-[inset_0_0_0_1px_rgba(250,250,249,0.07)]">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gold/15 text-gold">
          <Building2Icon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-paper">
            {branch?.name ?? "GoldOS Network"}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-paper/40">
            <span className="size-1 rounded-full bg-gold" />
            {branch ? branch.code : "HQ"} · Active
          </div>
        </div>
      </div>
    </div>
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

  async function onSignOut() {
    await logout().catch(() => undefined);
    window.location.href = "/login";
  }

  return (
    <aside className="flex h-full w-full shrink-0 select-none flex-col bg-void text-paper">
      <div className="flex h-16 shrink-0 items-center justify-between px-5">
        <Link href="/" aria-label="GoldOS dashboard" onClick={onNavigate}>
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

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4 scrollbar-thin" aria-label="Main">
        {SECTIONS.map((section) => {
          const visible = section.items.filter((i) => !i.perm || hasPermission(me.permissions, i.perm));
          if (visible.length === 0) return null;
          return (
            <div key={section.title}>
              <div className="mb-1.5 flex items-center justify-between px-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/30">
                  {section.title}
                </span>
                {section.tag ? (
                  <span className="rounded bg-paper/[0.07] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-paper/35">
                    {section.tag}
                  </span>
                ) : null}
              </div>
              <div className="space-y-0.5">
                {visible.map((item) => {
                  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-150",
                        active
                          ? "bg-paper/[0.09] text-paper before:absolute before:-left-3 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-full before:bg-gold"
                          : "text-paper/55 hover:bg-paper/[0.05] hover:text-paper"
                      )}
                    >
                      <span
                        className={cn(
                          "shrink-0 transition-colors duration-150",
                          active ? "text-gold" : "text-paper/35 group-hover:text-paper/75"
                        )}
                      >
                        <item.icon size={16} />
                      </span>
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.tag ? (
                        <span className="rounded bg-gold/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gold">
                          {item.tag}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 space-y-3 border-t border-paper/[0.07] p-3">
        <div className="flex items-center gap-3 rounded-xl bg-paper/[0.04] p-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gold font-display text-sm font-bold text-ink">
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
        <div className="flex items-center justify-between px-1 font-mono text-[10px] text-paper/30">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            <span>LK · LIVE</span>
          </span>
          <span>v0.1.0</span>
        </div>
      </div>
    </aside>
  );
}
