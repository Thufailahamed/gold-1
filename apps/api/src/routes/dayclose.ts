import { Hono, type Context } from "hono";
import { z } from "zod";
import { closeDaySchema, PERMISSIONS, reopenDaySchema } from "@goldos/shared";
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
