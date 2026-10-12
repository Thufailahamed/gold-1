import type { ApprovalAction } from "@goldos/shared";

/**
 * Approvals are switched off: nothing waits for a second person, and no
 * approval records are written. These pass-throughs remain only so the
 * services that used to raise an approval keep one code path; each call is
 * answered "approved" immediately.
 */

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
  _db: D1Database,
  input: RequestApprovalInput,
  _actorId: string
): Promise<{ id: string; status: "PENDING" | "APPROVED"; entity: string; entityId: string; metric: number }> {
  return { id: "", status: "APPROVED", entity: input.entity, entityId: input.entityId, metric: input.metric };
}

/** Never reached while every request is approved; kept for the call sites. */
export function pendingApproval(
  request: { id: string; entity: string; entityId: string; metric: number },
  action: ApprovalAction
): never {
  throw Object.assign(new Error(`${action} requires approval`), { code: "PENDING", approvalId: request.id });
}

export async function recordInlineApproval(
  _db: D1Database,
  _input: RequestApprovalInput & { approverId: string },
  _actorId: string
): Promise<{ id: string }> {
  return { id: "" };
}

export async function consumeApproval(
  _db: D1Database,
  _input: { action: ApprovalAction; id: string; entity: string; entityId: string; metric: number },
  _actorId: string
): Promise<void> {
  return;
}
