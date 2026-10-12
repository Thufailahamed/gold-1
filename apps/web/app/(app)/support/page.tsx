"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { TICKET_PRIORITIES } from "@goldos/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Modal, Page, Skeleton, controlClass } from "@/components/ui";
import { Card, CardHead, Empty, FilterPills, GoldHero, HeroBadge, RowsSkeleton, ago, heroGold, th, thead, tr } from "@/components/console-kit";
import { CheckCircleIcon, LifeBuoyIcon, PlusIcon, SendIcon, XIcon } from "@/components/icons";

const STATUS: Record<string, { label: string; dot: string; chip: string }> = {
  OPEN: { label: "Open", dot: "bg-sky-500", chip: "bg-sky-500/10 text-sky-800 ring-sky-500/25" },
  PENDING: { label: "Awaiting you", dot: "bg-amber-500", chip: "bg-amber-500/10 text-amber-800 ring-amber-500/25" },
  RESOLVED: { label: "Resolved", dot: "bg-emerald-500", chip: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25" },
  CLOSED: { label: "Closed", dot: "bg-ink/30", chip: "bg-ink/[0.04] text-ink-5 ring-ink/10" },
};
const PRIORITY: Record<string, string> = { URGENT: "text-rose-700", HIGH: "text-amber-700", NORMAL: "text-ink-3", LOW: "text-ink-5" };
function StatusChip({ status }: { status: string }) {
  const m = STATUS[status] ?? { label: status.toLowerCase(), dot: "bg-ink/30", chip: "bg-ink/[0.05] text-ink-3 ring-ink/10" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset", m.chip)}>
      <span className={cn("size-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}
import { usePlatformContext } from "@/components/platform-banner";

type Ticket = { id: string; number: string; subject: string; status: string; priority: string; updated_at: number; message_count: number };
type Thread = { ticket: Ticket & { created_at: number }; messages: Array<{ id: string; author_type: string; author_name: string; body: string; created_at: number }> };

const when = (ms: number) => new Date(ms).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function ShopSupportPage() {
  const ctx = usePlatformContext();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const managed = ctx.data?.managed === true;
  const list = useQuery({ queryKey: ["shop-tickets"], queryFn: () => api<{ rows: Ticket[] }>("/api/v1/platform/support"), enabled: managed });
  const allRows = list.data?.rows ?? [];
  const [show, setShow] = useState<"all" | "live" | "done">("all");
  const isLive = (t: Ticket) => t.status === "OPEN" || t.status === "PENDING";
  const rows = show === "all" ? allRows : allRows.filter((t) => (show === "live" ? isLive(t) : !isLive(t)));
  const awaiting = allRows.filter((t) => t.status === "PENDING").length;

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={LifeBuoyIcon}
        title="Help &"
        accent="support"
        badge={managed ? <HeroBadge tone={awaiting ? "warn" : "good"}>{awaiting ? `${awaiting} awaiting you` : "Connected"}</HeroBadge> : <HeroBadge tone="muted">Not connected</HeroBadge>}
        sub="Questions, problems or requests for the GoldOS team · we reply here and by email"
        back={{ href: "/setup", label: "Setup" }}
        actions={
          managed ? (
            <button onClick={() => setCreating(true)} className={heroGold}>
              <PlusIcon size={13} /> New request
            </button>
          ) : undefined
        }
        stats={
          managed
            ? [
                { label: "Open", value: list.isLoading ? undefined : allRows.filter(isLive).length, loading: list.isLoading, accent: true },
                { label: "Awaiting you", value: list.isLoading ? undefined : awaiting, loading: list.isLoading, tone: awaiting ? "warn" : undefined },
                { label: "Resolved", value: list.isLoading ? undefined : allRows.filter((t) => !isLive(t)).length, loading: list.isLoading, tone: "good" },
                { label: "All requests", value: list.isLoading ? undefined : allRows.length, loading: list.isLoading },
              ]
            : undefined
        }
      />
      {ctx.isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : !managed ? (
        <Card>
          <Empty icon={LifeBuoyIcon} title="Support desk not connected" desc="This workspace isn’t linked to a GoldOS platform account. Contact your administrator." />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-12">
          <Card className="xl:col-span-8">
            <div className="flex items-center gap-2 border-b border-ink/[0.06] px-4 py-2.5">
              <FilterPills
                value={show}
                onChange={setShow}
                items={[
                  { key: "all", label: "All", count: allRows.length },
                  { key: "live", label: "Open", count: allRows.filter(isLive).length, dot: "bg-sky-500" },
                  { key: "done", label: "Done", count: allRows.filter((t) => !isLive(t)).length, dot: "bg-emerald-500" },
                ]}
              />
            </div>
            {list.isLoading ? (
              <RowsSkeleton rows={4} />
            ) : rows.length === 0 ? (
              <Empty
                icon={LifeBuoyIcon}
                title={allRows.length ? "Nothing in this view" : "No requests yet"}
                desc="Open one and the team will get back to you."
                action={
                  <button onClick={() => setCreating(true)} className="g-btn g-btn-primary h-8 px-3 text-[12px]">
                    <PlusIcon size={13} /> New
                  </button>
                }
              />
            ) : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-[12.5px]">
                  <thead className={thead}>
                    <tr>
                      <th className={cn(th, "pl-4")}>Request</th>
                      <th className={th}>Status</th>
                      <th className={th}>Priority</th>
                      <th className={cn(th, "text-right")}>Messages</th>
                      <th className={cn(th, "pr-4")}>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => (
                      <tr key={t.id} className={cn(tr, "cursor-pointer", t.status === "PENDING" && "bg-amber-500/[0.04]")} onClick={() => setOpen(t.id)}>
                        <td className="py-2 pl-4 pr-2">
                          <span className="g-metric block text-[10.5px] text-ink-5">{t.number}</span>
                          <span className="font-semibold text-ink">{t.subject}</span>
                        </td>
                        <td className="px-2">
                          <StatusChip status={t.status} />
                        </td>
                        <td className={cn("px-2 text-[11.5px] font-semibold capitalize", PRIORITY[t.priority] ?? "text-ink-3")}>{t.priority.toLowerCase()}</td>
                        <td className="g-metric px-2 text-right text-ink-3">{t.message_count}</td>
                        <td className="whitespace-nowrap px-2 pr-4 text-ink-4" title={when(t.updated_at)}>
                          {ago(t.updated_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card className="xl:col-span-4">
            <CardHead icon={CheckCircleIcon} title="Getting a fast answer" sub="What helps the team most" />
            <ol className="space-y-2.5 p-4 text-[12px] text-ink-3">
              {[
                ["Say which screen", "Module and page, e.g. Sales → Invoices."],
                ["Quote the numbers", "Invoice, barcode or OG numbers make it traceable."],
                ["Pick the right urgency", "Urgent is for the till being unable to sell."],
                ["Watch for “Awaiting you”", "That means the team has asked you something."],
              ].map(([h, d], i) => (
                <li key={h} className="flex gap-2.5">
                  <span className="g-metric flex size-5 shrink-0 items-center justify-center rounded-full bg-void text-[10px] font-semibold text-gold-light">{i + 1}</span>
                  <span>
                    <span className="block font-semibold text-ink">{h}</span>
                    {d}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}
      {creating ? <NewRequest onClose={() => setCreating(false)} onDone={() => qc.invalidateQueries({ queryKey: ["shop-tickets"] })} /> : null}
      {open ? <ThreadDrawer id={open} onClose={() => setOpen(null)} /> : null}
    </Page>
  );
}

function NewRequest({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ subject: "", body: "", priority: "NORMAL", category: "general" });
  const m = useMutation({
    mutationFn: () => api<{ number: string }>("/api/v1/platform/support", { method: "POST", body: JSON.stringify(f) }),
    onSuccess: (r) => {
      toast.success(`Request ${r.number} sent`);
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <Modal title="New support request" kicker="Support" onClose={onClose} onSubmit={() => m.mutate()} submitLabel="Send" pending={m.isPending} submitDisabled={f.subject.length < 3 || !f.body}>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-ink-3">Subject</span>
        <input autoFocus value={f.subject} onChange={(e) => setF((s) => ({ ...s, subject: e.target.value }))} className={cn(controlClass, "w-full")} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-3">Topic</span>
          <select value={f.category} onChange={(e) => setF((s) => ({ ...s, category: e.target.value }))} className={cn(controlClass, "w-full")}>
            <option value="general">General question</option>
            <option value="bug">Something isn&rsquo;t working</option>
            <option value="billing">Billing</option>
            <option value="data">Data correction</option>
            <option value="feature_request">Feature request</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-3">Urgency</span>
          <select value={f.priority} onChange={(e) => setF((s) => ({ ...s, priority: e.target.value }))} className={cn(controlClass, "w-full")}>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0) + p.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-ink-3">Details</span>
        <textarea rows={6} value={f.body} onChange={(e) => setF((s) => ({ ...s, body: e.target.value }))} placeholder="What happened, which screen, any invoice or barcode numbers…" className={cn(controlClass, "h-auto w-full py-2")} />
      </label>
    </Modal>
  );
}

function ThreadDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const q = useQuery({ queryKey: ["shop-ticket", id], queryFn: () => api<Thread>(`/api/v1/platform/support/${id}`) });
  const reply = useMutation({
    mutationFn: () => api(`/api/v1/platform/support/${id}/replies`, { method: "POST", body: JSON.stringify({ body }) }),
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["shop-ticket", id] });
      qc.invalidateQueries({ queryKey: ["shop-tickets"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const t = q.data?.ticket;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/60 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Support request" onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-lg animate-slide-in flex-col bg-paper shadow-4">
        <div className="relative flex items-start justify-between gap-3 overflow-hidden bg-void p-5 text-paper">
          <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-gold/[0.16] blur-[70px]" />
          <div className="relative min-w-0">
            <div className="flex items-center gap-2">
              <span className="g-metric text-[10.5px] text-gold-light/80">{t?.number ?? "Request"}</span>
              {t ? <StatusChip status={t.status} /> : null}
            </div>
            <h2 className="g-display mt-1 truncate text-[19px]">{t?.subject ?? "…"}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="relative flex size-8 items-center justify-center rounded-lg text-paper/50 hover:bg-paper/10 hover:text-paper">
            <XIcon size={16} />
          </button>
        </div>
        <ol className="flex-1 space-y-3 overflow-y-auto bg-bone/50 p-5 scrollbar-thin">
          {(q.data?.messages ?? []).map((m) => (
            <li key={m.id} className={cn("rounded-2xl p-3.5 text-[13px] shadow-[0_8px_20px_-16px_rgba(16,32,27,0.5)] ring-1 ring-ink/[0.07]", m.author_type === "ADMIN" ? "mr-8 rounded-tl-sm bg-gold-pale" : "ml-8 rounded-tr-sm bg-paper")}>
              <div className="mb-1 flex justify-between text-xs">
                <span className="font-semibold">{m.author_type === "ADMIN" ? `${m.author_name} · GoldOS` : m.author_name}</span>
                <span className="text-ink-4">{when(m.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap text-ink-2">{m.body}</p>
            </li>
          ))}
        </ol>
        {t && t.status !== "CLOSED" ? (
          <div className="border-t border-ink/[0.07] p-4">
            <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Reply…" className={cn(controlClass, "h-auto w-full py-2")} />
            <div className="mt-2 flex justify-end">
              <button onClick={() => reply.mutate()} disabled={!body.trim() || reply.isPending} className="g-btn g-btn-primary h-9 px-4 text-sm">
                <SendIcon size={13} />
                Send
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
