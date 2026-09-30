import { Hono, type Context } from "hono";
import { z } from "zod";
import { addDays, closeDaySchema, isBusinessDate, PERMISSIONS, reopenDaySchema } from "@goldos/shared";
import { closingReportCsv, dailySummary, investigateDay, listUnclosedDays, varianceReport } from "../services/dayreports";
import type { ClosingReport, ClosingRow } from "../services/dayclose";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { businessDateFor } from "../services/busdate";
import {
  buildClosingReport,
  closeDay,
  getClosing,
  listClosings,
  reopenDay,
} from "../services/dayclose";
import { pagination, serviceError } from "./http";

type Ctx = Context<{ Bindings: Env; Variables: AppVariables }>;

const previewSchema = z.object({
  branchId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const idSchema = z.object({ id: z.string().min(1) });

const dateOr = (v: string | undefined, fallback: string) => (v && isBusinessDate(v) ? v : fallback);

function invalid(c: Ctx, message: string): Response {
  return c.json({ success: false, error: { code: "VALIDATION", message } }, 400);
}

export const dayClosings = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const q = (k: string) => c.req.query(k) ?? undefined;
    const data = await listClosings(c.env.DB, {
      ...pagination(c),
      branchId: q("branchId"),
      from: q("from"),
      to: q("to"),
    });
    return c.json({ success: true, data }, 200);
  })
  // Registered BEFORE /:id. Hono matches in registration order, so a literal
  // path chained after the parameterised one is read as a closing id.
  .get("/preview", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const parsed = previewSchema.safeParse({
      branchId: c.req.query("branchId"),
      date: c.req.query("date"),
    });
    if (!parsed.success) return invalid(c, "branchId is required");
    try {
      const date = parsed.data.date ?? (await businessDateFor(c.env.DB, Date.now()));
      const data = await buildClosingReport(c.env.DB, { branchId: parsed.data.branchId, date });
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  // Finding a missing amount: failing checks, mis-posted documents, every
  // drawer movement, what is pending, and what exactly matches the difference.
  .get("/investigate", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const parsed = previewSchema.safeParse({ branchId: c.req.query("branchId"), date: c.req.query("date") });
    if (!parsed.success) return invalid(c, "branchId is required");
    const actualRaw = c.req.query("actualCents");
    const actualCents = actualRaw !== undefined && actualRaw !== "" ? Number(actualRaw) : undefined;
    if (actualCents !== undefined && !Number.isInteger(actualCents)) return invalid(c, "actualCents must be whole cents");
    try {
      const date = parsed.data.date ?? (await businessDateFor(c.env.DB, Date.now()));
      const data = await investigateDay(c.env.DB, { branchId: parsed.data.branchId, date, actualCents });
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/unclosed", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const branchId = c.req.query("branchId");
    if (!branchId) return invalid(c, "branchId is required");
    const today = await businessDateFor(c.env.DB, Date.now());
    const to = dateOr(c.req.query("to"), addDays(today, -1));
    const from = dateOr(c.req.query("from"), addDays(to, -60));
    const data = await listUnclosedDays(c.env.DB, { branchId, from, to });
    return c.json({ success: true, data: { from, to, days: data } }, 200);
  })
  .get("/variance", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const today = await businessDateFor(c.env.DB, Date.now());
    const to = dateOr(c.req.query("to"), today);
    const from = dateOr(c.req.query("from"), addDays(to, -30));
    if (from > to) return invalid(c, "From must be on or before to");
    const data = await varianceReport(c.env.DB, { from, to, branchId: c.req.query("branchId") || undefined });
    return c.json({ success: true, data }, 200);
  })
  .get("/summary", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const date = dateOr(c.req.query("date"), await businessDateFor(c.env.DB, Date.now()));
    try {
      return c.json({ success: true, data: await dailySummary(c.env.DB, date) }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  // The day's report as CSV: the frozen one when the day is closed, a live
  // preview otherwise (and labelled so).
  .get("/report.csv", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const parsed = previewSchema.safeParse({ branchId: c.req.query("branchId"), date: c.req.query("date") });
    if (!parsed.success) return invalid(c, "branchId is required");
    try {
      const db = c.env.DB;
      const date = parsed.data.date ?? (await businessDateFor(db, Date.now()));
      const branch = await db.prepare("SELECT name FROM branches WHERE id = ?").bind(parsed.data.branchId).first<{ name: string }>();
      const closing = await db
        .prepare("SELECT d.*, u.name AS closer FROM day_closings d LEFT JOIN users u ON u.id = d.closed_by WHERE d.branch_id = ? AND d.close_date = ?")
        .bind(parsed.data.branchId, date)
        .first<ClosingRow & { closer: string | null }>();
      const closed = closing?.status === "CLOSED";
      const report = closed
        ? (JSON.parse(closing!.report_json) as ClosingReport)
        : await buildClosingReport(db, { branchId: parsed.data.branchId, date });
      const csv = closingReportCsv(report, {
        branchName: branch?.name ?? parsed.data.branchId,
        status: closed ? "CLOSED" : "NOT CLOSED (live preview)",
        actualCents: closed ? closing!.actual_cents : null,
        differenceCents: closed ? closing!.difference_cents : null,
        reason: closed ? closing!.difference_reason : null,
        closedBy: closed ? closing!.closer : null,
        denominations: closed && closing!.denominations_json ? (JSON.parse(closing!.denominations_json) as Record<string, number>) : null,
      });
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="day-close-${date}.csv"`,
        },
      });
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/:id", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const parsed = idSchema.safeParse({ id: c.req.param("id") });
    if (!parsed.success) return invalid(c, "Invalid closing id");
    try {
      return c.json({ success: true, data: await getClosing(c.env.DB, parsed.data.id) }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/:id/report", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const parsed = idSchema.safeParse({ id: c.req.param("id") });
    if (!parsed.success) return invalid(c, "Invalid closing id");
    try {
      // The frozen report, not a re-derivation. A report from six months ago
      // must be a record, not a guess about what the code would say today.
      const { report, closing } = await getClosing(c.env.DB, parsed.data.id);
      return c.json(
        { success: true, data: { report, closeDate: closing.close_date, branchId: closing.branch_id } },
        200
      );
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = closeDaySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, "Invalid close");
    try {
      const data = await closeDay(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/:id/reopen", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const id = idSchema.safeParse({ id: c.req.param("id") });
    const body = reopenDaySchema.safeParse(await c.req.json().catch(() => null));
    if (!id.success || !body.success) return invalid(c, "A re-open needs a reason and an approver");
    try {
      const data = await reopenDay(c.env.DB, id.data.id, body.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  });
