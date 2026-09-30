"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PLATFORM_PERMISSIONS as P, TICKET_PRIORITIES } from "@goldos/shared";
import {
  CellStack,
  EmptyBlock,
  FilterChips,
  Hero,
  heroBtnPrimary,
  Modal,
  Page,
  Pager,
  StatusPill,
  TableCard,
  TableSkeleton,
  controlClass,
  controlSmClass,
} from "@/components/ui";
import { LifeBuoyIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { PriorityPill } from "@/components/platform/billing-bits";
import { F } from "@/components/platform/dialogs";
import { cn } from "@/lib/cn";
import { can, papi, relative, titleCase, usePlatformMe } from "@/lib/platform";

type Ticket = {
  id: string;
  number: string;
  tenant_id: string;
  tenant_name: string;
  subject: string;
  status: string;
  priority: string;
  category: string;
  requester_email: string | null;
  assignee_name: string | null;
  first_response_at: number | null;
  created_at: number;
  updated_at: number;
  message_count: number;
};

function SupportInner() {
  const params = useSearchParams();
  const router = useRouter();
  const me = usePlatformMe();
  const [status, setStatus] = useState("ACTIVE");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState<string | null>(params.get("new"));
  useEffect(() => setPage(1), [status, priority, assignee, search]);
  const qs = new URLSearchParams({
    page: String(page),
    limit: "25",
    status,
    priority,
    search,
    ...(assignee === "me" ? { assignee: "me" } : assignee === "none" ? { unassigned: "1" } : {}),
  }).toString();
  const q = useQuery({ queryKey: ["p-tickets", qs], queryFn: () => papi<{ rows: Ticket[]; total: number; counts: Record<string, number> }>(`/support?${qs}`), refetchInterval: 30_000 });
  const rows = q.data?.rows ?? [];
  const c = q.data?.counts ?? {};

  return (
    <Page className="max-w-[88rem]">
      <Hero
        kicker="Customers"
        title="Support desk"
        description="Tickets from shops and from staff on their behalf. Urgent and unanswered float to the top."
        actions={
          can(me.data, P.SUPPORT_MANAGE) ? (
            <button onClick={() => setCreating("")} className={heroBtnPrimary}>
              <PlusIcon size={15} /> New ticket
            </button>
          ) : undefined
        }
        stats={[
          { label: "Open", value: c.OPEN ?? 0 },
          { label: "Waiting on shop", value: c.PENDING ?? 0 },
          { label: "Resolved", value: c.RESOLVED ?? 0 },
          { label: "Closed", value: c.CLOSED ?? 0 },
        ]}
      />

      <TableCard
        toolbar={
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <FilterChips
              value={status}
              onChange={setStatus}
              options={[
                { key: "ACTIVE", label: "Active", count: (c.OPEN ?? 0) + (c.PENDING ?? 0) },
                { key: "OPEN", label: "Open" },
                { key: "PENDING", label: "Pending" },
                { key: "RESOLVED", label: "Resolved" },
                { key: "CLOSED", label: "Closed" },
                { key: "", label: "All" },
              ]}
            />
            <div className="flex flex-wrap gap-2 lg:ml-auto">
              <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={controlSmClass}>
                <option value="">Any priority</option>
                {TICKET_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {titleCase(p)}
                  </option>
                ))}
              </select>
              <select aria-label="Assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={controlSmClass}>
                <option value="">Anyone</option>
                <option value="me">Assigned to me</option>
                <option value="none">Unassigned</option>
              </select>
              <div className="relative">
                <SearchIcon size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
                <input aria-label="Search tickets" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className={cn(controlSmClass, "w-48 pl-8")} />
              </div>
            </div>
          </div>
        }
        footer={<Pager page={page} onChange={setPage} pageSize={25} count={rows.length} total={q.data?.total ?? 0} unit="tickets" />}
      >
        {q.isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : rows.length === 0 ? (
          <EmptyBlock icon={<LifeBuoyIcon size={22} />} title="Queue is clear" description="Nothing matches these filters." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Account</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Assignee</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="cursor-pointer" onClick={() => router.push(`/platform/support/${t.id}`)}>
                  <td>
                    <CellStack
                      primary={
                        <Link href={`/platform/support/${t.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                          {t.subject}
                        </Link>
                      }
                      secondary={
                        <>
                          <span className="font-mono">{t.number}</span> · {t.message_count} message{t.message_count === 1 ? "" : "s"}
                          {!t.first_response_at && t.status === "OPEN" ? <span className="ml-1 font-semibold text-rose-700">· no reply yet</span> : null}
                        </>
                      }
                    />
                  </td>
                  <td>
                    <CellStack primary={t.tenant_name} secondary={t.requester_email ?? undefined} />
                  </td>
                  <td>
                    <StatusPill status={t.status} />
                  </td>
                  <td>
                    <PriorityPill p={t.priority} />
                  </td>
                  <td className="text-ink-3">{t.assignee_name ?? <span className="text-ink-5">Unassigned</span>}</td>
                  <td className="whitespace-nowrap text-ink-3">{relative(t.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {creating !== null ? <NewTicketDialog tenantId={creating || null} onClose={() => setCreating(null)} onCreated={(id) => router.push(`/platform/support/${id}`)} /> : null}
    </Page>
  );
}

function NewTicketDialog({ tenantId, onClose, onCreated }: { tenantId: string | null; onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ tenantId: tenantId ?? "", subject: "", body: "", priority: "NORMAL", category: "general" });
  const tenants = useQuery({ queryKey: ["p-tenants", "ticket-pick"], queryFn: () => papi<{ rows: Array<{ id: string; name: string }> }>("/tenants?limit=100&sort=name") });
  const m = useMutation({
    mutationFn: () => papi<{ id: string; number: string }>("/support", { method: "POST", json: f }),
    onSuccess: (r) => {
      toast.success(`Ticket ${r.number} opened`);
      onCreated(r.id);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <Modal title="New ticket" kicker="Support" wide onClose={onClose} onSubmit={() => m.mutate()} submitLabel="Open ticket" pending={m.isPending} submitDisabled={!f.tenantId || f.subject.length < 3 || !f.body}>
      <div className="grid gap-4 sm:grid-cols-3">
        <F label="Account" className="sm:col-span-3">
          <select value={f.tenantId} onChange={(e) => setF((s) => ({ ...s, tenantId: e.target.value }))} className={cn(controlClass, "w-full")}>
            <option value="">Select…</option>
            {(tenants.data?.rows ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </F>
        <F label="Subject" className="sm:col-span-3">
          <input value={f.subject} onChange={(e) => setF((s) => ({ ...s, subject: e.target.value }))} className={cn(controlClass, "w-full")} />
        </F>
        <F label="Priority">
          <select value={f.priority} onChange={(e) => setF((s) => ({ ...s, priority: e.target.value }))} className={cn(controlClass, "w-full")}>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {titleCase(p)}
              </option>
            ))}
          </select>
        </F>
        <F label="Category" className="sm:col-span-2">
          <select value={f.category} onChange={(e) => setF((s) => ({ ...s, category: e.target.value }))} className={cn(controlClass, "w-full")}>
            {["general", "billing", "bug", "data", "onboarding", "feature_request", "account_access"].map((c) => (
              <option key={c} value={c}>
                {titleCase(c)}
              </option>
            ))}
          </select>
        </F>
        <F label="Message" className="sm:col-span-3">
          <textarea rows={6} value={f.body} onChange={(e) => setF((s) => ({ ...s, body: e.target.value }))} className={cn(controlClass, "h-auto w-full py-2")} />
        </F>
      </div>
    </Modal>
  );
}

export default function SupportPage() {
  return (
    <Suspense>
      <SupportInner />
    </Suspense>
  );
}
