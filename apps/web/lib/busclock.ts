/**
 * The shop's business clock on the screen. Set from /auth/me (the server's
 * business_tz_offset_minutes setting) before any page renders, so "today" on
 * a screen is the same date the books and the day lock use. 330 (UTC+05:30)
 * only until the session has loaded.
 */
let offsetMinutes = 330;

export function setShopOffsetMinutes(m: number | undefined): void {
  if (typeof m === "number" && Number.isFinite(m)) offsetMinutes = m;
}

export const shopOffsetMs = (): number => offsetMinutes * 60_000;

/** Business "today" as YYYY-MM-DD. */
export const businessToday = (): string => new Date(Date.now() + shopOffsetMs()).toISOString().slice(0, 10);

/** Shop-local "YYYY-MM-DD HH:MM" for an epoch-ms time. */
export const shopDateTime = (ms: number): string => new Date(ms + shopOffsetMs()).toISOString().slice(0, 16).replace("T", " ");
