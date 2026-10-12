"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, controlClass } from "@/components/ui";
import { Card, CardHead, GoldHero, HeroBadge, ShareBar } from "@/components/console-kit";
import { EyeIcon, FileTextIcon, KeyIcon, SettingsIcon } from "@/components/icons";

const KNOWN_KEYS = [
  "shop_name",
  "receipt_header",
  "receipt_footer",
  "shop_address",
  "shop_phone",
  "shop_email",
  "invoice_terms",
  "discount_limit_pct",
];

/** What the printed invoice and receipt read, edited as one form. */
const PROFILE_FIELDS: { key: string; label: string; hint?: string; multiline?: boolean }[] = [
  { key: "shop_name", label: "Shop name", hint: "Large on the letterhead" },
  { key: "receipt_header", label: "Tagline", hint: "e.g. Fine 22K jewellery since 1985" },
  { key: "shop_address", label: "Address", multiline: true },
  { key: "shop_phone", label: "Phone" },
  { key: "shop_email", label: "Email" },
  { key: "receipt_footer", label: "Thank-you line", hint: "Bottom of the invoice and receipt" },
  { key: "invoice_terms", label: "Terms & conditions", multiline: true, hint: "Exchange / return policy printed on every bill" },
];

function InvoiceProfilePanel({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const current = useQuery({
    queryKey: ["settings-invoice-profile"],
    queryFn: async () => {
      const out: Record<string, string> = {};
      for (const f of PROFILE_FIELDS) {
        try {
          const s = await api<{ value: unknown }>(`/api/v1/settings/${f.key}`);
          out[f.key] = typeof s.value === "string" ? s.value : s.value == null ? "" : String(s.value);
        } catch {
          out[f.key] = "";
        }
      }
      return out;
    },
  });
  const values = draft ?? current.data ?? {};
  const dirty = draft !== null && PROFILE_FIELDS.some((f) => (draft[f.key] ?? "") !== (current.data?.[f.key] ?? ""));
  const save = useMutation({
    mutationFn: async () => {
      for (const f of PROFILE_FIELDS) {
        const v = (draft?.[f.key] ?? "").trim();
        if (v === (current.data?.[f.key] ?? "")) continue;
        await api(`/api/v1/settings/${f.key}`, { method: "PUT", body: JSON.stringify({ value: v, type: "string" }) });
      }
    },
    onSuccess: () => {
      toast.success("Invoice letterhead saved");
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["settings-invoice-profile"] });
      qc.invalidateQueries({ queryKey: ["invoice-profile"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const filled = PROFILE_FIELDS.filter((f) => (values[f.key] ?? "").trim()).length;
  const v = (k: string) => (values[k] ?? "").trim();

  return (
    <>
      <Card className="xl:col-span-7">
        <CardHead
          icon={FileTextIcon}
          title="Invoice letterhead"
          sub="Printed on every A4 invoice and 80 mm receipt"
          action={
            dirty ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-500/25">
                <span className="size-1.5 animate-pulse-soft rounded-full bg-amber-500" />
                Unsaved
              </span>
            ) : (
              <span className="g-metric text-[11px] text-ink-4">
                {filled}/{PROFILE_FIELDS.length} filled
              </span>
            )
          }
        />
        <div className="px-4 pt-3">
          <ShareBar value={(filled / PROFILE_FIELDS.length) * 100} color={filled === PROFILE_FIELDS.length ? "bg-gradient-to-r from-emerald-600 to-emerald-400" : undefined} />
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {PROFILE_FIELDS.map((f) => {
            const changed = draft !== null && (draft[f.key] ?? "") !== (current.data?.[f.key] ?? "");
            return (
              <label key={f.key} className={cn("block", f.multiline && "sm:col-span-2")}>
                <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-4">
                  {f.label}
                  {changed ? <span className="size-1.5 rounded-full bg-amber-500" title="Changed" /> : null}
                  {!v(f.key) && !current.isLoading ? <span className="normal-case tracking-normal text-ink-6">· empty</span> : null}
                </span>
                {f.multiline ? (
                  <textarea
                    rows={2}
                    disabled={!canEdit}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setDraft({ ...values, [f.key]: e.target.value })}
                    className={cn(controlClass, "!h-auto w-full resize-y py-2", changed && "ring-1 ring-amber-500/40")}
                  />
                ) : (
                  <input
                    disabled={!canEdit}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setDraft({ ...values, [f.key]: e.target.value })}
                    className={cn(controlClass, "w-full", changed && "ring-1 ring-amber-500/40")}
                  />
                )}
                {f.hint ? <span className="mt-0.5 block text-[10.5px] text-ink-5">{f.hint}</span> : null}
              </label>
            );
          })}
        </div>
        {canEdit ? (
          <div className="flex items-center justify-end gap-2 border-t border-ink/[0.06] bg-bone/40 px-4 py-2.5">
            {dirty ? (
              <button onClick={() => setDraft(null)} className="g-btn g-btn-secondary h-9 px-4 text-sm">
                Discard
              </button>
            ) : null}
            <button onClick={() => save.mutate()} disabled={!dirty || save.isPending} className="g-btn g-btn-primary h-9 px-4 text-sm">
              {save.isPending ? "Saving…" : "Save letterhead"}
            </button>
          </div>
        ) : null}
      </Card>

      {/* what the customer will see, updating as you type */}
      <Card className="xl:col-span-5">
        <CardHead icon={EyeIcon} title="Live preview" sub="Top and bottom of an A4 invoice" />
        <div className="flex-1 bg-[repeating-linear-gradient(45deg,rgba(16,32,27,0.025)_0_8px,transparent_8px_16px)] p-4">
          <div className="mx-auto max-w-md rounded-md bg-white p-5 text-[#1a1a1a] shadow-[0_20px_40px_-24px_rgba(16,32,27,0.45),0_0_0_1px_rgba(16,32,27,0.06)]">
            <div className="flex items-start justify-between gap-4 border-b-2 border-[#B8923F] pb-3">
              <div className="min-w-0">
                <div className="font-display text-[19px] font-bold leading-tight">{v("shop_name") || <span className="text-ink-6">Shop name</span>}</div>
                <div className="mt-0.5 text-[10.5px] italic text-[#7E6223]">{v("receipt_header") || "Tagline"}</div>
              </div>
              <div className="shrink-0 text-right text-[9.5px] leading-relaxed text-[#555]">
                <div className="whitespace-pre-line">{v("shop_address") || "Address"}</div>
                <div>{v("shop_phone") || "Phone"}</div>
                <div>{v("shop_email") || "Email"}</div>
              </div>
            </div>
            <div className="mt-3 flex justify-between text-[10px] text-[#555]">
              <span className="font-semibold uppercase tracking-[0.14em] text-[#1a1a1a]">Tax invoice</span>
              <span className="g-metric">INV-000123 · {new Date().toLocaleDateString("en-GB")}</span>
            </div>
            <div className="mt-2 space-y-1">
              {[78, 64, 70].map((w, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="h-1.5 rounded-full bg-[#eee]" style={{ width: `${w}%` }} />
                  <div className="ml-auto h-1.5 w-10 rounded-full bg-[#eee]" />
                </div>
              ))}
            </div>
            <div className="mt-3 border-t border-dashed border-[#ddd] pt-2 text-[9px] leading-relaxed text-[#666]">
              <div className="whitespace-pre-line">{v("invoice_terms") || "Terms & conditions"}</div>
              <div className="mt-1.5 text-center text-[10px] font-semibold text-[#7E6223]">{v("receipt_footer") || "Thank-you line"}</div>
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canEdit = hasPermission(me.data?.permissions ?? [], "settings:edit");

  const save = useMutation({
    mutationFn: () =>
      api(`/api/v1/settings/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({ value, type: "string" }),
      }),
    onSuccess: () => {
      toast.success("Setting saved");
      setKey("");
      setValue("");
      qc.invalidateQueries({ queryKey: ["setting", key] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const preview = useQuery({
    queryKey: ["setting", key],
    queryFn: () => api<{ key: string; value: unknown }>(`/api/v1/settings/${encodeURIComponent(key)}`),
    enabled: key.length > 0,
    retry: false,
  });

  const known = KNOWN_KEYS.length;

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={SettingsIcon}
        title="Settings"
        badge={<HeroBadge tone={canEdit ? "good" : "muted"}>{canEdit ? "Read-write" : "Read-only"}</HeroBadge>}
        sub="Business configuration · saved keys apply immediately across the network · rates live in Gold Rates"
        back={{ href: "/setup", label: "Setup" }}
        stats={[
          { label: "Letterhead fields", value: PROFILE_FIELDS.length, accent: true, sub: "printed on every bill" },
          { label: "Known keys", value: known },
          { label: "Access", value: null, text: canEdit ? "Read-write" : "Read-only", tone: canEdit ? "good" : "warn" },
          { label: "Scope", value: null, text: "Network", sub: "branch overrides in Branches" },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <InvoiceProfilePanel canEdit={canEdit} />

        <Card className="xl:col-span-5">
          <CardHead icon={KeyIcon} title="Known keys" sub="Pick a key to inspect or edit it" />
          <div className="grid grid-cols-1 gap-px bg-ink/[0.05] sm:grid-cols-2">
            {KNOWN_KEYS.map((k) => (
              <button
                key={k}
                onClick={() => setKey(k)}
                className={cn("group flex items-center justify-between gap-2 bg-paper px-4 py-2 text-left transition-colors hover:bg-bone", key === k && "bg-gold-pale/70")}
              >
                <span className={cn("g-metric truncate text-[11.5px]", key === k ? "font-semibold text-ink" : "text-ink-3 group-hover:text-ink")}>{k}</span>
                <span className={cn("size-1.5 shrink-0 rounded-full transition-colors", key === k ? "bg-gold" : "bg-ink/10 group-hover:bg-gold/60")} />
              </button>
            ))}
          </div>
        </Card>

        <Card className="xl:col-span-7">
          <CardHead icon={SettingsIcon} title="Edit a setting" sub="Upsert any configuration key" />
          {canEdit ? (
            <div className="p-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input placeholder="key" value={key} onChange={(e) => setKey(e.target.value)} className={cn(controlClass, "flex-1 font-mono")} />
                <input placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} className={cn(controlClass, "flex-1")} />
                <button onClick={() => save.mutate()} disabled={save.isPending || !key} className="g-btn g-btn-primary h-10 px-4 text-sm">
                  Save
                </button>
              </div>
              <div className="mt-3 rounded-xl bg-bone/60 px-3 py-2.5 ring-1 ring-inset ring-ink/[0.06]">
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">Current value</div>
                <div className="g-metric mt-1 break-all text-[12px] text-ink">
                  {!key ? (
                    <span className="text-ink-5">Pick or type a key</span>
                  ) : preview.isLoading ? (
                    "…"
                  ) : preview.data ? (
                    JSON.stringify(preview.data.value)
                  ) : (
                    <span className="text-ink-5">Not set yet</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="px-4 py-3 text-[12px] text-ink-4">You have read-only access to settings. Ask an administrator for edit rights.</p>
          )}
        </Card>
      </div>
    </Page>
  );
}
