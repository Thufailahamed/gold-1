"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";

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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-stone-500">Accounts, roles and branch access</p>
        </div>
        {canCreate ? (
          <button
            onClick={() => setDialog(true)}
            className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
          >
            New
          </button>
        ) : null}
      </div>
      <input
        placeholder="Search…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        className="w-full max-w-sm rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
      />
      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-stone-200" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-2">
                    <button onClick={() => setDetailId(r.id)} className="hover:underline">
                      {r.name}
                    </button>
                  </td>
                  <td className="px-4 py-2">{r.email}</td>
                  <td className="px-4 py-2">{r.is_active ? "Active" : "Inactive"}</td>
                  <td className="px-4 py-2 text-right">
                    {canEdit ? (
                      <>
                        <button
                          onClick={() => setEditId(r.id)}
                          className="mr-3 text-xs hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => toggleActive(r)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          {r.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog ? (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
          <form
            onSubmit={handleSubmit((v) => create.mutate(v))}
            className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-xl bg-white p-6 shadow-lg"
          >
            <h2 className="font-semibold">New user</h2>
            <div>
              <label className="mb-1 block text-sm font-medium">Name</label>
              <input
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                {...register("name")}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <input
                type="email"
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                {...register("email")}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Password (min 8)</label>
              <input
                type="password"
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                {...register("password")}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Role</label>
              <select
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                {...register("role")}
              >
                <option value="">Select…</option>
                {(roles.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Branches</label>
              <select
                multiple
                className="h-24 w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                {...register("branchIds")}
              >
                {(branches.data?.rows ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(false)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={create.isPending}
                className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50"
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
    </div>
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
    <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-lg">
        <h2 className="font-semibold">Edit user</h2>
        {detail.isLoading ? (
          <div className="h-24 animate-pulse rounded bg-stone-200" />
        ) : (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium">Name</label>
              <input
                defaultValue={detail.data?.name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Role {canApprove ? "" : "(needs users:approve to change)"}
              </label>
              <select
                defaultValue={detail.data?.roles[0] ?? ""}
                disabled={!canApprove}
                onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold disabled:opacity-50"
              >
                {(roles.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Branches</label>
              <select
                multiple
                value={branchIds ?? detail.data?.branchIds ?? []}
                onChange={(e) =>
                  setBranchIds(Array.from(e.target.selectedOptions).map((o) => o.value))
                }
                className="h-24 w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
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
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-2 text-sm">
            Cancel
          </button>
          <button onClick={save} className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white">
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
    <div className="fixed inset-0 flex justify-end bg-black/30">
      <div className="w-full max-w-md space-y-4 overflow-y-auto bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">User detail</h2>
          <button onClick={onClose} className="text-sm text-stone-500 hover:underline">
            Close
          </button>
        </div>
        {detail.data ? (
          <div className="space-y-1 text-sm">
            <p><span className="text-stone-500">Name:</span> {detail.data.name}</p>
            <p><span className="text-stone-500">Email:</span> {detail.data.email}</p>
            <p><span className="text-stone-500">Status:</span> {detail.data.is_active ? "Active" : "Inactive"}</p>
            <p><span className="text-stone-500">Roles:</span> {detail.data.roles.join(", ")}</p>
            <p><span className="text-stone-500">Branches:</span> {detail.data.branchIds.length}</p>
          </div>
        ) : null}
        <h3 className="font-medium">Activity</h3>
        {(activity.data?.rows ?? []).length === 0 ? (
          <p className="text-sm text-stone-500">No activity recorded.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {(activity.data?.rows ?? []).map((a) => (
              <li key={a.id} className="rounded-md border border-stone-200 px-3 py-2">
                <span className="font-mono text-xs">{a.action}</span>
                <span className="text-stone-500"> · {a.entity} · </span>
                <span className="text-stone-400">{new Date(a.created_at).toLocaleString()}</span>
                {a.reason ? <p className="text-stone-500">Reason: {a.reason}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
