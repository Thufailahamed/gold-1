import { Hono, type Context } from "hono";
import { z } from "zod";
import { addDays, CASH_ENTRY_KINDS, hasPermission, isBusinessDate, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { businessDateFor } from "../services/busdate";
import { assertBranchAccess, branchScope, inScope } from "../services/branchAccess";
import { getShopDb } from "../platform/resolve";
import { shopR2 } from "../services/shopStorage";
import { serviceError } from "./http";
import { bumpUsage, checkQuota } from "../assistant/agent";
import { ScanUnavailableError } from "../ai/billscan";
import { scanDaySheet, SHEET_MAX_BYTES, SHEET_MAX_IMAGES, SHEET_TYPES } from "../ai/daysheet-scan";
import {
  acceptRow,
  appendSystemRow,
  getDaySheet,
  ignoreSystemRow,
  linkRow,
  listDaySheets,
  loadHeaderById,
  METHODS,
  openIssueCount,
  saveDaySheet,
  sheetImage,
  type SheetRowInput,
} from "../services/daysheet";
import { createReceipt } from "../services/receipts";
import { createCashEntry } from "../services/cashentries";
import { createParty } from "../services/parties";

type Ctx = Context<{ Bindings: Env; Variables: AppVariables }>;

const DATE = z.string().refine(isBusinessDate, "Invalid date");
const method = z.enum(METHODS as unknown as [string, ...string[]]).nullable().optional();
const cents = z.number().int().min(0).max(1e12).nullable().optional();
const str = (max: number) => z.string().max(max).nullable().optional();

const rowSchema = z.object({
  id: z.string().max(64).optional(),
  refNo: str(40),
  name: str(120),
  phone: str(30),
  details: str(300),
  goldText: str(40),
  goldMg: cents,
  receivedCents: cents,
  receivedMethod: method,
  givenCents: cents,
  givenMethod: method,
  oldGoldCents: cents,
  linkedRef: str(120),
  accepted: z.boolean().optional(),
  acceptNote: str(300),
});

const saveSchema = z.object({
  branchId: z.string().min(1),
  date: DATE,
  rows: z.array(rowSchema).max(400),
  draft: z.boolean().optional(),
});

const recordSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("customer_receipt"),
    customerId: z.string().min(1).optional(),
    newCustomer: z.object({ name: z.string().min(1).max(100), phone: z.string().max(20).optional() }).optional(),
    amountCents: z.number().int().positive(),
    method: z.enum(["cash", "cheque", "bank", "card"]),
    bankAccountId: z.string().min(1).optional(),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("cash_entry"),
    kind: z.enum(["OWNER_CAPITAL", "OWNER_DRAWING", "STAFF_TAKE", "OTHER_INCOME", "OTHER_EXPENSE"]),
    amountCents: z.number().int().positive(),
    method: z.enum(["cash", "bank"]),
    bankAccountId: z.string().min(1).optional(),
    person: z.string().min(1).max(100).optional(),
    note: z.string().min(1).max(500),
  }),
]);

const invalid = (c: Ctx, message: string) => c.json({ success: false, error: { code: "VALIDATION", message } }, 400);
const access = (c: Ctx, branchId: string) =>
  assertBranchAccess(getShopDb(c), c.get("userId"), c.get("permissions") as string[], branchId, "this branch");

/** Sheet-id routes act only on a sheet from a branch the caller works in. */
async function accessSheet(c: Ctx, id: string) {
  const h = await loadHeaderById(getShopDb(c), id);
  await access(c, h.branch_id);
  return h;
}

async function refuseClosed(db: D1Database, branchId: string, date: string): Promise<void> {
  const closed = await db.prepare("SELECT 1 AS x FROM day_closings WHERE branch_id = ? AND close_date = ? AND status = 'CLOSED'").bind(branchId, date).first();
  if (closed) throw Object.assign(new Error("This day is closed — re-open it to change its day sheet"), { code: "CONFLICT" });
}

const ext = (type: string) => (type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg");

export const daySheets = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.DAYCLOSE_VIEW), async (c) => {
    try {
      const db = getShopDb(c);
      const branchId = c.req.query("branchId") || undefined;
      const scope = await branchScope(db, c.get("userId"), c.get("permissions") as string[]);
      if (branchId && !inScope(scope, branchId)) return c.json({ success: false, error: { code: "FORBIDDEN", message: "You are not a member of this branch" } }, 403);
      const today = await businessDateFor(db, Date.now());
      const to = isBusinessDate(c.req.query("to") ?? "") ? c.req.query("to")! : today;
      const from = isBusinessDate(c.req.query("from") ?? "") ? c.req.query("from")! : addDays(to, -60);
      const status = c.req.query("status") || undefined;
      const data = await listDaySheets(db, { branchIds: scope, branchId, from, to, status });
      return c.json({ success: true, data: { from, to, rows: data } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  // Registered before /:id routes: literal paths first.
  .get("/alerts", requirePerm(PERMISSIONS.DAYCLOSE_VIEW), async (c) => {
    try {
      const db = getShopDb(c);
      const scope = await branchScope(db, c.get("userId"), c.get("permissions") as string[]);
      return c.json({ success: true, data: { issues: await openIssueCount(db, scope) } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/day", requirePerm(PERMISSIONS.DAYCLOSE_VIEW), async (c) => {
    const branchId = c.req.query("branchId");
    const date = c.req.query("date");
    if (!branchId || !date || !isBusinessDate(date)) return invalid(c, "branchId and date are required");
    try {
      await access(c, branchId);
      return c.json({ success: true, data: await getDaySheet(getShopDb(c), branchId, date) }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .put("/day", requirePerm(PERMISSIONS.DAYCLOSE_MANAGE), async (c) => {
    const parsed = saveSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error.issues[0]?.message ?? "Invalid day sheet");
    const d = parsed.data;
    try {
      const db = getShopDb(c);
      await access(c, d.branchId);
      if (d.date > (await businessDateFor(db, Date.now()))) return invalid(c, "A day sheet cannot be for a future day");
      await refuseClosed(db, d.branchId, d.date);
      const data = await saveDaySheet(db, { branchId: d.branchId, date: d.date, rows: d.rows as SheetRowInput[], draft: d.draft }, c.get("userId"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  // Photos of the paper sheet → AI reads them → saved as a DRAFT for a
  // person to correct. The photos are kept beside the sheet as evidence.
  .post("/scan", requirePerm(PERMISSIONS.DAYCLOSE_MANAGE), async (c) => {
    const form = await c.req.parseBody({ all: true });
    const branchId = typeof form["branchId"] === "string" ? form["branchId"] : "";
    const date = typeof form["date"] === "string" ? form["date"] : "";
    const mode = form["mode"] === "append" ? "append" : "replace";
    const raw = form["file"];
    const files = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File);
    if (!branchId || !isBusinessDate(date)) return invalid(c, "branchId and date are required");
    if (!files.length) return invalid(c, "Attach a photo of the day sheet under 'file'");
    if (files.length > SHEET_MAX_IMAGES) return invalid(c, `At most ${SHEET_MAX_IMAGES} photos at a time`);
    for (const f of files) {
      if (!(SHEET_TYPES as readonly string[]).includes(f.type)) return invalid(c, "The photo must be a jpeg, png or webp image");
      if (f.size > SHEET_MAX_BYTES) return invalid(c, "Each photo must be under 6MB");
    }
    try {
      const db = getShopDb(c);
      await access(c, branchId);
      const today = await businessDateFor(db, Date.now());
      if (date > today) return invalid(c, "A day sheet cannot be for a future day");
      await refuseClosed(db, branchId, date);
      const env = { ...c.env, DB: db };
      await checkQuota(env, c.get("userId"), today);
      const images = await Promise.all(files.map(async (f) => ({ bytes: new Uint8Array(await f.arrayBuffer()), type: f.type })));
      const scan = await scanDaySheet(env, images, date);
      await bumpUsage(db, c.get("userId"), today);

      const r2 = shopR2(c);
      const keys: string[] = [];
      for (const img of images) {
        const key = `day-sheets/${branchId}/${date}/${crypto.randomUUID()}.${ext(img.type)}`;
        await r2.put(key, img.bytes, { httpMetadata: { contentType: img.type } });
        keys.push(key);
      }
      const prior = await db.prepare("SELECT image_keys FROM day_sheets WHERE branch_id = ? AND sheet_date = ?").bind(branchId, date).first<{ image_keys: string }>();
      const before = mode === "append" ? (await getDaySheet(db, branchId, date)).rows : [];
      const data = await saveDaySheet(
        db,
        { branchId, date, rows: [...before, ...scan.rows], draft: true, imageKeys: keys, replaceImages: mode === "replace", aiModel: scan.model, warnings: scan.warnings },
        c.get("userId")
      );
      // A re-upload replaces the photos it replaces the lines of.
      if (mode === "replace" && prior) await Promise.all((JSON.parse(prior.image_keys) as string[]).map((k) => r2.delete(k).catch(() => undefined)));
      return c.json({ success: true, data: { ...data, scan: { date: scan.date, read: scan.rows.length, warnings: scan.warnings } } }, 200);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (err instanceof ScanUnavailableError) {
        console.error("day sheet scan failure", err);
        return c.json(
          {
            success: false,
            error: { code, message: err.message.startsWith("The model did not") ? err.message : "The sheet reader is not responding right now. Type the lines in, or try again." },
          },
          503
        );
      }
      if (code === "RATE_LIMITED") return c.json({ success: false, error: { code, message: (err as Error).message } }, 429);
      return serviceError(c, err);
    }
  })
  .get("/:id/images/:n", requirePerm(PERMISSIONS.DAYCLOSE_VIEW), async (c) => {
    try {
      await accessSheet(c, c.req.param("id"));
      const { body, contentType } = await sheetImage(getShopDb(c), shopR2(c), c.req.param("id"), Number(c.req.param("n")) || 0);
      c.header("Content-Type", contentType);
      c.header("Cache-Control", "private, max-age=3600");
      return c.body(body, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/:id/rows/:rowId/link", requirePerm(PERMISSIONS.DAYCLOSE_MANAGE), async (c) => {
    const body = z.object({ ref: z.string().min(1).max(120).nullable() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return invalid(c, "Say which transaction to link");
    try {
      const h = await accessSheet(c, c.req.param("id"));
      await refuseClosed(getShopDb(c), h.branch_id, h.sheet_date);
      await linkRow(getShopDb(c), h.id, c.req.param("rowId"), body.data.ref, c.get("userId"));
      return c.json({ success: true, data: await getDaySheet(getShopDb(c), h.branch_id, h.sheet_date) }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/:id/rows/:rowId/accept", requirePerm(PERMISSIONS.DAYCLOSE_MANAGE), async (c) => {
    const body = z.object({ accepted: z.boolean(), note: z.string().max(300).nullable().optional() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return invalid(c, "Invalid accept");
    try {
      const h = await accessSheet(c, c.req.param("id"));
      await refuseClosed(getShopDb(c), h.branch_id, h.sheet_date);
      await acceptRow(getShopDb(c), h.id, c.req.param("rowId"), body.data.accepted, body.data.note ?? null, c.get("userId"));
      return c.json({ success: true, data: await getDaySheet(getShopDb(c), h.branch_id, h.sheet_date) }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/:id/ignore", requirePerm(PERMISSIONS.DAYCLOSE_MANAGE), async (c) => {
    const body = z.object({ ref: z.string().min(1).max(120), ignore: z.boolean(), note: z.string().max(300).nullable().optional() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return invalid(c, "Invalid request");
    try {
      const h = await accessSheet(c, c.req.param("id"));
      await ignoreSystemRow(getShopDb(c), h.id, body.data.ref, body.data.ignore, body.data.note ?? null, c.get("userId"));
      return c.json({ success: true, data: await getDaySheet(getShopDb(c), h.branch_id, h.sheet_date) }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/:id/append", requirePerm(PERMISSIONS.DAYCLOSE_MANAGE), async (c) => {
    const body = z.object({ ref: z.string().min(1).max(120) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return invalid(c, "Say which transaction to add");
    try {
      const h = await accessSheet(c, c.req.param("id"));
      await refuseClosed(getShopDb(c), h.branch_id, h.sheet_date);
      await appendSystemRow(getShopDb(c), h.id, body.data.ref, c.get("userId"));
      return c.json({ success: true, data: await getDaySheet(getShopDb(c), h.branch_id, h.sheet_date) }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  // A line on the paper with nothing in the books: record it now, dated the
  // sheet's day, through the same services (and day locks) as the normal
  // screens, then pair the line with what was created.
  .post("/:id/rows/:rowId/record", requirePerm(PERMISSIONS.DAYCLOSE_MANAGE), async (c) => {
    const body = recordSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return invalid(c, body.error.issues[0]?.message ?? "Invalid entry");
    const perms = c.get("permissions") as string[];
    if (!hasPermission(perms, PERMISSIONS.ACCOUNTS_MANAGE))
      return c.json({ success: false, error: { code: "FORBIDDEN", message: "Recording money needs the accounts:manage permission" } }, 403);
    try {
      const db = getShopDb(c);
      const h = await accessSheet(c, c.req.param("id"));
      await refuseClosed(db, h.branch_id, h.sheet_date);
      const row = await db.prepare("SELECT id FROM day_sheet_rows WHERE id = ? AND sheet_id = ?").bind(c.req.param("rowId"), h.id).first();
      if (!row) return c.json({ success: false, error: { code: "NOT_FOUND", message: "That line is not on this sheet" } }, 404);
      const d = body.data;
      let ref: string;
      if (d.action === "customer_receipt") {
        let customerId = d.customerId;
        if (!customerId) {
          if (!d.newCustomer) return invalid(c, "Pick the customer, or give a name to add one");
          if (!hasPermission(perms, PERMISSIONS.MASTERS_CREATE))
            return c.json({ success: false, error: { code: "FORBIDDEN", message: "Adding a customer needs the masters:create permission" } }, 403);
          const created = await createParty(db, "customers", { name: d.newCustomer.name, phone: d.newCustomer.phone, branchId: h.branch_id, creditLimit: 0 }, c.get("userId"));
          customerId = created.id;
        }
        const r = await createReceipt(
          db,
          { customerId, branchId: h.branch_id, amountCents: d.amountCents, method: d.method, bankAccountId: d.bankAccountId, receiptDate: h.sheet_date, note: d.note ?? "From the day sheet" },
          c.get("userId")
        );
        ref = `customer_receipt:${r.id}`;
      } else {
        const r = await createCashEntry(
          db,
          { branchId: h.branch_id, kind: d.kind, amountCents: d.amountCents, method: d.method, bankAccountId: d.bankAccountId, person: d.person, note: d.note, entryDate: h.sheet_date },
          c.get("userId")
        );
        ref = `${CASH_ENTRY_KINDS[d.kind].refEntity}:${r.id}`;
      }
      await linkRow(db, h.id, c.req.param("rowId"), ref, c.get("userId"));
      return c.json({ success: true, data: await getDaySheet(db, h.branch_id, h.sheet_date) }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  });
