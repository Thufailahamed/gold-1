"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
  GemIcon,
  KeyIcon,
  ShieldIcon,
} from "@/components/icons";
import { cn } from "@/lib/cn";
import { papi, PlatformError } from "@/lib/platform";

function MailGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function LockGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function Steps({ step }: { step: "password" | "mfa" }) {
  const items = [
    { key: "password", label: "Credentials" },
    { key: "mfa", label: "Verify" },
  ] as const;
  const activeIdx = step === "password" ? 0 : 1;
  return (
    <ol className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em]">
      {items.map((it, i) => (
        <li key={it.key} className="flex items-center gap-3">
          <span className={cn("flex items-center gap-2 transition-colors", i <= activeIdx ? "text-gold-light" : "text-paper/30")}>
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full text-[9px] transition-all",
                i < activeIdx && "bg-gold text-ink",
                i === activeIdx && "shadow-[inset_0_0_0_1px_rgba(226,194,122,0.8)]",
                i > activeIdx && "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]"
              )}
            >
              {i < activeIdx ? "✓" : `0${i + 1}`}
            </span>
            {it.label}
          </span>
          {i < items.length - 1 ? <span className={cn("h-px w-8 transition-colors", activeIdx > i ? "bg-gold/60" : "bg-paper/15")} /> : null}
        </li>
      ))}
    </ol>
  );
}

function ErrorNote({ message, nonce }: { message: string; nonce: number }) {
  return (
    <p
      key={nonce}
      role="alert"
      className="pl-shake flex items-start gap-2.5 rounded-xl bg-rose-500/[0.08] px-3.5 py-3 text-[13px] font-medium text-rose-200 shadow-[inset_0_0_0_1px_rgba(251,113,133,0.25)]"
    >
      <AlertCircleIcon size={16} className="mt-px shrink-0 text-rose-300" />
      {message}
    </p>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<"password" | "mfa">(params.get("step") === "mfa" ? "mfa" : "password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorNonce, setErrorNonce] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const boot = useQuery({ queryKey: ["platform-bootstrap"], queryFn: () => papi<{ needsBootstrap: boolean }>("/auth/bootstrap"), retry: false });

  useEffect(() => {
    if (boot.data?.needsBootstrap) router.replace("/platform/setup");
  }, [boot.data, router]);

  function fail(message: string) {
    setError(message);
    setErrorNonce((n) => n + 1);
  }

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
      fail(err instanceof Error ? err.message : "Sign in failed");
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
      fail(err instanceof Error ? err.message : "Verification failed");
      setCode("");
    } finally {
      setPending(false);
    }
  }

  function trackCaps(e: React.KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState?.("CapsLock") ?? false);
  }

  return (
    <main className="pl-stage relative flex min-h-dvh items-center justify-center overflow-clip px-4 pb-12 pt-24 text-paper sm:py-16">
      {/* Ambient layers */}
      <div className="pl-grid pointer-events-none absolute inset-0" />
      <div className="pl-orb pointer-events-none absolute -right-40 -top-40 size-[34rem] rounded-full bg-gold/[0.13] blur-[120px]" />
      <div className="pl-orb pointer-events-none absolute -bottom-48 -left-32 size-[30rem] rounded-full bg-emerald-500/[0.08] blur-[120px] [animation-delay:-9s]" />
      <div className="pl-grain pointer-events-none absolute inset-0" />

      {/* Top bar */}
      <header className="absolute inset-x-0 top-0 flex items-center justify-between px-6 py-5 sm:px-10">
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-paper/40">
          <span className="relative flex size-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-gold/70" />
            <span className="relative size-1.5 rounded-full bg-gold" />
          </span>
          Restricted area
        </span>
        <Link
          href="/login"
          className="group flex items-center gap-1.5 text-xs font-medium text-paper/50 transition-colors hover:text-paper"
        >
          Shop sign in
          <ArrowRightIcon size={12} className="transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </header>

      <div className="relative w-full max-w-[26rem] animate-fade-in">
        {/* Crest */}
        <div className="mb-9 flex flex-col items-center text-center">
          <span className="pl-crest flex size-14 items-center justify-center rounded-2xl">
            <GemIcon size={24} className="text-ink" strokeWidth={1.75} />
          </span>
          <span className="g-display mt-5 text-[26px] leading-none tracking-tight text-paper">
            Gold<span className="pl-gold-text">OS</span>
          </span>
          <span className="mt-2.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.32em] text-gold/80">
            <span className="h-px w-5 bg-gold/40" />
            Platform admin
            <span className="h-px w-5 bg-gold/40" />
          </span>
        </div>

        <div className="pl-frame">
          <div className="pl-card px-6 pb-7 pt-6 sm:px-9 sm:pb-9 sm:pt-7">
            <div className="mb-7 flex items-center justify-between">
              <Steps step={step} />
              <ShieldIcon size={16} className="text-gold/60" />
            </div>

            {step === "password" ? (
              <form key="password" onSubmit={onPassword} noValidate className="animate-fade-in space-y-5">
                <div>
                  <h1 className="g-display text-[30px] leading-[1.1] tracking-tight text-paper">Operator console</h1>
                  <p className="mt-2.5 text-sm leading-relaxed text-paper/50">
                    Sign in with your GoldOS staff account. Every session is verified and recorded.
                  </p>
                </div>

                <div className="pl-rule" />

                <label className="block">
                  <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-paper/55">Work email</span>
                  <span className="pl-field" data-invalid={!!error}>
                    <span className="pl-field-icon flex w-11 shrink-0 justify-center">
                      <MailGlyph />
                    </span>
                    <input
                      type="email"
                      autoComplete="username"
                      autoFocus
                      required
                      placeholder="name@goldos.app"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pr-4"
                    />
                  </span>
                </label>

                <label className="block">
                  <span className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-paper/55">
                    Password
                    {capsLock ? (
                      <span className="rounded-md bg-gold/15 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] text-gold-light">Caps lock on</span>
                    ) : null}
                  </span>
                  <span className="pl-field" data-invalid={!!error}>
                    <span className="pl-field-icon flex w-11 shrink-0 justify-center">
                      <LockGlyph />
                    </span>
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      placeholder="••••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={trackCaps}
                      onKeyUp={trackCaps}
                      className="tracking-wide"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      className="flex h-full w-11 shrink-0 items-center justify-center rounded-r-xl text-paper/35 transition-colors hover:text-paper"
                    >
                      {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                    </button>
                  </span>
                </label>

                {error ? <ErrorNote message={error} nonce={errorNonce} /> : null}

                <button type="submit" disabled={pending || !email || password.length < 8} className="pl-btn mt-1">
                  {pending ? (
                    <>
                      <Spinner />
                      Checking…
                    </>
                  ) : (
                    <>
                      Continue
                      <ArrowRightIcon size={15} className="pl-btn-arrow" />
                    </>
                  )}
                </button>
              </form>
            ) : (
              <form key="mfa" onSubmit={onMfa} noValidate className="animate-fade-in space-y-5">
                <div className="flex items-start gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gold/10 text-gold-light shadow-[inset_0_0_0_1px_rgba(226,194,122,0.3)]">
                    <KeyIcon size={19} />
                  </span>
                  <div>
                    <h1 className="g-display text-[26px] leading-[1.1] tracking-tight text-paper">Enter your code</h1>
                    <p className="mt-2 text-sm leading-relaxed text-paper/50">
                      Open your authenticator and enter the 6-digit code for GoldOS Platform.
                    </p>
                  </div>
                </div>

                <div className="pl-rule" />

                <div className="relative" onClick={() => codeRef.current?.focus()}>
                  <input
                    ref={codeRef}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    onFocus={() => setCodeFocused(true)}
                    onBlur={() => setCodeFocused(false)}
                    aria-label="6-digit code"
                    className="absolute inset-0 z-10 w-full cursor-text bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent"
                  />
                  <div className="grid grid-cols-6 gap-2 sm:gap-2.5" aria-hidden>
                    {Array.from({ length: 6 }).map((_, i) => {
                      const ch = code[i];
                      const active = codeFocused && (i === code.length || (code.length === 6 && i === 5));
                      return (
                        <div key={i} className={cn("pl-otp-cell", i === 2 && "mr-1 sm:mr-2")} data-filled={!!ch} data-active={active}>
                          {ch ?? (active ? <span className="pl-caret" /> : null)}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {error ? <ErrorNote message={error} nonce={errorNonce} /> : null}

                <button type="submit" disabled={pending || code.length !== 6} className="pl-btn">
                  {pending ? (
                    <>
                      <Spinner />
                      Verifying…
                    </>
                  ) : (
                    <>
                      Verify and sign in
                      <ArrowRightIcon size={15} className="pl-btn-arrow" />
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep("password");
                    setError(null);
                    setCode("");
                  }}
                  className="mx-auto flex items-center gap-1.5 text-xs font-medium text-paper/45 transition-colors hover:text-paper"
                >
                  <ArrowLeftIcon size={12} />
                  Use a different account
                </button>
              </form>
            )}
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] sm:tracking-[0.2em] text-paper/35">
          <span>Encrypted</span>
          <span className="size-1 rounded-full bg-gold/40" />
          <span>Rate limited</span>
          <span className="size-1 rounded-full bg-gold/40" />
          <span>Audit logged</span>
        </div>
        <p className="mt-3 text-center text-[11px] text-paper/30">
          Unauthorised access is prohibited and may be prosecuted.
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
