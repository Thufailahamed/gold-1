import type { IconName } from "@/ui";

/**
 * Every module of the web sidebar (apps/web/components/app-sidebar.tsx),
 * plus each module's sub-pages, in one place. The More tab renders this; a
 * row shows when the user has `perm` or any of `anyPerm` (no perm = everyone).
 */
export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  color: string;
  perm: string | null;
  anyPerm?: string[];
  subtitle?: string;
};
export type NavSection = { title: string; items: NavItem[] };

const GOLD = "#C9A227";
const INK = "#3A3632";
const GREEN = "#34C759";
const BLUE = "#007AFF";
const ORANGE = "#FF9500";
const RED = "#FF3B30";
const INDIGO = "#5856D6";
const TEAL = "#30B0C7";
const PURPLE = "#AF52DE";
const PINK = "#FF2D55";
const GRAY = "#8E8E93";

export const APPROVER_PERMS = ["sales:approve", "oldgold:approve", "mfg:approve", "users:approve", "branches:approve", "accounts:manage", "gold:manage", "products:cancel", "purchases:cancel"];

export const NAV: NavSection[] = [
  {
    title: "Catalog",
    items: [
      { href: "/products", label: "Products", icon: "package", color: GOLD, perm: "products:view", subtitle: "Pieces, prices & labels" },
      { href: "/inventory", label: "Inventory", icon: "archive", color: INK, perm: "products:view", subtitle: "Stock by branch & movements" },
      { href: "/inventory/counts", label: "Stock Counts", icon: "clipboardCheck", color: TEAL, perm: "products:view" },
      { href: "/inventory/transfers", label: "Transfers", icon: "truck", color: BLUE, perm: "products:view" },
      { href: "/inventory/discrepancies", label: "Discrepancies", icon: "alert", color: RED, perm: "products:view" },
    ],
  },
  {
    title: "Sales",
    items: [
      { href: "/sales", label: "Sales Dashboard", icon: "gauge", color: GREEN, perm: "sales:view", anyPerm: ["sales:create"] },
      { href: "/pos", label: "Point of Sale", icon: "cart", color: GOLD, perm: "sales:create" },
      { href: "/sales/invoices", label: "Invoices", icon: "receipt", color: BLUE, perm: "sales:view" },
      { href: "/sales/returns", label: "Returns", icon: "return", color: ORANGE, perm: "sales:view" },
      { href: "/repairs", label: "Repairs", icon: "hammer", color: INDIGO, perm: "sales:view" },
    ],
  },
  {
    title: "Purchasing",
    items: [{ href: "/purchases", label: "Purchasing", icon: "truck", color: TEAL, perm: "purchases:view", subtitle: "Orders, invoices & reports" }],
  },
  {
    title: "Gold & Workshop",
    items: [
      { href: "/gold", label: "Gold Vault", icon: "coins", color: GOLD, perm: "gold:view", subtitle: "Stock, melting & ledger" },
      { href: "/old-gold", label: "Old Gold", icon: "scale", color: ORANGE, perm: "oldgold:view", anyPerm: ["oldgold:create", "oldgold:edit"], subtitle: "Intake, testing & items" },
      { href: "/manufacturing", label: "Manufacturing", icon: "flame", color: RED, perm: "mfg:view", subtitle: "Orders & workshop reports" },
      { href: "/custom-orders", label: "Custom Orders", icon: "gem", color: PURPLE, perm: "mfg:view" },
    ],
  },
  {
    title: "Accounts",
    items: [
      { href: "/accounts", label: "Accounts", icon: "balance", color: INK, perm: "accounts:view", subtitle: "Books, cash, dues & tax" },
      { href: "/day-closing", label: "Day Closing", icon: "lock", color: INDIGO, perm: "accounts:view" },
      { href: "/expenses", label: "Expenses", icon: "wallet", color: PINK, perm: "accounts:view" },
      { href: "/reports/monthly", label: "Monthly Report", icon: "calendar", color: BLUE, perm: "accounts:view" },
    ],
  },
  {
    title: "Masters",
    items: [
      { href: "/gold-rates", label: "Gold Rates", icon: "coins", color: GOLD, perm: "masters:view" },
      { href: "/customers", label: "Customers", icon: "personCheck", color: GREEN, perm: "masters:view" },
      { href: "/suppliers", label: "Suppliers", icon: "truck", color: TEAL, perm: "masters:view" },
      { href: "/categories", label: "Categories", icon: "tag", color: ORANGE, perm: "masters:view" },
      { href: "/subcategories", label: "Subcategories", icon: "tags", color: ORANGE, perm: "masters:view" },
      { href: "/designs", label: "Designs", icon: "sparkles", color: PURPLE, perm: "masters:view" },
      { href: "/product-types", label: "Product Types", icon: "package", color: BLUE, perm: "masters:view" },
      { href: "/metal-types", label: "Metal Types", icon: "coins", color: GRAY, perm: "masters:view" },
      { href: "/stone-types", label: "Stone Types", icon: "gem", color: PINK, perm: "masters:view" },
      { href: "/purities", label: "Purities", icon: "percent", color: GOLD, perm: "masters:view" },
    ],
  },
  {
    title: "Organisation",
    items: [
      { href: "/branches", label: "Branches", icon: "building", color: BLUE, perm: "branches:view" },
      { href: "/branches/overview", label: "Branch Overview", icon: "gauge", color: INDIGO, perm: "branches:view" },
      { href: "/users", label: "Users & Roles", icon: "people", color: TEAL, perm: "users:view" },
      { href: "/analytics", label: "Analytics", icon: "trendUp", color: GREEN, perm: "branches:manage" },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/approvals", label: "Approvals", icon: "shield", color: ORANGE, perm: null, anyPerm: APPROVER_PERMS },
      { href: "/audit", label: "Audit Log", icon: "history", color: GRAY, perm: "audit:view" },
      { href: "/settings", label: "Settings", icon: "settings", color: GRAY, perm: "settings:view" },
      { href: "/support", label: "Help & Support", icon: "lifebuoy", color: BLUE, perm: null },
    ],
  },
];

export function visibleItems(items: NavItem[], can: (p: string) => boolean): NavItem[] {
  return items.filter((i) => {
    if (!i.perm && !i.anyPerm) return true;
    if (i.perm && can(i.perm)) return true;
    return (i.anyPerm ?? []).some((p) => can(p));
  });
}
