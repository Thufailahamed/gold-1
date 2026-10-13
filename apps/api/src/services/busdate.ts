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

/**
 * The shop's UTC offset as an SQLite date modifier ("330 minutes"), read from
 * the same setting as tzOffsetMinutes so SQL day boundaries and JS business
 * dates can never disagree. Uncorrelated, so SQLite evaluates it once per
 * statement. A non-numeric setting falls back to the default, as in JS.
 *
 * Migration 0045 inlines this same expression in its day-lock trigger.
 */
export const TZ_MODIFIER_SQL = `(COALESCE((SELECT CAST(value_json AS INTEGER) FROM settings WHERE key = 'business_tz_offset_minutes' AND json_type(value_json) IN ('integer', 'real')), ${DEFAULT_OFFSET_MINUTES}) || ' minutes')`;

/** The shop-local business date (YYYY-MM-DD) of an epoch-ms column. */
export const LOCAL_DAY = (col: string) => `date(${col} / 1000, 'unixepoch', ${TZ_MODIFIER_SQL})`;
