import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, clearSession, loadSession, login as apiLogin, logout as apiLogout, onUnauthorized, type MeData } from "./api";

/**
 * Who is signed in, what they may do, and which branch the device works in.
 *
 * The web app keeps the working branch in a `goldos_branch` cookie that each
 * page reads; here it is persisted on the device and exposed through
 * `useBranch()` (reactive) and `getSavedBranchId()` (synchronous, for the
 * same "default to the saved branch" logic the web pages use).
 */

export type Branch = { id: string; name: string; code?: string; is_active?: number };

const BRANCH_KEY = "goldos.branch";
let savedBranchId = "";

/** The device's working branch id ("" when none chosen yet). Web: readBranchCookie(). */
export function getSavedBranchId(): string {
  return savedBranchId;
}

type SessionState = {
  /** "error": the session exists but /auth/me failed for a non-auth reason (offline). */
  status: "loading" | "signedOut" | "signedIn" | "error";
  error: unknown;
  retry: () => void;
  me: MeData | null;
  perms: string[];
  can: (perm: string) => boolean;
  canAny: (perms: string[]) => boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** After a password change the server already ended the session. */
  forgetSession: () => Promise<void>;
  branchId: string;
  setBranchId: (id: string) => void;
};

const SessionContext = createContext<SessionState | null>(null);

export const meQueryKey = ["me"] as const;
export const fetchMe = () => api<MeData>("/api/v1/auth/me");

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [booted, setBooted] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [branchId, setBranchState] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const [token, branch] = await Promise.all([loadSession(), SecureStore.getItemAsync(BRANCH_KEY).catch(() => null)]);
      if (!alive) return;
      savedBranchId = branch ?? "";
      setBranchState(savedBranchId);
      setHasToken(!!token);
      setBooted(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const me = useQuery({
    queryKey: meQueryKey,
    queryFn: fetchMe,
    enabled: booted && hasToken,
    retry: (n, err) => (err as { code?: string }).code !== "UNAUTHORIZED" && n < 2,
    staleTime: 5 * 60_000,
  });

  useEffect(
    () =>
      onUnauthorized(() => {
        setHasToken(false);
        qc.clear();
      }),
    [qc]
  );

  const setBranchId = useCallback((id: string) => {
    savedBranchId = id;
    setBranchState(id);
    void SecureStore.setItemAsync(BRANCH_KEY, id).catch(() => undefined);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await apiLogin(email, password);
      qc.clear();
      setHasToken(true);
      const data = await qc.fetchQuery({ queryKey: meQueryKey, queryFn: fetchMe });
      // Keep the saved branch only if this user may still work in it.
      if (savedBranchId && !hasPermission(data.permissions, "branches:manage") && !data.branchIds.includes(savedBranchId)) {
        setBranchId(data.branchIds[0] ?? "");
      }
    },
    [qc, setBranchId]
  );

  const signOut = useCallback(async () => {
    await apiLogout().catch(() => undefined);
    setHasToken(false);
    qc.clear();
  }, [qc]);

  const forgetSession = useCallback(async () => {
    await clearSession();
    setHasToken(false);
    qc.clear();
  }, [qc]);

  const value = useMemo<SessionState>(() => {
    const perms = me.data?.permissions ?? [];
    const status: SessionState["status"] = !booted
      ? "loading"
      : !hasToken
        ? "signedOut"
        : me.data
          ? "signedIn"
          : me.isError
            ? (me.error as { code?: string } | null)?.code === "UNAUTHORIZED"
              ? "signedOut"
              : "error"
            : "loading";
    return {
      status,
      error: me.error,
      retry: () => void me.refetch(),
      me: me.data ?? null,
      perms,
      can: (p) => hasPermission(perms, p),
      canAny: (ps) => ps.some((p) => hasPermission(perms, p)),
      signIn,
      signOut,
      forgetSession,
      branchId,
      setBranchId,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, hasToken, me.data, me.isError, me.error, signIn, signOut, forgetSession, branchId, setBranchId]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

/** Shortcut: the signed-in user's data (always present inside the (app) group). */
export function useMe() {
  const s = useSession();
  return { me: s.me, perms: s.perms, can: s.can, canAny: s.canAny };
}

/** All branches (web: GET /api/v1/branches?limit=100). */
export function useBranches() {
  return useQuery({
    queryKey: ["branches"],
    queryFn: () => api<{ rows: Branch[]; total?: number }>("/api/v1/branches?limit=100"),
    staleTime: 5 * 60_000,
  });
}

/**
 * The device's working branch plus the branches this user may pick
 * (shop-wide roles see all, others only their memberships). Falls back to the
 * first visible branch when nothing valid is saved.
 */
export function useBranch() {
  const { me, can, branchId, setBranchId } = useSession();
  const branches = useBranches();
  const canShop = can("branches:manage");
  const visible = useMemo(
    () => (branches.data?.rows ?? []).filter((b) => canShop || (me?.branchIds ?? []).includes(b.id)),
    [branches.data, canShop, me]
  );
  const current = visible.find((b) => b.id === branchId) ?? visible[0] ?? null;
  return {
    branchId: current?.id ?? branchId,
    branch: current,
    setBranchId,
    branches: visible,
    allBranches: branches.data?.rows ?? [],
    canShop,
    isLoading: branches.isLoading,
    branchName: (id: string | null | undefined) =>
      (branches.data?.rows ?? []).find((b) => b.id === id)?.name ?? "—",
  };
}
