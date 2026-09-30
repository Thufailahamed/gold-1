"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Area, Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PLATFORM_PERMISSIONS as P } from "@goldos/shared";
import {
  BarList,
  CardLink,
  EmptyBlock,
  Hero,
  heroBtnGhost,
  heroBtnPrimary,
  MetricCard,
  Page,
  Panel,
  Pill,
  Skeleton,
  StatusPill,
} from "@/components/ui";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  Building2Icon,
  CoinsIcon,
  LifeBuoyIcon,
  PlusIcon,
  TrendingUpIcon,
  UsersIcon,
} from "@/components/icons";
import { can, date, monthLabel, money, moneyShort, papi, relative, titleCase, usePlatformMe } from "@/lib/platform";

type Overview = {
  kpis: {
    mrr_cents: number;
    arr_cents: number;
    arpa_cents: number;
    paying_accounts: number;
    total_accounts: number;
    new_accounts_30d: number;
    churned_accounts_30d: number;
    revenue_churn_pct_30d: number;
    net_new_mrr_30d: number;
    collected_30d_cents: number;
    open_receivables_cents: number;
    overdue_cents: number;
    overdue_invoices: number;
    open_tickets: number;
    urgent_tickets: number;
    unanswered_tickets: number;
  };
  tenantCounts: Record<string, number>;
  subCounts: Record<string, number>;
  movement30d: { new: number; expansion: number; contraction: number; churn: number };
  trend: Array<{ month: string; mrr_cents: number; net_new_cents: number; collected_cents: number; signups: number }>;
  planMix: Array<{ plan: string; code: string; accounts: number; mrr_cents: number }>;
  trialsEnding: Array<{ id: string; name: string; slug: string; trial_ends_at: number; plan_name: string }>;
  atRisk: Array<{ id: string; name: string; slug: string; status: string; sub_status: string; past_due_since: number | null; open_cents: number }>;
  activity: Array<{ id: string; action: string; entity: string; tenant_id: string | null; tenant_name: string | null; admin_name: string | null; reason: string | null; created_at: number }>;
};

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtMoney = (n: number) => moneyShort(Math.round(n));

export default function PlatformDashboard() {
  const me = usePlatformMe();
  const q = useQuery({ queryKey: ["platform-overview"], queryFn: () => papi<Overview>("/overview"), refetchInterval: 60_000 });
  const d = q.data;
  const k = d?.kpis;

  const trend = (d?.trend ?? []).map((t) => ({
    label: monthLabel(t.month),
    mrr: t.mrr_cents / 100,
    collected: t.collected_cents / 100,
  }));
  const mv = d?.movement30d;

  return (
    <Page className="max-w-[88rem]">
      <Hero
        kicker="Platform overview"
        title={me.data ? `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${me.data.admin.name.split(" ")[0]}` : "Platform overview"}
        description="Revenue, account health and the queue that needs you — across every shop on GoldOS."
        actions={
          <>
            {can(me.data, P.TENANTS_MANAGE) ? (
              <Link href="/platform/tenants?new=1" className={heroBtnPrimary}>
                <PlusIcon size={15} /> New account
              </Link>
            ) : null}
            <Link href="/platform/billing" className={heroBtnGhost}>
              Billing <ArrowRightIcon size={14} />
            </Link>
          </>
        }
        stats={[
          { label: "MRR", value: k ? money(k.mrr_cents) : "—" },
          { label: "ARR run-rate", value: k ? moneyShort(k.arr_cents) : "—" },
          { label: "Paying accounts", value: k ? `${k.paying_accounts} / ${k.total_accounts}` : "—" },
          { label: "ARPA", value: k ? money(k.arpa_cents) : "—" },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Net new MRR · 30d"
          value={k ? k.net_new_mrr_30d : undefined}
          format={fmtMoney}
          icon={<TrendingUpIcon size={16} />}
          sub={k ? `${k.new_accounts_30d} new accounts · ${k.churned_accounts_30d} churned` : undefined}
          loading={q.isLoading}
        />
        <MetricCard
          label="Revenue churn · 30d"
          value={k ? k.revenue_churn_pct_30d : undefined}
          format={(n) => `${n.toFixed(1)}%`}
          icon={<AlertCircleIcon size={16} />}
          sub="Churned + contracted MRR vs. start of window"
          loading={q.isLoading}
        />
        <MetricCard
          label="Collected · 30d"
          value={k ? k.collected_30d_cents : undefined}
          format={fmtMoney}
          icon={<CoinsIcon size={16} />}
          sub={k ? `${money(k.open_receivables_cents)} open receivables` : undefined}
          href="/platform/billing"
          loading={q.isLoading}
        />
        <MetricCard
          label="Overdue"
          value={k ? k.overdue_cents : undefined}
          format={fmtMoney}
          icon={<AlertCircleIcon size={16} />}
          sub={k ? `${k.overdue_invoices} invoice${k.overdue_invoices === 1 ? "" : "s"} past due` : undefined}
          href="/platform/billing?tab=invoices&overdue=1"
          loading={q.isLoading}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Recurring revenue"
          description="MRR at each month end, with cash collected in the month"
          icon={<TrendingUpIcon size={16} />}
        >
          {q.isLoading ? (
            <Skeleton className="h-72" />
          ) : (
            <div className="h-72" role="img" aria-label="Monthly recurring revenue trend for the last 12 months">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trend} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="p-mrr-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#C9A227" stopOpacity={0.35} />
                      <stop offset="1" stopColor="#C9A227" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(28,25,23,0.06)" strokeDasharray="3 5" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#78716c", fontSize: 11 }} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    tick={{ fill: "#78716c", fontSize: 11 }}
                    tickFormatter={(v: number) => new Intl.NumberFormat("en-US", { notation: "compact" }).format(v)}
                  />
                  <Tooltip
                    cursor={{ stroke: "rgba(168,134,27,0.35)", strokeDasharray: "3 3" }}
                    contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 12px 32px -16px rgba(28,25,23,0.3)", fontSize: 12 }}
                    formatter={(v, name) => [money(Math.round(Number(v ?? 0) * 100)), name === "mrr" ? "MRR" : "Collected"]}
                  />
                  <Bar dataKey="collected" fill="#1c1917" fillOpacity={0.12} radius={[4, 4, 0, 0]} barSize={18} />
                  <Area type="monotone" dataKey="mrr" stroke="#A8861B" strokeWidth={2.5} fill="url(#p-mrr-fill)" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="MRR movement · 30 days" description="Where this month's change came from" icon={<CoinsIcon size={16} />}>
          {mv ? (
            <ul className="space-y-3">
              {(
                [
                  ["New business", mv.new, "text-emerald-700", "+"],
                  ["Expansion", mv.expansion, "text-emerald-700", "+"],
                  ["Contraction", mv.contraction, "text-amber-700", "−"],
                  ["Churn", mv.churn, "text-rose-700", "−"],
                ] as const
              ).map(([label, v, tone, sign]) => (
                <li key={label} className="flex items-center justify-between rounded-xl bg-bone/70 px-4 py-3 ring-1 ring-ink/[0.06]">
                  <span className="text-sm text-ink-3">{label}</span>
                  <span className={`g-metric text-sm ${v === 0 ? "text-ink-4" : tone}`}>
                    {v === 0 ? "—" : `${sign}${money(v)}`}
                  </span>
                </li>
              ))}
              <li className="flex items-center justify-between border-t border-ink/[0.07] px-1 pt-3">
                <span className="text-sm font-semibold text-ink">Net</span>
                <span className="g-metric text-base text-ink">{money(k?.net_new_mrr_30d ?? 0)}</span>
              </li>
            </ul>
          ) : (
            <Skeleton className="h-56" />
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Plan mix" description="Accounts and MRR by plan" icon={<Building2Icon size={16} />} actions={<CardLink href="/platform/plans">Plans</CardLink>}>
          <BarList
            tone="light"
            items={(d?.planMix ?? []).map((p) => ({ key: p.code, label: p.plan, value: p.mrr_cents, secondary: `${p.accounts} account${p.accounts === 1 ? "" : "s"}` }))}
            format={(n) => moneyShort(n)}
            empty={<p className="text-sm text-ink-4">No subscriptions yet.</p>}
          />
          {d ? (
            <div className="mt-5 flex flex-wrap gap-1.5">
              {Object.entries(d.subCounts).map(([s, n]) => (
                <StatusPill key={s} status={s} label={`${titleCase(s)} · ${n}`} />
              ))}
            </div>
          ) : null}
        </Panel>

        <Panel title="Trials ending" description="Next 7 days — a good time to reach out" icon={<UsersIcon size={16} />}>
          {(d?.trialsEnding ?? []).length === 0 ? (
            <p className="text-sm text-ink-4">No trials end this week.</p>
          ) : (
            <ul className="divide-y divide-ink/[0.06]">
              {d!.trialsEnding.map((t) => (
                <li key={t.id}>
                  <Link href={`/platform/tenants/${t.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-gold-dark">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{t.name}</span>
                      <span className="block truncate font-mono text-[11px] text-ink-4">{t.slug} · {t.plan_name}</span>
                    </span>
                    <Pill tone={t.trial_ends_at < Date.now() ? "danger" : "warning"}>{relative(t.trial_ends_at)}</Pill>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Needs attention" description="Past due, suspended or cancelling" icon={<AlertCircleIcon size={16} />} actions={<CardLink href="/platform/tenants?subStatus=PAST_DUE">All</CardLink>}>
          {(d?.atRisk ?? []).length === 0 ? (
            <p className="text-sm text-ink-4">Every account is in good standing.</p>
          ) : (
            <ul className="divide-y divide-ink/[0.06]">
              {d!.atRisk.map((t) => (
                <li key={t.id}>
                  <Link href={`/platform/tenants/${t.id}`} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{t.name}</span>
                      <span className="block text-[11px] text-ink-4">
                        {t.open_cents > 0 ? `${money(t.open_cents)} open` : "No balance"}
                        {t.past_due_since ? ` · since ${date(t.past_due_since)}` : ""}
                      </span>
                    </span>
                    <StatusPill status={t.status === "SUSPENDED" ? "suspended" : t.sub_status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          title="Support queue"
          icon={<LifeBuoyIcon size={16} />}
          actions={<CardLink href="/platform/support">Open desk</CardLink>}
        >
          <dl className="grid grid-cols-3 gap-3 text-center">
            {(
              [
                ["Open", k?.open_tickets],
                ["Urgent", k?.urgent_tickets],
                ["No reply", k?.unanswered_tickets],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="rounded-xl bg-bone/70 p-3 ring-1 ring-ink/[0.06]">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-4">{label}</dt>
                <dd className="g-metric mt-1 text-2xl text-ink">{v === undefined ? "—" : fmtInt(v)}</dd>
              </div>
            ))}
          </dl>
          {d ? (
            <div className="mt-5 flex flex-wrap gap-1.5">
              {Object.entries(d.tenantCounts).map(([s, n]) => (
                <StatusPill key={s} status={s} label={`${titleCase(s)} accounts · ${n}`} />
              ))}
            </div>
          ) : null}
        </Panel>

        <Panel className="lg:col-span-2" title="Recent staff activity" icon={<UsersIcon size={16} />} actions={<CardLink href="/platform/audit">Audit log</CardLink>}>
          {(d?.activity ?? []).length === 0 ? (
            <EmptyBlock className="!m-0" title="Nothing yet" description="Account, billing and settings changes appear here." />
          ) : (
            <ul className="divide-y divide-ink/[0.06]">
              {d!.activity.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium text-ink">{a.admin_name ?? "System"}</span>{" "}
                    <span className="font-mono text-xs text-ink-3">{a.action}</span>
                    {a.tenant_name ? (
                      <>
                        {" · "}
                        <Link href={`/platform/tenants/${a.tenant_id}`} className="text-gold-dark hover:underline">
                          {a.tenant_name}
                        </Link>
                      </>
                    ) : null}
                    {a.reason ? <p className="mt-0.5 truncate text-xs text-ink-4">“{a.reason}”</p> : null}
                  </div>
                  <span className="shrink-0 text-[11px] text-ink-5">{relative(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </Page>
  );
}
