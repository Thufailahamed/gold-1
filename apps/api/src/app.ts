import { Hono } from "hono";
import type { Env } from "./db/client";
import { errorHandler } from "./middleware/error";
import { audit } from "./routes/audit";
import { auth } from "./routes/auth";
import { branches } from "./routes/branches";
import { health } from "./routes/health";
import { roles } from "./routes/roles";
import { settings } from "./routes/settings";
import { users } from "./routes/users";

const app = new Hono<{ Bindings: Env }>();
app.onError(errorHandler);
app.route("/api/v1/health", health);
app.route("/api/v1/auth", auth);
app.route("/api/v1/users", users);
app.route("/api/v1/roles", roles);
app.route("/api/v1/branches", branches);
app.route("/api/v1/settings", settings);
app.route("/api/v1/audit", audit);

export default app;
