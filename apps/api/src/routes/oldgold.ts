import { Hono } from "hono";
import { z } from "zod";
import {
  createOldGoldSchema,
  PERMISSIONS,
  purchaseOldGoldSchema,
  testOldGoldSchema,
  valueOldGoldSchema,
  voidOldGoldSchema,
} from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { businessDateFor } from "../services/busdate";
import { addFiles, convertItem, customerOldgold, findByBarcode, getItem, intakeItem, listItems, oldgoldBreakdown, oldgoldSummary, pendingList, purchaseItem, recordTest, releaseItem, valuateItem, voidItem } from "../services/oldgold";
import { pagination, serviceError } from "./http";

/**
 * Report windows must agree with journal_entries.entry_date, which is
 * shop-local. Computing a day boundary with setHours(0,0,0,0) uses the
 * Worker's UTC clock, which is wrong for a shop east of Greenwich: between
 * 19:00 and 24:00 Colombo time the UTC day is already tomorrow.
 */
async function dayBounds(db: D1Database, period: string): Promise<{ from: number; to: number }> {
  const now = Date.now();
  const today = await businessDateFor(db, now);
  const fromDate =
    period === "today" ? today : period === "month" ? `${today.slice(0, 7)}-01` : "1970-01-01";
  return { from: Date.parse(`${fromDate}T00:00:00Z`), to: now };
}

const convertSchema = z.object({
  categoryId: z.string().min(1),
  metalTypeId: z.string().min(1),
  name: z.string().min(1).max(100),
  location: z.string().max(100).optional(),
});

export const oldgold = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .post("/items", requirePerm(PERMISSIONS.OLDGOLD_CREATE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createOldGoldSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid item data" } },
        400
      );
    try {
      const data = await intakeItem(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/items", requirePerm(PERMISSIONS.OLDGOLD_VIEW), async (c) => {
    const perms = c.get("permissions") as string[];
    const num = (k: string) => {
      const v = c.req.query(k);
      return v === undefined ? undefined : Number(v);
    };
    const data = await listItems(
      c.env.DB,
      c.get("userId"),
      perms.includes(PERMISSIONS.BRANCHES_MANAGE),
      {
        ...pagination(c),
        status: c.req.query("status"),
        purityId: c.req.query("purityId"),
        branchId: c.req.query("branchId"),
        customerId: c.req.query("customerId"),
        from: num("from"),
        to: num("to"),
      }
    );
    return c.json({ success: true, data }, 200);
  })
  .get("/items/barcode/:code", requirePerm(PERMISSIONS.OLDGOLD_VIEW), async (c) => {
    try {
      const data = await findByBarcode(c.env.DB, c.req.param("code"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/items/:id", requirePerm(PERMISSIONS.OLDGOLD_VIEW), async (c) => {
    try {
      const data = await getItem(c.env.DB, c.req.param("id"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/items/:id/tests", requirePerm(PERMISSIONS.OLDGOLD_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = testOldGoldSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid test data" } },
        400
      );
    try {
      const data = await recordTest(c.env.DB, c.req.param("id"), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/items/:id/value", requirePerm(PERMISSIONS.OLDGOLD_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = valueOldGoldSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid valuation data" } },
        400
      );
    try {
      const data = await valuateItem(c.env.DB, c.req.param("id"), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/items/:id/purchase", requirePerm(PERMISSIONS.OLDGOLD_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = purchaseOldGoldSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid purchase data" } },
        400
      );
    try {
      const data = await purchaseItem(
        c.env.DB,
        c.req.param("id"),
        { paidLkr: parsed.data.paidLkr, method: parsed.data.method },
        c.get("userId")
      );
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/items/:id/release", requirePerm(PERMISSIONS.OLDGOLD_EDIT), async (c) => {
    try {
      await releaseItem(c.env.DB, c.req.param("id"), c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post(
    "/items/:id/convert",
    requirePerm(PERMISSIONS.OLDGOLD_EDIT),
    requirePerm(PERMISSIONS.PRODUCTS_CREATE),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = convertSchema.safeParse(body);
      if (!parsed.success)
        return c.json(
          { success: false, error: { code: "VALIDATION", message: "Invalid convert data" } },
          400
        );
      try {
        const data = await convertItem(c.env.DB, c.req.param("id"), parsed.data, c.get("userId"));
        return c.json({ success: true, data }, 201);
      } catch (err) {
        return serviceError(c, err);
      }
    }
  )
  .post("/items/:id/files", requirePerm(PERMISSIONS.OLDGOLD_EDIT), async (c) => {
    const id = c.req.param("id");
    const form = await c.req.parseBody();
    const kindRaw = form["kind"];
    const kind = kindRaw === "doc" ? "doc" : "image";
    const files = Object.entries(form)
      .filter(([k]) => k === "file" || k.startsWith("file"))
      .map(([, v]) => v)
      .filter((v): v is File => v instanceof File);
    if (files.length === 0)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "file required" } },
        400
      );
    for (const f of files) {
      if (kind === "image") {
        if (f.size > 5 * 1024 * 1024)
          return c.json({ success: false, error: { code: "VALIDATION", message: "Max 5MB per image" } }, 400);
        if (!["image/jpeg", "image/png", "image/webp"].includes(f.type))
          return c.json({ success: false, error: { code: "VALIDATION", message: "jpeg/png/webp only" } }, 400);
      } else if (f.size > 10 * 1024 * 1024) {
        return c.json({ success: false, error: { code: "VALIDATION", message: "Max 10MB per document" } }, 400);
      }
    }
    try {
      const keys: string[] = [];
      for (const f of files) {
        const ext = f.name.includes(".") ? f.name.split(".").pop() : "bin";
        const key = `oldgold/${id}/${crypto.randomUUID()}.${ext}`;
        await c.env.R2.put(key, await f.arrayBuffer(), { httpMetadata: { contentType: f.type } });
        keys.push(key);
      }
      const data = await addFiles(c.env.DB, id, kind, keys, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/items/:id/files/:file", requirePerm(PERMISSIONS.OLDGOLD_VIEW), async (c) => {
    const key = `oldgold/${c.req.param("id")}/${c.req.param("file")}`;
    const obj = await c.env.R2.get(key);
    if (!obj)
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "File not found" } },
        404
      );
    c.header("Content-Type", obj.httpMetadata?.contentType ?? "application/octet-stream");
    return c.body(await obj.arrayBuffer(), 200);
  })
  .patch("/items/:id/void", requirePerm(PERMISSIONS.OLDGOLD_CANCEL), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = z.object({ reason: z.string().min(1).max(500) }).safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Reason is required" } },
        400
      );
    try {
      await voidItem(c.env.DB, c.req.param("id"), parsed.data.reason, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/reports/summary", requirePerm(PERMISSIONS.OLDGOLD_VIEW), async (c) => {
    const { from, to } = await dayBounds(c.env.DB, c.req.query("period") ?? "all");
    const data = await oldgoldSummary(c.env.DB, {
      from,
      to,
      branchId: c.req.query("branchId"),
    });
    return c.json({ success: true, data }, 200);
  })
  .get("/reports/breakdown", requirePerm(PERMISSIONS.OLDGOLD_VIEW), async (c) => {
    const parsed = z
      .object({ groupBy: z.enum(["purity", "customer", "branch"]) })
      .safeParse({ groupBy: c.req.query("groupBy") });
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid groupBy" } },
        400
      );
    const { from, to } = await dayBounds(c.env.DB, c.req.query("period") ?? "all");
    const data = await oldgoldBreakdown(c.env.DB, {
      from,
      to,
      branchId: c.req.query("branchId"),
      groupBy: parsed.data.groupBy,
    });
    return c.json({ success: true, data }, 200);
  })
  .get("/reports/pending", requirePerm(PERMISSIONS.OLDGOLD_VIEW), async (c) => {
    const data = await pendingList(c.env.DB, c.req.query("branchId"));
    return c.json({ success: true, data }, 200);
  })
  .get("/customers/:id/history", requirePerm(PERMISSIONS.OLDGOLD_VIEW), async (c) => {
    try {
      const data = await customerOldgold(c.env.DB, c.req.param("id"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
