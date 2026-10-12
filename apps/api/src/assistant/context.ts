import { fiscalYearFor, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { branchScope } from "../services/branchAccess";
import { tzOffsetMinutes } from "../services/busdate";
import { getSetting } from "../services/settings";
import { fiscalStartMonth } from "../services/statements";
import { shopClock, type ShopClock } from "./time";

/**
 * Everything one assistant request runs under: who is asking, what they may
 * see, and what time it is at the shop. Built once per request from the
 * database and the server clock — never from anything the model says.
 */

export type BranchInfo = { id: string; name: string; code: string };

export type AssistantContext = {
  env: Env;
  db: D1Database;
  userId: string;
  userName: string;
  permissions: string[];
  /** null = every branch (branches:manage). */
  scope: string[] | null;
  /** Active branches this user may see. */
  branches: BranchInfo[];
  /** The branch selected in the app, when it is one the user may see. */
  selectedBranchId: string | null;
  offsetMinutes: number;
  now: number;
  clock: ShopClock;
  today: string;
  fiscalStartMonth: number;
  fiscalYear: { start: string; end: string; label: string };
  shopName: string;
};

/** accounts:manage without accounts:view is the seeded accountant role; both read the books. */
export const ACCOUNTS_READ = [PERMISSIONS.ACCOUNTS_VIEW, PERMISSIONS.ACCOUNTS_MANAGE];

export function canAny(ctx: Pick<AssistantContext, "permissions">, perms: readonly string[]): boolean {
  return perms.some((p) => ctx.permissions.includes(p));
}

export async function buildContext(
  env: Env,
  input: { userId: string; permissions: string[]; selectedBranchId?: string | null; now?: number }
): Promise<AssistantContext> {
  const db = env.DB;
  const now = input.now ?? Date.now();
  const [user, scope, offset, fsm, shop, rows] = await Promise.all([
    db.prepare("SELECT name FROM users WHERE id = ?").bind(input.userId).first<{ name: string }>(),
    branchScope(db, input.userId, input.permissions),
    tzOffsetMinutes(db),
    fiscalStartMonth(db),
    getSetting(db, "shop_name"),
    db
      .prepare("SELECT id, name, code FROM branches WHERE is_active = 1 ORDER BY name")
      .all<BranchInfo>()
      .then((r) => r.results ?? []),
  ]);
  const branches = scope === null ? rows : rows.filter((b) => scope.includes(b.id));
  const clock = shopClock(now, offset);
  const selected = input.selectedBranchId && branches.some((b) => b.id === input.selectedBranchId) ? input.selectedBranchId : null;
  return {
    env,
    db,
    userId: input.userId,
    userName: user?.name ?? "there",
    permissions: input.permissions,
    scope,
    branches,
    selectedBranchId: selected,
    offsetMinutes: offset,
    now,
    clock,
    today: clock.date,
    fiscalStartMonth: fsm,
    fiscalYear: fiscalYearFor(clock.date, fsm),
    shopName: typeof shop?.value === "string" && shop.value ? shop.value : "the shop",
  };
}

export function toolError(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

/** Finds a branch by id, code or name among the branches this user may see. */
export function findBranch(ctx: AssistantContext, ref: string): BranchInfo {
  const q = ref.trim().toLowerCase();
  const hit =
    ctx.branches.find((b) => b.id === ref.trim()) ??
    ctx.branches.find((b) => b.code.toLowerCase() === q) ??
    ctx.branches.find((b) => b.name.toLowerCase() === q) ??
    (() => {
      const partial = ctx.branches.filter((b) => b.name.toLowerCase().includes(q));
      return partial.length === 1 ? partial[0] : undefined;
    })();
  if (!hit)
    toolError(
      "NOT_FOUND",
      `No branch "${ref}" that this user can see. Branches available: ${ctx.branches.map((b) => `${b.name} (${b.code})`).join(", ") || "none"}`
    );
  return hit;
}

/**
 * The branch a read runs for. Named → that branch (if the user may see it).
 * Not named → the whole shop for someone with branches:manage; otherwise the
 * app's selected branch, or the user's only branch. Someone limited to
 * several branches must say which — the services filter one branch at a time.
 */
export function readBranch(ctx: AssistantContext, ref: string | undefined): BranchInfo | null {
  if (ref && ref.trim() && !/^(all|shop|whole shop|all branches)$/i.test(ref.trim())) return findBranch(ctx, ref);
  if (ctx.scope === null) return null;
  const pick = ctx.branches.find((b) => b.id === ctx.selectedBranchId) ?? (ctx.branches.length === 1 ? ctx.branches[0] : undefined);
  if (!pick)
    toolError(
      "VALIDATION",
      ctx.branches.length === 0
        ? "This user is not a member of any branch."
        : `Shop-wide figures need branches:manage. Ask the user which branch: ${ctx.branches.map((b) => b.name).join(", ")}`
    );
  return pick;
}

/** A branch that must be named or unambiguous: closings, writes, per-branch cash. */
export function requireBranch(ctx: AssistantContext, ref: string | undefined): BranchInfo {
  if (ref && ref.trim()) return findBranch(ctx, ref);
  const pick = ctx.branches.find((b) => b.id === ctx.selectedBranchId) ?? (ctx.branches.length === 1 ? ctx.branches[0] : undefined);
  if (!pick)
    toolError("VALIDATION", `Which branch? Ask the user to choose one of: ${ctx.branches.map((b) => b.name).join(", ")}`);
  return pick;
}

export function branchLabel(ctx: AssistantContext, b: BranchInfo | null): string {
  return b ? `${b.name} branch` : `whole shop (all ${ctx.branches.length} branches)`;
}
