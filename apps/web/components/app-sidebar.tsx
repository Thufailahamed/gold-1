"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { hasPermission } from "@goldos/shared";
import type { MeData } from "@/lib/api";

const LINKS = [
  { href: "/", label: "Dashboard", perm: null as string | null },
  { href: "/users", label: "Users", perm: "users:read" },
  { href: "/branches", label: "Branches", perm: "branches:manage" },
  { href: "/categories", label: "Categories", perm: "masters:read" },
  { href: "/purities", label: "Purities", perm: "masters:read" },
  { href: "/gold-rates", label: "Gold Rates", perm: "masters:read" },
  { href: "/suppliers", label: "Suppliers", perm: "masters:read" },
  { href: "/customers", label: "Customers", perm: "masters:read" },
  { href: "/products", label: "Products", perm: "products:read" },
  { href: "/settings", label: "Settings", perm: "settings:write" },
  { href: "/audit", label: "Audit", perm: "audit:read" },
];

export function AppSidebar({ me }: { me: MeData }) {
  const pathname = usePathname();
  const visible = LINKS.filter((l) => !l.perm || hasPermission(me.permissions, l.perm));

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-stone-200 bg-white">
      <div className="border-b border-stone-200 px-5 py-4">
        <span className="text-lg font-semibold tracking-tight">
          Gold<span className="text-gold">OS</span>
        </span>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {visible.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`block rounded-md px-3 py-2 text-sm font-medium ${
              pathname === l.href
                ? "bg-stone-900 text-white"
                : "text-stone-600 hover:bg-stone-100"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="border-t border-stone-200 px-5 py-3 text-xs text-stone-500">
        {me.user.name}
        <br />
        {me.user.email}
      </div>
    </aside>
  );
}
