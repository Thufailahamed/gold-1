import type { Context } from "hono";

export function errorHandler(err: Error, c: Context) {
  console.error(err);
  return c.json(
    { success: false, error: { code: "INTERNAL", message: "Something went wrong" } },
    500
  );
}
