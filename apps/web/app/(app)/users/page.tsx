"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, StatusPill, Pill, DetailList, Modal, Skeleton, controlClass } from "@/components/ui";
import { Card, CardHead, Empty, FilterPills, GoldHero, HeroBadge, RowsSkeleton, ago, count, heroGold, inputCls, th, thead, tr } from "@/components/console-kit";
import { Building2Icon, ChevronRightIcon, EditIcon, HistoryIcon, PlusIcon, SearchIcon, ShieldIcon, UsersIcon, XIcon } from "@/components/icons";

/** A stable colour per person, so the same account reads the same everywhere. */
const AVATAR = ["#B8923F", "#059669", "#0284C7", "#7C3AED", "#E11D48", "#D97706", "#0D9488", "#4F46E5"];
const avatarTone = (key: string) => AVATAR[[...key].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length]!;
const initialsOf = (name: string, email: string) =>
  (name.trim() ? name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("") : email.slice(0, 2)).toUpperCase();

type User = { id: string; email: string; name: string; is_active: number };
type Role = { id: string; name: string };
type Branch = { id: string; name: string; code: string };

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8),
  role: z.string().min(1),
  branchIds: z.array(z.string()).min(1),
});

export default function UsersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [show, setShow] = useState<"all" | "active" | "inactive">("all");
  const [editId, setEditId] = useState<string | null>(null);
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeData>("/api/v1/auth/me"),
  });
  const canCreate = hasPermission(me.data?.permissions ?? [], "users:create");
  const canEdit = hasPermission(me.data?.permissions ?? [], "users:edit");
  const canApprove = hasPermission(me.data?.permissions ?? [], "users:approve");

  const list = useQuery({
    queryKey: ["users", search, page],
    queryFn: () =>
      api<{ rows: User[]; total: number }>(
        `/api/v1/users?search=${encodeURIComponent(search)}&page=${page}&limit=20`
      ),
  });
  const roles = useQuery({
    queryKey: ["roles-all"],
    queryFn: () => api<Role[]>("/api/v1/roles"),
  });
  const branches = useQuery({
    queryKey: ["branches-all"],
    queryFn: () => api<{ rows: Branch[]; total: number }>("/api/v1/branches?limit=100"),
  });

  const { register, handleSubmit, reset } = useForm<z.infer<typeof createSchema>>({
    resolver: zodResolver(createSchema),
  });
  const create = useMutation({
    mutationFn: (v: z.infer<typeof createSchema>) =>
      api("/api/v1/users", { method: "POST", body: JSON.stringify(v) }),
    onSuccess: () => {
      toast.success("User created");
      setDialog(false);
      reset();
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  async function toggleActive(u: User) {
    const reason = window.prompt(`Reason to ${u.is_active ? "deactivate" : "activate"} ${u.email} (required):`);
    if (!reason) return;
    try {
      await api(`/api/v1/users/${u.id}/${u.is_active ? "deactivate" : "activate"}`, {
        method: "PATCH",
        body: JSON.stringify({ reason }),
      });
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  const allRows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const activeN = allRows.filter((r) => r.is_active).length;
  const rows = show === "all" ? allRows : allRows.filter((r) => (show === "active" ? !!r.is_active : !r.is_active));
  const pages = Math.max(1, Math.ceil(total / 20));
  const myId = me.data?.user.id;

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={UsersIcon}
        title="Users"
        accent="& access"
        badge={<HeroBadge tone="muted">Organisation</HeroBadge>}
        sub="Staff accounts, roles and branch access · changes apply on the account's next request"
        back={{ href: "/setup", label: "Setup" }}
        actions={
          canCreate ? (
            <button onClick={() => setDialog(true)} className={heroGold}>
              <PlusIcon size={13} />
              New user
            </button>
          ) : undefined
        }
        stats={[
          { label: "Accounts", value: list.isLoading ? undefined : total, loading: list.isLoading, accent: true, sub: search ? `matching “${search}”` : "all staff" },
          { label: "Active", value: list.isLoading ? undefined : activeN, loading: list.isLoading, tone: "good", sub: "on this page" },
          { label: "Inactive", value: list.isLoading ? undefined : allRows.length - activeN, loading: list.isLoading, tone: allRows.length - activeN ? "warn" : undefined, sub: "on this page" },
          { label: "Roles", value: roles.data?.length, loading: roles.isLoading },
          { label: "Branches", value: branches.data?.total, loading: branches.isLoading, href: "/branches" },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-9">
          <div className="flex flex-wrap items-center gap-2 border-b border-ink/20 px-4 py-2.5">
            <div className="relative w-full max-w-xs">
              <SearchIcon size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-5" />
              <input
                placeholder="Search name or email…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className={cn(inputCls, "w-full pl-8")}
              />
            </div>
            <FilterPills
              value={show}
              onChange={setShow}
              items={[
                { key: "all", label: "All", count: allRows.length },
                { key: "active", label: "Active", count: activeN, dot: "bg-emerald-500" },
                { key: "inactive", label: "Inactive", count: allRows.length - activeN, dot: "bg-ink/30" },
              ]}
            />
          </div>
          {list.isLoading ? (
            <RowsSkeleton rows={6} />
          ) : rows.length === 0 ? (
            <Empty icon={UsersIcon} title="No users found" desc={search ? `Nothing matches “${search}”.` : "Try a different filter."} />
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-[12.5px]">
                <thead className={thead}>
                  <tr>
                    <th className={cn(th, "pl-4")}>Person</th>
                    <th className={th}>Email</th>
                    <th className={th}>Status</th>
                    <th className={cn(th, "pr-4 text-right")}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const tone = avatarTone(r.email);
                    return (
                      <tr key={r.id} className={cn(tr, !r.is_active && "opacity-60")}>
                        <td className="py-1.5 pl-4 pr-2">
                          <button onClick={() => setDetailId(r.id)} className="group flex items-center gap-2.5 text-left">
                            <span
                              className="flex size-8 shrink-0 items-center justify-center rounded-lg font-display text-[11px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
                              style={{ background: `linear-gradient(145deg, ${tone}, ${tone}cc)` }}
                            >
                              {initialsOf(r.name, r.email)}
                            </span>
                            <span className="leading-tight">
                              <span className="flex items-center gap-1.5 font-semibold text-ink group-hover:underline">
                                {r.name}
                                {r.id === myId ? <span className="rounded-full bg-gold/15 px-1.5 text-[9.5px] font-semibold text-gold-deep no-underline">You</span> : null}
                              </span>
                              <span className="text-[10.5px] text-ink-5">View profile & activity</span>
                            </span>
                          </button>
                        </td>
                        <td className="px-2 text-ink-3">{r.email}</td>
                        <td className="px-2">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset",
                              r.is_active ? "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25" : "bg-ink/[0.04] text-ink-5 ring-ink/20"
                            )}
                          >
                            <span className={cn("size-1.5 rounded-full", r.is_active ? "bg-emerald-500" : "bg-ink/30")} />
                            {r.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="py-1.5 pl-2 pr-4 text-right">
                          {canEdit ? (
                            <span className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => setEditId(r.id)}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-ink-3 ring-1 ring-inset ring-ink/20 transition-colors hover:bg-bone hover:text-ink"
                              >
                                <EditIcon size={11} />
                                Edit
                              </button>
                              <button
                                onClick={() => toggleActive(r)}
                                className={cn(
                                  "rounded-md px-2 py-1 text-[11px] font-semibold transition-colors",
                                  r.is_active ? "text-rose-700 hover:bg-rose-500/10" : "text-emerald-700 hover:bg-emerald-500/10"
                                )}
                              >
                                {r.is_active ? "Deactivate" : "Activate"}
                              </button>
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-ink/20 bg-bone/40 px-4 py-2 text-[11px] text-ink-4">
            <span>
              <span className="g-metric text-ink-2">{count(allRows.length)}</span> of <span className="g-metric text-ink-2">{count(total)}</span> accounts
            </span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                aria-label="Previous page"
                className="flex size-7 items-center justify-center rounded-md ring-1 ring-inset ring-ink/20 hover:bg-paper disabled:opacity-40"
              >
                <ChevronRightIcon size={13} className="rotate-180" />
              </button>
              <span className="g-metric px-1.5 text-ink-2">
                {page} / {pages}
              </span>
              <button
                type="button"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
                aria-label="Next page"
                className="flex size-7 items-center justify-center rounded-md ring-1 ring-inset ring-ink/20 hover:bg-paper disabled:opacity-40"
              >
                <ChevronRightIcon size={13} />
              </button>
            </span>
          </div>
        </Card>

        <div className="space-y-4 xl:col-span-3">
          <Card>
            <CardHead icon={ShieldIcon} title="Roles" sub="Each account holds one role" />
            {roles.isLoading ? (
              <RowsSkeleton rows={3} />
            ) : (
              <ul className="flex flex-wrap gap-1.5 p-3">
                {(roles.data ?? []).map((r) => (
                  <li
                    key={r.id}
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                    style={{ color: avatarTone(r.name), background: `${avatarTone(r.name)}14`, boxShadow: `inset 0 0 0 1px ${avatarTone(r.name)}33` }}
                  >
                    <span className="size-1.5 rounded-full" style={{ background: avatarTone(r.name) }} />
                    {r.name}
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-ink/20 px-4 py-2 text-[10.5px] text-ink-5">
              {canApprove ? "You can change roles." : "Changing a role needs users:approve."}
            </p>
          </Card>
          <Card>
            <CardHead icon={Building2Icon} title="Branches" sub="Accounts are granted branch by branch" />
            {branches.isLoading ? (
              <RowsSkeleton rows={3} />
            ) : (
              <ul className="divide-y divide-ink/[0.05]">
                {(branches.data?.rows ?? []).map((b) => (
                  <li key={b.id} className="flex items-center gap-2.5 px-4 py-2">
                    <span className="g-metric rounded bg-void px-1.5 py-px text-[10px] font-semibold text-gold-light">{b.code}</span>
                    <span className="truncate text-[12px] text-ink-2">{b.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {dialog ? (
        <Modal title="New user" kicker="Organisation" onClose={() => setDialog(false)} footer={false}>
          <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">Name</label>
              <input className={controlClass} {...register("name")} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">Email</label>
              <input type="email" className={controlClass} {...register("email")} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">
                Password (min 8)
              </label>
              <input type="password" className={controlClass} {...register("password")} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">Role</label>
              <select className={controlClass} {...register("role")}>
                <option value="">Select…</option>
                {(roles.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">Branches</label>
              <select multiple className={cn(controlClass, "h-28 py-2")} {...register("branchIds")}>
                {(branches.data?.rows ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDialog(false)}
                className="g-btn g-btn-secondary h-10 px-4 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={create.isPending}
                className="g-btn g-btn-primary h-10 px-4 text-sm"
              >
                Save
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
      {editId ? (
        <EditDialog
          id={editId}
          canApprove={canApprove}
          onClose={() => {
            setEditId(null);
            qc.invalidateQueries({ queryKey: ["users"] });
          }}
        />
      ) : null}
      {detailId ? <DetailDrawer id={detailId} onClose={() => setDetailId(null)} /> : null}
    </Page>
  );
}

function EditDialog({ id, canApprove, onClose }: { id: string; canApprove: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["user", id],
    queryFn: () =>
      api<{ name: string; roles: string[]; branchIds: string[] }>(`/api/v1/users/${id}`),
  });
  const roles = useQuery({ queryKey: ["roles-all"], queryFn: () => api<Role[]>("/api/v1/roles") });
  const branches = useQuery({
    queryKey: ["branches-all"],
    queryFn: () => api<{ rows: Branch[]; total: number }>("/api/v1/branches?limit=100"),
  });
  const [name, setName] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [branchIds, setBranchIds] = useState<string[] | null>(null);

  async function save() {
    const body: Record<string, unknown> = {};
    if (name !== null && name !== detail.data?.name) body.name = name;
    if (role !== null && !(detail.data?.roles ?? []).includes(role)) body.role = role;
    if (branchIds !== null) body.branchIds = branchIds;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    try {
      await api(`/api/v1/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast.success("User updated");
      qc.invalidateQueries({ queryKey: ["user", id] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  return (
    <Modal title="Edit user" kicker="Organisation" onClose={onClose} footer={false}>
      <div className="space-y-4">
        {detail.isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">Name</label>
              <input
                defaultValue={detail.data?.name}
                onChange={(e) => setName(e.target.value)}
                className={controlClass}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">
                Role {canApprove ? "" : "(needs users:approve to change)"}
              </label>
              <select
                defaultValue={detail.data?.roles[0] ?? ""}
                disabled={!canApprove}
                onChange={(e) => setRole(e.target.value)}
                className={controlClass}
              >
                {(roles.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">Branches</label>
              <select
                multiple
                value={branchIds ?? detail.data?.branchIds ?? []}
                onChange={(e) =>
                  setBranchIds(Array.from(e.target.selectedOptions).map((o) => o.value))
                }
                className={cn(controlClass, "h-28 py-2")}
              >
                {(branches.data?.rows ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="g-btn g-btn-secondary h-10 px-4 text-sm">
            Cancel
          </button>
          <button onClick={save} className="g-btn g-btn-primary h-10 px-4 text-sm">
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

type AuditRow = { id: string; action: string; entity: string; created_at: number; reason: string | null };

function DetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["user", id],
    queryFn: () =>
      api<{ email: string; name: string; is_active: number; roles: string[]; branchIds: string[] }>(
        `/api/v1/users/${id}`
      ),
  });
  const activity = useQuery({
    queryKey: ["user-activity", id],
    queryFn: () => api<{ rows: AuditRow[]; total: number }>(`/api/v1/audit?userId=${id}&limit=20`),
  });
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="h-full w-full max-w-md animate-fade-in space-y-5 overflow-y-auto bg-paper p-6 shadow-4 scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="User detail"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="g-kicker">User detail</div>
            <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-ink">
              {detail.data?.name ?? "…"}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-ink-4 transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <XIcon size={16} />
          </button>
        </div>
        {detail.data ? (
          <>
            <DetailList
              columns={1}
              items={[
                { label: "Email", value: detail.data.email },
                {
                  label: "Status",
                  value: (
                    <StatusPill
                      status={detail.data.is_active ? "active" : "inactive"}
                      label={detail.data.is_active ? "Active" : "Inactive"}
                    />
                  ),
                },
                {
                  label: "Roles",
                  value: (
                    <span className="flex flex-wrap gap-1.5">
                      {detail.data.roles.map((r) => (
                        <Pill key={r} tone="neutral">
                          {r}
                        </Pill>
                      ))}
                    </span>
                  ),
                },
                { label: "Branches", value: <span className="num-tabular">{detail.data.branchIds.length}</span> },
              ]}
            />
          </>
        ) : (
          <Skeleton className="h-32" />
        )}
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4">
            <HistoryIcon size={12} />
            Activity
            <span className="g-metric ml-auto normal-case tracking-normal text-ink-5">{activity.data?.total ?? 0} events</span>
          </div>
          {(activity.data?.rows ?? []).length === 0 ? (
            <p className="text-sm text-ink-4">No activity recorded.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(activity.data?.rows ?? []).map((a) => (
                <li key={a.id} className="relative rounded-xl bg-bone/60 py-2 pl-4 pr-3 ring-1 ring-inset ring-ink/20">
                  <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-gold" aria-hidden />
                  <div className="flex items-center justify-between gap-2">
                    <Pill tone="neutral" className="font-mono normal-case tracking-normal">
                      {a.action}
                    </Pill>
                    <span className="text-[11px] text-ink-5" title={new Date(a.created_at).toLocaleString()}>
                      {ago(a.created_at)}
                    </span>
                  </div>
                  <div className="mt-1.5 text-xs text-ink-4">{a.entity}</div>
                  {a.reason ? <p className="mt-1 text-xs text-ink-3">Reason: {a.reason}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
