import { Hono } from "hono";
import { customerReceiptSchema, isBusinessDate, PERMISSIONS, voidReceiptSchema } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { businessDateFor } from "../services/busdate";
import {
  createReceipt,
  customerOpenInvoices,
  getReceipt,
  listReceivables,
  listReceipts,
  voidReceipt,
} from "../services/receipts";
import { pagination, serviceError } from "./http";

const date = (v: string | undefined) => (v && isBusinessDate(v) ? v : undefined);

export const receipts = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/receivables", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const asOf = date(c.req.query("asOf")) ?? (await businessDateFor(c.env.DB, Date.now()));
    const data = await listReceivables(c.env.DB, { branchId: c.req.query("branchId") || undefined, asOf });
    return c.json({ success: true, data }, 200);
  })
  .get("/customers/:id/open", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const data = await customerOpenInvoices(c.env.DB, c.req.param("id"), c.req.query("branchId") || undefined);
    return c.json({ success: true, data }, 200);
  })
  .get("/", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const { page, limit } = pagination(c);
    const data = await listReceipts(c.env.DB, {
      page,
      limit,
      branchId: c.req.query("branchId") || undefined,
      customerId: c.req.query("customerId") || undefined,
      from: date(c.req.query("from")),
      to: date(c.req.query("to")),
    });
    return c.json({ success: true, data }, 200);
  })
  .post("/", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = customerReceiptSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid receipt" } }, 400);
    try {
      const data = await createReceipt(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/:id", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    try {
      const data = await getReceipt(c.env.DB, c.req.param("id"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/:id/void", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = voidReceiptSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "A reason is required" } }, 400);
    try {
      const data = await voidReceipt(c.env.DB, c.req.param("id"), parsed.data.reason, c.get("userId"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
