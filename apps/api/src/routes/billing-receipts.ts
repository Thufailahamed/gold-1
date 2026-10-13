import { Hono } from "hono";
import { receiptUploadSchema, RECEIPT_MAX_BYTES, RECEIPT_MIME } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { writeAudit } from "../middleware/audit";
import { getShopDb, getTenantId } from "../platform/resolve";
import { serviceError } from "./http";

type BillingEnv = { Bindings: Env; Variables: AppVariables };

function extOf(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "application/pdf") return "pdf";
  return "jpg";
}

async function ownInvoice(pdb: D1Database, tenantId: string, invoiceId: string) {
  return pdb.prepare("SELECT id, total_cents, amount_paid_cents, status FROM invoices WHERE id = ? AND tenant_id = ?").bind(invoiceId, tenantId)
    .first<{ id: string; total_cents: number; amount_paid_cents: number; status: string }>();
}

export const billingReceipts = new Hono<BillingEnv>()
  .use(requireAuth)
  .post("/slips", async (c) => {
    const pdb = c.env.PLATFORM_DB;
    const tenantId = getTenantId(c);
    if (!pdb || !tenantId)
      return c.json({ success: false, error: { code: "UNAVAILABLE", message: "Billing is not available on this deployment" } }, 503);
    let form: Record<string, string | File>;
    try {
      form = await c.req.parseBody() as Record<string, string | File>;
    } catch {
      return c.json({ success: false, error: { code: "VALIDATION", message: "Send the slip as multipart form data" } }, 400);
    }
    const file = form["file"];
    const parsed = receiptUploadSchema.safeParse({ invoiceId: form["invoiceId"], bankRef: form["bankRef"] || undefined });
    if (!parsed.success || !(file instanceof File))
      return c.json({ success: false, error: { code: "VALIDATION", message: "A slip image and its invoice are required" } }, 400);
    if (!(RECEIPT_MIME as readonly string[]).includes(file.type))
      return c.json({ success: false, error: { code: "VALIDATION", message: "Slip must be a PNG, JPEG or PDF scan" } }, 400);
    if (file.size > RECEIPT_MAX_BYTES)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Slip must be under 5MB" } }, 400);
    const inv = await ownInvoice(pdb, tenantId, parsed.data.invoiceId);
    if (!inv || inv.status !== "OPEN")
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Invoice not found" } }, 404);
    const remaining = inv.total_cents - inv.amount_paid_cents;
    if (remaining <= 0)
      return c.json({ success: false, error: { code: "VALIDATION", message: "This invoice is already paid" } }, 400);
    const id = crypto.randomUUID();
    const key = `receipts/${tenantId}/${id}.${extOf(file.type)}`;
    await c.env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    const now = Date.now();
    try {
      await pdb.batch([
        pdb.prepare("INSERT INTO tenant_receipts (id, tenant_id, invoice_id, r2_key, amount_cents, bank_ref, uploaded_by, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)")
          .bind(id, tenantId, inv.id, key, remaining, parsed.data.bankRef ?? null, c.get("userId"), now),
      ]);
    } catch (e) {
      await c.env.R2.delete(key).catch(() => undefined);
      return serviceError(c, e);
    }
    await writeAudit(getShopDb(c), {
      userId: c.get("userId"),
      action: "billing.slip_upload",
      entity: "invoice",
      entityId: inv.id,
      next: { receiptId: id, amountCents: remaining },
    });
    return c.json({ success: true, data: { id, invoiceId: inv.id, amountCents: remaining, status: "PENDING" } }, 201);
  })
  .get("/invoices", requireAuth, async (c) => {
    const pdb = c.env.PLATFORM_DB;
    const tenantId = getTenantId(c);
    if (!pdb || !tenantId) return c.json({ success: true, data: { rows: [], total: 0 } }, 200);
    const { results } = await pdb.prepare(
      `SELECT id, number, total_cents, amount_paid_cents, status, due_at, period_start, period_end
       FROM invoices WHERE tenant_id = ? AND status = 'OPEN' ORDER BY due_at LIMIT 50`
    ).bind(tenantId).all();
    return c.json({ success: true, data: { rows: results ?? [], total: (results ?? []).length } }, 200);
  })
  .get("/slips", requireAuth, async (c) => {
    const pdb = c.env.PLATFORM_DB;
    const tenantId = getTenantId(c);
    if (!pdb || !tenantId) return c.json({ success: true, data: { rows: [], total: 0 } }, 200);
    const { results } = await pdb.prepare(
      `SELECT r.id, r.invoice_id, i.number AS invoice_number, r.amount_cents, r.bank_ref, r.status, r.reject_reason, r.created_at, r.reviewed_at
       FROM tenant_receipts r JOIN invoices i ON i.id = r.invoice_id
       WHERE r.tenant_id = ? ORDER BY r.created_at DESC LIMIT 100`
    ).bind(tenantId).all();
    return c.json({ success: true, data: { rows: results ?? [], total: (results ?? []).length } }, 200);
  })
  .get("/slips/:id/download", requireAuth, async (c) => {
    const pdb = c.env.PLATFORM_DB;
    const tenantId = getTenantId(c);
    if (!pdb || !tenantId) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    const receipt = await pdb.prepare("SELECT r2_key FROM tenant_receipts WHERE id = ? AND tenant_id = ?").bind(c.req.param("id"), tenantId)
      .first<{ r2_key: string }>();
    if (!receipt) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    const obj = await c.env.R2.get(receipt.r2_key);
    if (!obj) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Slip file not found" } }, 404);
    return c.body(await obj.arrayBuffer(), 200, { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream" });
  });
