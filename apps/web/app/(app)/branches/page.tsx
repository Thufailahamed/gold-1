"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";

type Branch = { id: string; name: string; code: string; address: string | null; is_active: number };

const branchSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
  address: z.string().max(500).optional(),
});

export default function BranchesPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCreate = hasPermission(me.data?.permissions ?? [], "branches:create");
  const canEdit = hasPermission(me.data?.permissions ?? [], "branches:edit");
  const canSettings = hasPermission(me.data?.permissions ?? [], "settings:manage");

  const list = useQuery({
    queryKey: ["branches", search, page],
    queryFn: () =>
      api<{ rows: Branch[]; total: number }>(
        `/api/v1/branches?search=${encodeURIComponent(search)}&page=${page}&limit=20`
      ),
  });
  const { register, handleSubmit, reset } = useForm<z.infer<typeof branchSchema>>({
    resolver: zodResolver(branchSchema),
  });
  const create = useMutation({
    mutationFn: (v: z.infer<typeof branchSchema>) =>
      api("/api/v1/branches", { method: "POST", body: JSON.stringify(v) }),
    onSuccess: () => {
      toast.success("Branch created");
      setDialog(false);
      reset();
      qc.invalidateQueries({ queryKey: ["branches"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  async function toggleActive(b: Branch) {
    const reason = window.prompt(`Reason to ${b.is_active ? "deactivate" : "activate"} ${b.name} (required):`);
    if (!reason) return;
    try {
      await api(`/api/v1/branches/${b.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: b.is_active ? 0 : 1, reason }),
      });
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["branches"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Branches</h1>
          <p className="text-sm text-stone-500">Shops in the network</p>
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
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {(list.data?.rows ?? []).map((b) => (
                <tr key={b.id} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-2">{b.name}</td>
                  <td className="px-4 py-2 font-mono">{b.code}</td>
                  <td className="px-4 py-2">{b.is_active ? "Active" : "Inactive"}</td>
                  <td className="px-4 py-2 text-right">
                    {canSettings ? (
                      <button
                        onClick={() => setSettingsId(b.id)}
                        className="mr-3 text-xs hover:underline"
                      >
                        Settings
                      </button>
                    ) : null}
                    {canEdit ? (
                      <button
                        onClick={() => toggleActive(b)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        {b.is_active ? "Deactivate" : "Activate"}
                      </button>
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
            className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-lg"
          >
            <h2 className="font-semibold">New branch</h2>
            <div>
              <label className="mb-1 block text-sm font-medium">Name</label>
              <input
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                {...register("name")}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Code</label>
              <input
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                {...register("code")}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Address</label>
              <input
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                {...register("address")}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(false)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button type="submit" className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white">
                Save
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {settingsId ? <BranchSettings id={settingsId} onClose={() => setSettingsId(null)} /> : null}
    </div>
  );
}

function BranchSettings({ id, onClose }: { id: string; onClose: () => void }) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const fullKey = key ? `branch.${id}.${key}` : "";

  async function save() {
    if (!key) return;
    try {
      await api(`/api/v1/settings/${encodeURIComponent(fullKey)}`, {
        method: "PUT",
        body: JSON.stringify({ value, type: "string" }),
      });
      toast.success("Setting saved");
      setSaved((s) => [...s, fullKey]);
      setKey("");
      setValue("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-lg">
        <h2 className="font-semibold">Branch settings</h2>
        <p className="text-xs text-stone-500">Keys are stored as branch.{id}.*</p>
        <div className="flex gap-2">
          <input
            placeholder="key (e.g. receipt_footer)"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
          />
          <input
            placeholder="value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
          />
          <button onClick={save} className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white">
            Save
          </button>
        </div>
        {saved.length > 0 ? (
          <ul className="space-y-1 text-sm text-stone-600">
            {saved.map((k) => (
              <li key={k} className="font-mono text-xs">{k} ✓</li>
            ))}
          </ul>
        ) : null}
        <div className="flex justify-end">
          <button onClick={onClose} className="rounded-md border px-3 py-2 text-sm">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
