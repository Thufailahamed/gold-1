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
import {
  Page,
  Hero,
  heroBtnPrimary,
  TableCard,
  TableSkeleton,
  Pager,
  StatusPill,
  EmptyBlock,
  Pill,
  DetailList,
  Skeleton,
  controlClass,
} from "@/components/ui";
import { ArrowRightIcon, PlusIcon, SearchIcon, XIcon } from "@/components/icons";

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

  const rows = list.data?.rows ?? [];

  return (
    <Page>
      <Hero
        kicker="Organisation"
        title="Users"
        description="Accounts, roles and branch access."
        actions={
          canCreate ? (
            <button onClick={() => setDialog(true)} className={heroBtnPrimary}>
              <PlusIcon size={15} />
              New user
              <ArrowRightIcon size={14} className="g-btn-arrow" />
            </button>
          ) : undefined
        }
        stats={[
          { label: "Accounts", value: list.isLoading ? "—" : (list.data?.total ?? 0) },
          { label: "Roles", value: roles.data?.length ?? "—" },
          { label: "Branches", value: branches.data?.total ?? "—" },
          {
            label: "Active (page)",
            value: list.isLoading ? "—" : rows.filter((r) => r.is_active).length,
          },
        ]}
        note="Role and branch changes take effect on the account's next request"
      />

      <TableCard
        toolbar={
          <div className="relative w-full max-w-sm">
            <SearchIcon
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"
            />
            <input
              placeholder="Search…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className={cn(controlClass, "pl-9")}
            />
          </div>
        }
        footer={
          <Pager
            page={page}
            onChange={setPage}
            pageSize={20}
            count={rows.length}
            total={list.data?.total ?? 0}
            unit="accounts"
          />
        }
      >
        {list.isLoading ? (
          <TableSkeleton rows={5} cols={4} />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No users found" description="Try a different search." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th className="!text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button
                      onClick={() => setDetailId(r.id)}
                      className="group flex items-center gap-3 text-left"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink font-mono text-[10px] font-bold text-gold transition-colors group-hover:bg-gold group-hover:text-ink">
                        {(r.name || r.email).slice(0, 2).toUpperCase()}
                      </span>
                      <span className="font-medium text-ink group-hover:underline">{r.name}</span>
                    </button>
                  </td>
                  <td className="text-ink-3">{r.email}</td>
                  <td>
                    <StatusPill
                      status={r.is_active ? "active" : "inactive"}
                      label={r.is_active ? "Active" : "Inactive"}
                    />
                  </td>
                  <td className="text-right">
                    {canEdit ? (
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => setEditId(r.id)}
                          className="text-xs font-medium text-ink-3 transition-colors hover:text-ink hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => toggleActive(r)}
                          className={cn(
                            "text-xs font-medium transition-colors hover:underline",
                            r.is_active ? "text-rose-700" : "text-emerald-700"
                          )}
                        >
                          {r.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {dialog ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
          onClick={() => setDialog(false)}
        >
          <form
            onSubmit={handleSubmit((v) => create.mutate(v))}
            className="g-floating max-h-[90vh] w-full max-w-md animate-fade-in space-y-4 overflow-y-auto p-6 scrollbar-thin"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="g-kicker">Organisation</div>
                <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-ink">
                  New user
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDialog(false)}
                aria-label="Close"
                className="flex size-8 items-center justify-center rounded-lg text-ink-4 transition-colors hover:bg-ink/5 hover:text-ink"
              >
                <XIcon size={16} />
              </button>
            </div>
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
        </div>
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="g-floating w-full max-w-md animate-fade-in space-y-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="g-kicker">Organisation</div>
            <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-ink">
              Edit user
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-ink-4 transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <XIcon size={16} />
          </button>
        </div>
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
    </div>
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
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4">
            Activity
          </div>
          {(activity.data?.rows ?? []).length === 0 ? (
            <p className="text-sm text-ink-4">No activity recorded.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(activity.data?.rows ?? []).map((a) => (
                <li key={a.id} className="g-surface p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Pill tone="neutral" className="font-mono normal-case tracking-normal">
                      {a.action}
                    </Pill>
                    <span className="text-[11px] text-ink-5">
                      {new Date(a.created_at).toLocaleString()}
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
