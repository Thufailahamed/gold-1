import { Hono } from "hono";
import { decideApprovalSchema, PERMISSIONS, requestApprovalSchema } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import {
  decideApproval,
  listApprovals,
  requestApproval,
  sweepExpired,
} from "../services/approvals";
import { toCsv } from "../services/discrepancies";
import { pagination, serviceError } from "./http";

// Per-action permissions are enforced inside the service (the deciding perm
// varies by action), so these routes carry no static requirePerm beyond auth.
// Branch scoping follows the member-branches rule: a branchId is required
// without branches:manage.
function shopWideAllowed(perms: string[], branchId: string | undefined): boolean {
  if (branchId) return true;
  return perms.includes(PERMISSIONS.BRANCHES_MANAGE);
}

const COLS = ["id", "action", "entity", "entityId", "requesterId", "approverId", "oldValue", "newValue", "reason", "branchId", "status", "expiresAt", "decidedAt", "createdAt"];

function toRow(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: r.id,
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id,
    requesterId: r.requester_id,
    approverId: r.approver_id,
    oldValue: r.old_value_json,
    newValue: r.new_value_json,
    reason: r.reason,
    branchId: r.branch_id,
    status: r.status,
    expiresAt: r.expires_at,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
  };
}

export const approvals = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", async (c) => {
    const perms = c.get("permissions") as string[];
    const branchId = c.req.query("branchId") ?? undefined;
    if (!shopWideAllowed(perms, branchId))
      return c.json({ success: false, error: { code: "FORBIDDEN", message: "branchId required without branches:manage" } }, 403);
    const status = c.req.query("status") ?? undefined;
    if (status && !["PENDING", "APPROVED", "REJECTED", "EXPIRED"].includes(status))
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid status" } }, 400);
    try {
      const data = await listApprovals(c.env.DB, {
        ...pagination(c),
        status,
        action: c.req.query("action") ?? undefined,
        branchId,
        requesterId: c.req.query("requesterId") ?? undefined,
      });
      const rows = data.rows.map((r) => toRow(r as unknown as Record<string, unknown>));
      if (c.req.query("format") === "csv") {
        if (!perms.includes(PERMISSIONS.AUDIT_EXPORT))
          return c.json({ success: false, error: { code: "FORBIDDEN", message: "CSV requires audit:export" } }, 403);
        return new Response(
          toCsv(
            [`generated_at: ${new Date().toISOString()}`, `branch: ${branchId ?? "shop"}`, "source: live-read, not a frozen snapshot"],
            COLS,
            rows
          ),
          { status: 200, headers: { "Content-Type": "text/csv" } }
        );
      }
      return c.json({ success: true, data: { rows, total: data.total } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = requestApprovalSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid approval request" } }, 400);
    const perms = c.get("permissions") as string[];
    if (!shopWideAllowed(perms, parsed.data.branchId))
      return c.json({ success: false, error: { code: "FORBIDDEN", message: "branchId required without branches:manage" } }, 403);
    try {
      const data = await requestApproval(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/:id/approve", async (c) => {
    const body = (await c.req.json().catch(() => null)) ?? {};
    const parsed = decideApprovalSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid decision" } }, 400);
    try {
      await decideApproval(c.env.DB, c.req.param("id"), { approve: true, reason: parsed.data.reason }, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/:id/reject", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = decideApprovalSchema.safeParse(body);
    if (!parsed.success || !parsed.data.reason)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Rejecting requires a reason" } }, 400);
    try {
      await decideApproval(c.env.DB, c.req.param("id"), { approve: false, reason: parsed.data.reason }, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/sweep", requirePerm(PERMISSIONS.BRANCHES_MANAGE), async (c) => {
    try {
      const expired = await sweepExpired(c.env.DB, Date.now());
      return c.json({ success: true, data: { expired } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
