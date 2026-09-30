import { PERMISSIONS } from "@goldos/shared";

/**
 * Which branches a caller may see. `null` means every branch (holders of
 * branches:manage); otherwise the caller's branch_members rows. Same rule the
 * product, sales and purchase lists already apply — stock is never mixed
 * across branches for someone who works in one.
 */
export async function branchScope(db: D1Database, userId: string, perms: string[]): Promise<string[] | null> {
  if (perms.includes(PERMISSIONS.BRANCHES_MANAGE)) return null;
  const { results } = await db
    .prepare("SELECT branch_id FROM branch_members WHERE user_id = ?")
    .bind(userId)
    .all<{ branch_id: string }>();
  return (results ?? []).map((r) => r.branch_id);
}

export function inScope(scope: string[] | null, branchId: string): boolean {
  return scope === null || scope.includes(branchId);
}

export async function assertBranchAccess(
  db: D1Database,
  userId: string,
  perms: string[],
  branchId: string,
  what = "this branch"
): Promise<void> {
  const scope = await branchScope(db, userId, perms);
  if (!inScope(scope, branchId))
    throw Object.assign(new Error(`You are not a member of ${what}`), { code: "FORBIDDEN" });
}

/**
 * Active users holding `perm` (optionally restricted to members of a branch),
 * minus the people the rule excludes — so the approver picker only offers
 * someone the server will accept.
 */
export async function eligibleApprovers(
  db: D1Database,
  perm: string,
  opts: { branchId?: string; exclude: (string | null | undefined)[] }
): Promise<{ id: string; name: string }[]> {
  const vals: unknown[] = [perm];
  let member = "";
  if (opts.branchId) {
    member = " AND u.id IN (SELECT user_id FROM branch_members WHERE branch_id = ?)";
    vals.push(opts.branchId);
  }
  const { results } = await db
    .prepare(
      `SELECT DISTINCT u.id, u.name FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE u.is_active = 1 AND p.name = ?${member} ORDER BY u.name`
    )
    .bind(...vals)
    .all<{ id: string; name: string }>();
  const skip = new Set(opts.exclude.filter(Boolean));
  return (results ?? []).filter((u) => !skip.has(u.id));
}
