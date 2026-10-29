// The day sheet reader without the model: the reply is validated and
// re-read when the printed totals do not add up. The live model is checked
// by daysheet-scan.live.test.ts.
import { describe, expect, it } from "vitest";
import type { Env } from "../db/client";
import { interpretSheet, methodOf, moneyCents, scanDaySheet } from "./daysheet-scan";

const reply = (obj: unknown) => ({ choices: [{ message: { content: "```json\n" + JSON.stringify(obj) + "\n```" } }] });
const sheet = (rows: unknown[], totals: Record<string, string>) => ({ date: "2026-10-28", rows, totals });
const image = { bytes: new Uint8Array([1, 2, 3]), type: "image/jpeg" };

/** An Env whose model answers from a queue; every prompt it was sent is kept. */
function scriptedEnv(replies: (() => unknown)[]) {
  const prompts: string[] = [];
  const env = {
    AI: {
      run: async (_model: string, inputs: { messages: { content: unknown }[] }) => {
        const user = inputs.messages[1]!.content as { type: string; text?: string }[];
        prompts.push(user.find((p) => p.type === "text")!.text!);
        const next = replies.shift();
        if (!next) throw new Error("no scripted reply");
        return next();
      },
    },
  } as unknown as Env;
  return { env, prompts };
}

describe("interpretSheet", () => {
  it("lifts a phone written as +94 or with spaces, and takes it out of the name", () => {
    const out = interpretSheet(sheet([{ name: "Nimal Perera +94 77 408 6201", cells: ["", "5,000", "", ""] }], { received: "5,000" }), "2026-10-28", "m");
    expect(out.rows[0]).toMatchObject({ name: "Nimal Perera", phone: "0774086201", receivedCents: 500_000 });
    expect(out.warnings).toEqual([]);
  });

  it("reads the printed TOTAL by column name, so a TOTAL row without a gold cell is not shifted", () => {
    const out = interpretSheet(
      sheet([{ name: "Rasla", cells: ["", "4,000", "", "53,000"] }], { received: "4,000", given: "", oldGold: "53,000" }),
      "2026-10-28",
      "m"
    );
    expect(out.warnings).toEqual([]);
  });

  it("names the column whose total does not add up", () => {
    const out = interpretSheet(sheet([{ name: "Rasla", cells: ["", "4,000", "", ""] }], { received: "9,000" }), "2026-10-28", "m");
    expect(out.warnings).toEqual([expect.stringContaining("received total written on the sheet is 9,000, but the lines read add up to 4,000")]);
  });

  it("a note inside brackets sets the method; a bare letter in an amount does not", () => {
    expect(methodOf(null, "10,000 (card)")).toBe("card");
    expect(methodOf(null, "22,000 (Bank)")).toBe("bank");
    expect(moneyCents("100,000 (Bank)")).toBe(10_000_000);
  });
});

describe("scanDaySheet re-reads a photo whose totals do not add up", () => {
  const first = sheet(
    [
      { name: "Ansar", refNo: "CB-481", cells: ["8.450", "58,000", "", "36,000"] },
      { name: "Wifi adaptor", cells: ["", "", "", ""] },
    ],
    { received: "58,000", given: "1,300", oldGold: "36,000" }
  );
  const second = sheet(
    [
      { name: "Ansar", refNo: "CB-481", cells: ["8.450", "58,000", "", "36,000"] },
      { name: "Wifi adaptor", cells: ["", "", "1,300", ""] },
    ],
    { received: "58,000", given: "1,300", oldGold: "36,000" }
  );

  it("keeps the second reading when it fixes the gap, and shows the model what was wrong", async () => {
    const { env, prompts } = scriptedEnv([() => reply(first), () => reply(second)]);
    const out = await scanDaySheet(env, [image], "2026-10-28");
    expect(out.rows[1]).toMatchObject({ name: "Wifi adaptor", givenCents: 130_000 });
    expect(out.warnings).toEqual([]);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("the sheet prints 1,300, the lines add up to 0");
    expect(prompts[1]).toContain("First reading:");
  });

  it("keeps the first reading when the second has more gaps", async () => {
    const worse = sheet([{ name: "Ansar", refNo: "CB-481", cells: ["8.450", "580,000", "", "36,000"] }], { received: "58,000", given: "1,300", oldGold: "36,000" });
    const { env } = scriptedEnv([() => reply(first), () => reply(worse)]);
    const out = await scanDaySheet(env, [image], "2026-10-28");
    expect(out.rows).toHaveLength(2);
    expect(out.warnings).toEqual([expect.stringContaining("given total")]);
  });

  it("keeps the first reading when the second read fails", async () => {
    const { env } = scriptedEnv([() => reply(first), () => ({ choices: [{ message: { content: "sorry, no" } }] })]);
    const out = await scanDaySheet(env, [image], "2026-10-28");
    expect(out.rows).toHaveLength(2);
    expect(out.warnings.some((w) => w.includes("given total"))).toBe(true);
  });

  it("does not re-read a sheet whose totals agree", async () => {
    const { env, prompts } = scriptedEnv([() => reply(second)]);
    const out = await scanDaySheet(env, [image], "2026-10-28");
    expect(out.warnings).toEqual([]);
    expect(prompts).toHaveLength(1);
  });
});
