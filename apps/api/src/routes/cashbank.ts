import { Hono } from "hono";
import type { Context } from "hono";
import {
  cardSettlementSchema,
  cashEntrySchema,
  cashMoveSchema,
  createBankAccountSchema,
  openingBalanceSchema,
  PERMISSIONS,
  reconcileStatementSchema,
  transferDispatchSchema,
  transferReceiveSchema,
  updateBankAccountSchema,
} from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import {
  createBankAccount,
  depositCash,
  dispatchTransfer,
  listBankAccounts,
  listSettlements,
  listTransfers,
  openBankAccount,
  receiveTransfer,
  reconcileStatement,
  settleCardBatch,
  updateBankAccount,
  withdrawCash,
} from "../services/cashbank";
import { createCashEntry, listCashEntries } from "../services/cashentries";
import { pagination, serviceError } from "./http";
import { getShopDb } from "../platform/resolve";

type Ctx = Context<{ Bindings: Env; Variables: AppVariables }>;

function invalid(c: Ctx, message: string): Response {
  return c.json({ success: false, error: { code: "VALIDATION", message } }, 400);
}

export const bankAccounts = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const rows = await listBankAccounts(getShopDb(c), { branchId: c.req.query("branchId") ?? undefined });
    return c.json({ success: true, data: rows }, 200);
  })
  .post("/", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = createBankAccountSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, "Invalid bank account");
    try {
      const data = await createBankAccount(getShopDb(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/:id", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = updateBankAccountSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, "Invalid bank account update");
    try {
      await updateBankAccount(getShopDb(c), c.req.param("id"), parsed.data, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/:id/opening", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = openingBalanceSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, "Invalid opening balance");
    try {
      const data = await openBankAccount(getShopDb(c), c.req.param("id"), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  // A write under a read permission: recording what the statement said is
  // part of proving the account. Fixing a difference is a manual adjustment
  // under accounts:manage, which is the rule that already applies.
  .post("/:id/reconcile", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const parsed = reconcileStatementSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, "Invalid reconciliation");
    try {
      const data = await reconcileStatement(
        getShopDb(c),
        c.req.param("id"),
        parsed.data,
        c.get("userId")
      );
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  });

export const cash = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/entries", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const d = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    const { page, limit } = pagination(c);
    const data = await listCashEntries(getShopDb(c), {
      page,
      limit,
      branchId: c.req.query("branchId") || undefined,
      from: d(c.req.query("from")),
      to: d(c.req.query("to")),
    });
    return c.json({ success: true, data }, 200);
  })
  .post("/entries", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = cashEntrySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, "Invalid cash entry");
    try {
      const data = await createCashEntry(getShopDb(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/deposits", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = cashMoveSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, "Invalid deposit");
    try {
      const data = await depositCash(getShopDb(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/withdrawals", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = cashMoveSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, "Invalid withdrawal");
    try {
      const data = await withdrawCash(getShopDb(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/transfers", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const data = await listTransfers(getShopDb(c), {
      status: c.req.query("status") ?? undefined,
      branchId: c.req.query("branchId") ?? undefined,
    });
    return c.json({ success: true, data }, 200);
  })
  .post("/transfers", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = transferDispatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, "Invalid transfer");
    try {
      const data = await dispatchTransfer(getShopDb(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/transfers/:id/receive", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = transferReceiveSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, "Invalid receipt");
    try {
      const data = await receiveTransfer(getShopDb(c), c.req.param("id"), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  });

export const settlements = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const data = await listSettlements(getShopDb(c), {
      ...pagination(c),
      bankAccountId: c.req.query("bankAccountId") ?? undefined,
    });
    return c.json({ success: true, data }, 200);
  })
  .post("/", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = cardSettlementSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, "Invalid card settlement");
    try {
      const data = await settleCardBatch(getShopDb(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  });
