import type { Context } from "hono";

export function errorHandler(err: Error, c: Context) {
  // The day-lock trigger (migration 0044) aborts any posting that would land
  // on a closed day, even one that raced past the service-level check. That is
  // a refusal, not a crash.
  if (/DAY_CLOSED/.test(err?.message ?? ""))
    return c.json(
      {
        success: false,
        error: { code: "TRANSITION_LOCKED", message: "That day was just closed at this branch — nothing was saved. Refresh and try again." },
      },
      409
    );
  console.error(err);
  return c.json(
    { success: false, error: { code: "INTERNAL", message: "Something went wrong" } },
    500
  );
}
