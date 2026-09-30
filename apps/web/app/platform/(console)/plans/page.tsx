"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PLATFORM_PERMISSIONS as P } from "@goldos/shared";
import { Callout, EmptyBlock, Hero, heroBtnPrimary, Modal, Page, Pill, Skeleton, controlClass } from "@/components/ui";
import { CheckIcon, EditIcon, PlusIcon } from "@/components/icons";
import { F, Toggle } from "@/components/platform/dialogs";
import { cn } from "@/lib/cn";
import { can, money, papi, usePlatformMe } from "@/lib/platform";

type Plan = {
  id: string;
  code: string;
  name: string;
  description: string;
  price_monthly_cents: number;
  price_yearly_cents: number;
  currency: string;
  trial_days: number;
  max_users: number | null;
  max_branches: number | null;
  max_products: number | null;
  max_storage_mb: number | null;
  features: string[];
  is_public: number;
  is_active: number;
  sort_order: number;
  subscribers: number;
};
type Flag = { key: string; description: string };

const lim = (n: number | null, unit = "") => (n === null ? "Unlimited" : `${n.toLocaleString()}${unit}`);

export default function PlansPage() {
  const me = usePlatformMe();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const q = useQuery({ queryKey: ["p-plans", showArchived], queryFn: () => papi<Plan[]>(`/plans${showArchived ? "?all=1" : ""}`) });
  const flags = useQuery({ queryKey: ["p-flags"], queryFn: () => papi<Flag[]>("/flags") });
  const manage = can(me.data, P.PLANS_MANAGE);
  const plans = q.data ?? [];

  return (
    <Page className="max-w-[88rem]">
      <Hero
        kicker="Revenue"
        title="Plans & pricing"
        description="What each tier costs, what it limits and which features it unlocks."
        actions={
          manage ? (
            <button onClick={() => setEditing("new")} className={heroBtnPrimary}>
              <PlusIcon size={15} /> New plan
            </button>
          ) : undefined
        }
        stats={[
          { label: "Active plans", value: plans.filter((p) => p.is_active).length },
          { label: "Subscribed accounts", value: plans.reduce((s, p) => s + p.subscribers, 0) },
          { label: "Public", value: plans.filter((p) => p.is_public && p.is_active).length },
          { label: "Features in catalogue", value: flags.data?.length ?? "—" },
        ]}
      />

      <Callout tone="info" title="List price changes never reprice existing accounts">
        Each subscription keeps the price it signed up at. To move a customer to a new price, change their plan from the account page.
      </Callout>

      <div className="flex items-center justify-end gap-2 text-sm text-ink-3">
        <span>Show archived</span>
        <Toggle checked={showArchived} onChange={setShowArchived} label="Show archived plans" />
      </div>

      {q.isLoading ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-96 rounded-xl" />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <EmptyBlock title="No plans" />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((p) => (
            <article key={p.id} className={cn("g-surface relative flex flex-col p-6", !p.is_active && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-4">{p.code}</div>
                  <h2 className="g-display mt-1 text-2xl text-ink">{p.name}</h2>
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {!p.is_active ? <Pill>Archived</Pill> : null}
                  {p.is_active && !p.is_public ? <Pill tone="warning">Private</Pill> : null}
                  <Pill tone="dark">{p.subscribers} accounts</Pill>
                </div>
              </div>
              <p className="mt-2 min-h-10 text-sm text-ink-3">{p.description}</p>
              <div className="mt-5 flex items-baseline gap-1.5">
                <span className="g-metric text-3xl text-ink">{money(p.price_monthly_cents, p.currency)}</span>
                <span className="text-sm text-ink-4">/ mo</span>
              </div>
              <div className="text-xs text-ink-4">
                or {money(p.price_yearly_cents, p.currency)} / yr
                {p.price_monthly_cents > 0 && p.price_yearly_cents > 0
                  ? ` · ${Math.round((1 - p.price_yearly_cents / (p.price_monthly_cents * 12)) * 100)}% annual saving`
                  : ""}
                {" · "}
                {p.trial_days}-day trial
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-2 text-xs">
                {(
                  [
                    ["Users", lim(p.max_users)],
                    ["Branches", lim(p.max_branches)],
                    ["Products", lim(p.max_products)],
                    ["Storage", p.max_storage_mb === null ? "Unlimited" : `${(p.max_storage_mb / 1024).toFixed(p.max_storage_mb < 1024 ? 1 : 0)} GB`],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-bone/70 px-3 py-2 ring-1 ring-ink/[0.06]">
                    <dt className="text-ink-4">{k}</dt>
                    <dd className="g-metric mt-0.5 text-sm text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
              <ul className="mt-5 flex-1 space-y-1.5 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-ink-2">
                    <CheckIcon size={14} className="shrink-0 text-gold-dark" />
                    <span className="font-mono text-xs">{f}</span>
                  </li>
                ))}
              </ul>
              {manage ? (
                <button onClick={() => setEditing(p)} className="g-btn g-btn-secondary mt-6 h-10 w-full text-sm">
                  <EditIcon size={14} /> Edit plan
                </button>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {editing ? <PlanDialog plan={editing === "new" ? null : editing} flags={flags.data ?? []} onClose={() => setEditing(null)} /> : null}
    </Page>
  );
}

function PlanDialog({ plan, flags, onClose }: { plan: Plan | null; flags: Flag[]; onClose: () => void }) {
  const qc = useQueryClient();
  const n = (v: number | null) => (v === null ? "" : String(v));
  const [f, setF] = useState({
    code: plan?.code ?? "",
    name: plan?.name ?? "",
    description: plan?.description ?? "",
    monthly: plan ? (plan.price_monthly_cents / 100).toFixed(2) : "",
    yearly: plan ? (plan.price_yearly_cents / 100).toFixed(2) : "",
    currency: plan?.currency ?? "LKR",
    trialDays: String(plan?.trial_days ?? 14),
    maxUsers: n(plan?.max_users ?? null),
    maxBranches: n(plan?.max_branches ?? null),
    maxProducts: n(plan?.max_products ?? null),
    maxStorageMb: n(plan?.max_storage_mb ?? null),
    sortOrder: String(plan?.sort_order ?? 0),
    isPublic: plan ? plan.is_public === 1 : true,
    isActive: plan ? plan.is_active === 1 : true,
    features: new Set(plan?.features ?? []),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const limit = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v))));
  const body = {
    name: f.name,
    description: f.description,
    priceMonthlyCents: Math.round(Number(f.monthly || 0) * 100),
    priceYearlyCents: Math.round(Number(f.yearly || 0) * 100),
    currency: f.currency,
    trialDays: Number(f.trialDays || 0),
    maxUsers: limit(f.maxUsers),
    maxBranches: limit(f.maxBranches),
    maxProducts: limit(f.maxProducts),
    maxStorageMb: limit(f.maxStorageMb),
    features: [...f.features],
    isPublic: f.isPublic,
    sortOrder: Number(f.sortOrder || 0),
  };
  const save = useMutation({
    mutationFn: () =>
      plan
        ? papi(`/plans/${plan.id}`, { method: "PATCH", json: { ...body, isActive: f.isActive } })
        : papi("/plans", { method: "POST", json: { ...body, code: f.code } }),
    onSuccess: () => {
      toast.success(plan ? "Plan saved" : "Plan created");
      qc.invalidateQueries({ queryKey: ["p-plans"] });
      qc.invalidateQueries({ queryKey: ["p-flags"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  return (
    <Modal title={plan ? `Edit ${plan.name}` : "New plan"} kicker="Plans" wide onClose={onClose} onSubmit={() => save.mutate()} submitLabel={plan ? "Save plan" : "Create plan"} pending={save.isPending} submitDisabled={!f.name || (!plan && f.code.length < 2)}>
      <div className="grid gap-4 sm:grid-cols-3">
        <F label="Code" hint={plan ? "Fixed after creation" : "Lowercase, e.g. growth"}>
          <input disabled={!!plan} value={f.code} onChange={(e) => setF((s) => ({ ...s, code: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") }))} className={cn(controlClass, "w-full font-mono")} />
        </F>
        <F label="Name" className="sm:col-span-2">
          <input value={f.name} onChange={set("name")} className={cn(controlClass, "w-full")} />
        </F>
        <F label="Description" className="sm:col-span-3">
          <textarea rows={2} value={f.description} onChange={set("description")} className={cn(controlClass, "h-auto w-full py-2")} />
        </F>
        <F label={`Monthly price (${f.currency})`}>
          <input inputMode="decimal" value={f.monthly} onChange={set("monthly")} className={cn(controlClass, "w-full font-mono")} />
        </F>
        <F label={`Annual price (${f.currency})`}>
          <input inputMode="decimal" value={f.yearly} onChange={set("yearly")} className={cn(controlClass, "w-full font-mono")} />
        </F>
        <F label="Trial days">
          <input type="number" min={0} max={365} value={f.trialDays} onChange={set("trialDays")} className={cn(controlClass, "w-full")} />
        </F>
      </div>
      <div className="rounded-xl bg-bone/70 p-4 ring-1 ring-ink/[0.06]">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4">Limits · blank = unlimited</div>
        <div className="grid gap-4 sm:grid-cols-4">
          <F label="Users"><input type="number" min={0} value={f.maxUsers} onChange={set("maxUsers")} className={cn(controlClass, "w-full")} /></F>
          <F label="Branches"><input type="number" min={0} value={f.maxBranches} onChange={set("maxBranches")} className={cn(controlClass, "w-full")} /></F>
          <F label="Products"><input type="number" min={0} value={f.maxProducts} onChange={set("maxProducts")} className={cn(controlClass, "w-full")} /></F>
          <F label="Storage (MB)"><input type="number" min={0} value={f.maxStorageMb} onChange={set("maxStorageMb")} className={cn(controlClass, "w-full")} /></F>
        </div>
      </div>
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4">Included features</div>
        <div className="grid max-h-56 gap-1.5 overflow-y-auto sm:grid-cols-2 scrollbar-thin">
          {flags.map((fl) => {
            const on = f.features.has(fl.key);
            return (
              <label key={fl.key} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg p-2.5 ring-1 transition-colors", on ? "bg-gold-pale ring-gold-dark/25" : "ring-ink/[0.08] hover:bg-bone")}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    setF((s) => {
                      const next = new Set(s.features);
                      if (next.has(fl.key)) next.delete(fl.key);
                      else next.add(fl.key);
                      return { ...s, features: next };
                    })
                  }
                  className="mt-0.5 accent-ink"
                />
                <span className="min-w-0">
                  <span className="block font-mono text-xs font-semibold">{fl.key}</span>
                  <span className="block truncate text-[11px] text-ink-4">{fl.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-6 border-t border-ink/[0.07] pt-4 text-sm">
        <label className="flex items-center gap-2.5">
          <Toggle checked={f.isPublic} onChange={(v) => setF((s) => ({ ...s, isPublic: v }))} label="Public" /> Shown on the pricing page
        </label>
        {plan ? (
          <label className="flex items-center gap-2.5">
            <Toggle checked={f.isActive} onChange={(v) => setF((s) => ({ ...s, isActive: v }))} label="Active" /> Available for new subscriptions
          </label>
        ) : null}
        <F label="Sort" className="ml-auto w-24">
          <input type="number" value={f.sortOrder} onChange={set("sortOrder")} className={cn(controlClass, "w-full")} />
        </F>
      </div>
    </Modal>
  );
}
