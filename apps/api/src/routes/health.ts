import { Hono } from "hono";
import type { Env } from "../db/client";

export const health = new Hono<{ Bindings: Env }>().get("/", (c) =>
  c.json({ success: true, data: { ok: true, service: "goldos-api" } })
);
