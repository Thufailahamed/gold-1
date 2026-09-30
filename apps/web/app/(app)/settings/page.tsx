"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import {
  Page,
  Hero,
  Panel,
  Callout,
  controlClass,
} from "@/components/ui";
import { SettingsIcon } from "@/components/icons";

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

  return (
    <Panel
      title="Invoice letterhead"
      description="Printed on every A4 invoice and 80mm receipt"
      icon={<SettingsIcon size={16} />}
      className="lg:col-span-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {PROFILE_FIELDS.map((f) => (
          <label key={f.key} className={`block text-sm text-ink-2 ${f.multiline ? "sm:col-span-2" : ""}`}>
            {f.label}
            {f.multiline ? (
              <textarea
                rows={2}
                disabled={!canEdit}
                value={values[f.key] ?? ""}
                onChange={(e) => setDraft({ ...values, [f.key]: e.target.value })}
                className={`${controlClass} mt-1 !h-auto w-full resize-y py-2`}
              />
            ) : (
              <input
                disabled={!canEdit}
                value={values[f.key] ?? ""}
                onChange={(e) => setDraft({ ...values, [f.key]: e.target.value })}
                className={`${controlClass} mt-1 w-full`}
              />
            )}
            {f.hint ? <span className="mt-0.5 block text-xs text-ink-4">{f.hint}</span> : null}
          </label>
        ))}
      </div>
      {canEdit ? (
        <div className="mt-4 flex items-center justify-end gap-2">
          {dirty ? (
            <button onClick={() => setDraft(null)} className="g-btn g-btn-secondary h-10 px-4 text-sm">
              Discard
            </button>
          ) : null}
          <button onClick={() => save.mutate()} disabled={!dirty || save.isPending} className="g-btn g-btn-primary h-10 px-4 text-sm">
            {save.isPending ? "Saving…" : "Save letterhead"}
          </button>
        </div>
      ) : null}
    </Panel>
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

  return (
    <Page>
      <Hero
        kicker="System"
        title="Settings"
        description="Business configuration — rates live in Gold Rates."
        stats={[
          { label: "Known keys", value: KNOWN_KEYS.length },
          { label: "Access", value: canEdit ? "Read-write" : "Read-only" },
        ]}
        note="Saved keys apply immediately across the network"
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <InvoiceProfilePanel canEdit={canEdit} />
        <Panel
          title="Known keys"
          description="Select a key to inspect or edit"
          icon={<SettingsIcon size={16} />}
        >
          <div className="-mx-2 divide-y divide-ink/[0.06]">
            {KNOWN_KEYS.map((k) => (
              <button
                key={k}
                onClick={() => setKey(k)}
                className={`group flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-bone ${
                  key === k ? "bg-gold-pale" : ""
                }`}
              >
                <span className="font-mono text-xs text-ink-3 group-hover:text-ink">{k}</span>
                <span
                  className={`size-1.5 rounded-full transition-colors ${
                    key === k ? "bg-gold" : "bg-ink/10 group-hover:bg-gold/60"
                  }`}
                />
              </button>
            ))}
          </div>
        </Panel>

        {canEdit ? (
          <Panel title="Edit setting" description="Upsert a configuration key" className="lg:col-span-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                placeholder="key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className={`${controlClass} flex-1 font-mono`}
              />
              <input
                placeholder="value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className={`${controlClass} flex-1`}
              />
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending || !key}
                className="g-btn g-btn-primary h-10 px-4 text-sm"
              >
                Save
              </button>
            </div>
            {key && preview.data ? (
              <p className="mt-3 text-sm text-ink-4">
                Current:{" "}
                <span className="rounded-md bg-bone px-2 py-1 font-mono text-xs text-ink shadow-[inset_0_0_0_1px_rgba(28,25,23,0.08)]">
                  {JSON.stringify(preview.data.value)}
                </span>
              </p>
            ) : null}
          </Panel>
        ) : (
          <div className="lg:col-span-2">
            <Callout tone="info" title="Read-only access">
              You have read-only access to settings. Ask an administrator for edit rights.
            </Callout>
          </div>
        )}
      </div>
    </Page>
  );
}
