// The day sheet over HTTP, through the real app and real SQLite: a photo is
// read into a draft, saved and checked against the books, lines are recorded,
// accepted and ignored, more photos are added or replace the first, and the
// permission, closed-day and bad-reader cases are refused. The vision model is
// scripted here; the live reader is checked by ai/daysheet-scan.live.test.ts.
import { addDays } from "@goldos/shared";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "../services/sqlite-test-db";

type Inputs = { messages: { role: string; content: unknown }[] };
type Step = (inputs: Inputs) => unknown;

const reply = (obj: unknown) => ({ choices: [{ message: { content: JSON.stringify(obj) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

describe.skipIf(!sqliteAvailable)("day sheet over HTTP", () => {
  let raw: SqliteDb;
  let env: Record<string, unknown>;
  let app: (typeof import("../app"))["app"];
  let today: string;
  let owner = "";
  let viewer = "";
  const PASSWORD = "correct-horse-1";
  const script: Step[] = [];
  const calls: Inputs[] = [];
  const store = new Map<string, { bytes: Uint8Array; type: string }>();
  const PATH = "/api/v1/day-sheets";

  const headers = (sid: string) => ({ cookie: `session=${sid}`, origin: "http://localhost:3000" });
  const get = (path: string, sid = owner) => app.request(`${PATH}${path}`, { headers: headers(sid) }, env);
  const json = (method: string, path: string, body: unknown, sid = owner) =>
    app.request(
      `${PATH}${path}`,
      { method, headers: { ...headers(sid), "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) },
      env
    );
  const upload = (files: { bytes: Uint8Array; type: string; name?: string }[], fields: Record<string, string>, sid = owner) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    for (const f of files) form.append("file", new File([f.bytes as BlobPart], f.name ?? "sheet.jpg", { type: f.type }));
    return app.request(`${PATH}/scan`, { method: "POST", headers: { ...headers(sid), "Idempotency-Key": crypto.randomUUID() }, body: form }, env);
  };

  type View = {
    sheet: { id: string; status: string; imageCount: number; warnings: string[] } | null;
    rows: { id: string; lineNo: number; name: string | null; refNo: string | null; phone: string | null; goldMg: number | null; receivedCents: number | null; receivedMethod: string | null; givenCents: number | null; oldGoldCents: number | null; linkedRef: string | null; accepted: boolean }[];
    reconciliation: { rows: { rowId: string; status: string; matchRef: string | null }[]; missingOnSheet: { ref: string }[]; counts: Record<string, number>; status: string } | null;
  };
  const ok = async <T>(res: Response): Promise<T> => {
    const body = (await res.json()) as { success: boolean; data: T; error?: { message: string } };
    if (!body.success) throw new Error(`${res.status} ${body.error?.message}`);
    return body.data;
  };
  const statusOf = (v: View, name: string) => v.reconciliation?.rows.find((r) => v.rows.find((x) => x.id === r.rowId)?.name === name)?.status;

  beforeAll(async () => {
    const m = migratedDb();
    raw = m.raw;
    const r2 = {
      put: async (key: string, body: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) => {
        store.set(key, { bytes: new Uint8Array(body), type: opts?.httpMetadata?.contentType ?? "application/octet-stream" });
      },
      get: async (key: string) => {
        const o = store.get(key);
        return o ? { arrayBuffer: async () => o.bytes.slice().buffer, httpMetadata: { contentType: o.type } } : null;
      },
      delete: async (key: string) => void store.delete(key),
      list: async () => ({ objects: [], truncated: false }),
    };
    env = {
      DB: m.db,
      R2: r2,
      WEB_ORIGIN: "http://localhost:3000",
      AI_GATEWAY_ID: "test-gateway",
      AI: {
        run: async (_model: string, inputs: Inputs) => {
          calls.push(inputs);
          const step = script.shift();
          if (!step) throw new Error("the model was called with no scripted reply");
          return step(inputs);
        },
      },
    };
    const { hashPassword } = await import("../services/hash");
    const hash = await hashPassword(PASSWORD);
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES
        ('u1','owner@shop.lk','Owner','${hash}',0,0), ('u3','viewer@shop.lk','Viewer','${hash}',0,0);
      INSERT INTO roles (id, name) VALUES ('viewer','viewer');
      INSERT INTO role_permissions (role_id, permission_id) VALUES ('viewer','dayclose:view');
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner'), ('u3','viewer');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO branch_members (user_id, branch_id) VALUES ('u1','b1'), ('u3','b1');
    `);
    const { businessDateFor } = await import("../services/busdate");
    const { createCashEntry } = await import("../services/cashentries");
    today = await businessDateFor(m.db, Date.now());
    // What the books say for today: a 1,300 wifi expense and 2,000 of other income with no paper line.
    await createCashEntry(m.db, { branchId: "b1", kind: "OTHER_EXPENSE", amountCents: 130_000, method: "cash", note: "Wifi adaptor" }, "u1");
    await createCashEntry(m.db, { branchId: "b1", kind: "OTHER_INCOME", amountCents: 200_000, method: "cash", note: "Polishing" }, "u1");
    ({ app } = await import("../app"));
    for (const [who, email] of [["owner", "owner@shop.lk"], ["viewer", "viewer@shop.lk"]] as const) {
      const res = await app.request(
        "/api/v1/auth/login",
        { method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": "10.0.0.7" }, body: JSON.stringify({ email, password: PASSWORD }) },
        env
      );
      const sid = res.headers.get("set-cookie")?.match(/session=([^;]+)/)?.[1] ?? "";
      if (who === "owner") owner = sid;
      else viewer = sid;
    }
  });

  beforeEach(() => {
    script.length = 0;
    calls.length = 0;
  });

  const firstSheet = () =>
    reply({
      date: today,
      rows: [
        { line: 1, refNo: "CB-481", name: "Ansar Kiringadeniya", phone: null, details: null, cells: ["8.450", "58,000", "", "36,000"] },
        { line: 2, refNo: null, name: "Wifi adaptor", phone: null, details: null, cells: ["", "", "1,300", ""] },
        { line: 3, refNo: "CB-45", name: "Shakir 0712223334", phone: null, details: null, cells: ["", "10,000", "", ""] },
      ],
      // The printed given total is wrong on purpose: the reader must say so.
      totals: { received: "68,000", given: "1,500", oldGold: "36,000" },
    });

  let firstView: View;

  it("reads a photo into a draft: rows, warnings and the photo kept beside the sheet", async () => {
    script.push(() => firstSheet());
    const res = await upload([{ bytes: JPEG, type: "image/jpeg" }], { branchId: "b1", date: today });
    expect(res.status).toBe(200);
    const data = await ok<View & { scan: { read: number; warnings: string[] } }>(res);
    expect(data.sheet?.status).toBe("DRAFT");
    expect(data.sheet?.imageCount).toBe(1);
    expect(data.rows.map((r) => [r.refNo, r.name, r.phone, r.goldMg, r.receivedCents, r.receivedMethod, r.givenCents, r.oldGoldCents])).toEqual([
      ["CB-481", "Ansar Kiringadeniya", null, 8450, 5_800_000, "cash", null, 3_600_000],
      [null, "Wifi adaptor", null, null, null, null, 130_000, null],
      ["CB-45", "Shakir", "0712223334", null, 1_000_000, "cash", null, null],
    ]);
    expect(data.scan.read).toBe(3);
    expect(data.scan.warnings.some((w) => w.includes("given total"))).toBe(true);
    // The model got the photo itself, as a data URL.
    const content = calls[0]!.messages[1]!.content as { type: string; image_url?: { url: string } }[];
    expect(content.find((p) => p.type === "image_url")?.image_url?.url.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(store.size).toBe(1);
  });

  it("a draft is not a finding until it is saved and checked against the books", async () => {
    const draft = await ok<View>(await get(`/day?branchId=b1&date=${today}`));
    expect(draft.sheet?.status).toBe("DRAFT");
    expect(draft.reconciliation?.status).toBe("ISSUES");
    // Saved as a draft: still not checked.
    const keptDraft = await ok<View>(await json("PUT", "/day", { branchId: "b1", date: today, rows: draft.rows, draft: true }));
    expect(keptDraft.sheet?.status).toBe("DRAFT");

    // Saved and checked: the wifi line agrees, the other two are written but not keyed, the income is keyed but not written.
    firstView = await ok<View>(await json("PUT", "/day", { branchId: "b1", date: today, rows: keptDraft.rows }));
    expect(firstView.sheet?.status).toBe("ISSUES");
    expect(firstView.reconciliation?.rows.map((r) => r.status)).toEqual(["MISSING_IN_SYSTEM", "MATCHED", "MISSING_IN_SYSTEM"]);
    expect(firstView.reconciliation?.missingOnSheet).toHaveLength(1);
    expect(firstView.reconciliation?.counts).toMatchObject({ matched: 1, missingInSystem: 2, missingOnSheet: 1 });
    expect(firstView.rows.find((r) => r.name === "Wifi adaptor")?.linkedRef).toBeNull();
  });

  it("serves the photo back to someone who works at the branch", async () => {
    const id = firstView.sheet!.id;
    const res = await get(`/${id}/images/0`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
    expect((await get(`/${id}/images/3`)).status).toBe(404);
  });

  it("records the missing line into the books from the sheet, and it reconciles", async () => {
    const shakir = firstView.rows.find((r) => r.name === "Shakir")!;
    const res = await json("POST", `/${firstView.sheet!.id}/rows/${shakir.id}/record`, { action: "cash_entry", kind: "OTHER_INCOME", amountCents: 1_000_000, method: "cash", note: "Shakir" });
    expect(res.status).toBe(201);
    const v = await ok<View>(res);
    const row = v.rows.find((r) => r.name === "Shakir")!;
    expect(row.linkedRef).toMatch(/^other_income:/);
    expect(statusOf(v, "Shakir")).toBe("MATCHED");
    expect(v.reconciliation?.counts).toMatchObject({ matched: 2, missingInSystem: 1, missingOnSheet: 1 });
  });

  it("a line that is not in the books can be accepted with a reason, and a system line can be left off the paper", async () => {
    let v = await ok<View>(await get(`/day?branchId=b1&date=${today}`));
    const ansar = v.rows.find((r) => r.name === "Ansar Kiringadeniya")!;
    expect((await json("POST", `/${v.sheet!.id}/rows/${ansar.id}/accept`, { accepted: true, note: "" })).status).toBe(400);
    v = await ok<View>(await json("POST", `/${v.sheet!.id}/rows/${ansar.id}/accept`, { accepted: true, note: "Bill was paid at the other counter" }));
    expect(statusOf(v, "Ansar Kiringadeniya")).toBe("ACCEPTED");

    const polishing = v.reconciliation!.missingOnSheet[0]!;
    expect((await json("POST", `/${v.sheet!.id}/ignore`, { ref: polishing.ref, ignore: true, note: "" })).status).toBe(400);
    v = await ok<View>(await json("POST", `/${v.sheet!.id}/ignore`, { ref: polishing.ref, ignore: true, note: "Bank transfer by the owner" }));
    expect(v.reconciliation?.missingOnSheet).toHaveLength(0);
    expect(v.reconciliation?.status).toBe("VERIFIED");
    expect(v.sheet?.status).toBe("VERIFIED");

    const alerts = await ok<{ issues: number }>(await get("/alerts"));
    expect(alerts.issues).toBe(0);
  });

  it("a second photo is added as more lines, the first photo's links are kept", async () => {
    script.push(() => reply({ date: today, rows: [{ line: 4, refNo: null, name: "Rasla", phone: null, details: null, cells: ["", "4,000", "", "53,000"] }], totals: { received: "4,000", given: "", oldGold: "53,000" } }));
    const res = await upload([{ bytes: JPEG, type: "image/jpeg" }], { branchId: "b1", date: today, mode: "append" });
    const v = await ok<View & { scan: unknown }>(res);
    expect(v.rows.map((r) => r.name)).toEqual(["Ansar Kiringadeniya", "Wifi adaptor", "Shakir", "Rasla"]);
    expect(v.sheet?.imageCount).toBe(2);
    expect(v.sheet?.status).toBe("DRAFT");
    expect(v.rows.find((r) => r.name === "Shakir")?.linkedRef).toMatch(/^other_income:/);
    expect(store.size).toBe(2);
  });

  it("a re-upload replaces the lines and the photos it replaces", async () => {
    script.push(() => reply({ date: today, rows: [{ line: 1, refNo: "CB-482", name: "Chandra Kanthi", phone: "0774086201", details: null, cells: ["12.300", "22,000 (Bank)", "", ""] }], totals: { received: "22,000", given: "", oldGold: "" } }));
    const v = await ok<View & { scan: unknown }>(await upload([{ bytes: JPEG, type: "image/jpeg" }], { branchId: "b1", date: today }));
    expect(v.rows.map((r) => [r.name, r.phone, r.receivedMethod])).toEqual([["Chandra Kanthi", "0774086201", "bank"]]);
    expect(v.sheet?.imageCount).toBe(1);
    expect(store.size).toBe(1);
  });

  it("refuses a viewer, a bad file, a future day and a closed day", async () => {
    expect((await upload([{ bytes: JPEG, type: "image/jpeg" }], { branchId: "b1", date: today }, viewer)).status).toBe(403);
    expect((await upload([{ bytes: JPEG, type: "image/gif", name: "sheet.gif" }], { branchId: "b1", date: today })).status).toBe(400);
    expect((await upload([], { branchId: "b1", date: today })).status).toBe(400);
    expect((await upload([{ bytes: JPEG, type: "image/jpeg" }], { branchId: "b1", date: addDays(today, 3) })).status).toBe(400);

    const yesterday = addDays(today, -1);
    raw.exec(
      `INSERT INTO day_closings (id, branch_id, close_date, opening_cents, cash_in_cents, cash_out_cents, expected_cents, actual_cents, difference_cents, report_json, checks_passed, status, closed_by, closed_at, created_at)
       VALUES ('closed-y','b1','${yesterday}',0,0,0,0,0,0,'{}',1,'CLOSED','u1',1,1)`
    );
    expect((await upload([{ bytes: JPEG, type: "image/jpeg" }], { branchId: "b1", date: yesterday })).status).toBe(409);
    expect(script.length).toBe(0);
  });

  it("says so when the reader fails or cannot read the page, and keeps nothing", async () => {
    const before = store.size;
    script.push(() => {
      throw new Error("upstream timeout");
    });
    const down = await upload([{ bytes: JPEG, type: "image/jpeg" }], { branchId: "b1", date: addDays(today, -2) });
    expect(down.status).toBe(503);
    expect(((await down.json()) as { error: { message: string } }).error.message).toMatch(/not responding/);

    script.push(() => ({ choices: [{ message: { content: "I am sorry, I cannot read this image." } }] }));
    const unreadable = await upload([{ bytes: JPEG, type: "image/jpeg" }], { branchId: "b1", date: addDays(today, -2) });
    expect(unreadable.status).toBe(503);
    expect(((await unreadable.json()) as { error: { message: string } }).error.message).toMatch(/did not return a readable answer/);
    expect(store.size).toBe(before);
  });
});
