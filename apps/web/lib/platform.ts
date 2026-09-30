"use client";

import { useQuery } from "@tanstack/react-query";
import type { ApiResponse } from "@goldos/shared";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

/** Keeps the API error code (MFA_REQUIRED, CONFLICT…) that a plain Error would drop. */
export class PlatformError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "PlatformError";
    this.code = code;
    this.status = status;
  }
}

/** Fetch against the control-plane API (/platform/v1). */
export async function papi<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`${BASE}/platform/v1${path}`, {
    ...rest,
    body: json === undefined ? rest.body : JSON.stringify(json),
    headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) },
    credentials: "include",
  });
  let body: ApiResponse<T>;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new PlatformError(`Request failed (${res.status})`, "INTERNAL", res.status);
  }
  if (!body.success) throw new PlatformError(body.error.message, body.error.code, res.status);
  return body.data;
}

export async function pdownload(path: string, filename: string): Promise<void> {
  const res = await fetch(`${BASE}/platform/v1${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ Session */

export type PlatformMe = {
  admin: {
    id: string;
    email: string;
    name: string;
    role: string;
    mfa_enabled: number;
    last_login_at: number | null;
    last_login_ip: string | null;
    created_at: number;
  };
  permissions: string[];
  company: string;
  maintenance: boolean;
};

export function usePlatformMe() {
  return useQuery({
    queryKey: ["platform-me"],
    queryFn: () => papi<PlatformMe>("/auth/me"),
    retry: false,
    staleTime: 60_000,
  });
}

export function can(me: PlatformMe | undefined, perm: string): boolean {
  return !!me?.permissions.includes(perm);
}

/* ------------------------------------------------------------------ Formatting */

export function money(cents: number | null | undefined, currency = "LKR"): string {
  if (cents === null || cents === undefined) return "—";
  return `${currency} ${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Headline figures: "LKR 1.24M". */
export function moneyShort(cents: number | null | undefined, currency = "LKR"): string {
  if (cents === null || cents === undefined) return "—";
  const v = cents / 100;
  if (Math.abs(v) < 10_000) return `${currency} ${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `${currency} ${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v)}`;
}

export function date(at: number | null | undefined): string {
  if (!at) return "—";
  return new Date(at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function dateTime(at: number | null | undefined): string {
  if (!at) return "—";
  return new Date(at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function relative(at: number | null | undefined, now = Date.now()): string {
  if (!at) return "—";
  const diff = at - now;
  const abs = Math.abs(diff);
  const units: Array<[number, string]> = [
    [365 * 864e5, "y"],
    [30 * 864e5, "mo"],
    [864e5, "d"],
    [36e5, "h"],
    [6e4, "m"],
  ];
  for (const [ms, u] of units) {
    if (abs >= ms) {
      const n = Math.floor(abs / ms);
      return diff < 0 ? `${n}${u} ago` : `in ${n}${u}`;
    }
  }
  return diff < 0 ? "just now" : "in a moment";
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 1)).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
}

export function titleCase(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** LKR input (major units) → cents; empty → null. */
export function toCents(v: string | number | null | undefined): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
