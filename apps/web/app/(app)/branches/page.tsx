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
  controlClass,
} from "@/components/ui";
import { ArrowRightIcon, PlusIcon, SearchIcon, XIcon } from "@/components/icons";

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

  const rows = list.data?.rows ?? [];

  return (
    <Page>
      <Hero
        kicker="Organisation"
        title="Branches"
        description="Shops in the network."
        actions={
          canCreate ? (
            <button onClick={() => setDialog(true)} className={heroBtnPrimary}>
              <PlusIcon size={15} />
              New branch
              <ArrowRightIcon size={14} className="g-btn-arrow" />
            </button>
          ) : undefined
        }
        stats={[
          { label: "Branches", value: list.isLoading ? "—" : (list.data?.total ?? 0) },
          {
            label: "Active",
            value: list.isLoading ? "—" : rows.filter((r) => r.is_active).length,
          },
        ]}
        note="Per-branch settings overrides live under each branch's Settings action"
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
            unit="branches"
          />
        }
      >
        {list.isLoading ? (
          <TableSkeleton rows={4} cols={4} />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No branches" description="Create the first branch to get started." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Status</th>
                <th className="!text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td className="font-medium text-ink">{b.name}</td>
                  <td className="font-mono text-xs">{b.code}</td>
                  <td>
                    <StatusPill
                      status={b.is_active ? "active" : "inactive"}
                      label={b.is_active ? "Active" : "Inactive"}
                    />
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-3">
                      {canSettings ? (
                        <button
                          onClick={() => setSettingsId(b.id)}
                          className="text-xs font-medium text-ink-3 transition-colors hover:text-ink hover:underline"
                        >
                          Settings
                        </button>
                      ) : null}
                      {canEdit ? (
                        <button
                          onClick={() => toggleActive(b)}
                          className={cn(
                            "text-xs font-medium transition-colors hover:underline",
                            b.is_active ? "text-rose-700" : "text-emerald-700"
                          )}
                        >
                          {b.is_active ? "Deactivate" : "Activate"}
                        </button>
                      ) : null}
                    </div>
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
            className="g-floating w-full max-w-md animate-fade-in space-y-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="g-kicker">Organisation</div>
                <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-ink">
                  New branch
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
              <label className="mb-1.5 block text-xs font-medium text-ink-3">Code</label>
              <input className={controlClass} {...register("code")} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">Address</label>
              <input className={controlClass} {...register("address")} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDialog(false)}
                className="g-btn g-btn-secondary h-10 px-4 text-sm"
              >
                Cancel
              </button>
              <button type="submit" className="g-btn g-btn-primary h-10 px-4 text-sm">
                Save
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {settingsId ? <BranchSettings id={settingsId} onClose={() => setSettingsId(null)} /> : null}
    </Page>
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
            <div className="g-kicker">Branch settings</div>
            <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-ink">
              Overrides
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
        <p className="text-xs text-ink-4">
          Keys are stored as <span className="font-mono">branch.{id.slice(0, 8)}…</span>
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            placeholder="key (e.g. receipt_footer)"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className={cn(controlClass, "flex-1")}
          />
          <input
            placeholder="value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={cn(controlClass, "flex-1")}
          />
          <button onClick={save} className="g-btn g-btn-primary h-10 px-4 text-sm">
            Save
          </button>
        </div>
        {saved.length > 0 ? (
          <ul className="space-y-1 text-sm text-ink-3">
            {saved.map((k) => (
              <li key={k} className="font-mono text-xs">
                {k} ✓
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
