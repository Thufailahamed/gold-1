"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { controlClass } from "@/components/ui";
import { ArrowRightIcon, KeyIcon, ShieldIcon } from "@/components/icons";
import { PlatformWordmark } from "@/components/platform/shell";
import { cn } from "@/lib/cn";
import { papi, PlatformError } from "@/lib/platform";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<"password" | "mfa">(params.get("step") === "mfa" ? "mfa" : "password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boot = useQuery({ queryKey: ["platform-bootstrap"], queryFn: () => papi<{ needsBootstrap: boolean }>("/auth/bootstrap"), retry: false });

  useEffect(() => {
    if (boot.data?.needsBootstrap) router.replace("/platform/setup");
  }, [boot.data, router]);

  async function onPassword(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const r = await papi<{ mfaRequired: boolean }>("/auth/login", { method: "POST", json: { email, password } });
      if (r.mfaRequired) {
        setStep("mfa");
        setPassword("");
      } else {
        router.replace("/platform");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setPending(false);
    }
  }

  async function onMfa(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await papi("/auth/mfa", { method: "POST", json: { code } });
      toast.success("Signed in");
      router.replace("/platform");
    } catch (err) {
      if (err instanceof PlatformError && err.status === 401 && err.code === "UNAUTHORIZED" && err.message !== "Invalid code") {
        // The half-open session was burned after repeated misses.
        setStep("password");
      }
      setError(err instanceof Error ? err.message : "Verification failed");
      setCode("");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-void px-4 py-10">
      <div className="pointer-events-none absolute -right-24 -top-32 size-[28rem] rounded-full bg-gold/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -left-24 size-96 rounded-full bg-gold/10 blur-3xl" />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <PlatformWordmark />
        </div>
        <div className="g-elevated animate-fade-in p-6 sm:p-8">
          {step === "password" ? (
            <form onSubmit={onPassword} noValidate className="space-y-4">
              <div className="mb-6">
                <div className="g-kicker">Staff sign in</div>
                <h1 className="g-display mt-2 text-2xl text-ink">Operator console</h1>
                <p className="mt-2 text-sm text-ink-4">For GoldOS staff only. Shop users sign in at the main app.</p>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink-3">Work email</span>
                <input
                  type="email"
                  autoComplete="username"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={cn(controlClass, "w-full")}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink-3">Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={cn(controlClass, "w-full")}
                />
              </label>
              {error ? (
                <p role="alert" className="rounded-lg bg-rose-700/[0.07] px-3 py-2 text-xs font-medium text-rose-700">
                  {error}
                </p>
              ) : null}
              <button type="submit" disabled={pending || !email || password.length < 8} className="g-btn g-btn-primary h-11 w-full text-sm">
                {pending ? "Checking…" : "Continue"}
                {!pending && <ArrowRightIcon size={14} className="g-btn-arrow" />}
              </button>
            </form>
          ) : (
            <form onSubmit={onMfa} noValidate className="space-y-4">
              <div className="mb-6">
                <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-ink text-gold">
                  <KeyIcon size={20} />
                </span>
                <div className="g-kicker">Two-factor</div>
                <h1 className="g-display mt-2 text-2xl text-ink">Enter your code</h1>
                <p className="mt-2 text-sm text-ink-4">Open your authenticator app and enter the 6-digit code for GoldOS Platform.</p>
              </div>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                aria-label="6-digit code"
                className={cn(controlClass, "h-14 w-full text-center font-mono text-2xl tracking-[0.5em]")}
              />
              {error ? (
                <p role="alert" className="rounded-lg bg-rose-700/[0.07] px-3 py-2 text-xs font-medium text-rose-700">
                  {error}
                </p>
              ) : null}
              <button type="submit" disabled={pending || code.length !== 6} className="g-btn g-btn-primary h-11 w-full text-sm">
                {pending ? "Verifying…" : "Verify and sign in"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("password");
                  setError(null);
                }}
                className="w-full text-center text-xs font-medium text-ink-4 hover:text-ink"
              >
                Use a different account
              </button>
            </form>
          )}
        </div>
        <p className="mt-6 flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper/40">
          <ShieldIcon size={12} /> Encrypted · Rate limited · Audit logged
        </p>
        <p className="mt-2 text-center text-[11px] text-paper/30">
          Looking for your shop? <Link href="/login" className="underline hover:text-paper/60">Shop sign in</Link>
        </p>
      </div>
    </main>
  );
}

export default function PlatformLoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
