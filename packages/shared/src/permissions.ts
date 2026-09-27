export const PERMISSIONS = {
  USERS_READ: "users:read",
  USERS_WRITE: "users:write",
  BRANCHES_MANAGE: "branches:manage",
  SETTINGS_WRITE: "settings:write",
  AUDIT_READ: "audit:read",
  MASTERS_READ: "masters:read",
  MASTERS_WRITE: "masters:write",
  PRODUCTS_READ: "products:read",
  PRODUCTS_WRITE: "products:write",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export function hasPermission(granted: string[], required: string): boolean {
  return granted.includes(required);
}

export const DEFAULT_ROLES: Record<string, string[]> = {
  admin: ["users:read", "users:write", "branches:manage", "settings:write", "audit:read", "masters:read", "masters:write", "products:read", "products:write"],
  manager: ["users:read", "branches:manage", "audit:read", "masters:read", "masters:write", "products:read", "products:write"],
  cashier: ["users:read", "masters:read", "products:read"],
  viewer: [],
};
