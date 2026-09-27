"use client";

import { useRouter } from "next/navigation";
import { Toaster } from "sonner";
import { BranchSwitcher } from "@/components/branch-switcher";
import { AppSidebar } from "@/components/app-sidebar";
import { logout, useSession } from "@/lib/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { me, loading } = useSession();
  const router = useRouter();

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

  async function onLogout() {
    await logout().catch(() => undefined);
    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen">
      <Toaster richColors />
      <AppSidebar me={me} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-stone-200 bg-white px-6 py-3">
          <BranchSwitcher />
          <button
            onClick={onLogout}
            className="rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100"
          >
            Sign out
          </button>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
