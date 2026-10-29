// The sale bill reader without the model: the reply is validated, and the
// photo is re-read when the lines do not add up to the written total.
import { describe, expect, it } from "vitest";
import type { Env } from "../db/client";
import { billPayMethod, billPhone, billWeightMg, interpretSaleBill, scanSaleBill } from "./salebill-scan";

const reply = (obj: unknown) => ({ choices: [{ message: { content: "```json\n" + JSON.stringify(obj) + "\n```" } }] });
const image = { bytes: new Uint8Array([1, 2, 3]), type: "image/jpeg" };

/** The bill in the photo the feature was built from (book no. 148). */
const riswan = {
  customer: { name: "Riswan", place: "Marawa", phone: "0776328343" },
  date: "2026-10-29",
  billNo: "148",
  lines: [
    { ref: "New", description: "Lotust chain", weight: "12x130", amount: "546000" },
    { ref: "815", description: "Turky Bangle", weight: "6x590", amount: "313000" },
    { ref: "u/P", description: "Necklas", weight: "8x110", amount: "365000" },
    { ref: "1057", description: "Turky Pendent", weight: "4x150", amount: "211000" },
    { ref: "3689", description: "Turky K/R", weight: "4x080", amount: "196000" },
    { ref: "New", description: "Lotust Bracelats", weight: "3x750", amount: "173000" },
    { ref: "New", description: "Turky Ring", weight: "1x150", amount: "69000" },
  ],
  total: "1873000",
  payments: [
    { label: "Cash", amount: "1000000" },
    { label: "Carl", amount: "870000" },
  ],
  balance: "3000",
};

describe("billWeightMg", () => {
  it("reads the x the counter writes for the decimal point", () => {
    expect(billWeightMg("12x130")).toBe(12_130);
    expect(billWeightMg("4x080")).toBe(4_080);
    expect(billWeightMg("1 x 150")).toBe(1_150);
    expect(billWeightMg("12.130g")).toBe(12_130);
    expect(billWeightMg(8.11)).toBe(8_110);
  });
  it("refuses what is not a weight", () => {
    expect(billWeightMg("abc")).toBeNull();
    expect(billWeightMg("")).toBeNull();
    expect(billWeightMg("99999")).toBeNull();
  });
});

describe("billPayMethod and billPhone", () => {
  it("maps the bill's labels", () => {
    expect(billPayMethod("Cash")).toBe("cash");
    expect(billPayMethod("Card")).toBe("card");
    expect(billPayMethod("Carl")).toBe("card");
    expect(billPayMethod("B/L")).toBe("credit");
    expect(billPayMethod("A/C")).toBe("credit");
    expect(billPayMethod("Chq")).toBe("cheque");
    expect(billPayMethod("Bank")).toBe("bank");
    expect(billPayMethod("??")).toBeNull();
  });
  it("normalises a phone", () => {
    expect(billPhone("+94 77 632 8343")).toBe("0776328343");
    expect(billPhone("077-632-8343")).toBe("0776328343");
    expect(billPhone("63283")).toBeNull();
  });
});

describe("interpretSaleBill", () => {
  it("reads the sample bill: lines, New pieces, payments and the B/L on credit", () => {
    const out = interpretSaleBill(riswan, "2026-10-29", "m");
    expect(out.warnings).toEqual([]);
    expect(out.customer).toEqual({ name: "Riswan", place: "Marawa", phone: "0776328343" });
    expect(out.billNo).toBe("148");
    expect(out.totalCents).toBe(187_300_000);
    expect(out.lines).toHaveLength(7);
    expect(out.lines[0]).toMatchObject({ ref: null, fromOldGold: true, weightMg: 12_130, amountCents: 54_600_000 });
    expect(out.lines[1]).toMatchObject({ ref: "815", fromOldGold: false, weightMg: 6_590 });
    expect(out.payments).toEqual([
      { method: "cash", amountCents: 100_000_000, label: "Cash" },
      { method: "card", amountCents: 87_000_000, label: "Carl" },
      { method: "credit", amountCents: 300_000, label: "B/L" },
    ]);
  });

  it("warns when the lines miss the total, the payments miss the total, or a line's rate is off", () => {
    const bad = {
      ...riswan,
      lines: riswan.lines.map((l, i) => (i === 1 ? { ...l, weight: "0x590" } : l)),
      payments: [{ label: "Cash", amount: "1000000" }],
      balance: "",
    };
    const out = interpretSaleBill(bad, "2026-10-29", "m");
    expect(out.warnings.some((w) => w.startsWith("Line 2:") && w.includes("price per gram"))).toBe(true);
    expect(out.warnings.some((w) => w.includes("payments add up to 1,000,000"))).toBe(true);
    const short = interpretSaleBill({ ...riswan, total: "1900000" }, "2026-10-29", "m");
    expect(short.warnings.some((w) => w.includes("add up to 1,873,000"))).toBe(true);
  });

  it("takes a year read years off (2006 for 2026) as this year", () => {
    expect(interpretSaleBill({ ...riswan, date: "2006-10-29" }, "2026-10-29", "m").date).toBe("2026-10-29");
  });

  it("says the sale posts today when the bill is from another day", () => {
    const out = interpretSaleBill(riswan, "2026-10-30", "m");
    expect(out.warnings).toContain("The bill is dated 2026-10-29; the sale will be recorded today, 2026-10-30.");
  });
});

describe("scanSaleBill", () => {
  it("re-reads when a line's price per gram is off, and keeps the reading with fewer doubts", async () => {
    const misread = { ...riswan, lines: riswan.lines.map((l, i) => (i === 3 ? { ...l, weight: "11x150" } : l)) };
    const replies = [reply(misread), reply(riswan)];
    const prompts: string[] = [];
    const env = {
      AI: {
        run: async (_m: string, inputs: { messages: { content: unknown }[] }) => {
          const user = inputs.messages[1]!.content as { type: string; text?: string }[];
          prompts.push(user.find((p) => p.type === "text")!.text!);
          return replies.shift();
        },
      },
    } as unknown as Env;
    const out = await scanSaleBill(env, image, "2026-10-29");
    expect(prompts[1]).toContain("line 4 (11x150 for 211000)");
    expect(out.lines[3]!.weightMg).toBe(4_150);
    expect(out.warnings).toEqual([]);
  });

  it("re-reads once when the lines miss the total, and keeps the reading that adds up", async () => {
    const replies = [reply({ ...riswan, lines: riswan.lines.slice(1) }), reply(riswan)];
    const prompts: string[] = [];
    const env = {
      AI: {
        run: async (_m: string, inputs: { messages: { content: unknown }[] }) => {
          const user = inputs.messages[1]!.content as { type: string; text?: string }[];
          prompts.push(user.find((p) => p.type === "text")!.text!);
          return replies.shift();
        },
      },
    } as unknown as Env;
    const out = await scanSaleBill(env, image, "2026-10-29");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("the total written is 1,873,000");
    expect(out.lines).toHaveLength(7);
  });
});
