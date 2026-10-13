"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { hasPermission } from "@goldos/shared";
import { BranchSwitcher } from "@/components/branch-switcher";
import { AppSidebar } from "@/components/app-sidebar";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { PlatformBanner, usePlatformContext } from "@/components/platform-banner";
import { UserMenu } from "@/components/user-menu";
import { ScanField } from "@/components/scan-field";
import { Skeleton } from "@/components/ui";
import { MenuIcon, ScanBarcodeIcon } from "@/components/icons";
import { MarketAlertBell } from "@/components/market-alert-bell";
import { useSession, logout } from "@/lib/auth";

function BlockedScreen({ status, supportEmail }: { status: string; supportEmail: string }) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h2 className="g-display text-2xl text-ink">
        {status === "SUSPENDED" ? "This workspace is suspended" : "This workspace is closed"}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-ink-4">
        {status === "SUSPENDED" ? (
          <>Contact <a className="underline" href={`mailto:${supportEmail}`}>{supportEmail}</a> to restore access.</>
        ) : (
          <>This shop account has been closed. Contact <a className="underline" href={`mailto:${supportEmail}`}>{supportEmail}</a> if this is a mistake.</>
        )}
      </p>
      <button
        type="button"
        onClick={() => logout().finally(() => router.replace("/login"))}
        className="g-btn mt-6 h-11 px-5 text-sm"
      >
        Sign out
      </button>
    </div>
  );
}

function AccountGate({ children }: { children: React.ReactNode }) {
  const ctx = usePlatformContext();
  const d = ctx.data;
  if (d && d.managed && (d.tenant.status === "SUSPENDED" || d.tenant.status === "ARCHIVED")) {
    return <BlockedScreen status={d.tenant.status} supportEmail={d.supportEmail} />;
  }
  return <>{children}</>;
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
    <>
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
              <MarketAlertBell enabled={hasPermission(me.permissions, "masters:view")} />
              <UserMenu me={me} />
            </div>
            {/* gold accent hairline */}
            <div
              aria-hidden
              className="h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent"
            />
          </header>

          <main id="main-content" className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <PlatformBanner />
            <AccountGate>
              <Breadcrumbs />
              {children}
            </AccountGate>
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
    </>
  );
}
