import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import {
  gatewayStatus,
  getPublicConfig,
  listSmsLog,
  loadConfig,
  previewReminder,
  saveConfig,
  sendReminders,
  sendTest,
} from "../services/sms";
import { pagination, serviceError } from "./http";
import { getShopDb } from "../platform/resolve";

const settingsSchema = z.object({
  userId: z.string().trim().max(60),
  apiKey: z.string().trim().max(200).optional(),
  senderId: z.string().trim().max(30),
  shopName: z.string().trim().max(80),
  template: z.string().max(600),
  autoEnabled: z.boolean(),
  autoAfterDays: z.number().int().min(0).max(365),
  repeatDays: z.number().int().min(1).max(90),
  sendHour: z.number().int().min(0).max(23),
  minAmountLkr: z.number().min(0).max(100_000_000),
});
const remindSchema = z.object({
  customerIds: z.array(z.string().min(1)).min(1).max(50),
  message: z.string().max(600).optional(),
});
const testSchema = z.object({ phone: z.string().min(5).max(20) });

const invalid = { success: false as const, error: { code: "VALIDATION", message: "Invalid data" } };

export const sms = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/settings", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) =>
    c.json({ success: true, data: await getPublicConfig(getShopDb(c)) }, 200)
  )
  .put("/settings", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid, 400);
    try {
      await saveConfig(getShopDb(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data: await getPublicConfig(getShopDb(c)) }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  // Balance and account state straight from SMSlenz — also proves the credentials.
  .get("/status", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    try {
      return c.json({ success: true, data: await gatewayStatus(await loadConfig(getShopDb(c))) }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/test", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = testSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid, 400);
    try {
      await sendTest(getShopDb(c), parsed.data.phone, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/preview/:customerId", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await previewReminder(getShopDb(c), c.req.param("customerId")) }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/remind", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = remindSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid, 400);
    try {
      const results = await sendReminders(getShopDb(c), parsed.data.customerIds, {
        message: parsed.data.message,
        actorId: c.get("userId"),
      });
      return c.json({ success: true, data: { results } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/log", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const { page, limit } = pagination(c);
    return c.json({ success: true, data: await listSmsLog(getShopDb(c), { customerId: c.req.query("customerId") || undefined, page, limit }) }, 200);
  });
