// The sale bill reader against the real vision model. It spends Workers AI
// quota and needs `wrangler login`, so it runs only when asked:
//   SALEBILL_LIVE=1 npx vitest run src/ai/salebill-scan.live.test.ts
// The fixture (fixtures/salebill-sample.webp) is a photo of bill-book no. 148.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Env } from "../db/client";
import { scanSaleBill } from "./salebill-scan";

// 29/10/2026, Riswan, Marawa, 0776328343. Lines (ref · item · weight · amount):
// New Lotust chain 12x130 546000; 815 Turky Bangle 6x590 313000; u/P Necklas
// 8x110 365000; 1057 Turky Pendent 4x150 211000; 3689 Turky K/R 4x080 196000;
// New Lotust Bracelats 3x750 173000; New Turky Ring 1x150 69000.
// Total 1,873,000; Cash 1,000,000; Card 870,000; B/L 3,000.
const WANT = [
  { fromOldGold: true, weightMg: 12_130, amountCents: 54_600_000 },
  { fromOldGold: false, ref: "815", weightMg: 6_590, amountCents: 31_300_000 },
  { fromOldGold: false, weightMg: 8_110, amountCents: 36_500_000 },
  { fromOldGold: false, ref: "1057", weightMg: 4_150, amountCents: 21_100_000 },
  { fromOldGold: false, ref: "3689", weightMg: 4_080, amountCents: 19_600_000 },
  { fromOldGold: true, weightMg: 3_750, amountCents: 17_300_000 },
  { fromOldGold: true, weightMg: 1_150, amountCents: 6_900_000 },
];

describe.skipIf(process.env.SALEBILL_LIVE !== "1")("sale bill reader against the live model", () => {
  it("reads the sample bill: customer, every line, the total and the payments", async () => {
    const { getPlatformProxy } = createRequire(import.meta.url)("wrangler");
    const proxy = await getPlatformProxy({ configPath: fileURLToPath(new URL("../../wrangler.toml", import.meta.url)), persist: false });
    try {
      // SALEBILL_VISION_MODEL picks another model to compare.
      const env = { AI: proxy.env.AI, AI_GATEWAY_ID: "default", SALEBILL_VISION_MODEL: process.env.SALEBILL_VISION_MODEL } as unknown as Env;
      const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL("./fixtures/salebill-sample.webp", import.meta.url))));
      const bill = await scanSaleBill(env, { bytes, type: "image/webp" }, "2026-10-29");

      expect(bill.date).toBe("2026-10-29");
      expect(bill.customer.phone).toBe("0776328343");
      expect(bill.customer.name?.toLowerCase()).toContain("riswan");
      expect(bill.totalCents).toBe(187_300_000);
      expect(bill.lines).toHaveLength(7);
      // Every amount and every "New" mark must be right.
      WANT.forEach((w, i) => expect(bill.lines[i], `line ${i + 1}`).toMatchObject({ fromOldGold: w.fromOldGold, amountCents: w.amountCents }));
      // Handwritten weights are harder (Mistral Small reads 6x590 as 8x590, 4x150 as 11x150, 4x080 as
      // 4x060 on this photo); the till sees them next to the matched piece's weight. Keep at least 4 of 7.
      const weights = WANT.filter((w, i) => bill.lines[i]!.weightMg === w.weightMg).length;
      expect(weights).toBeGreaterThanOrEqual(4);
      expect(bill.payments).toEqual([
        expect.objectContaining({ method: "cash", amountCents: 100_000_000 }),
        expect.objectContaining({ method: "card", amountCents: 87_000_000 }),
        expect.objectContaining({ method: "credit", amountCents: 300_000 }),
      ]);
      // A misread weight shows up as a price-per-gram warning; nothing else should.
      expect(bill.warnings.filter((w) => !w.includes("price per gram"))).toEqual([]);
    } finally {
      await proxy.dispose();
    }
  }, 300_000);
});
