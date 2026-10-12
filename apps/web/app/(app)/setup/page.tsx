"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { Page, Hero } from "@/components/ui";
import {
  ArrowRightIcon,
  Building2Icon,
  CoinsIcon,
  GemIcon,
  HistoryIcon,
  LifeBuoyIcon,
  PackageIcon,
  SettingsIcon,
  TagsIcon,
  TruckIcon,
  UserCheckIcon,
  UsersIcon,
} from "@/components/icons";

type IconCmp = (props: { size?: number | string; className?: string }) => React.ReactNode;
type SetupLink = { href: string; title: string; body: string; icon: IconCmp; perm: string | null };

/** Everything that used to crowd the sidebar: master data, organisation and admin. */
const GROUPS: { title: string; description: string; links: SetupLink[] }[] = [
  {
    title: "Parties",
    description: "People you buy from and sell to",
    links: [
      { href: "/customers", title: "Customers", body: "Retail and wholesale customers, credit limits and ledgers", icon: UserCheckIcon, perm: "masters:view" },
      { href: "/suppliers", title: "Suppliers", body: "Vendors, workshops and their ledgers", icon: TruckIcon, perm: "masters:view" },
    ],
  },
  {
    title: "Pricing",
    description: "Rates and purities used on every bill",
    links: [
      { href: "/gold-rates", title: "Gold Rates", body: "Daily gold rates used for pricing", icon: CoinsIcon, perm: "masters:view" },
      { href: "/live-rates", title: "Live Market", body: "Spot metals and FX in LKR", icon: CoinsIcon, perm: "masters:view" },
      { href: "/purities", title: "Purities", body: "Karat and fineness grades", icon: GemIcon, perm: "masters:view" },
      { href: "/metal-types", title: "Metal Types", body: "Gold, silver and other metals", icon: CoinsIcon, perm: "masters:view" },
      { href: "/stone-types", title: "Stone Types", body: "Diamonds and other gem types", icon: GemIcon, perm: "masters:view" },
    ],
  },
  {
    title: "Catalogue",
    description: "How products are classified",
    links: [
      { href: "/categories", title: "Categories", body: "Top-level groups such as rings or chains", icon: TagsIcon, perm: "masters:view" },
      { href: "/subcategories", title: "Subcategories", body: "Finer groups inside each category", icon: TagsIcon, perm: "masters:view" },
      { href: "/designs", title: "Designs", body: "Design codes for products", icon: GemIcon, perm: "masters:view" },
      { href: "/product-types", title: "Product Types", body: "Kinds of product in the catalogue", icon: PackageIcon, perm: "masters:view" },
    ],
  },
  {
    title: "Organisation",
    description: "Branches, staff and system settings",
    links: [
      { href: "/branches", title: "Branches", body: "Shops, vaults and the branch overview", icon: Building2Icon, perm: "branches:view" },
      { href: "/users", title: "Users", body: "Staff accounts, roles and permissions", icon: UsersIcon, perm: "users:view" },
      { href: "/settings", title: "Settings", body: "Invoice letterhead and business rules", icon: SettingsIcon, perm: "settings:view" },
      { href: "/audit", title: "Audit", body: "Who changed what, and when", icon: HistoryIcon, perm: "audit:view" },
      { href: "/support", title: "Help & support", body: "Get help using GoldOS", icon: LifeBuoyIcon, perm: null },
    ],
  },
];

export default function SetupPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const perms = me.data?.permissions ?? [];
  const groups = GROUPS.map((g) => ({
    ...g,
    links: g.links.filter((l) => !l.perm || !me.data || hasPermission(perms, l.perm)),
  })).filter((g) => g.links.length > 0);

  return (
    <Page>
      <Hero
        kicker="Setup"
        title="Setup"
        description="Master data, branches, staff and system settings in one place."
        stats={[{ label: "Sections", value: groups.reduce((n, g) => n + g.links.length, 0) }]}
      />

      {groups.map((g) => (
        <section key={g.title} aria-labelledby={`setup-${g.title}`}>
          <div className="mb-3 flex items-baseline gap-3">
            <h2 id={`setup-${g.title}`} className="text-sm font-semibold text-ink">
              {g.title}
            </h2>
            <span className="text-xs text-ink-4">{g.description}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {g.links.map(({ href, title, body, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="group flex items-start gap-3 rounded-xl bg-paper p-4 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.08)] transition-shadow hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)]"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gold-pale text-gold-deep ring-1 ring-gold-dark/15">
                  <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                    {title}
                    <ArrowRightIcon size={13} className="text-ink-5 transition-transform group-hover:translate-x-0.5 group-hover:text-gold-dark" />
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-ink-4">{body}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </Page>
  );
}
