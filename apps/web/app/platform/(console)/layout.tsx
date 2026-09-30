"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PlatformShell } from "@/components/platform/shell";
import { Skeleton } from "@/components/ui";
import { PlatformError, usePlatformMe } from "@/lib/platform";

export default function PlatformConsoleLayout({ children }: { children: React.ReactNode }) {
  const me = usePlatformMe();
  const router = useRouter();

  useEffect(() => {
    if (!me.error) return;
    const code = me.error instanceof PlatformError ? me.error.code : "";
    router.replace(code === "MFA_REQUIRED" ? "/platform/login?step=mfa" : "/platform/login");
  }, [me.error, router]);

  if (me.isLoading || !me.data) {
    return (
      <div className="flex min-h-dvh bg-bone">
        <div className="hidden w-64 bg-void lg:block" />
        <div className="flex-1 space-y-6 p-8">
          <Skeleton className="h-40 rounded-xl" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  return <PlatformShell me={me.data}>{children}</PlatformShell>;
}
