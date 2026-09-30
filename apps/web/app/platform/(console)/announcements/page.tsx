"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PLATFORM_PERMISSIONS as P } from "@goldos/shared";
import { EmptyBlock, FilterChips, Hero, heroBtnPrimary, Modal, Page, Pill, Skeleton, StatusPill, controlClass } from "@/components/ui";
import { MegaphoneIcon, PlusIcon } from "@/components/icons";
import { F } from "@/components/platform/dialogs";
import { AnnouncementPreview } from "@/components/platform/announcement-preview";
import { cn } from "@/lib/cn";
import { can, dateTime, papi, relative, usePlatformMe } from "@/lib/platform";

type Announcement = {
  id: string;
  title: string;
  body: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  audience: "ALL" | "PLAN" | "TENANT";
  audience_ref: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  starts_at: number | null;
  ends_at: number | null;
  published_at: number | null;
  created_at: number;
};
type Plan = { id: string; name: string };

function isLive(a: Announcement, now = Date.now()) {
  return a.status === "PUBLISHED" && (!a.starts_at || a.starts_at <= now) && (!a.ends_at || a.ends_at > now);
}

export default function AnnouncementsPage() {
  const me = usePlatformMe();
  const qc = useQueryClient();
  const manage = can(me.data, P.ANNOUNCEMENTS_MANAGE);
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Announcement | "new" | null>(null);
  const q = useQuery({ queryKey: ["p-announcements", status], queryFn: () => papi<Announcement[]>(`/announcements${status ? `?status=${status}` : ""}`) });
  const plans = useQuery({ queryKey: ["p-plans"], queryFn: () => papi<Plan[]>("/plans") });
  const act = useMutation({
    mutationFn: (v: { id: string; action: "publish" | "unpublish" | "archive" }) => papi(`/announcements/${v.id}/${v.action}`, { method: "POST" }),
    onSuccess: (_d, v) => {
      toast.success({ publish: "Published — shops see it now", unpublish: "Moved back to draft", archive: "Archived" }[v.action]);
      qc.invalidateQueries({ queryKey: ["p-announcements"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const rows = q.data ?? [];
  const planName = (id: string | null) => plans.data?.find((p) => p.id === id)?.name ?? id;

  return (
    <Page className="max-w-[88rem]">
      <Hero
        kicker="Product"
        title="Announcements"
        description="Banners inside every shop's console — releases, maintenance windows, incidents. Target everyone, a plan, or one account."
        actions={
          manage ? (
            <button onClick={() => setEditing("new")} className={heroBtnPrimary}>
              <PlusIcon size={15} /> New announcement
            </button>
          ) : undefined
        }
        stats={[
          { label: "Live now", value: rows.filter((a) => isLive(a)).length },
          { label: "Scheduled", value: rows.filter((a) => a.status === "PUBLISHED" && a.starts_at && a.starts_at > Date.now()).length },
          { label: "Drafts", value: rows.filter((a) => a.status === "DRAFT").length },
          { label: "Critical live", value: rows.filter((a) => isLive(a) && a.severity === "CRITICAL").length },
        ]}
      />

      <FilterChips
        value={status}
        onChange={setStatus}
        options={[
          { key: "", label: "All" },
          { key: "PUBLISHED", label: "Published" },
          { key: "DRAFT", label: "Drafts" },
          { key: "ARCHIVED", label: "Archived" },
        ]}
      />

      {q.isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : rows.length === 0 ? (
        <EmptyBlock icon={<MegaphoneIcon size={22} />} title="No announcements" description="Publish one to show a banner inside shop consoles." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((a) => (
            <article key={a.id} className="g-surface flex flex-col gap-4 p-5">
              <div className="flex flex-wrap items-center gap-2">
                {isLive(a) ? <Pill tone="success" dot>Live</Pill> : <StatusPill status={a.status} />}
                <Pill tone={a.severity === "CRITICAL" ? "danger" : a.severity === "WARNING" ? "warning" : "info"}>{a.severity.toLowerCase()}</Pill>
                <Pill>
                  {a.audience === "ALL" ? "All shops" : a.audience === "PLAN" ? `Plan: ${planName(a.audience_ref)}` : `Account: ${a.audience_ref?.slice(0, 8)}…`}
                </Pill>
              </div>
              <AnnouncementPreview a={a} />
              <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-ink-4">
                <span>
                  {a.starts_at ? `From ${dateTime(a.starts_at)}` : "Immediately"}
                  {a.ends_at ? ` · until ${dateTime(a.ends_at)}` : " · no end"}
                  {a.published_at ? ` · published ${relative(a.published_at)}` : ""}
                </span>
                {manage && a.status !== "ARCHIVED" ? (
                  <span className="flex gap-3 text-xs font-medium">
                    <button onClick={() => setEditing(a)} className="text-ink-3 hover:text-ink hover:underline">
                      Edit
                    </button>
                    {a.status === "DRAFT" ? (
                      <button onClick={() => act.mutate({ id: a.id, action: "publish" })} className="text-emerald-700 hover:underline">
                        Publish
                      </button>
                    ) : (
                      <button onClick={() => act.mutate({ id: a.id, action: "unpublish" })} className="text-amber-700 hover:underline">
                        Unpublish
                      </button>
                    )}
                    <button onClick={() => act.mutate({ id: a.id, action: "archive" })} className="text-rose-700 hover:underline">
                      Archive
                    </button>
                  </span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {editing ? <AnnouncementDialog a={editing === "new" ? null : editing} plans={plans.data ?? []} onClose={() => setEditing(null)} /> : null}
    </Page>
  );
}

const toLocalInput = (ms: number | null) => (ms ? new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const fromLocalInput = (s: string) => (s ? new Date(s).getTime() : null);

function AnnouncementDialog({ a, plans, onClose }: { a: Announcement | null; plans: Plan[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    title: a?.title ?? "",
    body: a?.body ?? "",
    severity: a?.severity ?? ("INFO" as Announcement["severity"]),
    audience: a?.audience ?? ("ALL" as Announcement["audience"]),
    audienceRef: a?.audience_ref ?? "",
    startsAt: toLocalInput(a?.starts_at ?? null),
    endsAt: toLocalInput(a?.ends_at ?? null),
  });
  const tenants = useQuery({
    queryKey: ["p-tenants", "announce-pick"],
    queryFn: () => papi<{ rows: Array<{ id: string; name: string }> }>("/tenants?limit=100&sort=name"),
    enabled: f.audience === "TENANT",
  });
  const save = useMutation({
    mutationFn: () => {
      const json = {
        title: f.title,
        body: f.body,
        severity: f.severity,
        audience: f.audience,
        audienceRef: f.audience === "ALL" ? null : f.audienceRef || null,
        startsAt: fromLocalInput(f.startsAt),
        endsAt: fromLocalInput(f.endsAt),
      };
      return a ? papi(`/announcements/${a.id}`, { method: "PATCH", json }) : papi("/announcements", { method: "POST", json });
    },
    onSuccess: () => {
      toast.success(a ? "Saved" : "Draft created — publish it when ready");
      qc.invalidateQueries({ queryKey: ["p-announcements"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  return (
    <Modal title={a ? "Edit announcement" : "New announcement"} kicker="Announcements" wide onClose={onClose} onSubmit={() => save.mutate()} submitLabel="Save" pending={save.isPending} submitDisabled={!f.title || !f.body || (f.audience !== "ALL" && !f.audienceRef)}>
      <div className="grid gap-4 sm:grid-cols-3">
        <F label="Title" className="sm:col-span-2">
          <input autoFocus maxLength={120} value={f.title} onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} className={cn(controlClass, "w-full")} />
        </F>
        <F label="Severity">
          <select value={f.severity} onChange={(e) => setF((s) => ({ ...s, severity: e.target.value as Announcement["severity"] }))} className={cn(controlClass, "w-full")}>
            <option value="INFO">Info</option>
            <option value="WARNING">Warning</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </F>
        <F label="Message" className="sm:col-span-3">
          <textarea rows={4} maxLength={4000} value={f.body} onChange={(e) => setF((s) => ({ ...s, body: e.target.value }))} className={cn(controlClass, "h-auto w-full py-2")} />
        </F>
        <F label="Audience">
          <select value={f.audience} onChange={(e) => setF((s) => ({ ...s, audience: e.target.value as Announcement["audience"], audienceRef: "" }))} className={cn(controlClass, "w-full")}>
            <option value="ALL">All shops</option>
            <option value="PLAN">One plan</option>
            <option value="TENANT">One account</option>
          </select>
        </F>
        {f.audience !== "ALL" ? (
          <F label={f.audience === "PLAN" ? "Plan" : "Account"} className="sm:col-span-2">
            <select value={f.audienceRef} onChange={(e) => setF((s) => ({ ...s, audienceRef: e.target.value }))} className={cn(controlClass, "w-full")}>
              <option value="">Select…</option>
              {(f.audience === "PLAN" ? plans : tenants.data?.rows ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </F>
        ) : (
          <div className="sm:col-span-2" />
        )}
        <F label="Show from" hint="Blank = as soon as published">
          <input type="datetime-local" value={f.startsAt} onChange={(e) => setF((s) => ({ ...s, startsAt: e.target.value }))} className={cn(controlClass, "w-full")} />
        </F>
        <F label="Hide after" hint="Blank = until archived">
          <input type="datetime-local" value={f.endsAt} onChange={(e) => setF((s) => ({ ...s, endsAt: e.target.value }))} className={cn(controlClass, "w-full")} />
        </F>
      </div>
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4">Preview</div>
        <AnnouncementPreview a={f} />
      </div>
    </Modal>
  );
}
