"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PLATFORM_PERMISSIONS as P } from "@goldos/shared";
import { EmptyBlock, Hero, heroBtnPrimary, Modal, Page, Pill, TableCard, TableSkeleton, controlClass } from "@/components/ui";
import { FlagIcon, PlusIcon, SearchIcon, TrashIcon } from "@/components/icons";
import { F, Toggle } from "@/components/platform/dialogs";
import { cn } from "@/lib/cn";
import { can, papi, relative, usePlatformMe } from "@/lib/platform";

type Flag = { key: string; description: string; default_enabled: number; rollout_pct: number; forced_on: number; forced_off: number; plans: string[]; updated_at: number };

export default function FlagsPage() {
  const me = usePlatformMe();
  const qc = useQueryClient();
  const manage = can(me.data, P.FLAGS_MANAGE);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [rollout, setRollout] = useState<Record<string, number>>({});
  const q = useQuery({ queryKey: ["p-flags"], queryFn: () => papi<Flag[]>("/flags") });
  const edit = useMutation({
    mutationFn: (v: { key: string; defaultEnabled?: boolean; rolloutPct?: number }) =>
      papi(`/flags/${encodeURIComponent(v.key)}`, { method: "PATCH", json: { defaultEnabled: v.defaultEnabled, rolloutPct: v.rolloutPct } }),
    onSuccess: () => {
      toast.success("Flag updated");
      qc.invalidateQueries({ queryKey: ["p-flags"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });
  const del = useMutation({
    mutationFn: (key: string) => papi(`/flags/${encodeURIComponent(key)}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Flag deleted");
      qc.invalidateQueries({ queryKey: ["p-flags"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });
  const rows = (q.data ?? []).filter((f) => !search || f.key.includes(search.toLowerCase()) || f.description.toLowerCase().includes(search.toLowerCase()));

  return (
    <Page className="max-w-[88rem]">
      <Hero
        kicker="Product"
        title="Feature flags"
        description="Gate features by plan, roll them out gradually, or force them per account. Shops pick up changes on their next page load."
        actions={
          manage ? (
            <button onClick={() => setCreating(true)} className={heroBtnPrimary}>
              <PlusIcon size={15} /> New flag
            </button>
          ) : undefined
        }
        stats={[
          { label: "Flags", value: q.data?.length ?? "—" },
          { label: "On by default", value: q.data?.filter((f) => f.default_enabled).length ?? "—" },
          { label: "Rolling out", value: q.data?.filter((f) => f.rollout_pct > 0 && f.rollout_pct < 100).length ?? "—" },
          { label: "Account overrides", value: q.data?.reduce((s, f) => s + f.forced_on + f.forced_off, 0) ?? "—" },
        ]}
        note="Precedence: account override → plan entitlement → % rollout → default"
      />

      <TableCard
        toolbar={
          <div className="relative w-full max-w-sm">
            <SearchIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
            <input aria-label="Search flags" placeholder="Search flags…" value={search} onChange={(e) => setSearch(e.target.value)} className={cn(controlClass, "w-full pl-9")} />
          </div>
        }
      >
        {q.isLoading ? (
          <TableSkeleton rows={8} cols={5} />
        ) : rows.length === 0 ? (
          <EmptyBlock icon={<FlagIcon size={22} />} title="No flags" />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Flag</th>
                <th>Included in</th>
                <th>Default</th>
                <th className="w-64">Rollout</th>
                <th>Overrides</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const pct = rollout[f.key] ?? f.rollout_pct;
                return (
                  <tr key={f.key}>
                    <td>
                      <div className="font-mono text-xs font-semibold">{f.key}</div>
                      <div className="text-xs text-ink-4">{f.description}</div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {f.plans.length ? f.plans.map((p) => <Pill key={p} tone="brand">{p}</Pill>) : <span className="text-xs text-ink-5">No plan</span>}
                      </div>
                    </td>
                    <td>
                      <Toggle checked={f.default_enabled === 1} disabled={!manage || edit.isPending} onChange={(v) => edit.mutate({ key: f.key, defaultEnabled: v })} label={`${f.key} default`} />
                    </td>
                    <td>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={pct}
                          disabled={!manage}
                          aria-label={`${f.key} rollout percent`}
                          onChange={(e) => setRollout((r) => ({ ...r, [f.key]: Number(e.target.value) }))}
                          onPointerUp={() => pct !== f.rollout_pct && edit.mutate({ key: f.key, rolloutPct: pct })}
                          onKeyUp={() => pct !== f.rollout_pct && edit.mutate({ key: f.key, rolloutPct: pct })}
                          className="w-full accent-[#A8861B]"
                        />
                        <span className="g-metric w-10 text-right text-xs">{pct}%</span>
                      </div>
                    </td>
                    <td className="text-xs text-ink-3">
                      {f.forced_on ? <span className="text-emerald-700">{f.forced_on} on</span> : null}
                      {f.forced_on && f.forced_off ? " · " : null}
                      {f.forced_off ? <span className="text-rose-700">{f.forced_off} off</span> : null}
                      {!f.forced_on && !f.forced_off ? "—" : null}
                    </td>
                    <td className="text-right">
                      {manage ? (
                        <button
                          aria-label={`Delete ${f.key}`}
                          onClick={() => window.confirm(`Delete flag ${f.key}? Account overrides for it are removed too.`) && del.mutate(f.key)}
                          className="inline-flex size-8 items-center justify-center rounded-lg text-ink-4 hover:bg-rose-50 hover:text-rose-700"
                          title={`Updated ${relative(f.updated_at)}`}
                        >
                          <TrashIcon size={15} />
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

      {creating ? <NewFlagDialog onClose={() => setCreating(false)} onDone={() => qc.invalidateQueries({ queryKey: ["p-flags"] })} /> : null}
    </Page>
  );
}

function NewFlagDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [defaultEnabled, setDefault] = useState(false);
  const [rolloutPct, setPct] = useState(0);
  const m = useMutation({
    mutationFn: () => papi("/flags", { method: "POST", json: { key, description, defaultEnabled, rolloutPct } }),
    onSuccess: () => {
      toast.success("Flag created");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <Modal title="New feature flag" kicker="Product" onClose={onClose} onSubmit={() => m.mutate()} submitLabel="Create flag" pending={m.isPending} submitDisabled={key.length < 2}>
      <F label="Key" hint="Lowercase; dots for namespaces, e.g. beta.new_pos. The shop app reads this key.">
        <input autoFocus value={key} onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, ""))} className={cn(controlClass, "w-full font-mono")} />
      </F>
      <F label="Description">
        <input value={description} onChange={(e) => setDescription(e.target.value)} className={cn(controlClass, "w-full")} />
      </F>
      <div className="flex items-center justify-between gap-4">
        <label className="flex items-center gap-2.5 text-sm">
          <Toggle checked={defaultEnabled} onChange={setDefault} label="On by default" /> On by default
        </label>
        <F label={`Rollout ${rolloutPct}%`} className="w-48">
          <input type="range" min={0} max={100} step={5} value={rolloutPct} onChange={(e) => setPct(Number(e.target.value))} className="w-full accent-[#A8861B]" />
        </F>
      </div>
    </Modal>
  );
}
