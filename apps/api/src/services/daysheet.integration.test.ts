// The paper day sheet against the books: the AI reader's output is validated,
// paper lines pair with the right documents, and differences are reported
// both ways (written but not keyed, keyed but not written).
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";
import { nameSimilarity, reconcileSheet, type SheetRow, type SystemRow } from "./daysheet";
import { interpretSheet, methodOf, moneyCents } from "../ai/daysheet-scan";

const row = (over: Partial<SheetRow>): SheetRow => ({
  id: crypto.randomUUID(),
  lineNo: 1,
  refNo: null,
  name: null,
  phone: null,
  details: null,
  goldText: null,
  goldMg: null,
  receivedCents: null,
  receivedMethod: null,
  givenCents: null,
  givenMethod: null,
  oldGoldCents: null,
  linkedRef: null,
  accepted: false,
  acceptNote: null,
  ...over,
});

const sys = (over: Partial<SystemRow>): SystemRow => ({
  ref: `sale_invoice:${crypto.randomUUID()}`,
  refEntity: "sale_invoice",
  refId: "x",
  refNo: null,
  kind: "Sale",
  name: null,
  phone: null,
  customerId: null,
  details: null,
  goldMg: null,
  receivedCents: 0,
  givenCents: 0,
  oldGoldCents: 0,
  creditCents: 0,
  receivedMethods: [],
  givenMethods: [],
  at: 0,
  href: null,
  ...over,
});

describe("interpretSheet", () => {
  it("parses amounts, methods, weights and lifts phones", () => {
    const out = interpretSheet(
      {
        date: "2026-10-18",
        rows: [
          { refNo: "CB-481", name: "Ansar Kiringadeniya", received: "58,000/-", oldGold: 36000 },
          { name: "Chandra Kanthi 0774086201", goldText: "8.450", given: "100000 (Bank)" },
          { received: 1300 },
        ],
        totals: { received: 60000 },
      },
      "2026-10-18",
      "m"
    );
    expect(out.rows).toHaveLength(3);
    expect(out.rows[0]).toMatchObject({ refNo: "CB-481", receivedCents: 5_800_000, receivedMethod: "cash", oldGoldCents: 3_600_000 });
    expect(out.rows[1]).toMatchObject({ phone: "0774086201", goldMg: 8450, givenCents: 10_000_000, givenMethod: "bank" });
    // An amount with no owner, and the written total disagreeing with the lines.
    expect(out.warnings.some((w) => w.startsWith("Line 3"))).toBe(true);
    expect(out.warnings.some((w) => w.includes("received total"))).toBe(true);
  });

  it("reads the positional four-cell shape, empty cells included", () => {
    const out = interpretSheet(
      { rows: [{ name: "Rasla", cells: ["", "", "", "53000"] }, { refNo: "CB-45", cells: ["", "4000 (AC)", "30000", ""] }], totals: ["", "4000", "30000", "53000"] },
      "2026-10-18",
      "m"
    );
    expect(out.rows[0]).toMatchObject({ receivedCents: null, givenCents: null, oldGoldCents: 5_300_000 });
    expect(out.rows[1]).toMatchObject({ receivedCents: 400_000, receivedMethod: "bank", givenCents: 3_000_000, oldGoldCents: null });
    expect(out.warnings.filter((w) => w.includes("total"))).toEqual([]);
  });

  it("warns on a different date and on unreadable weights", () => {
    const out = interpretSheet({ date: "2026-10-17", rows: [{ name: "Gayan", goldText: "2x720", received: 100 }] }, "2026-10-18", "m");
    expect(out.rows[0]!.goldMg).toBeNull();
    expect(out.warnings.some((w) => w.includes("dated 2026-10-17"))).toBe(true);
    expect(out.warnings.some((w) => w.includes("2x720"))).toBe(true);
  });

  it("reads method notes", () => {
    expect(methodOf(null, "15000 (AC)")).toBe("bank");
    expect(methodOf("Card")).toBe("card");
    expect(methodOf(null, "2000 (Chq)")).toBe("cheque");
    expect(moneyCents("Rs. 1,300.50")).toBe(130_050);
    expect(moneyCents("abc")).toBeNull();
  });
});

describe("reconcileSheet", () => {
  it("pairs by bill number, phone and name and reports field differences", () => {
    const a = sys({ refNo: "SINV-0481", name: "Mohamed Ansar", receivedCents: 5_800_000, oldGoldCents: 3_600_000, goldMg: 8450, receivedMethods: ["cash"] });
    const b = sys({ ref: "customer_receipt:r1", refEntity: "customer_receipt", kind: "Customer payment", name: "Chandra Kanthi", phone: "+94 77 408 6201", receivedCents: 2_200_000, receivedMethods: ["bank"] });
    const c = sys({ ref: "other_expense:e1", refEntity: "other_expense", kind: "Other expense", details: "Wifi adaptor", givenCents: 130_000, givenMethods: ["cash"] });
    const rows = [
      row({ lineNo: 1, refNo: "CB-481", name: "Ansar", receivedCents: 5_800_000, oldGoldCents: 3_600_000, goldMg: 8450 }),
      row({ lineNo: 2, name: "Chandra", phone: "0774086201", receivedCents: 2_000_000, receivedMethod: "bank" }),
      row({ lineNo: 3, name: "Wifi Adaptor", givenCents: 130_000 }),
      row({ lineNo: 4, name: "Shakir", receivedCents: 4_250_000 }),
    ];
    const rec = reconcileSheet(rows, [a, b, c]);
    expect(rec.rows.map((r) => r.status)).toEqual(["MATCHED", "MISMATCH", "MATCHED", "MISSING_IN_SYSTEM"]);
    expect(rec.rows[0]!.matchRef).toBe(a.ref);
    expect(rec.rows[1]!.issues).toEqual([{ field: "received", label: "Amount received", sheet: "20,000", system: "22,000" }]);
    expect(rec.counts).toMatchObject({ matched: 2, mismatch: 1, missingInSystem: 1, missingOnSheet: 0 });
    expect(rec.status).toBe("ISSUES");
  });

  it("reports what the books have that the paper does not, unless ignored", () => {
    const s1 = sys({ refNo: "SINV-0002", name: "Rasla", receivedCents: 8_800_000 });
    const rec = reconcileSheet([], [s1]);
    expect(rec.missingOnSheet).toHaveLength(1);
    expect(reconcileSheet([], [s1], [{ ref: s1.ref, note: "bank only" }]).status).toBe("VERIFIED");
  });

  it("a hand-made link wins and an accepted difference stops being an issue", () => {
    const s1 = sys({ name: "Someone Else", receivedCents: 1000 });
    const r = row({ name: "Written name", receivedCents: 2000, linkedRef: s1.ref, accepted: true, acceptNote: "discount" });
    const rec = reconcileSheet([r], [s1]);
    expect(rec.rows[0]).toMatchObject({ status: "ACCEPTED", matchRef: s1.ref, matchedBy: ["linked"] });
    expect(rec.status).toBe("VERIFIED");
  });

  it("does not pair on a lone matching amount when names disagree", () => {
    const s1 = sys({ name: "Fathima Nushra", receivedCents: 150_000 });
    const rec = reconcileSheet([row({ name: "Gayan Arunayake", receivedCents: 150_000 })], [s1]);
    expect(rec.rows[0]!.status).toBe("MISSING_IN_SYSTEM");
  });

  it("tolerates handwriting in names", () => {
    expect(nameSimilarity("Sahirullah", "Sahirulla Mohamed")).toBe(1);
    expect(nameSimilarity("Gayan", "Nimal")).toBe(0);
  });
});

describe.skipIf(!sqliteAvailable)("day sheet against the books", () => {
  let db: D1Database;
  let raw: SqliteDb;

  beforeAll(async () => {
    ({ db, raw } = migratedDb());
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO customers (id, name, phone, branch_id, created_at) VALUES ('c1','Chandra Kanthi','0774086201','b1',0);
    `);
  });

  it("builds the system sheet, checks the paper, and links a line recorded from it", async () => {
    const { createCashEntry } = await import("./cashentries");
    const { createReceipt } = await import("./receipts");
    const { businessDateFor } = await import("./busdate");
    const { saveDaySheet, getDaySheet, linkRow, appendSystemRow, systemDaySheet } = await import("./daysheet");
    const date = await businessDateFor(db, Date.now());

    // The customer owes from an earlier bill, so a payment can be taken.
    const { buildEntryStmts } = await import("./journal");
    const owed = await buildEntryStmts(
      db,
      {
        lines: [
          { account: "1200", debitCents: 5_000_000, creditCents: 0, partyType: "customer", partyId: "c1" },
          { account: "3000", debitCents: 0, creditCents: 5_000_000 },
        ],
        refEntity: "opening_balance",
        refId: "c1",
        memo: "Opening balance",
        branchId: "b1",
        actorId: "u1",
        auditAction: "test",
        auditEntity: "customer",
        auditEntityId: "c1",
        sourceModule: "manual",
      },
      { entryDate: "2026-01-01" }
    );
    await db.batch(owed.stmts);

    const rcpt = await createReceipt(db, { customerId: "c1", branchId: "b1", amountCents: 2_200_000, method: "cash" }, "u1");
    await createCashEntry(db, { branchId: "b1", kind: "OTHER_EXPENSE", amountCents: 130_000, method: "cash", note: "Wifi adaptor" }, "u1");

    const system = await systemDaySheet(db, "b1", date);
    expect(system.map((s) => [s.kind, s.name, s.receivedCents, s.givenCents])).toEqual([
      ["Customer payment", "Chandra Kanthi", 2_200_000, 0],
      ["Other expense", null, 0, 130_000],
    ]);

    const draft = await saveDaySheet(
      db,
      {
        branchId: "b1",
        date,
        draft: true,
        rows: [
          { name: "Chandra", phone: "077 408 6201", receivedCents: 2_200_000 },
          { name: "Shakir", receivedCents: 1_000_000 },
        ],
      },
      "u1"
    );
    // A draft is not a finding yet.
    expect(draft.sheet?.status).toBe("DRAFT");

    const saved = await saveDaySheet(db, { branchId: "b1", date, rows: draft.rows }, "u1");
    expect(saved.sheet?.status).toBe("ISSUES");
    expect(saved.reconciliation?.rows.map((r) => r.status)).toEqual(["MATCHED", "MISSING_IN_SYSTEM"]);
    expect(saved.reconciliation?.rows[0]!.matchRef).toBe(`customer_receipt:${rcpt.id}`);
    expect(saved.reconciliation?.missingOnSheet.map((s) => s.kind)).toEqual(["Other expense"]);

    // The missing line is keyed now and linked; the forgotten expense is added to the paper.
    const income = await createCashEntry(db, { branchId: "b1", kind: "OTHER_INCOME", amountCents: 1_000_000, method: "cash", note: "Shakir" }, "u1");
    await linkRow(db, saved.sheet!.id, saved.rows[1]!.id, `other_income:${income.id}`, "u1");
    const exp = saved.reconciliation!.missingOnSheet[0]!;
    await appendSystemRow(db, saved.sheet!.id, exp.ref, "u1");

    const after = await getDaySheet(db, "b1", date);
    expect(after.rows).toHaveLength(3);
    expect(after.reconciliation?.status).toBe("VERIFIED");
    expect(after.sheet?.status).toBe("VERIFIED");
    expect(after.sheet?.mismatch_count).toBe(0);
  });
});

describe.skipIf(!sqliteAvailable)("system sheet for an old-for-new exchange", () => {
  let db: D1Database;
  let raw: SqliteDb;

  beforeAll(async () => {
    ({ db, raw } = migratedDb());
    raw.exec(`
      INSERT INTO categories (id, name, code, created_at) VALUES ('cat-og', 'OLD GOLD OG', 'OG', 0);
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO customers (id, name, phone, branch_id, created_at) VALUES ('c1','Sahirullah','0772155122','b1',0);
      INSERT INTO gold_rates (id, purity_id, rate_cents_per_g, effective_from, created_at) VALUES ('r22','purity-22k',2850000,0,0);
    `);
  });

  it("puts the bill and the old gold traded against it on one line", async () => {
    const og = await import("./oldgold");
    const { createProduct } = await import("./products");
    const { exchangeSale } = await import("./exchange");
    const { systemDaySheet, reconcileSheet } = await import("./daysheet");
    const { businessDateFor } = await import("./busdate");
    const { id } = await og.intakeItem(db, { needsTesting: true, customerId: "c1", branchId: "b1", itemType: "chain", description: "Old chain", grossG: 5, stoneG: 0 }, "u1");
    await og.recordTest(db, id, { method: "xrf", permille: 916, result: "pass" }, "u1");
    await og.valuateItem(db, id, { stoneDeductionLkr: 0, processingDeductionLkr: 0 }, "u1");
    const p = await createProduct(
      db,
      { name: "Ring A", categoryId: "cat-ring", metalTypeId: "metal-gold", purityId: "purity-22k", branchId: "b1", grossG: 2, stoneG: 0, makingLkr: 0, wastageG: 0, costLkr: 10000 },
      "u1"
    );
    raw.exec(`UPDATE products SET selling_price_cents = 5000000 WHERE id = '${p.id}'`);
    const x = await exchangeSale(
      db,
      { customerId: "c1", branchId: "b1", oldGoldItemIds: [id], items: [{ productId: p.id, discountLkr: 0 }], payments: [], payout: "cash" },
      "u1"
    );

    const rows = await systemDaySheet(db, "b1", await businessDateFor(db, Date.now()));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "Sale",
      name: "Sahirullah",
      phone: "0772155122",
      goldMg: 2000,
      receivedCents: 0,
      givenCents: x.shopPaysCents,
      oldGoldCents: x.oldGoldValueCents,
    });

    const rec = reconcileSheet([row({ name: "Sahirullah", givenCents: x.shopPaysCents, oldGoldCents: x.oldGoldValueCents, goldMg: 2000 })], rows);
    expect(rec.status).toBe("VERIFIED");
  });
});
