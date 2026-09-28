import { businessDate } from "@goldos/shared";
import { getSetting } from "./settings";

const DEFAULT_OFFSET_MINUTES = 330;

export async function tzOffsetMinutes(db: D1Database): Promise<number> {
  const s = await getSetting(db, "business_tz_offset_minutes");
  return typeof s?.value === "number" ? s.value : DEFAULT_OFFSET_MINUTES;
}

export async function businessDateFor(db: D1Database, epochMs: number): Promise<string> {
  return businessDate(epochMs, await tzOffsetMinutes(db));
}
