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
import { reconcile } from "../services/reconcile";
import { businessDateFor } from "../services/busdate";
import {
  accountStatement,
  buildEntryStmts,
  createAccount,
  getJournalEntry,
  listAccounts,
  listJournalEntries,
  reverseEntry,
  setAccountActive,
  trialBalance,
  updateAccount,
} from "../services/journal";
import { pagination, serviceError } from "./http";

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
  // Literal paths are registered before the /:code handlers below. Hono
  // matches in registration order, so GET /journal reaching /:code first
  // would be read as an account code of "journal".
  .get("/journal", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const q = (k: string) => c.req.query(k) ?? undefined;
    const data = await listJournalEntries(c.env.DB, {
      ...pagination(c),
      from: q("from"),
      to: q("to"),
      branchId: q("branchId"),
      accountCode: q("accountCode"),
      sourceModule: q("sourceModule"),
      refEntity: q("refEntity"),
    });
    return c.json({ success: true, data }, 200);
  })
  .get("/journal/:id", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await getJournalEntry(c.env.DB, c.req.param("id")) }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/trial-balance", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const date = c.req.query("date") ?? (await businessDateFor(c.env.DB, Date.now()));
    const rows = await trialBalance(c.env.DB, { date, branchId: c.req.query("branchId") ?? undefined });
    return c.json({ success: true, data: { date, rows } }, 200);
  })
  .get("/reconciliation", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    try {
      const date = c.req.query("date") ?? (await businessDateFor(c.env.DB, Date.now()));
      const data = await reconcile(c.env.DB, {
        date,
        branchId: c.req.query("branchId") ?? undefined,
      });
      // A failing check is a 200 with passed:false, not an error. The caller
      // needs the whole report to show the operator what is out, and the
      // daily-closing spec decides whether that is fatal.
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/:code/statement", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const to = c.req.query("to") ?? (await businessDateFor(c.env.DB, Date.now()));
    const from = c.req.query("from") ?? "1970-01-01";
    try {
      const data = await accountStatement(c.env.DB, {
        code: c.req.param("code"),
        from,
        to,
        branchId: c.req.query("branchId") ?? undefined,
      });
      return c.json({ success: true, data: { code: c.req.param("code"), from, to, ...data } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
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
        entryDate:
          parsed.data.entryDate ?? (await businessDateFor(c.env.DB, Date.now())),
        actorId: c.get("userId"),
      });
      await c.env.DB.batch(built.stmts);
      return c.json({ success: true, data: { entryId: built.entryId, entryNo: built.entryNo } }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  });
