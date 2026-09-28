import { compare } from "./counts";

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
      const res = c.result_json ? (JSON.parse(c.result_json) as { missing?: string[]; posted?: number }) : null;
      for (const pid of res?.missing ?? []) {
        const p = await db.prepare("SELECT barcode, name FROM products WHERE id = ?").bind(pid).first<{ barcode: string; name: string }>();
        rows.push({ countId: c.id, productId: pid, barcode: p?.barcode ?? "", productName: p?.name ?? null, daysOpen: Math.floor((Date.now() - c.created_at) / DAY_MS), status: "COMPLETE", posted: (res?.posted ?? 0) > 0 });
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
