"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PLATFORM_PERMISSIONS as P } from "@goldos/shared";
import {
  Callout,
  DetailList,
  EmptyBlock,
  Hero,
  heroBtnGhost,
  heroBtnPrimary,
  Modal,
  Page,
  Pager,
  Panel,
  Pill,
  Skeleton,
  StatusPill,
  TableCard,
  TableSkeleton,
  Tabs,
  controlClass,
} from "@/components/ui";
import {
  AlertCircleIcon,
  ArchiveIcon,
  CoinsIcon,
  FlagIcon,
  GaugeIcon,
  HistoryIcon,
  LifeBuoyIcon,
  LogInIcon,
  PauseCircleIcon,
  PlusIcon,
  RotateCcwIcon,
  SettingsIcon,
} from "@/components/icons";
import { F, LimitMeter, ReasonDialog } from "@/components/platform/dialogs";
import { InvoiceDrawer } from "@/components/platform/invoice-drawer";
import { InvoiceTable, ManualInvoiceDialog, PriorityPill, type InvoiceRow } from "@/components/platform/billing-bits";
import { cn } from "@/lib/cn";
import { can, date, dateTime, money, papi, relative, titleCase, toCents, usePlatformMe } from "@/lib/platform";

type Limit = { used: number; max: number | null; pct: number | null; over: boolean; near: boolean };
type Detail = {
  tenant: {
    id: string;
    slug: string;
    name: string;
    legal_name: string | null;
    status: string;
    owner_name: string;
    owner_email: string;
    phone: string | null;
    country: string;
    currency: string;
    timezone: string;
    region: string;
    custom_domain: string | null;
    data_plane: string | null;
    tags: string[];
    suspension_kind: string | null;
    suspended_reason: string | null;
    suspended_at: number | null;
    deletion_scheduled_at: number | null;
    last_active_at: number | null;
    created_at: number;
  };
  subscription: {
    id: string;
    plan_id: string;
    status: string;
    billing_interval: "MONTH" | "YEAR";
    price_cents: number;
    discount_pct: number;
    discount_ends_at: number | null;
    trial_ends_at: number | null;
    current_period_start: number;
    current_period_end: number;
    cancel_at_period_end: number;
    cancel_reason: string | null;
    canceled_at: number | null;
    past_due_since: number | null;
    mrr_cents: number;
  } | null;
  plan: { id: string; name: string; code: string; features: string[]; price_monthly_cents: number; price_yearly_cents: number } | null;
  usage: { users: number; branches: number; products: number; sales_30d: number; sales_30d_cents: number; storage_mb: number; captured_at: number } | null;
  limits: { users: Limit; branches: Limit; products: Limit; storageMb: Limit } | null;
  balance: { open_cents: number; overdue_cents: number; open_count: number; lifetime_paid_cents: number };
  notes: Array<{ id: string; body: string; pinned: number; created_at: number; author_name: string | null }>;
  events: Array<{ id: string; type: string; from_status: string | null; to_status: string | null; mrr_delta_cents: number; reason: string | null; created_at: number; from_plan: string | null; to_plan: string | null }>;
  flags: Array<{ key: string; description: string; override: boolean | null; enabled: boolean; source: string }>;
  openTickets: number;
};

type Tab = "overview" | "subscription" | "billing" | "features" | "notes" | "support" | "activity" | "profile";

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = usePlatformMe();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [dialog, setDialog] = useState<null | "suspend" | "unsuspend" | "archive" | "restore" | "impersonate">(null);
  const q = useQuery({ queryKey: ["p-tenant", id], queryFn: () => papi<Detail>(`/tenants/${id}`) });
  const d = q.data;
  const t = d?.tenant;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["p-tenant", id] });
    qc.invalidateQueries({ queryKey: ["p-tenants"] });
    qc.invalidateQueries({ queryKey: ["platform-overview"] });
  };

  if (q.error) {
    return (
      <Page>
        <EmptyBlock title="Account not found" description={q.error.message} action={<Link href="/platform/tenants" className="g-btn g-btn-secondary h-10 px-4 text-sm">Back to accounts</Link>} />
      </Page>
    );
  }

  return (
    <Page className="max-w-[88rem]">
      <Hero
        back={{ href: "/platform/tenants", label: "Accounts" }}
        kicker={t ? `${t.slug} · ${t.country} · ${t.currency}` : "Account"}
        title={t?.name ?? "…"}
        description={t ? `${t.owner_name} · ${t.owner_email}` : undefined}
        meta={
          t ? (
            <>
              <StatusPill status={t.status} />
              {d?.subscription ? <StatusPill status={d.subscription.status} /> : null}
              {d?.subscription?.cancel_at_period_end ? <Pill tone="warning">Cancels {date(d.subscription.current_period_end)}</Pill> : null}
              {t.tags.map((tag) => (
                <Pill key={tag} tone="ghost">
                  {tag}
                </Pill>
              ))}
            </>
          ) : null
        }
        actions={
          t ? (
            <>
              {can(me.data, P.TENANTS_IMPERSONATE) && t.status !== "ARCHIVED" ? (
                <button onClick={() => setDialog("impersonate")} className={heroBtnPrimary}>
                  <LogInIcon size={15} /> Sign in as shop
                </button>
              ) : null}
              {can(me.data, P.TENANTS_SUSPEND) && t.status === "ACTIVE" ? (
                <button onClick={() => setDialog("suspend")} className={heroBtnGhost}>
                  <PauseCircleIcon size={15} /> Suspend
                </button>
              ) : null}
              {can(me.data, P.TENANTS_SUSPEND) && t.status === "SUSPENDED" ? (
                <button onClick={() => setDialog("unsuspend")} className={heroBtnGhost}>
                  <RotateCcwIcon size={15} /> Lift suspension
                </button>
              ) : null}
              {can(me.data, P.TENANTS_DELETE) && t.status !== "ARCHIVED" ? (
                <button onClick={() => setDialog("archive")} className={cn(heroBtnGhost, "hover:bg-rose-500/20")}>
                  <ArchiveIcon size={15} /> Close account
                </button>
              ) : null}
              {can(me.data, P.TENANTS_DELETE) && t.status === "ARCHIVED" ? (
                <button onClick={() => setDialog("restore")} className={heroBtnGhost}>
                  <RotateCcwIcon size={15} /> Restore
                </button>
              ) : null}
            </>
          ) : null
        }
        stats={[
          { label: "MRR", value: d?.subscription ? money(d.subscription.mrr_cents, t?.currency) : "—" },
          { label: "Open balance", value: d ? money(d.balance.open_cents, t?.currency) : "—" },
          { label: "Lifetime paid", value: d ? money(d.balance.lifetime_paid_cents, t?.currency) : "—" },
          { label: "Last active", value: t ? relative(t.last_active_at) : "—" },
        ]}
      />

      {t?.status === "SUSPENDED" ? (
        <Callout tone="danger" title={`Suspended ${relative(t.suspended_at)} · ${t.suspension_kind === "BILLING" ? "non-payment (lifts automatically when paid)" : "manual"}`}>
          {t.suspended_reason}
        </Callout>
      ) : null}
      {t?.status === "ARCHIVED" ? (
        <Callout tone="danger" title="Account closed">
          Data is scheduled for purge on {date(t.deletion_scheduled_at)}. Restore before then to keep it.
        </Callout>
      ) : null}
      {d && d.balance.overdue_cents > 0 ? (
        <Callout tone="warning" title={`${money(d.balance.overdue_cents, t?.currency)} overdue`} action={<button className="g-btn g-btn-secondary h-8 px-3 text-xs" onClick={() => setTab("billing")}>View invoices</button>}>
          {d.subscription?.past_due_since ? `Past due since ${date(d.subscription.past_due_since)}.` : null}
        </Callout>
      ) : null}

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { key: "overview", label: "Overview", icon: <GaugeIcon size={14} /> },
          { key: "subscription", label: "Subscription", icon: <CoinsIcon size={14} /> },
          { key: "billing", label: "Invoices", icon: <CoinsIcon size={14} />, count: d?.balance.open_count || null },
          { key: "features", label: "Features", icon: <FlagIcon size={14} /> },
          { key: "notes", label: "Notes", icon: <HistoryIcon size={14} />, count: d?.notes.length || null },
          { key: "support", label: "Support", icon: <LifeBuoyIcon size={14} />, count: d?.openTickets || null },
          { key: "activity", label: "Activity", icon: <HistoryIcon size={14} /> },
          { key: "profile", label: "Profile", icon: <SettingsIcon size={14} /> },
        ]}
      />

      {!d ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : tab === "overview" ? (
        <OverviewTab d={d} onRefreshUsage={refresh} />
      ) : tab === "subscription" ? (
        <SubscriptionTab d={d} onChange={refresh} />
      ) : tab === "billing" ? (
        <BillingTab tenantId={id} currency={d.tenant.currency} />
      ) : tab === "features" ? (
        <FeaturesTab d={d} onChange={refresh} />
      ) : tab === "notes" ? (
        <NotesTab d={d} onChange={refresh} />
      ) : tab === "support" ? (
        <SupportTab tenantId={id} />
      ) : tab === "activity" ? (
        <ActivityTab tenantId={id} />
      ) : (
        <ProfileTab d={d} onChange={refresh} />
      )}

      {dialog === "impersonate" && t ? <ImpersonateDialog tenant={t} onClose={() => setDialog(null)} /> : null}
      {dialog && dialog !== "impersonate" && t ? (
        <ReasonDialog
          title={{ suspend: `Suspend ${t.name}`, unsuspend: `Lift suspension`, archive: `Close ${t.name}`, restore: `Restore ${t.name}` }[dialog]}
          danger={dialog === "suspend" || dialog === "archive"}
          submitLabel={{ suspend: "Suspend access", unsuspend: "Restore access", archive: "Close account", restore: "Restore account" }[dialog]}
          description={
            {
              suspend: "Every user in this shop is locked out within 30 seconds. Billing continues. Their data is untouched.",
              unsuspend: "Users can sign in again immediately.",
              archive: "Access stops, the subscription is cancelled and data is scheduled for purge in 30 days. You can restore within that window.",
              restore: "Brings access back. The subscription stays cancelled until you reactivate it.",
            }[dialog]
          }
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            await papi(`/tenants/${t.id}/${dialog}`, { method: "POST", json: { reason } });
            toast.success("Done");
            refresh();
          }}
        />
      ) : null}
    </Page>
  );
}

/* ------------------------------------------------------------------ Overview */

function OverviewTab({ d, onRefreshUsage }: { d: Detail; onRefreshUsage: () => void }) {
  const refresh = useMutation({
    mutationFn: () => papi(`/tenants/${d.tenant.id}/usage/refresh`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Usage refreshed");
      onRefreshUsage();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Refresh failed"),
  });
  const s = d.subscription;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Panel
        className="lg:col-span-2"
        title="Usage against plan"
        description={d.usage ? `Captured ${relative(d.usage.captured_at)}` : "No usage captured yet — the nightly job collects it."}
        icon={<GaugeIcon size={16} />}
        actions={
          <button onClick={() => refresh.mutate()} disabled={refresh.isPending} className="g-btn g-btn-secondary h-8 px-3 text-xs">
            {refresh.isPending ? "Refreshing…" : "Refresh now"}
          </button>
        }
      >
        {d.limits ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <LimitMeter label="Active users" used={d.limits.users.used} max={d.limits.users.max} />
            <LimitMeter label="Branches" used={d.limits.branches.used} max={d.limits.branches.max} />
            <LimitMeter label="Products in stock" used={d.limits.products.used} max={d.limits.products.max} />
            <LimitMeter label="Storage" used={d.limits.storageMb.used} max={d.limits.storageMb.max} unit="MB" />
          </div>
        ) : (
          <p className="text-sm text-ink-4">No plan attached.</p>
        )}
        {d.usage ? (
          <div className="mt-6 grid grid-cols-2 gap-3 border-t border-ink/[0.07] pt-5 sm:grid-cols-3">
            <Stat label="Sales · 30d" value={d.usage.sales_30d.toLocaleString()} />
            <Stat label="Sales value · 30d" value={money(d.usage.sales_30d_cents, d.tenant.currency)} />
            <Stat label="Health" value={<HealthBadge d={d} />} />
          </div>
        ) : null}
      </Panel>

      <Panel title="Subscription" icon={<CoinsIcon size={16} />}>
        {s && d.plan ? (
          <DetailList
            items={[
              { label: "Plan", value: <span className="font-semibold">{d.plan.name}</span> },
              { label: "Price", value: `${money(s.price_cents, d.tenant.currency)} / ${s.billing_interval === "YEAR" ? "year" : "month"}${s.discount_pct ? ` · ${s.discount_pct}% off` : ""}` },
              s.status === "TRIALING"
                ? { label: "Trial ends", value: `${date(s.trial_ends_at)} (${relative(s.trial_ends_at)})` }
                : { label: "Current period", value: `${date(s.current_period_start)} – ${date(s.current_period_end)}` },
              { label: "Customer since", value: date(d.tenant.created_at) },
            ]}
          />
        ) : (
          <p className="text-sm text-ink-4">No subscription.</p>
        )}
      </Panel>

      <Panel className="lg:col-span-3" title="Lifecycle" description="Every subscription change, newest first" icon={<HistoryIcon size={16} />}>
        {d.events.length === 0 ? (
          <p className="text-sm text-ink-4">No events.</p>
        ) : (
          <ol className="relative space-y-4 border-l border-ink/10 pl-5">
            {d.events.map((e) => (
              <li key={e.id} className="relative">
                <span className={cn("absolute -left-[25px] top-1.5 size-2.5 rounded-full ring-4 ring-paper", e.mrr_delta_cents > 0 ? "bg-emerald-600" : e.mrr_delta_cents < 0 ? "bg-rose-600" : "bg-ink-5")} />
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-ink">
                    {titleCase(e.type)}
                    {e.type === "PLAN_CHANGED" && e.from_plan !== e.to_plan ? ` · ${e.from_plan} → ${e.to_plan}` : ""}
                    {e.from_status && e.to_status && e.from_status !== e.to_status ? ` · ${titleCase(e.from_status)} → ${titleCase(e.to_status)}` : ""}
                  </span>
                  <span className="flex items-center gap-2 text-[11px] text-ink-4">
                    {e.mrr_delta_cents !== 0 ? (
                      <span className={cn("g-metric", e.mrr_delta_cents > 0 ? "text-emerald-700" : "text-rose-700")}>
                        {e.mrr_delta_cents > 0 ? "+" : "−"}
                        {money(Math.abs(e.mrr_delta_cents), d.tenant.currency)} MRR
                      </span>
                    ) : null}
                    {dateTime(e.created_at)}
                  </span>
                </div>
                {e.reason ? <p className="mt-0.5 text-xs text-ink-4">{e.reason}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-bone/70 p-3 ring-1 ring-ink/[0.06]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-4">{label}</div>
      <div className="g-metric mt-1 text-base text-ink">{value}</div>
    </div>
  );
}

/** A quick read on whether the account is thriving, drifting or in trouble. */
function HealthBadge({ d }: { d: Detail }) {
  const idleDays = d.tenant.last_active_at ? (Date.now() - d.tenant.last_active_at) / 864e5 : Infinity;
  if (d.tenant.status !== "ACTIVE" || d.balance.overdue_cents > 0) return <Pill tone="danger" dot>At risk</Pill>;
  if (idleDays > 14 || (d.usage && d.usage.sales_30d === 0)) return <Pill tone="warning" dot>Drifting</Pill>;
  return <Pill tone="success" dot>Healthy</Pill>;
}

/* ------------------------------------------------------------------ Subscription */

type PlanOpt = { id: string; name: string; code: string; price_monthly_cents: number; price_yearly_cents: number; currency: string };
type SubDialog = "plan" | "trial" | "convert" | "cancel" | "resume" | "reactivate" | "discount";

function SubscriptionTab({ d, onChange }: { d: Detail; onChange: () => void }) {
  const me = usePlatformMe();
  const manage = can(me.data, P.BILLING_MANAGE);
  const [dlg, setDlg] = useState<SubDialog | null>(null);
  const s = d.subscription;
  const plans = useQuery({ queryKey: ["p-plans"], queryFn: () => papi<PlanOpt[]>("/plans") });
  if (!s || !d.plan) return <EmptyBlock title="No subscription" />;
  const tid = d.tenant.id;
  const post = (path: string, json: unknown) => papi(`/tenants/${tid}/subscription/${path}`, { method: "POST", json });
  const done = (msg: string) => {
    toast.success(msg);
    onChange();
  };

  const actions: Array<{ key: SubDialog; label: string; show: boolean; danger?: boolean }> = [
    { key: "plan", label: "Change plan or price", show: s.status !== "CANCELED" },
    { key: "discount", label: s.discount_pct ? "Change discount" : "Apply discount", show: s.status !== "CANCELED" },
    { key: "trial", label: "Extend trial", show: s.status === "TRIALING" },
    { key: "convert", label: "End trial & bill now", show: s.status === "TRIALING" },
    { key: "resume", label: "Undo scheduled cancellation", show: s.cancel_at_period_end === 1 && s.status !== "CANCELED" },
    { key: "cancel", label: "Cancel subscription", show: s.status !== "CANCELED" && !s.cancel_at_period_end, danger: true },
    { key: "reactivate", label: "Reactivate", show: s.status === "CANCELED" && d.tenant.status !== "ARCHIVED" },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Panel className="lg:col-span-2" title={`${d.plan.name} plan`} description={`${titleCase(s.billing_interval === "YEAR" ? "annual" : "monthly")} billing`} icon={<CoinsIcon size={16} />}>
        <DetailList
          columns={2}
          items={[
            { label: "Status", value: <StatusPill status={s.status} /> },
            { label: "Locked price", value: `${money(s.price_cents, d.tenant.currency)} / ${s.billing_interval === "YEAR" ? "yr" : "mo"}` },
            { label: "Discount", value: s.discount_pct ? `${s.discount_pct}%${s.discount_ends_at ? ` until ${date(s.discount_ends_at)}` : " (forever)"}` : "None" },
            { label: "MRR contribution", value: money(s.mrr_cents, d.tenant.currency) },
            ...(s.trial_ends_at ? [{ label: "Trial ends", value: `${dateTime(s.trial_ends_at)} · ${relative(s.trial_ends_at)}` }] : []),
            { label: "Current period", value: `${date(s.current_period_start)} – ${date(s.current_period_end)}` },
            { label: "Next renewal", value: s.status === "CANCELED" ? "—" : s.cancel_at_period_end ? `Cancels ${date(s.current_period_end)}` : date(s.status === "TRIALING" ? s.trial_ends_at : s.current_period_end) },
            ...(s.canceled_at ? [{ label: "Cancelled", value: `${date(s.canceled_at)}${s.cancel_reason ? ` — ${s.cancel_reason}` : ""}` }] : []),
          ]}
        />
        <p className="mt-5 border-t border-ink/[0.07] pt-4 text-xs text-ink-4">
          Prices are locked per account: editing a plan&rsquo;s list price never reprices existing subscribers. Plan changes take effect at the next invoice — add a one-off invoice from the Invoices tab for a mid-period adjustment.
        </p>
      </Panel>

      <Panel title="Actions" icon={<SettingsIcon size={16} />}>
        {manage ? (
          <div className="flex flex-col gap-2">
            {actions
              .filter((a) => a.show)
              .map((a) => (
                <button key={a.key} onClick={() => setDlg(a.key)} className={cn("g-btn g-btn-secondary h-10 justify-start px-4 text-sm", a.danger && "text-rose-700")}>
                  {a.label}
                </button>
              ))}
          </div>
        ) : (
          <p className="text-sm text-ink-4">You need billing permission to change subscriptions.</p>
        )}
      </Panel>

      {dlg === "plan" ? <ChangePlanDialog d={d} plans={plans.data ?? []} onClose={() => setDlg(null)} onDone={() => done("Plan updated")} /> : null}
      {dlg === "discount" ? <DiscountDialog d={d} onClose={() => setDlg(null)} onDone={() => done("Discount updated")} /> : null}
      {dlg === "trial" ? <ExtendTrialDialog d={d} onClose={() => setDlg(null)} onDone={() => done("Trial extended")} /> : null}
      {dlg === "cancel" ? <CancelDialog d={d} onClose={() => setDlg(null)} onDone={() => done("Cancellation recorded")} /> : null}
      {dlg === "convert" || dlg === "resume" || dlg === "reactivate" ? (
        <ReasonDialog
          title={{ convert: "End trial and bill now", resume: "Undo scheduled cancellation", reactivate: "Reactivate subscription" }[dlg]}
          submitLabel={{ convert: "Start paid period", resume: "Keep subscription", reactivate: "Reactivate" }[dlg]}
          description={
            {
              convert: `Starts a paid ${s.billing_interval === "YEAR" ? "year" : "month"} today and issues the first invoice.`,
              resume: "The subscription will renew normally at period end.",
              reactivate: `Starts a new paid period today on ${d.plan.name} at the locked price and issues an invoice.`,
            }[dlg]
          }
          onClose={() => setDlg(null)}
          onSubmit={async (reason) => {
            const r = await post({ convert: "convert-trial", resume: "resume", reactivate: "reactivate" }[dlg], { reason });
            const inv = (r as { invoiceNumber?: string | null } | undefined)?.invoiceNumber;
            done(inv ? `Invoice ${inv} issued` : "Done");
          }}
        />
      ) : null}
    </div>
  );
}

function ChangePlanDialog({ d, plans, onClose, onDone }: { d: Detail; plans: PlanOpt[]; onClose: () => void; onDone: () => void }) {
  const s = d.subscription!;
  const [planId, setPlanId] = useState(s.plan_id);
  const [interval, setInterval] = useState<"MONTH" | "YEAR">(s.billing_interval);
  const [override, setOverride] = useState("");
  const plan = plans.find((p) => p.id === planId);
  const list = plan ? (interval === "YEAR" ? plan.price_yearly_cents : plan.price_monthly_cents) : 0;
  return (
    <ReasonDialog
      title="Change plan or price"
      kicker="Subscription"
      submitLabel="Apply change"
      onClose={onClose}
      onSubmit={async (reason) => {
        await papi(`/tenants/${d.tenant.id}/subscription/change-plan`, {
          method: "POST",
          json: { planId, interval, priceCents: override === "" ? undefined : toCents(override), reason },
        });
        onDone();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <F label="Plan">
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} className={cn(controlClass, "w-full")}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </F>
        <F label="Billing">
          <select value={interval} onChange={(e) => setInterval(e.target.value as "MONTH" | "YEAR")} className={cn(controlClass, "w-full")}>
            <option value="MONTH">Monthly</option>
            <option value="YEAR">Annual</option>
          </select>
        </F>
      </div>
      <F label={`Custom price per ${interval === "YEAR" ? "year" : "month"} (${d.tenant.currency})`} hint={`Leave blank for list price: ${money(list, d.tenant.currency)}`}>
        <input inputMode="decimal" value={override} onChange={(e) => setOverride(e.target.value)} placeholder={(list / 100).toFixed(2)} className={cn(controlClass, "w-full font-mono")} />
      </F>
    </ReasonDialog>
  );
}

function DiscountDialog({ d, onClose, onDone }: { d: Detail; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"coupon" | "manual">("coupon");
  const [code, setCode] = useState("");
  const [pct, setPct] = useState(String(d.subscription?.discount_pct ?? 0));
  const [months, setMonths] = useState("");
  return (
    <ReasonDialog
      title="Discount"
      kicker="Subscription"
      submitLabel="Apply"
      onClose={onClose}
      onSubmit={async (reason) => {
        await papi(`/tenants/${d.tenant.id}/subscription/discount`, {
          method: "POST",
          json: mode === "coupon" ? { couponCode: code, reason } : { percentOff: Number(pct), months: months === "" ? null : Number(months), reason },
        });
        onDone();
      }}
    >
      <div className="flex gap-1.5">
        {(["coupon", "manual"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={cn("g-btn h-8 px-3 text-xs", mode === m ? "g-btn-primary" : "g-btn-secondary")}>
            {m === "coupon" ? "Coupon code" : "Manual %"}
          </button>
        ))}
      </div>
      {mode === "coupon" ? (
        <F label="Coupon code">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={cn(controlClass, "w-full font-mono")} />
        </F>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <F label="Percent off" hint="0 removes the discount">
            <input type="number" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} className={cn(controlClass, "w-full")} />
          </F>
          <F label="For how many months" hint="Blank = forever">
            <input type="number" min={1} max={60} value={months} onChange={(e) => setMonths(e.target.value)} className={cn(controlClass, "w-full")} />
          </F>
        </div>
      )}
    </ReasonDialog>
  );
}

function ExtendTrialDialog({ d, onClose, onDone }: { d: Detail; onClose: () => void; onDone: () => void }) {
  const [days, setDays] = useState("7");
  return (
    <ReasonDialog
      title="Extend trial"
      kicker="Subscription"
      submitLabel="Extend"
      description={`Currently ends ${dateTime(d.subscription?.trial_ends_at)}.`}
      onClose={onClose}
      onSubmit={async (reason) => {
        await papi(`/tenants/${d.tenant.id}/subscription/extend-trial`, { method: "POST", json: { days: Number(days), reason } });
        onDone();
      }}
    >
      <F label="Extra days">
        <input type="number" min={1} max={180} value={days} onChange={(e) => setDays(e.target.value)} className={cn(controlClass, "w-full")} />
      </F>
    </ReasonDialog>
  );
}

function CancelDialog({ d, onClose, onDone }: { d: Detail; onClose: () => void; onDone: () => void }) {
  const [atEnd, setAtEnd] = useState(true);
  return (
    <ReasonDialog
      title="Cancel subscription"
      kicker="Subscription"
      danger
      submitLabel={atEnd ? "Cancel at period end" : "Cancel immediately"}
      onClose={onClose}
      onSubmit={async (reason) => {
        await papi(`/tenants/${d.tenant.id}/subscription/cancel`, { method: "POST", json: { atPeriodEnd: atEnd, reason } });
        onDone();
      }}
    >
      <div className="space-y-2">
        {[
          [true, "At period end", `Keeps access until ${date(d.subscription?.status === "TRIALING" ? d.subscription?.trial_ends_at : d.subscription?.current_period_end)}. Can be undone until then.`],
          [false, "Immediately", "Stops recurring revenue now. Open invoices stay open."],
        ].map(([v, label, hint]) => (
          <label key={String(v)} className={cn("flex cursor-pointer gap-3 rounded-xl p-3 ring-1", atEnd === v ? "bg-gold-pale ring-gold-dark/30" : "ring-ink/10")}>
            <input type="radio" checked={atEnd === v} onChange={() => setAtEnd(v as boolean)} className="mt-1 accent-ink" />
            <span>
              <span className="block text-sm font-medium">{label as string}</span>
              <span className="block text-xs text-ink-4">{hint as string}</span>
            </span>
          </label>
        ))}
      </div>
    </ReasonDialog>
  );
}

/* ------------------------------------------------------------------ Billing */

function BillingTab({ tenantId, currency }: { tenantId: string; currency: string }) {
  const me = usePlatformMe();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ["p-invoices", "tenant", tenantId, page],
    queryFn: () => papi<{ rows: InvoiceRow[]; total: number; totals: { open_cents: number; overdue_cents: number } }>(`/tenants/${tenantId}/invoices?page=${page}&limit=20`),
  });
  const rows = q.data?.rows ?? [];
  return (
    <>
      <TableCard
        title="Invoices"
        description={q.data ? `${money(q.data.totals.open_cents, currency)} open · ${money(q.data.totals.overdue_cents, currency)} overdue` : undefined}
        icon={<CoinsIcon size={16} />}
        actions={
          can(me.data, P.BILLING_MANAGE) ? (
            <button onClick={() => setCreating(true)} className="g-btn g-btn-secondary h-9 px-3 text-sm">
              <PlusIcon size={14} /> One-off invoice
            </button>
          ) : undefined
        }
        footer={<Pager page={page} onChange={setPage} pageSize={20} count={rows.length} total={q.data?.total ?? 0} unit="invoices" />}
      >
        {q.isLoading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No invoices yet" description="Trials and free plans do not generate invoices." />
        ) : (
          <InvoiceTable rows={rows} onOpen={setOpen} />
        )}
      </TableCard>
      {open ? <InvoiceDrawer id={open} onClose={() => setOpen(null)} /> : null}
      {creating ? (
        <ManualInvoiceDialog
          tenantId={tenantId}
          currency={currency}
          onClose={() => setCreating(false)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["p-invoices"] });
            qc.invalidateQueries({ queryKey: ["p-tenant"] });
          }}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ Features */

function FeaturesTab({ d, onChange }: { d: Detail; onChange: () => void }) {
  const me = usePlatformMe();
  const manage = can(me.data, P.FLAGS_MANAGE);
  const set = useMutation({
    mutationFn: (v: { flagKey: string; enabled: boolean | null }) => papi(`/tenants/${d.tenant.id}/flags`, { method: "PUT", json: v }),
    onSuccess: () => {
      toast.success("Override saved");
      onChange();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const SOURCE: Record<string, string> = { override: "Override", plan: "Plan", rollout: "Rollout", default: "Default" };
  return (
    <TableCard title="Features" description="Effective state for this account. An override beats the plan, the rollout and the default." icon={<FlagIcon size={16} />}>
      <table className="g-table">
        <thead>
          <tr>
            <th>Feature</th>
            <th>State</th>
            <th>Because of</th>
            <th className="!text-right">Override</th>
          </tr>
        </thead>
        <tbody>
          {d.flags.map((f) => (
            <tr key={f.key}>
              <td>
                <div className="font-mono text-xs font-semibold">{f.key}</div>
                <div className="text-xs text-ink-4">{f.description}</div>
              </td>
              <td>{f.enabled ? <Pill tone="success" dot>On</Pill> : <Pill tone="neutral" dot>Off</Pill>}</td>
              <td className="text-ink-3">{SOURCE[f.source] ?? f.source}</td>
              <td className="text-right">
                <select
                  aria-label={`Override ${f.key}`}
                  disabled={!manage || set.isPending}
                  value={f.override === null ? "" : f.override ? "on" : "off"}
                  onChange={(e) => set.mutate({ flagKey: f.key, enabled: e.target.value === "" ? null : e.target.value === "on" })}
                  className="h-8 rounded-lg bg-paper px-2 text-xs shadow-[inset_0_0_0_1px_rgba(28,25,23,0.14)]"
                >
                  <option value="">Inherit</option>
                  <option value="on">Force on</option>
                  <option value="off">Force off</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

/* ------------------------------------------------------------------ Notes */

function NotesTab({ d, onChange }: { d: Detail; onChange: () => void }) {
  const me = usePlatformMe();
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const add = useMutation({
    mutationFn: () => papi(`/tenants/${d.tenant.id}/notes`, { method: "POST", json: { body, pinned } }),
    onSuccess: () => {
      setBody("");
      setPinned(false);
      onChange();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const act = async (path: string, method: "POST" | "DELETE") => {
    try {
      await papi(`/tenants/${d.tenant.id}/notes/${path}`, { method });
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Panel title="Add a note" description="Internal only — shops never see these." icon={<PlusIcon size={16} />}>
        <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Context for the next person: calls, promises, quirks…" className={cn(controlClass, "h-auto w-full py-2")} />
        <label className="mt-3 flex items-center gap-2 text-sm text-ink-3">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="accent-ink" /> Pin to top
        </label>
        <button onClick={() => add.mutate()} disabled={!body.trim() || add.isPending} className="g-btn g-btn-primary mt-4 h-10 w-full text-sm">
          Save note
        </button>
      </Panel>
      <div className="space-y-3 lg:col-span-2">
        {d.notes.length === 0 ? (
          <EmptyBlock className="!m-0" title="No notes yet" />
        ) : (
          d.notes.map((n) => (
            <article key={n.id} className={cn("g-surface p-4", n.pinned && "ring-1 ring-gold-dark/30")}>
              <div className="flex items-start justify-between gap-3">
                <p className="whitespace-pre-wrap text-sm text-ink">{n.body}</p>
                {n.pinned ? <Pill tone="info">Pinned</Pill> : null}
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-ink-4">
                <span>
                  {n.author_name ?? "Unknown"} · {dateTime(n.created_at)}
                </span>
                <span className="flex gap-3">
                  <button onClick={() => act(`${n.id}/pin`, "POST")} className="hover:text-ink hover:underline">
                    {n.pinned ? "Unpin" : "Pin"}
                  </button>
                  {can(me.data, P.TENANTS_MANAGE) ? (
                    <button onClick={() => act(n.id, "DELETE")} className="text-rose-700 hover:underline">
                      Delete
                    </button>
                  ) : null}
                </span>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Support & activity */

function SupportTab({ tenantId }: { tenantId: string }) {
  const q = useQuery({
    queryKey: ["p-tickets", "tenant", tenantId],
    queryFn: () => papi<{ rows: Array<{ id: string; number: string; subject: string; status: string; priority: string; updated_at: number; assignee_name: string | null }> }>(`/support?tenantId=${tenantId}&limit=50`),
  });
  const rows = q.data?.rows ?? [];
  return (
    <TableCard title="Tickets" icon={<LifeBuoyIcon size={16} />} actions={<Link href={`/platform/support?new=${tenantId}`} className="g-btn g-btn-secondary h-9 px-3 text-sm"><PlusIcon size={14} /> New ticket</Link>}>
      {q.isLoading ? (
        <TableSkeleton rows={3} cols={4} />
      ) : rows.length === 0 ? (
        <EmptyBlock title="No tickets" />
      ) : (
        <table className="g-table">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Assignee</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/platform/support/${r.id}`} className="hover:underline">
                    <span className="font-mono text-xs text-ink-4">{r.number}</span> <span className="font-medium">{r.subject}</span>
                  </Link>
                </td>
                <td><StatusPill status={r.status} /></td>
                <td><PriorityPill p={r.priority} /></td>
                <td className="text-ink-3">{r.assignee_name ?? "—"}</td>
                <td className="text-ink-3">{relative(r.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

function ActivityTab({ tenantId }: { tenantId: string }) {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["p-audit", "tenant", tenantId, page],
    queryFn: () => papi<{ rows: Array<{ id: string; action: string; admin_name: string | null; reason: string | null; created_at: number; ip: string | null }>; total: number }>(`/tenants/${tenantId}/activity?page=${page}&limit=25`),
  });
  const rows = q.data?.rows ?? [];
  return (
    <TableCard title="Staff activity on this account" icon={<HistoryIcon size={16} />} footer={<Pager page={page} onChange={setPage} pageSize={25} count={rows.length} total={q.data?.total ?? 0} unit="events" />}>
      {q.isLoading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : rows.length === 0 ? (
        <EmptyBlock title="No activity" />
      ) : (
        <table className="g-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap text-ink-3">{dateTime(r.created_at)}</td>
                <td>{r.admin_name ?? "System"}</td>
                <td className="font-mono text-xs">{r.action}</td>
                <td className="max-w-md truncate text-ink-3" title={r.reason ?? undefined}>{r.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

/* ------------------------------------------------------------------ Profile */

function ProfileTab({ d, onChange }: { d: Detail; onChange: () => void }) {
  const me = usePlatformMe();
  const t = d.tenant;
  const [f, setF] = useState({
    name: t.name,
    legalName: t.legal_name ?? "",
    ownerName: t.owner_name,
    ownerEmail: t.owner_email,
    phone: t.phone ?? "",
    country: t.country,
    timezone: t.timezone,
    region: t.region,
    customDomain: t.custom_domain ?? "",
    dataPlane: t.data_plane ?? "",
    tags: t.tags.join(", "),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () =>
      papi(`/tenants/${t.id}`, {
        method: "PATCH",
        json: {
          name: f.name,
          legalName: f.legalName || null,
          ownerName: f.ownerName,
          ownerEmail: f.ownerEmail,
          phone: f.phone || null,
          country: f.country,
          timezone: f.timezone,
          region: f.region,
          customDomain: f.customDomain || null,
          dataPlane: f.dataPlane || null,
          tags: f.tags.split(",").map((s) => s.trim()).filter(Boolean),
        },
      }),
    onSuccess: () => {
      toast.success("Profile saved");
      onChange();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  const disabled = !can(me.data, P.TENANTS_MANAGE);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Panel className="lg:col-span-2" title="Account profile" icon={<SettingsIcon size={16} />} footer={disabled ? <span className="text-xs text-ink-4">Read-only for your role.</span> : (
        <div className="flex justify-end">
          <button onClick={() => save.mutate()} disabled={save.isPending} className="g-btn g-btn-primary h-10 px-4 text-sm">
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}>
        <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
          <F label="Business name"><input value={f.name} onChange={set("name")} className={cn(controlClass, "w-full")} /></F>
          <F label="Legal name"><input value={f.legalName} onChange={set("legalName")} className={cn(controlClass, "w-full")} /></F>
          <F label="Owner name"><input value={f.ownerName} onChange={set("ownerName")} className={cn(controlClass, "w-full")} /></F>
          <F label="Owner email"><input type="email" value={f.ownerEmail} onChange={set("ownerEmail")} className={cn(controlClass, "w-full")} /></F>
          <F label="Phone"><input value={f.phone} onChange={set("phone")} className={cn(controlClass, "w-full")} /></F>
          <F label="Country"><input maxLength={2} value={f.country} onChange={set("country")} className={cn(controlClass, "w-full font-mono")} /></F>
          <F label="Timezone"><input value={f.timezone} onChange={set("timezone")} className={cn(controlClass, "w-full")} /></F>
          <F label="Region"><input value={f.region} onChange={set("region")} className={cn(controlClass, "w-full")} /></F>
          <F label="Custom domain" hint="e.g. pos.kandygold.lk — used for sign-in links"><input value={f.customDomain} onChange={set("customDomain")} className={cn(controlClass, "w-full font-mono")} /></F>
          <F label="Data plane binding" hint="D1 binding name serving this shop, e.g. DB_KANDY"><input value={f.dataPlane} onChange={set("dataPlane")} className={cn(controlClass, "w-full font-mono")} /></F>
          <F label="Tags" hint="Comma separated" className="sm:col-span-2"><input value={f.tags} onChange={set("tags")} className={cn(controlClass, "w-full")} /></F>
        </fieldset>
      </Panel>
      <Panel title="Identifiers" icon={<AlertCircleIcon size={16} />}>
        <DetailList
          items={[
            { label: "Tenant ID", value: <code className="break-all font-mono text-xs">{t.id}</code> },
            { label: "Subdomain", value: <code className="font-mono text-xs">{t.slug}</code> },
            { label: "Billing currency", value: t.currency },
            { label: "Created", value: dateTime(t.created_at) },
          ]}
        />
        <p className="mt-4 text-xs text-ink-4">
          Set <code className="font-mono">TENANT_ID</code> on the shop&rsquo;s API worker to this ID so the gate, plan limits and announcements apply to it.
        </p>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ Impersonation */

function ImpersonateDialog({ tenant, onClose }: { tenant: Detail["tenant"]; onClose: () => void }) {
  const [target, setTarget] = useState(tenant.owner_email);
  const [grant, setGrant] = useState<{ url: string; expiresAt: number; targetEmail: string } | null>(null);
  const history = useQuery({
    queryKey: ["p-impersonations", tenant.id],
    queryFn: () => papi<Array<{ id: string; target_email: string; reason: string; created_at: number; consumed_at: number | null; admin_name: string }>>(`/tenants/${tenant.id}/impersonations`),
  });

  if (grant) {
    return (
      <Modal title="Sign-in link ready" kicker="Impersonation" onClose={onClose} footer={false}>
        <Callout tone="warning" title="Single use">
          Valid until {dateTime(grant.expiresAt)} for <strong>{grant.targetEmail}</strong>. Open it in a private window so your own shop session is not replaced. The shop&rsquo;s audit log records that you signed in.
        </Callout>
        <input readOnly value={grant.url} onFocus={(e) => e.currentTarget.select()} className={cn(controlClass, "w-full font-mono text-xs")} aria-label="Sign-in link" />
        <div className="flex justify-end gap-2">
          <button
            onClick={() => navigator.clipboard.writeText(grant.url).then(() => toast.success("Copied"), () => toast.error("Copy failed"))}
            className="g-btn g-btn-secondary h-10 px-4 text-sm"
          >
            Copy link
          </button>
          <a href={grant.url} target="_blank" rel="noreferrer noopener" className="g-btn g-btn-primary h-10 px-4 text-sm">
            Open
          </a>
        </div>
      </Modal>
    );
  }

  return (
    <ReasonDialog
      title={`Sign in to ${tenant.name}`}
      kicker="Impersonation"
      submitLabel="Create sign-in link"
      closeOnSuccess={false}
      description="Creates a one-time link that signs you in as a user of this shop for up to an hour."
      onClose={onClose}
      onSubmit={async (reason) => {
        const g = await papi<{ url: string; expiresAt: number; targetEmail: string }>(`/tenants/${tenant.id}/impersonate`, { method: "POST", json: { targetEmail: target, reason } });
        setGrant(g);
      }}
    >
      <F label="Sign in as" hint="Must be an active user in the shop">
        <input type="email" value={target} onChange={(e) => setTarget(e.target.value)} className={cn(controlClass, "w-full")} />
      </F>
      {(history.data ?? []).length > 0 ? (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4">Recent</div>
          <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-ink-3 scrollbar-thin">
            {history.data!.slice(0, 5).map((h) => (
              <li key={h.id}>
                {h.admin_name} → {h.target_email} · {relative(h.created_at)} · {h.consumed_at ? "used" : "unused"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </ReasonDialog>
  );
}
