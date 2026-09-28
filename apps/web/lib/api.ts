import type { ApiResponse } from "@goldos/shared";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include",
  });
  const body = (await res.json()) as ApiResponse<T>;
  if (!body.success) throw new Error(body.error.message);
  return body.data;
}

export type MeData = {
  user: { id: string; email: string; name: string };
  permissions: string[];
  branchIds: string[];
};

/**
 * Multipart upload. `api` above always sets Content-Type: application/json,
 * which makes a FormData body serialise to "[object FormData]" and the upload
 * silently fails — the browser must set the multipart boundary itself.
 */
export async function formApi<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  const body = (await res.json()) as ApiResponse<T>;
  if (!body.success) throw new Error(body.error.message);
  return body.data;
}

/** An <img> src for an authenticated API route, e.g. a receipt. */
export function assetUrl(path: string): string {
  return `${BASE}${path}`;
}
