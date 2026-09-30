import { heldGoldStages } from "./reconcile";
import { accountBalance } from "./journal";
import { listBankAccounts } from "./cashbank";
import { buildMonthlyReport } from "./monthly";

export type BranchView = {
  branch: { id: string; name: string };
  asOf: number;
  month: string;
  jewellery: { pieces: number; netMg: number; fineMg: number; costCents: number; hasData: boolean };
  gold: { products: number; oldGold: number; lots: number; wip: number; recovered: number; fineMg: number; hasData: boolean };
  cash: { drawer: number; cardClearing: number; hasData: boolean };
  banks: { name: string; balanceCents: number; shared: boolean }[];
  staff: { name: string; roles: string[] }[] | { redacted: true };
  sales: { netCents: number; invoiceCount: number };
  purchases: { valueCents: number };
  transit: { linesOut: { count: number; fineMg: number }; linesIn: { count: number; fineMg: number }; cashInTransit: number };
};

async function requireMember(db: D1Database, userId: string, branchId: string, permissions: string[]): Promise<void> {
  if (permissions.includes("branches:manage")) return;
  const m = await db.prepare("SELECT 1 AS x FROM branch_members WHERE user_id = ? AND branch_id = ?").bind(userId, branchId).first();
  if (!m) throw Object.assign(new Error("Not a member of this branch"), { code: "FORBIDDEN" });
}

export async function branchOverview(db: D1Database, branchId: string, opts: { year: number; month: number; userId: string; permissions: string[] }): Promise<BranchView> {
  await requireMember(db, opts.userId, branchId, opts.permissions);
  const branch = await db.prepare("SELECT id, name FROM branches WHERE id = ? AND is_active = 1").bind(branchId).first<{ id: string; name: string }>();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  const asOf = Date.now();
  const jew = await db.prepare("SELECT COUNT(*) AS pieces, COALESCE(SUM(net_mg),0) AS netMg, COALESCE(SUM(fine_gold_mg),0) AS fineMg, COALESCE(SUM(cost_cents),0) AS costCents FROM products WHERE status IN ('IN_STOCK', 'RESERVED') AND branch_id = ?").bind(branchId).first<{ pieces: number; netMg: number; fineMg: number; costCents: number }>();
  const stages = await heldGoldStages(db, branchId);
  const drawer = await accountBalance(db, "1000", branchId);
  const cardClearing = await accountBalance(db, "1020", branchId);
  const accounts = await listBankAccounts(db);
  const banks = accounts.filter((a) => a.branch_id === branchId || a.branch_id === null).map((a) => ({ name: a.name, balanceCents: a.balance_cents, shared: a.branch_id === null }));
  let staff: BranchView["staff"];
  const member = await db.prepare("SELECT 1 AS x FROM branch_members WHERE user_id = ? AND branch_id = ?").bind(opts.userId, branchId).first();
  if (opts.permissions.includes("users:view") || member) {
    const { results } = await db.prepare(
      `SELECT u.name AS name, GROUP_CONCAT(r.name) AS roles FROM users u JOIN branch_members m ON m.user_id = u.id LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id WHERE m.branch_id = ? AND u.is_active = 1 GROUP BY u.id ORDER BY u.name`
    ).bind(branchId).all<{ name: string; roles: string | null }>();
    staff = (results ?? []).map((r) => ({ name: r.name, roles: r.roles ? r.roles.split(",") : [] }));
  } else staff = { redacted: true };
  const monthly = await buildMonthlyReport(db, { month: opts.month, year: opts.year, branchId });
  const linesOut = await db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(p.fine_gold_mg),0) AS mg FROM transfer_lines l JOIN transfers t ON t.id = l.transfer_id JOIN products p ON p.id = l.product_id WHERE l.status = 'IN_TRANSIT' AND t.from_branch_id = ?").bind(branchId).first<{ c: number; mg: number }>();
  const linesIn = await db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(p.fine_gold_mg),0) AS mg FROM transfer_lines l JOIN transfers t ON t.id = l.transfer_id JOIN products p ON p.id = l.product_id WHERE l.status = 'IN_TRANSIT' AND t.to_branch_id = ?").bind(branchId).first<{ c: number; mg: number }>();
  const cashTransit = await db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS n FROM cash_transfers WHERE from_branch_id = ? AND status = 'IN_TRANSIT'").bind(branchId).first<{ n: number }>();
  return {
    branch: { id: branch.id, name: branch.name },
    asOf,
    month: monthly.meta.month,
    jewellery: { pieces: jew?.pieces ?? 0, netMg: jew?.netMg ?? 0, fineMg: jew?.fineMg ?? 0, costCents: jew?.costCents ?? 0, hasData: (jew?.pieces ?? 0) > 0 },
    gold: { products: stages.products, oldGold: stages.oldGold, lots: stages.lots, wip: stages.wip, recovered: stages.recovered, fineMg: stages.total, hasData: stages.total !== 0 },
    cash: { drawer, cardClearing, hasData: drawer !== 0 || cardClearing !== 0 },
    banks,
    staff,
    sales: { netCents: monthly.sales.netCents, invoiceCount: monthly.sales.invoiceCount },
    purchases: { valueCents: monthly.purchases.purchaseValueCents },
    transit: { linesOut: { count: linesOut?.c ?? 0, fineMg: linesOut?.mg ?? 0 }, linesIn: { count: linesIn?.c ?? 0, fineMg: linesIn?.mg ?? 0 }, cashInTransit: cashTransit?.n ?? 0 },
  };
}

export async function allBranches(db: D1Database, opts: { year: number; month: number; userId: string; permissions: string[] }): Promise<{ asOf: number; branches: BranchView[] }> {
  if (!opts.permissions.includes("branches:manage")) throw Object.assign(new Error("branches:manage required"), { code: "FORBIDDEN" });
  const { results } = await db.prepare("SELECT id FROM branches WHERE is_active = 1 ORDER BY name").bind().all<{ id: string }>();
  const branches: BranchView[] = [];
  for (const b of results ?? []) branches.push(await branchOverview(db, b.id, opts));
  return { asOf: Date.now(), branches };
}
