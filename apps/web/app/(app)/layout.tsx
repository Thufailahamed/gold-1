"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BranchSwitcher } from "@/components/branch-switcher";
import { AppSidebar } from "@/components/app-sidebar";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Providers } from "@/components/providers";
import { UserMenu } from "@/components/user-menu";
import { ScanField } from "@/components/scan-field";
import { Skeleton } from "@/components/ui";
import { BellIcon, MenuIcon, ScanBarcodeIcon } from "@/components/icons";
import { useSession } from "@/lib/auth";

function Notifications() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        title="Notifications"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen((b) => !b)}
        className="relative flex size-9 items-center justify-center rounded-lg text-ink transition-colors hover:bg-ink/5"
      >
        <BellIcon size={16} />
      </button>
      {open ? (
        <div className="g-floating absolute right-0 z-40 mt-2 w-80 animate-fade-in overflow-hidden">
          <div className="flex items-center justify-between border-b border-ink/[0.07] px-4 py-3">
            <span className="g-kicker">Notifications</span>
            <span className="g-metric rounded-full bg-ink/[0.06] px-2 py-0.5 text-[10px] font-semibold text-ink-4">
              00
            </span>
          </div>
          <div className="p-4">
            <div className="flex flex-col items-center rounded-xl border border-dashed border-ink/15 bg-bone/50 px-5 py-8 text-center">
              <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-paper text-ink-4 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.08)]">
                <BellIcon size={18} />
              </span>
              <p className="text-sm font-medium text-ink">All clear</p>
              <p className="mt-1 max-w-[15rem] text-xs leading-relaxed text-ink-4">
                Approvals, rate publishes and stock alerts land here.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { me, loading } = useSession();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  if (loading) {
    return (
      <div className="flex min-h-dvh">
        <div className="hidden w-64 bg-void md:block" />
        <div className="flex-1 space-y-6 p-8">
          <Skeleton className="h-9 w-56" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!me) return null;

  return (
    <Providers>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-gold"
      >
        Skip to main content
      </a>
      <div className="min-h-dvh bg-bone text-ink lg:flex">
        {/* Desktop sidebar */}
        <div className="sticky top-0 hidden h-dvh w-64 shrink-0 lg:block">
          <AppSidebar me={me} />
        </div>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30">
            <div className="flex h-14 items-center gap-2.5 border-b border-ink/[0.08] bg-bone/85 px-4 backdrop-blur-md lg:px-6">
              <button
                type="button"
                aria-label="Open navigation"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen(true)}
                className="flex size-9 items-center justify-center rounded-lg text-ink transition-colors hover:bg-ink/5 lg:hidden"
              >
                <MenuIcon size={19} />
              </button>

              <div className="hidden min-w-0 flex-1 md:block">
                <ScanField compact />
              </div>
              <div className="flex-1 md:hidden" />
              <Link
                href="/scan"
                aria-label="Scan a barcode"
                className="flex size-9 items-center justify-center rounded-lg text-ink transition-colors hover:bg-ink/5 md:hidden"
              >
                <ScanBarcodeIcon size={17} />
              </Link>

              <span className="hidden items-center gap-2 rounded-full border border-ink/10 bg-paper px-2.5 py-1 xl:inline-flex">
                <span className="size-1.5 animate-pulse-soft rounded-full bg-emerald-600" aria-hidden />
                <span className="g-metric text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4">
                  LK · Live
                </span>
              </span>

              <BranchSwitcher />
              <span className="hidden h-6 w-px bg-ink/10 sm:block" aria-hidden />
              <Notifications />
              <UserMenu me={me} />
            </div>
            {/* gold accent hairline */}
            <div
              aria-hidden
              className="h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent"
            />
          </header>

          <main id="main-content" className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Breadcrumbs />
            {children}
          </main>
        </div>

        {/* Mobile drawer */}
        {drawerOpen ? (
          <div
            className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm lg:hidden"
            onClick={() => setDrawerOpen(false)}
          >
            <div
              className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] animate-fade-in flex-col bg-void text-paper shadow-5"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Navigation"
            >
              <AppSidebar me={me} onNavigate={() => setDrawerOpen(false)} onClose={() => setDrawerOpen(false)} />
            </div>
          </div>
        ) : null}
      </div>
    </Providers>
  );
}
