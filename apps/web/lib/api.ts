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
