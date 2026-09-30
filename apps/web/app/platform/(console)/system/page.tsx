"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PLATFORM_PERMISSIONS as P } from "@goldos/shared";
import { Callout, DetailList, EmptyBlock, Hero, heroBtnGhost, Page, Panel, Pill, Skeleton, StatusPill, TableCard, TableSkeleton } from "@/components/ui";
import { RefreshCwIcon, ServerIcon } from "@/components/icons";
import { can, dateTime, papi, relative, titleCase, usePlatformMe } from "@/lib/platform";

type Ping = { ok: boolean; latencyMs: number | null; error?: string };
type Run = { id: string; job: string; status: string; trigger: string; started_at: number; finished_at: number | null; error: string | null; summary_json: string | null; triggered_by_name?: string | null };
type Health = {
  databases: { control: Ping; data: Ping };
  counts: Record<string, number>;
  lastRuns: Record<string, Run | null>;
  jobFailures24h: number;
  staffOnline: number;
  config: { tenantBound: string | null; bootstrapTokenSet: boolean; webOrigins: string[]; r2Bound: boolean; maintenanceMode: boolean; signupEnabled: boolean };
  serverTime: number;
};

const JOB_INFO: Record<string, { label: string; schedule: string; description: string }> = {
  billing_cycle: { label: "Billing cycle", schedule: "Hourly", description: "Converts trials, renews periods, issues invoices, marks past due, applies dunning." },
  collect_usage: { label: "Usage collection", schedule: "Nightly 02:15 UTC", description: "Snapshots users, branches, products and sales from each reachable shop database." },
  housekeeping: { label: "Housekeeping", schedule: "Hourly", description: "Purges expired staff sessions, old impersonation grants and job history." },
};

export default function SystemPage() {
  const me = usePlatformMe();
  const qc = useQueryClient();
  const health = useQuery({ queryKey: ["p-health"], queryFn: () => papi<Health>("/system/health"), refetchInterval: 30_000 });
  const runs = useQuery({ queryKey: ["p-jobs"], queryFn: () => papi<Run[]>("/system/jobs") });
  const run = useMutation({
    mutationFn: (job: string) => papi<unknown>(`/system/jobs/${job}/run`, { method: "POST" }),
    onSuccess: (_r, job) => {
      toast.success(`${JOB_INFO[job]?.label ?? job} finished`);
      qc.invalidateQueries({ queryKey: ["p-health"] });
      qc.invalidateQueries({ queryKey: ["p-jobs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Job failed"),
  });
  const h = health.data;
  const canRun = can(me.data, P.SETTINGS_MANAGE);

  return (
    <Page className="max-w-[88rem]">
      <Hero
        kicker="Administration"
        title="System health"
        description="Databases, scheduled jobs and deployment configuration for the control plane."
        actions={
          <button onClick={() => health.refetch()} className={heroBtnGhost}>
            <RefreshCwIcon size={15} className={health.isFetching ? "animate-spin" : undefined} /> Refresh
          </button>
        }
        stats={[
          { label: "Control DB", value: h ? (h.databases.control.ok ? `${h.databases.control.latencyMs} ms` : "Down") : "—" },
          { label: "Shop DB", value: h ? (h.databases.data.ok ? `${h.databases.data.latencyMs} ms` : "Down") : "—" },
          { label: "Job failures · 24h", value: h?.jobFailures24h ?? "—" },
          { label: "Staff online", value: h?.staffOnline ?? "—" },
        ]}
      />

      {h && (!h.databases.control.ok || !h.databases.data.ok) ? (
        <Callout tone="danger" title="A database is unreachable">
          {h.databases.control.error ?? h.databases.data.error}
        </Callout>
      ) : null}
      {h?.config.bootstrapTokenSet ? (
        <Callout tone="warning" title="Bootstrap token still set">
          PLATFORM_BOOTSTRAP_TOKEN only matters on a fresh install. Remove it with <code className="font-mono">wrangler secret delete PLATFORM_BOOTSTRAP_TOKEN</code>.
        </Callout>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        {Object.entries(JOB_INFO).map(([job, info]) => {
          const last = h?.lastRuns[job];
          return (
            <Panel
              key={job}
              title={info.label}
              description={`${info.schedule} · ${info.description}`}
              icon={<ServerIcon size={16} />}
              footer={
                canRun ? (
                  <button onClick={() => run.mutate(job)} disabled={run.isPending} className="g-btn g-btn-secondary h-9 w-full text-sm">
                    {run.isPending && run.variables === job ? "Running…" : "Run now"}
                  </button>
                ) : undefined
              }
            >
              {!h ? (
                <Skeleton className="h-16" />
              ) : !last ? (
                <p className="text-sm text-ink-4">Never run.</p>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <StatusPill status={last.status === "OK" ? "success" : last.status === "FAILED" ? "failed" : "processing"} label={titleCase(last.status)} />
                    <span className="text-xs text-ink-4">{relative(last.started_at)} · {last.trigger}</span>
                  </div>
                  {last.error ? <p className="rounded-lg bg-rose-700/[0.07] p-2 font-mono text-[11px] text-rose-800">{last.error}</p> : null}
                  {last.summary_json ? <pre className="max-h-28 overflow-auto rounded-lg bg-bone p-2 font-mono text-[10px] text-ink-3">{last.summary_json}</pre> : null}
                </div>
              )}
            </Panel>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Configuration" icon={<ServerIcon size={16} />}>
          {h ? (
            <DetailList
              items={[
                { label: "Data plane serves tenant", value: h.config.tenantBound ? <code className="break-all font-mono text-xs">{h.config.tenantBound}</code> : <Pill tone="warning">TENANT_ID not set</Pill> },
                { label: "Allowed web origins", value: h.config.webOrigins.length ? h.config.webOrigins.join(", ") : "—" },
                { label: "R2 storage", value: h.config.r2Bound ? <Pill tone="success">Bound</Pill> : <Pill tone="danger">Missing</Pill> },
                { label: "Maintenance mode", value: h.config.maintenanceMode ? <Pill tone="warning">On</Pill> : "Off" },
                { label: "Server time", value: dateTime(h.serverTime) },
              ]}
            />
          ) : (
            <Skeleton className="h-40" />
          )}
        </Panel>
        <Panel className="lg:col-span-2" title="Control-plane records" icon={<ServerIcon size={16} />}>
          {h ? (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(h.counts).map(([k, v]) => (
                <div key={k} className="rounded-xl bg-bone/70 p-3 ring-1 ring-ink/[0.06]">
                  <dt className="truncate font-mono text-[10px] text-ink-4">{k}</dt>
                  <dd className="g-metric mt-1 text-lg">{v.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <Skeleton className="h-40" />
          )}
        </Panel>
      </div>

      <TableCard title="Job history" description="Last 50 runs" icon={<ServerIcon size={16} />}>
        {runs.isLoading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : (runs.data ?? []).length === 0 ? (
          <EmptyBlock title="No runs yet" description="Cron runs appear here once the worker is deployed with triggers." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Job</th>
                <th>Trigger</th>
                <th>Status</th>
                <th className="!text-right">Duration</th>
              </tr>
            </thead>
            <tbody>
              {runs.data!.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-ink-3">{dateTime(r.started_at)}</td>
                  <td>{JOB_INFO[r.job]?.label ?? r.job}</td>
                  <td className="text-ink-3">{r.trigger === "manual" ? `Manual · ${r.triggered_by_name ?? "?"}` : "Cron"}</td>
                  <td>
                    <StatusPill status={r.status === "OK" ? "success" : r.status === "FAILED" ? "failed" : "processing"} label={titleCase(r.status)} />
                  </td>
                  <td className="num">{r.finished_at ? `${((r.finished_at - r.started_at) / 1000).toFixed(1)}s` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </Page>
  );
}
