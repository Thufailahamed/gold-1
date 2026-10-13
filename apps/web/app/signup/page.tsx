"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { writeTenantSlug } from "@/lib/tenant";
import { cn } from "@/lib/cn";
import { controlClass } from "@/components/ui";
import { ArrowRightIcon, CheckCircleIcon, GemIcon } from "@/components/icons";

const signupSchema = z.object({
  shopName: z.string().trim().min(2, "Give your shop a name").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "At least 3 characters")
    .max(30)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Lowercase letters, digits and dashes"),
  ownerName: z.string().trim().min(1, "Your name is required").max(100),
  ownerEmail: z.string().email("Enter a valid email"),
  password: z.string().min(10, "At least 10 characters").max(200),
  phone: z.string().trim().max(40).optional(),
  planId: z.string().min(1, "Pick a plan"),
  interval: z.enum(["MONTH", "YEAR"]),
  company_website: z.string().optional(),
});
type SignupInput = z.infer<typeof signupSchema>;

type Plan = {
  id: string;
  code: string;
  name: string;
  description: string;
  price_monthly_cents: number;
  price_yearly_cents: number;
  currency: string;
  trial_days: number;
  max_users: number | null;
  max_branches: number | null;
  features: string[];
};

const STEPS = ["Your shop", "Your account", "Plan"] as const;

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1.5 text-xs font-medium text-rose-700">
      {message}
    </p>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-ink-3">
        <span className="mb-1.5 block">{label}</span>
        {children}
      </label>
    </div>
  );
}

export default function SignupPage() {
  const [step, setStep] = useState(0);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<{ slug: string; loginUrl: string } | null>(null);
  const {
    register,
    handleSubmit,
    trigger,
    watch,
    setValue,
    formState: { errors },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { interval: "MONTH", planId: "" },
  });

  useEffect(() => {
    api<{ plans: Plan[] }>("/api/v1/public/plans")
      .then((d) => {
        setPlans(d.plans);
        if (d.plans[0] && !watch("planId")) setValue("planId", d.plans[0].id);
      })
      .catch(() => toast.error("Could not load plans. Check your connection and reload."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const interval = watch("interval");
  const slug = watch("slug");

  async function next() {
    const fields: Array<keyof SignupInput> =
      step === 0 ? ["shopName", "slug"] : ["ownerName", "ownerEmail", "password", "phone"];
    if (await trigger(fields)) setStep((s) => Math.min(s + 1, 2));
  }

  async function onSubmit(values: SignupInput) {
    setPending(true);
    try {
      const data = await api<{ slug: string; loginUrl: string }>("/api/v1/public/signup", {
        method: "POST",
        body: JSON.stringify(values),
      });
      writeTenantSlug(data.slug);
      setDone(data);
      toast.success("Your shop is ready");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setPending(false);
    }
  }

  function price(p: Plan) {
    const cents = interval === "YEAR" ? p.price_yearly_cents : p.price_monthly_cents;
    return `LKR ${(cents / 100).toLocaleString("en-US")}${interval === "YEAR" ? "/yr" : "/mo"}`;
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bone px-4 py-10 sm:px-8">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-ink">
            <GemIcon size={20} className="text-gold" />
          </span>
          <h1 className="g-display text-2xl text-ink">
            Gold<span className="text-gold-dark">OS</span>
          </h1>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-gold-dark">
            Start your 14-day trial
          </p>
        </div>

        {done ? (
          <div className="g-elevated animate-fade-in p-6 text-center sm:p-8">
            <CheckCircleIcon size={40} className="mx-auto text-emerald-600" />
            <h2 className="g-display mt-4 text-2xl text-ink">Your shop is ready</h2>
            <p className="mt-2 text-sm text-ink-4">
              Sign in at <span className="font-mono font-medium text-ink">{done.slug}</span> any time —
              we saved it on this device.
            </p>
            <Link href={done.loginUrl} className="g-btn g-btn-primary mt-6 inline-flex h-11 px-6 text-sm">
              Go to sign in
              <ArrowRightIcon size={14} className="g-btn-arrow" />
            </Link>
          </div>
        ) : (
          <div className="g-elevated animate-fade-in p-6 sm:p-8">
            <ol className="mb-7 flex items-center gap-2" aria-label="Signup progress">
              {STEPS.map((label, i) => (
                <li key={label} className="flex flex-1 items-center gap-2">
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                      i < step ? "bg-emerald-600 text-white" : i === step ? "bg-ink text-gold" : "bg-ink/10 text-ink-4"
                    )}
                  >
                    {i < step ? "✓" : i + 1}
                  </span>
                  <span className={cn("text-xs font-medium", i === step ? "text-ink" : "text-ink-4")}>{label}</span>
                  {i < STEPS.length - 1 ? <span className="h-px flex-1 bg-ink/10" aria-hidden /> : null}
                </li>
              ))}
            </ol>

            <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
              {/* Honeypot: invisible to people, irresistible to bots. */}
              <input type="text" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" {...register("company_website")} />

              {step === 0 ? (
                <>
                  <Field label="Shop name">
                    <input autoFocus placeholder="Kandy Gold House" className={cn(controlClass, "w-full")} {...register("shopName")} />
                    <FieldError message={errors.shopName?.message} />
                  </Field>
                  <Field label="Shop address (your sign-in name)">
                    <span className="flex items-center gap-0">
                      <input placeholder="kandy-gold" className={cn(controlClass, "w-full rounded-r-none")} {...register("slug")} />
                    </span>
                    <FieldError message={errors.slug?.message} />
                    {slug ? <p className="mt-1 font-mono text-[11px] text-ink-5">You will sign in at “{slug}”.</p> : null}
                  </Field>
                </>
              ) : null}

              {step === 1 ? (
                <>
                  <Field label="Your name">
                    <input autoFocus placeholder="Amara Perera" className={cn(controlClass, "w-full")} {...register("ownerName")} />
                    <FieldError message={errors.ownerName?.message} />
                  </Field>
                  <Field label="Email">
                    <input type="email" autoComplete="email" placeholder="you@shop.lk" className={cn(controlClass, "w-full")} {...register("ownerEmail")} />
                    <FieldError message={errors.ownerEmail?.message} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Password (10+ characters)">
                      <input type="password" autoComplete="new-password" placeholder="••••••••••" className={cn(controlClass, "w-full")} {...register("password")} />
                      <FieldError message={errors.password?.message} />
                    </Field>
                    <Field label="Phone (optional)">
                      <input placeholder="+94 …" className={cn(controlClass, "w-full")} {...register("phone")} />
                      <FieldError message={errors.phone?.message} />
                    </Field>
                  </div>
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <div className="flex gap-2" role="radiogroup" aria-label="Billing period">
                    {(["MONTH", "YEAR"] as const).map((m) => (
                      <label key={m} className={cn("flex-1 cursor-pointer rounded-xl px-3 py-2 text-center text-sm ring-1", interval === m ? "bg-gold/[0.08] font-medium ring-gold-dark/40" : "ring-ink/10")}>
                        <input type="radio" value={m} {...register("interval")} className="sr-only" />
                        {m === "MONTH" ? "Monthly" : "Yearly"}
                      </label>
                    ))}
                  </div>
                  <div className="space-y-2" role="radiogroup" aria-label="Plan">
                    {plans.map((p) => (
                      <label key={p.id} className="flex cursor-pointer items-start gap-3 rounded-xl px-3.5 py-3 text-sm ring-1 has-checked:bg-gold/[0.08] has-checked:ring-gold-dark/40 ring-ink/10">
                        <input type="radio" value={p.id} {...register("planId")} className="mt-1 accent-[#8a6d1b]" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="font-medium text-ink">{p.name}</span>
                            <span className="g-metric font-semibold text-ink">{price(p)}</span>
                          </span>
                          <span className="mt-0.5 block text-xs leading-relaxed text-ink-4">{p.description}</span>
                          <span className="mt-1 block text-[11px] text-emerald-700">{p.trial_days}-day free trial included</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <FieldError message={errors.planId?.message} />
                </>
              ) : null}

              <div className="flex gap-2 pt-1">
                {step > 0 ? (
                  <button type="button" onClick={() => setStep((s) => s - 1)} className="g-btn h-11 px-4 text-sm">
                    Back
                  </button>
                ) : null}
                {step < 2 ? (
                  <button type="button" onClick={next} className="g-btn g-btn-primary h-11 flex-1 px-4 text-sm">
                    Continue
                    <ArrowRightIcon size={14} className="g-btn-arrow" />
                  </button>
                ) : (
                  <button type="submit" disabled={pending} className="g-btn g-btn-primary h-11 flex-1 px-4 text-sm">
                    {pending ? "Creating your shop…" : "Create my shop"}
                    {!pending && <ArrowRightIcon size={14} className="g-btn-arrow" />}
                  </button>
                )}
              </div>
            </form>

            <p className="mt-6 text-center text-xs text-ink-4">
              Already have a shop?{" "}
              <Link href="/login" className="font-medium text-ink underline underline-offset-2">
                Sign in
              </Link>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
