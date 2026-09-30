"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PLATFORM_PERMISSIONS as P } from "@goldos/shared";
import {
  CellStack,
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
  controlClass,
  controlSmClass,
} from "@/components/ui";
import { FileDownIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { F } from "@/components/platform/dialogs";
import { cn } from "@/lib/cn";
import { can, date, money, papi, pdownload, relative, usePlatformMe } from "@/lib/platform";

type PlanOpt = { id: string; code: string; name: string; price_monthly_cents: number; price_yearly_cents: number; trial_days: number; currency: string };

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  owner_email: string;
  owner_name: string;
  country: string;
  currency: string;
  created_at: number;
  last_active_at: number | null;
  plan_name: string | null;
  sub_status: string | null;
  billing_interval: string | null;
  trial_ends_at: number | null;
  cancel_at_period_end: number | null;
  open_balance_cents: number;
  mrr_cents: number;
  tags: string[];
};

const PAGE = 25;

function TenantsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const me = usePlatformMe();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [subStatus, setSubStatus] = useState(params.get("subStatus") ?? "");
  const [planId, setPlanId] = useState("");
  const [sort, setSort] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(params.get("new") === "1");

  const qs = new URLSearchParams({ page: String(page), limit: String(PAGE), search, status, subStatus, planId, sort }).toString();
  const list = useQuery({ queryKey: ["p-tenants", qs], queryFn: () => papi<{ rows: TenantRow[]; total: number }>(`/tenants?${qs}`) });
  const plans = useQuery({ queryKey: ["p-plans"], queryFn: () => papi<PlanOpt[]>("/plans") });
  const rows = list.data?.rows ?? [];

  useEffect(() => setPage(1), [search, status, subStatus, planId, sort]);

  return (
    <Page className="max-w-[88rem]">
      <Hero
        kicker="Customers"
        title="Accounts"
        description="Every shop on the platform — its plan, standing and activity."
        actions={
          <>
            {can(me.data, P.TENANTS_MANAGE) ? (
              <button onClick={() => setCreating(true)} className={heroBtnPrimary}>
                <PlusIcon size={15} /> New account
              </button>
            ) : null}
            <button
              onClick={() =>
                pdownload(`/tenants/export.csv?${new URLSearchParams({ search, status, subStatus, planId })}`, "accounts.csv").catch((e: Error) => toast.error(e.message))
              }
              className={heroBtnGhost}
            >
              <FileDownIcon size={15} /> Export CSV
            </button>
          </>
        }
        stats={[
          { label: "Matching", value: list.data?.total ?? "—" },
          { label: "MRR (page)", value: list.data ? money(rows.reduce((s, r) => s + r.mrr_cents, 0)) : "—" },
          { label: "Open balance (page)", value: list.data ? money(rows.reduce((s, r) => s + r.open_balance_cents, 0)) : "—" },
          { label: "Trialing (page)", value: list.data ? rows.filter((r) => r.sub_status === "TRIALING").length : "—" },
        ]}
      />

      <TableCard
        toolbar={
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <div className="relative w-full lg:max-w-sm">
                <SearchIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
                <input
                  aria-label="Search accounts"
                  placeholder="Name, subdomain, owner email, domain…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={cn(controlClass, "w-full pl-9")}
                />
              </div>
              <div className="flex flex-wrap gap-2 lg:ml-auto">
                <select aria-label="Subscription status" value={subStatus} onChange={(e) => setSubStatus(e.target.value)} className={controlSmClass}>
                  <option value="">Any subscription</option>
                  <option value="TRIALING">Trialing</option>
                  <option value="ACTIVE">Active</option>
                  <option value="PAST_DUE">Past due</option>
                  <option value="CANCELED">Cancelled</option>
                </select>
                <select aria-label="Plan" value={planId} onChange={(e) => setPlanId(e.target.value)} className={controlSmClass}>
                  <option value="">Any plan</option>
                  {(plans.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} className={controlSmClass}>
                  <option value="">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="name">Name A–Z</option>
                  <option value="active">Recently active</option>
                  <option value="balance">Highest balance</option>
                </select>
              </div>
            </div>
            <FilterChips
              ariaLabel="Account status"
              value={status}
              onChange={setStatus}
              options={[
                { key: "", label: "All" },
                { key: "ACTIVE", label: "Active" },
                { key: "SUSPENDED", label: "Suspended" },
                { key: "ARCHIVED", label: "Archived" },
              ]}
            />
          </div>
        }
        footer={<Pager page={page} onChange={setPage} pageSize={PAGE} count={rows.length} total={list.data?.total ?? 0} unit="accounts" />}
      >
        {list.isLoading ? (
          <TableSkeleton rows={8} cols={7} />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No accounts match" description={search || status || subStatus || planId ? "Try clearing a filter." : "Create the first account to get started."} />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Plan</th>
                <th>Subscription</th>
                <th className="!text-right">MRR</th>
                <th className="!text-right">Balance</th>
                <th>Last active</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer" onClick={() => router.push(`/platform/tenants/${r.id}`)}>
                  <td>
                    <Link href={`/platform/tenants/${r.id}`} className="group flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink font-mono text-[10px] font-bold text-gold group-hover:bg-gold group-hover:text-ink">
                        {r.name.slice(0, 2).toUpperCase()}
                      </span>
                      <CellStack primary={<span className="group-hover:underline">{r.name}</span>} secondary={`${r.slug} · ${r.owner_email}`} />
                    </Link>
                  </td>
                  <td>
                    <CellStack primary={r.plan_name ?? "—"} secondary={r.billing_interval === "YEAR" ? "Annual" : r.billing_interval ? "Monthly" : undefined} />
                  </td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {r.status !== "ACTIVE" ? <StatusPill status={r.status} /> : null}
                      {r.sub_status ? <StatusPill status={r.sub_status} /> : null}
                      {r.sub_status === "TRIALING" && r.trial_ends_at ? <span className="text-[11px] text-ink-4">ends {relative(r.trial_ends_at)}</span> : null}
                      {r.cancel_at_period_end ? <Pill tone="warning">Cancelling</Pill> : null}
                    </div>
                  </td>
                  <td className="num">{r.mrr_cents ? money(r.mrr_cents, r.currency) : "—"}</td>
                  <td className={cn("num", r.open_balance_cents > 0 && "text-amber-700")}>{r.open_balance_cents ? money(r.open_balance_cents, r.currency) : "—"}</td>
                  <td className="text-ink-3">{relative(r.last_active_at)}</td>
                  <td className="text-ink-3">{date(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {creating ? (
        <CreateTenantDialog
          plans={plans.data ?? []}
          onClose={() => {
            setCreating(false);
            if (params.get("new")) router.replace("/platform/tenants");
          }}
          onCreated={(id) => {
            qc.invalidateQueries({ queryKey: ["p-tenants"] });
            router.push(`/platform/tenants/${id}`);
          }}
        />
      ) : null}
    </Page>
  );
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function CreateTenantDialog({ plans, onClose, onCreated }: { plans: PlanOpt[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({
    name: "",
    slug: "",
    legalName: "",
    ownerName: "",
    ownerEmail: "",
    phone: "",
    country: "LK",
    currency: "LKR",
    planId: "",
    interval: "MONTH" as "MONTH" | "YEAR",
    trialDays: "",
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const plan = plans.find((p) => p.id === f.planId);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const create = useMutation({
    mutationFn: () =>
      papi<{ id: string; invoiceNumber: string | null }>("/tenants", {
        method: "POST",
        json: {
          name: f.name,
          slug: f.slug,
          legalName: f.legalName || undefined,
          ownerName: f.ownerName,
          ownerEmail: f.ownerEmail,
          phone: f.phone || undefined,
          country: f.country,
          currency: f.currency,
          planId: f.planId,
          interval: f.interval,
          trialDays: f.trialDays === "" ? undefined : Number(f.trialDays),
          tags: [],
        },
      }),
    onSuccess: (r) => {
      toast.success(r.invoiceNumber ? `Account created · invoice ${r.invoiceNumber} issued` : "Account created · trial started");
      onCreated(r.id);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  const valid = f.name.length >= 2 && f.slug.length >= 3 && f.ownerName && /.+@.+\..+/.test(f.ownerEmail) && f.planId;

  return (
    <Modal title="New account" kicker="Provision" wide onClose={onClose} onSubmit={() => create.mutate()} submitLabel="Create account" pending={create.isPending} submitDisabled={!valid}>
      <div className="grid gap-4 sm:grid-cols-2">
        <F label="Business name">
          <input
            autoFocus
            value={f.name}
            onChange={(e) => {
              set("name", e.target.value);
              if (!slugTouched) set("slug", slugify(e.target.value));
            }}
            className={cn(controlClass, "w-full")}
          />
        </F>
        <F label="Subdomain" hint={f.slug ? `${f.slug}.goldos.lk` : "Lowercase letters, digits, dashes"}>
          <input
            value={f.slug}
            onChange={(e) => {
              setSlugTouched(true);
              set("slug", slugify(e.target.value));
            }}
            className={cn(controlClass, "w-full font-mono")}
          />
        </F>
        <F label="Legal name" hint="Printed on invoices (optional)">
          <input value={f.legalName} onChange={(e) => set("legalName", e.target.value)} className={cn(controlClass, "w-full")} />
        </F>
        <F label="Phone">
          <input value={f.phone} onChange={(e) => set("phone", e.target.value)} className={cn(controlClass, "w-full")} />
        </F>
        <F label="Owner name">
          <input value={f.ownerName} onChange={(e) => set("ownerName", e.target.value)} className={cn(controlClass, "w-full")} />
        </F>
        <F label="Owner email" hint="Billing contact; default impersonation target">
          <input type="email" value={f.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} className={cn(controlClass, "w-full")} />
        </F>
        <F label="Country">
          <input maxLength={2} value={f.country} onChange={(e) => set("country", e.target.value.toUpperCase())} className={cn(controlClass, "w-full font-mono")} />
        </F>
        <F label="Billing currency">
          <input maxLength={3} value={f.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} className={cn(controlClass, "w-full font-mono")} />
        </F>
      </div>
      <div className="rounded-xl bg-bone/70 p-4 ring-1 ring-ink/[0.06]">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4">Subscription</div>
        <div className="grid gap-4 sm:grid-cols-3">
          <F label="Plan">
            <select value={f.planId} onChange={(e) => set("planId", e.target.value)} className={cn(controlClass, "w-full")}>
              <option value="">Select…</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </F>
          <F label="Billing">
            <select value={f.interval} onChange={(e) => set("interval", e.target.value as "MONTH" | "YEAR")} className={cn(controlClass, "w-full")}>
              <option value="MONTH">Monthly</option>
              <option value="YEAR">Annual</option>
            </select>
          </F>
          <F label="Trial days" hint={plan ? `Plan default: ${plan.trial_days}. 0 bills now.` : undefined}>
            <input type="number" min={0} max={365} value={f.trialDays} placeholder={plan ? String(plan.trial_days) : ""} onChange={(e) => set("trialDays", e.target.value)} className={cn(controlClass, "w-full")} />
          </F>
        </div>
        {plan ? (
          <p className="mt-3 text-xs text-ink-4">
            {money(f.interval === "YEAR" ? plan.price_yearly_cents : plan.price_monthly_cents, plan.currency)} per {f.interval === "YEAR" ? "year" : "month"}, before tax.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

export default function TenantsPage() {
  return (
    <Suspense>
      <TenantsInner />
    </Suspense>
  );
}
