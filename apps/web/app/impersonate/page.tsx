"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { GemIcon, ShieldIcon } from "@/components/icons";

/**
 * Landing page for a platform staff sign-in link. Redeems the single-use
 * token, which sets a normal (1-hour) shop session, then enters the app.
 */
function ImpersonateInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    // Strict-mode double effects would burn the single-use token on the first call.
    if (ran.current) return;
    ran.current = true;
    const token = params.get("token");
    if (!token) {
      setError("This link is missing its token.");
      return;
    }
    window.history.replaceState(null, "", "/impersonate");
    api<{ user: { name: string }; impersonatedBy: string | null }>("/api/v1/platform/impersonate", { method: "POST", body: JSON.stringify({ token }) })
      .then((r) => {
        try {
          sessionStorage.setItem("goldos_impersonation", JSON.stringify({ as: r.user.name, by: r.impersonatedBy, at: Date.now() }));
        } catch {
          // Banner is a convenience; the session works without it.
        }
        router.replace("/dashboard");
      })
      .catch((e: Error) => setError(e.message));
  }, [params, router]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-void px-4">
      <div className="g-elevated w-full max-w-sm p-8 text-center">
        <span className="mx-auto mb-5 flex size-12 items-center justify-center rounded-xl bg-ink text-gold">
          {error ? <ShieldIcon size={20} /> : <GemIcon size={20} className="animate-pulse-soft" />}
        </span>
        {error ? (
          <>
            <h1 className="g-display text-xl text-ink">Link not valid</h1>
            <p className="mt-2 text-sm text-ink-4">{error}</p>
            <Link href="/login" className="g-btn g-btn-secondary mt-6 h-10 px-4 text-sm">
              Go to sign in
            </Link>
          </>
        ) : (
          <>
            <h1 className="g-display text-xl text-ink">Signing you in…</h1>
            <p className="mt-2 text-sm text-ink-4">Staff access is recorded in this workspace&rsquo;s audit log.</p>
          </>
        )}
      </div>
    </main>
  );
}

export default function ImpersonatePage() {
  return (
    <Suspense>
      <ImpersonateInner />
    </Suspense>
  );
}
