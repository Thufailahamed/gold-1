import { Hono } from "hono";
import { z } from "zod";
import {
  accountStatusSchema,
  createAccountSchema,
  PERMISSIONS,
  updateAccountSchema,
} from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { businessDateFor } from "../services/busdate";
import {
  buildEntryStmts,
  createAccount,
  listAccounts,
  reverseEntry,
  setAccountActive,
  updateAccount,
} from "../services/journal";
import { serviceError } from "./http";

const reverseSchema = z.object({
  entryId: z.string().min(1),
  reason: z.string().min(1).max(500),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const adjustSchema = z.object({
  debitAccount: z.string().min(1),
  creditAccount: z.string().min(1),
  amountCents: z.number().int().gt(0),
  memo: z.string().max(500).optional(),
  reason: z.string().min(1).max(500),
  branchId: z.string().min(1).optional(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const accounts = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const rows = await listAccounts(c.env.DB, c.req.query("branchId") ?? undefined);
    return c.json({ success: true, data: rows }, 200);
  })
  .post("/", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createAccountSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid account" } }, 400);
    try {
      const data = await createAccount(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/:code", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateAccountSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid update" } }, 400);
    try {
      await updateAccount(c.env.DB, c.req.param("code"), parsed.data, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/:code/status", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = accountStatusSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid status" } }, 400);
    try {
      await setAccountActive(
        c.env.DB,
        c.req.param("code"),
        parsed.data.isActive,
        parsed.data.reason,
        c.get("userId")
      );
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/adjustments", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = adjustSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid adjustment" } }, 400);
    if (parsed.data.debitAccount === parsed.data.creditAccount)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Accounts must differ" } }, 400);
    try {
      const id = crypto.randomUUID();
      const built = await buildEntryStmts(
        c.env.DB,
        {
          lines: [
            { account: parsed.data.debitAccount, debitCents: parsed.data.amountCents, creditCents: 0 },
            { account: parsed.data.creditAccount, debitCents: 0, creditCents: parsed.data.amountCents },
          ],
          refEntity: "adjustment",
          refId: id,
          memo: parsed.data.memo,
          branchId: parsed.data.branchId,
          actorId: c.get("userId"),
          auditAction: "accounts.adjust",
          auditEntity: "adjustment",
          auditEntityId: id,
          sourceModule: "manual",
        },
        { entryDate: parsed.data.entryDate ?? (await businessDateFor(c.env.DB, Date.now())) }
      );
      await c.env.DB.batch(built.stmts);
      return c.json({ success: true, data: { id, entryId: built.entryId, entryNo: built.entryNo } }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/journal/reverse", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = reverseSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid reversal" } }, 400);
    try {
      const built = await reverseEntry(c.env.DB, parsed.data.entryId, {
        reason: parsed.data.reason,
        entryDate: parsed.data.entryDate,
        actorId: c.get("userId"),
      });
      await c.env.DB.batch(built.stmts);
      return c.json({ success: true, data: { entryId: built.entryId, entryNo: built.entryNo } }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  });
