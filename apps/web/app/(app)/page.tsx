"use client";

import { useQuery } from "@tanstack/react-query";
import { api, type MeData } from "@/lib/api";
import {
  Page,
  Hero,
  heroBtnPrimary,
  heroBtnGhost,
  StatGrid,
  StatCard,
  Panel,
  Pill,
} from "@/components/ui";
import {
  ArrowRightIcon,
  BanknoteIcon,
  CoinsIcon,
  PackageIcon,
  ArchiveIcon,
  CheckCircleIcon,
  TruckIcon,
  ScaleIcon,
  ScanBarcodeIcon,
  ShieldIcon,
  TrendingUpIcon,
} from "@/components/icons";

const CARDS = [
  { title: "Today's Sales", value: "LKR 0", hint: "Sales module not connected yet", icon: BanknoteIcon },
  { title: "Today's Purchases", value: "LKR 0", hint: "Purchases module not connected yet", icon: TruckIcon },
  { title: "Gold Purchased", value: "0 g", hint: "Old-gold module not connected yet", icon: ScaleIcon },
  { title: "Gold Sold", value: "0 g", hint: "Sales module not connected yet", icon: CoinsIcon },
  { title: "Cash", value: "LKR 0", hint: "Cash module not connected yet", icon: BanknoteIcon },
  { title: "Inventory", value: "0", hint: "Pieces on hand", icon: ArchiveIcon },
  { title: "Pending Approvals", value: "0", hint: "Approvals module not connected yet", icon: CheckCircleIcon },
  { title: "Receivables", value: "LKR 0", hint: "Ledger module not connected yet", icon: TrendingUpIcon },
];

const MODULES = [
  { name: "Catalog", desc: "Pieces, barcodes and live pricing", href: "/products", icon: PackageIcon },
  { name: "Scan & Lookup", desc: "USB/Bluetooth scanner workflow", href: "/scan", icon: ScanBarcodeIcon },
  { name: "Gold Rates", desc: "Per-karat board rates", href: "/gold-rates", icon: CoinsIcon },
  { name: "Stock on Hand", desc: "Branch, purity and product views", href: "/inventory", icon: ArchiveIcon },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const firstName = me.data?.user.name?.split(" ")[0] ?? "there";

  return (
    <Page>
      <Hero
        kicker={
          <>
            Branch overview ·{" "}
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </>
        }
        title={`${greeting()}, ${firstName}.`}
        description="Sales, gold movement and cash across the branch — at a glance."
        meta={
          <>
            <Pill tone="ghost" icon={<ShieldIcon size={11} />}>
              Verified workspace
            </Pill>
            <Pill tone="ghost" icon={<CoinsIcon size={11} />}>
              Board synced
            </Pill>
          </>
        }
        note="Rates and stock sync in real time across every branch"
        actions={
          <>
            <a href="/scan" className={heroBtnPrimary}>
              <ScanBarcodeIcon size={15} />
              Scan a piece
            </a>
            <a href="/products" className={heroBtnGhost}>
              Open catalog
              <ArrowRightIcon size={14} className="g-btn-arrow" />
            </a>
          </>
        }
        stats={[
          { label: "Network status", value: "Live" },
          { label: "Board rate", value: "LKR/g" },
          { label: "Modules", value: "3 of 6" },
          { label: "Approvals", value: "0 open" },
        ]}
      />

      <StatGrid cols={4}>
        {CARDS.map((c) => (
          <StatCard key={c.title} label={c.title} value={c.value} sub={c.hint} icon={<c.icon size={16} />} />
        ))}
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Quick actions"
          description="Jump into the connected modules"
          className="lg:col-span-2"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {MODULES.map((m) => (
              <a
                key={m.name}
                href={m.href}
                className="group flex items-start justify-between gap-3 rounded-xl bg-bone/70 p-4 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.06)] transition-all duration-200 ease-brand hover:-translate-y-0.5 hover:bg-paper hover:shadow-2"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-paper text-ink-3 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.08)] transition-colors group-hover:bg-ink group-hover:text-gold">
                    <m.icon size={16} />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink">{m.name}</div>
                    <div className="mt-0.5 text-xs text-ink-4">{m.desc}</div>
                  </div>
                </div>
                <ArrowRightIcon
                  size={14}
                  className="mt-1 shrink-0 text-ink-4 transition-all duration-200 ease-brand group-hover:translate-x-0.5 group-hover:text-gold-dark"
                />
              </a>
            ))}
          </div>
        </Panel>

        <Panel title="Module status" description="What is connected so far">
          <ul className="space-y-3 text-sm">
            {[
              ["Catalog & barcodes", "LIVE"],
              ["Inventory movements", "LIVE"],
              ["Masters & rates", "LIVE"],
              ["Sales & POS", "PENDING"],
              ["Approvals", "PENDING"],
              ["Ledger & cash", "PENDING"],
            ].map(([label, status]) => (
              <li key={label} className="flex items-center justify-between gap-3">
                <span className="text-ink-3">{label}</span>
                <Pill tone={status === "LIVE" ? "success" : "warning"} dot>
                  {status === "LIVE" ? "Live" : "Pending"}
                </Pill>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </Page>
  );
}
