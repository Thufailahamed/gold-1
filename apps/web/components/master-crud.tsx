"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, Modal, controlClass } from "@/components/ui";
import { Card, Empty, FilterPills, GoldHero, HeroBadge, RowsSkeleton, count, heroGold, inputCls, th, thead, tr, type IconCmp } from "./console-kit";
import { AlertCircleIcon, ChevronRightIcon, LayersIcon, PlusIcon, SearchIcon, XIcon } from "./icons";

export type CrudField = {
  name: string;
  label: string;
  type: "text" | "number" | "datetime-local" | "select";
  options?: { value: string; label: string }[];
  required?: boolean;
};

export type CrudColumn = { key: string; label: string };

type Props = {
  title: string;
  subtitle: string;
  endpoint: string;
  columns: CrudColumn[];
  fields: CrudField[];
  deactivateEndpoint?: (id: string) => string;
  deactivateBody?: (reason: string) => Record<string, unknown>;
  defaults?: Record<string, string>;
  emptyHint: string;
  note?: string;
  renderActions?: (row: Row, helpers: { onDeactivate: (id: string) => void }) => ReactNode;
  /** Header glyph; defaults to a stack of layers. */
  icon?: IconCmp;
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
  icon = LayersIcon,
}: Props) {
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<"all" | "active" | "inactive">("all");
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
    mutationFn: ({ id, reason }: { id: string; reason: string }) => {
      if (!deactivateEndpoint) throw new Error("Deactivation not supported");
      return api(deactivateEndpoint(id), { method: "PATCH", body: JSON.stringify(deactivateBody(reason)) });
    },
    onSuccess: () => {
      toast.success("Deactivated");
      qc.invalidateQueries({ queryKey: [endpoint] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Deactivate failed"),
  });

  function onDeactivate(id: string) {
    if (!deactivateEndpoint) return;
    const reason = window.prompt("Reason for deactivation (required):");
    if (!reason) return;
    deactivate.mutate({ id, reason });
  }

  const allRows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const activeN = allRows.filter((r) => r.is_active).length;
  const rows = show === "all" ? allRows : allRows.filter((r) => (show === "active" ? !!r.is_active : !r.is_active));
  const pages = Math.max(1, Math.ceil(total / 20));
  const hasActions = !!(deactivateEndpoint || renderActions);
  // Numbers read right-aligned in mono; codes in mono too.
  const numeric = new Set(columns.filter((c) => allRows.some((r) => typeof r[c.key] === "number")).map((c) => c.key));
  const mono = (k: string) => k === "code" || k.endsWith("_code") || numeric.has(k);
  const singular = title.replace(/ies$/, "y").replace(/s$/, "");

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={icon}
        title={title}
        badge={<HeroBadge tone="muted">Masters</HeroBadge>}
        sub={subtitle}
        back={{ href: "/setup", label: "Setup" }}
        actions={
          <button onClick={() => setDialog(true)} className={heroGold}>
            <PlusIcon size={13} />
            New {singular.toLowerCase()}
          </button>
        }
        stats={[
          { label: "Records", value: list.isLoading ? undefined : total, loading: list.isLoading, accent: true, sub: search ? `matching “${search}”` : "all time" },
          { label: "Active", value: list.isLoading ? undefined : activeN, loading: list.isLoading, tone: "good", sub: "on this page" },
          { label: "Inactive", value: list.isLoading ? undefined : allRows.length - activeN, loading: list.isLoading, tone: allRows.length - activeN ? "warn" : undefined, sub: "on this page" },
          { label: "Page", value: page, text: `${page} / ${pages}`, sub: `${count(allRows.length)} shown` },
        ]}
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-ink/20 px-4 py-2.5">
          <div className="relative w-full max-w-xs">
            <SearchIcon size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-5" />
            <input
              placeholder={`Search ${title.toLowerCase()}…`}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className={cn(inputCls, "w-full pl-8 pr-7")}
            />
            {search ? (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-5 hover:text-ink"
              >
                <XIcon size={12} />
              </button>
            ) : null}
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
          {note ? <span className="ml-auto hidden truncate text-[11px] text-ink-5 lg:block">{note}</span> : null}
        </div>

        {list.isLoading ? (
          <RowsSkeleton rows={6} />
        ) : list.isError ? (
          <Empty icon={AlertCircleIcon} title="Failed to load" desc="Check the API connection and retry." />
        ) : rows.length === 0 ? (
          <Empty
            icon={icon}
            title={allRows.length ? `No ${show} ${title.toLowerCase()} on this page` : `No ${title.toLowerCase()} found`}
            desc={search ? `Nothing matches “${search}”.` : emptyHint}
            action={
              !search && !allRows.length ? (
                <button onClick={() => setDialog(true)} className="g-btn g-btn-primary h-8 px-3 text-[12px]">
                  <PlusIcon size={13} />
                  Add
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-[12.5px]">
              <thead className={thead}>
                <tr>
                  <th className={cn(th, "w-8 pl-4")}>#</th>
                  {columns.map((c) => (
                    <th key={c.key} className={cn(th, numeric.has(c.key) && "text-right")}>
                      {c.label}
                    </th>
                  ))}
                  <th className={th}>Status</th>
                  {hasActions ? <th className={cn(th, "pr-4 text-right")}>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const on = !!r.is_active;
                  return (
                    <tr key={String(r.id)} className={cn(tr, "relative", !on && "opacity-60")}>
                      <td className="g-metric relative py-2 pl-4 pr-2 text-[10.5px] text-ink-5">
                        <span className={cn("absolute inset-y-1.5 left-0 w-[3px] rounded-r-full", on ? "bg-emerald-500" : "bg-ink/20")} aria-hidden />
                        {(page - 1) * 20 + allRows.indexOf(r) + 1 || idx + 1}
                      </td>
                      {columns.map((c, i) => {
                        const v = r[c.key];
                        return (
                          <td
                            key={c.key}
                            className={cn(
                              "px-2 py-2",
                              i === 0 ? "font-semibold text-ink" : "text-ink-3",
                              mono(c.key) && "g-metric",
                              numeric.has(c.key) && "text-right"
                            )}
                          >
                            {v === null || v === undefined || v === "" ? (
                              <span className="text-ink-6">—</span>
                            ) : c.key === "code" ? (
                              <span className="rounded bg-ink/[0.05] px-1.5 py-px text-[11px] font-semibold text-ink-2">{String(v)}</span>
                            ) : typeof v === "number" ? (
                              v.toLocaleString("en-US")
                            ) : (
                              String(v)
                            )}
                          </td>
                        );
                      })}
                      <td className="px-2 py-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset",
                            on ? "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25" : "bg-ink/[0.04] text-ink-5 ring-ink/20"
                          )}
                        >
                          <span className={cn("size-1.5 rounded-full", on ? "bg-emerald-500" : "bg-ink/30")} />
                          {on ? "Active" : "Inactive"}
                        </span>
                      </td>
                      {hasActions ? (
                        <td className="py-2 pl-2 pr-4 text-right">
                          {renderActions ? (
                            renderActions(r, { onDeactivate })
                          ) : deactivateEndpoint && on ? (
                            <button
                              onClick={() => onDeactivate(String(r.id))}
                              className="rounded-md px-2 py-1 text-[11px] font-semibold text-rose-700 transition-colors hover:bg-rose-500/10"
                            >
                              Deactivate
                            </button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-ink/20 bg-bone/40 px-4 py-2 text-[11px] text-ink-4">
          <span>
            {total ? (
              <>
                <span className="g-metric text-ink-2">{count((page - 1) * 20 + 1)}</span>–<span className="g-metric text-ink-2">{count((page - 1) * 20 + allRows.length)}</span> of{" "}
                <span className="g-metric text-ink-2">{count(total)}</span> records
              </>
            ) : (
              "No records"
            )}
          </span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              aria-label="Previous page"
              className="flex size-7 items-center justify-center rounded-md ring-1 ring-inset ring-ink/20 transition-colors hover:bg-paper disabled:opacity-40"
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
              className="flex size-7 items-center justify-center rounded-md ring-1 ring-inset ring-ink/20 transition-colors hover:bg-paper disabled:opacity-40"
            >
              <ChevronRightIcon size={13} />
            </button>
          </span>
        </div>
      </Card>

      {dialog ? (
        <Modal title={`New ${singular.toLowerCase()}`} kicker={title} onClose={() => setDialog(false)} footer={false}>
          <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.name} className={cn(fields.length === 1 || f.type === "select" ? "sm:col-span-2" : undefined)}>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-4">
                    {f.label}
                    {f.required ? <span className="ml-0.5 text-gold-dark">*</span> : null}
                  </label>
                  {f.type === "select" ? (
                    <select className={controlClass} {...register(f.name as keyof FormValues)}>
                      <option value="">Select…</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.type === "datetime-local" ? "datetime-local" : f.type}
                      step={f.type === "number" ? "any" : undefined}
                      className={cn(controlClass, f.type === "number" && "g-metric")}
                      {...register(f.name as keyof FormValues)}
                    />
                  )}
                  {errors[f.name as keyof FormValues] ? <p className="mt-1 text-xs text-rose-700">Invalid value</p> : null}
                </div>
              ))}
            </div>
            {note ? <p className="rounded-lg bg-gold-pale/60 px-3 py-2 text-[11.5px] text-ink-3 ring-1 ring-inset ring-gold/20">{note}</p> : null}
            <div className="flex justify-end gap-2 border-t border-ink/20 pt-3">
              <button type="button" onClick={() => setDialog(false)} className="g-btn g-btn-secondary h-9 px-4 text-sm">
                Cancel
              </button>
              <button type="submit" disabled={create.isPending} className="g-btn g-btn-primary h-9 px-4 text-sm">
                {create.isPending ? "Saving…" : `Save ${singular.toLowerCase()}`}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </Page>
  );
}
