import { Hono } from "hono";
import type { Env } from "./db/client";
import { errorHandler } from "./middleware/error";
import { auth } from "./routes/auth";
import { health } from "./routes/health";

const app = new Hono<{ Bindings: Env }>();
app.onError(errorHandler);
app.route("/api/v1/health", health);
app.route("/api/v1/auth", auth);

export default app;
