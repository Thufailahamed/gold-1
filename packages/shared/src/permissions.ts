export const PERMISSIONS = {
  USERS_VIEW: "users:view",
  USERS_CREATE: "users:create",
  USERS_EDIT: "users:edit",
  USERS_APPROVE: "users:approve",
  USERS_CANCEL: "users:cancel",
  USERS_EXPORT: "users:export",
  ROLES_VIEW: "roles:view",
  ROLES_MANAGE: "roles:manage",
  BRANCHES_VIEW: "branches:view",
  BRANCHES_CREATE: "branches:create",
  BRANCHES_EDIT: "branches:edit",
  BRANCHES_APPROVE: "branches:approve",
  BRANCHES_MANAGE: "branches:manage",
  SETTINGS_VIEW: "settings:view",
  SETTINGS_EDIT: "settings:edit",
  SETTINGS_MANAGE: "settings:manage",
  AUDIT_VIEW: "audit:view",
  AUDIT_EXPORT: "audit:export",
  MASTERS_VIEW: "masters:view",
  MASTERS_CREATE: "masters:create",
  MASTERS_EDIT: "masters:edit",
  MASTERS_CANCEL: "masters:cancel",
  MASTERS_EXPORT: "masters:export",
  PRODUCTS_VIEW: "products:view",
  PRODUCTS_CREATE: "products:create",
  PRODUCTS_EDIT: "products:edit",
  PRODUCTS_CANCEL: "products:cancel",
  PRODUCTS_EXPORT: "products:export",
  ACCOUNTS_VIEW: "accounts:view",
  ACCOUNTS_MANAGE: "accounts:manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export function hasPermission(granted: string[], required: string): boolean {
  return granted.includes(required);
}

const ALL = Object.values(PERMISSIONS);

export const DEFAULT_ROLES: Record<string, string[]> = {
  owner: [...ALL],
  manager: ALL.filter((p) => p !== "users:approve" && p !== "branches:approve"),
  accountant: [
    "users:view",
    "roles:view",
    "branches:view",
    "settings:view",
    "audit:view",
    "audit:export",
    "masters:view",
    "masters:export",
    "products:view",
    "products:export",
    "accounts:manage",
  ],
  cashier: ["users:view", "branches:view", "masters:view", "products:view", "accounts:view"],
  salesperson: ["branches:view", "masters:view", "products:view"],
  inventory_officer: [
    "branches:view",
    "masters:view",
    "masters:create",
    "masters:edit",
    "masters:cancel",
    "masters:export",
    "products:view",
    "products:create",
    "products:edit",
    "products:cancel",
    "products:export",
  ],
  gold_officer: [
    "branches:view",
    "masters:view",
    "masters:create",
    "masters:export",
    "products:view",
  ],
  manufacturing_staff: ["products:view"],
};
