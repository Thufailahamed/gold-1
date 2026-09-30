import { compare } from "./counts";
import { getSetting } from "./settings";
import { heldGoldMg } from "./reconcile";
import { reconcileTransfer } from "./transfers";

export type MissingRow = { countId: string; productId: string; barcode: string; productName: string | null; daysOpen: number; status: string; posted: boolean };
export type ScanRow = { countId: string; barcode: string; scannedAt: number; scannedBy: string | null };

export function toCsv(preamble: string[], cols: string[], rows: Record<string, unknown>[]): string {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [...preamble.map((p) => `# ${p}`), cols.map(q).join(","), ...rows.map((r) => cols.map((c) => q(r[c])).join(","))].join("\n") + "\n";
}

const DAY_MS = 86_400_000;

export async function missingReport(db: D1Database, branchId: string): Promise<{ rows: MissingRow[]; hasData: boolean }> {
  const { results: counts } = await db.prepare("SELECT id, status, created_at, result_json FROM stock_counts WHERE branch_id = ? AND status IN ('OPEN','COMPLETE') ORDER BY created_at DESC LIMIT 50").bind(branchId).all<{ id: string; status: string; created_at: number; result_json: string | null }>();
  const rows: MissingRow[] = [];
  for (const c of counts ?? []) {
    if (c.status === "OPEN") {
      const cmp = await compare(db, c.id);
      for (const pid of cmp.missing) {
        const p = await db.prepare("SELECT barcode, name FROM products WHERE id = ?").bind(pid).first<{ barcode: string; name: string }>();
        rows.push({ countId: c.id, productId: pid, barcode: p?.barcode ?? "", productName: p?.name ?? null, daysOpen: Math.floor((Date.now() - c.created_at) / DAY_MS), status: "OPEN", posted: false });
      }
    } else {
      const res = c.result_json ? (JSON.parse(c.result_json) as { missing?: string[]; posted?: number; postedIds?: string[] }) : null;
      // postedIds names exactly which lines were written off; counts closed
      // before it existed only recorded a total, so fall back to that.
      const postedIds = res?.postedIds ? new Set(res.postedIds) : null;
      for (const pid of res?.missing ?? []) {
        const p = await db.prepare("SELECT barcode, name FROM products WHERE id = ?").bind(pid).first<{ barcode: string; name: string }>();
        rows.push({ countId: c.id, productId: pid, barcode: p?.barcode ?? "", productName: p?.name ?? null, daysOpen: Math.floor((Date.now() - c.created_at) / DAY_MS), status: "COMPLETE", posted: postedIds ? postedIds.has(pid) : (res?.posted ?? 0) > 0 });
      }
    }
  }
  return { rows, hasData: rows.length > 0 };
}

export async function scanFlagReport(db: D1Database, branchId: string, flag: "UNEXPECTED" | "DUPLICATE"): Promise<{ rows: ScanRow[]; hasData: boolean }> {
  const { results } = await db.prepare(
    `SELECT s.count_id, s.barcode, s.scanned_at, s.scanned_by FROM count_scans s JOIN stock_counts c ON c.id = s.count_id WHERE c.branch_id = ? AND s.flag = ? ORDER BY s.scanned_at DESC LIMIT 200`
  ).bind(branchId, flag).all<{ count_id: string; barcode: string; scanned_at: number; scanned_by: string | null }>();
  const rows = (results ?? []).map((r) => ({ countId: r.count_id, barcode: r.barcode, scannedAt: r.scanned_at, scannedBy: r.scanned_by }));
  return { rows, hasData: rows.length > 0 };
}

export type UnreceivedRow = { transferId: string; number: string; barcode: string; productId: string; fromBranch: string; toBranch: string; fromBranchName: string | null; toBranchName: string | null; ageDays: number };

export async function unreceivedDays(db: D1Database): Promise<number> {
  const s = await getSetting(db, "transfer_unreceived_days");
  return typeof s?.value === "number" && s.value > 0 ? Math.floor(s.value) : 3;
}

export async function unreceivedReport(db: D1Database, branchId: string): Promise<{ rows: UnreceivedRow[]; hasData: boolean; thresholdDays: number }> {
  const thresholdDays = await unreceivedDays(db);
  const { results } = await db.prepare(
    `SELECT l.transfer_id, t.number, l.product_id, l.barcode, t.from_branch_id, t.to_branch_id, (SELECT name FROM branches WHERE id = t.from_branch_id) AS from_branch_name, (SELECT name FROM branches WHERE id = t.to_branch_id) AS to_branch_name,
            (SELECT m.created_at FROM stock_movements m WHERE m.product_id = l.product_id AND m.type = 'TRANSFER_OUT' AND m.reason LIKE ('%' || t.number || '%') ORDER BY m.created_at DESC LIMIT 1) AS dispatched_at
     FROM transfer_lines l JOIN transfers t ON t.id = l.transfer_id
     WHERE l.status = 'IN_TRANSIT' AND (t.from_branch_id = ? OR t.to_branch_id = ?)`
  ).bind(branchId, branchId).all<{ transfer_id: string; number: string; product_id: string; barcode: string; from_branch_id: string; to_branch_id: string; from_branch_name: string | null; to_branch_name: string | null; dispatched_at: number | null }>();
  const now = Date.now();
  const rows = (results ?? [])
    .map((r) => ({ transferId: r.transfer_id, number: r.number, barcode: r.barcode, productId: r.product_id, fromBranch: r.from_branch_id, toBranch: r.to_branch_id, fromBranchName: r.from_branch_name, toBranchName: r.to_branch_name, ageDays: r.dispatched_at ? Math.floor((now - r.dispatched_at) / DAY_MS) : 0 }))
    .filter((r) => r.ageDays >= thresholdDays);
  return { rows, hasData: rows.length > 0, thresholdDays };
}

export type Summary = {
  missing: number; unexpected: number; duplicates: number; unreceived: number;
  gold: { branchId: string; passed: boolean; differenceMg: number }[];
  transfers: { transferId: string; number: string; warnings: string[] }[];
  hasData: boolean;
};

async function branchLedgerMg(db: D1Database, branchId: string): Promise<number> {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(
       (CASE WHEN destination = 'branch:' || ? THEN fine_mg ELSE 0 END)
     - (CASE WHEN source = 'branch:' || ? THEN fine_mg ELSE 0 END)
     ), 0) AS n FROM gold_ledger`
  ).bind(branchId, branchId).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function summaryReport(db: D1Database, branchId: string): Promise<Summary> {
  const [missing, unexpected, duplicates, unreceived] = await Promise.all([
    missingReport(db, branchId), scanFlagReport(db, branchId, "UNEXPECTED"), scanFlagReport(db, branchId, "DUPLICATE"), unreceivedReport(db, branchId),
  ]);
  const ledgerMg = await branchLedgerMg(db, branchId);
  const heldMg = await heldGoldMg(db, branchId);
  const gold = [{ branchId, passed: ledgerMg - heldMg === 0, differenceMg: ledgerMg - heldMg }];
  const goldPassed = gold[0]?.passed ?? false;
  const { results: open } = await db.prepare("SELECT id, number FROM transfers WHERE (from_branch_id = ? OR to_branch_id = ?) AND status IN ('DISPATCHED','PARTIAL') ORDER BY created_at DESC LIMIT 50").bind(branchId, branchId).all<{ id: string; number: string }>();
  const transfers: Summary["transfers"] = [];
  for (const t of open ?? []) {
    const r = await reconcileTransfer(db, t.id);
    if (!r.passed) transfers.push({ transferId: t.id, number: t.number, warnings: r.warnings });
  }
  const hasData = missing.rows.length + unexpected.rows.length + duplicates.rows.length + unreceived.rows.length + transfers.length > 0 || !goldPassed;
  return { missing: missing.rows.length, unexpected: unexpected.rows.length, duplicates: duplicates.rows.length, unreceived: unreceived.rows.length, gold, transfers, hasData };
}
