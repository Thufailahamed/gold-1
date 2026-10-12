import { Hono, type Context } from "hono";
import { z } from "zod";
import { PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import {
  addCompetitorRate,
  competitorBoard,
  createAlert,
  deleteAlert,
  deleteCompetitorRate,
  deskSettings,
  evaluateAlerts,
  eventsCalendar,
  goldPosition,
  importParity,
  listAlerts,
  markAlertsSeen,
  marketDrivers,
  rateLog,
  rateLogCsv,
  readEvents,
  saveEvents,
  saveImportCosts,
  savePolicy,
  stockGains,
  suggestBoard,
  updateAlert,
} from "../services/market-desk";
import { serviceError } from "./http";

type C = Context<{ Bindings: Env; Variables: AppVariables }>;

function fail(c: C, err: unknown) {
  if ((err as { code?: string }).code === "UNAVAILABLE")
    return c.json({ success: false, error: { code: "UNAVAILABLE", message: (err as Error).message } }, 503);
  return serviceError(c, err);
}

async function body<T>(c: C, schema: z.ZodType<T>): Promise<T | Response> {
  const raw = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return c.json({ success: false, error: { code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Invalid data" } }, 400);
  return parsed.data;
}

const pctField = z.number().min(-50).max(500);
const policySchema = z.object({
  defaultMarginPct: pctField,
  roundTo: z.number().min(0).max(100_000),
  roundMode: z.enum(["nearest", "up", "down"]),
  driftAlertPct: z.number().min(0.05).max(50),
  orderPermille: z.number().int().min(100).max(1000),
  perKarat: z.record(z.string(), z.object({ marginPct: pctField.optional(), roundTo: z.number().min(0).max(100_000).optional() })),
});
const importSchema = z.object({
  premiumUsdPerOz: z.number().min(-500).max(5000),
  bankFeePct: z.number().min(0).max(50),
  dutyPct: z.number().min(0).max(200),
  ssclPct: z.number().min(0).max(50),
  vatPct: z.number().min(0).max(50),
  otherLkrPerG: z.number().min(0).max(1_000_000),
});
const eventsSchema = z.object({
  events: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        title: z.string().trim().min(1).max(80),
        kind: z.enum(["local", "macro", "shop"]),
        note: z.string().max(200).optional(),
      })
    )
    .max(200),
});
const competitorSchema = z.object({
  shop: z.string().trim().min(1).max(80),
  area: z.string().max(80).optional(),
  purityId: z.string().min(1),
  side: z.enum(["SELL", "BUY"]),
  ratePerGram: z.number().gt(0).max(10_000_000),
  observedAt: z.number().int().positive().optional(),
  notes: z.string().max(200).optional(),
  branchId: z.string().optional(),
});
const alertSchema = z.object({
  kind: z.enum(["PRICE_ABOVE", "PRICE_BELOW", "MOVE_PCT", "BOARD_GAP"]),
  symbol: z.enum(["XAU", "XAG", "XPT", "XPD", "HG", "BTC", "ETH"]).optional(),
  purityId: z.string().min(1).optional(),
  threshold: z.number().gt(0).max(1e12),
  note: z.string().max(120).optional(),
});
const alertPatchSchema = z.object({ isActive: z.boolean().optional(), threshold: z.number().gt(0).max(1e12).optional(), note: z.string().max(120).optional() });

export const marketDesk = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  /* ---------------------------------------------------------- settings */
  .get("/settings", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => c.json({ success: true, data: await deskSettings(c.env.DB) }, 200))
  .put("/policy", requirePerm(PERMISSIONS.MASTERS_EDIT), async (c) => {
    const b = await body(c, policySchema);
    if (b instanceof Response) return b;
    try {
      await savePolicy(c.env.DB, b, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (e) {
      return fail(c, e);
    }
  })
  .put("/import-costs", requirePerm(PERMISSIONS.MASTERS_EDIT), async (c) => {
    const b = await body(c, importSchema);
    if (b instanceof Response) return b;
    try {
      await saveImportCosts(c.env.DB, b, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (e) {
      return fail(c, e);
    }
  })
  .put("/events", requirePerm(PERMISSIONS.MASTERS_EDIT), async (c) => {
    const b = await body(c, eventsSchema);
    if (b instanceof Response) return b;
    try {
      await saveEvents(c.env.DB, b.events, c.get("userId"));
      return c.json({ success: true, data: { events: await readEvents(c.env.DB) } }, 200);
    } catch (e) {
      return fail(c, e);
    }
  })
  /* ---------------------------------------------------------- pricing */
  .get("/suggest", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await suggestBoard(c.env.DB) }, 200);
    } catch (e) {
      return fail(c, e);
    }
  })
  .get("/import-parity", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await importParity(c.env.DB) }, 200);
    } catch (e) {
      return fail(c, e);
    }
  })
  /* ---------------------------------------------------------- exposure */
  .get("/position", requirePerm(PERMISSIONS.GOLD_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await goldPosition(c.env.DB) }, 200);
    } catch (e) {
      return fail(c, e);
    }
  })
  .get("/gains", requirePerm(PERMISSIONS.GOLD_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await stockGains(c.env.DB) }, 200);
    } catch (e) {
      return fail(c, e);
    }
  })
  /* ---------------------------------------------------------- records */
  .get("/rate-log", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
    try {
      const log = await rateLog(c.env.DB, {
        from: c.req.query("from") ?? "",
        to: c.req.query("to") ?? "",
        purityId: c.req.query("purityId") || undefined,
      });
      if (c.req.query("format") === "csv")
        return new Response(rateLogCsv(log), {
          status: 200,
          headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="rate-log-${log.purity?.karat ?? "gold"}.csv"` },
        });
      return c.json({ success: true, data: log }, 200);
    } catch (e) {
      return fail(c, e);
    }
  })
  .get("/competitors", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
    const days = Number(c.req.query("days") ?? "30") || 30;
    return c.json({ success: true, data: await competitorBoard(c.env.DB, days) }, 200);
  })
  .post("/competitors", requirePerm(PERMISSIONS.MASTERS_CREATE), async (c) => {
    const b = await body(c, competitorSchema);
    if (b instanceof Response) return b;
    try {
      return c.json({ success: true, data: await addCompetitorRate(c.env.DB, b, c.get("userId")) }, 201);
    } catch (e) {
      return fail(c, e);
    }
  })
  .delete("/competitors/:id", requirePerm(PERMISSIONS.MASTERS_CANCEL), async (c) => {
    try {
      await deleteCompetitorRate(c.env.DB, c.req.param("id"), c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (e) {
      return fail(c, e);
    }
  })
  /* ---------------------------------------------------------- alerts */
  .get("/alerts", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => c.json({ success: true, data: await listAlerts(c.env.DB) }, 200))
  .post("/alerts", requirePerm(PERMISSIONS.MASTERS_EDIT), async (c) => {
    const b = await body(c, alertSchema);
    if (b instanceof Response) return b;
    try {
      const out = await createAlert(c.env.DB, b, c.get("userId"));
      // Check straight away so a rule that is already true shows as such.
      await evaluateAlerts(c.env.DB, undefined, { force: true }).catch(() => null);
      return c.json({ success: true, data: out }, 201);
    } catch (e) {
      return fail(c, e);
    }
  })
  .post("/alerts/check", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await evaluateAlerts(c.env.DB, undefined, { force: true }) }, 200);
    } catch (e) {
      return fail(c, e);
    }
  })
  .post("/alerts/seen", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
    await markAlertsSeen(c.env.DB, c.get("userId"));
    return c.json({ success: true, data: { ok: true } }, 200);
  })
  .patch("/alerts/:id", requirePerm(PERMISSIONS.MASTERS_EDIT), async (c) => {
    const b = await body(c, alertPatchSchema);
    if (b instanceof Response) return b;
    try {
      await updateAlert(c.env.DB, c.req.param("id"), b, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (e) {
      return fail(c, e);
    }
  })
  .delete("/alerts/:id", requirePerm(PERMISSIONS.MASTERS_EDIT), async (c) => {
    try {
      await deleteAlert(c.env.DB, c.req.param("id"), c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (e) {
      return fail(c, e);
    }
  })
  /* ---------------------------------------------------------- context */
  .get("/drivers", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await marketDrivers() }, 200);
    } catch (e) {
      return fail(c, e);
    }
  })
  .get("/events", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => c.json({ success: true, data: await eventsCalendar(c.env.DB) }, 200));
