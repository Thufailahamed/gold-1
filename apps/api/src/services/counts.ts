import { compareCount, normalizeCode } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import { postGoldStmts } from "./gold";
import { buildEntryStmts } from "./journal";
import { businessDateFor } from "./busdate";
import { currentGoldRatesCents } from "./rates";
import { recordInlineApproval } from "./approvals";

export type CountScope = "FULL" | "CATEGORY" | "BRANCH" | "LOCATION";

type Expected = { productId: string; barcode: string };

/** The result_json working copy: investigation notes while OPEN, plus the frozen compare once closed. */
type CountResult = {
  notes?: Record<string, string>;
  matched?: string[];
  missing?: string[];
  unexpected?: string[];
  duplicates?: string[];
  matchedCount?: number;
  posted?: number;
  postedIds?: string[];
};

function parseResult(json: string | null | undefined): CountResult {
  if (!json) return {};
  try {
    return JSON.parse(json) as CountResult;
  } catch {
    return {};
  }
}

export async function assertCountLock(db: D1Database, productId: string): Promise<void> {
  const prod = await db.prepare("SELECT id, branch_id FROM products WHERE id = ?").bind(productId).first<{ id: string; branch_id: string }>();
  if (!prod) return;
  const { results } = await db.prepare(`SELECT id, expected_json AS json FROM stock_counts WHERE branch_id = ? AND status = 'OPEN'`).bind(prod.branch_id).all<{ id: string; json: string }>();
  for (const row of results ?? []) {
    const expected = JSON.parse(row.json) as { productId: string }[];
    if (expected.some((e) => e.productId === productId))
      throw Object.assign(new Error("Product is under an open stock count"), { code: "TRANSITION_LOCKED" });
  }
}

export async function startCount(db: D1Database, input: { branchId: string; scope: CountScope; scopeRef?: string }, actorId: string): Promise<{ id: string; expectedCount: number }> {
  if (!["FULL", "CATEGORY", "BRANCH", "LOCATION"].includes(input.scope))
    throw Object.assign(new Error("Invalid scope"), { code: "VALIDATION" });
  const branch = await db.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(input.branchId).first();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  // A reserved piece is still in the branch's custody, so it is counted too;
  // leaving it out would flag it UNEXPECTED when the counter scans it.
  let cond = "p.status IN ('IN_STOCK', 'RESERVED') AND p.branch_id = ?";
  const vals: unknown[] = [input.branchId];
  // FULL and BRANCH both mean the whole of this one branch; neither takes a ref.
  const scopeRef = input.scope === "CATEGORY" || input.scope === "LOCATION" ? input.scopeRef?.trim() || undefined : undefined;
  if (input.scope === "CATEGORY") {
    const cat = await db.prepare("SELECT id FROM categories WHERE id = ?").bind(scopeRef ?? "").first();
    if (!cat) throw Object.assign(new Error("Category not found"), { code: "NOT_FOUND" });
    cond += " AND p.category_id = ?";
    vals.push(scopeRef);
  }
  if (input.scope === "LOCATION") {
    if (!scopeRef) throw Object.assign(new Error("location required"), { code: "VALIDATION" });
    cond += " AND p.location = ?";
    vals.push(scopeRef);
  }
  const open = await db
    .prepare("SELECT id FROM stock_counts WHERE branch_id = ? AND scope = ? AND COALESCE(scope_ref, '') = ? AND status = 'OPEN'")
    .bind(input.branchId, input.scope, scopeRef ?? "")
    .first();
  if (open) throw Object.assign(new Error("An open count already exists for this scope"), { code: "CONFLICT" });
  const { results } = await db.prepare(`SELECT p.id, p.barcode FROM products p WHERE ${cond}`).bind(...vals).all<{ id: string; barcode: string }>();
  const expected: Expected[] = (results ?? []).map((r) => ({ productId: r.id, barcode: r.barcode }));
  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await db.batch([
      db.prepare(`INSERT INTO stock_counts (id, branch_id, scope, scope_ref, status, expected_json, opened_by, created_at) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?)`).bind(id, input.branchId, input.scope, scopeRef ?? null, JSON.stringify(expected), actorId, now),
      buildAuditStmt(db, { userId: actorId, action: "count.start", entity: "stock_count", entityId: id, next: { scope: input.scope, scopeRef, expected: expected.length }, branchId: input.branchId }),
    ]);
  } catch (e) {
    // Lost a race with another opener: the partial unique index refused it.
    if (/unique/i.test((e as Error).message ?? ""))
      throw Object.assign(new Error("An open count already exists for this scope"), { code: "CONFLICT" });
    throw e;
  }
  return { id, expectedCount: expected.length };
}

/**
 * OK means the piece is in this count's frozen snapshot. A real product that
 * is not in the snapshot (another branch, out of scope, already sold) is
 * UNEXPECTED — it is on this shelf and should not be, which is exactly what
 * the unexpected-stock report exists to surface.
 */
export async function recordScan(db: D1Database, countId: string, rawBarcode: string, actorId: string): Promise<{ flag: string; productId: string | null; barcode: string }> {
  const barcode = normalizeCode(rawBarcode);
  if (!barcode) throw Object.assign(new Error("Barcode required"), { code: "VALIDATION" });
  const count = await db.prepare("SELECT id, status, branch_id, expected_json AS json FROM stock_counts WHERE id = ?").bind(countId).first<{ id: string; status: string; branch_id: string; json: string }>();
  if (!count) throw Object.assign(new Error("Count not found"), { code: "NOT_FOUND" });
  if (count.status !== "OPEN") throw Object.assign(new Error("Count is closed"), { code: "CONFLICT" });
  const prod = await db.prepare("SELECT id FROM products WHERE barcode = ? OR sku = ?").bind(barcode, barcode).first<{ id: string }>();
  const expected = JSON.parse(count.json) as Expected[];
  const inSnapshot = prod ? expected.some((e) => e.productId === prod.id) : false;
  let flag = "UNEXPECTED";
  if (inSnapshot) {
    const prior = await db.prepare("SELECT id FROM count_scans WHERE count_id = ? AND product_id = ? AND flag = 'OK'").bind(countId, prod!.id).first();
    flag = prior ? "DUPLICATE" : "OK";
  }
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO count_scans (id, count_id, barcode, product_id, flag, scanned_by, scanned_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), countId, barcode, prod?.id ?? null, flag, actorId, now, now),
    buildAuditStmt(db, { userId: actorId, action: "count.scan", entity: "stock_count", entityId: countId, next: { barcode, flag }, branchId: count.branch_id }),
  ]);
  return { flag, productId: prod?.id ?? null, barcode };
}

export async function compare(db: D1Database, countId: string) {
  const count = await db.prepare("SELECT expected_json AS json FROM stock_counts WHERE id = ?").bind(countId).first<{ json: string }>();
  if (!count) throw Object.assign(new Error("Count not found"), { code: "NOT_FOUND" });
  const { results } = await db.prepare("SELECT barcode, product_id FROM count_scans WHERE count_id = ?").bind(countId).all<{ barcode: string; product_id: string | null }>();
  return compareCount(JSON.parse(count.json), (results ?? []).map((r) => ({ barcode: r.barcode, productId: r.product_id })));
}

export async function addNote(db: D1Database, countId: string, productId: string, note: string, actorId: string): Promise<void> {
  const count = await db.prepare("SELECT id, status, branch_id, expected_json, result_json AS json FROM stock_counts WHERE id = ?").bind(countId).first<{ id: string; status: string; branch_id: string; expected_json: string; json: string | null }>();
  if (!count) throw Object.assign(new Error("Count not found"), { code: "NOT_FOUND" });
  if (count.status !== "OPEN") throw Object.assign(new Error("Count not open"), { code: "CONFLICT" });
  if (!(JSON.parse(count.expected_json) as Expected[]).some((e) => e.productId === productId))
    throw Object.assign(new Error("Product is not part of this count"), { code: "VALIDATION" });
  const result = parseResult(count.json);
  const notes = { ...(result.notes ?? {}), [productId]: note };
  await db.batch([
    db.prepare("UPDATE stock_counts SET result_json = ? WHERE id = ? AND status = 'OPEN'").bind(JSON.stringify({ ...result, notes }), countId),
    buildAuditStmt(db, { userId: actorId, action: "count.note", entity: "stock_count", entityId: countId, next: { productId }, reason: note, branchId: count.branch_id }),
  ]);
}

export async function cancelCount(db: D1Database, countId: string, reason: string, actorId: string): Promise<void> {
  const count = await db.prepare("SELECT id, status, branch_id, result_json AS json FROM stock_counts WHERE id = ?").bind(countId).first<{ id: string; status: string; branch_id: string; json: string | null }>();
  if (!count) throw Object.assign(new Error("Count not found"), { code: "NOT_FOUND" });
  if (count.status !== "OPEN") throw Object.assign(new Error("Count is not open"), { code: "CONFLICT" });
  const cmp = await compare(db, countId);
  const notes = parseResult(count.json).notes;
  await db.batch([
    db.prepare("UPDATE stock_counts SET status = 'CANCELLED', result_json = ?, closed_by = ? WHERE id = ? AND status = 'OPEN'").bind(JSON.stringify({ ...cmp, notes, posted: 0, postedIds: [] }), actorId, countId),
    buildAuditStmt(db, { userId: actorId, action: "count.cancel", entity: "stock_count", entityId: countId, reason, branchId: count.branch_id }),
  ]);
}

export async function approveCount(db: D1Database, countId: string, input: { reason: string; approvedBy: string }, actorId: string): Promise<{ posted: number }> {
  if (!input.reason?.trim()) throw Object.assign(new Error("Reason required"), { code: "VALIDATION" });
  if (input.approvedBy === actorId) throw Object.assign(new Error("Approver cannot be yourself"), { code: "FORBIDDEN" });
  // Inactive users hold no permissions: a disabled account cannot sign off.
  const approver = await db.prepare(
    `SELECT p.name AS name FROM user_roles ur JOIN users u ON u.id = ur.user_id AND u.is_active = 1 JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE ur.user_id = ?`
  ).bind(input.approvedBy).all<{ name: string }>();
  if (!(approver.results ?? []).some((r) => r.name === "gold:manage"))
    throw Object.assign(new Error("Approval requires gold:manage"), { code: "FORBIDDEN" });
  const count = await db.prepare("SELECT id, branch_id, status, opened_by, result_json AS json FROM stock_counts WHERE id = ?").bind(countId).first<{ id: string; branch_id: string; status: string; opened_by: string | null; json?: string | null }>();
  if (!count || count.status !== "OPEN") throw Object.assign(new Error("Count not open"), { code: "CONFLICT" });
  if (count.opened_by && input.approvedBy === count.opened_by)
    throw Object.assign(new Error("Approver cannot be the opener"), { code: "FORBIDDEN" });
  const { results: scanRows } = await db.prepare("SELECT scanned_by FROM count_scans WHERE count_id = ?").bind(countId).all<{ scanned_by: string | null }>();
  if ((scanRows ?? []).length > 0) {
    const tally = new Map<string, number>();
    for (const r of scanRows ?? []) if (r.scanned_by) tally.set(r.scanned_by, (tally.get(r.scanned_by) ?? 0) + 1);
    let top: string | null = null;
    let topN = 0;
    for (const [k, v] of tally) if (v > topN) { top = k; topN = v; }
    if (top && input.approvedBy === top)
      throw Object.assign(new Error("Approver cannot be the majority scanner"), { code: "FORBIDDEN" });
  }
  const cmp = await compare(db, countId);
  const rates = await currentGoldRatesCents(db);
  const now = Date.now();
  const entryDate = await businessDateFor(db, now);

  // Pass 1: validate every missing line before anything is written. A count
  // that fails half-way would leave some pieces LOST and the count still
  // OPEN; the whole shortage posts together or not at all.
  type Line = { id: string; status: string; branch_id: string; net_mg: number; cost_cents: number; permille: number };
  const lines: Line[] = [];
  for (const productId of cmp.missing) {
    const prod = await db.prepare("SELECT p.id, p.status, p.branch_id, p.net_mg, p.cost_cents, p.purity_id, pu.permille FROM products p JOIN purities pu ON pu.id = p.purity_id WHERE p.id = ?").bind(productId).first<{ id: string; status: string; branch_id: string; net_mg: number; cost_cents: number | null; purity_id: string; permille: number }>();
    // Locked while the count is open, so a piece that already left stock left
    // before the snapshot's lock existed (a pre-lock race) — nothing to post.
    if (!prod || (prod.status !== "IN_STOCK" && prod.status !== "RESERVED")) continue;
    if (prod.cost_cents === null || prod.cost_cents < 0)
      throw Object.assign(new Error(`No book cost for ${productId}; set its cost before approving`), { code: "VALIDATION" });
    if (!rates.some((r) => r.purity_id === prod.purity_id))
      throw Object.assign(new Error("No gold rate for this purity; cannot value the adjustment"), { code: "VALIDATION" });
    lines.push({ id: prod.id, status: prod.status, branch_id: prod.branch_id, net_mg: prod.net_mg, cost_cents: prod.cost_cents, permille: prod.permille });
  }

  // Pass 2: build every posting, then commit in a single batch.
  const stmts: D1PreparedStatement[] = [];
  for (const prod of lines) {
    stmts.push(
      // A lost piece can no longer be held for anyone, so any hold ends here.
      db.prepare("UPDATE products SET status = 'LOST', reserved_customer_id = NULL, reserved_note = NULL, reserved_until = NULL, reserved_at = NULL, reserved_by = NULL WHERE id = ? AND status = ?").bind(prod.id, prod.status),
      db.prepare("INSERT INTO stock_movements (id, product_id, type, from_status, to_status, from_branch, to_branch, weight_mg, reason, created_at, created_by) VALUES (?, ?, 'LOSS', ?, 'LOST', ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), prod.id, prod.status, prod.branch_id, prod.branch_id, prod.net_mg, input.reason, now, actorId)
    );
    if (prod.net_mg > 0)
      stmts.push(...(await postGoldStmts(db, [{ branchId: count.branch_id, source: `branch:${count.branch_id}`, destination: "loss", type: "ADJUSTMENT", weightMg: prod.net_mg, permille: prod.permille, refEntity: "stock_count", refId: countId, productId: prod.id, notes: input.reason }], { actorId, auditAction: "count.adjust", auditEntity: "stock_count", auditEntityId: countId, branchId: count.branch_id })));
    // An explicit zero book cost is a piece the shop carries at nothing: the
    // metal still leaves the gold ledger, but there is no value to write off.
    if (prod.cost_cents > 0) {
      const entry = await buildEntryStmts(db, { lines: [{ account: "5300", debitCents: prod.cost_cents, creditCents: 0 }, { account: "1100", debitCents: 0, creditCents: prod.cost_cents }], refEntity: "stock_count", refId: countId, memo: `Stock count shortage: ${input.reason}`, branchId: count.branch_id, actorId, auditAction: "count.adjust.value", auditEntity: "stock_count", auditEntityId: countId, sourceModule: "gold" }, { entryDate });
      stmts.push(...entry.stmts);
    }
  }
  const postedIds = lines.map((l) => l.id);
  const notes = parseResult(count.json).notes;
  stmts.push(
    db.prepare("UPDATE stock_counts SET status = 'COMPLETE', result_json = ?, closed_by = ? WHERE id = ? AND status = 'OPEN'").bind(JSON.stringify({ ...cmp, notes, posted: postedIds.length, postedIds }), actorId, countId),
    buildAuditStmt(db, { userId: actorId, action: "count.approve", entity: "stock_count", entityId: countId, next: { posted: postedIds.length, approvedBy: input.approvedBy }, reason: input.reason, branchId: count.branch_id })
  );
  await db.batch(stmts);
  const posted = postedIds.length;
  // Count approval already mandates a second approver (gold:manage); record it
  // in the unified Center — but only when something actually posted. A clean
  // count adjusts nothing and earns no approval row.
  if (posted > 0) {
    await recordInlineApproval(
      db,
      {
        action: "INVENTORY_ADJUST",
        entity: "stock_count",
        entityId: countId,
        oldValue: { missing: cmp.missing.length },
        newValue: { posted },
        metric: posted,
        reason: input.reason,
        branchId: count.branch_id,
        approverId: input.approvedBy,
      },
      actorId
    );
  }
  return { posted };
}

export type CountListRow = {
  id: string;
  branch_id: string;
  branch_name: string | null;
  scope: string;
  scope_ref: string | null;
  scope_label: string | null;
  status: string;
  opened_by: string | null;
  opened_by_name: string | null;
  created_at: number;
  expected: number;
  scanned: number;
};

export async function listCounts(db: D1Database, opts: { branchIds?: string[]; status?: string }): Promise<CountListRow[]> {
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (opts.branchIds) {
    if (opts.branchIds.length === 0) return [];
    conds.push(`c.branch_id IN (${opts.branchIds.map(() => "?").join(",")})`);
    vals.push(...opts.branchIds);
  }
  if (opts.status) {
    conds.push("c.status = ?");
    vals.push(opts.status);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const { results } = await db
    .prepare(
      `SELECT c.id, c.branch_id, b.name AS branch_name, c.scope, c.scope_ref, cat.name AS category_name, c.status, c.opened_by, u.name AS opened_by_name, c.created_at, json_array_length(c.expected_json) AS expected,
              (SELECT COUNT(DISTINCT s.product_id) FROM count_scans s WHERE s.count_id = c.id AND s.flag = 'OK') AS scanned
       FROM stock_counts c LEFT JOIN branches b ON b.id = c.branch_id LEFT JOIN users u ON u.id = c.opened_by LEFT JOIN categories cat ON c.scope = 'CATEGORY' AND cat.id = c.scope_ref
       ${where} ORDER BY c.created_at DESC LIMIT 100`
    )
    .bind(...vals)
    .all<Omit<CountListRow, "scope_label"> & { category_name: string | null }>();
  return (results ?? []).map(({ category_name, ...r }) => ({ ...r, scope_label: category_name ?? r.scope_ref }));
}

export type CountLine = { productId: string; barcode: string; name: string | null; karat: string | null; net_mg: number | null; location: string | null; status: string | null; state: "MATCHED" | "MISSING" | "DUPLICATE"; note: string | null; posted: boolean };

export async function getCount(db: D1Database, countId: string) {
  const head = await db
    .prepare(
      `SELECT c.id, c.branch_id, b.name AS branch_name, c.scope, c.scope_ref, cat.name AS category_name, c.status, c.opened_by, uo.name AS opened_by_name, c.closed_by, uc.name AS closed_by_name, c.created_at, c.expected_json, c.result_json
       FROM stock_counts c LEFT JOIN branches b ON b.id = c.branch_id LEFT JOIN users uo ON uo.id = c.opened_by LEFT JOIN users uc ON uc.id = c.closed_by LEFT JOIN categories cat ON c.scope = 'CATEGORY' AND cat.id = c.scope_ref WHERE c.id = ?`
    )
    .bind(countId)
    .first<{ id: string; branch_id: string; branch_name: string | null; scope: string; scope_ref: string | null; category_name: string | null; status: string; opened_by: string | null; opened_by_name: string | null; closed_by: string | null; closed_by_name: string | null; created_at: number; expected_json: string; result_json: string | null }>();
  if (!head) throw Object.assign(new Error("Count not found"), { code: "NOT_FOUND" });
  const expected = JSON.parse(head.expected_json) as Expected[];
  const result = parseResult(head.result_json);
  // An open count compares live; a closed one reads its frozen result so the
  // record never shifts after sign-off.
  const cmp = head.status === "OPEN" || !result.missing ? await compare(db, countId) : { matched: result.matched ?? [], missing: result.missing, unexpected: result.unexpected ?? [], duplicates: result.duplicates ?? [], matchedCount: result.matchedCount ?? 0 };
  const missing = new Set(cmp.missing);
  const dup = new Set(cmp.duplicates);
  const postedIds = new Set(result.postedIds ?? []);
  const info = new Map<string, { name: string; karat: string; net_mg: number; location: string | null; status: string }>();
  for (let i = 0; i < expected.length; i += 50) {
    const chunk = expected.slice(i, i + 50).map((e) => e.productId);
    if (chunk.length === 0) continue;
    const { results } = await db
      .prepare(`SELECT p.id, p.name, pu.karat, p.net_mg, p.location, p.status FROM products p JOIN purities pu ON pu.id = p.purity_id WHERE p.id IN (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk)
      .all<{ id: string; name: string; karat: string; net_mg: number; location: string | null; status: string }>();
    for (const r of results ?? []) info.set(r.id, r);
  }
  const lines: CountLine[] = expected.map((e) => {
    const p = info.get(e.productId);
    return {
      productId: e.productId,
      barcode: e.barcode,
      name: p?.name ?? null,
      karat: p?.karat ?? null,
      net_mg: p?.net_mg ?? null,
      location: p?.location ?? null,
      status: p?.status ?? null,
      state: missing.has(e.productId) ? "MISSING" : dup.has(e.productId) ? "DUPLICATE" : "MATCHED",
      note: result.notes?.[e.productId] ?? null,
      posted: postedIds.has(e.productId),
    };
  });
  const { results: scans } = await db
    .prepare("SELECT s.id, s.barcode, s.product_id, s.flag, s.scanned_at, u.name AS scanned_by_name FROM count_scans s LEFT JOIN users u ON u.id = s.scanned_by WHERE s.count_id = ? ORDER BY s.scanned_at DESC LIMIT 200")
    .bind(countId)
    .all<{ id: string; barcode: string; product_id: string | null; flag: string; scanned_at: number; scanned_by_name: string | null }>();
  const { expected_json: _e, result_json: _r, category_name, ...header } = head;
  return {
    count: { ...header, scope_label: category_name ?? head.scope_ref },
    summary: { expected: expected.length, matched: cmp.matchedCount, missing: cmp.missing.length, unexpected: cmp.unexpected.length, duplicates: cmp.duplicates.length, posted: result.posted ?? 0 },
    lines,
    unexpected: cmp.unexpected,
    scans: scans ?? [],
  };
}
