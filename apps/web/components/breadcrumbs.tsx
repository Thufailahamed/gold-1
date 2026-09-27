"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";

const LABELS: Record<string, string> = {
  users: "Users",
  branches: "Branches",
  categories: "Categories",
  purities: "Purities",
  "gold-rates": "Gold Rates",
  suppliers: "Suppliers",
  customers: "Customers",
  products: "Products",
  scan: "Scan",
  inventory: "Inventory",
  settings: "Settings",
  audit: "Audit",
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const segs = pathname.split("/").filter(Boolean);
  if (segs.length === 0) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4"
    >
      <Link href="/" className="transition-colors hover:text-gold-dark">
        Dashboard
      </Link>
      {segs.map((s, i) => {
        const href = "/" + segs.slice(0, i + 1).join("/");
        const last = i === segs.length - 1;
        return (
          <Fragment key={href}>
            <span className="text-ink-5">/</span>
            {last ? (
              <span className="text-ink">{LABELS[s] ?? s}</span>
            ) : (
              <Link href={href} className="transition-colors hover:text-gold-dark">
                {LABELS[s] ?? s}
              </Link>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
