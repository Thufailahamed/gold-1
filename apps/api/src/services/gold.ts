import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { getSetting } from "./settings";

export const GOLD_TYPES = [
  "PURCHASE",
  "OLD_GOLD_PURCHASE",
  "SALE",
  "MELTING_INPUT",
  "MELTING_OUTPUT",
  "MANUFACTURING_INPUT",
  "MANUFACTURING_OUTPUT",
  "TRANSFER",
  "RETURN",
  "ADJUSTMENT",
  "LOSS",
  "RECOVERY",
] as const;

export type GoldEntry = {
  occurredAt?: number;
  branchId?: string;
  source: string;
  destination: string;
  type: string;
  weightMg: number;
  permille: number;
  refEntity: string;
  refId: string;
  productId?: string;
  oldGoldId?: string;
  notes?: string;
};

export async function postGoldStmts(
  db: D1Database,
  entries: GoldEntry[],
  opts: {
    actorId: string;
    auditAction: string;
    auditEntity: string;
    auditEntityId: string;
    branchId?: string;
  }
): Promise<D1PreparedStatement[]> {
  if (entries.length === 0)
    throw Object.assign(new Error("Empty gold posting"), { code: "VALIDATION" });
  for (const e of entries) {
    if (!GOLD_TYPES.includes(e.type as (typeof GOLD_TYPES)[number]))
      throw Object.assign(new Error(`Unknown gold type: ${e.type}`), { code: "VALIDATION" });
    if (e.weightMg <= 0 || e.permille <= 0 || e.permille > 1000)
      throw Object.assign(new Error("Invalid weight/purity"), { code: "VALIDATION" });
  }
  const now = Date.now();
  const stmts = entries.map((e) => {
    const fineMg = Math.round((e.weightMg * e.permille) / 1000);
    return db
      .prepare(
        "INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, product_id, old_gold_id, user_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        crypto.randomUUID(),
        e.occurredAt ?? now,
        e.branchId ?? opts.branchId ?? null,
        e.source,
        e.destination,
        e.type,
        e.weightMg,
        e.permille,
        fineMg,
        e.refEntity,
        e.refId,
        e.productId ?? null,
        e.oldGoldId ?? null,
        opts.actorId,
        e.notes ?? null,
        now,
        opts.actorId
      );
  });
  stmts.push(
    buildAuditStmt(db, {
      userId: opts.actorId,
      action: opts.auditAction,
      entity: opts.auditEntity,
      entityId: opts.auditEntityId,
      next: { entries: entries.length },
      branchId: opts.branchId,
    })
  );
  return stmts;
}

export async function listLedger(
  db: D1Database,
  opts: PageOpts & {
    type?: string;
    branchId?: string;
    refEntity?: string;
    refId?: string;
    productId?: string;
    oldGoldId?: string;
    from?: number;
    to?: number;
  }
) {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const conds = ["(g.ref_id LIKE ? OR g.notes LIKE ? OR g.source LIKE ? OR g.destination LIKE ?)"];
  const vals: unknown[] = [like, like, like, like];
  if (opts.type) {
    conds.push("g.type = ?");
    vals.push(opts.type);
  }
  if (opts.branchId) {
    conds.push("g.branch_id = ?");
    vals.push(opts.branchId);
  }
  if (opts.refEntity) {
    conds.push("g.ref_entity = ?");
    vals.push(opts.refEntity);
  }
  if (opts.refId) {
    conds.push("g.ref_id = ?");
    vals.push(opts.refId);
  }
  if (opts.productId) {
    conds.push("g.product_id = ?");
    vals.push(opts.productId);
  }
  if (opts.oldGoldId) {
    conds.push("g.old_gold_id = ?");
    vals.push(opts.oldGoldId);
  }
  if (opts.from !== undefined) {
    conds.push("g.occurred_at >= ?");
    vals.push(opts.from);
  }
  if (opts.to !== undefined) {
    conds.push("g.occurred_at <= ?");
    vals.push(opts.to);
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM gold_ledger g ${where}`)
    .bind(...vals)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(`SELECT * FROM gold_ledger g ${where} ORDER BY g.occurred_at DESC LIMIT ? OFFSET ?`)
    .bind(...vals, opts.limit, offset)
    .all();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

export type LineageNode = { kind: string; id: string; label: string; link: string };
export type LineageEdge = { from: string; to: string; label: string };

export async function goldLineage(
  db: D1Database,
  refEntity: string,
  refId: string
): Promise<{ nodes: LineageNode[]; edges: LineageEdge[] }> {
  const nodes = new Map<string, LineageNode>();
  const edges: LineageEdge[] = [];
  const seen = new Set<string>();
  const key = (kind: string, id: string) => `${kind}:${id}`;

  function add(kind: string, id: string, label: string, link: string) {
    if (!nodes.has(key(kind, id))) nodes.set(key(kind, id), { kind, id, label, link });
  }
  function edge(fromK: string, fromI: string, toK: string, toI: string, label: string) {
    edges.push({ from: key(fromK, fromI), to: key(toK, toI), label });
  }

  async function expand(kind: string, id: string, depth: number) {
    const k = key(kind, id);
    if (seen.has(k) || depth > 2) return;
    seen.add(k);
    if (kind === "sale_invoice") {
      const { results } = await db
        .prepare("SELECT product_id FROM sales_items WHERE invoice_id = ?")
        .bind(id)
        .all<{ product_id: string }>();
      for (const r of results ?? []) {
        const p = await db
          .prepare("SELECT barcode, name FROM products WHERE id = ?")
          .bind(r.product_id)
          .first<{ barcode: string; name: string }>();
        add("product", r.product_id, p ? `${p.barcode} ${p.name}` : r.product_id, `/products/${r.product_id}`);
        edge("sale_invoice", id, "product", r.product_id, "contains");
        await expand("product", r.product_id, depth + 1);
      }
    } else if (kind === "product") {
      const conv = await db
        .prepare("SELECT id, number FROM old_gold_items WHERE converted_product_id = ?")
        .bind(id)
        .first<{ id: string; number: string }>();
      if (conv) {
        add("old_gold", conv.id, conv.number, `/old-gold/items/${conv.id}`);
        edge("old_gold", conv.id, "product", id, "converted");
        await expand("old_gold", conv.id, depth + 1);
      }
      const { results: sales } = await db
        .prepare("SELECT invoice_id FROM sales_items WHERE product_id = ?")
        .bind(id)
        .all<{ invoice_id: string }>();
      for (const s of sales ?? []) {
        const inv = await db
          .prepare("SELECT number FROM sales_invoices WHERE id = ?")
          .bind(s.invoice_id)
          .first<{ number: string }>();
        add("sale_invoice", s.invoice_id, inv?.number ?? s.invoice_id, `/sales/invoices/${s.invoice_id}`);
        edge("product", id, "sale_invoice", s.invoice_id, "sold in");
      }
      const { results: pins } = await db
        .prepare("SELECT invoice_id FROM purchase_invoice_items WHERE product_id = ?")
        .bind(id)
        .all<{ invoice_id: string }>();
      for (const p of pins ?? []) {
        const inv = await db
          .prepare("SELECT number FROM purchase_invoices WHERE id = ?")
          .bind(p.invoice_id)
          .first<{ number: string }>();
        add("purchase_invoice", p.invoice_id, inv?.number ?? p.invoice_id, `/purchases/invoices/${p.invoice_id}`);
        edge("purchase_invoice", p.invoice_id, "product", id, "intake");
      }
    } else if (kind === "old_gold") {
      const { results: batches } = await db
        .prepare("SELECT batch_id FROM melting_inputs WHERE old_gold_id = ?")
        .bind(id)
        .all<{ batch_id: string }>();
      for (const b of batches ?? []) {
        const bat = await db
          .prepare("SELECT number FROM melting_batches WHERE id = ?")
          .bind(b.batch_id)
          .first<{ number: string }>();
        add("melting_batch", b.batch_id, bat?.number ?? b.batch_id, `/gold/melting/${b.batch_id}`);
        edge("old_gold", id, "melting_batch", b.batch_id, "melted in");
        await expand("melting_batch", b.batch_id, depth + 1);
      }
      const conv = await db
        .prepare("SELECT converted_product_id FROM old_gold_items WHERE id = ?")
        .bind(id)
        .first<{ converted_product_id: string | null }>();
      if (conv?.converted_product_id) {
        const p = await db
          .prepare("SELECT barcode, name FROM products WHERE id = ?")
          .bind(conv.converted_product_id)
          .first<{ barcode: string; name: string }>();
        add("product", conv.converted_product_id, p ? `${p.barcode} ${p.name}` : conv.converted_product_id, `/products/${conv.converted_product_id}`);
        edge("old_gold", id, "product", conv.converted_product_id, "converted");
      }
    } else if (kind === "melting_batch") {
      const { results: inputs } = await db
        .prepare("SELECT mi.old_gold_id, o.number FROM melting_inputs mi JOIN old_gold_items o ON o.id = mi.old_gold_id WHERE mi.batch_id = ?")
        .bind(id)
        .all<{ old_gold_id: string; number: string }>();
      for (const i of inputs ?? []) {
        add("old_gold", i.old_gold_id, i.number, `/old-gold/items/${i.old_gold_id}`);
        edge("old_gold", i.old_gold_id, "melting_batch", id, "melted in");
      }
      const { results: outputs } = await db
        .prepare("SELECT batch_id, lot_number, fine_mg FROM melting_outputs WHERE batch_id = ?")
        .bind(id)
        .all<{ batch_id: string; lot_number: string; fine_mg: number }>();
      for (const o of outputs ?? []) {
        add("refined_lot", `${id}:${o.lot_number}`, `${o.lot_number} (${o.fine_mg}mg fine)`, `/gold/melting/${id}`);
        edge("melting_batch", id, "refined_lot", `${id}:${o.lot_number}`, "produced");
      }
    } else if (kind === "purchase_invoice") {
      const { results } = await db
        .prepare("SELECT product_id FROM purchase_invoice_items WHERE invoice_id = ?")
        .bind(id)
        .all<{ product_id: string }>();
      for (const r of results ?? []) {
        const p = await db
          .prepare("SELECT barcode, name FROM products WHERE id = ?")
          .bind(r.product_id)
          .first<{ barcode: string; name: string }>();
        add("product", r.product_id, p ? `${p.barcode} ${p.name}` : r.product_id, `/products/${r.product_id}`);
        edge("purchase_invoice", id, "product", r.product_id, "intake");
      }
    }
  }

  const seedLabels: Record<string, (id: string) => Promise<string>> = {
    sale_invoice: async (id) =>
      (await db.prepare("SELECT number FROM sales_invoices WHERE id = ?").bind(id).first<{ number: string }>())?.number ?? id,
    old_gold: async (id) =>
      (await db.prepare("SELECT number FROM old_gold_items WHERE id = ?").bind(id).first<{ number: string }>())?.number ?? id,
    melting_batch: async (id) =>
      (await db.prepare("SELECT number FROM melting_batches WHERE id = ?").bind(id).first<{ number: string }>())?.number ?? id,
    product: async (id) => {
      const p = await db.prepare("SELECT barcode FROM products WHERE id = ?").bind(id).first<{ barcode: string }>();
      return p?.barcode ?? id;
    },
    purchase_invoice: async (id) =>
      (await db.prepare("SELECT number FROM purchase_invoices WHERE id = ?").bind(id).first<{ number: string }>())?.number ?? id,
  };
  const linkFor = (kind: string, id: string) =>
    kind === "sale_invoice" ? `/sales/invoices/${id}`
    : kind === "old_gold" ? `/old-gold/items/${id}`
    : kind === "melting_batch" ? `/gold/melting/${id}`
    : kind === "product" ? `/products/${id}`
    : kind === "purchase_invoice" ? `/purchases/invoices/${id}`
    : "#";
  add(refEntity, refId, await (seedLabels[refEntity] ?? (async (id: string) => id))(refId), linkFor(refEntity, refId));
  await expand(refEntity, refId, 0);
  return { nodes: [...nodes.values()], edges };
}

export async function goldStock(db: D1Database, groupBy: "purity" | "branch" | "stage") {
  if (groupBy === "stage") {
    const og = await db
      .prepare("SELECT COALESCE(SUM(fine_mg), 0) AS m FROM old_gold_items WHERE status IN ('PURCHASED', 'AVAILABLE')")
      .bind()
      .first<{ m: number }>();
    const melting = await db
      .prepare("SELECT COALESCE(SUM(input_fine_mg), 0) AS m FROM melting_batches WHERE status IN ('LOCKED', 'MELTED')")
      .bind()
      .first<{ m: number }>();
    const refined = await db
      .prepare("SELECT COALESCE(SUM(o.fine_mg), 0) AS m FROM melting_outputs o JOIN melting_batches b ON b.id = o.batch_id WHERE b.status = 'APPROVED'")
      .bind()
      .first<{ m: number }>();
    const sale = await db
      .prepare("SELECT COALESCE(SUM(fine_gold_mg), 0) AS m FROM products WHERE status = 'IN_STOCK'")
      .bind()
      .first<{ m: number }>();
    return {
      stages: {
        old_gold_mg: og?.m ?? 0,
        melting_mg: melting?.m ?? 0,
        refined_mg: refined?.m ?? 0,
        for_sale_mg: sale?.m ?? 0,
      },
    };
  }
  if (groupBy === "purity") {
    const { results } = await db
      .prepare(
        `SELECT permille, SUM(fine_mg) AS fine_mg FROM (
           SELECT tested_permille AS permille, fine_mg FROM old_gold_items WHERE status IN ('PURCHASED', 'AVAILABLE') AND tested_permille IS NOT NULL
           UNION ALL
           SELECT pu.permille AS permille, p.fine_gold_mg AS fine_mg FROM products p JOIN purities pu ON pu.id = p.purity_id WHERE p.status = 'IN_STOCK'
           UNION ALL
           SELECT o.permille AS permille, o.fine_mg FROM melting_outputs o JOIN melting_batches b ON b.id = o.batch_id WHERE b.status = 'APPROVED'
         ) GROUP BY permille ORDER BY permille DESC`
      )
      .all();
    return { byPurity: results ?? [] };
  }
  const { results } = await db
    .prepare(
      `SELECT branch_id, SUM(fine_mg) AS fine_mg FROM (
         SELECT branch_id, fine_mg FROM old_gold_items WHERE status IN ('PURCHASED', 'AVAILABLE')
         UNION ALL
         SELECT b.branch_id AS branch_id, b.input_fine_mg AS fine_mg FROM melting_batches b WHERE b.status IN ('LOCKED', 'MELTED')
         UNION ALL
         SELECT b.branch_id AS branch_id, o.fine_mg FROM melting_outputs o JOIN melting_batches b ON b.id = o.batch_id WHERE b.status = 'APPROVED'
         UNION ALL
         SELECT branch_id, fine_gold_mg AS fine_mg FROM products WHERE status = 'IN_STOCK'
       ) GROUP BY branch_id`
    )
    .all();
  return { byBranch: results ?? [] };
}

async function requireGoldApprover(db: D1Database, approverId: string, actorId: string): Promise<void> {
  if (approverId === actorId)
    throw Object.assign(new Error("Approver cannot be yourself"), { code: "FORBIDDEN" });
  const target = await db
    .prepare("SELECT id FROM users WHERE id = ? AND is_active = 1")
    .bind(approverId)
    .first();
  if (!target) throw Object.assign(new Error("Approver not found"), { code: "NOT_FOUND" });
  const { results } = await db
    .prepare(
      `SELECT p.name AS name FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE ur.user_id = ?`
    )
    .bind(approverId)
    .all<{ name: string }>();
  if (!(results ?? []).some((r) => r.name === "gold:manage"))
    throw Object.assign(new Error("Approval requires gold:manage"), { code: "FORBIDDEN" });
}

export async function recordAdjustment(
  db: D1Database,
  input: { type: "ADJUSTMENT" | "LOSS" | "RECOVERY"; branchId: string; weightMg: number; permille: number; reason: string; approvedBy?: string },
  actorId: string
): Promise<{ id: string }> {
  const branch = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(input.branchId)
    .first();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  const s = await getSetting(db, "gold_adjust_approve_mg");
  const threshold = typeof s?.value === "number" ? s.value : 1000;
  if (input.weightMg >= threshold) {
    if (!input.approvedBy)
      throw Object.assign(new Error("Adjustment exceeds approval threshold"), { code: "FORBIDDEN" });
    await requireGoldApprover(db, input.approvedBy, actorId);
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const stmts = await postGoldStmts(
    db,
    [
      {
        branchId: input.branchId,
        source: "adjustment",
        destination: `branch:${input.branchId}`,
        type: input.type,
        weightMg: input.weightMg,
        permille: input.permille,
        refEntity: "gold_adjustment",
        refId: id,
        notes: input.reason,
      },
    ],
    { actorId, auditAction: "gold.adjust", auditEntity: "adjustment", auditEntityId: id, branchId: input.branchId }
  );
  await db.batch(stmts);
  return { id };
}
