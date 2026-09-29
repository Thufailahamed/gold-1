import { Hono, type Context } from "hono";
import {
  approveExpenseSchema,
  createExpenseCategorySchema,
  createExpenseSchema,
  expenseStatusSchema,
  PERMISSIONS,
  rejectExpenseSchema,
} from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import {
  approveExpense,
  attachReceipt,
  createExpense,
  createExpenseCategory,
  expenseDaily,
  expenseSummary,
  getExpense,
  getReceipt,
  listExpenseCategories,
  listExpenses,
  rejectExpense,
  setExpenseCategoryActive,
} from "../services/expenses";
import { businessDateFor } from "../services/busdate";
import { pagination, serviceError } from "./http";

type Ctx = Context<{ Bindings: Env; Variables: AppVariables }>;

function invalid(c: Ctx, message: string): Response {
  return c.json({ success: false, error: { code: "VALIDATION", message } }, 400);
}

export const expenseCategories = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const rows = await listExpenseCategories(c.env.DB);
    return c.json({ success: true, data: rows }, 200);
  })
  .post("/", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = createExpenseCategorySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, "Invalid expense category");
    try {
      const data = await createExpenseCategory(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/:id/status", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = expenseStatusSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, "Invalid category status");
    try {
      await setExpenseCategoryActive(
        c.env.DB,
        c.req.param("id"),
        parsed.data.isActive,
        parsed.data.reason,
        c.get("userId")
      );
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });

export const expenses = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const q = (k: string) => c.req.query(k) ?? undefined;
    const data = await listExpenses(c.env.DB, {
      ...pagination(c),
      from: q("from"),
      to: q("to"),
      branchId: q("branchId"),
      categoryId: q("categoryId"),
      status: q("status"),
    });
    return c.json({ success: true, data }, 200);
  })
  .post("/", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = createExpenseSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, "Invalid expense");
    try {
      const data = await createExpense(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  // Registered BEFORE /:id. Hono matches in registration order, so a literal
  // path chained after /:id is read as an expense id.
  .get("/reports/summary", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    try {
      const to = c.req.query("to") ?? (await businessDateFor(c.env.DB, Date.now()));
      const from = c.req.query("from") ?? "1970-01-01";
      const data = await expenseSummary(c.env.DB, {
        from,
        to,
        branchId: c.req.query("branchId") ?? undefined,
      });
      return c.json({ success: true, data: { ...data, from, to } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/reports/daily", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const date = /^\d{4}-\d{2}-\d{2}$/;
    const to = c.req.query("to") ?? (await businessDateFor(c.env.DB, Date.now()));
    const from = c.req.query("from") ?? to.slice(0, 8) + "01";
    if (!date.test(from) || !date.test(to)) return invalid(c, "from and to must be YYYY-MM-DD");
    const data = await expenseDaily(c.env.DB, {
      from,
      to,
      branchId: c.req.query("branchId") ?? undefined,
    });
    return c.json({ success: true, data: { from, to, days: data } }, 200);
  })
  .get("/:id", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await getExpense(c.env.DB, c.req.param("id")) }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/:id/approve", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = approveExpenseSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, "Invalid approval");
    try {
      const data = await approveExpense(
        c.env.DB,
        c.req.param("id"),
        parsed.data,
        c.get("userId")
      );
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/:id/reject", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = rejectExpenseSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, "A rejection needs a reason");
    try {
      await rejectExpense(c.env.DB, c.req.param("id"), parsed.data.reason, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/:id/receipt", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const form = await c.req.parseBody();
    const file = form["file"];
    if (!(file instanceof File)) return invalid(c, "Attach a receipt file under 'file'");
    try {
      const data = await attachReceipt(c.env.DB, c.env.R2, c.req.param("id"), file, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/:id/receipt", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    try {
      const { body, contentType } = await getReceipt(c.env.DB, c.env.R2, c.req.param("id"));
      c.header("Content-Type", contentType);
      return c.body(body, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
