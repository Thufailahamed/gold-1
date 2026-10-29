// The day sheet reader against the real vision model. It spends Workers AI
// quota and needs `wrangler login`, so it runs only when asked:
//   DAYSHEET_LIVE=1 npx vitest run src/ai/daysheet-scan.live.test.ts
// The fixture is a synthetic sheet (fixtures/daysheet-sample.jpg) written
// with the lines in the comments below.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Env } from "../db/client";
import { scanDaySheet } from "./daysheet-scan";

// Date 28/10/2026. Rows: CB-481 Ansar 8.450 g, 58,000 received, 36,000 old gold;
// CB-482 Chandra Kanthi 0774086201 12.300 g, 22,000 received (Bank); Gayan
// Arunayake 100,000 given (Bank); Rasla 4,000 received, 53,000 old gold; Wifi
// adaptor 1,300 given; CB-45 Shakir 0712223334 10,000 received (Card).
// TOTAL: 94,000 received, 101,300 given, 89,000 old gold.
describe.skipIf(process.env.DAYSHEET_LIVE !== "1")("day sheet reader against the live model", () => {
  it("reads the sample sheet line by line, and its printed totals agree", async () => {
    const { getPlatformProxy } = createRequire(import.meta.url)("wrangler");
    const proxy = await getPlatformProxy({ configPath: fileURLToPath(new URL("../../wrangler.toml", import.meta.url)), persist: false });
    try {
      const env = { AI: proxy.env.AI, AI_GATEWAY_ID: "default" } as unknown as Env;
      const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL("./fixtures/daysheet-sample.jpg", import.meta.url))));
      const scan = await scanDaySheet(env, [{ bytes, type: "image/jpeg" }], "2026-10-28");

      expect(scan.date).toBe("2026-10-28");
      expect(scan.rows).toHaveLength(6);
      const [ansar, chandra, gayan, rasla, wifi, shakir] = [0, 1, 2, 3, 4, 5].map((i) => scan.rows[i]!);
      expect(ansar).toMatchObject({ refNo: "CB-481", goldMg: 8450, receivedCents: 5_800_000, oldGoldCents: 3_600_000 });
      expect(chandra).toMatchObject({ refNo: "CB-482", phone: "0774086201", goldMg: 12_300, receivedCents: 2_200_000, receivedMethod: "bank" });
      expect(gayan).toMatchObject({ givenCents: 10_000_000, givenMethod: "bank" });
      expect(rasla).toMatchObject({ receivedCents: 400_000, oldGoldCents: 5_300_000 });
      expect(wifi).toMatchObject({ givenCents: 130_000, givenMethod: "cash" });
      // Handwritten digits can be misread (a 2 for a 3); the person checking the draft corrects them.
      expect(shakir).toMatchObject({ refNo: "CB-45", receivedCents: 1_000_000, receivedMethod: "card" });
      expect(shakir!.phone).toMatch(/^07\d{8}$/);
      // Every column's printed total is 94,000 / 101,300 / 89,000: the lines must add up to them.
      expect(scan.warnings.filter((w) => w.includes("total"))).toEqual([]);
    } finally {
      await proxy.dispose();
    }
  }, 300_000);
});
