/** Global admin search across control-plane records. */
export type PlatformSearchResult = {
  tenants: Array<{ id: string; name: string; slug: string; owner_email: string; status: string }>;
  invoices: Array<{ id: string; number: string; tenant_name: string; status: string; total_cents: number }>;
  tickets: Array<{ id: string; number: string; subject: string; status: string; tenant_name: string }>;
  admins: Array<{ id: string; email: string; name: string; role: string }>;
};

export async function searchPlatform(db: D1Database, q: string, limit = 8): Promise<PlatformSearchResult> {
  const like = `%${q}%`;
  const lim = Math.min(25, Math.max(1, limit));
  const [tenants, invoices, tickets, admins] = await Promise.all([
    db
      .prepare("SELECT id, name, slug, owner_email, status FROM tenants WHERE name LIKE ? OR slug LIKE ? OR owner_email LIKE ? OR custom_domain LIKE ? ORDER BY created_at DESC LIMIT ?")
      .bind(like, like, like, like, lim)
      .all<{ id: string; name: string; slug: string; owner_email: string; status: string }>(),
    db
      .prepare("SELECT i.id, i.number, t.name AS tenant_name, i.status, i.total_cents FROM invoices i JOIN tenants t ON t.id = i.tenant_id WHERE i.number LIKE ? OR t.name LIKE ? ORDER BY i.issued_at DESC LIMIT ?")
      .bind(like, like, lim)
      .all<{ id: string; number: string; tenant_name: string; status: string; total_cents: number }>(),
    db
      .prepare("SELECT s.id, s.number, s.subject, s.status, t.name AS tenant_name FROM support_tickets s JOIN tenants t ON t.id = s.tenant_id WHERE s.number LIKE ? OR s.subject LIKE ? OR t.name LIKE ? ORDER BY s.created_at DESC LIMIT ?")
      .bind(like, like, like, lim)
      .all<{ id: string; number: string; subject: string; status: string; tenant_name: string }>(),
    db
      .prepare("SELECT id, email, name, role FROM platform_admins WHERE email LIKE ? OR name LIKE ? ORDER BY created_at DESC LIMIT ?")
      .bind(like, like, lim)
      .all<{ id: string; email: string; name: string; role: string }>(),
  ]);
  return {
    tenants: tenants.results ?? [],
    invoices: invoices.results ?? [],
    tickets: tickets.results ?? [],
    admins: admins.results ?? [],
  };
}
