"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyBlock, Hero, heroBtnGhost, Page, Pager, TableCard, TableSkeleton, controlSmClass } from "@/components/ui";
import { ChevronDownIcon, FileDownIcon, SearchIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { dateTime, papi, pdownload } from "@/lib/platform";

type Row = {
  id: string;
  admin_name: string | null;
  admin_email: string | null;
  action: string;
  entity: string;
  entity_id: string;
  tenant_id: string | null;
  tenant_name: string | null;
  prev_json: string | null;
  new_json: string | null;
  reason: string | null;
  ip: string | null;
  created_at: number;
};

const ACTION_GROUPS = ["auth", "tenant", "subscription", "invoice", "coupon", "plan", "flag", "announcement", "ticket", "admin", "settings"];

function pretty(json: string | null) {
  if (!json) return null;
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

export default function AuditPage() {
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setPage(1), [search, action, from, to]);
  const filter = {
    search,
    action,
    from: from ? String(new Date(`${from}T00:00:00`).getTime()) : "",
    to: to ? String(new Date(`${to}T23:59:59`).getTime() + 1000) : "",
  };
  const qs = new URLSearchParams({ ...filter, page: String(page), limit: "50" }).toString();
  const q = useQuery({ queryKey: ["p-audit", qs], queryFn: () => papi<{ rows: Row[]; total: number }>(`/audit?${qs}`) });
  const rows = q.data?.rows ?? [];

  return (
    <Page className="max-w-[88rem]">
      <Hero
        kicker="Administration"
        title="Audit log"
        description="Append-only record of every staff action, sign-in and automated change on the platform."
        actions={
          <button
            onClick={() => pdownload(`/audit/export.csv?${new URLSearchParams(filter)}`, "platform-audit.csv").catch((e: Error) => toast.error(e.message))}
            className={heroBtnGhost}
          >
            <FileDownIcon size={15} /> Export CSV
          </button>
        }
        stats={[{ label: "Matching events", value: q.data?.total?.toLocaleString() ?? "—" }]}
      />

      <TableCard
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <SearchIcon size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
              <input aria-label="Search" placeholder="Action, id, reason, account…" value={search} onChange={(e) => setSearch(e.target.value)} className={cn(controlSmClass, "w-64 pl-8")} />
            </div>
            <select aria-label="Action group" value={action} onChange={(e) => setAction(e.target.value)} className={controlSmClass}>
              <option value="">All actions</option>
              {ACTION_GROUPS.map((g) => (
                <option key={g} value={`${g}.`}>
                  {g}.*
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-ink-4">
              From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={controlSmClass} />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink-4">
              To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={controlSmClass} />
            </label>
          </div>
        }
        footer={<Pager page={page} onChange={setPage} pageSize={50} count={rows.length} total={q.data?.total ?? 0} unit="events" />}
      >
        {q.isLoading ? (
          <TableSkeleton rows={10} cols={5} />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No events match" />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Account</th>
                <th>Reason</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const expanded = open === r.id;
                const hasDiff = r.prev_json || r.new_json;
                return (
                  <Fragment key={r.id}>
                    <tr className={cn(hasDiff && "cursor-pointer")} onClick={() => hasDiff && setOpen(expanded ? null : r.id)}>
                      <td className="whitespace-nowrap text-ink-3">{dateTime(r.created_at)}</td>
                      <td>
                        <div className="text-sm">{r.admin_name ?? "System"}</div>
                        {r.ip ? <div className="font-mono text-[10px] text-ink-5">{r.ip}</div> : null}
                      </td>
                      <td>
                        <div className="font-mono text-xs font-semibold">{r.action}</div>
                        <div className="font-mono text-[10px] text-ink-4">
                          {r.entity}:{r.entity_id.slice(0, 12)}
                        </div>
                      </td>
                      <td>
                        {r.tenant_id ? (
                          <Link href={`/platform/tenants/${r.tenant_id}`} onClick={(e) => e.stopPropagation()} className="text-gold-dark hover:underline">
                            {r.tenant_name ?? r.tenant_id.slice(0, 8)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="max-w-xs truncate text-ink-3" title={r.reason ?? undefined}>
                        {r.reason ?? "—"}
                      </td>
                      <td className="w-8">{hasDiff ? <ChevronDownIcon size={14} className={cn("text-ink-4 transition-transform", expanded && "rotate-180")} /> : null}</td>
                    </tr>
                    {expanded ? (
                      <tr>
                        <td colSpan={6} className="bg-bone/60">
                          <div className="grid gap-3 py-2 md:grid-cols-2">
                            {(
                              [
                                ["Before", r.prev_json],
                                ["After", r.new_json],
                              ] as const
                            ).map(([label, json]) => (
                              <div key={label}>
                                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4">{label}</div>
                                <pre className="max-h-64 overflow-auto rounded-lg bg-paper p-3 font-mono text-[11px] text-ink-2 ring-1 ring-ink/[0.08]">{pretty(json) ?? "—"}</pre>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>
    </Page>
  );
}
