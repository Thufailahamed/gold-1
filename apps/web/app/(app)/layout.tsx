"use client";

import { useEffect, useState } from "react";
import { BranchSwitcher } from "@/components/branch-switcher";
import { AppSidebar } from "@/components/app-sidebar";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Providers } from "@/components/providers";
import { UserMenu } from "@/components/user-menu";
import { Skeleton } from "@/components/ui";
import { BellIcon, MenuIcon, SearchIcon } from "@/components/icons";
import { useSession } from "@/lib/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { me, loading } = useSession();
  const [bell, setBell] = useState(false);
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
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-ink/[0.08] bg-bone/85 px-4 backdrop-blur-md lg:px-6">
            <button
              type="button"
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className="flex size-10 items-center justify-center rounded-lg text-ink transition-colors hover:bg-ink/5 lg:hidden"
            >
              <MenuIcon size={20} />
            </button>

            <div className="hidden min-w-0 flex-1 md:block">
              <div className="relative max-w-sm">
                <SearchIcon
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"
                />
                <input
                  placeholder="Search — arrives with catalog"
                  disabled
                  title="Global search arrives with a later phase"
                  className="h-9 w-full cursor-not-allowed rounded-lg bg-paper pl-9 pr-3 text-sm text-ink-4 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.1)] placeholder:text-ink-5"
                />
              </div>
            </div>
            <div className="flex-1 md:hidden" />

            <BranchSwitcher />
            <div className="relative">
              <button
                title="Notifications"
                aria-label="Notifications"
                onClick={() => setBell((b) => !b)}
                className="flex size-10 items-center justify-center rounded-lg text-ink transition-colors hover:bg-ink/5"
              >
                <BellIcon size={17} />
              </button>
              {bell ? (
                <div className="g-floating absolute right-0 z-40 mt-2 w-72 animate-fade-in p-4 text-sm text-ink-4">
                  <div className="g-kicker mb-1.5">Notifications</div>
                  No notifications yet. Alerts arrive with the approvals phase.
                </div>
              ) : null}
            </div>
            <UserMenu me={me} />
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
