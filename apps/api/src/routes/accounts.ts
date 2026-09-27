import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { accountBalance, postJournalStmts } from "../services/journal";
import { serviceError } from "./http";

const adjustSchema = z.object({
  debitAccount: z.string().min(1),
  creditAccount: z.string().min(1),
  amountCents: z.number().int().gt(0),
  memo: z.string().max(500).optional(),
  reason: z.string().min(1).max(500),
  branchId: z.string().min(1).optional(),
});

export const accounts = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const branchId = c.req.query("branchId");
    const { results } = await c.env.DB.prepare(
      "SELECT code, name, type, is_active FROM chart_of_accounts ORDER BY code"
    ).all<{ code: string; name: string; type: string; is_active: number }>();
    const rows = [];
    for (const a of results ?? []) {
      rows.push({ ...a, balance_cents: await accountBalance(c.env.DB, a.code, branchId) });
    }
    return c.json({ success: true, data: rows }, 200);
  })
  .post("/adjustments", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = adjustSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid adjustment" } },
        400
      );
    if (parsed.data.debitAccount === parsed.data.creditAccount)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Accounts must differ" } },
        400
      );
    try {
      const id = crypto.randomUUID();
      const stmts = await postJournalStmts(c.env.DB, {
        lines: [
          {
            account: parsed.data.debitAccount,
            debitCents: parsed.data.amountCents,
            creditCents: 0,
          },
          {
            account: parsed.data.creditAccount,
            debitCents: 0,
            creditCents: parsed.data.amountCents,
          },
        ],
        refEntity: "adjustment",
        refId: id,
        memo: parsed.data.memo,
        branchId: parsed.data.branchId,
        actorId: c.get("userId"),
        auditAction: "accounts.adjust",
        auditEntity: "adjustment",
        auditEntityId: id,
      });
      await c.env.DB.batch(stmts);
      return c.json({ success: true, data: { id } }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  });
