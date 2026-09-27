import { createMiddleware } from "hono/factory";
import { hasPermission } from "@goldos/shared";
import type { Env } from "../db/client";
import type { AppVariables } from "./auth";

export const requirePerm = (perm: string) =>
  createMiddleware<{ Bindings: Env; Variables: AppVariables }>(async (c, next) => {
    const perms: string[] = c.get("permissions") ?? [];
    if (!hasPermission(perms, perm)) {
      return c.json(
        { success: false, error: { code: "FORBIDDEN", message: "Insufficient permission" } },
        403
      );
    }
    await next();
  });
