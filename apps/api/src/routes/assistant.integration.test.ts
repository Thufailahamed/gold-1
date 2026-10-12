// The accounts assistant over the real app and real SQLite, with a scripted
// model standing in for Workers AI: the tools read real ledger figures, a
// proposal posts nothing until confirmed, and a confirm goes through the
// real route exactly once.
import { businessDate } from "@goldos/shared";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "../services/sqlite-test-db";

type Inputs = { messages: { role: string; content: string; name?: string }[]; tools: { function: { name: string } }[] };
type Step = (inputs: Inputs) => unknown;

describe.skipIf(!sqliteAvailable)("accounts assistant over real SQLite", () => {
  let raw: SqliteDb;
  let env: Record<string, unknown>;
  let app: (typeof import("../app"))["app"];
  const PASSWORD = "correct-horse-1";
  const script: Step[] = [];
  const calls: { model: string; inputs: Inputs }[] = [];
  const sessions: Record<string, string> = {};
  let n = 0;

  const toolCall = (name: string, args: Record<string, unknown>) => ({
    choices: [{ message: { content: "", tool_calls: [{ id: `c${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
  const text = (t: string) => ({ choices: [{ message: { content: t } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  const lastTool = (i: Inputs) => [...i.messages].reverse().find((m) => m.role === "tool")?.content ?? "";

  const req = (user: string, path: string, init: { method?: string; body?: unknown } = {}) =>
    app.request(
      path,
      {
        method: init.method ?? "GET",
        headers: { "Content-Type": "application/json", cookie: `session=${sessions[user]}` },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      },
      env
    );
  const ask = async (user: string, message: string, conversationId?: string) => {
    const res = await req(user, "/api/v1/assistant/chat", { method: "POST", body: { message, conversationId, branchId: "b1" } });
    return { status: res.status, body: (await res.json()) as { success: boolean; data: Record<string, unknown> & { actions: { id: string; status: string; lines: string[]; messageId: string }[] }; error?: { code: string } } };
  };
  const cashAt = (branch: string) =>
    (raw
      .prepare(
        "SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS n FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_code = '1000' AND e.branch_id = ?"
      )
      .get(branch) as { n: number }).n;
  const entryCount = () => (raw.prepare("SELECT COUNT(*) AS n FROM journal_entries").get() as { n: number }).n;

  beforeAll(async () => {
    const m = migratedDb();
    raw = m.raw;
    env = {
      DB: m.db,
      R2: {} as R2Bucket,
      WEB_ORIGIN: "http://localhost:3000",
      AI_GATEWAY_ID: "test-gateway",
      AI: {
        run: async (model: string, inputs: Inputs) => {
          calls.push({ model, inputs });
          const step = script.shift();
          if (!step) throw new Error("model called with no scripted step");
          return step(inputs);
        },
      },
    };
    const { hashPassword } = await import("../services/hash");
    const hash = await hashPassword(PASSWORD);
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES
        ('u1','owner@shop.lk','Owner','${hash}',0,0),
        ('u2','sales@shop.lk','Sales','${hash}',0,0),
        ('u3','viewer@shop.lk','Viewer','${hash}',0,0);
      INSERT INTO roles (id, name) VALUES ('books_viewer', 'books_viewer');
      INSERT INTO role_permissions (role_id, permission_id) VALUES ('books_viewer', 'accounts:view');
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner'), ('u2','salesperson'), ('u3','books_viewer');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0), ('b2','City','CITY',0);
      INSERT INTO branch_members (user_id, branch_id) VALUES ('u1','b1'), ('u2','b1'), ('u3','b2');
    `);
    ({ app } = await import("../app"));
    for (const [u, email] of [["u1", "owner@shop.lk"], ["u2", "sales@shop.lk"], ["u3", "viewer@shop.lk"]] as const) {
      const res = await app.request(
        "/api/v1/auth/login",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) },
        env
      );
      sessions[u] = res.headers.get("set-cookie")?.match(/session=([^;]+)/)?.[1] ?? "";
    }
    // The owner puts LKR 100,000.00 into the Main drawer through the real route.
    const put = await req("u1", "/api/v1/cash/entries", {
      method: "POST",
      body: { branchId: "b1", kind: "OWNER_CAPITAL", amountCents: 10_000_000, method: "cash", note: "Opening float" },
    });
    expect(put.status).toBeLessThan(300);
  });

  beforeEach(() => {
    script.length = 0;
    calls.length = 0;
  });

  it("answers from the ledger, with today's shop date in the prompt and figures pre-formatted", async () => {
    script.push(
      () => toolCall("cash_position", { branch: "Main" }),
      (i) => {
        expect(lastTool(i)).toContain('"cashInHand_lkr":"LKR 100,000.00"');
        return text("Main has **LKR 100,000.00** in the drawer.");
      }
    );
    const { status, body } = await ask("u1", "How much cash is at Main?");
    expect(status).toBe(200);
    expect(body.data.reply).toBe("Main has **LKR 100,000.00** in the drawer.");
    expect(body.data.toolsUsed).toEqual(["cash_position"]);

    const first = calls[0]?.inputs;
    const system = first?.messages[0]?.content ?? "";
    expect(system).toContain(businessDate(Date.now(), 330));
    expect(system).toContain("Financial year");
    expect(first?.tools.map((t) => t.function.name)).toEqual(expect.arrayContaining(["trial_balance", "propose_cash_entry", "calculate"]));
    expect(calls.every((c) => c.model === "@cf/zai-org/glm-5.3-flash")).toBe(true);
  });

  it("keeps the conversation: a follow-up sees the earlier turn", async () => {
    script.push(() => toolCall("trial_balance", {}), () => text("The books balance."));
    const first = await ask("u1", "Do the books balance?");
    const conversationId = first.body.data.conversationId as string;
    script.push((i) => {
      expect(i.messages.some((m) => m.role === "user" && m.content === "Do the books balance?")).toBe(true);
      expect(i.messages.some((m) => m.role === "tool" && m.name === "trial_balance")).toBe(true);
      return text("Yes, as I said.");
    });
    const second = await ask("u1", "Are you sure?", conversationId);
    expect(second.body.data.conversationId).toBe(conversationId);
    expect(second.body.data.reply).toBe("Yes, as I said.");

    // Tools are attributed per turn: the second answer used none.
    const conv = await req("u1", `/api/v1/assistant/conversations/${conversationId}`);
    const msgs = ((await conv.json()) as { data: { messages: { role: string; tools?: string[] }[] } }).data.messages;
    expect(msgs.map((m) => [m.role, m.tools])).toEqual([
      ["user", undefined],
      ["assistant", ["trial_balance"]],
      ["user", undefined],
      ["assistant", []],
    ]);
  });

  it("proposes a posting, posts nothing until confirmed, then posts it exactly once", async () => {
    const before = entryCount();
    script.push(
      () => toolCall("propose_cash_entry", { kind: "OWNER_DRAWING", amountLkr: 2500, method: "cash", note: "Personal use", branch: "Main" }),
      (i) => {
        expect(lastTool(i)).toContain("awaiting_user_confirmation");
        return text("I've prepared it — please review and confirm.");
      }
    );
    const { body } = await ask("u1", "The owner took 2,500 out of the Main drawer");
    const action = body.data.actions[0];
    expect(action?.status).toBe("PENDING");
    expect(action?.lines).toEqual(expect.arrayContaining(["Amount: LKR 2,500.00", "Branch: Main"]));
    expect(action?.messageId).toBe(body.data.messageId);
    expect(entryCount()).toBe(before);
    expect(cashAt("b1")).toBe(10_000_000);

    const ok = await req("u1", `/api/v1/assistant/actions/${action?.id}/confirm`, { method: "POST" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ data: { status: "DONE" } });
    expect(entryCount()).toBe(before + 1);
    expect(cashAt("b1")).toBe(10_000_000 - 250_000);

    const again = await req("u1", `/api/v1/assistant/actions/${action?.id}/confirm`, { method: "POST" });
    expect(again.status).toBe(409);
    expect(entryCount()).toBe(before + 1);

    // The conversation shows the question, the answer and the card under that answer.
    const conv = await req("u1", `/api/v1/assistant/conversations/${body.data.conversationId}`);
    const data = ((await conv.json()) as { data: { messages: { role: string; content: string; tools?: string[] }[]; actions: { status: string }[] } }).data;
    expect(data.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    // Each answer lists the tools its own turn used; the confirm note stays hidden.
    expect(data.messages[1]?.tools).toEqual(["propose_cash_entry"]);
    expect(data.actions[0]?.status).toBe("DONE");
  });

  it("keeps the turn when a confirm note lands in the conversation mid-turn", async () => {
    script.push(() => text("First."));
    const conversationId = (await ask("u1", "hi")).body.data.conversationId as string;
    script.push(
      () => {
        // What confirmAction's note does while this turn is still running.
        raw
          .prepare(
            "INSERT INTO assistant_messages (id, conversation_id, seq, role, content, created_at) VALUES ('note-1', ?, (SELECT MAX(seq) + 1 FROM assistant_messages WHERE conversation_id = ?), 'assistant', '[Confirmation card \"x\"] done', 0)"
          )
          .run(conversationId, conversationId);
        return toolCall("list_branches", {});
      },
      () => text("Second.")
    );
    const second = await ask("u1", "and now?", conversationId);
    expect(second.status).toBe(200);
    expect(second.body.data.reply).toBe("Second.");
  });

  it("describes a large expense the way the route really posts it", async () => {
    script.push(
      () => toolCall("propose_expense", { category: "Utilities", amountLkr: 9_000_000, description: "Generator", paidFrom: "cash", branch: "Main" }),
      () => text("Ready.")
    );
    const a = (await ask("u1", "Record a 9m generator expense")).body.data.actions[0];
    // The expenses route posts at once whatever the amount; the card used to
    // promise it would wait for approval.
    expect(a?.lines.join(" ")).not.toMatch(/approval/i);
    const before = entryCount();
    const res = await req("u1", `/api/v1/assistant/actions/${a?.id}/confirm`, { method: "POST" });
    expect(await res.json()).toMatchObject({ data: { status: "DONE" } });
    expect(entryCount()).toBe(before + 1);
  });

  it("passes the route's own refusal back instead of pretending it posted", async () => {
    script.push(
      () => toolCall("propose_cash_entry", { kind: "OWNER_DRAWING", amountLkr: 10, method: "cash", note: "x", branch: "Main" }),
      () => text("Ready to confirm.")
    );
    const { body } = await ask("u1", "Take 10 out");
    const id = body.data.actions[0]?.id;
    // Close the day underneath the pending card: the route must refuse the posting.
    raw.exec(`INSERT INTO day_closings (id, branch_id, close_date, opening_cents, cash_in_cents, cash_out_cents, expected_cents, actual_cents, difference_cents, report_json, checks_passed, status, closed_by, closed_at, created_at)
              VALUES ('dc1', 'b1', '${businessDate(Date.now(), 330)}', 0, 0, 0, 0, 0, 0, '{}', 1, 'CLOSED', 'u1', 0, 0)`);
    const before = entryCount();
    const res = await req("u1", `/api/v1/assistant/actions/${id}/confirm`, { method: "POST" });
    const out = (await res.json()) as { data: { status: string; result: { message: string } } };
    expect(out.data.status).toBe("FAILED");
    expect(out.data.result.message).toMatch(/closed/i);
    expect(entryCount()).toBe(before);
    raw.exec("DELETE FROM day_closings WHERE id = 'dc1'");
  });

  it("cancels, and refuses an expired card", async () => {
    script.push(() => toolCall("propose_cash_entry", { kind: "OTHER_INCOME", amountLkr: 100, method: "cash", note: "Scrap sale" }), () => text("Ready."));
    const a = (await ask("u1", "Record 100 other income")).body.data.actions[0];
    expect((await req("u1", `/api/v1/assistant/actions/${a?.id}/cancel`, { method: "POST" })).status).toBe(200);
    expect((await req("u1", `/api/v1/assistant/actions/${a?.id}/confirm`, { method: "POST" })).status).toBe(409);

    script.push(() => toolCall("propose_cash_entry", { kind: "OTHER_INCOME", amountLkr: 100, method: "cash", note: "Scrap sale" }), () => text("Ready."));
    const b = (await ask("u1", "Record 100 other income")).body.data.actions[0];
    raw.prepare("UPDATE assistant_actions SET expires_at = 1 WHERE id = ?").run(b?.id);
    const expired = await req("u1", `/api/v1/assistant/actions/${b?.id}/confirm`, { method: "POST" });
    expect(expired.status).toBe(409);
    expect(await expired.json()).toMatchObject({ error: { message: expect.stringMatching(/expired/) } });
  });

  it("never re-runs a confirm whose outcome is unknown; it says so instead", async () => {
    script.push(() => toolCall("propose_cash_entry", { kind: "OTHER_INCOME", amountLkr: 5, method: "cash", note: "x" }), () => text("Ready."));
    const { body } = await ask("u1", "Record 5 other income");
    const id = body.data.actions[0]?.id;
    raw.prepare("UPDATE assistant_actions SET status = 'RUNNING', decided_at = ? WHERE id = ?").run(Date.now() - 10 * 60_000, id);
    const conv = await req("u1", `/api/v1/assistant/conversations/${body.data.conversationId}`);
    const action = ((await conv.json()) as { data: { actions: { id: string; status: string; result: { code: string } }[] } }).data.actions.find((a) => a.id === id);
    expect(action).toMatchObject({ status: "FAILED", result: { code: "UNKNOWN" } });
    const before = entryCount();
    expect((await req("u1", `/api/v1/assistant/actions/${id}/confirm`, { method: "POST" })).status).toBe(409);
    expect(entryCount()).toBe(before);
  });

  it("returns bad arguments to the model to fix, and creates no card", async () => {
    script.push(
      () => toolCall("propose_cash_entry", { kind: "OWNER_DRAWING", amountLkr: -5, method: "cash", note: "x" }),
      (i) => {
        expect(lastTool(i)).toContain("Invalid arguments");
        expect(lastTool(i)).toContain("amountLkr");
        return text("The amount must be more than zero. How much was it?");
      }
    );
    const { body } = await ask("u1", "Owner took -5");
    expect(body.data.actions).toEqual([]);
  });

  it("only offers a read-only user read tools, limited to their own branch", async () => {
    script.push(
      (i) => {
        const names = i.tools.map((t) => t.function.name);
        expect(names).toContain("trial_balance");
        expect(names.some((x) => x.startsWith("propose_"))).toBe(false);
        expect(i.messages[0]?.content).toContain("cannot post");
        return toolCall("cash_position", { branch: "Main" });
      },
      (i) => {
        expect(lastTool(i)).toContain("No branch");
        return toolCall("propose_cash_entry", { kind: "OWNER_DRAWING", amountLkr: 1, method: "cash", note: "x", branch: "City" });
      },
      (i) => {
        expect(lastTool(i)).toContain("permission");
        return toolCall("cash_position", {});
      },
      (i) => {
        expect(lastTool(i)).toContain('"branch":"City"');
        expect(lastTool(i)).not.toContain("Main");
        return text("City only.");
      }
    );
    const { status, body } = await ask("u3", "Cash at Main?");
    expect(status).toBe(200);
    expect(body.data.actions).toEqual([]);
  });

  it("refuses a user without accounts access, and a card that belongs to someone else", async () => {
    expect((await ask("u2", "hello")).status).toBe(403);
    script.push(() => toolCall("propose_cash_entry", { kind: "OTHER_INCOME", amountLkr: 1, method: "cash", note: "x" }), () => text("Ready."));
    const a = (await ask("u1", "Record 1 other income")).body.data.actions[0];
    expect((await req("u3", `/api/v1/assistant/actions/${a?.id}/confirm`, { method: "POST" })).status).toBe(404);
  });

  it("stops a runaway tool loop and still answers", async () => {
    for (let i = 0; i < 8; i++) script.push(() => toolCall("list_branches", {}));
    script.push((i) => {
      // The forced final answer sends no tool list and no tool_choice at all.
      expect(i.tools).toBeUndefined();
      expect((i as unknown as Record<string, unknown>).tool_choice).toBeUndefined();
      return text("Here is what I found.");
    });
    const { body } = await ask("u1", "loop");
    expect(body.data.reply).toBe("Here is what I found.");
    expect(calls).toHaveLength(9);
  });

  it("reports an unavailable model as 503, not as an answer", async () => {
    script.push(
      () => {
        throw new Error("primary down");
      },
      () => {
        throw new Error("fallback down");
      }
    );
    const res = await ask("u1", "anything");
    expect(res.status).toBe(503);
    expect(res.body.error?.code).toBe("AI_UNAVAILABLE");
  });
});
