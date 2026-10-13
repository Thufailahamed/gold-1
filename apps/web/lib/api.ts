import type { ApiResponse } from "@goldos/shared";
import { readTenantSlug } from "./tenant";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

const MUTATIONS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** Reads an API body; a non-JSON reply (gateway error page, worker crash) becomes a normal failure. */
async function readBody<T>(res: Response): Promise<ApiResponse<T>> {
  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return { success: false, error: { code: res.status >= 500 ? "INTERNAL" : "UNKNOWN", message: `Request failed (${res.status})` } };
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { "Content-Type": "application/json", ...((init?.headers as Record<string, string>) ?? {}) };
  // Single-domain SaaS: the shop cookie travels automatically; the header is
  // the fallback for environments where third-party cookies are blocked.
  const slug = readTenantSlug();
  if (slug && !headers["X-Shop-Slug"]) headers["X-Shop-Slug"] = slug;
  // Every mutation carries its own key. If the network drops after the server
  // committed (flaky shop Wi-Fi, a POS mid-sale), the one retry below reuses
  // the key and the server replays the first result instead of writing twice.
  const mutation = MUTATIONS.has(method);
  if (mutation && !headers["Idempotency-Key"]) headers["Idempotency-Key"] = crypto.randomUUID();
  const send = () => fetch(`${BASE}${path}`, { ...init, headers, credentials: "include" });
  let res: Response;
  try {
    res = await send();
  } catch (err) {
    if (!mutation) throw err;
    res = await send();
  }
  const body = await readBody<T>(res);
  if (!body.success) {
    throw Object.assign(new Error(body.error.message), { code: body.error.code });
  }
  return body.data;
}

/** The API error code (CONFLICT, VALIDATION, …) carried by an `api` failure. */
export function errorCode(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code;
}


export type MeData = {
  user: { id: string; email: string; name: string };
  permissions: string[];
  branchIds: string[];
  tenant: { id: string; slug: string; name: string } | null;
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
  const body = await readBody<T>(res);
  if (!body.success) throw Object.assign(new Error(body.error.message), { code: body.error.code });
  return body.data;
}

/** An <img> src for an authenticated API route, e.g. a receipt. */
export function assetUrl(path: string): string {
  return `${BASE}${path}`;
}

/** Authenticated text download (server CSV). Throws with the API message on error. */
/** Any binary download (PDF and the like) — the bytes are kept as they came. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!res.ok) {
    const body = await readBody<never>(res);
    throw new Error(body.success ? `Download failed: ${res.status}` : body.error.message);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadCsv(path: string, filename: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!res.ok) {
    const body = await readBody<never>(res);
    throw new Error(body.success ? `Download failed: ${res.status}` : body.error.message);
  }
  const text = await res.text();
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
