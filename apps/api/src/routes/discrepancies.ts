import { Hono } from "hono";
import { PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { missingReport, scanFlagReport, summaryReport, toCsv, unreceivedReport } from "../services/discrepancies";
import { assertBranchAccess } from "../services/branchAccess";
import { serviceError } from "./http";

function needBranch(branchId: string | undefined) {
  if (!branchId) return { success: false as const, error: { code: "VALIDATION", message: "branchId is required" } };
  return null;
}

function csv(preamble: string[], cols: string[], rows: Record<string, unknown>[]) {
  return new Response(toCsv(preamble, cols, rows), { status: 200, headers: { "Content-Type": "text/csv" } });
}

function csvDenied(c: { get: (k: string) => unknown }) {
  return !(c.get("permissions") as string[]).includes(PERMISSIONS.AUDIT_EXPORT);
}

const COLS = {
  missing: ["countId", "productId", "barcode", "productName", "daysOpen", "status", "posted"],
  scans: ["countId", "barcode", "scannedAt", "scannedBy"],
  unreceived: ["transferId", "number", "barcode", "productId", "fromBranchName", "toBranchName", "ageDays"],
};

export const discrepancies = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/missing", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const branchId = c.req.query("branchId") ?? undefined;
    const denied = needBranch(branchId);
    if (denied) return c.json({ success: false, error: denied.error }, 400);
    try {
      await assertBranchAccess(c.env.DB, c.get("userId"), c.get("permissions") as string[], branchId as string);
      const data = await missingReport(c.env.DB, branchId as string);
      if (c.req.query("format") === "csv") {
        if (csvDenied(c)) return c.json({ success: false, error: { code: "FORBIDDEN", message: "CSV requires audit:export" } }, 403);
        return csv([`generated_at: ${new Date().toISOString()}`, `branch: ${branchId}`, "source: live-read"], COLS.missing, data.rows);
      }
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/unexpected", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const branchId = c.req.query("branchId") ?? undefined;
    const denied = needBranch(branchId);
    if (denied) return c.json({ success: false, error: denied.error }, 400);
    try {
      await assertBranchAccess(c.env.DB, c.get("userId"), c.get("permissions") as string[], branchId as string);
      const data = await scanFlagReport(c.env.DB, branchId as string, "UNEXPECTED");
      if (c.req.query("format") === "csv") {
        if (csvDenied(c)) return c.json({ success: false, error: { code: "FORBIDDEN", message: "CSV requires audit:export" } }, 403);
        return csv([`generated_at: ${new Date().toISOString()}`, `branch: ${branchId}`, "source: live-read", "note: unexpected scans are hygiene, not stock movement"], COLS.scans, data.rows);
      }
      return c.json({ success: true, data: { ...data, note: "Unexpected scans are hygiene, not stock movement" } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/duplicates", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const branchId = c.req.query("branchId") ?? undefined;
    const denied = needBranch(branchId);
    if (denied) return c.json({ success: false, error: denied.error }, 400);
    try {
      await assertBranchAccess(c.env.DB, c.get("userId"), c.get("permissions") as string[], branchId as string);
      const data = await scanFlagReport(c.env.DB, branchId as string, "DUPLICATE");
      if (c.req.query("format") === "csv") {
        if (csvDenied(c)) return c.json({ success: false, error: { code: "FORBIDDEN", message: "CSV requires audit:export" } }, 403);
        return csv([`generated_at: ${new Date().toISOString()}`, `branch: ${branchId}`, "source: live-read", "note: duplicate scans are hygiene, not stock movement"], COLS.scans, data.rows);
      }
      return c.json({ success: true, data: { ...data, note: "Duplicate scans are hygiene, not stock movement" } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/unreceived", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const branchId = c.req.query("branchId") ?? undefined;
    const denied = needBranch(branchId);
    if (denied) return c.json({ success: false, error: denied.error }, 400);
    try {
      await assertBranchAccess(c.env.DB, c.get("userId"), c.get("permissions") as string[], branchId as string);
      const data = await unreceivedReport(c.env.DB, branchId as string);
      if (c.req.query("format") === "csv") {
        if (csvDenied(c)) return c.json({ success: false, error: { code: "FORBIDDEN", message: "CSV requires audit:export" } }, 403);
        return csv([`generated_at: ${new Date().toISOString()}`, `branch: ${branchId}`, "source: live-read", `threshold_days: ${data.thresholdDays}`], COLS.unreceived, data.rows);
      }
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/summary", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const branchId = c.req.query("branchId") ?? undefined;
    const denied = needBranch(branchId);
    if (denied) return c.json({ success: false, error: denied.error }, 400);
    try {
      await assertBranchAccess(c.env.DB, c.get("userId"), c.get("permissions") as string[], branchId as string);
      const data = await summaryReport(c.env.DB, branchId as string);
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  });
