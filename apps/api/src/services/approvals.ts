import {
  APPROVAL_ACTIONS,
  approvalExpiresAt,
  DEFAULT_PERM,
  isExpiredAsOf,
  thresholdBreached,
  type ApprovalAction,
} from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import { getSetting } from "./settings";
import { fail } from "./cashbank";

export type ApprovalRow = {
  id: string;
  action: string;
  entity: string;
  entity_id: string;
  requester_id: string;
  approver_id: string | null;
  old_value_json: string;
  new_value_json: string;
  reason: string;
  branch_id: string | null;
  status: string;
  expires_at: number;
  decided_at: number | null;
  created_at: number;
};

export type ApprovalHandler = (db: D1Database, approval: ApprovalRow) => Promise<D1PreparedStatement[]>;

const handlers = new Map<ApprovalAction, ApprovalHandler>();

export function registerApprovalHandler(action: ApprovalAction, fn: ApprovalHandler): void {
  handlers.set(action, fn);
}

export function decideGuard(
  row: { status: string; requester_id: string; expires_at: number },
  actorId: string,
  nowMs: number
): string | null {
  if (row.status !== "PENDING") return "CONFLICT";
  if (isExpiredAsOf({ status: row.status, expires_at: row.expires_at }, nowMs)) return "CONFLICT";
  if (row.requester_id === actorId) return "FORBIDDEN";
  return null;
}

export async function getApprovalConfig(
  db: D1Database,
  action: ApprovalAction
): Promise<{ threshold: number | null; ttlHours: number; perm: string }> {
  const [t, ttl, p, def] = await Promise.all([
    getSetting(db, `approval_threshold_${action}`),
    getSetting(db, `approval_ttl_${action}_hours`),
    getSetting(db, `approval_perm_${action}`),
    getSetting(db, "approval_default_ttl_hours"),
  ]);
  const threshold = typeof t?.value === "number" ? t.value : null;
  const ttlHours =
    typeof ttl?.value === "number" ? ttl.value : typeof def?.value === "number" ? def.value : 48;
  const perm = typeof p?.value === "string" ? p.value : DEFAULT_PERM[action];
  return { threshold, ttlHours, perm };
}

async function callerPerms(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT p.name AS name FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE ur.user_id = ?`
    )
    .bind(userId)
    .all<{ name: string }>();
  return (results ?? []).map((r) => r.name);
}

export type RequestApprovalInput = {
  action: ApprovalAction;
  entity: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  metric: number;
  reason: string;
  branchId?: string;
};

export async function requestApproval(
  db: D1Database,
  input: RequestApprovalInput,
  actorId: string
): Promise<{ id: string; status: "PENDING" | "APPROVED" }> {
  if (!(APPROVAL_ACTIONS as readonly string[]).includes(input.action))
    fail("VALIDATION", `Unknown approval action: ${input.action}`);
  if (!input.reason.trim()) fail("VALIDATION", "Approval requests require a reason");
  const config = await getApprovalConfig(db, input.action);
  const now = Date.now();
  const id = crypto.randomUUID();
  if (!thresholdBreached(input.metric, config.threshold)) {
    await db.batch([
      db
        .prepare(
          "INSERT INTO approvals (id, action, entity, entity_id, requester_id, old_value_json, new_value_json, reason, branch_id, status, expires_at, decided_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?, ?)"
        )
        .bind(
          id,
          input.action,
          input.entity,
          input.entityId,
          actorId,
          JSON.stringify(input.oldValue ?? {}),
          JSON.stringify(input.newValue ?? {}),
          `below-threshold auto: ${input.reason}`,
          input.branchId ?? null,
          now,
          now,
          now
        ),
      buildAuditStmt(db, {
        userId: actorId,
        action: "approvals.auto",
        entity: "approval",
        entityId: id,
        next: { action: input.action, status: "APPROVED" },
        branchId: input.branchId,
        reason: input.reason,
      }),
    ]);
    return { id, status: "APPROVED" };
  }
  await db.batch([
    db
      .prepare(
        "INSERT INTO approvals (id, action, entity, entity_id, requester_id, old_value_json, new_value_json, reason, branch_id, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)"
      )
      .bind(
        id,
        input.action,
        input.entity,
        input.entityId,
        actorId,
        JSON.stringify(input.oldValue ?? {}),
        JSON.stringify(input.newValue ?? {}),
        input.reason,
        input.branchId ?? null,
        approvalExpiresAt(now, config.ttlHours),
        now
      ),
    buildAuditStmt(db, {
      userId: actorId,
      action: "approvals.request",
      entity: "approval",
      entityId: id,
      next: { action: input.action, status: "PENDING" },
      branchId: input.branchId,
      reason: input.reason,
    }),
  ]);
  return { id, status: "PENDING" };
}

async function loadApproval(db: D1Database, id: string): Promise<ApprovalRow> {
  const row = await db.prepare("SELECT * FROM approvals WHERE id = ?").bind(id).first<ApprovalRow>();
  if (!row) fail("NOT_FOUND", "Approval not found");
  return row as ApprovalRow;
}

export async function decideApproval(
  db: D1Database,
  id: string,
  input: { approve: boolean; reason?: string },
  actorId: string
): Promise<void> {
  const row = await loadApproval(db, id);
  const now = Date.now();
  const blocked = decideGuard(row, actorId, now);
  if (isExpiredAsOf({ status: row.status, expires_at: row.expires_at }, now)) {
    await db.batch([
      db.prepare("UPDATE approvals SET status = 'EXPIRED' WHERE id = ? AND status = 'PENDING'").bind(id),
      buildAuditStmt(db, {
        userId: actorId,
        action: "approvals.expire",
        entity: "approval",
        entityId: id,
      }),
    ]);
    fail("CONFLICT", "Approval request has expired; re-request to proceed");
  }
  if (blocked) fail(blocked, blocked === "FORBIDDEN" ? "Approver cannot be the requester" : "Approval is not pending");
  if (!input.approve && !input.reason?.trim())
    fail("VALIDATION", "Rejecting an approval requires a reason");
  const config = await getApprovalConfig(db, row.action as ApprovalAction);
  const perms = await callerPerms(db, actorId);
  if (!perms.includes(config.perm))
    fail("FORBIDDEN", `Approval requires ${config.perm}`);
  const status = input.approve ? "APPROVED" : "REJECTED";
  const stmts: D1PreparedStatement[] = [
    db
      .prepare("UPDATE approvals SET status = ?, approver_id = ?, decided_at = ? WHERE id = ? AND status = 'PENDING'")
      .bind(status, actorId, now, id),
  ];
  if (input.approve) {
    const handler = handlers.get(row.action as ApprovalAction);
    if (handler) stmts.push(...(await handler(db, row)));
  }
  stmts.push(
    buildAuditStmt(db, {
      userId: actorId,
      action: input.approve ? "approvals.approve" : "approvals.reject",
      entity: "approval",
      entityId: id,
      prev: { status: "PENDING" },
      next: { status },
      reason: input.reason,
      branchId: row.branch_id ?? undefined,
    })
  );
  await db.batch(stmts);
}

export async function sweepExpired(db: D1Database, nowMs: number): Promise<number> {
  const { results } = await db
    .prepare("SELECT id FROM approvals WHERE status = 'PENDING' AND expires_at < ?")
    .bind(nowMs)
    .all<{ id: string }>();
  const ids = (results ?? []).map((r) => r.id);
  if (ids.length === 0) return 0;
  await db.batch([
    db.prepare("UPDATE approvals SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < ?").bind(nowMs),
    buildAuditStmt(db, {
      userId: null,
      action: "approvals.sweep",
      entity: "approval",
      entityId: "sweep",
      next: { expired: ids.length },
    }),
  ]);
  return ids.length;
}

export async function listApprovals(
  db: D1Database,
  opts: {
    status?: string;
    action?: string;
    branchId?: string;
    requesterId?: string;
    page: number;
    limit: number;
  }
): Promise<{ rows: ApprovalRow[]; total: number }> {
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (opts.status) {
    conds.push("status = ?");
    vals.push(opts.status);
  }
  if (opts.action) {
    conds.push("action = ?");
    vals.push(opts.action);
  }
  if (opts.branchId) {
    conds.push("branch_id = ?");
    vals.push(opts.branchId);
  }
  if (opts.requesterId) {
    conds.push("requester_id = ?");
    vals.push(opts.requesterId);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM approvals ${where}`)
    .bind(...vals)
    .first<{ total: number }>();
  const offset = (opts.page - 1) * opts.limit;
  const { results } = await db
    .prepare(
      `SELECT id, action, entity, entity_id, requester_id, approver_id, old_value_json, new_value_json, reason, branch_id, status, expires_at, decided_at, created_at FROM approvals ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...vals, opts.limit, offset)
    .all<ApprovalRow>();
  return { rows: (results ?? []) as ApprovalRow[], total: count?.total ?? 0 };
}
