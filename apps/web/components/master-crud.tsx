"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";

export type CrudField = {
  name: string;
  label: string;
  type: "text" | "number" | "datetime-local";
  required?: boolean;
};

export type CrudColumn = { key: string; label: string };

type Props = {
  title: string;
  subtitle: string;
  endpoint: string;
  columns: CrudColumn[];
  fields: CrudField[];
  deactivateEndpoint: (id: string) => string;
  deactivateBody?: (reason: string) => Record<string, unknown>;
  defaults?: Record<string, string>;
  emptyHint: string;
};

type Row = Record<string, string | number | null>;

function schemaFor(fields: CrudField[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    if (f.type === "number") {
      shape[f.name] = f.required ? z.coerce.number() : z.coerce.number().optional();
    } else if (f.type === "datetime-local") {
      shape[f.name] = f.required ? z.string().min(1) : z.string().optional();
    } else {
      shape[f.name] = f.required ? z.string().min(1).max(500) : z.string().max(500).optional();
    }
  }
  return z.object(shape);
}

export function MasterCrud({
  title,
  subtitle,
  endpoint,
  columns,
  fields,
  deactivateEndpoint,
  deactivateBody = (reason) => ({ reason }),
  defaults,
  emptyHint,
}: Props) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(false);
  const qc = useQueryClient();
  const schema = schemaFor(fields);
  type FormValues = z.infer<typeof schema>;
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults as FormValues | undefined,
  });

  const list = useQuery({
    queryKey: [endpoint, search, page],
    queryFn: () =>
      api<{ rows: Row[]; total: number }>(
        `${endpoint}?search=${encodeURIComponent(search)}&page=${page}&limit=20`
      ),
  });

  const create = useMutation({
    mutationFn: (values: FormValues) => {
      const body: Record<string, string | number> = { ...(values as Record<string, string | number>) };
      for (const f of fields) {
        if (f.type === "datetime-local" && typeof body[f.name] === "string") {
          body[f.name] = new Date(body[f.name] as string).getTime();
        }
      }
      return api(endpoint, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      toast.success(`${title} created`);
      setDialog(false);
      reset();
      qc.invalidateQueries({ queryKey: [endpoint] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  const deactivate = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(deactivateEndpoint(id), { method: "PATCH", body: JSON.stringify(deactivateBody(reason)) }),
    onSuccess: () => {
      toast.success("Deactivated");
      qc.invalidateQueries({ queryKey: [endpoint] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Deactivate failed"),
  });

  function onDeactivate(id: string) {
    const reason = window.prompt("Reason for deactivation (required):");
    if (!reason) return;
    deactivate.mutate({ id, reason });
  }

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-stone-500">{subtitle}</p>
        </div>
        <button
          onClick={() => setDialog(true)}
          className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
        >
          New
        </button>
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
      ) : list.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load. Check the API connection and retry.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
          {emptyHint}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
                {columns.map((c) => (
                  <th key={c.key} className="px-4 py-2">
                    {c.label}
                  </th>
                ))}
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.id)} className="border-b border-stone-100 last:border-0">
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-2">
                      {r[c.key] === null || r[c.key] === undefined ? "—" : String(r[c.key])}
                    </td>
                  ))}
                  <td className="px-4 py-2">{r.is_active ? "Active" : "Inactive"}</td>
                  <td className="px-4 py-2 text-right">
                    {r.is_active ? (
                      <button
                        onClick={() => onDeactivate(String(r.id))}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Deactivate
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center gap-2 text-sm text-stone-500">
        <span>{total} total</span>
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
          className="rounded border px-2 py-1 disabled:opacity-40"
        >
          Prev
        </button>
        <span>Page {page}</span>
        <button
          disabled={rows.length < 20}
          onClick={() => setPage((p) => p + 1)}
          className="rounded border px-2 py-1 disabled:opacity-40"
        >
          Next
        </button>
      </div>
      {dialog ? (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
          <form
            onSubmit={handleSubmit((v) => create.mutate(v))}
            className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-lg"
          >
            <h2 className="font-semibold">New {title}</h2>
            {fields.map((f) => (
              <div key={f.name}>
                <label className="mb-1 block text-sm font-medium">{f.label}</label>
                <input
                  type={f.type === "datetime-local" ? "datetime-local" : f.type}
                  step={f.type === "number" ? "any" : undefined}
                  className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                  {...register(f.name as keyof FormValues)}
                />
                {errors[f.name as keyof FormValues] ? (
                  <p className="mt-1 text-xs text-red-600">Invalid value</p>
                ) : null}
              </div>
            ))}
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
                {create.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
