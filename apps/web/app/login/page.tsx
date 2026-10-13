"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api, errorCode } from "@/lib/api";
import { readTenantSlug, writeTenantSlug } from "@/lib/tenant";
import { cn } from "@/lib/cn";
import { controlClass } from "@/components/ui";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  EyeIcon,
  EyeOffIcon,
  GemIcon,
} from "@/components/icons";

const FEATURES = [
  "Live per-karat pricing on every piece",
  "Barcode-first catalog and stock movements",
  "Role-based access with full audit trail",
];

const emailSchema = z.object({ email: z.string().email("Enter a valid email") });
type EmailInput = z.infer<typeof emailSchema>;
const passwordSchema = z.object({ password: z.string().min(1, "Enter your password") });
type PasswordInput = z.infer<typeof passwordSchema>;

type Shop = { slug: string; name: string };

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-xs font-medium text-rose-700">
      {message}
    </p>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<"email" | "shop">("email");
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [email, setEmail] = useState("");
  const [slug, setSlug] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const emailForm = useForm<EmailInput>({ resolver: zodResolver(emailSchema) });
  const passwordForm = useForm<PasswordInput>({ resolver: zodResolver(passwordSchema) });

  useEffect(() => {
    const hinted = searchParams.get("shop") ?? readTenantSlug();
    if (hinted) setSlug(hinted);
  }, [searchParams]);

  async function onEmail(values: EmailInput) {
    setPending(true);
    try {
      const data = await api<{ shops: Shop[] }>("/api/v1/auth/lookup", {
        method: "POST",
        body: JSON.stringify({ email: values.email }),
      });
      setEmail(values.email);
      setShops(data.shops);
      // Preselect: URL hint, saved shop, the only shop — in that order.
      const hinted = searchParams.get("shop") ?? readTenantSlug();
      setSlug(hinted ?? (data.shops.length === 1 ? data.shops[0]?.slug : undefined));
      setStep("shop");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setPending(false);
    }
  }

  async function onPassword(values: PasswordInput) {
    setPending(true);
    try {
      await api("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify(slug ? { email, password: values.password, slug } : { email, password: values.password }),
      });
      if (slug) writeTenantSlug(slug);
      toast.success("Welcome back");
      router.push("/dashboard");
    } catch (err) {
      // Deliberately generic: must not reveal which emails or shops exist.
      if (errorCode(err) === "TENANT_SUSPENDED") {
        toast.error("This workspace is suspended. Contact support to restore access.");
      } else if (errorCode(err) === "PROVISIONING") {
        toast.error("Your shop is still being prepared. Try again in a minute.");
      } else {
        toast.error("Check your email, shop and password and try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="g-elevated animate-fade-in p-6 sm:p-8">
      <div className="mb-7">
        <div className="g-kicker">{step === "email" ? "Shop sign in" : "Pick your shop"}</div>
        <h2 className="g-display mt-2 text-2xl text-ink">Welcome back</h2>
        <p className="mt-2 text-sm text-ink-4">
          {step === "email" ? "Enter your email to find your shop." : <>Signing in as <strong>{email}</strong></>}
        </p>
      </div>

      {step === "email" ? (
        <form onSubmit={emailForm.handleSubmit(onEmail)} noValidate className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-ink-3">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus
              placeholder="you@shop.lk"
              aria-invalid={!!emailForm.formState.errors.email}
              aria-describedby={emailForm.formState.errors.email ? "email-error" : undefined}
              className={cn(
                controlClass,
                "w-full",
                emailForm.formState.errors.email &&
                  "shadow-[inset_0_0_0_1px_#be123c] focus:shadow-[inset_0_0_0_1px_#be123c,0_0_0_3px_rgba(190,18,60,0.2)]"
              )}
              {...emailForm.register("email")}
            />
            <FieldError id="email-error" message={emailForm.formState.errors.email?.message} />
          </div>

          <button type="submit" disabled={pending} className="g-btn g-btn-primary h-11 w-full px-4 text-sm">
            {pending ? "Finding your shop…" : "Continue"}
            {!pending && <ArrowRightIcon size={14} className="g-btn-arrow" />}
          </button>
        </form>
      ) : (
        <form onSubmit={passwordForm.handleSubmit(onPassword)} noValidate className="space-y-4">
          {shops !== null && shops.length > 1 ? (
            <div role="radiogroup" aria-label="Your shops">
              <span className="mb-1.5 block text-xs font-medium text-ink-3">Shop</span>
              <div className="space-y-2">
                {shops.map((s) => (
                  <label
                    key={s.slug}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm ring-1 transition-colors",
                      slug === s.slug ? "bg-gold/[0.08] ring-gold-dark/40" : "bg-paper ring-ink/10 hover:ring-ink/25"
                    )}
                  >
                    <input
                      type="radio"
                      name="shop"
                      value={s.slug}
                      checked={slug === s.slug}
                      onChange={() => setSlug(s.slug)}
                      className="accent-[#8a6d1b]"
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{s.name}</span>
                      <span className="block truncate font-mono text-[11px] text-ink-5">{s.slug}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-ink-3">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                autoFocus
                placeholder="••••••••"
                aria-invalid={!!passwordForm.formState.errors.password}
                aria-describedby={passwordForm.formState.errors.password ? "password-error" : undefined}
                className={cn(
                  controlClass,
                  "w-full pr-10",
                  passwordForm.formState.errors.password &&
                    "shadow-[inset_0_0_0_1px_#be123c] focus:shadow-[inset_0_0_0_1px_#be123c,0_0_0_3px_rgba(190,18,60,0.2)]"
                )}
                {...passwordForm.register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-5 transition-colors hover:text-ink"
              >
                {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </div>
            <FieldError id="password-error" message={passwordForm.formState.errors.password?.message} />
          </div>

          <button type="submit" disabled={pending} className="g-btn g-btn-primary h-11 w-full px-4 text-sm">
            {pending ? "Signing in…" : "Sign in"}
            {!pending && <ArrowRightIcon size={14} className="g-btn-arrow" />}
          </button>

          <button
            type="button"
            onClick={() => {
              setStep("email");
              setShops(null);
              setSlug(undefined);
            }}
            className="w-full text-center text-xs text-ink-4 hover:text-ink hover:underline"
          >
            Use a different email
          </button>
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-void p-10 text-paper lg:flex xl:p-14">
        <div className="pointer-events-none absolute -right-24 -top-32 size-[26rem] rounded-full bg-gold/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-80 rounded-full bg-gold/10 blur-3xl" />

        <div className="relative flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-paper/[0.06] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
            <GemIcon size={17} className="text-gold" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="g-display text-base tracking-wide text-paper">
              Gold<span className="text-gold">OS</span>
            </span>
            <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-gold">
              Console
            </span>
          </span>
        </div>

        <div className="relative">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">
            Jewellery ERP · Sri Lanka
          </div>
          <h2 className="g-display mt-4 max-w-md text-4xl text-paper text-balance xl:text-5xl">
            Run your gold business on one console.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-paper/60">
            Catalog, barcodes, live board rates and branch inventory — one workspace for every
            counter.
          </p>
          <ul className="mt-8 space-y-3">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-3 text-sm text-paper/75">
                <CheckCircleIcon size={16} className="shrink-0 text-gold" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-paper/30">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            Secure session
          </span>
          <span>v0.1.0</span>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-bone px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          {/* Mobile brand header */}
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-ink">
              <GemIcon size={20} className="text-gold" />
            </span>
            <h1 className="g-display text-2xl text-ink">
              Gold<span className="text-gold-dark">OS</span>
            </h1>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-gold-dark">
              Jewellery ERP · Sri Lanka
            </p>
          </div>

          <Suspense>
            <LoginForm />
          </Suspense>

          <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-ink-5">
            Encrypted session · Audit logged
          </p>
        </div>
      </div>
    </main>
  );
}
