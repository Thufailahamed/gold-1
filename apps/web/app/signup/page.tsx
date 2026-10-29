"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api, errorCode } from "@/lib/api";
import { writeTenantSlug } from "@/lib/tenant";
import { cn } from "@/lib/cn";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  CreditCardIcon,
  EyeIcon,
  EyeOffIcon,
  GemIcon,
  ShieldIcon,
  SparklesIcon,
  StoreIcon,
  UserCheckIcon,
} from "@/components/icons";

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
  max_products?: number | null;
  features: string[];
};

const STEPS = [
  { label: "Your shop", icon: StoreIcon, title: "Name your shop", sub: "This is how your shop appears on bills, rate cards and the counter TV." },
  { label: "Your account", icon: UserCheckIcon, title: "Create the owner account", sub: "You get full access. Add your staff with their own roles later." },
  { label: "Plan", icon: CreditCardIcon, title: "Choose a plan", sub: "Every plan starts with a free trial. No payment today." },
] as const;

const FEATURE_LABELS: Record<string, string> = {
  pos: "Point of sale",
  oldgold: "Old-gold intake",
  barcode_labels: "Barcode labels",
  multi_branch: "Multiple branches",
  accounts: "Full accounts",
  day_closing: "Day closing",
  analytics: "Analytics",
  repairs: "Repairs",
  custom_orders: "Custom orders",
  manufacturing: "Manufacturing",
  melting: "Melting",
  approvals: "Approvals",
  priority_support: "Priority support",
  api_access: "API access",
};
const featureLabel = (f: string) => FEATURE_LABELS[f] ?? f.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const planKey = (p: Plan) => p.id || p.code;
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
const money = (cents: number) => (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
const limit = (n: number | null | undefined, unit: string) => (n == null ? `Unlimited ${unit}` : `${n.toLocaleString("en-US")} ${n === 1 ? unit.replace(/es$|s$/, "") : unit}`);

/** 0–4 from length and character variety; only a hint, the server enforces the rule. */
function strength(pw: string) {
  if (!pw) return 0;
  let s = pw.length >= 10 ? 1 : 0;
  if (pw.length >= 14) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}
const STRENGTH = [
  { label: "Too short", tone: "bg-rose-500" },
  { label: "Weak", tone: "bg-rose-500" },
  { label: "Fair", tone: "bg-amber-500" },
  { label: "Good", tone: "bg-emerald-500" },
  { label: "Strong", tone: "bg-emerald-600" },
];

/* ------------------------------------------------------------------ inputs */

const inputCls =
  "h-11 w-full rounded-xl bg-paper px-3.5 text-[14px] text-ink placeholder:text-ink-5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)] transition-shadow duration-200 hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.24)] focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.22)]";
const inputErr = "shadow-[inset_0_0_0_1px_#be123c] hover:shadow-[inset_0_0_0_1px_#be123c] focus:shadow-[inset_0_0_0_1px_#be123c,0_0_0_4px_rgba(190,18,60,0.15)]";

function Field({
  id,
  label,
  optional,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  error?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 flex items-center justify-between gap-2 text-[12.5px] font-medium text-ink-2">
        {label}
        {optional ? <span className="text-[11px] font-normal text-ink-5">Optional</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs font-medium text-rose-700">
          {error}
        </p>
      ) : hint ? (
        <div className="mt-1.5 text-[11.5px] text-ink-4">{hint}</div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ brand panel */

function Preview({
  shopName,
  slug,
  ownerName,
  plan,
  interval,
  step,
}: {
  shopName: string;
  slug: string;
  ownerName: string;
  plan: Plan | undefined;
  interval: "MONTH" | "YEAR";
  step: number;
}) {
  const trialEnds = plan ? new Date(Date.now() + plan.trial_days * 86_400_000) : null;
  const initials = (shopName || "Your shop")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const rows: [string, string | null][] = [
    ["Sign-in name", slug || null],
    ["Owner", ownerName || null],
    ["Plan", plan ? `${plan.name} · ${interval === "YEAR" ? "yearly" : "monthly"}` : null],
    ["Trial ends", trialEnds ? trialEnds.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null],
  ];
  return (
    <div className="relative w-full max-w-[22rem]">
      <div className="pointer-events-none absolute -inset-6 rounded-[2rem] bg-gold/10 blur-2xl" aria-hidden />
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-paper/[0.09] to-paper/[0.03] p-5 shadow-[inset_0_0_0_1px_rgba(226,194,122,0.22),0_30px_60px_-30px_rgba(0,0,0,0.6)] backdrop-blur">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-light/70 to-transparent" aria-hidden />
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gold-light to-gold-dark font-display text-[15px] font-extrabold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
            {shopName ? initials : <GemIcon size={18} />}
          </span>
          <div className="min-w-0">
            <div className={cn("truncate font-display text-lg font-bold leading-tight", shopName ? "text-paper" : "text-paper/35")}>
              {shopName || "Your shop"}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-paper/45">
              <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              {step >= 2 ? "Ready to open" : "Setting up"}
            </div>
          </div>
        </div>

        <dl className="mt-5 divide-y divide-paper/[0.07] rounded-xl bg-black/15 px-3.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 py-2.5 text-[12px]">
              <dt className="shrink-0 text-paper/45">{k}</dt>
              <dd className={cn("min-w-0 truncate text-right font-medium", v ? "text-paper" : "text-paper/25")}>
                {v ? (k === "Sign-in name" ? <span className="font-mono">{v}</span> : v) : "—"}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light/70">
          <span>GoldOS workspace</span>
          <span className="g-metric normal-case tracking-normal text-paper/40">{step + 1}/3</span>
        </div>
      </div>
    </div>
  );
}

function BrandPanel(props: React.ComponentProps<typeof Preview>) {
  return (
    <aside className="relative hidden flex-col justify-between overflow-hidden bg-void p-10 text-paper lg:sticky lg:top-0 lg:flex lg:h-dvh xl:p-14">
      <div className="pointer-events-none absolute -right-32 -top-40 size-[30rem] rounded-full bg-gold/[0.16] blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-40 -left-24 size-96 rounded-full bg-emerald-400/10 blur-3xl" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:linear-gradient(rgba(255,255,255,0.7)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.7)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
        aria-hidden
      />

      <Link href="/" className="relative flex w-fit items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-paper/[0.06] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
          <GemIcon size={17} className="text-gold" />
        </span>
        <span className="flex flex-col leading-none">
          <span className="g-display text-base tracking-wide text-paper">
            Gold<span className="text-gold">OS</span>
          </span>
          <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-gold">Jewellery ERP</span>
        </span>
      </Link>

      <div className="relative">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">Free trial · No payment today</div>
        <h2 className="g-display mt-4 max-w-md text-4xl text-paper text-balance xl:text-[2.75rem]">Your shop, live in under a minute.</h2>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-paper/55">
          Board rates, stock, old gold and accounts in one place. Fill in the details and watch your workspace take shape.
        </p>
        <div className="mt-9">
          <Preview {...props} />
        </div>
      </div>

      <div className="relative flex items-center gap-5 text-[11px] text-paper/40">
        <span className="flex items-center gap-1.5">
          <ShieldIcon size={13} className="text-gold/70" />
          Your own isolated database
        </span>
        <span className="flex items-center gap-1.5">
          <SparklesIcon size={13} className="text-gold/70" />
          Set up in under a minute
        </span>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ page */

export default function SignupPage() {
  const [step, setStep] = useState(0);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [pending, setPending] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState<{ slug: string; loginUrl: string; signedIn: boolean } | null>(null);
  // Follow the shop name until the owner edits the address themselves.
  const slugTouched = useRef(false);
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
        // Preselect the middle (most popular) plan when there are three or more.
        const first = d.plans.length >= 3 ? d.plans[1] : d.plans[0];
        if (first && !watch("planId")) setValue("planId", planKey(first));
      })
      .catch(() => {
        setPlans([]);
        toast.error("Could not load plans. Check your connection and reload.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const interval = watch("interval");
  const shopName = watch("shopName") ?? "";
  const slug = watch("slug") ?? "";
  const ownerName = watch("ownerName") ?? "";
  const password = watch("password") ?? "";
  const planId = watch("planId");
  const plan = plans?.find((p) => planKey(p) === planId);
  const score = strength(password);
  const yearlySave = plans?.length
    ? Math.max(...plans.map((p) => (p.price_monthly_cents ? Math.round((1 - p.price_yearly_cents / (p.price_monthly_cents * 12)) * 100) : 0)))
    : 0;

  const shopField = register("shopName");
  const slugField = register("slug");

  async function next() {
    const fields: Array<keyof SignupInput> = step === 0 ? ["shopName", "slug"] : ["ownerName", "ownerEmail", "password", "phone"];
    if (await trigger(fields)) setStep((s) => Math.min(s + 1, 2));
  }

  async function onSubmit(values: SignupInput) {
    setPending(true);
    try {
      const data = await api<{ slug: string; loginUrl: string; sessionId?: string }>("/api/v1/public/signup", {
        method: "POST",
        body: JSON.stringify(values),
      });
      writeTenantSlug(data.slug);
      setDone({ slug: data.slug, loginUrl: data.loginUrl, signedIn: !!data.sessionId });
      toast.success("Your shop is ready");
    } catch (err) {
      if (errorCode(err) === "PROVISIONING") {
        // The shop exists and is still being built: point them at sign in.
        writeTenantSlug(values.slug);
        setDone({ slug: values.slug, loginUrl: `/login?shop=${values.slug}`, signedIn: false });
      } else {
        toast.error(err instanceof Error ? err.message : "Signup failed");
        if (errorCode(err) === "CONFLICT") setStep(0);
      }
    } finally {
      setPending(false);
    }
  }

  function price(p: Plan) {
    const cents = interval === "YEAR" ? p.price_yearly_cents : p.price_monthly_cents;
    return { amount: money(cents), per: interval === "YEAR" ? "/ year" : "/ month", currency: p.currency || "LKR" };
  }

  async function copySlug(s: string) {
    try {
      await navigator.clipboard.writeText(s);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the name is on screen anyway */
    }
  }

  const meta = STEPS[step]!;

  return (
    <main className="grid min-h-dvh bg-bone lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <BrandPanel shopName={shopName.trim()} slug={slug} ownerName={ownerName.trim()} plan={plan} interval={interval} step={done ? 2 : step} />

      <section className="relative flex min-w-0 flex-col px-4 py-8 sm:px-8 lg:px-12">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-gold-pale to-transparent" aria-hidden />

        {/* Top bar */}
        <div className="relative mx-auto flex w-full max-w-[34rem] items-center justify-between">
          <Link href="/" className="flex items-center gap-2 lg:invisible">
            <span className="flex size-8 items-center justify-center rounded-lg bg-void">
              <GemIcon size={15} className="text-gold" />
            </span>
            <span className="g-display text-[17px] text-ink">
              Gold<span className="text-gold-dark">OS</span>
            </span>
          </Link>
          <p className="text-[12.5px] text-ink-4">
            Have a shop?{" "}
            <Link href="/login" className="font-semibold text-ink underline decoration-gold/60 underline-offset-4 hover:decoration-ink">
              Sign in
            </Link>
          </p>
        </div>

        <div className="relative mx-auto flex w-full max-w-[34rem] flex-1 flex-col justify-start pb-8 pt-10 sm:justify-center sm:py-8">
          {done ? (
            <div className="animate-fade-in text-center">
              <div className="relative mx-auto flex size-20 items-center justify-center">
                <span className="absolute inset-0 animate-ping rounded-full bg-gold/20 [animation-iteration-count:2]" aria-hidden />
                <span className="relative flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-gold-light to-gold-dark shadow-[0_18px_40px_-14px_rgba(168,138,62,0.8),inset_0_1px_0_rgba(255,255,255,0.5)]">
                  <CheckIcon size={34} className="text-void" />
                </span>
              </div>
              <div className="g-kicker mt-7">{done.signedIn ? "All set" : "Almost there"}</div>
              <h1 className="g-display mt-2 text-[2.1rem] text-ink text-balance">
                {done.signedIn ? `${shopName.trim() || "Your shop"} is ready` : "Your shop is being prepared"}
              </h1>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-4">
                {done.signedIn
                  ? "You're signed in as the owner. Your free trial has started."
                  : "This usually takes under a minute. Sign in with the name below once it's ready."}
              </p>

              <div className="mx-auto mt-7 flex max-w-sm items-center gap-3 rounded-2xl bg-paper p-3 pl-4 text-left shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2),0_16px_36px_-24px_rgba(16,32,27,0.4)]">
                <div className="min-w-0 flex-1">
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">Your sign-in name</div>
                  <div className="mt-0.5 truncate font-mono text-[15px] font-semibold text-ink">{done.slug}</div>
                </div>
                <button
                  type="button"
                  onClick={() => copySlug(done.slug)}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-ink/[0.05] px-3 text-[12px] font-semibold text-ink-2 transition-colors hover:bg-ink/[0.09]"
                >
                  {copied ? <CheckIcon size={13} className="text-emerald-700" /> : <CopyIcon size={13} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-2 text-[11.5px] text-ink-5">Saved on this device. Staff use it to find your shop at sign in.</p>

              <div className="mx-auto mt-8 flex max-w-sm flex-col gap-2">
                {done.signedIn ? (
                  <>
                    <Link href="/dashboard" className="g-btn g-btn-primary h-12 w-full rounded-xl text-[14px]">
                      Open my shop
                      <ArrowRightIcon size={15} className="g-btn-arrow" />
                    </Link>
                    <Link href="/settings" className="g-btn h-11 w-full rounded-xl text-[13px] text-ink-3 hover:bg-ink/[0.04] hover:text-ink">
                      Set up branches and staff first
                    </Link>
                  </>
                ) : (
                  <Link href={done.loginUrl} className="g-btn g-btn-primary h-12 w-full rounded-xl text-[14px]">
                    Go to sign in
                    <ArrowRightIcon size={15} className="g-btn-arrow" />
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Progress */}
              <ol className="grid grid-cols-3 gap-2.5" aria-label="Signup progress">
                {STEPS.map((s, i) => {
                  const state = i < step ? "done" : i === step ? "current" : "todo";
                  return (
                    <li key={s.label} className="min-w-0">
                      <button
                        type="button"
                        disabled={i >= step}
                        onClick={() => setStep(i)}
                        aria-current={state === "current" ? "step" : undefined}
                        className="group w-full text-left disabled:cursor-default"
                      >
                        <span className="block h-1 overflow-hidden rounded-full bg-ink/[0.08]">
                          <span
                            className={cn(
                              "block h-full rounded-full bg-gradient-to-r from-gold-dark to-gold transition-[width] duration-500 ease-out",
                              state === "todo" ? "w-0" : "w-full"
                            )}
                          />
                        </span>
                        <span
                          className={cn(
                            "mt-2 flex items-center gap-1.5 truncate text-[11.5px] font-semibold",
                            state === "current" ? "text-ink" : state === "done" ? "text-ink-3 group-hover:text-ink" : "text-ink-5"
                          )}
                        >
                          {state === "done" ? (
                            <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                              <CheckIcon size={9} />
                            </span>
                          ) : (
                            <span className="g-metric shrink-0 text-ink-5">0{i + 1}</span>
                          )}
                          <span className="truncate">{s.label}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>

              {/* Heading */}
              <div key={`h${step}`} className="mt-9 animate-fade-in">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.3)]">
                    <meta.icon size={14} />
                  </span>
                  <span className="g-kicker">
                    Step {step + 1} of {STEPS.length}
                  </span>
                </div>
                <h1 className="g-display mt-3 text-[2rem] text-ink sm:text-[2.25rem]">{meta.title}</h1>
                <p className="mt-2 text-sm leading-relaxed text-ink-4">{meta.sub}</p>
              </div>

              <form
                onSubmit={
                  step < 2
                    ? (e) => {
                        // Enter on an early step moves on instead of validating the whole form.
                        e.preventDefault();
                        next();
                      }
                    : handleSubmit(onSubmit)
                }
                noValidate
                className="mt-7"
              >
                {/* Honeypot: invisible to people, irresistible to bots. */}
                <input type="text" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" {...register("company_website")} />

                <div key={`s${step}`} className="animate-fade-in space-y-5">
                  {step === 0 ? (
                    <>
                      <Field id="shopName" label="Shop name" error={errors.shopName?.message}>
                        <input
                          id="shopName"
                          autoFocus
                          autoComplete="organization"
                          placeholder="Kandy Gold House"
                          aria-invalid={!!errors.shopName}
                          className={cn(inputCls, errors.shopName && inputErr)}
                          {...shopField}
                          onChange={(e) => {
                            shopField.onChange(e);
                            if (!slugTouched.current) setValue("slug", slugify(e.target.value), { shouldValidate: !!errors.slug });
                          }}
                        />
                      </Field>
                      <Field
                        id="slug"
                        label="Sign-in name"
                        error={errors.slug?.message}
                        hint={
                          slug ? (
                            <span className="flex items-center gap-1.5">
                              <CheckIcon size={12} className="text-emerald-600" />
                              You and your staff sign in at <span className="font-mono font-semibold text-ink-2">{slug}</span>
                            </span>
                          ) : (
                            "Short and memorable. Lowercase letters, digits and dashes."
                          )
                        }
                      >
                        <div className="relative">
                          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 font-mono text-[13px] text-ink-5">@</span>
                          <input
                            id="slug"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="kandy-gold"
                            aria-invalid={!!errors.slug}
                            className={cn(inputCls, "pl-8 font-mono text-[13.5px]", errors.slug && inputErr)}
                            {...slugField}
                            onChange={(e) => {
                              slugTouched.current = e.target.value !== "";
                              e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
                              slugField.onChange(e);
                            }}
                          />
                        </div>
                      </Field>
                    </>
                  ) : null}

                  {step === 1 ? (
                    <>
                      <Field id="ownerName" label="Your name" error={errors.ownerName?.message}>
                        <input
                          id="ownerName"
                          autoFocus
                          autoComplete="name"
                          placeholder="Amara Perera"
                          aria-invalid={!!errors.ownerName}
                          className={cn(inputCls, errors.ownerName && inputErr)}
                          {...register("ownerName")}
                        />
                      </Field>
                      <Field id="ownerEmail" label="Email" error={errors.ownerEmail?.message}>
                        <input
                          id="ownerEmail"
                          type="email"
                          autoComplete="email"
                          placeholder="you@shop.lk"
                          aria-invalid={!!errors.ownerEmail}
                          className={cn(inputCls, errors.ownerEmail && inputErr)}
                          {...register("ownerEmail")}
                        />
                      </Field>
                      <Field
                        id="password"
                        label="Password"
                        error={errors.password?.message}
                        hint={
                          <span className="flex items-center gap-3">
                            <span className="grid flex-1 grid-cols-4 gap-1" aria-hidden>
                              {[1, 2, 3, 4].map((n) => (
                                <span key={n} className={cn("h-1 rounded-full transition-colors", password && score >= n ? STRENGTH[score]!.tone : "bg-ink/[0.08]")} />
                              ))}
                            </span>
                            <span className="w-24 shrink-0 text-right">{password ? (password.length < 10 ? `${10 - password.length} more characters` : STRENGTH[score]!.label) : "10+ characters"}</span>
                          </span>
                        }
                      >
                        <div className="relative">
                          <input
                            id="password"
                            type={showPw ? "text" : "password"}
                            autoComplete="new-password"
                            placeholder="At least 10 characters"
                            aria-invalid={!!errors.password}
                            className={cn(inputCls, "pr-11", errors.password && inputErr)}
                            {...register("password")}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPw((v) => !v)}
                            aria-label={showPw ? "Hide password" : "Show password"}
                            aria-pressed={showPw}
                            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-5 transition-colors hover:text-ink"
                          >
                            {showPw ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                          </button>
                        </div>
                      </Field>
                      <Field id="phone" label="Phone" optional error={errors.phone?.message}>
                        <input id="phone" type="tel" autoComplete="tel" placeholder="+94 77 123 4567" className={cn(inputCls, errors.phone && inputErr)} {...register("phone")} />
                      </Field>
                    </>
                  ) : null}

                  {step === 2 ? (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div className="relative grid grid-cols-2 rounded-xl bg-ink/[0.05] p-1" role="radiogroup" aria-label="Billing period">
                          <span
                            className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-lg bg-paper shadow-[0_1px_3px_rgba(16,32,27,0.12),inset_0_0_0_1px_rgba(16,32,27,0.2)] transition-transform duration-300 ease-out"
                            style={{ transform: interval === "YEAR" ? "translateX(100%)" : "none" }}
                            aria-hidden
                          />
                          {(["MONTH", "YEAR"] as const).map((m) => (
                            <label
                              key={m}
                              className={cn(
                                "relative z-10 cursor-pointer rounded-lg px-4 py-1.5 text-center text-[12.5px] font-semibold transition-colors",
                                interval === m ? "text-ink" : "text-ink-4 hover:text-ink-2"
                              )}
                            >
                              <input type="radio" value={m} {...register("interval")} className="sr-only" />
                              {m === "MONTH" ? "Monthly" : "Yearly"}
                            </label>
                          ))}
                        </div>
                        {yearlySave > 0 ? (
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                              interval === "YEAR" ? "bg-emerald-600/10 text-emerald-700" : "bg-gold/15 text-gold-deep"
                            )}
                          >
                            {interval === "YEAR" ? `You save ${yearlySave}%` : `Save ${yearlySave}% yearly`}
                          </span>
                        ) : null}
                      </div>

                      <div className="space-y-2.5" role="radiogroup" aria-label="Plan">
                        {plans === null
                          ? [0, 1, 2].map((i) => <div key={i} className="h-[7.5rem] animate-pulse rounded-2xl bg-ink/[0.05]" />)
                          : plans.map((p, idx) => {
                              const key = planKey(p);
                              const on = planId === key;
                              const popular = plans.length >= 3 && idx === 1;
                              const pr = price(p);
                              const shown = p.features.slice(0, 4);
                              return (
                                <label
                                  key={key || `plan-${idx}`}
                                  className={cn(
                                    "relative block cursor-pointer rounded-2xl p-4 transition-all duration-200",
                                    on
                                      ? "bg-gold-pale shadow-[inset_0_0_0_1.5px_#a88a3e,0_14px_30px_-20px_rgba(126,98,35,0.55)]"
                                      : "bg-paper shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)] hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.22)]"
                                  )}
                                >
                                  <input type="radio" value={key} {...register("planId")} className="sr-only" />
                                  <div className="flex items-start gap-3">
                                    <span
                                      className={cn(
                                        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full transition-colors",
                                        on ? "bg-void text-gold-light" : "shadow-[inset_0_0_0_1.5px_rgba(16,32,27,0.2)]"
                                      )}
                                      aria-hidden
                                    >
                                      {on ? <CheckIcon size={11} /> : null}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                                        <div className="flex min-w-0 items-center gap-2">
                                          <span className="text-[15px] font-semibold text-ink">{p.name}</span>
                                          {popular ? (
                                            <span className="rounded-full bg-void px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.12em] text-gold-light">Popular</span>
                                          ) : null}
                                        </div>
                                        <div className="shrink-0 text-right leading-none">
                                          <span className="text-[11px] font-semibold text-ink-4">{pr.currency} </span>
                                          <span className="g-metric text-[19px] font-semibold text-ink">{pr.amount}</span>
                                          <span className="text-[11.5px] text-ink-4"> {pr.per}</span>
                                        </div>
                                      </div>
                                      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-4">{p.description}</p>
                                      <div className="mt-3 flex flex-wrap gap-1.5">
                                        {[limit(p.max_users, "users"), limit(p.max_branches, "branches")].map((t) => (
                                          <span key={t} className="rounded-md bg-void/[0.06] px-2 py-0.5 text-[11px] font-semibold text-ink-2">
                                            {t}
                                          </span>
                                        ))}
                                        {shown.map((f) => (
                                          <span key={f} className="rounded-md bg-ink/[0.04] px-2 py-0.5 text-[11px] text-ink-3">
                                            {featureLabel(f)}
                                          </span>
                                        ))}
                                        {p.features.length > shown.length ? (
                                          <span
                                            className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-gold-deep"
                                            title={p.features.slice(shown.length).map(featureLabel).join(", ")}
                                          >
                                            +{p.features.length - shown.length} more
                                          </span>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                </label>
                              );
                            })}
                        {plans?.length === 0 ? (
                          <p className="rounded-2xl bg-paper p-4 text-sm text-ink-4 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)]">No plans are available right now. Reload the page to try again.</p>
                        ) : null}
                      </div>
                      {errors.planId?.message ? (
                        <p role="alert" className="text-xs font-medium text-rose-700">
                          {errors.planId.message}
                        </p>
                      ) : null}

                      {plan ? (
                        <div className="flex items-start gap-3 rounded-xl bg-emerald-600/[0.06] px-4 py-3 text-[12.5px] leading-relaxed text-emerald-900 shadow-[inset_0_0_0_1px_rgba(5,150,105,0.15)]">
                          <SparklesIcon size={15} className="mt-0.5 shrink-0 text-emerald-700" />
                          <span>
                            <strong className="font-semibold">Free for {plan.trial_days} days.</strong> After that, {price(plan).currency} {price(plan).amount} {price(plan).per}. No payment is taken during the trial.
                          </span>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>

                <div className="mt-8 flex items-center gap-2.5">
                  {step > 0 ? (
                    <button
                      type="button"
                      onClick={() => setStep((s) => s - 1)}
                      aria-label="Back"
                      className="g-btn h-12 w-12 shrink-0 rounded-xl bg-paper text-ink-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)] hover:text-ink hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.3)]"
                    >
                      <ArrowLeftIcon size={16} />
                    </button>
                  ) : null}
                  {step < 2 ? (
                    <button type="submit" className="g-btn g-btn-primary h-12 flex-1 rounded-xl px-4 text-[14px]">
                      Continue
                      <ArrowRightIcon size={15} className="g-btn-arrow" />
                    </button>
                  ) : (
                    <button type="submit" disabled={pending || !plans?.length} className="g-btn g-btn-primary h-12 flex-1 rounded-xl px-4 text-[14px]">
                      {pending ? (
                        <>
                          <span className="size-4 animate-spin rounded-full border-2 border-paper/30 border-t-gold" aria-hidden />
                          Creating your shop…
                        </>
                      ) : (
                        <>
                          Start free trial
                          <ArrowRightIcon size={15} className="g-btn-arrow" />
                        </>
                      )}
                    </button>
                  )}
                </div>
              </form>
            </>
          )}
        </div>

        <p className="relative mx-auto flex w-full max-w-[34rem] items-center justify-center gap-1.5 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-ink-5">
          <ShieldIcon size={11} />
          Encrypted · Your data stays yours
        </p>
      </section>
    </main>
  );
}
