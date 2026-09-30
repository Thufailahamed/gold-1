"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { TICKET_PRIORITIES } from "@goldos/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Callout, EmptyBlock, Hero, heroBtnPrimary, Modal, Page, Pill, Skeleton, StatusPill, TableCard, controlClass } from "@/components/ui";
import { LifeBuoyIcon, PlusIcon, XIcon } from "@/components/icons";
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
  const rows = list.data?.rows ?? [];

  return (
    <Page>
      <Hero
        kicker="Help"
        title="Support"
        description="Questions, problems or requests for the GoldOS team. We reply here and by email."
        actions={
          managed ? (
            <button onClick={() => setCreating(true)} className={heroBtnPrimary}>
              <PlusIcon size={15} /> New request
            </button>
          ) : undefined
        }
        stats={managed ? [{ label: "Open", value: rows.filter((r) => r.status === "OPEN" || r.status === "PENDING").length }, { label: "All requests", value: rows.length }] : undefined}
      />
      {ctx.isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : !managed ? (
        <Callout tone="info" title="Support desk not connected">
          This workspace isn&rsquo;t linked to a GoldOS platform account. Contact your administrator.
        </Callout>
      ) : (
        <TableCard>
          {list.isLoading ? (
            <Skeleton className="m-5 h-32" />
          ) : rows.length === 0 ? (
            <EmptyBlock icon={<LifeBuoyIcon size={22} />} title="No requests yet" description="Open one and the team will get back to you." />
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="cursor-pointer" onClick={() => setOpen(t.id)}>
                    <td>
                      <span className="font-mono text-xs text-ink-4">{t.number}</span> <span className="font-medium">{t.subject}</span>
                    </td>
                    <td>
                      <StatusPill status={t.status} label={t.status === "PENDING" ? "Awaiting you" : undefined} />
                    </td>
                    <td>
                      <Pill>{t.priority.toLowerCase()}</Pill>
                    </td>
                    <td className="text-ink-3">{when(t.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
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
        <div className="flex items-start justify-between gap-3 border-b border-ink/[0.07] p-5">
          <div className="min-w-0">
            <div className="g-kicker">{t?.number ?? "Request"}</div>
            <h2 className="mt-1 truncate font-display text-lg font-bold text-ink">{t?.subject ?? "…"}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-lg text-ink-4 hover:bg-ink/5">
            <XIcon size={16} />
          </button>
        </div>
        <ol className="flex-1 space-y-3 overflow-y-auto p-5 scrollbar-thin">
          {(q.data?.messages ?? []).map((m) => (
            <li key={m.id} className={cn("rounded-xl p-3.5 text-sm ring-1 ring-ink/[0.08]", m.author_type === "ADMIN" ? "mr-6 bg-gold/[0.07]" : "ml-6 bg-bone")}>
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
              <button onClick={() => reply.mutate()} disabled={!body.trim() || reply.isPending} className="g-btn g-btn-primary h-10 px-4 text-sm">
                Send
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
