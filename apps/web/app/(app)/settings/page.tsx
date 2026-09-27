"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";

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
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-stone-500">Business configuration (rates live in Gold Rates)</p>
      </div>
      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="font-medium">Known keys</h2>
        <ul className="mt-2 space-y-1 text-sm text-stone-600">
          {KNOWN_KEYS.map((k) => (
            <li key={k}>
              <button onClick={() => setKey(k)} className="font-mono text-xs hover:underline">
                {k}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {canEdit ? (
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="font-medium">Edit setting</h2>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              placeholder="key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
            />
            <input
              placeholder="value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
            />
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending || !key}
              className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              Save
            </button>
          </div>
          {key && preview.data ? (
            <p className="mt-2 text-sm text-stone-500">
              Current: <span className="font-mono">{JSON.stringify(preview.data.value)}</span>
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-stone-500">You have read-only access to settings.</p>
      )}
    </div>
  );
}
