"use client";

import { useState } from "react";
import { BranchSwitcher } from "@/components/branch-switcher";
import { AppSidebar } from "@/components/app-sidebar";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Providers } from "@/components/providers";
import { UserMenu } from "@/components/user-menu";
import { useSession } from "@/lib/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { me, loading } = useSession();
  const [bell, setBell] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen">
        <div className="w-56 animate-pulse bg-stone-200" />
        <div className="flex-1 space-y-4 p-8">
          <div className="h-8 w-48 animate-pulse rounded bg-stone-200" />
          <div className="grid grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl bg-stone-200" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!me) return null;

  return (
    <Providers>
      <div className="flex min-h-screen">
        <div className="hidden md:block">
          <AppSidebar me={me} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b border-stone-200 bg-white px-4 py-3 md:px-6">
            <details className="md:hidden">
              <summary className="cursor-pointer rounded-md border border-stone-300 px-3 py-1.5 text-sm">
                Menu
              </summary>
              <div className="absolute z-20 mt-2">
                <AppSidebar me={me} />
              </div>
            </details>
            <div className="hidden min-w-0 flex-1 sm:block">
              <input
                placeholder="Search — arrives with catalog"
                disabled
                title="Global search arrives with a later phase"
                className="w-full max-w-sm rounded-md border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm text-stone-400"
              />
            </div>
            <div className="flex-1 sm:hidden" />
            <BranchSwitcher />
            <div className="relative">
              <button
                title="Notifications"
                onClick={() => setBell((b) => !b)}
                className="rounded-md border border-stone-300 px-3 py-1.5 text-sm"
              >
                🔔
              </button>
              {bell ? (
                <div className="absolute right-0 z-20 mt-2 w-64 rounded-md border border-stone-200 bg-white p-4 text-sm text-stone-500 shadow-lg">
                  No notifications yet. Alerts arrive with the approvals phase.
                </div>
              ) : null}
            </div>
            <UserMenu me={me} />
          </header>
          <main className="flex-1 p-4 md:p-6">
            <Breadcrumbs />
            {children}
          </main>
        </div>
      </div>
    </Providers>
  );
}
