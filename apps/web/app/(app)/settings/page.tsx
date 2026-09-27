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

const KNOWN_KEYS = ["shop_name", "receipt_header", "receipt_footer", "discount_limit_pct"];

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
