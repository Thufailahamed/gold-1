import type { AssistantContext } from "../context";
import { toolError } from "../context";

/**
 * Turning what a person types ("Nimal", "HNB current", "rent", "JE-000123")
 * into the record it means. An exact id/number/code wins; otherwise a unique
 * name match; otherwise the candidates go back to the model so it asks the
 * user instead of guessing which customer to post money against.
 */

type Row = Record<string, unknown>;
const all = async <T = Row>(db: D1Database, sql: string, vals: unknown[]): Promise<T[]> =>
  ((await db.prepare(sql).bind(...vals).all<T>()).results ?? []) as T[];

function pick<T extends { label: string }>(what: string, ref: string, exact: T[], fuzzy: T[]): T {
  if (exact.length === 1) return exact[0] as T;
  const list = exact.length > 1 ? exact : fuzzy;
  if (list.length === 1) return list[0] as T;
  if (list.length === 0) toolError("NOT_FOUND", `No ${what} matches "${ref}".`);
  toolError(
    "AMBIGUOUS",
    `"${ref}" matches ${list.length} ${what}s — ask the user which one: ${list
      .slice(0, 10)
      .map((r) => r.label)
      .join("; ")}${list.length > 10 ? "; …" : ""}`
  );
}

const like = (s: string) => `%${s.replace(/[%_]/g, "")}%`;

export type AccountRef = { code: string; name: string; type: string; is_active: number; label: string };

export async function findAccount(ctx: AssistantContext, ref: string): Promise<AccountRef> {
  const q = ref.trim();
  const rows = await all<Omit<AccountRef, "label">>(
    ctx.db,
    "SELECT code, name, type, is_active FROM chart_of_accounts WHERE code = ? OR name LIKE ? ORDER BY code",
    [q, like(q)]
  );
  const withLabel = rows.map((r) => ({ ...r, label: `${r.code} ${r.name}` }));
  return pick(
    "account",
    q,
    withLabel.filter((r) => r.code === q || r.name.toLowerCase() === q.toLowerCase()),
    withLabel
  );
}

export type PartyRef = { id: string; code: string; name: string; phone: string | null; branch_id: string; label: string };

export async function findParty(ctx: AssistantContext, table: "customers" | "suppliers", ref: string): Promise<PartyRef> {
  const q = ref.trim();
  const scope = ctx.scope === null ? "" : ` AND branch_id IN (${ctx.scope.map(() => "?").join(",") || "''"})`;
  const rows = await all<Omit<PartyRef, "label">>(
    ctx.db,
    `SELECT id, code, name, phone, branch_id FROM ${table}
     WHERE (id = ? OR code = ? OR phone = ? OR name LIKE ?)${scope}
     ORDER BY name LIMIT 25`,
    [q, q, q, like(q), ...(ctx.scope ?? [])]
  );
  const withLabel = rows.map((r) => ({ ...r, label: `${r.name} (${r.code}${r.phone ? `, ${r.phone}` : ""})` }));
  return pick(
    table === "customers" ? "customer" : "supplier",
    q,
    withLabel.filter((r) => r.id === q || r.code === q || r.phone === q || r.name.toLowerCase() === q.toLowerCase()),
    withLabel
  );
}

export type BankRef = { id: string; name: string; bank_name: string | null; account_code: string; branch_id: string | null; label: string };

export async function findBankAccount(ctx: AssistantContext, ref: string): Promise<BankRef> {
  const q = ref.trim();
  const rows = await all<Omit<BankRef, "label">>(
    ctx.db,
    `SELECT id, name, bank_name, account_code, branch_id FROM bank_accounts
     WHERE is_active = 1 AND (id = ? OR account_code = ? OR account_number = ? OR name LIKE ? OR bank_name LIKE ?)
     ORDER BY name`,
    [q, q, q, like(q), like(q)]
  );
  const visible = rows.filter((r) => ctx.scope === null || r.branch_id === null || ctx.scope.includes(r.branch_id));
  const withLabel = visible.map((r) => ({ ...r, label: `${r.name}${r.bank_name ? ` — ${r.bank_name}` : ""} (${r.account_code})` }));
  return pick(
    "bank account",
    q,
    withLabel.filter((r) => r.id === q || r.account_code === q || r.name.toLowerCase() === q.toLowerCase()),
    withLabel
  );
}

export type CategoryRef = { id: string; name: string; account_code: string; label: string };

export async function findExpenseCategory(ctx: AssistantContext, ref: string): Promise<CategoryRef> {
  const q = ref.trim();
  const rows = await all<Omit<CategoryRef, "label">>(
    ctx.db,
    "SELECT id, name, account_code FROM expense_categories WHERE is_active = 1 AND (id = ? OR account_code = ? OR name LIKE ?) ORDER BY name",
    [q, q, like(q)]
  );
  const withLabel = rows.map((r) => ({ ...r, label: `${r.name} (${r.account_code})` }));
  return pick(
    "expense category",
    q,
    withLabel.filter((r) => r.id === q || r.account_code === q || r.name.toLowerCase() === q.toLowerCase()),
    withLabel
  );
}

/** A document by its id or its printed number, within the user's branches. */
export async function findDocument<T extends { id: string; number: string; branch_id: string }>(
  ctx: AssistantContext,
  what: string,
  table: string,
  cols: string,
  ref: string,
  branchCol = "branch_id"
): Promise<T> {
  const q = ref.trim();
  const rows = await all<T>(
    ctx.db,
    `SELECT ${cols}, ${branchCol} AS branch_id FROM ${table} WHERE id = ? OR number = ? OR number LIKE ? LIMIT 5`,
    [q, q.toUpperCase(), `%${q.replace(/[%_]/g, "")}`]
  );
  const visible = rows.filter((r) => ctx.scope === null || ctx.scope.includes(r.branch_id));
  const exact = visible.filter((r) => r.id === q || r.number.toUpperCase() === q.toUpperCase());
  if (exact.length === 1) return exact[0] as T;
  if (visible.length === 1) return visible[0] as T;
  if (visible.length === 0) toolError("NOT_FOUND", `No ${what} "${q}" that this user can see.`);
  toolError("AMBIGUOUS", `"${q}" matches several ${what}s: ${visible.map((r) => r.number).join(", ")}. Ask which one.`);
}

export function branchName(ctx: AssistantContext, id: string | null | undefined): string {
  if (!id) return "no branch";
  return ctx.branches.find((b) => b.id === id)?.name ?? id;
}
