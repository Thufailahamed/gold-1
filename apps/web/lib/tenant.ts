"use client";

export const TENANT_COOKIE = "goldos_tenant";

function cookieAttrs(): string {
  // The API sets Secure;SameSite=None in production. Mirror it here so the
  // picker cookie the browser writes matches what the server reads.
  const secure = typeof window !== "undefined" && window.location.protocol === "https:";
  return secure ? "; Path=/; Max-Age=2592000; Secure; SameSite=None" : "; Path=/; Max-Age=2592000; SameSite=Lax";
}

export function readTenantSlug(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const m = document.cookie.match(/(?:^|;\s*)goldos_tenant=([^;]+)/);
  return m?.[1]?.trim() || undefined;
}

export function writeTenantSlug(slug: string): void {
  document.cookie = `${TENANT_COOKIE}=${slug}${cookieAttrs()}`;
}

export function clearTenant(): void {
  document.cookie = `${TENANT_COOKIE}=; Path=/; Max-Age=0`;
}
