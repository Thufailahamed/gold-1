"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  ArchiveIcon,
  BookOpenIcon,
  CoinsIcon,
  CreditCardIcon,
  GemIcon,
  HammerIcon,
  FileTextIcon,
  FlaskConicalIcon,
  GaugeIcon,
  RotateCcwIcon,
  ScaleIcon,
  ScanBarcodeIcon,
  TrendingUpIcon,
} from "./icons";

type IconCmp = (props: { size?: number | string; className?: string }) => React.ReactNode;
export type ModulePage = { href: string; label: string; icon: IconCmp; perm: string };

export const OLD_GOLD_PAGES: ModulePage[] = [
  { href: "/old-gold", label: "Overview", icon: GaugeIcon, perm: "oldgold:view" },
  { href: "/old-gold/intake", label: "Intake", icon: ScaleIcon, perm: "oldgold:create" },
  { href: "/old-gold/testing", label: "Testing", icon: FlaskConicalIcon, perm: "oldgold:edit" },
  { href: "/old-gold/items", label: "Items", icon: ArchiveIcon, perm: "oldgold:view" },
  { href: "/old-gold/reports", label: "Reports", icon: TrendingUpIcon, perm: "oldgold:view" },
];

export const SALES_PAGES: ModulePage[] = [
  { href: "/sales", label: "Overview", icon: GaugeIcon, perm: "sales:view" },
  { href: "/pos", label: "POS", icon: ScanBarcodeIcon, perm: "sales:create" },
  { href: "/sales/invoices", label: "Invoices", icon: CreditCardIcon, perm: "sales:view" },
  { href: "/sales/returns", label: "Returns", icon: RotateCcwIcon, perm: "sales:view" },
  { href: "/sales/reports", label: "Reports", icon: TrendingUpIcon, perm: "sales:view" },
];

export const PURCHASING_PAGES: ModulePage[] = [
  { href: "/purchases", label: "Overview", icon: GaugeIcon, perm: "purchases:view" },
  { href: "/purchases/orders", label: "Orders", icon: FileTextIcon, perm: "purchases:view" },
  { href: "/purchases/invoices", label: "Invoices", icon: CreditCardIcon, perm: "purchases:view" },
  { href: "/purchases/reports", label: "Reports", icon: TrendingUpIcon, perm: "purchases:view" },
];

export const GOLD_PAGES: ModulePage[] = [
  { href: "/gold", label: "Overview", icon: GaugeIcon, perm: "gold:view" },
  { href: "/gold/stock", label: "Stock", icon: CoinsIcon, perm: "gold:view" },
  { href: "/gold/melting", label: "Melting", icon: GemIcon, perm: "gold:view" },
  { href: "/gold/ledger", label: "Ledger", icon: BookOpenIcon, perm: "gold:view" },
];

export const MANUFACTURING_PAGES: ModulePage[] = [
  { href: "/manufacturing", label: "Overview", icon: GaugeIcon, perm: "mfg:view" },
  { href: "/manufacturing/orders", label: "Orders", icon: HammerIcon, perm: "mfg:view" },
  { href: "/manufacturing/reports", label: "Reports", icon: TrendingUpIcon, perm: "mfg:view" },
];

/**
 * Section switcher shown above every page of a module so it reads as one
 * workspace. The first page is the module's overview; it prefixes every other
 * page, so it is only active on an exact match.
 */
export function ModuleNav({ label, pages }: { label: string; pages: ModulePage[] }) {
  const pathname = usePathname();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const perms = me.data?.permissions ?? [];
  const visible = pages.filter((p) => !me.data || hasPermission(perms, p.perm));
  const root = pages[0]?.href;

  const isActive = (href: string) =>
    href === root ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="-mx-1 mb-6 overflow-x-auto scrollbar-thin print:hidden">
      <nav
        aria-label={label}
        className="mx-1 flex min-w-max items-center gap-1 rounded-2xl bg-paper p-1.5 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.07),0_12px_28px_-24px_rgba(28,25,23,0.35)]"
      >
        <span className="hidden items-center gap-2 pl-3 pr-4 sm:flex">
          <span className="size-1.5 rounded-full bg-gold" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-dark">{label}</span>
        </span>
        <span className="hidden h-6 w-px bg-ink/[0.08] sm:block" aria-hidden />
        {visible.map((p) => {
          const active = isActive(p.href);
          return (
            <Link
              key={p.href}
              href={p.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-xl px-4 text-[13px] font-medium transition-all duration-200 ease-brand",
                active ? "bg-ink text-paper shadow-pop" : "text-ink-4 hover:bg-ink/[0.04] hover:text-ink"
              )}
            >
              <span className={cn("transition-colors", active ? "text-gold" : "text-ink-5 group-hover:text-gold-dark")}>
                <p.icon size={15} />
              </span>
              {p.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
