"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
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
  Modal,
  controlClass,
} from "@/components/ui";
import { ArrowRightIcon, PlusIcon, SearchIcon } from "./icons";

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
  note?: string;
  renderActions?: (row: Row, helpers: { onDeactivate: (id: string) => void }) => ReactNode;
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
  note,
  renderActions,
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
    <Page>
      <Hero
        kicker="Masters"
        title={title}
        description={subtitle}
        actions={
          <button onClick={() => setDialog(true)} className={heroBtnPrimary}>
            <PlusIcon size={15} />
            New
            <ArrowRightIcon size={14} className="g-btn-arrow" />
          </button>
        }
        stats={[
          { label: "Records", value: list.isLoading ? "—" : total.toLocaleString("en-US") },
          {
            label: "Active",
            value: list.isLoading ? "—" : rows.filter((r) => r.is_active).length,
          },
        ]}
        note={note}
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
            total={total}
            unit="records"
          />
        }
      >
        {list.isLoading ? (
          <TableSkeleton rows={5} cols={columns.length + 2} />
        ) : list.isError ? (
          <EmptyBlock
            title="Failed to load"
            description="Check the API connection and retry."
          />
        ) : rows.length === 0 ? (
          <EmptyBlock title={`No ${title.toLowerCase()} found`} description={emptyHint} />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                <th>Status</th>
                <th className="!text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.id)}>
                  {columns.map((c, i) => (
                    <td
                      key={c.key}
                      className={i === 0 ? "font-medium text-ink" : "text-ink-3"}
                    >
                      {r[c.key] === null || r[c.key] === undefined ? (
                        <span className="text-ink-5">—</span>
                      ) : (
                        String(r[c.key])
                      )}
                    </td>
                  ))}
                  <td>
                    <StatusPill status={r.is_active ? "active" : "inactive"} label={r.is_active ? "Active" : "Inactive"} />
                  </td>
                  <td className="text-right">
                    {renderActions ? (
                      renderActions(r, { onDeactivate })
                    ) : r.is_active ? (
                      <button
                        onClick={() => onDeactivate(String(r.id))}
                        className="text-xs font-medium text-rose-700 transition-colors hover:text-rose-800 hover:underline"
                      >
                        Deactivate
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {dialog ? (
        <Modal title={`New ${title}`} kicker="Create" onClose={() => setDialog(false)} footer={false}>
          <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-4">
            {fields.map((f) => (
              <div key={f.name}>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">
                  {f.label}
                  {f.required ? <span className="ml-0.5 text-gold-dark">*</span> : null}
                </label>
                <input
                  type={f.type === "datetime-local" ? "datetime-local" : f.type}
                  step={f.type === "number" ? "any" : undefined}
                  className={controlClass}
                  {...register(f.name as keyof FormValues)}
                />
                {errors[f.name as keyof FormValues] ? (
                  <p className="mt-1 text-xs text-rose-700">Invalid value</p>
                ) : null}
              </div>
            ))}
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
                {create.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </Page>
  );
}
