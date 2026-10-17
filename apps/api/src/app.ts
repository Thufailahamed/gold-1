import { Hono } from "hono";
import type { Env } from "./db/client";
import { errorHandler } from "./middleware/error";
import { cors } from "./middleware/cors";
import { csrf } from "./middleware/csrf";
import { idempotency, purgeIdempotencyKeys } from "./middleware/idempotency";
import { accounts } from "./routes/accounts";
import { audit } from "./routes/audit";
import { assistant } from "./routes/assistant";
import { bindAssistantDispatch } from "./assistant/actions";
import { maybeRunBrief } from "./ai/brief";
import { auth } from "./routes/auth";
import { branches } from "./routes/branches";
import { bankAccounts, cash, settlements } from "./routes/cashbank";
import { catalog } from "./routes/catalog";
import { dayClosings } from "./routes/dayclose";
import { gold } from "./routes/gold";
import { expenseCategories, expenses } from "./routes/expenses";
import { health } from "./routes/health";
import { manufacturing } from "./routes/manufacturing";
import { market } from "./routes/market";
import { marketDesk } from "./routes/marketDesk";
import { evaluateAlerts } from "./services/market-desk";
import { recordMarketSnapshot } from "./services/market";
import { melting } from "./routes/melting";
import { monthly } from "./routes/monthly";
import { counts } from "./routes/counts";
import { stockTransferRoutes } from "./routes/transfers";
import { discrepancies } from "./routes/discrepancies";
import { overview } from "./routes/overview";
import { repairRoutes } from "./routes/repairs";
import { customOrderRoutes } from "./routes/customOrders";
import { customers, suppliers } from "./routes/parties";
import { inventory } from "./routes/inventory";
import { oldgold } from "./routes/oldgold";
import { products } from "./routes/products";
import { purchases } from "./routes/purchases";
import { sales } from "./routes/sales";
import { rates } from "./routes/rates";
import { receipts } from "./routes/receipts";
import { billingReceipts } from "./routes/billing-receipts";
import { roles } from "./routes/roles";
import { settings } from "./routes/settings";
import { users } from "./routes/users";
import { platform, platformScheduled } from "./platform";
import { enforcePlanLimit, platformBridge, tenantGate } from "./platform/bridge";
import { resolveTenant } from "./platform/resolve";
import { createPublicRoutes } from "./routes/public";
import { enforceStorageLimit } from "./services/shopStorage";
import { provisionShop } from "./platform/provision";

const app = new Hono<{ Bindings: Env }>();
app.onError(errorHandler);
app.use("/api/*", cors);
app.use("/api/*", csrf);
app.use("/platform/*", cors);
app.use("/platform/*", csrf);
// Control plane: the SaaS operator's admin portal API.
app.route("/platform/v1", platform);
// Public self-serve: mounted before the tenant scope so signup, plans and
// provisioning status never need a workspace.
app.route("/api/v1/public", createPublicRoutes({ provision: provisionShop }));
// Data plane: every shop request is scoped to its workspace first, then gated.
app.use("/api/v1/*", resolveTenant);
app.use("/api/v1/*", tenantGate);
app.use("/api/v1/*", idempotency);
app.route("/api/v1/platform", platformBridge);
app.post("/api/v1/users", enforcePlanLimit("users"));
app.patch("/api/v1/users/:id/activate", enforcePlanLimit("users"));
app.post("/api/v1/branches", enforcePlanLimit("branches"));
app.post("/api/v1/products", enforcePlanLimit("products"));
app.post("/api/v1/products/:id/images", enforceStorageLimit);
app.post("/api/v1/oldgold/items/:id/files", enforceStorageLimit);
app.post("/api/v1/expenses/:id/receipt", enforceStorageLimit);
app.route("/api/v1/health", health);
app.route("/api/v1/auth", auth);
app.route("/api/v1/users", users);
app.route("/api/v1/roles", roles);
app.route("/api/v1/branches", branches);
app.route("/api/v1/settings", settings);
app.route("/api/v1/audit", audit);
app.route("/api/v1/masters", catalog);
app.route("/api/v1/gold-rates", rates);
app.route("/api/v1/market", market);
app.route("/api/v1/market-desk", marketDesk);
app.route("/api/v1/suppliers", suppliers);
app.route("/api/v1/customers", customers);
app.route("/api/v1/products", products);
app.route("/api/v1/inventory", inventory);
app.route("/api/v1/manufacturing", manufacturing);
app.route("/api/v1/gold", gold);
app.route("/api/v1/melting", melting);
app.route("/api/v1/oldgold", oldgold);
app.route("/api/v1/accounts", accounts);
app.route("/api/v1/expense-categories", expenseCategories);
app.route("/api/v1/expenses", expenses);
app.route("/api/v1/day-closings", dayClosings);
app.route("/api/v1/bank-accounts", bankAccounts);
app.route("/api/v1/cash", cash);
app.route("/api/v1/card-settlements", settlements);
app.route("/api/v1/receipts", receipts);
app.route("/api/v1/billing", billingReceipts);
app.route("/api/v1/purchases", purchases);
app.route("/api/v1/sales", sales);
app.route("/api/v1/reports", monthly);
app.route("/api/v1/counts", counts);
app.route("/api/v1/transfers", stockTransferRoutes);
app.route("/api/v1/discrepancies", discrepancies);
app.route("/api/v1/branch-overview", overview);
app.route("/api/v1/repairs", repairRoutes);
app.route("/api/v1/custom-orders", customOrderRoutes);
app.route("/api/v1/assistant", assistant);
// A confirmed assistant action is replayed through this same app, so it
// passes every gate a direct request would.
bindAssistantDispatch(async (req, env) => app.fetch(req, env));

export default {
  fetch: app.fetch,
  scheduled: (event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(platformScheduled(event, env));
    ctx.waitUntil(purgeIdempotencyKeys(env.DB));
    // Hourly tick: writes the day's brief once the shop-local hour is reached.
    ctx.waitUntil(maybeRunBrief(env).catch((e) => console.error("daily brief failed", e)));
    // Market reference prices: the free feed keeps no history, so we do.
    // Price alerts are checked after the snapshot so they read fresh quotes.
    ctx.waitUntil(
      recordMarketSnapshot(env.DB)
        .catch((e) => console.error("market snapshot failed", e))
        .then(() => evaluateAlerts(env.DB, undefined, { force: true }))
        .catch((e) => console.error("market alerts failed", e))
    );
  },
};

export { app };
export { ShopDatabase } from "./db/shop-do";
