import { Hono, type Context } from "hono";
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
import { businessDateFor, tzOffsetMinutes } from "../services/busdate";
import { assertBranchAccess, branchScope, inScope } from "../services/branchAccess";
import { addFiles, assertCanAddFiles, convertItem, customerOldgold, findByBarcode, getItem, intakeItem, listItems, oldgoldBreakdown, oldgoldSummary, pendingList, purchaseItem, recordTest, releaseItem, valuateItem, voidItem } from "../services/oldgold";
import { pagination, serviceError } from "./http";
import { getShopDb } from "../platform/resolve";

/**
 * Report windows must agree with journal_entries.entry_date, which is
 * shop-local. Computing a day boundary with setHours(0,0,0,0) uses the
 * Worker's UTC clock, which is wrong for a shop east of Greenwich: between
 * 19:00 and 24:00 Colombo time the UTC day is already tomorrow. The local
 * midnight is the UTC midnight of that date MINUS the shop's offset — taking
 * the UTC midnight itself dropped everything from 00:00 to 05:30 local.
 */
async function dayBounds(db: D1Database, period: string): Promise<{ from: number; to: number }> {
  const now = Date.now();
  const today = await businessDateFor(db, now);
  if (period !== "today" && period !== "month") return { from: 0, to: now };
  const fromDate = period === "today" ? today : `${today.slice(0, 7)}-01`;
  const offsetMs = (await tzOffsetMinutes(db)) * 60_000;
  return { from: Date.parse(`${fromDate}T00:00:00Z`) - offsetMs, to: now };
}

type Ctx = Context<{ Bindings: Env; Variables: AppVariables }>;

/** Item routes act only on items in a branch the caller works in. */
async function assertItemAccess(c: Ctx, itemId: string): Promise<void> {
  const row = await getShopDb(c).prepare("SELECT branch_id FROM old_gold_items WHERE id = ?").bind(itemId).first<{ branch_id: string }>();
  if (!row) throw Object.assign(new Error("Item not found"), { code: "NOT_FOUND" });
  await assertBranchAccess(getShopDb(c), c.get("userId"), c.get("permissions"), row.branch_id, "this item's branch");
}

/** Scope for list/report reads; a requested branch outside it is refused. */
async function readScope(c: Ctx, branchId: string | undefined): Promise<string[] | null> {
  const scope = await branchScope(getShopDb(c), c.get("userId"), c.get("permissions"));
  if (branchId && !inScope(scope, branchId))
    throw Object.assign(new Error("You are not a member of this branch"), { code: "FORBIDDEN" });
  return scope;
}

/** Served files never render as a page on the API origin (no stored XSS via an uploaded .html "document"). */
const INLINE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

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
      await assertBranchAccess(getShopDb(c), c.get("userId"), c.get("permissions"), parsed.data.branchId);
      const data = await intakeItem(getShopDb(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/items", requirePerm(PERMISSIONS.OLDGOLD_VIEW), async (c) => {
    const num = (k: string) => {
      const v = c.req.query(k);
      const n = v === undefined || v === "" ? NaN : Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    try {
      const branchId = c.req.query("branchId") || undefined;
      const scope = await readScope(c, branchId);
      const data = await listItems(getShopDb(c), scope, {
        ...pagination(c),
        status: c.req.query("status") || undefined,
        purityId: c.req.query("purityId") || undefined,
        branchId,
        customerId: c.req.query("customerId") || undefined,
        from: num("from"),
        to: num("to"),
      });
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/items/barcode/:code", requirePerm(PERMISSIONS.OLDGOLD_VIEW), async (c) => {
    try {
      const data = await findByBarcode(getShopDb(c), c.req.param("code"));
      await assertItemAccess(c, data.item.id);
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/items/:id", requirePerm(PERMISSIONS.OLDGOLD_VIEW), async (c) => {
    try {
      await assertItemAccess(c, c.req.param("id"));
      const data = await getItem(getShopDb(c), c.req.param("id"));
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
      await assertItemAccess(c, c.req.param("id"));
      const data = await recordTest(getShopDb(c), c.req.param("id"), parsed.data, c.get("userId"));
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
      await assertItemAccess(c, c.req.param("id"));
      const data = await valuateItem(getShopDb(c), c.req.param("id"), parsed.data, c.get("userId"));
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
      await assertItemAccess(c, c.req.param("id"));
      const data = await purchaseItem(
        getShopDb(c),
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
      await assertItemAccess(c, c.req.param("id"));
      await releaseItem(getShopDb(c), c.req.param("id"), c.get("userId"));
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
        await assertItemAccess(c, c.req.param("id"));
        const data = await convertItem(getShopDb(c), c.req.param("id"), parsed.data, c.get("userId"));
        return c.json({ success: true, data }, 201);
      } catch (err) {
        return serviceError(c, err);
      }
    }
  )
  .post("/items/:id/files", requirePerm(PERMISSIONS.OLDGOLD_EDIT), async (c) => {
    const id = c.req.param("id");
    const form = await c.req.parseBody({ all: true });
    const kindRaw = form["kind"];
    const kind = kindRaw === "doc" ? "doc" : "image";
    // { all: true } keeps every value of a repeated "file" field; without it
    // only the last of several same-named files arrived.
    const files = Object.entries(form)
      .filter(([k]) => k.startsWith("file"))
      .flatMap(([, v]) => (Array.isArray(v) ? v : [v]))
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
      await assertItemAccess(c, id);
      await assertCanAddFiles(getShopDb(c), id, kind, files.length);
      const keys: string[] = [];
      for (const f of files) {
        const rawExt = f.name.includes(".") ? (f.name.split(".").pop() ?? "") : "";
        const ext = /^[a-z0-9]{1,8}$/i.test(rawExt) ? rawExt.toLowerCase() : "bin";
        const key = `oldgold/${id}/${crypto.randomUUID()}.${ext}`;
        await c.env.R2.put(key, await f.arrayBuffer(), { httpMetadata: { contentType: f.type || "application/octet-stream" } });
        keys.push(key);
      }
      try {
        const data = await addFiles(getShopDb(c), id, kind, keys, c.get("userId"));
        return c.json({ success: true, data }, 201);
      } catch (err) {
        // Not recorded on the item, so nothing would ever reference them.
        await Promise.all(keys.map((k) => c.env.R2.delete(k).catch(() => undefined)));
        throw err;
      }
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/items/:id/files/:file", requirePerm(PERMISSIONS.OLDGOLD_VIEW), async (c) => {
    try {
      await assertItemAccess(c, c.req.param("id"));
    } catch (err) {
      return serviceError(c, err);
    }
    const key = `oldgold/${c.req.param("id")}/${c.req.param("file")}`;
    const obj = await c.env.R2.get(key);
    if (!obj)
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "File not found" } },
        404
      );
    const type = obj.httpMetadata?.contentType ?? "application/octet-stream";
    const inline = INLINE_TYPES.has(type);
    c.header("Content-Type", inline ? type : "application/octet-stream");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Disposition", inline ? "inline" : `attachment; filename="${c.req.param("file").replace(/[^\w.-]/g, "_")}"`);
    return c.body(await obj.arrayBuffer(), 200);
  })
  .patch("/items/:id/void", requirePerm(PERMISSIONS.OLDGOLD_CANCEL), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = voidOldGoldSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Reason is required" } },
        400
      );
    try {
      await assertItemAccess(c, c.req.param("id"));
      await voidItem(getShopDb(c), c.req.param("id"), parsed.data.reason, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/reports/summary", requirePerm(PERMISSIONS.OLDGOLD_VIEW), async (c) => {
    try {
      const branchId = c.req.query("branchId") || undefined;
      const scope = await readScope(c, branchId);
      const { from, to } = await dayBounds(getShopDb(c), c.req.query("period") ?? "all");
      const data = await oldgoldSummary(getShopDb(c), { from, to, branchId, scope });
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
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
    try {
      const branchId = c.req.query("branchId") || undefined;
      const scope = await readScope(c, branchId);
      const { from, to } = await dayBounds(getShopDb(c), c.req.query("period") ?? "all");
      const data = await oldgoldBreakdown(getShopDb(c), { from, to, branchId, scope, groupBy: parsed.data.groupBy });
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/reports/pending", requirePerm(PERMISSIONS.OLDGOLD_VIEW), async (c) => {
    try {
      const branchId = c.req.query("branchId") || undefined;
      const scope = await readScope(c, branchId);
      const data = await pendingList(getShopDb(c), branchId, scope);
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/customers/:id/history", requirePerm(PERMISSIONS.OLDGOLD_VIEW), async (c) => {
    try {
      const scope = await readScope(c, undefined);
      const data = await customerOldgold(getShopDb(c), c.req.param("id"), scope);
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
