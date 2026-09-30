import type { CreateTicketInput } from "@goldos/shared";
import { buildPlatformAudit, fail, nextNumber, type Actor } from "../core";
import { loadTenant } from "./tenants";

export type TicketRow = {
  id: string;
  number: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  subject: string;
  status: string;
  priority: string;
  category: string;
  requester_email: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  first_response_at: number | null;
  resolved_at: number | null;
  created_at: number;
  updated_at: number;
  message_count: number;
};

const TICKET_SELECT = `
  SELECT k.id, k.number, k.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug, k.subject, k.status, k.priority, k.category,
         k.requester_email, k.assignee_id, a.name AS assignee_name, k.first_response_at, k.resolved_at, k.created_at, k.updated_at,
         (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = k.id) AS message_count
  FROM support_tickets k JOIN tenants t ON t.id = k.tenant_id LEFT JOIN platform_admins a ON a.id = k.assignee_id`;

export async function listTickets(
  db: D1Database,
  opts: { status?: string; priority?: string; assigneeId?: string; unassigned?: boolean; tenantId?: string; search?: string; page: number; limit: number }
): Promise<{ rows: TicketRow[]; total: number; counts: Record<string, number> }> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.status === "ACTIVE") where.push("k.status IN ('OPEN','PENDING')");
  else if (opts.status) {
    where.push("k.status = ?");
    binds.push(opts.status);
  }
  if (opts.priority) {
    where.push("k.priority = ?");
    binds.push(opts.priority);
  }
  if (opts.assigneeId) {
    where.push("k.assignee_id = ?");
    binds.push(opts.assigneeId);
  }
  if (opts.unassigned) where.push("k.assignee_id IS NULL");
  if (opts.tenantId) {
    where.push("k.tenant_id = ?");
    binds.push(opts.tenantId);
  }
  if (opts.search) {
    where.push("(k.number LIKE ? OR k.subject LIKE ? OR t.name LIKE ? OR k.requester_email LIKE ?)");
    const like = `%${opts.search}%`;
    binds.push(like, like, like, like);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await db
    .prepare(`SELECT COUNT(*) AS n FROM support_tickets k JOIN tenants t ON t.id = k.tenant_id ${w}`)
    .bind(...binds)
    .first<{ n: number }>();
  const { results } = await db
    .prepare(
      `${TICKET_SELECT} ${w}
       ORDER BY CASE k.status WHEN 'OPEN' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END,
                CASE k.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
                k.updated_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...binds, opts.limit, (opts.page - 1) * opts.limit)
    .all<TicketRow>();
  const { results: countRows } = await db
    .prepare("SELECT status, COUNT(*) AS n FROM support_tickets GROUP BY status")
    .all<{ status: string; n: number }>();
  return {
    rows: results ?? [],
    total: total?.n ?? 0,
    counts: Object.fromEntries((countRows ?? []).map((r) => [r.status, r.n])),
  };
}

export async function getTicket(db: D1Database, id: string, opts: { includeInternal: boolean }) {
  const ticket = await db.prepare(`${TICKET_SELECT} WHERE k.id = ?`).bind(id).first<TicketRow>();
  if (!ticket) fail("NOT_FOUND", "Ticket not found");
  const { results } = await db
    .prepare(
      `SELECT id, author_type, author_id, author_name, body, is_internal, created_at FROM support_messages
       WHERE ticket_id = ? ${opts.includeInternal ? "" : "AND is_internal = 0"} ORDER BY created_at`
    )
    .bind(id)
    .all();
  return { ticket, messages: results ?? [] };
}

export async function createTicket(
  db: D1Database,
  input: CreateTicketInput,
  author: { type: "ADMIN" | "TENANT"; id: string | null; name: string },
  actor: Actor | null
): Promise<{ id: string; number: string }> {
  const tenant = await loadTenant(db, input.tenantId);
  const id = crypto.randomUUID();
  const number = await nextNumber(db, "TKT", "TKT");
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO support_tickets (id, number, tenant_id, subject, status, priority, category, requester_email, created_at, updated_at) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)"
      )
      .bind(id, number, tenant.id, input.subject, input.priority, input.category, input.requesterEmail ?? tenant.owner_email, now, now),
    db
      .prepare("INSERT INTO support_messages (id, ticket_id, author_type, author_id, author_name, body, is_internal, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)")
      .bind(crypto.randomUUID(), id, author.type, author.id, author.name, input.body, now),
    buildPlatformAudit(db, {
      adminId: actor?.id ?? null,
      action: "ticket.create",
      entity: "support_ticket",
      entityId: id,
      tenantId: tenant.id,
      next: { number, subject: input.subject, priority: input.priority, via: author.type },
      ip: actor?.ip,
    }),
  ]);
  return { id, number };
}

/**
 * A staff reply moves the ticket to PENDING (waiting on the shop); a shop
 * reply reopens it. Internal notes change nothing the shop can see —
 * including the status and the first-response clock.
 */
export async function replyToTicket(
  db: D1Database,
  id: string,
  input: { body: string; internal: boolean },
  author: { type: "ADMIN" | "TENANT"; id: string | null; name: string },
  actor: Actor | null
): Promise<void> {
  const t = await db.prepare("SELECT status, tenant_id, first_response_at FROM support_tickets WHERE id = ?").bind(id).first<{ status: string; tenant_id: string; first_response_at: number | null }>();
  if (!t) fail("NOT_FOUND", "Ticket not found");
  if (t.status === "CLOSED") fail("CONFLICT", "Ticket is closed");
  const now = Date.now();
  const internal = author.type === "ADMIN" && input.internal;
  const nextStatus = internal ? t.status : author.type === "ADMIN" ? "PENDING" : "OPEN";
  const firstResponse = !internal && author.type === "ADMIN" && !t.first_response_at ? now : t.first_response_at;
  await db.batch([
    db
      .prepare("INSERT INTO support_messages (id, ticket_id, author_type, author_id, author_name, body, is_internal, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, author.type, author.id, author.name, input.body, internal ? 1 : 0, now),
    db
      .prepare("UPDATE support_tickets SET status = ?, first_response_at = ?, resolved_at = CASE WHEN ? IN ('OPEN','PENDING') THEN NULL ELSE resolved_at END, updated_at = ? WHERE id = ?")
      .bind(nextStatus, firstResponse, nextStatus, now, id),
    buildPlatformAudit(db, {
      adminId: actor?.id ?? null,
      action: internal ? "ticket.note" : "ticket.reply",
      entity: "support_ticket",
      entityId: id,
      tenantId: t.tenant_id,
      ip: actor?.ip,
    }),
  ]);
}

export async function editTicket(
  db: D1Database,
  id: string,
  patch: { status?: string; priority?: string; assigneeId?: string | null },
  actor: Actor
): Promise<void> {
  const prev = await db.prepare("SELECT status, priority, assignee_id, tenant_id FROM support_tickets WHERE id = ?").bind(id).first<{ status: string; priority: string; assignee_id: string | null; tenant_id: string }>();
  if (!prev) fail("NOT_FOUND", "Ticket not found");
  if (patch.assigneeId) {
    const a = await db.prepare("SELECT id FROM platform_admins WHERE id = ? AND is_active = 1").bind(patch.assigneeId).first();
    if (!a) fail("NOT_FOUND", "Assignee not found");
  }
  const now = Date.now();
  const status = patch.status ?? prev.status;
  const resolvedAt = status === "RESOLVED" || status === "CLOSED" ? now : null;
  await db.batch([
    db
      .prepare(
        `UPDATE support_tickets SET status = ?, priority = ?, assignee_id = ?,
           resolved_at = CASE WHEN ? IS NULL THEN NULL ELSE COALESCE(resolved_at, ?) END, updated_at = ? WHERE id = ?`
      )
      .bind(status, patch.priority ?? prev.priority, patch.assigneeId === undefined ? prev.assignee_id : patch.assigneeId, resolvedAt, resolvedAt, now, id),
    buildPlatformAudit(db, {
      adminId: actor.id,
      action: "ticket.edit",
      entity: "support_ticket",
      entityId: id,
      tenantId: prev.tenant_id,
      prev: { status: prev.status, priority: prev.priority, assignee_id: prev.assignee_id },
      next: patch,
      ip: actor.ip,
    }),
  ]);
}
