"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import {
  BookOpenIcon,
  CoinsIcon,
  HistoryIcon,
  LayoutGridIcon,
  ScaleIcon,
  SparklesIcon,
  TagsIcon,
  TruckIcon,
  UsersIcon,
} from "@/components/icons";

type IconCmp = (props: { size?: number | string; className?: string }) => ReactNode;

const SECTIONS: { href: string; label: string; icon: IconCmp }[] = [
  { href: "/accounts", label: "Overview", icon: LayoutGridIcon },
  { href: "/accounts/assistant", label: "Assistant", icon: SparklesIcon },
  { href: "/accounts/cash", label: "Cash & bank", icon: CoinsIcon },
  { href: "/accounts/receivables", label: "Customer dues", icon: UsersIcon },
  { href: "/accounts/payables", label: "Supplier dues", icon: TruckIcon },
  { href: "/accounts/statements", label: "Statements", icon: ScaleIcon },
  { href: "/accounts/chart", label: "Chart of accounts", icon: BookOpenIcon },
  { href: "/accounts/tax", label: "Sales tax", icon: TagsIcon },
  { href: "/accounts/year-end", label: "Financial year", icon: HistoryIcon },
];

/**
 * Shared frame for the accounts suite. Sub-pages get a sticky section rail so
 * moving between books never means a trip back to the dashboard; the
 * dashboard itself has the full hub instead. `acct-suite` scopes the ledger
 * refinements in globals.css to these pages only.
 */
export default function AccountsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/accounts";
  const isOverview = pathname === "/accounts";
  // The assistant is a full-height workspace; the breadcrumb leads back to the books.
  const isAssistant = pathname.startsWith("/accounts/assistant");

  return (
    <div className="acct-suite">
      {isOverview || isAssistant ? null : (
        <nav
          aria-label="Accounts sections"
          className="sticky top-[57px] z-20 mx-auto -mt-1 mb-6 max-w-7xl print:hidden"
        >
          <div className="relative overflow-hidden rounded-2xl bg-paper/85 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.08),0_14px_34px_-24px_rgba(16,32,27,0.35)] backdrop-blur-md">
            <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-gold/45 to-transparent" />
            <div className="flex items-center gap-2 overflow-x-auto p-1.5 scrollbar-thin">
              <span className="hidden shrink-0 items-center gap-2 pl-2 pr-3 xl:flex">
                <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-b from-gold-light to-gold-deep text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
                  <ScaleIcon size={13} />
                </span>
                <span className="g-metric text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-4">Books</span>
                <span className="ml-1 h-5 w-px bg-ink/10" aria-hidden />
              </span>
              {SECTIONS.map((s) => {
                const active = s.href === "/accounts" ? isOverview : pathname.startsWith(s.href);
                return (
                  <Link
                    key={s.href}
                    href={s.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 text-[13px] font-medium transition-all duration-200 ease-brand",
                      active
                        ? "bg-void text-paper shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_22px_-12px_rgba(6,42,34,0.7)]"
                        : "text-ink-4 hover:bg-ink/[0.05] hover:text-ink"
                    )}
                  >
                    <s.icon
                      size={14}
                      className={cn("transition-colors", active ? "text-gold-light" : "text-ink-5 group-hover:text-gold-dark")}
                    />
                    {s.label}
                    {active ? (
                      <span className="absolute inset-x-3 -bottom-px h-px bg-gradient-to-r from-transparent via-gold-light to-transparent" />
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>
      )}
      {children}
    </div>
  );
}
