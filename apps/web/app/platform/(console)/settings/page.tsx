"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PLATFORM_PERMISSIONS as P, type PlatformSettings } from "@goldos/shared";
import { Callout, Hero, Page, Panel, Skeleton, controlClass } from "@/components/ui";
import { AlertCircleIcon, CoinsIcon, SettingsIcon, ShieldIcon } from "@/components/icons";
import { F, Toggle } from "@/components/platform/dialogs";
import { cn } from "@/lib/cn";
import { can, papi, usePlatformMe } from "@/lib/platform";

export default function SettingsPage() {
  const me = usePlatformMe();
  const qc = useQueryClient();
  const editable = can(me.data, P.SETTINGS_MANAGE);
  const q = useQuery({ queryKey: ["p-settings"], queryFn: () => papi<PlatformSettings>("/system/settings") });
  const [f, setF] = useState<PlatformSettings | null>(null);
  useEffect(() => {
    if (q.data && !f) setF(q.data);
  }, [q.data, f]);

  const dirty = f && q.data ? (Object.keys(f) as Array<keyof PlatformSettings>).filter((k) => f[k] !== q.data![k]) : [];
  const save = useMutation({
    mutationFn: () => papi<PlatformSettings>("/system/settings", { method: "PATCH", json: Object.fromEntries(dirty.map((k) => [k, f![k]])) }),
    onSuccess: (next) => {
      toast.success("Settings saved");
      qc.setQueryData(["p-settings"], next);
      setF(next);
      qc.invalidateQueries({ queryKey: ["platform-me"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  if (!f) return <Page><Skeleton className="h-96 rounded-xl" /></Page>;
  const set = <K extends keyof PlatformSettings>(k: K, v: PlatformSettings[K]) => setF((s) => (s ? { ...s, [k]: v } : s));
  const text = (k: keyof PlatformSettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value as never);
  const num = (k: keyof PlatformSettings) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);

  return (
    <Page className="max-w-5xl">
      <Hero
        kicker="Administration"
        title="Platform settings"
        description="Company identity, billing policy, dunning and platform-wide switches."
        actions={
          editable ? (
            <button onClick={() => save.mutate()} disabled={dirty.length === 0 || save.isPending} className="g-btn h-10 bg-gold px-4 text-sm text-ink hover:bg-gold-light disabled:opacity-50">
              {save.isPending ? "Saving…" : dirty.length ? `Save ${dirty.length} change${dirty.length === 1 ? "" : "s"}` : "Saved"}
            </button>
          ) : undefined
        }
      />
      {!editable ? <Callout tone="info">Read-only — only super admins change platform settings.</Callout> : null}

      <fieldset disabled={!editable} className="space-y-6">
        <Panel title="Company" icon={<SettingsIcon size={16} />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <F label="Company name" hint="Shown in the console, invoices and authenticator apps">
              <input value={f.company_name} onChange={text("company_name")} className={cn(controlClass, "w-full")} />
            </F>
            <F label="Support email" hint="Shown to shops on suspension and error screens">
              <input type="email" value={f.support_email} onChange={text("support_email")} className={cn(controlClass, "w-full")} />
            </F>
          </div>
        </Panel>

        <Panel title="Billing" icon={<CoinsIcon size={16} />}>
          <div className="grid gap-4 sm:grid-cols-3">
            <F label="Default currency">
              <input maxLength={3} value={f.default_currency} onChange={(e) => set("default_currency", e.target.value.toUpperCase())} className={cn(controlClass, "w-full font-mono")} />
            </F>
            <F label="Invoice prefix" hint={`Next looks like ${f.invoice_prefix}-000042`}>
              <input maxLength={8} value={f.invoice_prefix} onChange={(e) => set("invoice_prefix", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} className={cn(controlClass, "w-full font-mono")} />
            </F>
            <F label="Payment terms (days)">
              <input type="number" min={0} max={120} value={f.invoice_due_days} onChange={num("invoice_due_days")} className={cn(controlClass, "w-full")} />
            </F>
            <F label="Tax label">
              <input value={f.tax_label} onChange={text("tax_label")} className={cn(controlClass, "w-full")} />
            </F>
            <F label="Tax rate (%)" hint="Applied after discounts on new invoices">
              <input
                type="number"
                min={0}
                max={50}
                step={0.01}
                value={f.tax_rate_bps / 100}
                onChange={(e) => set("tax_rate_bps", Math.round(Number(e.target.value) * 100))}
                className={cn(controlClass, "w-full")}
              />
            </F>
            <F label="Default trial (days)">
              <input type="number" min={0} max={365} value={f.default_trial_days} onChange={num("default_trial_days")} className={cn(controlClass, "w-full")} />
            </F>
          </div>
        </Panel>

        <Panel title="Dunning" description="What happens when invoices go unpaid" icon={<AlertCircleIcon size={16} />}>
          <div className="grid items-end gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-3 text-sm">
              <Toggle checked={f.auto_suspend_past_due} onChange={(v) => set("auto_suspend_past_due", v)} label="Auto-suspend" />
              <span>
                <span className="block font-medium">Suspend accounts that stay past due</span>
                <span className="block text-xs text-ink-4">Lifted automatically once the balance is settled</span>
              </span>
            </label>
            <F label="Grace period (days past due)">
              <input type="number" min={0} max={120} value={f.past_due_grace_days} onChange={num("past_due_grace_days")} className={cn(controlClass, "w-full")} />
            </F>
          </div>
        </Panel>

        <Panel title="Access & security" icon={<ShieldIcon size={16} />}>
          <div className="grid items-end gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-3 text-sm">
              <Toggle checked={f.signup_enabled} onChange={(v) => set("signup_enabled", v)} label="Self-serve sign-up" />
              <span>
                <span className="block font-medium">Self-serve sign-up</span>
                <span className="block text-xs text-ink-4">Reserved for the public sign-up flow</span>
              </span>
            </label>
            <F label="Impersonation link lifetime (minutes)">
              <input type="number" min={1} max={60} value={f.impersonation_ttl_minutes} onChange={num("impersonation_ttl_minutes")} className={cn(controlClass, "w-full")} />
            </F>
          </div>
        </Panel>

        <Panel title="Maintenance mode" description="Every shop sees a maintenance screen and cannot make changes. The platform console keeps working." icon={<AlertCircleIcon size={16} />} className={f.maintenance_mode ? "ring-2 ring-amber-500/50" : undefined}>
          <div className="space-y-4">
            <label className="flex items-center gap-3 text-sm font-medium">
              <Toggle checked={f.maintenance_mode} onChange={(v) => set("maintenance_mode", v)} label="Maintenance mode" />
              {f.maintenance_mode ? "On — shops are blocked" : "Off"}
            </label>
            <F label="Message shown to shops">
              <textarea rows={2} maxLength={300} value={f.maintenance_message} onChange={text("maintenance_message")} placeholder="We're upgrading GoldOS. Back by 2:00 AM." className={cn(controlClass, "h-auto w-full py-2")} />
            </F>
          </div>
        </Panel>
      </fieldset>
    </Page>
  );
}
