import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { ApiResponse } from "@goldos/shared";

/**
 * API client for the GoldOS worker. Mirrors apps/web/lib/api.ts: same
 * envelope, same idempotent-retry rule.
 *
 * Auth differs from the browser: the API issues an HttpOnly `session`
 * cookie. A native app has no shared cookie jar it can rely on across
 * restarts, so the session id is read from Set-Cookie at sign-in, kept in the
 * Keychain / Keystore, and sent explicitly as a Cookie header. Native
 * requests carry no Origin header, so the API's CSRF guard lets them through.
 */
export const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? "https://goldos-api.thufailahamed627.workers.dev").replace(/\/+$/, "");

const SESSION_KEY = "goldos.session";
const TENANT_KEY = "goldos.tenant";
const MUTATIONS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

let sessionId: string | null = null;
let tenantSlug: string | null = null;
let loaded = false;
const unauthorizedListeners = new Set<() => void>();

export async function loadSession(force = false): Promise<string | null> {
  if (!loaded || force) {
    const [storedSession, storedTenant] = await Promise.all([
      SecureStore.getItemAsync(SESSION_KEY).catch(() => null),
      SecureStore.getItemAsync(TENANT_KEY).catch(() => null),
    ]);
    sessionId = storedSession;
    tenantSlug = storedTenant;
    loaded = true;
  }
  return sessionId;
}

export function hasSession(): boolean {
  return !!sessionId;
}

export function getTenantSlug(): string | null {
  return tenantSlug;
}

export async function setTenantSlug(slug: string | null): Promise<void> {
  tenantSlug = slug ? slug.trim() : null;
  if (tenantSlug) {
    await SecureStore.setItemAsync(TENANT_KEY, tenantSlug).catch(() => undefined);
  } else {
    await SecureStore.deleteItemAsync(TENANT_KEY).catch(() => undefined);
  }
}

async function saveSession(id: string | null, slug?: string | null) {
  sessionId = id;
  loaded = true;
  if (slug !== undefined) {
    tenantSlug = slug ? slug.trim() : null;
  }
  await Promise.all([
    id
      ? SecureStore.setItemAsync(SESSION_KEY, id).catch(() => undefined)
      : SecureStore.deleteItemAsync(SESSION_KEY).catch(() => undefined),
    slug !== undefined
      ? slug
        ? SecureStore.setItemAsync(TENANT_KEY, slug.trim()).catch(() => undefined)
        : SecureStore.deleteItemAsync(TENANT_KEY).catch(() => undefined)
      : Promise.resolve(),
  ]);
}

/** Called whenever the API says the session is gone; the session provider signs out. */
export function onUnauthorized(fn: () => void): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (sessionId) {
    headers["Cookie"] = `session=${sessionId}${tenantSlug ? `; goldos_tenant=${tenantSlug}` : ""}`;
    headers["Authorization"] = `Bearer ${sessionId}`;
    headers["X-Session-Id"] = sessionId;
  }
  if (tenantSlug) {
    headers["X-Shop-Slug"] = tenantSlug;
  }
  return headers;
}

/** Headers for an authenticated image (expo-image `source={{ uri, headers }}`). */
export function authedSource(path: string): { uri: string; headers: Record<string, string> } {
  return { uri: assetUrl(path), headers: authHeaders() };
}

export function assetUrl(path: string): string {
  return /^https?:\/\//.test(path) ? path : `${API_BASE}${path}`;
}

async function readBody<T>(res: Response): Promise<ApiResponse<T>> {
  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return { success: false, error: { code: res.status >= 500 ? "INTERNAL" : "UNKNOWN", message: `Request failed (${res.status})` } };
  }
}

function captureSession(res: Response, jsonBody?: unknown) {
  let newSessionId: string | null = null;
  // 1. Response header: x-session-id
  const xSession = res.headers.get("x-session-id");
  if (xSession) {
    newSessionId = xSession;
  }

  // 2. Set-Cookie header if readable
  if (!newSessionId) {
    const raw = res.headers.get("set-cookie");
    if (raw) {
      const m = raw.match(/(?:^|[;,]\s*)session=([^;,]*)/);
      if (m && m[1]) {
        newSessionId = m[1];
      }
    }
  }

  // 3. getSetCookie method if available
  if (!newSessionId) {
    const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    if (typeof getSetCookie === "function") {
      try {
        const cookies = getSetCookie.call(res.headers);
        for (const cookie of cookies) {
          const m = cookie.match(/(?:^|[;,]\s*)session=([^;,]*)/);
          if (m && m[1]) {
            newSessionId = m[1];
            break;
          }
        }
      } catch {}
    }
  }

  // 4. Response JSON data body: token, sessionId, session
  let capturedSlug: string | undefined = undefined;
  if (jsonBody && typeof jsonBody === "object") {
    const data = (jsonBody as { data?: { token?: string; sessionId?: string; session?: string; slug?: string; tenantSlug?: string; tenant?: { slug?: string } } }).data;
    if (!newSessionId) {
      const token = data?.token ?? data?.sessionId ?? data?.session;
      if (token) newSessionId = token;
    }
    const s = data?.slug ?? data?.tenantSlug ?? data?.tenant?.slug;
    if (s && typeof s === "string") capturedSlug = s;
  }

  // 5. Tenant cookie from response headers if present
  if (!capturedSlug) {
    const raw = res.headers.get("set-cookie");
    if (raw) {
      const m = raw.match(/(?:^|[;,]\s*)goldos_tenant=([^;,]*)/);
      if (m && m[1]) capturedSlug = m[1];
    }
  }

  if (newSessionId) {
    void saveSession(newSessionId, capturedSlug);
  } else if (capturedSlug) {
    void setTenantSlug(capturedSlug);
  }
}

function handleUnauthorized(path: string, code: string | undefined) {
  if (code !== "UNAUTHORIZED" || path.startsWith("/api/v1/auth/login")) return;
  void saveSession(null);
  unauthorizedListeners.forEach((fn) => fn());
}

export class ApiError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}


/** The API error code (CONFLICT, VALIDATION, …) carried by an `api` failure. */
export function errorCode(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code;
}

/** A human message for any thrown value. */
export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === "TENANT_SUSPENDED") {
    return "This workspace is suspended. Contact support to restore access.";
  }
  if (code === "PROVISIONING") {
    return "Your shop is still being prepared. Try again in a minute.";
  }
  if (code === "UNAUTHORIZED") {
    return "Invalid email, shop or password. Please try again.";
  }
  if (err instanceof Error && err.message) {
    if (err.name === "CancelledError" || err.message === "CancelledError") {
      return "Sign in request was interrupted. Please try again.";
    }
    if (err.message === "Network request failed") return "No connection. Check your network and try again.";
    return err.message;
  }
  return fallback;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  await loadSession();
  const method = (init?.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...authHeaders(),
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  // Every mutation carries its own key. If the network drops after the server
  // committed (shop Wi-Fi, a POS mid-sale), the one retry below reuses the key
  // and the server replays the first result instead of writing twice.
  const mutation = MUTATIONS.has(method);
  if (mutation && !headers["Idempotency-Key"]) headers["Idempotency-Key"] = Crypto.randomUUID();
  const send = () => fetch(assetUrl(path), { ...init, method, headers, credentials: "include" });
  let res: Response;
  try {
    res = await send();
  } catch (err) {
    if (!mutation) throw err;
    res = await send();
  }
  const body = await readBody<T>(res);
  captureSession(res, body);
  if (!body.success) {
    handleUnauthorized(path, body.error.code);
    throw new ApiError(body.error.message, body.error.code);
  }
  return body.data;
}

/** Shorthand for JSON mutations: `post("/api/v1/x", { a: 1 })`. */
export const post = <T>(path: string, body?: unknown, method: "POST" | "PATCH" | "PUT" | "DELETE" = "POST") =>
  api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

/** A file picked on the device, ready for multipart upload. */
export type UploadFile = { uri: string; name: string; type: string };

/**
 * Multipart upload. React Native's FormData takes `{ uri, name, type }` for a
 * file part; the multipart boundary must be set by fetch itself, so no
 * Content-Type header here.
 */
export async function formApi<T>(path: string, form: FormData): Promise<T> {
  await loadSession();
  const res = await fetch(assetUrl(path), {
    method: "POST",
    body: form,
    headers: { Accept: "application/json", "Idempotency-Key": Crypto.randomUUID(), ...authHeaders() },
    credentials: "include",
  });
  const body = await readBody<T>(res);
  if (!body.success) {
    handleUnauthorized(path, body.error.code);
    throw new ApiError(body.error.message, body.error.code);
  }
  return body.data;
}

/** Appends a picked file to a FormData (RN file-part shape). */
export function appendFile(form: FormData, field: string, file: UploadFile) {
  form.append(field, file as unknown as Blob);
}

/** Authenticated text fetch (CSV, HTML label sheets…). */
export async function apiText(path: string): Promise<string> {
  await loadSession();
  const res = await fetch(assetUrl(path), { headers: authHeaders(), credentials: "include" });
  if (!res.ok) {
    const body = await readBody<never>(res);
    const msg = body.success ? `Download failed: ${res.status}` : body.error.message;
    if (!body.success) handleUnauthorized(path, body.error.code);
    throw new ApiError(msg, body.success ? undefined : body.error.code);
  }
  return res.text();
}

/** Writes text to a cache file and opens the share sheet (Save to Files, Mail, AirDrop…). */
export async function shareTextFile(text: string, filename: string, mimeType = "text/csv"): Promise<void> {
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: filename, UTI: mimeType === "text/csv" ? "public.comma-separated-values-text" : undefined });
  } else {
    throw new Error("Sharing is not available on this device");
  }
}

/** Authenticated CSV download → share sheet. Throws with the API message on error. */
export async function downloadCsv(path: string, filename: string): Promise<void> {
  const text = await apiText(path);
  await shareTextFile(text, filename);
}

export type MeData = {
  user: { id: string; email: string; name: string };
  permissions: string[];
  branchIds: string[];
  tenant?: { id: string; slug: string; name: string } | null;
  tzOffsetMinutes?: number;
};

export type LoginData = {
  user: MeData["user"];
  token?: string;
  sessionId?: string;
  slug?: string;
  tenantSlug?: string;
  tenant?: { id: string; slug: string; name: string } | null;
};

export type ShopLookupItem = { slug: string; name: string };

/** Look up workspaces matching an email. */
export async function lookupShops(email: string): Promise<ShopLookupItem[]> {
  const res = await api<{ shops: ShopLookupItem[] }>("/api/v1/auth/lookup", {
    method: "POST",
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
  return res?.shops ?? [];
}

export async function login(email: string, password: string, explicitSlug?: string) {
  await clearSession();
  let slug = explicitSlug?.trim();
  if (!slug) {
    try {
      const shops = await lookupShops(email);
      if (shops.length === 1 && shops[0]?.slug) {
        slug = shops[0].slug;
      }
    } catch {
      // Lookup is best-effort fallback
    }
  }

  if (slug) {
    tenantSlug = slug;
  }

  const payload = slug ? { email: email.trim(), password, slug } : { email: email.trim(), password };
  const headers: Record<string, string> = {};
  if (slug) {
    headers["X-Shop-Slug"] = slug;
  }

  const data = await api<LoginData>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
    headers,
  });
  const token = data?.token ?? data?.sessionId;
  const finalSlug = slug ?? data?.slug ?? data?.tenantSlug ?? data?.tenant?.slug;
  if (token) {
    await saveSession(token, finalSlug);
  }
  return data;
}

export async function logout(): Promise<void> {
  try {
    await api("/api/v1/auth/logout", { method: "POST" });
  } finally {
    await clearSession();
  }
}

/** Drops the stored session without calling the API (after a password change). */
export async function clearSession(): Promise<void> {
  sessionId = null;
  tenantSlug = null;
  loaded = false;
  await Promise.all([
    SecureStore.deleteItemAsync(SESSION_KEY).catch(() => undefined),
    SecureStore.deleteItemAsync(TENANT_KEY).catch(() => undefined),
  ]);
}
