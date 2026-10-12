"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useCountUp } from "@/lib/count-up";
import { Page } from "@/components/ui";
import { HeroBadge, count, type IconCmp } from "@/components/console-kit";
import {
  ArrowRightIcon,
  Building2Icon,
  CheckIcon,
  CoinsIcon,
  GemIcon,
  HistoryIcon,
  LayersIcon,
  LifeBuoyIcon,
  PackageIcon,
  ScaleIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  SparklesIcon,
  TagsIcon,
  TrendingUpIcon,
  TruckIcon,
  UserCheckIcon,
  UsersIcon,
  XIcon,
} from "@/components/icons";

type SetupLink = {
  href: string;
  title: string;
  body: string;
  icon: IconCmp;
  perm: string | null;
  /** List endpoint whose `total` is shown as the record count. */
  countFrom?: string;
  unit?: string;
};
type Group = { key: string; title: string; description: string; tone: string; icon: IconCmp; links: SetupLink[] };

/** Everything that used to crowd the sidebar: master data, organisation and admin. */
const GROUPS: Group[] = [
  {
    key: "parties",
    title: "Parties",
    description: "People you buy from and sell to",
    tone: "#059669",
    icon: UserCheckIcon,
    links: [
      { href: "/customers", title: "Customers", body: "Retail and wholesale customers, credit limits and ledgers", icon: UserCheckIcon, perm: "masters:view", countFrom: "/api/v1/customers", unit: "customers" },
      { href: "/suppliers", title: "Suppliers", body: "Vendors, workshops and their ledgers", icon: TruckIcon, perm: "masters:view", countFrom: "/api/v1/suppliers", unit: "suppliers" },
    ],
  },
  {
    key: "pricing",
    title: "Pricing",
    description: "Rates and purities used on every bill",
    tone: "#B8923F",
    icon: CoinsIcon,
    links: [
      { href: "/gold-rates", title: "Gold Rates", body: "Board rates per gram, by purity", icon: CoinsIcon, perm: "masters:view" },
      { href: "/live-rates", title: "Live Market", body: "Spot metals and FX in LKR", icon: TrendingUpIcon, perm: "masters:view" },
      { href: "/purities", title: "Purities", body: "Karat and fineness grades", icon: ScaleIcon, perm: "masters:view", countFrom: "/api/v1/masters/purities", unit: "grades" },
      { href: "/metal-types", title: "Metal Types", body: "Gold, silver and other metals", icon: LayersIcon, perm: "masters:view", countFrom: "/api/v1/masters/metal-types", unit: "metals" },
      { href: "/stone-types", title: "Stone Types", body: "Diamonds and other gem types", icon: GemIcon, perm: "masters:view", countFrom: "/api/v1/masters/stone-types", unit: "stones" },
    ],
  },
  {
    key: "catalogue",
    title: "Catalogue",
    description: "How products are classified",
    tone: "#7C3AED",
    icon: TagsIcon,
    links: [
      { href: "/categories", title: "Categories", body: "Top-level groups such as rings or chains", icon: TagsIcon, perm: "masters:view", countFrom: "/api/v1/masters/categories", unit: "categories" },
      { href: "/subcategories", title: "Subcategories", body: "Finer groups inside each category", icon: TagsIcon, perm: "masters:view", countFrom: "/api/v1/masters/subcategories", unit: "subcategories" },
      { href: "/designs", title: "Designs", body: "Design codes for products", icon: GemIcon, perm: "masters:view", countFrom: "/api/v1/masters/designs", unit: "designs" },
      { href: "/product-types", title: "Product Types", body: "Kinds of product in the catalogue", icon: PackageIcon, perm: "masters:view", countFrom: "/api/v1/masters/product-types", unit: "types" },
    ],
  },
  {
    key: "org",
    title: "Organisation",
    description: "Branches, staff and system settings",
    tone: "#0284C7",
    icon: Building2Icon,
    links: [
      { href: "/branches", title: "Branches", body: "Shops, vaults and the branch overview", icon: Building2Icon, perm: "branches:view", countFrom: "/api/v1/branches", unit: "branches" },
      { href: "/users", title: "Users", body: "Staff accounts, roles and permissions", icon: UsersIcon, perm: "users:view", countFrom: "/api/v1/users", unit: "accounts" },
      { href: "/settings", title: "Settings", body: "Invoice letterhead and business rules", icon: SettingsIcon, perm: "settings:view" },
      { href: "/audit", title: "Audit", body: "Who changed what, and when", icon: HistoryIcon, perm: "audit:view", countFrom: "/api/v1/audit", unit: "events" },
      { href: "/support", title: "Help & support", body: "Get help using GoldOS", icon: LifeBuoyIcon, perm: null },
    ],
  },
];

type Stat = { label: string; value: number | undefined; loading: boolean; href: string; sub?: string; accent?: boolean };

export default function SetupPage() {
  const [q, setQ] = useState("");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const perms = me.data?.permissions ?? [];
  const allowed = (l: SetupLink) => !l.perm || !me.data || hasPermission(perms, l.perm);
  const visibleLinks = GROUPS.flatMap((g) => g.links.filter(allowed));

  // One `limit=1` read per counted section; the list total is all we need.
  const counted = me.data ? visibleLinks.filter((l) => l.countFrom) : [];
  const counts = useQueries({
    queries: counted.map((l) => ({
      queryKey: ["setup-count", l.countFrom],
      queryFn: () => api<{ total: number }>(`${l.countFrom}?limit=1`),
      staleTime: 60_000,
    })),
  });
  const totalOf = (href: string) => {
    const i = counted.findIndex((l) => l.href === href);
    return i < 0 ? undefined : counts[i]?.data?.total;
  };
  const loadingOf = (href: string) => {
    const i = counted.findIndex((l) => l.href === href);
    return i >= 0 && !!counts[i]?.isLoading;
  };

  const canRates = hasPermission(perms, "masters:view");
  const rates = useQuery({
    queryKey: ["gold-rates-current"],
    queryFn: () => api<{ purity_id: string; karat: string; rate_per_gram: number; effective_from: number }[]>("/api/v1/gold-rates/current"),
    enabled: canRates,
  });
  const roles = useQuery({
    queryKey: ["roles-all"],
    queryFn: () => api<{ id: string; name: string }[]>("/api/v1/roles"),
    enabled: hasPermission(perms, "users:view"),
  });

  const needle = q.trim().toLowerCase();
  const groups = GROUPS.map((g) => ({
    ...g,
    links: g.links.filter(allowed).filter((l) => !needle || `${l.title} ${l.body}`.toLowerCase().includes(needle)),
  })).filter((g) => g.links.length > 0);

  /* ---------- readiness: what a new shop must have before the first bill */
  const purities = totalOf("/purities");
  const boarded = rates.data?.length;
  const checks = [
    { label: "Purities defined", ok: (purities ?? 0) > 0, href: "/purities", detail: purities != null ? `${purities} grades` : null },
    {
      label: "Board rate for every purity",
      ok: purities != null && boarded != null && purities > 0 && boarded >= purities,
      href: "/gold-rates",
      detail: boarded != null && purities != null ? `${boarded} of ${purities}` : null,
    },
    { label: "Metal types", ok: (totalOf("/metal-types") ?? 0) > 0, href: "/metal-types", detail: totalOf("/metal-types") != null ? `${totalOf("/metal-types")}` : null },
    { label: "Categories", ok: (totalOf("/categories") ?? 0) > 0, href: "/categories", detail: totalOf("/categories") != null ? `${totalOf("/categories")}` : null },
    { label: "Product types", ok: (totalOf("/product-types") ?? 0) > 0, href: "/product-types", detail: totalOf("/product-types") != null ? `${totalOf("/product-types")}` : null },
    { label: "At least one branch", ok: (totalOf("/branches") ?? 0) > 0, href: "/branches", detail: totalOf("/branches") != null ? `${totalOf("/branches")}` : null },
    { label: "Staff beyond the owner", ok: (totalOf("/users") ?? 0) > 1, href: "/users", detail: totalOf("/users") != null ? `${totalOf("/users")} accounts` : null },
  ].filter((c) => visibleLinks.some((l) => l.href === c.href));
  const done = checks.filter((c) => c.ok).length;
  const ready = checks.length ? Math.round((done / checks.length) * 100) : 0;
  const next = checks.find((c) => !c.ok);
  const latestRate = (rates.data ?? []).reduce<number | null>((a, r) => (a == null || r.effective_from > a ? r.effective_from : a), null);
  const sortedRates = [...(rates.data ?? [])].sort((a, b) => b.rate_per_gram - a.rate_per_gram);
  const topRate = sortedRates[0]?.rate_per_gram ?? 0;

  const stat = (href: string, label: string, sub?: string): Stat => ({ label, value: totalOf(href), loading: loadingOf(href), href, sub });
  const stats = [
    stat("/customers", "Customers"),
    stat("/suppliers", "Suppliers"),
    { label: "Board rates", value: boarded, loading: rates.isLoading && canRates, href: "/gold-rates", sub: purities != null ? `of ${purities} purities` : undefined, accent: true },
    stat("/categories", "Categories", totalOf("/subcategories") != null ? `${totalOf("/subcategories")} subcategories` : undefined),
    stat("/designs", "Designs"),
    stat("/branches", "Branches"),
    stat("/users", "Users", roles.data ? `${roles.data.length} roles` : undefined),
    stat("/audit", "Audit events"),
  ].filter((s) => (s.href === "/gold-rates" ? canRates : visibleLinks.some((l) => l.href === s.href)));

  return (
    <Page className="space-y-5">
      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden rounded-[24px] bg-void text-paper shadow-5">
        <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-50" />
        <div className="home-drift pointer-events-none absolute -right-32 -top-48 size-[26rem] rounded-full bg-gold/[0.2] blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-48 left-[12%] size-80 rounded-full bg-emerald-400/[0.08] blur-[120px]" />
        <div className="home-noise pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" />

        <div className="relative grid gap-6 px-5 pb-6 pt-6 sm:px-7 sm:pt-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold-deep text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_10px_24px_-10px_rgba(205,168,83,0.7)]">
                <SettingsIcon size={17} />
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold-light/80">Control room</span>
              <HeroBadge tone={ready === 100 ? "good" : "warn"}>{ready}% ready</HeroBadge>
            </div>
            <h1 className="g-display mt-4 text-[34px] leading-none sm:text-[44px]">
              Setup <span className="home-gold-text">&amp; masters</span>
            </h1>
            <p className="mt-2.5 max-w-xl text-[13px] leading-relaxed text-paper/55">
              Master data, pricing, branches, staff and system settings — {visibleLinks.length} sections that shape every bill your shop prints.
            </p>

            <div className="relative mt-5 max-w-lg">
              <SearchIcon size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-paper/40" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setQ("")}
                placeholder="Find a setting — purities, letterhead, staff…"
                aria-label="Find a setup section"
                className="h-11 w-full rounded-xl bg-paper/[0.06] pl-10 pr-10 text-[13px] text-paper shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur transition-shadow placeholder:text-paper/35 focus:outline-none focus:shadow-[inset_0_0_0_1px_rgba(226,194,122,0.65),0_0_0_4px_rgba(205,168,83,0.16)]"
              />
              {q ? (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  aria-label="Clear"
                  className="absolute right-2.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-paper/50 transition hover:bg-paper/10 hover:text-paper"
                >
                  <XIcon size={13} />
                </button>
              ) : (
                <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-paper/15 bg-paper/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-paper/40">
                  esc
                </kbd>
              )}
            </div>

            <nav aria-label="Jump to section" className="mt-3 flex flex-wrap gap-1.5">
              {GROUPS.map((g) => {
                const n = g.links.filter(allowed).length;
                if (!n) return null;
                return (
                  <a
                    key={g.key}
                    href={`#setup-${g.key}`}
                    className="group inline-flex items-center gap-1.5 rounded-full bg-paper/[0.04] px-2.5 py-1 text-[11px] font-medium text-paper/65 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)] transition hover:bg-paper/[0.09] hover:text-paper"
                  >
                    <span className="size-1.5 rounded-full" style={{ background: g.tone }} />
                    {g.title}
                    <span className="g-metric text-[10px] text-paper/35 group-hover:text-paper/60">{n}</span>
                  </a>
                );
              })}
            </nav>
          </div>

          {checks.length ? (
            <div className="home-glass flex items-center gap-5 p-5 lg:w-[22rem]">
              <ReadinessRing value={ready} />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-paper/45">Shop readiness</div>
                <div className="mt-1 text-[13px] font-medium text-paper">
                  {done} of {checks.length} essentials done
                </div>
                {next ? (
                  <>
                    <p className="mt-2 truncate text-[11px] text-paper/50">
                      Next up · <span className="text-gold-light">{next.label}</span>
                    </p>
                    <Link href={next.href} className="home-btn-gold mt-3 h-8 px-3.5 text-[12px]">
                      Continue setup
                      <ArrowRightIcon size={13} />
                    </Link>
                  </>
                ) : (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] text-emerald-300">
                    <SparklesIcon size={13} /> Ready for the first bill
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {stats.length ? (
          <div className="relative grid grid-cols-2 gap-px border-t border-paper/[0.08] bg-paper/[0.07] sm:grid-cols-4">
            {stats.map((s) => (
              <StatTile key={s.label} s={s} />
            ))}
          </div>
        ) : null}
      </section>

      {/* ------------------------------------------------------------ body */}
      <div className="grid gap-5 xl:grid-cols-12">
        <div className="xl:col-span-8 2xl:col-span-9">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center rounded-[20px] border border-dashed border-ink/15 bg-paper/70 px-6 py-12 text-center">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25)]">
                <SearchIcon size={18} />
              </span>
              <p className="mt-3 text-[14px] font-semibold text-ink">Nothing matches “{q}”</p>
              <p className="mt-1 text-[12px] text-ink-4">Try a broader word such as “rates”, “staff” or “invoice”.</p>
              <button type="button" onClick={() => setQ("")} className="g-btn g-btn-secondary mt-4 h-8 px-3 text-[12px]">
                Clear search
              </button>
            </div>
          ) : (
            <div className="gap-5 lg:columns-2 [&>*]:mb-5">
              {groups.map((g, gi) => (
                <GroupCard key={g.key} group={g} index={GROUPS.findIndex((x) => x.key === g.key)} delay={gi * 60}>
                  {g.links.map((l) => {
                    const n = l.countFrom ? totalOf(l.href) : l.href === "/gold-rates" ? boarded : undefined;
                    const unit = l.countFrom ? l.unit : "published";
                    return (
                      <LinkRow
                        key={l.href}
                        link={l}
                        loading={l.countFrom ? loadingOf(l.href) : l.href === "/gold-rates" && rates.isLoading && canRates}
                        value={n}
                        unit={unit}
                      />
                    );
                  })}
                </GroupCard>
              ))}
            </div>
          )}
        </div>

        <aside className="space-y-5 xl:col-span-4 2xl:col-span-3">
          {checks.length ? (
            <section className="relative overflow-hidden rounded-[20px] bg-gradient-to-b from-white to-[#fbfaf6] shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_24px_48px_-32px_rgba(16,32,27,0.3)]">
              <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
              <header className="flex items-center gap-3 px-5 pb-3 pt-5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25)]">
                  <ShieldIcon size={16} />
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <h2 className="text-[14px] font-semibold text-ink">Launch checklist</h2>
                  <p className="truncate text-[11px] text-ink-4">What a shop needs before the first bill</p>
                </div>
                <span
                  className={cn(
                    "g-metric rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    ready === 100 ? "bg-emerald-600/10 text-emerald-700" : "bg-gold/15 text-gold-deep"
                  )}
                >
                  {done}/{checks.length}
                </span>
              </header>
              <div className="mx-5 h-1 overflow-hidden rounded-full bg-ink/[0.06]">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-700 ease-brand",
                    ready === 100 ? "bg-gradient-to-r from-emerald-600 to-emerald-400" : "bg-gradient-to-r from-gold-deep via-gold to-gold-light"
                  )}
                  style={{ width: `${ready}%` }}
                />
              </div>
              <ol className="px-3 pb-3 pt-3">
                {checks.map((c, i) => (
                  <li key={c.label} className="relative">
                    {i < checks.length - 1 ? (
                      <span aria-hidden className={cn("absolute left-[21px] top-[30px] h-[calc(100%-18px)] w-px", c.ok ? "bg-emerald-600/30" : "bg-ink/10")} />
                    ) : null}
                    <Link
                      href={c.href}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-xl px-2 py-2 transition-colors",
                        c.ok ? "hover:bg-bone/70" : "bg-gold-pale/40 shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25)] hover:bg-gold-pale/60"
                      )}
                    >
                      <span
                        className={cn(
                          "relative flex size-[22px] shrink-0 items-center justify-center rounded-full",
                          c.ok
                            ? "bg-gradient-to-b from-emerald-500 to-emerald-700 text-white shadow-[0_4px_10px_-4px_rgba(5,150,105,0.7)]"
                            : "bg-paper text-gold-deep ring-[1.5px] ring-inset ring-gold"
                        )}
                      >
                        {c.ok ? <CheckIcon size={12} /> : <span className="size-2 animate-pulse-soft rounded-full bg-gold" />}
                      </span>
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className={cn("block truncate text-[12.5px]", c.ok ? "text-ink-3" : "font-semibold text-ink")}>{c.label}</span>
                        {c.detail ? <span className="g-metric mt-0.5 block text-[10.5px] text-ink-5">{c.detail}</span> : null}
                      </span>
                      {c.ok ? (
                        <ArrowRightIcon size={12} className="shrink-0 text-ink-6 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                      ) : (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-void px-2 py-0.5 text-[10px] font-semibold text-gold-light">
                          Fix <ArrowRightIcon size={10} className="transition-transform group-hover:translate-x-0.5" />
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {canRates ? (
            <section className="relative overflow-hidden rounded-[20px] bg-void text-paper shadow-4">
              <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-gold/[0.18] blur-[80px]" />
              <div className="home-noise pointer-events-none absolute inset-0" />
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
              <header className="relative flex items-center gap-3 px-5 pb-3 pt-5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold-deep text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
                  <CoinsIcon size={16} />
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <h2 className="text-[14px] font-semibold">Board today</h2>
                  <p className="truncate text-[11px] text-paper/45">
                    {latestRate
                      ? `Last set ${new Date(latestRate).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                      : "Nothing published yet"}
                  </p>
                </div>
              </header>
              <div className="relative px-3 pb-2">
                {rates.isLoading ? (
                  <div className="space-y-2 px-2 py-1">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-9 animate-pulse rounded-lg bg-paper/[0.06]" />
                    ))}
                  </div>
                ) : sortedRates.length ? (
                  <ul className="space-y-1">
                    {sortedRates.map((r) => (
                      <li key={r.purity_id} className="rounded-xl px-2 py-2 transition-colors hover:bg-paper/[0.04]">
                        <div className="flex items-center gap-2.5">
                          <span className="g-metric min-w-[34px] rounded-md bg-gradient-to-b from-gold-light to-gold px-1.5 py-0.5 text-center text-[10.5px] font-bold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
                            {r.karat}
                          </span>
                          <span className="flex-1" />
                          <span className="g-metric text-[15px] font-semibold text-paper">{Math.round(r.rate_per_gram).toLocaleString("en-US")}</span>
                          <span className="text-[9.5px] font-semibold uppercase tracking-wider text-paper/35">LKR/g</span>
                        </div>
                        <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-paper/[0.06]">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold-light"
                            style={{ width: `${topRate ? (r.rate_per_gram / topRate) * 100 : 0}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-2 py-2 text-[11.5px] text-paper/50">Publish a board rate so the till can price gold.</p>
                )}
              </div>
              <Link
                href="/gold-rates"
                className="group relative flex items-center justify-between border-t border-paper/[0.08] px-5 py-3 text-[12px] font-medium text-paper/70 transition-colors hover:bg-paper/[0.04] hover:text-gold-light"
              >
                Manage board rates
                <ArrowRightIcon size={13} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </section>
          ) : null}

          <Link
            href="/support"
            className="group relative flex items-center gap-3 overflow-hidden rounded-[20px] bg-gradient-to-br from-white to-gold-pale/50 p-4 shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_18px_40px_-30px_rgba(126,98,35,0.45)] transition-transform hover:-translate-y-0.5"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light">
              <LifeBuoyIcon size={17} />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-[13px] font-semibold text-ink">Need a hand?</span>
              <span className="mt-0.5 block text-[11px] text-ink-4">Open a ticket with the GoldOS team</span>
            </span>
            <span className="flex size-8 items-center justify-center rounded-full text-ink-4 ring-1 ring-inset ring-ink/10 transition-all group-hover:bg-void group-hover:text-gold-light group-hover:ring-void">
              <ArrowRightIcon size={13} />
            </span>
          </Link>
        </aside>
      </div>
    </Page>
  );
}

/* ---------------------------------------------------------------- parts */

function ReadinessRing({ value }: { value: number }) {
  const id = useId();
  const shown = useCountUp(value);
  const r = 44;
  const c = 2 * Math.PI * r;
  const good = value === 100;
  return (
    <div className="relative size-[104px] shrink-0">
      <svg viewBox="0 0 104 104" className="size-full -rotate-90">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={good ? "#6ee7b7" : "#fbf0d5"} />
            <stop offset="45%" stopColor={good ? "#34d399" : "#e2c27a"} />
            <stop offset="100%" stopColor={good ? "#059669" : "#7e6223"} />
          </linearGradient>
        </defs>
        <circle cx="52" cy="52" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
        <circle
          cx="52"
          cy="52"
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown / 100)}
          style={{ filter: `drop-shadow(0 0 6px ${good ? "rgba(52,211,153,0.45)" : "rgba(226,194,122,0.45)"})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="g-metric text-[24px] font-semibold leading-none text-paper">
          {Math.round(shown)}
          <span className="text-[13px] text-paper/50">%</span>
        </span>
        <span className="mt-1 text-[8.5px] font-semibold uppercase tracking-[0.2em] text-paper/40">ready</span>
      </div>
    </div>
  );
}

function StatTile({ s }: { s: Stat }) {
  const shown = useCountUp(s.value);
  return (
    <Link
      href={s.href}
      className={cn(
        "group relative block min-w-0 px-5 py-4 transition-colors hover:bg-[#0a3a2f]",
        s.accent ? "bg-void bg-gradient-to-br from-gold/[0.18] via-void to-void" : "bg-void"
      )}
    >
      {s.accent ? <span aria-hidden className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-gold-light/0 via-gold-light/70 to-gold-light/0" /> : null}
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-[9.5px] font-semibold uppercase tracking-[0.18em] text-paper/40">{s.label}</span>
        <ArrowRightIcon size={11} className="shrink-0 -translate-x-1 text-gold-light opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
      </span>
      {s.loading ? (
        <span className="mt-2 block h-6 w-16 animate-pulse rounded bg-paper/10" />
      ) : (
        <span className={cn("g-metric mt-1.5 block truncate leading-none", s.accent ? "text-[26px] text-gold-light" : "text-[22px] text-paper")}>
          {s.value == null ? "—" : count(shown)}
        </span>
      )}
      <span className="mt-1.5 block h-[14px] truncate text-[10.5px] text-paper/40">{s.sub}</span>
    </Link>
  );
}

function GroupCard({ group: g, index, delay, children }: { group: Group; index: number; delay: number; children: ReactNode }) {
  return (
    <section
      id={`setup-${g.key}`}
      aria-labelledby={`setup-${g.key}-title`}
      style={{ "--tone": g.tone, animationDelay: `${delay}ms` } as CSSProperties}
      className="relative scroll-mt-24 break-inside-avoid animate-fade-in overflow-hidden rounded-[20px] bg-gradient-to-b from-white to-[#fbfaf6] shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_24px_48px_-32px_rgba(16,32,27,0.3)]"
    >
      <div aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${g.tone}, ${g.tone}00 70%)` }} />
      <div aria-hidden className="pointer-events-none absolute -right-6 -top-6 opacity-[0.07]" style={{ color: g.tone }}>
        <g.icon size={120} />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-28"
        style={{ backgroundImage: `radial-gradient(70% 120% at 0% 0%, ${g.tone}12, transparent 70%)` }}
      />

      <header className="relative flex items-center gap-3 px-5 pb-3 pt-5">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white"
          style={{
            background: `linear-gradient(150deg, ${g.tone}, ${g.tone}cc)`,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.35), 0 10px 22px -10px ${g.tone}`,
          }}
        >
          <g.icon size={18} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="g-metric text-[10px] font-semibold tracking-[0.2em]" style={{ color: g.tone }}>
            {String(index + 1).padStart(2, "0")}
          </div>
          <h2 id={`setup-${g.key}-title`} className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {g.title}
          </h2>
          <p className="truncate text-[11.5px] text-ink-4">{g.description}</p>
        </div>
      </header>

      <div className="relative space-y-0.5 px-2.5 pb-2.5">{children}</div>
    </section>
  );
}

function LinkRow({ link: l, loading, value, unit }: { link: SetupLink; loading: boolean; value: number | undefined; unit?: string }) {
  return (
    <Link
      href={l.href}
      className="group relative flex items-center gap-3 rounded-[14px] px-2.5 py-2.5 transition-colors hover:bg-[color-mix(in_srgb,var(--tone)_6%,transparent)]"
    >
      <span
        aria-hidden
        className="absolute left-0 top-1/2 h-0 w-[3px] -translate-y-1/2 rounded-full bg-[color:var(--tone)] transition-all duration-200 group-hover:h-6"
      />
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-[color-mix(in_srgb,var(--tone)_9%,white)] text-[color:var(--tone)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--tone)_20%,transparent)] transition-all duration-200 group-hover:bg-[color:var(--tone)] group-hover:text-white group-hover:shadow-[0_8px_18px_-8px_var(--tone)]">
        <l.icon size={16} />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block text-[13.5px] font-semibold text-ink">{l.title}</span>
        <span className="mt-0.5 block truncate text-[11.5px] text-ink-4">{l.body}</span>
      </span>
      {loading ? (
        <span className="h-5 w-10 animate-pulse rounded-md bg-ink/[0.06]" />
      ) : value === 0 && l.countFrom ? (
        <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-500/25">Empty</span>
      ) : value != null ? (
        <span className="shrink-0 text-right leading-none">
          <span className="g-metric block text-[16px] font-semibold text-ink">{count(value)}</span>
          <span className="mt-1 block text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-5">{unit}</span>
        </span>
      ) : null}
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-5 ring-1 ring-inset ring-ink/[0.08] transition-all duration-200 group-hover:bg-void group-hover:text-gold-light group-hover:ring-void">
        <ArrowRightIcon size={12} className="transition-transform group-hover:translate-x-px" />
      </span>
    </Link>
  );
}
