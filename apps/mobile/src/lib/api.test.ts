import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock expo modules before importing api
const store = new Map<string, string>();

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    store.delete(key);
  }),
}));

vi.mock("expo-crypto", () => ({
  randomUUID: vi.fn(() => "test-uuid-1234"),
}));

vi.mock("expo-file-system", () => ({
  File: vi.fn(),
  Paths: { cache: "/cache" },
}));

vi.mock("expo-sharing", () => ({
  isAvailableAsync: vi.fn(async () => false),
  shareAsync: vi.fn(),
}));

import {
  api,
  clearSession,
  errorMessage,
  getTenantSlug,
  loadSession,
  login,
  lookupShops,
  logout,
  setTenantSlug,
} from "./api";

describe("Mobile API & Auth Client", () => {
  beforeEach(async () => {
    store.clear();
    await clearSession();
    vi.restoreAllMocks();
  });

  it("handles error messages properly for auth error codes", () => {
    expect(errorMessage({ code: "UNAUTHORIZED" })).toBe("Invalid email, shop or password. Please try again.");
    expect(errorMessage({ code: "TENANT_SUSPENDED" })).toBe("This workspace is suspended. Contact support to restore access.");
    expect(errorMessage({ code: "PROVISIONING" })).toBe("Your shop is still being prepared. Try again in a minute.");
    expect(errorMessage(new Error("Network request failed"))).toBe("No connection. Check your network and try again.");
    expect(errorMessage(new Error("Custom error message"))).toBe("Custom error message");
    expect(errorMessage(null, "Fallback message")).toBe("Fallback message");
  });

  it("loads both session and tenant slug from SecureStore on loadSession", async () => {
    store.set("goldos.session", "token-xyz-123");
    store.set("goldos.tenant", "western-jewellers");

    await loadSession();

    expect(getTenantSlug()).toBe("western-jewellers");
  });

  it("allows setting and updating tenant slug", async () => {
    await setTenantSlug("alpha-gold");
    expect(getTenantSlug()).toBe("alpha-gold");
    expect(store.get("goldos.tenant")).toBe("alpha-gold");

    await setTenantSlug(null);
    expect(getTenantSlug()).toBeNull();
    expect(store.has("goldos.tenant")).toBe(false);
  });

  it("lookupShops calls /api/v1/auth/lookup with lowercased email", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/api/v1/auth/lookup");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body.email).toBe("user@westernjewellers.lk");
      return new Response(JSON.stringify({ success: true, data: { shops: [{ slug: "western-jewellers", name: "Western Jewellers" }] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const shops = await lookupShops("  USER@westernjewellers.lk  ");
    expect(shops).toEqual([{ slug: "western-jewellers", name: "Western Jewellers" }]);
  });

  it("login with explicit slug sends X-Shop-Slug and saves tenant slug", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/api/v1/auth/login");
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-Shop-Slug"]).toBe("western-jewellers");
      const body = JSON.parse(init?.body as string);
      expect(body.slug).toBe("western-jewellers");
      expect(body.email).toBe("owner@westernjewellers.lk");

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            user: { id: "u-1", email: "owner@westernjewellers.lk", name: "Owner" },
            token: "session-abc-456",
            sessionId: "session-abc-456",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await login("owner@westernjewellers.lk", "secret-pass", "western-jewellers");

    expect(getTenantSlug()).toBe("western-jewellers");
    expect(store.get("goldos.session")).toBe("session-abc-456");
    expect(store.get("goldos.tenant")).toBe("western-jewellers");
  });

  it("login without slug auto-looks up single shop and logs in with that slug", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/v1/auth/lookup")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { shops: [{ slug: "kandy-gold", name: "Kandy Gold" }] },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.endsWith("/api/v1/auth/login")) {
        const body = JSON.parse(init?.body as string);
        expect(body.slug).toBe("kandy-gold");
        const headers = init?.headers as Record<string, string>;
        expect(headers["X-Shop-Slug"]).toBe("kandy-gold");
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              user: { id: "u-2", email: "owner@kandygold.lk", name: "Kandy Owner" },
              token: "sess-kandy-789",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error(`Unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await login("owner@kandygold.lk", "password123");

    expect(getTenantSlug()).toBe("kandy-gold");
    expect(store.get("goldos.session")).toBe("sess-kandy-789");
    expect(store.get("goldos.tenant")).toBe("kandy-gold");
  });

  it("authenticated requests carry X-Shop-Slug and Cookie headers", async () => {
    store.set("goldos.session", "my-session-token");
    store.set("goldos.tenant", "my-shop-slug");

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-Shop-Slug"]).toBe("my-shop-slug");
      expect(headers["Authorization"]).toBe("Bearer my-session-token");
      expect(headers["X-Session-Id"]).toBe("my-session-token");
      expect(headers["Cookie"]).toContain("session=my-session-token");
      expect(headers["Cookie"]).toContain("goldos_tenant=my-shop-slug");

      return new Response(
        JSON.stringify({
          success: true,
          data: { rows: [] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await api("/api/v1/products");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("logout clears session and tenant slug from memory and storage", async () => {
    store.set("goldos.session", "token-to-clear");
    store.set("goldos.tenant", "slug-to-clear");

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await logout();

    expect(getTenantSlug()).toBeNull();
    expect(store.has("goldos.session")).toBe(false);
    expect(store.has("goldos.tenant")).toBe(false);
  });
});
