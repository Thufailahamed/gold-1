"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PLATFORM_PERMISSIONS as P, TICKET_PRIORITIES, TICKET_STATUSES } from "@goldos/shared";
import { DetailList, EmptyBlock, Hero, Page, Panel, Pill, Skeleton, StatusPill, controlClass } from "@/components/ui";
import { LifeBuoyIcon, ShieldIcon } from "@/components/icons";
import { PriorityPill } from "@/components/platform/billing-bits";
import { F, Toggle } from "@/components/platform/dialogs";
import { cn } from "@/lib/cn";
import { can, dateTime, papi, relative, titleCase, usePlatformMe } from "@/lib/platform";

type Detail = {
  ticket: {
    id: string;
    number: string;
    tenant_id: string;
    tenant_name: string;
    tenant_slug: string;
    subject: string;
    status: string;
    priority: string;
    category: string;
    requester_email: string | null;
    assignee_id: string | null;
    assignee_name: string | null;
    first_response_at: number | null;
    resolved_at: number | null;
    created_at: number;
    updated_at: number;
  };
  messages: Array<{ id: string; author_type: "ADMIN" | "TENANT" | "SYSTEM"; author_name: string; body: string; is_internal: number; created_at: number }>;
};

function duration(ms: number) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const me = usePlatformMe();
  const qc = useQueryClient();
  const manage = can(me.data, P.SUPPORT_MANAGE);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const q = useQuery({ queryKey: ["p-ticket", id], queryFn: () => papi<Detail>(`/support/${id}`), refetchInterval: 20_000 });
  const team = useQuery({ queryKey: ["p-team"], queryFn: () => papi<Array<{ id: string; name: string; is_active: number }>>("/team"), enabled: manage, retry: false });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["p-ticket", id] });
    qc.invalidateQueries({ queryKey: ["p-tickets"] });
  };
  const reply = useMutation({
    mutationFn: () => papi(`/support/${id}/replies`, { method: "POST", json: { body, internal } }),
    onSuccess: () => {
      setBody("");
      toast.success(internal ? "Internal note added" : "Reply sent");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const edit = useMutation({
    mutationFn: (patch: Record<string, unknown>) => papi(`/support/${id}`, { method: "PATCH", json: patch }),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const t = q.data?.ticket;

  if (q.error) return <Page><EmptyBlock title="Ticket not found" /></Page>;

  return (
    <Page className="max-w-[88rem]">
      <Hero
        back={{ href: "/platform/support", label: "Support desk" }}
        kicker={t ? `${t.number} · ${titleCase(t.category)}` : "Ticket"}
        title={t?.subject ?? "…"}
        meta={
          t ? (
            <>
              <StatusPill status={t.status} />
              <PriorityPill p={t.priority} />
              <Pill tone="ghost">{t.tenant_name}</Pill>
            </>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {!q.data ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : (
            <ol className="space-y-3" aria-label="Conversation">
              {q.data.messages.map((m) => (
                <li
                  key={m.id}
                  className={cn(
                    "rounded-xl p-4 ring-1",
                    m.is_internal ? "bg-amber-50 ring-amber-600/25" : m.author_type === "ADMIN" ? "ml-6 bg-paper ring-ink/[0.08]" : "mr-6 bg-bone ring-ink/[0.08]"
                  )}
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-2 font-semibold text-ink">
                      {m.author_type === "ADMIN" ? <ShieldIcon size={12} className="text-gold-dark" /> : null}
                      {m.author_name}
                      <span className="font-normal text-ink-4">{m.author_type === "TENANT" ? "shop" : m.author_type === "ADMIN" ? "staff" : "system"}</span>
                      {m.is_internal ? <Pill tone="warning">Internal note</Pill> : null}
                    </span>
                    <time className="text-ink-4" title={dateTime(m.created_at)}>
                      {relative(m.created_at)}
                    </time>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-ink-2">{m.body}</p>
                </li>
              ))}
            </ol>
          )}

          {manage && t && t.status !== "CLOSED" ? (
            <Panel title={internal ? "Internal note" : "Reply to shop"} description={internal ? "Only staff see this. Status and SLA clock are unchanged." : "Sends to the shop and marks the ticket Pending."} icon={<LifeBuoyIcon size={16} />}>
              <textarea
                rows={5}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) reply.mutate();
                }}
                className={cn(controlClass, "h-auto w-full py-2", internal && "bg-amber-50")}
                placeholder={internal ? "Context for teammates…" : "Write a reply…"}
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <label className="flex items-center gap-2.5 text-sm text-ink-3">
                  <Toggle checked={internal} onChange={setInternal} label="Internal note" /> Internal note
                </label>
                <div className="flex gap-2">
                  {!internal ? (
                    <button
                      onClick={async () => {
                        await reply.mutateAsync();
                        edit.mutate({ status: "RESOLVED" });
                      }}
                      disabled={!body.trim() || reply.isPending}
                      className="g-btn g-btn-secondary h-10 px-4 text-sm"
                    >
                      Send & resolve
                    </button>
                  ) : null}
                  <button onClick={() => reply.mutate()} disabled={!body.trim() || reply.isPending} className="g-btn g-btn-primary h-10 px-4 text-sm">
                    {internal ? "Add note" : "Send reply"}
                  </button>
                </div>
              </div>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-6">
          <Panel title="Details" icon={<LifeBuoyIcon size={16} />}>
            {t ? (
              <div className="space-y-4">
                <F label="Status">
                  <select disabled={!manage} value={t.status} onChange={(e) => edit.mutate({ status: e.target.value })} className={cn(controlClass, "w-full")}>
                    {TICKET_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {titleCase(s)}
                      </option>
                    ))}
                  </select>
                </F>
                <F label="Priority">
                  <select disabled={!manage} value={t.priority} onChange={(e) => edit.mutate({ priority: e.target.value })} className={cn(controlClass, "w-full")}>
                    {TICKET_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {titleCase(p)}
                      </option>
                    ))}
                  </select>
                </F>
                <F label="Assignee">
                  <select disabled={!manage} value={t.assignee_id ?? ""} onChange={(e) => edit.mutate({ assigneeId: e.target.value || null })} className={cn(controlClass, "w-full")}>
                    <option value="">Unassigned</option>
                    {me.data ? <option value={me.data.admin.id}>Me ({me.data.admin.name})</option> : null}
                    {(team.data ?? [])
                      .filter((a) => a.is_active && a.id !== me.data?.admin.id)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    {t.assignee_id && t.assignee_id !== me.data?.admin.id && !(team.data ?? []).some((a) => a.id === t.assignee_id) ? (
                      <option value={t.assignee_id}>{t.assignee_name}</option>
                    ) : null}
                  </select>
                </F>
              </div>
            ) : (
              <Skeleton className="h-40" />
            )}
          </Panel>
          {t ? (
            <Panel title="Context" icon={<ShieldIcon size={16} />}>
              <DetailList
                items={[
                  { label: "Account", value: <Link href={`/platform/tenants/${t.tenant_id}`} className="text-gold-dark hover:underline">{t.tenant_name}</Link> },
                  { label: "Requester", value: t.requester_email ?? "—" },
                  { label: "Opened", value: dateTime(t.created_at) },
                  { label: "First response", value: t.first_response_at ? `${duration(t.first_response_at - t.created_at)} after opening` : <span className="font-medium text-rose-700">Awaiting · {relative(t.created_at)}</span> },
                  ...(t.resolved_at ? [{ label: "Resolved", value: `${dateTime(t.resolved_at)} · took ${duration(t.resolved_at - t.created_at)}` }] : []),
                ]}
              />
            </Panel>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
