import type { Metadata } from "next";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { HomeNav, Reveal, ScrollScale } from "@/components/home/motion";
import { ModuleExplorer } from "@/components/home/module-explorer";
import { GoldDust, ScrollRibbon, SpotCard } from "@/components/home/effects";
import {
  CountStat,
  JourneyScroll,
  KaratStudio,
  Magnetic,
  TiltStage,
  WordReveal,
  type JourneyStep,
} from "@/components/home/premium";
import {
  AuditShield,
  Barcode,
  BranchNetwork,
  HeroEmblem,
  IngotStack,
  LedgerScale,
  LifecycleFlow,
  RateChart,
  ScanIllustration,
} from "@/components/home/illustrations";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronRightIcon,
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
  TruckIcon,
} from "@/components/icons";

export const metadata: Metadata = {
  title: "GoldOS — Jewellery ERP for Sri Lankan gold businesses",
  description:
    "Live per-karat pricing, barcode-first inventory, old-gold intake, melting, manufacturing and a dual gold + money ledger in one console.",
};

const STATS = [
  { value: 2, suffix: "", label: "Ledgers", desc: "Gold in grams and money in LKR, reconciled separately." },
  { value: 100, suffix: "%", label: "Audited writes", desc: "Every business write lands with its audit row." },
  { value: 21, suffix: "", label: "Modules", desc: "From the counter to the crucible to the books." },
  { value: 4, suffix: "", label: "Workspaces", desc: "Counter, intake, vault and control — one login." },
];

const SAMPLE_RATES = [
  { k: "24K", rate: "36,460" },
  { k: "22K", rate: "33,430" },
  { k: "21K", rate: "31,940" },
  { k: "18K", rate: "27,380" },
];

const STEPS: JourneyStep[] = [
  {
    title: "Acquire",
    desc: "Supplier invoices and walk-in old gold, weighed and valued at the day's board rate.",
    icon: <TruckIcon size={22} />,
    record: [
      ["Old gold intake", "OG-1042"],
      ["Gross weight", "12.300 g"],
      ["Tested", "22K · 91.6%"],
      ["Valued at", "LKR 411,190"],
    ],
  },
  {
    title: "Refine",
    desc: "Test purity, melt lots into batches and post wastage and recovery to the gold ledger.",
    icon: <FlaskConicalIcon size={22} />,
    record: [
      ["Melt batch", "MB-0142"],
      ["Input", "48.250 g"],
      ["Recovered", "47.580 g"],
      ["Recovery", "98.6%"],
    ],
  },
  {
    title: "Craft",
    desc: "Issue fine gold to manufacturing orders and receive finished, barcoded pieces.",
    icon: <HammerIcon size={22} />,
    record: [
      ["Mfg order", "MO-0087"],
      ["Fine gold issued", "45.000 g"],
      ["Pieces received", "12"],
      ["Wastage", "0.420 g"],
    ],
  },
  {
    title: "Sell",
    desc: "Scan at the counter, price live per karat, invoice and handle returns cleanly.",
    icon: <CreditCardIcon size={22} />,
    record: [
      ["Invoice", "INV-2381"],
      ["Items", "3 pieces"],
      ["Net weight", "23.380 g"],
      ["Total", "LKR 846,900"],
    ],
  },
  {
    title: "Close",
    desc: "Reconcile cash and bank, clear pending approvals and lock the day.",
    icon: <ClipboardCheckIcon size={22} />,
    record: [
      ["Day close", "Today"],
      ["Cash counted", "LKR 2,418,350"],
      ["Variance", "LKR 0.00"],
      ["Status", "Locked"],
    ],
  },
];

const JOURNAL: { account: string; dr?: string; cr?: string }[] = [
  { account: "Cash on hand", dr: "500,000" },
  { account: "Bank — card settlement", dr: "346,900" },
  { account: "Sales — gold jewellery", cr: "781,600" },
  { account: "Making charge income", cr: "65,300" },
];

function Eyebrow({ children, tone = "light" }: { children: ReactNode; tone?: "light" | "dark" }) {
  return (
    <p
      className={
        tone === "light"
          ? "text-[13px] font-semibold uppercase tracking-[0.14em] text-gold-deep"
          : "text-[13px] font-semibold uppercase tracking-[0.14em] text-gold-light"
      }
    >
      {children}
    </p>
  );
}

function SectionHead({
  eyebrow,
  title,
  desc,
  tone = "light",
}: {
  eyebrow: string;
  title: ReactNode;
  desc?: string;
  tone?: "light" | "dark";
}) {
  return (
    <div className="mx-auto max-w-3xl px-1 text-center">
      <Eyebrow tone={tone}>{eyebrow}</Eyebrow>
      <h2
        className={`hx-display mt-3 text-[2.5rem] text-balance sm:text-6xl ${tone === "light" ? "text-[#10201b]" : "text-white"}`}
      >
        {title}
      </h2>
      {desc ? (
        <p
          className={`mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-pretty ${tone === "light" ? "text-[#5d6e68]" : "text-[#93a29c]"}`}
        >
          {desc}
        </p>
      ) : null}
    </div>
  );
}

/** Splits a line into words that rise out of a blur, one after another, on first paint. */
function RiseWords({
  text,
  base = 0,
  start = 0,
  className,
}: {
  text: string;
  base?: number;
  start?: number;
  className?: string;
}) {
  return (
    <>
      {text.split(" ").map((w, i) => (
        <Fragment key={i}>
          {i > 0 ? " " : null}
          <span
            className={`hx-word-in ${className ?? ""}`}
            style={{ "--i": start + i, "--base": `${base}ms` } as CSSProperties}
          >
            {w}
          </span>
        </Fragment>
      ))}
    </>
  );
}

function Tile({
  tone,
  eyebrow,
  title,
  desc,
  children,
  className,
  delay = 0,
}: {
  tone: "light" | "dark";
  eyebrow: string;
  title: string;
  desc: string;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const dark = tone === "dark";
  return (
    <Reveal delay={delay} className={className}>
      <SpotCard className={`hx-tile flex h-full flex-col ${dark ? "hx-tile-dark" : "hx-tile-light"}`}>
        <div className="px-7 pt-8 sm:px-9 sm:pt-10">
          <Eyebrow tone={dark ? "dark" : "light"}>{eyebrow}</Eyebrow>
          <h3
            className={`hx-display mt-2.5 text-[1.75rem] text-balance sm:text-[2rem] ${dark ? "text-white" : "text-[#10201b]"}`}
          >
            {title}
          </h3>
          <p className={`mt-3 max-w-md text-[15px] leading-relaxed text-pretty ${dark ? "text-[#93a29c]" : "text-[#5d6e68]"}`}>
            {desc}
          </p>
        </div>
        <div className="mt-auto p-3 pt-8 sm:p-4 sm:pt-8">{children}</div>
      </SpotCard>
    </Reveal>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden pt-28 sm:pt-36">
      <div className="hx-aurora pointer-events-none absolute inset-x-0 top-0 h-[44rem]" />
      <div className="relative mx-auto max-w-5xl px-5 text-center sm:px-6">
        <Reveal>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3.5 py-1.5 text-[13px] text-[#5d6e68] shadow-[0_0_0_1px_rgba(0,0,0,0.06)] backdrop-blur">
            <span className="relative flex size-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/60" />
              <span className="relative size-2 rounded-full bg-emerald-500" />
            </span>
            Jewellery ERP · Built for Sri Lanka
          </span>
        </Reveal>

        <h1 className="hx-display mt-7 text-[2.9rem] text-[#10201b] sm:text-7xl lg:text-[5.75rem]">
          <RiseWords text="Every gram. Every rupee." base={150} />
          <br />
          <RiseWords text="Accounted for." base={500} start={4} className="hx-gold-text" />
        </h1>

        <Reveal delay={160}>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[#5d6e68] text-pretty sm:text-[21px]">
            One console for your showroom, vault and workshop. Live per-karat pricing, barcode-first stock and
            books that always balance.
          </p>
        </Reveal>

        <Reveal delay={240}>
          <div className="mt-9 flex flex-col items-center justify-center gap-5 sm:flex-row sm:gap-7">
            <Magnetic>
              <Link href="/login" className="hx-btn hx-btn-dark h-12 px-7 text-[17px]">
                Sign in to your branch
              </Link>
            </Magnetic>
            <a href="#pricing" className="hx-link text-[17px]">
              Try the price studio
              <ChevronRightIcon size={16} />
            </a>
          </div>
        </Reveal>
      </div>

      <Reveal delay={320} className="relative mx-auto mt-16 max-w-6xl px-3 sm:mt-20 sm:px-6">
        <ScrollScale>
          <TiltStage className="hx-stage hx-glow-border relative overflow-hidden rounded-[2rem] shadow-[0_50px_100px_-40px_rgba(0,0,0,0.6)] sm:rounded-[2.75rem]">
            <div className="home-noise pointer-events-none absolute inset-0" />
            <GoldDust />
            <div className="relative mx-auto aspect-[4/3.4] max-w-[1100px] sm:aspect-[16/9]">
              <div className="hx-depth absolute inset-0" style={{ "--d": -18 } as CSSProperties}>
                <HeroEmblem className="absolute left-1/2 top-[44%] aspect-square h-[78%] w-auto -translate-x-1/2 -translate-y-1/2" />
              </div>

              <div className="hx-depth home-glass home-float absolute left-[5%] top-[9%] hidden w-52 p-4 md:block" style={{ "--d": 46 } as CSSProperties}>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light/80">22K · Net weight</div>
                <div className="g-metric mt-2 text-2xl text-white">8.420 g</div>
                <div className="g-metric mt-0.5 text-xs text-white/50">× 91.6% purity</div>
                <div className="my-3 h-px bg-gradient-to-r from-gold/40 to-transparent" />
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] text-white/50">Fine gold</span>
                  <span className="g-metric text-base text-gold-light">7.713 g</span>
                </div>
              </div>

              <div
                className="hx-depth home-glass home-float absolute right-[5%] top-[18%] hidden w-56 p-4 md:block"
                style={{ animationDelay: "-2.5s", "--d": 60 } as CSSProperties}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
                    <ScanBarcodeIcon size={12} className="text-gold" />
                    Scan
                  </span>
                  <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                    In stock
                  </span>
                </div>
                <Barcode className="mt-3 h-12 w-full text-white/90" height={48} />
                <div className="g-metric mt-2 text-center text-[11px] tracking-[0.3em] text-white/70">JW-M2Q39H</div>
              </div>

              <div className="hx-depth home-glass absolute inset-x-3 bottom-3 grid grid-cols-4 divide-x divide-white/10 py-3 sm:inset-x-6 sm:bottom-6 sm:py-4">
                {SAMPLE_RATES.map((r) => (
                  <div key={r.k} className="px-2 text-center sm:px-4">
                    <div className="flex items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-light/80 sm:text-[11px]">
                      {r.k}
                      <span className="text-emerald-300">▲</span>
                    </div>
                    <div className="g-metric mt-1 text-[13px] text-white sm:text-lg">
                      <span className="hidden text-white/40 sm:inline">LKR </span>
                      {r.rate}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </TiltStage>
        </ScrollScale>
        <p className="mt-4 text-center text-xs text-[#7a8a84]">Board rates per gram shown are samples for illustration.</p>
      </Reveal>
    </section>
  );
}

function Stats() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-8 pt-24 sm:px-6 sm:pt-32">
      <div className="grid grid-cols-2 gap-y-12 lg:grid-cols-4">
        {STATS.map((s, i) => (
          <Reveal
            key={s.label}
            delay={i * 90}
            className="px-4 text-center lg:border-l lg:border-black/[0.08] lg:first:border-l-0"
          >
            <div className="hx-display hx-gold-text text-5xl sm:text-6xl">
              <CountStat value={s.value} suffix={s.suffix} />
            </div>
            <div className="mt-3 text-[15px] font-semibold text-[#10201b]">{s.label}</div>
            <p className="mx-auto mt-1 max-w-[14rem] text-sm leading-relaxed text-[#5d6e68]">{s.desc}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="scroll-mt-14 bg-[#f6f5f0] py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <SectionHead
            eyebrow="Features"
            title="Premium tooling for a precious business."
            desc="Gross, stone, net and fine weight travel with every movement, from the scale to the ledger."
          />
        </Reveal>

        <div className="mt-16 grid gap-4 sm:gap-5 lg:grid-cols-6">
          <Tile
            className="lg:col-span-4"
            tone="dark"
            eyebrow="Pricing"
            title="Live per-karat rates."
            desc="Publish board rates once and every piece re-prices by karat, net weight and making charge — on the shelf, the label and the POS."
          >
            <div className="px-4 pb-2 sm:px-5">
              <div className="flex flex-wrap items-center gap-2">
                {["24K", "22K", "21K", "18K"].map((k, i) => (
                  <span
                    key={k}
                    className={
                      i === 1
                        ? "g-metric rounded-full bg-gold px-3 py-1 text-xs font-semibold text-black"
                        : "g-metric rounded-full bg-white/[0.08] px-3 py-1 text-xs text-white/60"
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
              <RateChart className="mt-4 h-48 w-full" />
            </div>
          </Tile>

          <Tile
            className="lg:col-span-2"
            delay={90}
            tone="light"
            eyebrow="Inventory"
            title="Barcode-first stock."
            desc="Every piece gets a unique JW- code and a printable label. USB and Bluetooth scanners just work."
          >
            <div className="hx-screen">
              <ScanIllustration className="h-52 w-full" />
            </div>
          </Tile>

          <Tile
            className="lg:col-span-2"
            tone="light"
            eyebrow="Accounting"
            title="A dual ledger."
            desc="A sale posts invoice, payment, stock, gold and revenue in one atomic batch. If any step fails, it all rolls back."
          >
            <div className="hx-screen">
              <LedgerScale className="h-48 w-full" />
            </div>
          </Tile>

          <Tile
            className="lg:col-span-2"
            delay={90}
            tone="dark"
            eyebrow="Old gold"
            title="Fully traced."
            desc="Intake, purity testing and melting batches link back to the gold ledger, so each gram keeps its lineage."
          >
            <LifecycleFlow className="h-48 w-full" />
          </Tile>

          <Tile
            className="lg:col-span-2"
            delay={180}
            tone="light"
            eyebrow="Control"
            title="Audit & approvals."
            desc="Role-based permissions, approval gates for sensitive actions and an append-only trail of every change."
          >
            <div className="hx-screen">
              <AuditShield className="h-48 w-full" />
            </div>
          </Tile>

          <Reveal className="lg:col-span-6">
            <SpotCard className="hx-tile hx-tile-dark grid items-center gap-6 p-3 sm:p-4 md:grid-cols-2">
              <div className="px-4 py-6 sm:px-6 md:py-10">
                <Eyebrow tone="dark">Multi-branch</Eyebrow>
                <h3 className="hx-display mt-2.5 text-[2rem] text-white text-balance sm:text-5xl">
                  One console.
                  <br />
                  Every branch.
                </h3>
                <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[#93a29c]">
                  Switch branches in a click. Stock, rates, cash and closings stay scoped per branch while head
                  office sees the whole picture.
                </p>
                <ul className="mt-6 space-y-2.5">
                  {["Branch-scoped stock", "Per-branch day closing", "Consolidated reports"].map((t) => (
                    <li key={t} className="flex items-center gap-2.5 text-[15px] text-white/80">
                      <CheckIcon size={15} strokeWidth={2.5} className="text-gold-light" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-[20px] bg-white/[0.03] p-4 ring-1 ring-white/[0.06]">
                <BranchNetwork className="h-60 w-full" />
              </div>
            </SpotCard>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Ribbon() {
  return (
    <section id="ribbon" aria-label="Modules at a glance" className="overflow-hidden bg-[#f6f5f0] pb-16 sm:pb-24">
      <ScrollRibbon
        rows={[
          ["Point of sale", "Old gold", "Melting", "Manufacturing", "Day closing"],
          ["Gold ledger", "Board rates", "Approvals", "Transfers", "Audit trail"],
        ]}
      />
    </section>
  );
}

function PriceStudio() {
  return (
    <section id="pricing" className="relative scroll-mt-14 overflow-hidden bg-black py-24 sm:py-32">
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[50rem] -translate-x-1/2 rounded-full bg-gold/[0.1] blur-[160px]" />
      <GoldDust density={0.00004} />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <SectionHead
            tone="dark"
            eyebrow="Price studio"
            title={
              <>
                Price a piece the way <span className="home-gold-text">your counter does.</span>
              </>
            }
            desc="Pick a karat, set the weight and the making charge. It's the same formula GoldOS prints on every label and invoice."
          />
        </Reveal>
        <Reveal delay={120} className="mt-14">
          <KaratStudio />
        </Reveal>
      </div>
    </section>
  );
}

function Ledger() {
  return (
    <section className="relative overflow-hidden bg-black py-24 text-white sm:py-36">
      <div className="pointer-events-none absolute left-1/2 top-1/3 size-[44rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold/[0.12] blur-[140px]" />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <div className="text-center">
          <Reveal>
            <Eyebrow tone="dark">Balanced books</Eyebrow>
          </Reveal>
          <Reveal delay={100}>
            <p className="hx-display home-gold-text mt-6 text-[3.5rem] leading-none sm:text-8xl lg:text-[8.5rem]">
              ΣDR = ΣCR
            </p>
          </Reveal>
          <Reveal delay={200}>
            <p className="mx-auto mt-8 max-w-xl text-lg leading-relaxed text-[#93a29c] text-pretty sm:text-[21px]">
              Every journal entry is validated before it can post.{" "}
              <span className="text-white">If it doesn&apos;t balance, it doesn&apos;t happen.</span>
            </p>
          </Reveal>
        </div>

        <Reveal delay={150} className="mx-auto mt-16 max-w-3xl">
          <div className="hx-glow-border relative overflow-hidden rounded-[28px] bg-white/[0.04] ring-1 ring-white/[0.09] backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-4 sm:px-7">
              <span className="g-metric text-sm text-white/70">Journal · INV-2381</span>
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                <CheckIcon size={12} strokeWidth={3} />
                Posted atomically
              </span>
            </div>

            <div className="px-5 py-3 sm:px-7">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35 sm:gap-x-10">
                <span>Account</span>
                <span className="w-20 text-right sm:w-28">Debit</span>
                <span className="w-20 text-right sm:w-28">Credit</span>
              </div>
              {JOURNAL.map((row, i) => (
                <Reveal key={row.account} delay={300 + i * 160}>
                  <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 border-t border-white/[0.06] py-3 text-sm sm:gap-x-10">
                    <span className="truncate text-white/80">{row.account}</span>
                    <span className="g-metric w-20 text-right text-white sm:w-28">{row.dr ?? ""}</span>
                    <span className="g-metric w-20 text-right text-white sm:w-28">{row.cr ?? ""}</span>
                  </div>
                </Reveal>
              ))}
              <Reveal delay={300 + JOURNAL.length * 160} className="hx-flash">
                <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 border-t border-gold/40 py-3.5 text-sm sm:gap-x-10">
                  <span className="flex items-center gap-2 font-semibold text-gold-light">
                    <span className="flex size-5 items-center justify-center rounded-full bg-gold text-black">
                      <CheckIcon size={11} strokeWidth={3.5} />
                    </span>
                    Balanced
                  </span>
                  <span className="g-metric w-20 text-right font-semibold text-gold-light sm:w-28">846,900</span>
                  <span className="g-metric w-20 text-right font-semibold text-gold-light sm:w-28">846,900</span>
                </div>
              </Reveal>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] bg-gold/[0.06] px-5 py-3.5 text-[13px] sm:px-7">
              <span className="flex items-center gap-2 text-white/70">
                <ScaleIcon size={14} className="text-gold-light" />
                Gold ledger, same batch
              </span>
              <span className="g-metric text-gold-light">−21.416 g fine · 22K · 23.380 g net</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Modules() {
  return (
    <section id="modules" className="scroll-mt-14 bg-[#f6f5f0] py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <SectionHead
            eyebrow="Modules"
            title="Everything your showroom runs on."
            desc="Four workspaces, one login. Permission-aware and branch-scoped, so staff only see what their role allows."
          />
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
    <section className="relative overflow-hidden bg-black px-5 py-28 text-center text-white sm:px-6 sm:py-36">
      <div className="hx-stage pointer-events-none absolute inset-0" />
      <GoldDust density={0.00006} />
      <div className="home-noise pointer-events-none absolute inset-0" />
      <Reveal className="relative mx-auto max-w-3xl">
        <IngotStack className="mx-auto w-full max-w-sm" />
        <h2 className="hx-display mt-8 text-5xl sm:text-7xl">
          Open the <span className="home-gold-text">vault.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-lg text-lg leading-relaxed text-[#93a29c] sm:text-[21px]">
          Sign in with your branch credentials and pick up exactly where the last shift left off.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-5 sm:flex-row sm:gap-7">
          <Magnetic>
            <Link href="/login" className="hx-btn hx-btn-gold h-12 px-7 text-[17px]">
              Sign in
              <ArrowRightIcon size={16} />
            </Link>
          </Magnetic>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-0.5 text-[17px] font-medium text-gold-light hover:underline hover:underline-offset-4"
          >
            Go to dashboard
            <ChevronRightIcon size={16} />
          </Link>
        </div>
        <ul className="mt-14 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 text-sm text-[#93a29c]">
          {[
            { icon: ShieldIcon, label: "Role-based access" },
            { icon: HistoryIcon, label: "Append-only audit" },
            { icon: ScaleIcon, label: "Dual gold + cash ledger" },
            { icon: StoreIcon, label: "Multi-branch" },
          ].map((b) => (
            <li key={b.label} className="flex items-center gap-2">
              <b.icon size={15} className="text-gold-light" />
              {b.label}
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}

const FOOTER_COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Price studio", href: "#pricing" },
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
  const cls = "text-xs text-[#3a4d47] transition-colors hover:text-[#10201b] hover:underline";
  return href.startsWith("#") ? (
    <a href={href} className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

function Footer() {
  return (
    <footer className="bg-[#f6f5f0] text-[#5d6e68]">
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-6">
        <p className="border-b border-black/[0.1] pb-6 text-xs leading-relaxed">
          GoldOS is the jewellery ERP for Sri Lankan gold businesses. Every gram and every rupee, traceable from
          the scale to the ledger. Board rates shown on this page are samples for illustration.
        </p>

        <div className="grid gap-10 py-8 sm:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <Link href="/" className="inline-flex items-center gap-2" aria-label="GoldOS home">
              <span className="flex size-7 items-center justify-center rounded-[9px] bg-gradient-to-b from-gold-light to-gold-deep">
                <GemIcon size={13} className="text-white" />
              </span>
              <span className="hx-display text-[17px] tracking-[-0.02em] text-[#10201b]">GoldOS</span>
            </Link>
            <p className="mt-3 max-w-xs text-xs leading-relaxed">Made for the showroom floor in Sri Lanka.</p>
          </div>
          <nav aria-label="Footer" className="contents">
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.title}>
                <h3 className="text-xs font-semibold text-[#10201b]">{col.title}</h3>
                <ul className="mt-3 space-y-2.5">
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

        <div className="flex flex-col items-start justify-between gap-3 border-t border-black/[0.1] pt-5 text-xs sm:flex-row sm:items-center">
          <span>Copyright © {new Date().getFullYear()} GoldOS. All rights reserved.</span>
          <a href="#top" className="inline-flex items-center gap-1 text-[#3a4d47] hover:text-[#10201b] hover:underline">
            Back to top
            <ArrowRightIcon size={12} className="-rotate-90" />
          </a>
        </div>
      </div>
    </footer>
  );
}

export default function HomePage() {
  return (
    <div id="top" className="hx-page min-h-dvh" style={{ colorScheme: "light" } as CSSProperties}>
      <HomeNav />
      <main>
        <Hero />
        <Stats />
        <WordReveal text="Gold isn't inventory. It's an *asset* — weighed, tested, melted, crafted and sold. GoldOS follows *every* *gram* from the scale to the ledger." />
        <Features />
        <Ribbon />
        <PriceStudio />
        <JourneyScroll
          steps={STEPS}
          header={
            <Reveal>
              <SectionHead eyebrow="Workflow" title="The life of your gold, in five moves." />
            </Reveal>
          }
        />
        <Ledger />
        <Modules />
        <Cta />
      </main>
      <Footer />
    </div>
  );
}
