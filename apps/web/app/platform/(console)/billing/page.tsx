"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PLATFORM_PERMISSIONS as P } from "@goldos/shared";
import {
  EmptyBlock,
  FilterChips,
  Hero,
  heroBtnGhost,
  heroBtnPrimary,
  Modal,
  Page,
  Pager,
  Pill,
  StatusPill,
  TableCard,
  TableSkeleton,
  Tabs,
  controlClass,
} from "@/components/ui";
import { CoinsIcon, PercentIcon, PlusIcon, RefreshCwIcon, SearchIcon } from "@/components/icons";
import { InvoiceTable, ManualInvoiceDialog, type InvoiceRow } from "@/components/platform/billing-bits";
import { F } from "@/components/platform/dialogs";
import { InvoiceDrawer } from "@/components/platform/invoice-drawer";
import { cn } from "@/lib/cn";
import { can, date, dateTime, money, papi, titleCase, usePlatformMe } from "@/lib/platform";

type Tab = "invoices" | "payments" | "coupons";

function BillingInner() {
  const params = useSearchParams();
  const me = usePlatformMe();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "invoices");
  const [cycle, setCycle] = useState<Record<string, unknown> | null>(null);
  const [manual, setManual] = useState(false);
  const manage = can(me.data, P.BILLING_MANAGE);
  const summary = useQuery({
    queryKey: ["p-invoices", "summary"],
    queryFn: () => papi<{ total: number; totals: { open_cents: number; overdue_cents: number } }>("/billing/invoices?limit=1&status=OPEN"),
  });
  const overview = useQuery({ queryKey: ["platform-overview"], queryFn: () => papi<{ kpis: { mrr_cents: number; collected_30d_cents: number } }>("/overview") });

  const run = useMutation({
    mutationFn: () => papi<Record<string, unknown>>("/billing/run-cycle", { method: "POST" }),
    onSuccess: (r) => {
      setCycle(r);
      qc.invalidateQueries({ queryKey: ["p-invoices"] });
      qc.invalidateQueries({ queryKey: ["platform-overview"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Billing run failed"),
  });

  return (
    <Page className="max-w-[88rem]">
      <Hero
        kicker="Revenue"
        title="Billing"
        description="Invoices, payments and discounts. The billing cycle runs hourly on its own; run it now to apply changes immediately."
        actions={
          manage ? (
            <>
              <button onClick={() => setManual(true)} className={heroBtnPrimary}>
                <PlusIcon size={15} /> One-off invoice
              </button>
              <button onClick={() => run.mutate()} disabled={run.isPending} className={heroBtnGhost}>
                <RefreshCwIcon size={15} className={run.isPending ? "animate-spin" : undefined} /> {run.isPending ? "Running…" : "Run billing cycle"}
              </button>
            </>
          ) : undefined
        }
        stats={[
          { label: "MRR", value: overview.data ? money(overview.data.kpis.mrr_cents) : "—" },
          { label: "Collected · 30d", value: overview.data ? money(overview.data.kpis.collected_30d_cents) : "—" },
          { label: "Open receivables", value: summary.data ? money(summary.data.totals.open_cents) : "—" },
          { label: "Overdue", value: summary.data ? money(summary.data.totals.overdue_cents) : "—" },
        ]}
      />

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { key: "invoices", label: "Invoices", icon: <CoinsIcon size={14} />, count: summary.data?.total || null },
          { key: "payments", label: "Payments", icon: <CoinsIcon size={14} /> },
          { key: "coupons", label: "Coupons", icon: <PercentIcon size={14} /> },
        ]}
      />

      {tab === "invoices" ? <InvoicesTab initialOverdue={params.get("overdue") === "1"} /> : tab === "payments" ? <PaymentsTab /> : <CouponsTab />}

      {manual ? <ManualInvoicePicker onClose={() => setManual(false)} /> : null}
      {cycle ? (
        <Modal title="Billing cycle complete" kicker="Billing" onClose={() => setCycle(null)} footer={false}>
          <dl className="grid grid-cols-2 gap-3">
            {Object.entries(cycle)
              .filter(([k]) => k !== "errors")
              .map(([k, v]) => (
                <div key={k} className="rounded-xl bg-bone/70 p-3 ring-1 ring-ink/[0.06]">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-4">{titleCase(k.replace(/([A-Z])/g, " $1"))}</dt>
                  <dd className="g-metric mt-1 text-xl">{String(v)}</dd>
                </div>
              ))}
          </dl>
          {Array.isArray(cycle.errors) && cycle.errors.length > 0 ? (
            <pre className="max-h-40 overflow-auto rounded-lg bg-rose-700/[0.07] p-3 text-xs text-rose-800">{JSON.stringify(cycle.errors, null, 2)}</pre>
          ) : null}
        </Modal>
      ) : null}
    </Page>
  );
}

function InvoicesTab({ initialOverdue }: { initialOverdue: boolean }) {
  const [status, setStatus] = useState(initialOverdue ? "overdue" : "");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setPage(1), [status, search]);
  const qs = new URLSearchParams({
    page: String(page),
    limit: "25",
    search,
    ...(status === "overdue" ? { overdue: "1" } : status ? { status } : {}),
  }).toString();
  const q = useQuery({ queryKey: ["p-invoices", qs], queryFn: () => papi<{ rows: Array<InvoiceRow & { tenant_name: string }>; total: number }>(`/billing/invoices?${qs}`) });
  const rows = q.data?.rows ?? [];
  return (
    <>
      <TableCard
        toolbar={
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <FilterChips
              value={status}
              onChange={setStatus}
              options={[
                { key: "", label: "All" },
                { key: "OPEN", label: "Open" },
                { key: "overdue", label: "Overdue" },
                { key: "PAID", label: "Paid" },
                { key: "VOID", label: "Void" },
                { key: "UNCOLLECTIBLE", label: "Written off" },
              ]}
            />
            <div className="relative w-full lg:max-w-xs">
              <SearchIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
              <input aria-label="Search invoices" placeholder="Invoice no. or account…" value={search} onChange={(e) => setSearch(e.target.value)} className={cn(controlClass, "w-full pl-9")} />
            </div>
          </div>
        }
        footer={<Pager page={page} onChange={setPage} pageSize={25} count={rows.length} total={q.data?.total ?? 0} unit="invoices" />}
      >
        {q.isLoading ? <TableSkeleton rows={8} cols={7} /> : rows.length === 0 ? <EmptyBlock title="No invoices" /> : <InvoiceTable rows={rows} onOpen={setOpen} showTenant />}
      </TableCard>
      {open ? <InvoiceDrawer id={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

type PaymentRow = { id: string; amount_cents: number; method: string; reference: string | null; received_at: number; invoice_number: string; invoice_id: string; currency: string; tenant_name: string; tenant_id: string; recorded_by: string | null };

function PaymentsTab() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["p-payments", page], queryFn: () => papi<{ rows: PaymentRow[]; total: number }>(`/billing/payments?page=${page}&limit=25`) });
  const rows = q.data?.rows ?? [];
  return (
    <>
      <TableCard footer={<Pager page={page} onChange={setPage} pageSize={25} count={rows.length} total={q.data?.total ?? 0} unit="payments" />}>
        {q.isLoading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No payments recorded" />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Account</th>
                <th>Invoice</th>
                <th>Method</th>
                <th>Recorded by</th>
                <th className="!text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap text-ink-3">{dateTime(p.received_at)}</td>
                  <td>
                    <Link href={`/platform/tenants/${p.tenant_id}`} className="hover:underline">
                      {p.tenant_name}
                    </Link>
                  </td>
                  <td>
                    <button onClick={() => setOpen(p.invoice_id)} className="font-mono text-xs font-semibold hover:underline">
                      {p.invoice_number}
                    </button>
                  </td>
                  <td>
                    {titleCase(p.method)}
                    {p.reference ? <span className="ml-1 text-xs text-ink-4">· {p.reference}</span> : null}
                  </td>
                  <td className="text-ink-3">{p.recorded_by ?? "—"}</td>
                  <td className="num font-semibold">{money(p.amount_cents, p.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      {open ? <InvoiceDrawer id={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

type Coupon = { id: string; code: string; description: string; percent_off: number; duration_months: number | null; max_redemptions: number | null; redeemed_count: number; expires_at: number | null; is_active: number; created_at: number };

function CouponsTab() {
  const me = usePlatformMe();
  const qc = useQueryClient();
  const manage = can(me.data, P.BILLING_MANAGE);
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["p-coupons"], queryFn: () => papi<Coupon[]>("/billing/coupons") });
  const toggle = useMutation({
    mutationFn: (c: Coupon) => papi(`/billing/coupons/${c.id}/${c.is_active ? "retire" : "activate"}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["p-coupons"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const rows = q.data ?? [];
  return (
    <>
      <TableCard
        title="Coupons"
        description="Apply from an account's Subscription tab. Coupons are retired, never deleted."
        icon={<PercentIcon size={16} />}
        actions={
          manage ? (
            <button onClick={() => setCreating(true)} className="g-btn g-btn-secondary h-9 px-3 text-sm">
              <PlusIcon size={14} /> New coupon
            </button>
          ) : undefined
        }
      >
        {q.isLoading ? (
          <TableSkeleton rows={4} cols={6} />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No coupons yet" />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Discount</th>
                <th>Duration</th>
                <th>Redeemed</th>
                <th>Expires</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const expired = c.expires_at !== null && c.expires_at < Date.now();
                const full = c.max_redemptions !== null && c.redeemed_count >= c.max_redemptions;
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="font-mono text-xs font-bold">{c.code}</div>
                      {c.description ? <div className="text-xs text-ink-4">{c.description}</div> : null}
                    </td>
                    <td className="g-metric">{c.percent_off}%</td>
                    <td>{c.duration_months ? `${c.duration_months} month${c.duration_months === 1 ? "" : "s"}` : "Forever"}</td>
                    <td className="num-tabular">
                      {c.redeemed_count}
                      {c.max_redemptions !== null ? ` / ${c.max_redemptions}` : ""}
                    </td>
                    <td className="text-ink-3">{date(c.expires_at)}</td>
                    <td>{!c.is_active ? <Pill>Retired</Pill> : expired ? <StatusPill status="expired" /> : full ? <Pill tone="warning">Fully used</Pill> : <StatusPill status="active" />}</td>
                    <td className="text-right">
                      {manage ? (
                        <button onClick={() => toggle.mutate(c)} className="text-xs font-medium text-ink-3 hover:text-ink hover:underline">
                          {c.is_active ? "Retire" : "Reactivate"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>
      {creating ? <CouponDialog onClose={() => setCreating(false)} onDone={() => qc.invalidateQueries({ queryKey: ["p-coupons"] })} /> : null}
    </>
  );
}

function CouponDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: "", description: "", percentOff: "20", durationMonths: "3", maxRedemptions: "", expiresOn: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const m = useMutation({
    mutationFn: () =>
      papi("/billing/coupons", {
        method: "POST",
        json: {
          code: f.code,
          description: f.description,
          percentOff: Number(f.percentOff),
          durationMonths: f.durationMonths === "" ? null : Number(f.durationMonths),
          maxRedemptions: f.maxRedemptions === "" ? null : Number(f.maxRedemptions),
          expiresAt: f.expiresOn ? new Date(`${f.expiresOn}T23:59:59`).getTime() : null,
        },
      }),
    onSuccess: () => {
      toast.success("Coupon created");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <Modal title="New coupon" kicker="Billing" onClose={onClose} onSubmit={() => m.mutate()} submitLabel="Create" pending={m.isPending} submitDisabled={f.code.length < 3 || !f.percentOff}>
      <div className="grid gap-4 sm:grid-cols-2">
        <F label="Code">
          <input autoFocus value={f.code} onChange={(e) => setF((s) => ({ ...s, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") }))} className={cn(controlClass, "w-full font-mono")} />
        </F>
        <F label="Percent off">
          <input type="number" min={1} max={100} value={f.percentOff} onChange={set("percentOff")} className={cn(controlClass, "w-full")} />
        </F>
        <F label="Months" hint="Blank = forever">
          <input type="number" min={1} max={60} value={f.durationMonths} onChange={set("durationMonths")} className={cn(controlClass, "w-full")} />
        </F>
        <F label="Max redemptions" hint="Blank = unlimited">
          <input type="number" min={1} value={f.maxRedemptions} onChange={set("maxRedemptions")} className={cn(controlClass, "w-full")} />
        </F>
        <F label="Redeem by" hint="Optional">
          <input type="date" value={f.expiresOn} onChange={set("expiresOn")} className={cn(controlClass, "w-full")} />
        </F>
        <F label="Description">
          <input value={f.description} onChange={set("description")} className={cn(controlClass, "w-full")} />
        </F>
      </div>
    </Modal>
  );
}

/** Picks the account first, then hands off to the shared one-off invoice form. */
function ManualInvoicePicker({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<{ id: string; name: string; currency: string } | null>(null);
  const q = useQuery({
    queryKey: ["p-tenants", "pick", search],
    queryFn: () => papi<{ rows: Array<{ id: string; name: string; slug: string; currency: string }> }>(`/tenants?limit=8&search=${encodeURIComponent(search)}`),
  });
  if (picked)
    return (
      <ManualInvoiceDialog
        tenantId={picked.id}
        currency={picked.currency}
        onClose={onClose}
        onDone={() => qc.invalidateQueries({ queryKey: ["p-invoices"] })}
      />
    );
  return (
    <Modal title="Which account?" kicker="One-off invoice" onClose={onClose} footer={false}>
      <input autoFocus placeholder="Search accounts…" value={search} onChange={(e) => setSearch(e.target.value)} className={cn(controlClass, "w-full")} />
      <ul className="divide-y divide-ink/[0.06]">
        {(q.data?.rows ?? []).map((t) => (
          <li key={t.id}>
            <button onClick={() => setPicked(t)} className="flex w-full items-center justify-between py-2.5 text-left text-sm hover:text-gold-dark">
              <span className="font-medium">{t.name}</span>
              <span className="font-mono text-xs text-ink-4">{t.slug}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export default function BillingPage() {
  return (
    <Suspense>
      <BillingInner />
    </Suspense>
  );
}
