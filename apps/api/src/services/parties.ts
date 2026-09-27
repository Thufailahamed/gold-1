import type { CreatePartyInput } from "@goldos/shared";
import { centsToLkr, lkrToCents } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";

export type PartyTable = "suppliers" | "customers";

export type PartyRow = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  nic: string | null;
  credit_limit: number;
  opening_balance: number;
  is_active: number;
  branch_id: string;
  created_at: number;
};

const PARTY_COLS =
  "id, name, phone, address, nic, credit_limit_cents, opening_balance_cents, is_active, branch_id, created_at";

type RawPartyRow = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  nic: string | null;
  credit_limit_cents: number;
  opening_balance_cents: number;
  is_active: number;
  branch_id: string;
  created_at: number;
};

function toPartyRow(r: RawPartyRow): PartyRow {
  return {
    ...r,
    credit_limit: centsToLkr(r.credit_limit_cents),
    opening_balance: centsToLkr(r.opening_balance_cents),
  };
}

export async function createParty(
  db: D1Database,
  table: PartyTable,
  input: CreatePartyInput,
  actorId: string
): Promise<PartyRow> {
  const branch = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(input.branchId)
    .first<{ id: string }>();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  if (input.nic) {
    const dup = await db
      .prepare(`SELECT id FROM ${table} WHERE nic = ?`)
      .bind(input.nic)
      .first<{ id: string }>();
    if (dup) throw Object.assign(new Error("NIC already registered"), { code: "CONFLICT" });
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO ${table} (id, name, phone, address, nic, credit_limit_cents, opening_balance_cents, is_active, branch_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .bind(
        id,
        input.name,
        input.phone ?? null,
        input.address ?? null,
        input.nic ?? null,
        lkrToCents(input.creditLimit),
        lkrToCents(input.openingBalance),
        input.branchId,
        now,
        actorId
      ),
    buildAuditStmt(db, {
      userId: actorId,
      action: `${table}.create`,
      entity: table,
      entityId: id,
      next: input,
      branchId: input.branchId,
    }),
  ]);
  return {
    id,
    name: input.name,
    phone: input.phone ?? null,
    address: input.address ?? null,
    nic: input.nic ?? null,
    credit_limit: input.creditLimit,
    opening_balance: input.openingBalance,
    is_active: 1,
    branch_id: input.branchId,
    created_at: now,
  };
}

export async function listParties(
  db: D1Database,
  table: PartyTable,
  userId: string,
  canManageAll: boolean,
  opts: PageOpts
): Promise<{ rows: PartyRow[]; total: number }> {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const scope = canManageAll
    ? ""
    : "AND branch_id IN (SELECT branch_id FROM branch_members WHERE user_id = ?)";
  const countBind = canManageAll ? [like, like] : [like, like, userId];
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE (name LIKE ? OR phone LIKE ?) ${scope}`)
    .bind(...countBind)
    .first<{ total: number }>();
  const rowBind = canManageAll
    ? [like, like, opts.limit, offset]
    : [like, like, userId, opts.limit, offset];
  const { results } = await db
    .prepare(
      `SELECT ${PARTY_COLS} FROM ${table} WHERE (name LIKE ? OR phone LIKE ?) ${scope} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...rowBind)
    .all<RawPartyRow>();
  return { rows: (results ?? []).map(toPartyRow), total: count?.total ?? 0 };
}

export async function updateParty(
  db: D1Database,
  table: PartyTable,
  id: string,
  patch: {
    name?: string;
    phone?: string;
    address?: string;
    creditLimit?: number;
    isActive?: number;
  },
  actorId: string,
  reason?: string
): Promise<void> {
  const prev = await db
    .prepare(`SELECT ${PARTY_COLS} FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<RawPartyRow>();
  if (!prev) throw Object.assign(new Error("Record not found"), { code: "NOT_FOUND" });
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    vals.push(patch.name);
  }
  if (patch.phone !== undefined) {
    sets.push("phone = ?");
    vals.push(patch.phone);
  }
  if (patch.address !== undefined) {
    sets.push("address = ?");
    vals.push(patch.address);
  }
  if (patch.creditLimit !== undefined) {
    sets.push("credit_limit_cents = ?");
    vals.push(lkrToCents(patch.creditLimit));
  }
  if (patch.isActive !== undefined) {
    sets.push("is_active = ?");
    vals.push(patch.isActive);
  }
  if (sets.length === 0) return;
  await db.batch([
    db.prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id),
    buildAuditStmt(db, {
      userId: actorId,
      action: `${table}.update`,
      entity: table,
      entityId: id,
      prev,
      next: patch,
      reason,
      branchId: prev.branch_id,
    }),
  ]);
}
