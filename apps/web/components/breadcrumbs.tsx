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
  settings: "Settings",
  audit: "Audit",
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const segs = pathname.split("/").filter(Boolean);
  if (segs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-stone-500">
      <Link href="/" className="hover:underline">
        Dashboard
      </Link>
      {segs.map((s, i) => {
        const href = "/" + segs.slice(0, i + 1).join("/");
        const last = i === segs.length - 1;
        return (
          <Fragment key={href}>
            <span>/</span>
            {last ? (
              <span className="font-medium text-stone-800">{LABELS[s] ?? s}</span>
            ) : (
              <Link href={href} className="hover:underline">
                {LABELS[s] ?? s}
              </Link>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
