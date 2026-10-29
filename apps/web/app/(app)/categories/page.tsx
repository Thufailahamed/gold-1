"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { MasterCrud } from "@/components/master-crud";
import { TagsIcon } from "@/components/icons";

const ENDPOINT = "/api/v1/masters/categories";

type Editing = { id: string; name: string; code: string; description: string | null };

export default function CategoriesPage() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: [ENDPOINT] });
  // The category being renamed. Edited in this page's own dialog, not a browser prompt.
  const [editing, setEditing] = useState<Editing | null>(null);

  // Permanent removal. The server refuses a category that products or other
  // records use; those are deactivated instead.
  const remove = useMutation({
    mutationFn: (id: string) => api(`${ENDPOINT}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Category deleted");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  // Renames a category and changes its code; the record and what points at it stay.
  const edit = useMutation({
    mutationFn: (v: Editing) =>
      api(`${ENDPOINT}/${v.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: v.name, code: v.code, description: v.description ?? undefined }),
      }),
    onSuccess: () => {
      toast.success("Category updated");
      setEditing(null);
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const reactivate = useMutation({
    mutationFn: (id: string) => api(`${ENDPOINT}/${id}/reactivate`, { method: "PATCH" }),
    onSuccess: () => {
      toast.success("Category reactivated");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not reactivate"),
  });

  const list = (
    <MasterCrud
      icon={TagsIcon}
      title="Categories"
      subtitle="Product categories for the catalog"
      endpoint={ENDPOINT}
      columns={[
        { key: "name", label: "Name" },
        { key: "code", label: "Code" },
        { key: "description", label: "Description" },
      ]}
      fields={[
        { name: "name", label: "Name", type: "text", required: true },
        { name: "code", label: "Code", type: "text", required: true },
        { name: "description", label: "Description", type: "text" },
      ]}
      deactivateEndpoint={(id) => `${ENDPOINT}/${id}/deactivate`}
      renderActions={(row, { onDeactivate }) => (
        <span className="inline-flex items-center gap-1">
          <button
            onClick={() =>
              setEditing({
                id: String(row.id),
                name: String(row.name ?? ""),
                code: String(row.code ?? ""),
                description: row.description ? String(row.description) : null,
              })
            }
            className="rounded-md px-2 py-1 text-[11px] font-semibold text-gold-deep transition-colors hover:bg-gold-pale/60"
          >
            Edit
          </button>
          {row.is_active ? (
            <button
              onClick={() => onDeactivate(String(row.id))}
              className="rounded-md px-2 py-1 text-[11px] font-semibold text-amber-700 transition-colors hover:bg-amber-500/10"
            >
              Deactivate
            </button>
          ) : (
            <button
              onClick={() => reactivate.mutate(String(row.id))}
              disabled={reactivate.isPending}
              className="rounded-md px-2 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/10 disabled:opacity-50"
            >
              Activate
            </button>
          )}
          <button
            onClick={() => {
              if (window.confirm(`Delete "${String(row.name)}"? This cannot be undone.`)) remove.mutate(String(row.id));
            }}
            disabled={remove.isPending}
            className="rounded-md px-2 py-1 text-[11px] font-semibold text-rose-700 transition-colors hover:bg-rose-500/10 disabled:opacity-50"
          >
            Delete
          </button>
        </span>
      )}
      emptyHint="No categories yet. Create the first one."
      note="Categories group pieces for reporting, filters and pricing"
    />
  );

  return (
    <>
      {list}
      {editing ? (
        <EditDialog
          value={editing}
          pending={edit.isPending}
          onClose={() => setEditing(null)}
          onSave={(v) => {
            if (!v.name.trim() || !v.code.trim()) return toast.error("Name and code are needed");
            edit.mutate({ ...v, name: v.name.trim(), code: v.code.trim() });
          }}
        />
      ) : null}
    </>
  );
}

/** Renames a category and changes its code. Products under it keep their history. */
function EditDialog({
  value,
  pending,
  onClose,
  onSave,
}: {
  value: Editing;
  pending: boolean;
  onClose: () => void;
  onSave: (v: Editing) => void;
}) {
  const [draft, setDraft] = useState(value);
  const field =
    "mt-1.5 h-10 w-full rounded-xl bg-paper px-3 text-sm text-ink ring-1 ring-ink/20 focus:outline-none focus:ring-gold-dark/50";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true" aria-label="Edit category">
      <div className="w-full max-w-md rounded-2xl bg-paper p-5 shadow-4 ring-1 ring-ink/20">
        <p className="text-sm font-semibold text-ink">Edit category</p>
        <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-dark">
          Name
          <input className={field} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="mt-3 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-dark">
          Code
          <input className={field} value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="g-btn g-btn-secondary h-9 rounded-xl px-3 text-xs">
            Cancel
          </button>
          <button onClick={() => onSave(draft)} disabled={pending} className="g-btn g-btn-primary h-9 rounded-xl px-4 text-xs">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
