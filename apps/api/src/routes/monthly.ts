import { Hono } from "hono";
import { monthlyQuerySchema, monthlySnapshotSchema, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { buildMonthlyReport } from "../services/monthly";
import { buildAuditStmt } from "../middleware/audit";
import { serviceError } from "./http";

function shopWideAllowed(perms: string[], branchId: string | undefined): boolean {
  if (branchId) return true;
  return perms.includes(PERMISSIONS.BRANCHES_MANAGE);
}

export const monthly = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/monthly", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const parsed = monthlyQuerySchema.safeParse({
      month: c.req.query("month"),
      year: c.req.query("year"),
      branchId: c.req.query("branchId") ?? undefined,
      categoryId: c.req.query("categoryId") ?? undefined,
      purityId: c.req.query("purityId") ?? undefined,
      staffId: c.req.query("staffId") ?? undefined,
    });
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "month 1-12 and year required" } }, 400);
    const perms = c.get("permissions") as string[];
    if (!shopWideAllowed(perms, parsed.data.branchId))
      return c.json({ success: false, error: { code: "FORBIDDEN", message: "branchId required without branches:manage" } }, 403);
    try {
      const data = await buildMonthlyReport(c.env.DB, parsed.data);
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/monthly/snapshot", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = monthlySnapshotSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "month 1-12 and year required" } }, 400);
    try {
      const report = await buildMonthlyReport(c.env.DB, parsed.data);
      if (report.cashflow.unclassifiedCents !== 0)
        return c.json({ success: false, error: { code: "CONFLICT", message: `Unclassified cash ${report.cashflow.unclassifiedCents} blocks snapshot` } }, 409);
      if (report.warnings.length > 0 && !parsed.data.note?.trim())
        return c.json({ success: false, error: { code: "VALIDATION", message: "Snapshot with warnings requires note" } }, 400);
      const month = `${parsed.data.year}-${String(parsed.data.month).padStart(2, "0")}`;
      const existing = await c.env.DB.prepare(
        `SELECT id FROM month_snapshots WHERE COALESCE(branch_id,'') = COALESCE(?, '') AND month = ?`
      ).bind(parsed.data.branchId ?? null, month).first<{ id: string }>();
      const id = existing?.id ?? crypto.randomUUID();
      const now = Date.now();
      const write = existing
        ? c.env.DB.prepare(`UPDATE month_snapshots SET report_json=?, created_by=?, created_at=? WHERE id=?`).bind(JSON.stringify(report), c.get("userId"), now, id)
        : c.env.DB.prepare(
            `INSERT INTO month_snapshots (id, branch_id, month, from_date, to_date, report_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(id, parsed.data.branchId ?? null, month, report.meta.from, report.meta.to, JSON.stringify(report), c.get("userId"), now);
      await c.env.DB.batch([
        write,
        buildAuditStmt(c.env.DB, {
          userId: c.get("userId"),
          action: "snapshot",
          entity: "month_snapshot",
          entityId: id,
          next: { month, branchId: parsed.data.branchId ?? null },
          branchId: parsed.data.branchId ?? undefined,
          reason: parsed.data.note ?? undefined,
        }),
      ]);
      return c.json({ success: true, data: { id, report } }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/monthly/:id", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const row = await c.env.DB.prepare(`SELECT report_json AS json FROM month_snapshots WHERE id=?`)
      .bind(c.req.param("id"))
      .first<{ json: string }>();
    if (!row) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Snapshot not found" } }, 404);
    return c.json({ success: true, data: JSON.parse(row.json) }, 200);
  })
  .get("/pnl", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const parsed = monthlyQuerySchema.safeParse({
      month: c.req.query("month"),
      year: c.req.query("year"),
      branchId: c.req.query("branchId") ?? undefined,
    });
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "month 1-12 and year required" } }, 400);
    const perms = c.get("permissions") as string[];
    if (!shopWideAllowed(perms, parsed.data.branchId))
      return c.json({ success: false, error: { code: "FORBIDDEN", message: "branchId required without branches:manage" } }, 403);
    const report = await buildMonthlyReport(c.env.DB, parsed.data);
    return c.json({ success: true, data: report.profit }, 200);
  })
  .get("/cashflow", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const parsed = monthlyQuerySchema.safeParse({
      month: c.req.query("month"),
      year: c.req.query("year"),
      branchId: c.req.query("branchId") ?? undefined,
    });
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "month 1-12 and year required" } }, 400);
    const perms = c.get("permissions") as string[];
    if (!shopWideAllowed(perms, parsed.data.branchId))
      return c.json({ success: false, error: { code: "FORBIDDEN", message: "branchId required without branches:manage" } }, 403);
    const report = await buildMonthlyReport(c.env.DB, parsed.data);
    return c.json({ success: true, data: report.cashflow }, 200);
  })
  .get("/aging", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const parsed = monthlyQuerySchema.safeParse({
      month: c.req.query("month"),
      year: c.req.query("year"),
      branchId: c.req.query("branchId") ?? undefined,
    });
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "month 1-12 and year required" } }, 400);
    const perms = c.get("permissions") as string[];
    if (!shopWideAllowed(perms, parsed.data.branchId))
      return c.json({ success: false, error: { code: "FORBIDDEN", message: "branchId required without branches:manage" } }, 403);
    const report = await buildMonthlyReport(c.env.DB, parsed.data);
    return c.json({ success: true, data: { receivables: report.receivables, payables: report.payables } }, 200);
  })
  .get("/valuation", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const parsed = monthlyQuerySchema.safeParse({
      month: c.req.query("month"),
      year: c.req.query("year"),
      branchId: c.req.query("branchId") ?? undefined,
    });
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "month 1-12 and year required" } }, 400);
    const perms = c.get("permissions") as string[];
    if (!shopWideAllowed(perms, parsed.data.branchId))
      return c.json({ success: false, error: { code: "FORBIDDEN", message: "branchId required without branches:manage" } }, 403);
    const report = await buildMonthlyReport(c.env.DB, parsed.data);
    return c.json({ success: true, data: report.inventory }, 200);
  });
