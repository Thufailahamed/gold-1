import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { HomeNav, Reveal, SpotlightCard } from "@/components/home/motion";
import { ModuleExplorer } from "@/components/home/module-explorer";
import {
  AuditShield,
  Barcode,
  BranchNetwork,
  FooterWordmark,
  HeroEmblem,
  IngotStack,
  LedgerScale,
  LifecycleFlow,
  RateChart,
  ScanIllustration,
} from "@/components/home/illustrations";
import {
  ArrowRightIcon,
  Building2Icon,
  CheckIcon,
  ClipboardCheckIcon,
  CreditCardIcon,
  FlaskConicalIcon,
  GemIcon,
  HammerIcon,
  HistoryIcon,
  ScaleIcon,
  ScanBarcodeIcon,
  ShieldIcon,
  StoreIcon,
  TrendingUpIcon,
  TruckIcon,
} from "@/components/icons";

export const metadata: Metadata = {
  title: "GoldOS — Jewellery ERP for Sri Lankan gold businesses",
  description:
    "Live per-karat pricing, barcode-first inventory, old-gold intake, melting, manufacturing and a dual gold + money ledger in one console.",
};

type IconCmp = (props: { size?: number | string; className?: string }) => ReactNode;

const MARQUEE = [
  "Per-karat board rates",
  "Barcode-first catalog",
  "Old-gold intake & testing",
  "Melting batches",
  "Manufacturing WIP",
  "Point of sale",
  "Sales returns",
  "Cash & bank",
  "Expense approvals",
  "Day closing",
  "Append-only audit",
  "Multi-branch stock",
];

const STATS = [
  { value: "2", label: "Ledgers", desc: "Gold in grams and money in LKR, reconciled separately." },
  { value: "100%", label: "Audited writes", desc: "Every business write lands with its audit row, atomically." },
  { value: "ΣDR=ΣCR", label: "Balanced books", desc: "Each journal entry is validated before it can post." },
  { value: "1", label: "Console", desc: "Every counter, vault and branch in one workspace." },
];

const STEPS: { title: string; desc: string; icon: IconCmp; chips: string[] }[] = [
  {
    title: "Acquire",
    desc: "Supplier invoices and walk-in old gold, weighed and valued at the day's board rate.",
    icon: TruckIcon,
    chips: ["Purchases", "Old gold"],
  },
  {
    title: "Refine",
    desc: "Test purity, melt lots into batches and post wastage and recovery to the gold ledger.",
    icon: FlaskConicalIcon,
    chips: ["Testing", "Melting"],
  },
  {
    title: "Craft",
    desc: "Issue fine gold to manufacturing orders and receive finished, barcoded pieces.",
    icon: HammerIcon,
    chips: ["Manufacturing", "Labels"],
  },
  {
    title: "Sell",
    desc: "Scan at the counter, price live per karat, invoice and handle returns cleanly.",
    icon: CreditCardIcon,
    chips: ["POS", "Returns"],
  },
  {
    title: "Close",
    desc: "Reconcile cash and bank, clear pending approvals and lock the day.",
    icon: ClipboardCheckIcon,
    chips: ["Day closing", "Approvals"],
  },
];

function Kicker({ children, tone = "dark" }: { children: ReactNode; tone?: "dark" | "light" }) {
  return (
    <span
      className={
        tone === "dark"
          ? "inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/[0.07] px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-light"
          : "inline-flex items-center gap-2 rounded-full border border-gold-dark/20 bg-gold-pale px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-deep"
      }
    >
      <GemIcon size={12} />
      {children}
    </span>
  );
}

function IconBadge({ icon: Icon, tone = "dark" }: { icon: IconCmp; tone?: "dark" | "light" }) {
  return (
    <span
      className={
        tone === "dark"
          ? "flex size-11 items-center justify-center rounded-xl bg-gradient-to-b from-gold/25 to-gold/5 text-gold-light shadow-[inset_0_0_0_1px_rgba(231,198,90,0.3)]"
          : "flex size-11 items-center justify-center rounded-xl bg-gradient-to-b from-gold-soft to-gold-pale text-gold-deep shadow-[inset_0_0_0_1px_rgba(168,134,27,0.22)]"
      }
    >
      <Icon size={19} />
    </span>
  );
}

function FeatureCard({
  icon,
  title,
  desc,
  children,
  className,
  delay = 0,
}: {
  icon: IconCmp;
  title: string;
  desc: string;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <Reveal delay={delay} className={className}>
      <SpotlightCard className="flex flex-col">
        <div className="relative m-2 overflow-hidden rounded-2xl bg-black/30 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
          {children}
        </div>
        <div className="flex flex-1 flex-col p-6 pt-4">
          <div className="flex items-center gap-3">
            <IconBadge icon={icon} />
            <h3 className="text-lg font-semibold text-paper">{title}</h3>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-paper/55 text-pretty">{desc}</p>
        </div>
      </SpotlightCard>
    </Reveal>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden pb-24 pt-32 lg:pb-32 lg:pt-40">
      <div className="home-grid-bg pointer-events-none absolute inset-0" />
      <div className="home-drift pointer-events-none absolute -right-40 -top-40 size-[40rem] rounded-full bg-gold/20 blur-[140px]" />
      <div
        className="home-drift pointer-events-none absolute -bottom-60 -left-40 size-[34rem] rounded-full bg-gold-deep/25 blur-[140px]"
        style={{ animationDelay: "-9s" }}
      />
      <div className="home-noise pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-void" />

      <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="text-center lg:text-left">
          <Reveal>
            <span className="inline-flex items-center gap-2.5 rounded-full border border-paper/10 bg-paper/[0.04] py-1.5 pl-2 pr-4 text-xs text-paper/70 backdrop-blur">
              <span className="relative flex size-5 items-center justify-center rounded-full bg-emerald-500/15">
                <span className="absolute size-2 animate-ping rounded-full bg-emerald-400/60" />
                <span className="size-1.5 rounded-full bg-emerald-400" />
              </span>
              Jewellery ERP · Built for Sri Lanka
            </span>
          </Reveal>

          <Reveal delay={80}>
            <h1 className="g-display mt-7 text-[2.25rem] text-paper sm:text-5xl md:text-6xl lg:text-[3.6rem] xl:text-[4rem]">
              Every gram.
              <br />
              Every rupee.
              <br />
              <span className="home-gold-text">Accounted for.</span>
            </h1>
          </Reveal>

          <Reveal delay={160}>
            <p className="mx-auto mt-7 max-w-lg text-base leading-relaxed text-paper/60 text-pretty sm:text-lg lg:mx-0">
              GoldOS runs your showroom, vault and workshop on one console — live per-karat pricing,
              barcode-first stock, old gold to finished piece, and books that always balance.
            </p>
          </Reveal>

          <Reveal delay={240}>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
              <Link href="/login" className="home-btn-gold h-12 px-7 text-[15px]">
                Sign in to your branch
                <ArrowRightIcon size={16} />
              </Link>
              <a href="#features" className="home-btn-ghost h-12 px-7 text-[15px]">
                Explore features
              </a>
            </div>
          </Reveal>

          <Reveal delay={320}>
            <ul className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-paper/50 lg:justify-start">
              {["Dual gold + cash ledger", "Audit on every write", "Role-based access"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <span className="flex size-4 items-center justify-center rounded-full bg-gold/15 text-gold">
                    <CheckIcon size={10} strokeWidth={3} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        <Reveal delay={200} className="relative mx-auto aspect-square w-full max-w-[540px]">
          <HeroEmblem className="size-full" />

          <div className="home-glass home-float absolute -left-2 top-6 hidden w-52 p-4 sm:block lg:-left-10">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light/80">22K · Net weight</div>
            <div className="g-metric mt-2 text-2xl text-paper">8.420 g</div>
            <div className="g-metric mt-0.5 text-xs text-paper/50">× 91.6% purity</div>
            <div className="my-3 h-px bg-gradient-to-r from-gold/40 to-transparent" />
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-paper/50">Fine gold</span>
              <span className="g-metric text-base text-gold-light">7.713 g</span>
            </div>
          </div>

          <div
            className="home-glass home-float absolute -right-2 top-[46%] hidden w-56 p-4 sm:block lg:-right-8"
            style={{ animationDelay: "-2.5s" }}
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-paper/60">
                <ScanBarcodeIcon size={12} className="text-gold" />
                Scan
              </span>
              <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                In stock
              </span>
            </div>
            <Barcode className="mt-3 h-12 w-full text-paper/90" height={48} />
            <div className="g-metric mt-2 text-center text-[11px] tracking-[0.3em] text-paper/70">JW-M2Q39H</div>
          </div>

          <div
            className="home-glass home-float absolute bottom-4 left-4 flex items-center gap-3 px-4 py-3 lg:bottom-8"
            style={{ animationDelay: "-4.5s" }}
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
              <CheckIcon size={16} strokeWidth={3} />
            </span>
            <span>
              <span className="block text-sm font-medium text-paper">Journal balanced</span>
              <span className="g-metric block text-[11px] text-paper/50">ΣDR = ΣCR · posted atomically</span>
            </span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Marquee() {
  return (
    <div className="home-marquee relative overflow-hidden border-y border-paper/[0.06] bg-paper/[0.015] py-5">
      <div className="home-marquee-track flex w-max items-center">
        {[0, 1].map((dup) => (
          <div key={dup} className="flex items-center" aria-hidden={dup === 1}>
            {MARQUEE.map((m) => (
              <span key={m} className="flex items-center gap-6 px-6 text-sm font-medium uppercase tracking-[0.16em] text-paper/45">
                {m}
                <GemIcon size={12} className="text-gold/70" />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Stats() {
  return (
    <section className="relative mx-auto max-w-6xl px-6 py-24">
      <div className="grid gap-px overflow-hidden rounded-3xl bg-paper/[0.07] sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((s, i) => (
          <Reveal key={s.label} delay={i * 90} className="bg-void">
            <div className="group relative h-full p-8 transition-colors duration-320 hover:bg-paper/[0.02]">
              <div className="absolute inset-x-8 top-0 h-px scale-x-0 bg-gradient-to-r from-transparent via-gold to-transparent transition-transform duration-500 ease-brand group-hover:scale-x-100" />
              <div className="g-display home-gold-text text-4xl lg:text-[2.6rem]">{s.value}</div>
              <div className="mt-4 text-sm font-semibold text-paper">{s.label}</div>
              <p className="mt-1.5 text-sm leading-relaxed text-paper/50">{s.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="relative scroll-mt-24 pb-32">
      <div className="pointer-events-none absolute left-1/2 top-40 size-[50rem] -translate-x-1/2 rounded-full bg-gold/[0.07] blur-[160px]" />
      <div className="relative mx-auto max-w-6xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Kicker>Built for the counter and the vault</Kicker>
          <h2 className="g-display mt-6 text-4xl text-paper text-balance sm:text-5xl">
            Premium tooling for a <span className="home-gold-text">precious</span> business.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-paper/55 text-pretty">
            Gold is a first-class asset in GoldOS, not a product quantity. Gross, stone, net and fine
            weight travel with every movement — from the scale to the ledger.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-5 lg:grid-cols-6">
          <FeatureCard
            className="lg:col-span-4"
            icon={TrendingUpIcon}
            title="Live per-karat pricing"
            desc="Publish board rates once and every piece re-prices by karat, net weight and making charge — on the shelf, the label and the POS."
          >
            <div className="relative px-6 pb-2 pt-6">
              <div className="flex flex-wrap gap-2">
                {["24K", "22K", "21K", "18K"].map((k, i) => (
                  <span
                    key={k}
                    className={
                      i === 1
                        ? "g-metric rounded-full bg-gold px-3 py-1 text-xs font-semibold text-void"
                        : "g-metric rounded-full bg-paper/[0.06] px-3 py-1 text-xs text-paper/60 ring-1 ring-paper/10"
                    }
                  >
                    {k}
                  </span>
                ))}
                <span className="ml-auto flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-emerald-300/80">
                  <span className="size-1.5 animate-pulse-soft rounded-full bg-emerald-400" />
                  Board rate live
                </span>
              </div>
              <RateChart className="mt-4 h-44 w-full" />
            </div>
          </FeatureCard>

          <FeatureCard
            className="lg:col-span-2"
            delay={90}
            icon={ScanBarcodeIcon}
            title="Barcode-first stock"
            desc="Every piece gets a unique JW- code and a printable Code128 label. USB and Bluetooth scanners just work."
          >
            <ScanIllustration className="h-56 w-full" />
          </FeatureCard>

          <FeatureCard
            className="lg:col-span-2"
            icon={ScaleIcon}
            title="Dual ledger"
            desc="A sale posts invoice, payment, stock, gold and revenue in one atomic batch. If any step fails, everything rolls back."
          >
            <LedgerScale className="h-52 w-full" />
          </FeatureCard>

          <FeatureCard
            className="lg:col-span-2"
            delay={90}
            icon={FlaskConicalIcon}
            title="Old gold, fully traced"
            desc="Intake, purity testing and melting batches link back to the gold ledger, so each gram keeps its lineage."
          >
            <LifecycleFlow className="h-52 w-full" />
          </FeatureCard>

          <FeatureCard
            className="lg:col-span-2"
            delay={180}
            icon={ShieldIcon}
            title="Audit & approvals"
            desc="Role-based permissions, approval gates for sensitive actions and an append-only audit trail of every change."
          >
            <AuditShield className="h-52 w-full" />
          </FeatureCard>

          <Reveal className="lg:col-span-6">
            <SpotlightCard>
              <div className="grid items-center gap-8 p-8 md:grid-cols-2 md:p-10">
                <div>
                  <IconBadge icon={Building2Icon} />
                  <h3 className="g-display mt-5 text-3xl text-paper">One console, every branch.</h3>
                  <p className="mt-3 max-w-md text-sm leading-relaxed text-paper/55">
                    Switch branches in a click. Stock, rates, cash and closings stay scoped per branch while
                    head office sees the whole picture.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    {["Branch-scoped stock", "Per-branch day closing", "Consolidated reports"].map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-paper/[0.05] px-3 py-1.5 text-xs text-paper/65 ring-1 ring-paper/10"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl bg-black/30 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
                  <BranchNetwork className="h-56 w-full" />
                </div>
              </div>
            </SpotlightCard>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Workflow() {
  return (
    <section id="workflow" className="relative scroll-mt-16 rounded-t-[2.5rem] bg-bone py-28 text-ink sm:rounded-t-[3.5rem]">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Kicker tone="light">From counter to crucible</Kicker>
          <h2 className="g-display mt-6 text-4xl text-ink text-balance sm:text-5xl">
            The whole life of your gold, in five moves.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-ink-4 text-pretty">
            Each step hands off to the next with weights, purity and value intact — no re-keying, no
            spreadsheets, no gaps in the trail.
          </p>
        </Reveal>

        <div className="relative mt-20">
          <svg
            className="pointer-events-none absolute inset-x-0 top-[28px] hidden h-10 w-full lg:block"
            viewBox="0 0 1000 40"
            preserveAspectRatio="none"
            aria-hidden
          >
            <defs>
              <linearGradient id="wf-line" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1000" y2="0">
                <stop offset="0" stopColor="#C9A227" stopOpacity="0" />
                <stop offset="0.15" stopColor="#C9A227" />
                <stop offset="0.85" stopColor="#C9A227" />
                <stop offset="1" stopColor="#C9A227" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M0 20 H1000" stroke="rgba(28,25,23,0.08)" strokeWidth="2" />
            <path d="M0 20 H1000" stroke="url(#wf-line)" strokeWidth="2" className="home-flow" />
          </svg>

          <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 110}>
                <SpotlightCard tone="light" className="p-6">
                  <div className="flex items-center justify-between">
                    <span className="relative flex size-12 items-center justify-center rounded-full bg-void text-gold-light shadow-[0_0_0_6px_#fafaf9,0_12px_24px_-8px_rgba(140,109,31,0.6)]">
                      <s.icon size={19} />
                    </span>
                    <span className="g-metric text-3xl text-ink/10">0{i + 1}</span>
                  </div>
                  <h3 className="mt-6 text-xl font-bold text-ink">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-4">{s.desc}</p>
                  <div className="mt-5 flex flex-wrap gap-1.5">
                    {s.chips.map((c) => (
                      <span
                        key={c}
                        className="rounded-md bg-gold-pale px-2 py-1 text-[11px] font-medium text-gold-deep ring-1 ring-gold-dark/15"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </SpotlightCard>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Modules() {
  return (
    <section id="modules" className="relative scroll-mt-16 overflow-hidden bg-bone pb-28 text-ink">
      <div className="pointer-events-none absolute -left-40 top-20 size-[32rem] rounded-full bg-gold/[0.12] blur-[130px]" />
      <div className="relative mx-auto max-w-6xl px-6">
        <Reveal className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-xl">
            <Kicker tone="light">Modules</Kicker>
            <h2 className="g-display mt-6 text-4xl text-ink text-balance sm:text-5xl">
              Everything your showroom <span className="home-gold-text">runs on.</span>
            </h2>
          </div>
          <div className="max-w-sm">
            <p className="text-sm leading-relaxed text-ink-4">
              Four workspaces, one login. Permission-aware and branch-scoped, so staff only see what their
              role allows.
            </p>
            <div className="mt-4 flex items-center gap-5">
              {[
                { v: "04", l: "Workspaces" },
                { v: "21", l: "Modules" },
                { v: "40+", l: "Screens" },
              ].map((s) => (
                <span key={s.l} className="flex items-baseline gap-1.5">
                  <span className="g-metric text-lg text-ink">{s.v}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-5">{s.l}</span>
                </span>
              ))}
            </div>
          </div>
        </Reveal>

        <Reveal delay={120} className="mt-14">
          <ModuleExplorer />
        </Reveal>
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className="bg-bone px-4 pb-24 sm:px-6">
      <Reveal className="mx-auto max-w-6xl">
        <div className="relative overflow-hidden rounded-[2.5rem] bg-void px-8 py-16 text-paper shadow-5 sm:px-14 lg:py-20">
          <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-70" />
          <div className="home-drift pointer-events-none absolute -right-20 -top-32 size-[30rem] rounded-full bg-gold/25 blur-[120px]" />
          <div className="home-noise pointer-events-none absolute inset-0" />

          <div className="relative grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <Kicker>Ready when your counter is</Kicker>
              <h2 className="g-display mt-6 text-4xl text-balance sm:text-6xl">
                Open the <span className="home-gold-text">console.</span>
              </h2>
              <p className="mt-5 max-w-md text-base leading-relaxed text-paper/60">
                Sign in with your branch credentials and pick up exactly where the last shift left off.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link href="/login" className="home-btn-gold h-12 px-7 text-[15px]">
                  Sign in
                  <ArrowRightIcon size={16} />
                </Link>
                <Link href="/dashboard" className="home-btn-ghost h-12 px-7 text-[15px]">
                  Go to dashboard
                </Link>
              </div>
            </div>
            <IngotStack className="mx-auto w-full max-w-md" />
          </div>
        </div>
      </Reveal>
    </section>
  );
}

const FOOTER_COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Workflow", href: "#workflow" },
      { label: "Modules", href: "#modules" },
    ],
  },
  {
    title: "Operations",
    links: [
      { label: "Point of Sale", href: "/pos" },
      { label: "Old Gold", href: "/old-gold/items" },
      { label: "Manufacturing", href: "/manufacturing/orders" },
      { label: "Gold Ledger", href: "/gold/ledger" },
    ],
  },
  {
    title: "Console",
    links: [
      { label: "Sign in", href: "/login" },
      { label: "Dashboard", href: "/dashboard" },
      { label: "Scan a barcode", href: "/scan" },
      { label: "Gold rates", href: "/gold-rates" },
    ],
  },
];

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  const cls =
    "group inline-flex items-center text-sm text-paper/55 transition-colors duration-200 hover:text-paper";
  const inner = (
    <>
      <span className="h-px w-0 bg-gold transition-all duration-320 ease-brand group-hover:mr-2 group-hover:w-3" />
      {children}
    </>
  );
  return href.startsWith("#") ? (
    <a href={href} className={cls}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}

function Footer() {
  return (
    <footer className="bg-bone">
      <div className="relative overflow-hidden rounded-t-[2.5rem] bg-void text-paper sm:rounded-t-[3.5rem]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
        <div className="home-drift pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-gold/[0.12] blur-[140px]" />
        <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-50" />
        <div className="home-noise pointer-events-none absolute inset-0" />

        <div className="relative mx-auto max-w-6xl px-6 pt-20">
          <div className="grid gap-14 lg:grid-cols-[1.4fr_2fr]">
            <div>
              <Link href="/" className="inline-flex items-center gap-2.5" aria-label="GoldOS home">
                <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold-deep shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_10px_30px_-10px_rgba(201,162,39,0.7)]">
                  <GemIcon size={18} className="text-void" />
                </span>
                <span className="g-display text-xl tracking-wide">
                  Gold<span className="text-gold">OS</span>
                </span>
              </Link>
              <p className="mt-5 max-w-xs text-sm leading-relaxed text-paper/50">
                The jewellery ERP for Sri Lankan gold businesses. Every gram and every rupee, traceable from
                the scale to the ledger.
              </p>

              <div className="home-glass mt-8 max-w-sm p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light/80">
                    Branch access
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-emerald-300/80">
                    <span className="size-1.5 animate-pulse-soft rounded-full bg-emerald-400" />
                    Secure
                  </span>
                </div>
                <p className="mt-2 text-sm text-paper/70">Pick up where the last shift left off.</p>
                <Link href="/login" className="home-btn-gold mt-4 h-10 w-full px-5 text-sm">
                  Sign in to the console
                  <ArrowRightIcon size={14} />
                </Link>
              </div>
            </div>

            <nav aria-label="Footer" className="grid grid-cols-2 gap-10 sm:grid-cols-3">
              {FOOTER_COLUMNS.map((col) => (
                <div key={col.title}>
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-paper/35">{col.title}</h3>
                  <ul className="mt-5 space-y-3.5">
                    {col.links.map((l) => (
                      <li key={l.label}>
                        <FooterLink href={l.href}>{l.label}</FooterLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>

          <div className="mt-16 flex flex-wrap gap-3">
            {[
              { icon: ShieldIcon, label: "Role-based access" },
              { icon: HistoryIcon, label: "Append-only audit" },
              { icon: ScaleIcon, label: "Dual gold + cash ledger" },
              { icon: StoreIcon, label: "Multi-branch" },
            ].map((b) => (
              <span
                key={b.label}
                className="inline-flex items-center gap-2 rounded-full bg-paper/[0.04] px-3.5 py-2 text-xs text-paper/60 ring-1 ring-paper/[0.08]"
              >
                <b.icon size={13} className="text-gold" />
                {b.label}
              </span>
            ))}
          </div>
        </div>

        <FooterWordmark className="relative mx-auto -mb-[2%] mt-10 block w-full max-w-[90rem] select-none px-4" />

        <div className="relative border-t border-paper/[0.07] bg-void/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-5 font-mono text-[10px] uppercase tracking-[0.18em] text-paper/35 sm:flex-row">
            <span>© {new Date().getFullYear()} GoldOS · All rights reserved</span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-gold" />
              Made for the showroom floor · Sri Lanka
            </span>
            <a
              href="#top"
              className="group inline-flex items-center gap-2 text-paper/50 transition-colors hover:text-gold-light"
            >
              Back to top
              <span className="flex size-7 items-center justify-center rounded-full ring-1 ring-paper/15 transition-all duration-320 ease-brand group-hover:-translate-y-0.5 group-hover:bg-gold group-hover:text-void group-hover:ring-gold">
                <ArrowRightIcon size={12} className="-rotate-90" />
              </span>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function HomePage() {
  return (
    <div id="top" className="min-h-dvh bg-void text-paper" style={{ colorScheme: "dark" } as CSSProperties}>
      <HomeNav />
      <main>
        <Hero />
        <Marquee />
        <Stats />
        <Features />
        <Workflow />
        <Modules />
        <Cta />
      </main>
      <Footer />
    </div>
  );
}
