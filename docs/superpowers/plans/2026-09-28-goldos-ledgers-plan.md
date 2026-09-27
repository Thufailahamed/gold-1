# GoldOS Party Ledgers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship double-entry accounting foundation — chart of accounts, balanced journal service, CUS-/SUP- coded parties with notes, party detail + ledger views, manual adjustments, Accounts UI — migrated and deployed.

**Architecture:** Migration `0008_ledger` (accounts, journal, party code/notes + backfill). `postJournal` returns statements for composition into future purchase batches; balances always derived (opening + journal). New perms `accounts:view/manage` (31 total). Every write batched with audit.

**Tech Stack:** Hono, Drizzle, D1, Next.js 16, React 19, TanStack Query v5, RHF + Zod, Vitest, Wrangler.

## Global Constraints

- Every write batches business row(s) + audit_logs; failure rolls back.
- Journal batches must balance (ΣDR == ΣCR) or VALIDATION; inactive accounts rejected.
- No hard deletes; append-only journal.
- Strict TypeScript, no `any`; Zod client + server; typed responses.
- Money INTEGER cents; convert at API boundary only.
- Party codes CUS-/SUP- + 6 chars (same alphabet as SKU), unique, immutable, backfilled.
- `reverse` action still unseeded.

---

## Permission additions (append to matrix)

- `accounts:view`, `accounts:manage`.
- manage: owner, manager, accountant. view: owner, manager, accountant, cashier.
- Owner grant count becomes 30; manager 29 (still excludes users:approve, branches:approve).

## File Structure

- Modify: `packages/shared/src/permissions.ts`, `packages/shared/src/schemas.ts` (notes field)
- Create: `packages/shared/src/ledgers.test.ts`
- Create: `apps/api/drizzle/0008_ledger.sql`
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/seed.ts`
- Create: `apps/api/src/services/journal.ts`, `apps/api/src/routes/accounts.ts`
- Modify: `apps/api/src/services/parties.ts` (code, notes, detail, ledger), `apps/api/src/routes/parties.ts` (detail + ledger endpoints)
- Modify: `apps/web/app/(app)/suppliers/page.tsx`, `customers/page.tsx` (drawer), sidebar, new `accounts/page.tsx`
- Modify docs: `database.md`, `api.md`, `permissions.md`, `gold-accounting.md`

---

### Task 1: Shared perms + notes

**Files:**
- Modify: `packages/shared/src/permissions.ts`, `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/ledgers.test.ts`
- Test: ledgers test

**Interfaces:**
- Consumes: existing PERMISSIONS/DEFAULT_ROLES/createPartySchema.
- Produces: `ACCOUNTS_VIEW/MANAGE`; updated DEFAULT_ROLES + seed parity list; `notes` optional on party schema.

- [ ] **Step 1: Write failing test**

```ts
// packages/shared/src/ledgers.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS } from "./permissions";
import { createPartySchema } from "./schemas";

describe("ledger perms", () => {
  it("seeds accounts permissions", () => {
    expect(PERMISSIONS.ACCOUNTS_VIEW).toBe("accounts:view");
    expect(PERMISSIONS.ACCOUNTS_MANAGE).toBe("accounts:manage");
  });
  it("accountant can manage accounts, cashier cannot", () => {
    expect(DEFAULT_ROLES["accountant"]).toContain("accounts:manage");
    expect(DEFAULT_ROLES["cashier"]).not.toContain("accounts:manage");
  });
  it("owner holds all permissions", () => {
    for (const p of Object.values(PERMISSIONS)) expect(DEFAULT_ROLES["owner"]).toContain(p);
  });
  it("party schema accepts notes", () => {
    const v = createPartySchema.parse({ name: "X", branchId: "b1", notes: "prefers SMS" });
    expect(v.notes).toBe("prefers SMS");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/ledgers.test.ts`
Expected: FAIL (missing exports/notes).

- [ ] **Step 3: Implement**

permissions.ts: append `ACCOUNTS_VIEW: "accounts:view", ACCOUNTS_MANAGE: "accounts:manage",` to PERMISSIONS. DEFAULT_ROLES: owner `[...ALL]` (auto-includes); manager filter unchanged (still only excludes users:approve/branches:approve); accountant append `"accounts:manage"`; cashier append `"accounts:view"`. Others unchanged.
schemas.ts: createPartySchema append `notes: z.string().max(2000).optional(),`.

- [ ] **Step 4: Run green + typecheck**

Run: `pnpm exec vitest run packages/shared/src/ledgers.test.ts 2>&1 | grep -E "Tests "; pnpm --filter @goldos/shared exec tsc --noEmit && echo TSC_OK`
Expected: 4 passed + TSC_OK.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/permissions.ts packages/shared/src/schemas.ts packages/shared/src/ledgers.test.ts
git commit -m "feat: accounts permissions and party notes"
```

---

### Task 2: Migration 0008 + drizzle + seed

**Files:**
- Create: `apps/api/drizzle/0008_ledger.sql`
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/seed.ts`
- Test: local apply + counts

**Interfaces:**
- Consumes: Task 1 perm names.
- Produces: `chart_of_accounts` (11 rows), `journal_entries`, party `code`+`notes`.

- [ ] **Step 1: Write 0008_ledger.sql**

```sql
CREATE TABLE chart_of_accounts (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  branch_id TEXT REFERENCES branches(id)
);
INSERT INTO chart_of_accounts (code, name, type) VALUES
  ('1000', 'Cash on Hand', 'ASSET'),
  ('1010', 'Bank', 'ASSET'),
  ('1100', 'Gold Inventory', 'ASSET'),
  ('1200', 'Customer Receivables', 'ASSET'),
  ('2000', 'Supplier Payables', 'LIABILITY'),
  ('2100', 'Tax Payable', 'LIABILITY'),
  ('3000', 'Owner''s Equity', 'EQUITY'),
  ('3100', 'Opening Balances', 'EQUITY'),
  ('4000', 'Sales Revenue', 'REVENUE'),
  ('5000', 'Cost of Goods Sold', 'EXPENSE'),
  ('6000', 'Operating Expenses', 'EXPENSE');
CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  account_code TEXT NOT NULL REFERENCES chart_of_accounts(code),
  debit_cents INTEGER NOT NULL DEFAULT 0,
  credit_cents INTEGER NOT NULL DEFAULT 0,
  party_type TEXT,
  party_id TEXT,
  ref_entity TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  memo TEXT,
  branch_id TEXT REFERENCES branches(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_journal_account ON journal_entries(account_code, created_at DESC);
CREATE INDEX idx_journal_party ON journal_entries(party_type, party_id, created_at DESC);
CREATE INDEX idx_journal_ref ON journal_entries(ref_entity, ref_id);
ALTER TABLE suppliers ADD COLUMN code TEXT;
ALTER TABLE suppliers ADD COLUMN notes TEXT;
ALTER TABLE customers ADD COLUMN code TEXT;
ALTER TABLE customers ADD COLUMN notes TEXT;
UPDATE suppliers SET code = 'SUP-' || SUBSTR(UPPER(HEX(RANDOMBLOB(3))), 1, 6) WHERE code IS NULL;
UPDATE customers SET code = 'CUS-' || SUBSTR(UPPER(HEX(RANDOMBLOB(3))), 1, 6) WHERE code IS NULL;
CREATE UNIQUE INDEX idx_suppliers_code ON suppliers(code);
CREATE UNIQUE INDEX idx_customers_code ON customers(code);
INSERT INTO permissions (id, name) VALUES ('accounts:view', 'accounts:view'), ('accounts:manage', 'accounts:manage');
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'owner', id FROM permissions WHERE id IN ('accounts:view', 'accounts:manage');
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'manager', id FROM permissions WHERE id IN ('accounts:view', 'accounts:manage');
INSERT INTO role_permissions (role_id, permission_id) VALUES ('accountant', 'accounts:manage'), ('cashier', 'accounts:view');
```

Note: `Owner''s Equity` escaping (double single-quote) — verify post-apply. Code backfill collision: 16^6 space, few rows; UNIQUE enforced after.

- [ ] **Step 2: Drizzle + seed**

Append:
```ts
export const chartOfAccounts = sqliteTable("chart_of_accounts", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  isActive: integer("is_active").notNull().default(1),
  branchId: text("branch_id"),
});

export const journalEntries = sqliteTable("journal_entries", {
  id: text("id").primaryKey(),
  accountCode: text("account_code").notNull(),
  debitCents: integer("debit_cents").notNull().default(0),
  creditCents: integer("credit_cents").notNull().default(0),
  partyType: text("party_type"),
  partyId: text("party_id"),
  refEntity: text("ref_entity").notNull(),
  refId: text("ref_id").notNull(),
  memo: text("memo"),
  branchId: text("branch_id"),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});
```
Party columns: add `code: text("code").unique(), notes: text("notes")` to partyColumns() in schema.ts.
seed.ts: SEED_PERMISSIONS append the two; SEED_ROLE_PERMISSIONS: owner uses [...SEED_PERMISSIONS] (check current form — if explicit list, append both); manager filter excludes users:approve/branches:approve (auto-includes); accountant append accounts:manage; cashier append accounts:view. SEED_ROLES unchanged.

- [ ] **Step 3: Apply local + verify**

Run: `pnpm --filter goldos-api exec wrangler d1 execute DB --local --file ./drizzle/0008_ledger.sql 2>&1 | grep -E "success|ERROR" | head -2`
Run: `... --command "SELECT COUNT(*) AS a FROM chart_of_accounts; SELECT COUNT(*) AS p FROM permissions; SELECT code FROM suppliers; SELECT code FROM customers;"` → a=11, p=30, codes prefixed SUP-/CUS-.
Run: `pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK` (parties service untouched yet — passes since new columns unused).

- [ ] **Step 4: Commit**

```bash
git add apps/api/drizzle/0008_ledger.sql apps/api/src/db/schema.ts apps/api/src/seed.ts
git commit -m "feat: chart of accounts, journal, party codes"
```

---

### Task 3: Journal service + parties upgrade

**Files:**
- Create: `apps/api/src/services/journal.ts`
- Modify: `apps/api/src/services/parties.ts` (code gen, notes, detail, ledger)
- Test: tsc (routes next task)

**Interfaces:**
- Consumes: buildAuditStmt; cents helpers.
- Produces: `postJournalStmts, accountBalance, partyLedger`; extended `createParty` (code), `updateParty` (notes), `getPartyDetail`, `partyLedger`.

- [ ] **Step 1: Write services/journal.ts**

```ts
import { buildAuditStmt } from "../middleware/audit";

export type JournalLine = {
  account: string;
  debitCents: number;
  creditCents: number;
  partyType?: "customer" | "supplier";
  partyId?: string;
};

export type JournalPost = {
  lines: JournalLine[];
  refEntity: string;
  refId: string;
  memo?: string;
  branchId?: string;
  actorId: string;
  auditAction: string;
  auditEntity: string;
  auditEntityId: string;
};

export function checkBalanced(lines: JournalLine[]): void {
  const dr = lines.reduce((s, l) => s + l.debitCents, 0);
  const cr = lines.reduce((s, l) => s + l.creditCents, 0);
  if (lines.length < 2 || dr !== cr || dr <= 0)
    throw Object.assign(new Error("Journal must balance with positive total"), { code: "VALIDATION" });
  for (const l of lines) {
    if (l.debitCents < 0 || l.creditCents < 0 || (l.debitCents > 0 && l.creditCents > 0))
      throw Object.assign(new Error("Line must be debit XOR credit"), { code: "VALIDATION" });
  }
}

export async function postJournalStmts(db: D1Database, post: JournalPost): Promise<D1PreparedStatement[]> {
  checkBalanced(post.lines);
  for (const l of post.lines) {
    const acc = await db
      .prepare("SELECT code FROM chart_of_accounts WHERE code = ? AND is_active = 1")
      .bind(l.account)
      .first();
    if (!acc) throw Object.assign(new Error(`Account not found: ${l.account}`), { code: "NOT_FOUND" });
  }
  const now = Date.now();
  const stmts = post.lines.map((l) =>
    db
      .prepare("INSERT INTO journal_entries (id, account_code, debit_cents, credit_cents, party_type, party_id, ref_entity, ref_id, memo, branch_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), l.account, l.debitCents, l.creditCents, l.partyType ?? null, l.partyId ?? null, post.refEntity, post.refId, post.memo ?? null, post.branchId ?? null, now, post.actorId)
  );
  stmts.push(
    buildAuditStmt(db, { userId: post.actorId, action: post.auditAction, entity: post.auditEntity, entityId: post.auditEntityId, next: { lines: post.lines, memo: post.memo }, branchId: post.branchId })
  );
  return stmts;
}

export async function accountBalance(db: D1Database, code: string, branchId?: string): Promise<number> {
  const cond = branchId ? "AND branch_id = ?" : "";
  const vals = branchId ? [code, branchId] : [code];
  const row = await db
    .prepare(`SELECT COALESCE(SUM(debit_cents), 0) AS dr, COALESCE(SUM(credit_cents), 0) AS cr FROM journal_entries WHERE account_code = ? ${cond}`)
    .bind(...vals)
    .first<{ dr: number; cr: number }>();
  return (row?.dr ?? 0) - (row?.cr ?? 0);
}

export async function partyLedger(
  db: D1Database,
  account: "1200" | "2000",
  partyType: "customer" | "supplier",
  partyId: string
): Promise<{ opening: number; debits: number; credits: number; balance: number; lines: Record<string, unknown>[] }> {
  const table = partyType === "customer" ? "customers" : "suppliers";
  const party = await db
    .prepare(`SELECT id, opening_balance_cents FROM ${table} WHERE id = ?`)
    .bind(partyId)
    .first<{ id: string; opening_balance_cents: number }>();
  if (!party) throw Object.assign(new Error("Party not found"), { code: "NOT_FOUND" });
  const sums = await db
    .prepare(`SELECT COALESCE(SUM(debit_cents), 0) AS dr, COALESCE(SUM(credit_cents), 0) AS cr FROM journal_entries WHERE account_code = ? AND party_type = ? AND party_id = ?`)
    .bind(account, partyType, partyId)
    .first<{ dr: number; cr: number }>();
  const dr = sums?.dr ?? 0;
  const cr = sums?.cr ?? 0;
  const balance = account === "1200" ? party.opening_balance_cents + dr - cr : party.opening_balance_cents + cr - dr;
  const { results } = await db
    .prepare(`SELECT id, account_code, debit_cents, credit_cents, ref_entity, ref_id, memo, created_at FROM journal_entries WHERE account_code = ? AND party_type = ? AND party_id = ? ORDER BY created_at DESC LIMIT 100`)
    .bind(account, partyType, partyId)
    .all();
  return { opening: party.opening_balance_cents, debits: dr, credits: cr, balance, lines: results ?? [] };
}
```

- [ ] **Step 2: Upgrade parties.ts (code, notes, detail)**

PARTY_COLS add `code, notes`. RawPartyRow + PartyRow add `code: string; notes: string | null`. toPartyRow unchanged otherwise.
createParty: generate code (`CUS-`/`SUP-` + 6 chars via same alphabet/retry pattern as SKU — duplicate the 10-line helper locally as `randomPartyCode(prefix)`), INSERT includes code + notes, return includes them, audit next includes code.
updateParty patch type add `notes?: string`; handle `notes` in sets.
Add:
```ts
export async function getPartyDetail(db: D1Database, table: PartyTable, id: string) {
  const row = await db.prepare(`SELECT ${PARTY_COLS} FROM ${table} WHERE id = ?`).bind(id).first<RawPartyRow>();
  if (!row) throw Object.assign(new Error("Record not found"), { code: "NOT_FOUND" });
  const { results: branches } = await db.prepare(`SELECT branch_id FROM branch_members WHERE user_id = ?`).bind(id).all();
```
No — parties aren't users; no branch_members. Detail = toPartyRow + roles n/a. Just:
```ts
export async function getPartyDetail(db: D1Database, table: PartyTable, id: string): Promise<PartyRow> {
  const row = await db.prepare(`SELECT ${PARTY_COLS} FROM ${table} WHERE id = ?`).bind(id).first<RawPartyRow>();
  if (!row) throw Object.assign(new Error("Record not found"), { code: "NOT_FOUND" });
  return toPartyRow(row);
}
```
Ledger endpoints call `partyLedger` from journal.ts directly (no wrapper needed).

- [ ] **Step 3: Typecheck (routes reference new fns next task — expect errors ONLY in routes/parties.ts)**

Run: `pnpm --filter goldos-api exec tsc --noEmit 2>&1 | grep "error TS" | sed 's/(.*//' | sort | uniq -c`

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/journal.ts apps/api/src/services/parties.ts
git commit -m "feat: journal service and party codes"
```

---

### Task 4: Party + accounts routes

**Files:**
- Modify: `apps/api/src/routes/parties.ts` (detail, ledger, notes)
- Create: `apps/api/src/routes/accounts.ts`
- Modify: `apps/api/src/app.ts` (mount)
- Test: tsc clean

**Interfaces:**
- Consumes: Task 3 fns; updatePartySchema + notes.
- Produces: `GET /suppliers/:id`, `GET /customers/:id`, `GET /:id/ledger`; `GET /accounts`, `POST /accounts/adjustments`.

- [ ] **Step 1: Edit parties.ts routes**

updatePartySchema: append `notes: z.string().max(2000).optional(),`; pass `notes: parsed.data.notes` in BOTH PATCH handlers (edit + status — status handler passes through updateParty which ignores unknown? updateParty patch type has no notes — pass only in edit handler).
Add to partyRouter (before closing):
```ts
    .get("/:id", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
      try {
        const data = await getPartyDetail(c.env.DB, table, c.req.param("id"));
        return c.json({ success: true, data }, 200);
      } catch (err) {
        return serviceError(c, err);
      }
    })
    .get("/:id/ledger", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
      try {
        const account = table === "customers" ? "1200" : "2000";
        const partyType = table === "customers" ? "customer" : "supplier";
        const data = await partyLedger(c.env.DB, account, partyType, c.req.param("id"));
        return c.json({ success: true, data }, 200);
      } catch (err) {
        return serviceError(c, err);
      }
    });
```
CAREFUL: `/:id` route vs `/:id/status` existing order — Hono matches `/:id/status` only on two segments, no conflict. But `/:id/ledger` must not shadow: distinct segment, fine.
Import getPartyDetail + partyLedger.

- [ ] **Step 2: Write routes/accounts.ts**

```ts
import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { accountBalance, postJournalStmts } from "../services/journal";
import { serviceError } from "./http";

const adjustSchema = z.object({
  debitAccount: z.string().min(1),
  creditAccount: z.string().min(1),
  amountCents: z.number().int().gt(0),
  memo: z.string().max(500).optional(),
  reason: z.string().min(1).max(500),
  branchId: z.string().min(1).optional(),
});

export const accounts = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const branchId = c.req.query("branchId");
    const { results } = await c.env.DB.prepare(
      "SELECT code, name, type, is_active FROM chart_of_accounts ORDER BY code"
    ).all<{ code: string; name: string; type: string; is_active: number }>();
    const rows = [];
    for (const a of results ?? []) {
      rows.push({ ...a, balance_cents: await accountBalance(c.env.DB, a.code, branchId) });
    }
    return c.json({ success: true, data: rows }, 200);
  })
  .post("/adjustments", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = adjustSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid adjustment" } }, 400);
    if (parsed.data.debitAccount === parsed.data.creditAccount)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Accounts must differ" } }, 400);
    try {
      const id = crypto.randomUUID();
      const stmts = await postJournalStmts(c.env.DB, {
        lines: [
          { account: parsed.data.debitAccount, debitCents: parsed.data.amountCents, creditCents: 0 },
          { account: parsed.data.creditAccount, debitCents: 0, creditCents: parsed.data.amountCents },
        ],
        refEntity: "adjustment",
        refId: id,
        memo: parsed.data.memo,
        branchId: parsed.data.branchId,
        actorId: c.get("userId"),
        auditAction: "accounts.adjust",
        auditEntity: "adjustment",
        auditEntityId: id,
      });
      await c.env.DB.batch(stmts);
      return c.json({ success: true, data: { id } }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  });
```

- [ ] **Step 3: Mount + tsc clean**

app.ts: `import { accounts } from "./routes/accounts";` + `app.route("/api/v1/accounts", accounts);`
Run: `pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK`
Expected: TSC_OK.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/parties.ts apps/api/src/routes/accounts.ts apps/api/src/app.ts
git commit -m "feat: party detail/ledger and accounts routes"
```

---

### Task 5: Live verify + remote deploy

**Files:** none (migrate + deploy + gate).

**Interfaces:**
- Consumes: Tasks 1–4. Remote needs 0008 only (0001–0007 applied).

- [ ] **Step 1: Remote migrate + deploy**

Run: `pnpm --filter goldos-api exec wrangler d1 execute goldos --remote --file ./drizzle/0008_ledger.sql` → success.
Run: `pnpm --filter goldos-api exec wrangler deploy` → Version ID.
(Caution learned: if FK error, seed prerequisite rows first; if API-import error, retry.)

- [ ] **Step 2: Live gate (remote admin)**

Login → chart has 11 accounts → adjustment DR 6000 / CR 1000 50000c + reason → 201 → accountBalance 6000 shows +50000 → unbalanced (DR≠CR via direct... no endpoint accepts unbalanced; verify via accounts.adjust audit row) → supplier ledger shows opening + 0 lines → cashier adjust → 403 → new supplier has SUP- code → audit contains accounts.adjust.

- [ ] **Step 3: Local gate (fresh 0008)**

0008 already applied locally in Task 2. Same checks against local dev (port 8788 if 8787 taken): chart, adjustment, ledger, RBAC.
No commit (no files).

---

### Task 6: Web ledgers UI

**Files:**
- Modify: `apps/web/app/(app)/suppliers/page.tsx`, `customers/page.tsx` (ledger drawer), `apps/web/components/app-sidebar.tsx` (Accounts link)
- Create: `apps/web/app/(app)/accounts/page.tsx`
- Test: tsc + build + click-through

**Interfaces:**
- Consumes: Task 4 endpoints; centsToLkr for display.
- Produces: party ledger drawers; Accounts page with adjustment dialog.

- [ ] **Step 1: Sidebar + Accounts page**

Sidebar append `{ href: "/accounts", label: "Accounts", perm: "accounts:view" }` after Audit (read file first for exact LINKS block).
accounts/page.tsx: `GET /accounts` table (code, name, type, balance via centsToLkr) + branch filter input + adjustment dialog (debit/credit selects from chart, amount LKR → ×100 cents client-side with Math.round, memo, reason) gated by accounts:manage (hide button without; check via /me permissions like users page does — read users page for the pattern).

- [ ] **Step 2: Party ledger drawers**

Suppliers/customers pages use MasterCrud — add per-row ledger drawer: MasterCrud has no drawer slot (read master-crud.tsx first). Minimal approach: add optional `renderActions?: (row) => ReactNode` prop to MasterCrud? That changes shared component — acceptable, small. OR simpler: columns already link? They don't. Decision: extend MasterCrud with optional `detailHref?: (id: string) => string` rendering the first column as link? Name column link to `#` opening drawer requires state in page... Simplest robust: in suppliers/customers pages, add a "Ledger" button BELOW table? No row context.
Implement `renderActions` prop in master-crud.tsx:
```tsx
// Props add: renderActions?: (row: Record<string, string | number | null>) => React.ReactNode;
// In table last cell: {renderActions ? renderActions(r) : (deactivate button as today)}
```
Keep default behavior when absent (all other pages unaffected). Suppliers page passes renderActions opening a LedgerDrawer (inline component in page file): fetches `GET /suppliers/:id` + `GET /suppliers/:id/ledger`, shows code/contact/balance header + lines table + empty state. Same for customers.

- [ ] **Step 3: tsc + build + click-through**

Run: `pnpm --filter goldos-web exec tsc --noEmit && echo TSC_OK`
Run: `NEXT_PUBLIC_API_URL=http://localhost:8787 pnpm --filter goldos-web exec next build` → /accounts present.
Click-through (API 8788, web 3001 — ports 8787/3000 belong to sibling project): /accounts, /suppliers, /customers 200.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat: ledger drawers and accounts UI"
```

---

### Task 7: Docs + full verification

**Files:**
- Modify: `docs/database.md`, `docs/api.md`, `docs/permissions.md`, `docs/gold-accounting.md`
- Test: suite + grep

**Interfaces:**
- Consumes: all tasks.

- [ ] **Step 1: Docs**

database.md: 0008 section (accounts, journal, party code/notes).
api.md: accounts endpoints + party detail/ledger rows + cents contract note.
permissions.md: accounts:view/manage row (owner/manager/accountant manage; +cashier view).
gold-accounting.md: journal design, balance formulas, postJournal composition for purchases.

- [ ] **Step 2: Full verification**

Run: `pnpm test` (3/3) + `pnpm build` (3/3).
Run: owner grant count query remote? Local: `SELECT COUNT(*) FROM role_permissions WHERE role_id='owner'` → 30.
```bash
git add docs
git commit -m "docs: ledger tables, endpoints, accounting"
```

---

## Self-Review

- Spec coverage: chart+journal (§2 Tasks 2–3) ✓; postJournal composition (§2 Task 3) ✓; balances derived (§2 Tasks 3–4) ✓; CUS-/SUP- + backfill (§3 Task 2) ✓; notes (§3 Tasks 1,3,4) ✓; NIC-only (§3, no fields added) ✓; detail+ledger endpoints (§3 Task 4) ✓; UI ledger tab + accounts + sidebar (§4 Task 6) ✓; no stub tabs (§4 Task 6) ✓; testing (§6 Tasks 5–6) ✓.
- Placeholder scan: no TBD/TODO; amounts, codes, grant sets, key formats explicit.
- Type consistency: `amountCents` (adjust API) vs `amount_cents` (journal rows) — boundary conversion at route; `rate_cents_per_g` untouched; `image_keys` unaffected; `renderActions` row type matches MasterCrud Row.
