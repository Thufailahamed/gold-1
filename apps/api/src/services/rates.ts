import type { CreateGoldRateInput } from "@goldos/shared";
import { centsToLkr, lkrToCents } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { consumeApproval, pendingApproval, requestApproval } from "./approvals";

export type GoldRateRow = {
  id: string;
  purity_id: string;
  karat: string;
  rate_per_gram: number;
  effective_from: number;
  created_at: number;
};

export type GoldRateCentsRow = {
  id: string;
  purity_id: string;
  karat: string;
  rate_cents_per_g: number;
  effective_from: number;
  created_at: number;
};

const WITH_KARAT =
  "SELECT g.id, g.purity_id, p.karat, g.rate_cents_per_g, g.effective_from, g.created_at FROM gold_rates g JOIN purities p ON p.id = g.purity_id";

export async function createGoldRate(
  db: D1Database,
  input: CreateGoldRateInput,
  actorId: string
): Promise<GoldRateRow> {
  const purity = await db
    .prepare("SELECT id, karat, is_active FROM purities WHERE id = ?")
    .bind(input.purityId)
    .first<{ id: string; karat: string; is_active: number }>();
  if (!purity || !purity.is_active)
    throw Object.assign(new Error("Purity not found or inactive"), { code: "NOT_FOUND" });
  const dup = await db
    .prepare("SELECT id FROM gold_rates WHERE purity_id = ? AND effective_from = ?")
    .bind(input.purityId, input.effectiveFrom)
    .first<{ id: string }>();
  if (dup)
    throw Object.assign(new Error("A rate already exists for this purity and effective time"), {
      code: "CONFLICT",
    });
  const id = crypto.randomUUID();
  const now = Date.now();
  const rateCents = lkrToCents(input.ratePerGram);
  // Rate changes go through the unified engine (no inline fast path on this
  // route). Metric is the absolute change pct vs the current rate, 2dp;
  // a first rate for a purity always counts as a change (metric 100).
  // entityId is issued here so the 202 binds the retry to these exact terms.
  const current = await db
    .prepare("SELECT rate_cents_per_g FROM gold_rates WHERE purity_id = ? ORDER BY effective_from DESC LIMIT 1")
    .bind(input.purityId)
    .first<{ rate_cents_per_g: number }>();
  const metric =
    current && current.rate_cents_per_g > 0
      ? Math.round((Math.abs(rateCents - current.rate_cents_per_g) / current.rate_cents_per_g) * 100 * 100) / 100
      : 100;
  const entityId = input.approvalEntityId ?? crypto.randomUUID();
  if (input.approvalId) {
    await consumeApproval(
      db,
      { action: "GOLD_RATE_CHANGE", id: input.approvalId, entity: "gold_rate", entityId, metric },
      actorId
    );
  } else if (metric > 0) {
    const req = await requestApproval(
      db,
      {
        action: "GOLD_RATE_CHANGE",
        entity: "gold_rate",
        entityId,
        oldValue: { rateCentsPerG: current?.rate_cents_per_g ?? null },
        newValue: { purityId: input.purityId, rateCentsPerG: rateCents, effectiveFrom: input.effectiveFrom },
        metric,
        reason: `rate ${current?.rate_cents_per_g ?? "unset"} → ${rateCents}c/g`,
        branchId: undefined,
      },
      actorId
    );
    if (req.status === "PENDING") pendingApproval(req, "GOLD_RATE_CHANGE");
  }
  await db.batch([
    db
      .prepare(
        "INSERT INTO gold_rates (id, purity_id, rate_cents_per_g, effective_from, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(id, input.purityId, rateCents, input.effectiveFrom, now, actorId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "gold_rate.create",
      entity: "gold_rate",
      entityId: id,
      next: input,
    }),
  ]);
  return {
    id,
    purity_id: input.purityId,
    karat: purity.karat,
    rate_per_gram: input.ratePerGram,
    effective_from: input.effectiveFrom,
    created_at: now,
  };
}

export async function listGoldRates(
  db: D1Database,
  opts: PageOpts
): Promise<{ rows: GoldRateRow[]; total: number }> {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const count = await db
    .prepare(
      "SELECT COUNT(*) AS total FROM gold_rates g JOIN purities p ON p.id = g.purity_id WHERE p.karat LIKE ?"
    )
    .bind(like)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(`${WITH_KARAT} WHERE p.karat LIKE ? ORDER BY g.effective_from DESC LIMIT ? OFFSET ?`)
    .bind(like, opts.limit, offset)
    .all<GoldRateCentsRow>();
  const rows: GoldRateRow[] = (results ?? []).map((r) => ({
    ...r,
    rate_per_gram: centsToLkr(r.rate_cents_per_g),
  }));
  return { rows, total: count?.total ?? 0 };
}

export async function currentGoldRatesCents(db: D1Database): Promise<GoldRateCentsRow[]> {
  const now = Date.now();
  const { results } = await db
    .prepare(
      `${WITH_KARAT} WHERE g.effective_from <= ? AND g.effective_from = (SELECT MAX(effective_from) FROM gold_rates WHERE purity_id = g.purity_id AND effective_from <= ?) ORDER BY p.karat`
    )
    .bind(now, now)
    .all<GoldRateCentsRow>();
  return results ?? [];
}

export async function currentGoldRates(db: D1Database): Promise<GoldRateRow[]> {
  const rows = await currentGoldRatesCents(db);
  return rows.map((r) => ({ ...r, rate_per_gram: centsToLkr(r.rate_cents_per_g) }));
}
