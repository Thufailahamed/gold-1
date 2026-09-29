"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { AuditShield, IngotStack, LifecycleFlow, ScanIllustration } from "@/components/home/illustrations";
import {
  ArchiveIcon,
  ArrowRightIcon,
  BanknoteIcon,
  BookOpenIcon,
  Building2Icon,
  CheckCircleIcon,
  ClipboardCheckIcon,
  CoinsIcon,
  CreditCardIcon,
  FileTextIcon,
  FlaskConicalIcon,
  HammerIcon,
  HistoryIcon,
  InboxIcon,
  PackageIcon,
  RotateCcwIcon,
  ScaleIcon,
  SearchIcon,
  ShieldIcon,
  TagsIcon,
  TrendingUpIcon,
  TruckIcon,
  UserCheckIcon,
} from "@/components/icons";

type IconCmp = (props: { size?: number | string; className?: string }) => ReactNode;

interface Workspace {
  key: string;
  name: string;
  tagline: string;
  desc: string;
  icon: IconCmp;
  art: ReactNode;
  modules: { name: string; desc: string; href: string; icon: IconCmp }[];
}

const WORKSPACES: Workspace[] = [
  {
    key: "counter",
    name: "The Counter",
    tagline: "Sell",
    desc: "Scan, price live per karat and invoice in seconds.",
    icon: CreditCardIcon,
    art: <ScanIllustration className="h-full w-full" />,
    modules: [
      { name: "Point of Sale", desc: "Scan, price and take payment", href: "/pos", icon: CreditCardIcon },
      { name: "Sales Invoices", desc: "Search, reprint and void", href: "/sales/invoices", icon: FileTextIcon },
      { name: "Returns", desc: "Reverse stock, gold and cash", href: "/sales/returns", icon: RotateCcwIcon },
      { name: "Customers", desc: "Profiles and receivables", href: "/customers", icon: UserCheckIcon },
    ],
  },
  {
    key: "intake",
    name: "Buying & Intake",
    tagline: "Source",
    desc: "Supplier stock and walk-in old gold, weighed and tested.",
    icon: TruckIcon,
    art: <LifecycleFlow className="h-full w-full" />,
    modules: [
      { name: "Purchase Invoices", desc: "Supplier bills and payables", href: "/purchases/invoices", icon: TruckIcon },
      { name: "Purchase Orders", desc: "Order, receive, reconcile", href: "/purchases/orders", icon: InboxIcon },
      { name: "Old Gold Intake", desc: "Weigh and value at the counter", href: "/old-gold/intake", icon: ScaleIcon },
      { name: "Purity Testing", desc: "Record assay results per lot", href: "/old-gold/testing", icon: SearchIcon },
      { name: "Suppliers", desc: "Terms and balances", href: "/suppliers", icon: Building2Icon },
    ],
  },
  {
    key: "vault",
    name: "Workshop & Vault",
    tagline: "Gold",
    desc: "Melt, manufacture and keep fine gold traceable to the gram.",
    icon: CoinsIcon,
    art: <IngotStack className="h-full w-full" />,
    modules: [
      { name: "Melting", desc: "Batches, wastage and recovery", href: "/gold/melting", icon: FlaskConicalIcon },
      { name: "Manufacturing", desc: "Orders, issues and receipts", href: "/manufacturing/orders", icon: HammerIcon },
      { name: "Gold Ledger", desc: "Every fine-gold movement", href: "/gold/ledger", icon: BookOpenIcon },
      { name: "Gold Stock", desc: "Fine gold by purity and branch", href: "/gold/stock", icon: ArchiveIcon },
      { name: "Gold Rates", desc: "Publish per-karat board rates", href: "/gold-rates", icon: CoinsIcon },
      { name: "Inventory", desc: "Finished pieces on hand", href: "/inventory", icon: PackageIcon },
    ],
  },
  {
    key: "control",
    name: "Books & Control",
    tagline: "Oversee",
    desc: "Balanced books, approval gates and a closed day, every day.",
    icon: ShieldIcon,
    art: <AuditShield className="h-full w-full" />,
    modules: [
      { name: "Accounts", desc: "Chart of accounts, cash and bank", href: "/accounts", icon: BanknoteIcon },
      { name: "Expenses", desc: "Categorised, approval-gated", href: "/expenses", icon: TagsIcon },
      { name: "Day Closing", desc: "Reconcile and lock the day", href: "/day-closing", icon: ClipboardCheckIcon },
      { name: "Approvals", desc: "Sensitive actions, signed off", href: "/approvals", icon: CheckCircleIcon },
      { name: "Analytics", desc: "Sales, margin and gold trends", href: "/analytics", icon: TrendingUpIcon },
      { name: "Audit", desc: "Append-only trail of changes", href: "/audit", icon: HistoryIcon },
    ],
  },
];

const CYCLE_MS = 7000;

export function ModuleExplorer() {
  const [active, setActive] = useState(0);
  const [autoplay, setAutoplay] = useState(true);
  const [hovering, setHovering] = useState(false);
  const [inView, setInView] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setAutoplay(false);
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const running = autoplay && inView && !hovering;
  const ws = WORKSPACES[active] ?? WORKSPACES[0]!;

  function select(i: number) {
    setActive(i);
    setAutoplay(false);
  }

  return (
    <div
      ref={rootRef}
      className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]"
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
    >
      <div role="tablist" aria-label="Workspaces" aria-orientation="vertical" className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        {WORKSPACES.map((w, i) => {
          const on = i === active;
          return (
            <button
              key={w.key}
              type="button"
              role="tab"
              id={`ws-tab-${w.key}`}
              aria-selected={on}
              aria-controls="ws-panel"
              onClick={() => select(i)}
              className={cn(
                "group relative overflow-hidden rounded-2xl p-4 text-left transition-all duration-320 ease-brand sm:p-5",
                on
                  ? "bg-paper shadow-[inset_0_0_0_1px_rgba(168,134,27,0.35),0_24px_48px_-24px_rgba(140,109,31,0.45)]"
                  : "bg-paper/40 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.07)] hover:bg-paper/80"
              )}
            >
              <div className="flex items-center gap-3.5">
                <span
                  className={cn(
                    "hidden size-11 shrink-0 items-center justify-center rounded-xl transition-all duration-320 ease-brand sm:flex",
                    on
                      ? "bg-void text-gold-light shadow-[0_10px_24px_-10px_rgba(140,109,31,0.8)]"
                      : "bg-gold-pale text-gold-deep shadow-[inset_0_0_0_1px_rgba(168,134,27,0.2)]"
                  )}
                >
                  <w.icon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-dark">
                    {w.tagline}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold leading-snug text-ink sm:truncate sm:text-base">
                    {w.name}
                  </span>
                </span>
                <span className="g-metric hidden text-xs text-ink-5 sm:block">
                  {String(w.modules.length).padStart(2, "0")}
                </span>
              </div>
              <p
                className={cn(
                  "hidden overflow-hidden text-sm leading-relaxed text-ink-4 transition-all duration-320 ease-brand lg:block",
                  on ? "mt-3 max-h-16 opacity-100" : "mt-0 max-h-0 opacity-0"
                )}
              >
                {w.desc}
              </p>
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-ink/[0.05]">
                {on ? (
                  <span
                    key={`${active}-${autoplay}`}
                    className="home-progress block h-full origin-left bg-gradient-to-r from-gold-dark to-gold-light"
                    style={{
                      animationDuration: `${CYCLE_MS}ms`,
                      animationPlayState: running ? "running" : "paused",
                      transform: autoplay ? undefined : "scaleX(1)",
                      animationName: autoplay ? undefined : "none",
                    }}
                    onAnimationEnd={() => setActive((a) => (a + 1) % WORKSPACES.length)}
                  />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <div
        id="ws-panel"
        role="tabpanel"
        aria-labelledby={`ws-tab-${ws.key}`}
        className="relative overflow-hidden rounded-[1.75rem] bg-void text-paper shadow-5"
      >
        <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-60" />
        <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-gold/20 blur-[100px]" />

        <div className="relative flex items-center gap-3 border-b border-paper/[0.07] px-5 py-3.5">
          <span className="flex gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-paper/15" />
            <span className="size-2.5 rounded-full bg-paper/15" />
            <span className="size-2.5 rounded-full bg-gold/70" />
          </span>
          <span className="g-metric mx-auto flex items-center gap-2 rounded-full bg-paper/[0.05] px-3 py-1 text-[11px] text-paper/50 ring-1 ring-paper/[0.07]">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            goldos / {ws.key}
          </span>
          <span className="g-metric text-[10px] uppercase tracking-[0.16em] text-paper/35">
            {active + 1}/{WORKSPACES.length}
          </span>
        </div>

        <div key={ws.key} className="relative grid gap-6 p-5 sm:p-7 md:grid-cols-[1fr_1.15fr]">
          <div className="flex animate-fade-in flex-col">
            <div className="aspect-[16/10] overflow-hidden rounded-2xl bg-black/30 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
              {ws.art}
            </div>
            <h3 className="g-display mt-5 text-2xl text-paper">{ws.name}</h3>
            <p className="mt-2 text-sm leading-relaxed text-paper/55">{ws.desc}</p>
          </div>

          <ul className="space-y-1.5">
            {ws.modules.map((m, i) => (
              <li key={m.href} className="animate-fade-in" style={{ animationDelay: `${80 + i * 60}ms` }}>
                <Link
                  href={m.href}
                  className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-200 hover:bg-paper/[0.06]"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gold/10 text-gold-light shadow-[inset_0_0_0_1px_rgba(231,198,90,0.2)] transition-colors group-hover:bg-gold group-hover:text-void">
                    <m.icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-paper">{m.name}</span>
                    <span className="block truncate text-xs text-paper/45">{m.desc}</span>
                  </span>
                  <ArrowRightIcon
                    size={14}
                    className="shrink-0 -translate-x-1 text-gold-light opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
