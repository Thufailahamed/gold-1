"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission, PERMISSIONS } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { lkr } from "@/lib/accounts";
import { cn } from "@/lib/cn";
import { Page, Callout, Skeleton, StatusPill } from "@/components/ui";
import { Select } from "@/components/select";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  Building2Icon,
  CheckCircleIcon,
  CheckIcon,
  ClipboardCheckIcon,
  HammerIcon,
  InboxIcon,
  PackageIcon,
  PlusIcon,
  ScaleIcon,
  SearchIcon,
  UsersIcon,
  XIcon,
} from "@/components/icons";
import {
  CustomerName,
  branchDefault,
  errMsg,
  statusLabel,
  useBranches,
  type Customer,
  type RepairStatus,
} from "./shared";

type RepairListRow = {
  id: string;
  number: string;
  customer_id: string;
  branch_id: string;
  item_desc: string;
  repair_type: string;
  estimate_cents: number;
  actual_cents: number | null;
  status: RepairStatus;
  created_at: number;
};

const PAGE_SIZE = 20;

const FILTERS: ReadonlyArray<{ key: "" | RepairStatus; label: string; dot: string }> = [
  { key: "", label: "All", dot: "" },
  { key: "RECEIVED", label: "Received", dot: "bg-sky-500" },
  { key: "IN_PROGRESS", label: "In progress", dot: "bg-violet-500" },
  { key: "QC", label: "Awaiting QC", dot: "bg-amber-500" },
  { key: "READY", label: "Ready to collect", dot: "bg-emerald-500" },
  { key: "COLLECTED", label: "Collected", dot: "bg-ink-5" },
  { key: "CANCELLED", label: "Cancelled", dot: "bg-rose-400" },
];

// Hero counters: one `limit=1` request per status, reading only `total`.
const COUNTED: ReadonlyArray<RepairStatus> = ["RECEIVED", "IN_PROGRESS", "QC", "READY"];

const STAGES: ReadonlyArray<{ key: RepairStatus; label: string; sub: string; icon: ReactNode }> = [
  { key: "RECEIVED", label: "Received", sub: "Awaiting technician", icon: <InboxIcon size={16} /> },
  { key: "IN_PROGRESS", label: "In workshop", sub: "On the bench", icon: <HammerIcon size={16} /> },
  { key: "QC", label: "Quality check", sub: "Awaiting sign-off", icon: <ClipboardCheckIcon size={16} /> },
  { key: "READY", label: "Ready", sub: "To collect & pay", icon: <CheckCircleIcon size={16} /> },
];

const REPAIR_TYPES = ["Resize", "Solder", "Polish", "Stone setting", "Clasp replacement", "Re-plating", "Chain repair"];

const cardShadow =
  "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]";

const inputCls =
  "h-11 w-full rounded-xl bg-paper px-3.5 text-sm text-ink placeholder:text-ink-5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12),0_1px_2px_rgba(16,32,27,0.04)] transition-shadow hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.26)] focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)] aria-[invalid=true]:shadow-[inset_0_0_0_1px_#e11d48,0_0_0_4px_rgba(225,29,72,0.12)]";

const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const time = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const ageDays = (ms: number) => Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));

export default function RepairsPage() {
  const [status, setStatus] = useState<"" | RepairStatus>("");
  const [branchId, setBranchId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCreate = hasPermission(me.data?.permissions ?? [], PERMISSIONS.SALES_CREATE);
  const branches = useBranches();
  const branchRows = branches.data?.rows ?? [];
  const branchName = (id: string) => branchRows.find((b) => b.id === id)?.name ?? "-";

  const qs = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (branchId) p.set("branchId", branchId);
    for (const [k, v] of Object.entries(extra)) if (v !== "") p.set(k, String(v));
    return p.toString();
  };

  const list = useQuery({
    queryKey: ["repairs", "list", { status, branchId, search, page }],
    queryFn: () =>
      api<{ rows: RepairListRow[]; total: number }>(
        `/api/v1/repairs?${qs({ page, limit: PAGE_SIZE, status, search: search.trim() })}`
      ),
  });

  const counts = useQueries({
    queries: COUNTED.map((s) => ({
      queryKey: ["repairs", "count", s, branchId],
      queryFn: () => api<{ rows: RepairListRow[]; total: number }>(`/api/v1/repairs?${qs({ status: s, limit: 1 })}`),
    })),
  });
  const countOf = (s: RepairStatus) => counts[COUNTED.indexOf(s)]?.data?.total;
  const countsReady = counts.every((c) => c.data !== undefined);
  const activeTotal = countsReady ? COUNTED.reduce((n, s) => n + (countOf(s) ?? 0), 0) : null;

  // The list endpoint does not filter on `search` yet, so narrow the loaded page here too.
  const term = search.trim().toLowerCase();
  const pageRows = list.data?.rows ?? [];
  const rows = term
    ? pageRows.filter((r) => [r.number, r.item_desc, r.repair_type].some((v) => v.toLowerCase().includes(term)))
    : pageRows;
  const total = list.data?.total ?? 0;
  const pristine = total === 0 && !status && !branchId;

  const pick = (s: "" | RepairStatus) => {
    setStatus(s);
    setPage(1);
  };

  return (
    <Page className="space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[28px] bg-void text-paper shadow-5 ring-1 ring-gold/10">
        <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div className="home-drift pointer-events-none absolute -right-24 -top-32 size-[22rem] rounded-full bg-gold/20 blur-[120px]" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 -left-24 size-80 rounded-full bg-emerald-400/10 blur-[110px]" aria-hidden />
        <div className="home-noise pointer-events-none absolute inset-0" aria-hidden />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" aria-hidden />

        <div className="relative flex flex-col gap-6 px-5 py-6 sm:px-7 lg:flex-row lg:items-end lg:justify-between lg:px-8 lg:py-7">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
                <span className="size-1.5 animate-pulse-soft rounded-full bg-gold" />
                Sales · Workshop
              </span>
              {activeTotal !== null ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-paper/[0.06] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-paper/70 ring-1 ring-paper/10">
                  <HammerIcon size={11} className="text-gold-light" />
                  {activeTotal} active
                  {branchId ? ` · ${branchName(branchId)}` : ""}
                </span>
              ) : null}
            </div>
            <h1 className="g-display mt-3.5 text-3xl text-paper sm:text-[2.6rem]">
              Repairs, <span className="home-gold-text">bench to collection.</span>
            </h1>
            <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-paper/60">
              Customer pieces in for repair: intake, workshop, quality check and paid collection.
            </p>
          </div>
          {canCreate ? (
            <button type="button" onClick={() => setCreating(true)} className="home-btn-gold h-11 shrink-0 px-5 text-sm">
              <PlusIcon size={15} /> New repair
            </button>
          ) : null}
        </div>

        {/* Pipeline */}
        <div className="relative grid grid-cols-2 gap-px border-t border-paper/[0.08] bg-paper/[0.06] lg:grid-cols-4">
          {STAGES.map((s, i) => {
            const n = countOf(s.key);
            const on = status === s.key;
            const share = activeTotal && n !== undefined ? n / activeTotal : 0;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => pick(on ? "" : s.key)}
                aria-pressed={on}
                className={cn(
                  "group relative flex min-w-0 items-center gap-3.5 px-4 py-4 text-left transition-colors sm:px-6",
                  on ? "bg-[#0d3a2c]" : "bg-void/95 hover:bg-void/80"
                )}
              >
                {on ? <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-gold-dark via-gold to-gold-light" /> : null}
                <span
                  className={cn(
                    "relative flex size-10 shrink-0 items-center justify-center rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 transition-colors",
                    s.key === "READY" && n
                      ? "bg-gradient-to-b from-gold-light to-gold text-void ring-gold/40"
                      : on
                        ? "bg-paper/[0.12] text-gold-light ring-gold/40"
                        : "bg-gradient-to-b from-paper/[0.09] to-paper/[0.03] text-gold-light ring-paper/[0.09] group-hover:text-gold"
                  )}
                >
                  {s.icon}
                  <span className="g-metric absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-void text-[9px] text-paper/60 ring-1 ring-paper/15">
                    {i + 1}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">{s.label}</span>
                  {n === undefined ? (
                    <Skeleton className="mt-1 h-6 w-10 bg-paper/10" />
                  ) : (
                    <span className={cn("g-metric mt-0.5 block text-xl leading-tight", s.key === "READY" && n ? "text-gold-light" : "text-paper")}>
                      {n}
                    </span>
                  )}
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-paper/10">
                    <span
                      className="block h-full rounded-full bg-gradient-to-r from-gold-dark to-gold-light transition-[width] duration-700 ease-brand"
                      style={{ width: `${Math.round(share * 100)}%` }}
                    />
                  </span>
                  <span className="mt-1 block truncate text-[10px] text-paper/35">{s.sub}</span>
                </span>
                {i < STAGES.length - 1 ? (
                  <ArrowRightIcon size={12} className="absolute right-2 top-1/2 hidden -translate-y-1/2 text-paper/20 lg:block" />
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      {/* Jobs */}
      <section className={cn("relative rounded-[22px] bg-paper", cardShadow)}>
        <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
        <div className="space-y-4 border-b border-ink/[0.06] px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)]">
                <HammerIcon size={17} />
              </span>
              <div className="min-w-0">
                <h2 className="truncate font-sans text-[15px] font-semibold tracking-normal text-ink">Repair jobs</h2>
                <p className="truncate text-xs text-ink-4">{status ? `${statusLabel(status)} · newest first` : "Newest first"}</p>
              </div>
            </div>
            <span className="g-metric hidden shrink-0 items-center gap-1.5 rounded-full bg-bone px-3 py-1 text-[11px] text-ink-3 ring-1 ring-ink/[0.06] sm:inline-flex">
              <span className="font-semibold text-ink">{total.toLocaleString("en-US")}</span> on file
              {list.isFetching && !list.isLoading ? (
                <span className="ml-0.5 size-3 animate-spin rounded-full border-2 border-gold/30 border-t-gold" aria-label="Refreshing" />
              ) : null}
            </span>
          </div>

          <div role="tablist" aria-label="Filter by status" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 scrollbar-thin">
            {FILTERS.map((f) => {
              const on = f.key === status;
              const c = f.key && COUNTED.includes(f.key) ? countOf(f.key) : undefined;
              return (
                <button
                  key={f.key || "all"}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => pick(f.key)}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-xs font-medium transition-all duration-200 ease-brand",
                    on
                      ? "bg-void text-paper shadow-[inset_0_0_0_1px_rgba(205,168,83,0.35),0_8px_18px_-10px_rgba(6,42,34,0.8)]"
                      : "bg-paper text-ink-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)] hover:-translate-y-px hover:text-ink hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.24)]"
                  )}
                >
                  {f.dot ? <span className={cn("size-1.5 rounded-full", f.dot)} /> : null}
                  {f.label}
                  {c !== undefined ? (
                    <span className={cn("g-metric rounded-full px-1.5 text-[10px] leading-4", on ? "bg-paper/15 text-paper" : "bg-ink/[0.06] text-ink-4")}>
                      {c}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="group relative block min-w-0 flex-1 sm:max-w-md">
              <span className="sr-only">Search repairs</span>
              <SearchIcon size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-5 transition-colors group-focus-within:text-gold-dark" />
              <input
                id="repair-search"
                type="search"
                autoComplete="off"
                placeholder="Search number, item or repair type…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="h-11 w-full rounded-xl bg-bone/60 pl-10 pr-9 text-sm text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.08)] transition-all duration-200 placeholder:text-ink-5 hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)] focus:bg-paper focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)] [&::-webkit-search-cancel-button]:hidden"
              />
              {search ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-ink-4 hover:bg-ink/5 hover:text-ink"
                >
                  <XIcon size={13} />
                </button>
              ) : null}
            </label>
            <Select
              id="repair-branch-filter"
              ariaLabel="Branch"
              className="w-full sm:w-60"
              value={branchId}
              onChange={(v) => {
                setBranchId(v);
                setPage(1);
              }}
              loading={branches.isLoading}
              icon={<Building2Icon size={13} />}
              options={[{ value: "", label: "All branches" }, ...branchRows.map((b) => ({ value: b.id, label: b.name }))]}
            />
          </div>
        </div>

        {list.isLoading ? (
          <div className="space-y-2.5 p-5 sm:p-6">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[4.5rem] rounded-2xl" />
            ))}
          </div>
        ) : list.isError ? (
          <div className="p-5 sm:p-6">
            <Callout tone="danger" title="Could not load repairs">
              {errMsg(list.error, "Check the API connection and retry.")}
            </Callout>
            <button type="button" onClick={() => void list.refetch()} className="g-btn g-btn-secondary mt-3 h-9 rounded-xl px-3.5 text-xs">
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-5 sm:p-6">
            <div className="relative flex flex-col items-center overflow-hidden rounded-[22px] border border-dashed border-ink/15 bg-gradient-to-b from-bone/70 to-paper px-6 py-14 text-center">
              <div className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-gold/10 blur-[80px]" aria-hidden />
              <span className="relative mb-5 flex size-16 items-center justify-center rounded-2xl bg-void text-gold-light shadow-4">
                <span className="absolute inset-0 animate-pulse-soft rounded-2xl ring-4 ring-gold/20" aria-hidden />
                <HammerIcon size={26} />
              </span>
              <h3 className="relative font-sans text-lg font-semibold tracking-normal text-ink">
                {pristine ? "No repairs yet" : "No repairs match"}
              </h3>
              <p className="relative mt-1.5 max-w-sm text-sm text-ink-4">
                {pristine ? "Take in a customer's piece to open the first repair job." : "Try a different status, branch or search."}
              </p>
              <div className="relative mt-6 flex gap-2">
                {!pristine ? (
                  <button
                    type="button"
                    onClick={() => {
                      pick("");
                      setBranchId("");
                      setSearch("");
                    }}
                    className="g-btn g-btn-secondary h-10 rounded-xl px-4 text-sm"
                  >
                    Clear filters
                  </button>
                ) : null}
                {canCreate && pristine ? (
                  <button type="button" onClick={() => setCreating(true)} className="g-btn g-btn-primary h-10 rounded-xl px-4 text-sm">
                    <PlusIcon size={15} /> New repair
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {rows.map((r, i) => {
              const age = ageDays(r.created_at);
              const live = r.status !== "COLLECTED" && r.status !== "CANCELLED";
              const over = r.actual_cents != null && r.actual_cents > r.estimate_cents;
              return (
                <li key={r.id} className="animate-fade-in" style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                  <Link
                    href={`/repairs/${r.id}`}
                    aria-label={`Open repair ${r.number}`}
                    className="group relative grid items-center gap-x-5 gap-y-3 px-5 py-4 transition-colors hover:bg-gold-pale/30 sm:px-6 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto]"
                  >
                    {r.status === "READY" ? (
                      <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-gradient-to-b from-gold-light to-gold" />
                    ) : null}

                    {/* Job */}
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={cn(
                          "flex size-11 shrink-0 items-center justify-center rounded-xl transition-transform duration-320 group-hover:scale-105",
                          live
                            ? "bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)]"
                            : "bg-bone text-ink-4 ring-1 ring-ink/[0.06]"
                        )}
                      >
                        <HammerIcon size={17} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="g-metric text-sm font-semibold text-ink transition-colors group-hover:text-gold-deep">{r.number}</span>
                          <StatusPill status={r.status} label={statusLabel(r.status)} />
                        </div>
                        <p className="mt-0.5 truncate text-[13px] text-ink-2">{r.item_desc}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-4">
                          <span className="rounded-md bg-gold-pale px-1.5 py-0.5 font-medium text-gold-deep ring-1 ring-gold-dark/15">{r.repair_type}</span>
                          <span className="inline-flex items-center gap-1">
                            <UsersIcon size={11} className="text-ink-5" />
                            <CustomerName id={r.customer_id} />
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Building2Icon size={11} className="text-ink-5" />
                            {branchName(r.branch_id)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Received */}
                    <div className="min-w-0 text-xs text-ink-4">
                      <div className="text-ink-3">
                        {day(r.created_at)} <span className="text-ink-5">· {time(r.created_at)}</span>
                      </div>
                      {live ? (
                        <span
                          className={cn(
                            "mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
                            age >= 14
                              ? "bg-rose-50 text-rose-700 ring-rose-600/15"
                              : age >= 7
                                ? "bg-amber-50 text-amber-700 ring-amber-600/15"
                                : "bg-bone text-ink-4 ring-ink/[0.07]"
                          )}
                        >
                          {age === 0 ? "In today" : `${age} day${age === 1 ? "" : "s"} in shop`}
                        </span>
                      ) : null}
                    </div>

                    {/* Money */}
                    <div className="flex items-center justify-between gap-4 md:justify-end">
                      <div className="text-right">
                        <div className="g-metric text-[15px] text-ink">
                          {r.actual_cents == null ? lkr(r.estimate_cents) : lkr(r.actual_cents)}
                        </div>
                        <div className={cn("mt-0.5 text-[11px]", over ? "font-medium text-amber-700" : "text-ink-4")}>
                          {r.actual_cents == null ? "Estimate" : over ? `Actual · est. ${lkr(r.estimate_cents)}` : "Actual"}
                        </div>
                      </div>
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)] transition-all group-hover:bg-void group-hover:text-gold-light group-hover:shadow-none">
                        <ArrowRightIcon size={13} />
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {pageRows.length > 0 ? (
          <PageNav page={page} onChange={setPage} count={pageRows.length} total={total} />
        ) : null}
      </section>

      {creating ? <NewRepairDialog me={me.data} onClose={() => setCreating(false)} /> : null}
    </Page>
  );
}

function PageNav({ page, onChange, count, total }: { page: number; onChange: (p: number) => void; count: number; total: number }) {
  const from = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = (page - 1) * PAGE_SIZE + count;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const btn =
    "flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-ink transition-all shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12)] hover:-translate-y-px hover:bg-void hover:text-paper hover:shadow-none disabled:pointer-events-none disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-[22px] border-t border-ink/[0.06] bg-bone/40 px-5 py-3 sm:px-6">
      <span className="text-xs text-ink-4">
        Showing <span className="g-metric font-medium text-ink">{from}–{to}</span> of{" "}
        <span className="g-metric font-medium text-ink">{total.toLocaleString("en-US")}</span> jobs
      </span>
      <div className="flex items-center gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className={btn}>
          <ArrowLeftIcon size={12} /> Prev
        </button>
        <span className="g-metric flex h-9 min-w-[4.5rem] items-center justify-center rounded-xl bg-paper px-3 text-xs text-ink-3 ring-1 ring-ink/[0.06]">
          <span className="text-ink">{page}</span>
          <span className="mx-1 text-ink-5">/</span>
          {pages}
        </span>
        <button type="button" disabled={count < PAGE_SIZE} onClick={() => onChange(page + 1)} className={btn}>
          Next <ArrowRightIcon size={12} />
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- New repair */

function Label({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <span className="mb-2 flex items-center justify-between gap-2 text-[12.5px] font-medium text-ink-2">
      {children}
      {extra}
    </span>
  );
}

function NewRepairDialog({ me, onClose }: { me: MeData | undefined; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [customerSearch, setCustomerSearch] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [branchId, setBranchId] = useState(branchDefault);
  const [itemDesc, setItemDesc] = useState("");
  const [weightG, setWeightG] = useState("");
  const [repairType, setRepairType] = useState("");
  const [conditionIn, setConditionIn] = useState("");
  const [estimate, setEstimate] = useState("");

  const branches = useBranches();
  const customers = useQuery({
    queryKey: ["repair-customers", customerSearch],
    queryFn: () =>
      api<{ rows: Customer[]; total: number }>(`/api/v1/customers?search=${encodeURIComponent(customerSearch)}&limit=10`),
    enabled: customerSearch.trim().length > 0 && !customer,
  });

  // Intake happens at a branch the user works at; shop-wide roles may pick any.
  const shopWide = hasPermission(me?.permissions ?? [], PERMISSIONS.BRANCHES_MANAGE);
  const branchRows = (branches.data?.rows ?? []).filter((b) => shopWide || (me?.branchIds ?? []).includes(b.id));
  // The cookie branch may not be one the user belongs to; fall back to the first listed.
  const effectiveBranch = branchRows.some((b) => b.id === branchId) ? branchId : branchRows[0]?.id ?? "";

  const weight = Number(weightG);
  const estimateLkr = Number(estimate.replace(/,/g, ""));
  const weightOk = Number.isFinite(weight) && weight > 0 && weight <= 100000;
  const estimateOk = Number.isFinite(estimateLkr) && estimateLkr > 0;
  const ready =
    !!customer && !!effectiveBranch && !!itemDesc.trim() && !!repairType.trim() && !!conditionIn.trim() && weightOk && estimateOk;

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string; number: string }>("/api/v1/repairs", {
        method: "POST",
        body: JSON.stringify({
          customerId: customer!.id,
          branchId: effectiveBranch,
          itemDesc: itemDesc.trim(),
          weightG: weight,
          conditionIn: conditionIn.trim(),
          repairType: repairType.trim(),
          estimateLkr,
        }),
      }),
    onSuccess: (d) => {
      toast.success(`Repair ${d.number} opened`);
      qc.invalidateQueries({ queryKey: ["repairs"] });
      router.push(`/repairs/${d.id}`);
    },
    onError: (e) => toast.error(errMsg(e, "Could not open the repair")),
  });

  const pending = create.isPending;
  // Escape closes the dialog, unless an open dropdown inside it already handled the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const customerRows = customers.data?.rows ?? [];
  const missing = [
    !customer && "customer",
    !itemDesc.trim() && "item",
    !repairType.trim() && "repair type",
    !weightOk && "weight",
    !estimateOk && "estimate",
    !conditionIn.trim() && "condition",
  ].filter(Boolean) as string[];

  return (
    // The overlay scrolls rather than the dialog body, so dropdowns are never clipped.
    <div
      className="fixed inset-0 z-50 flex animate-fade-in justify-center overflow-y-auto bg-void/60 p-4 backdrop-blur-md"
      onClick={pending ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-repair-title"
        onClick={(e) => e.stopPropagation()}
        className="my-auto flex w-full max-w-2xl animate-pop-in flex-col rounded-[24px] bg-paper shadow-5 ring-1 ring-ink/[0.06]"
      >
        {/* Header */}
        <div className="relative overflow-hidden rounded-t-[24px] bg-void px-6 pb-5 pt-6 text-paper">
          <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-50" aria-hidden />
          <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-gold/20 blur-[80px]" aria-hidden />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
            className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-lg text-paper/50 transition-colors hover:bg-paper/10 hover:text-paper"
          >
            <XIcon size={16} />
          </button>
          <div className="relative flex items-center gap-3.5">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_10px_22px_-10px_rgba(205,168,83,0.7)]">
              <HammerIcon size={20} />
            </span>
            <div className="min-w-0 pr-8">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">Repairs · Intake</div>
              <h2 id="new-repair-title" className="g-display mt-1 text-xl text-paper">
                New repair
              </h2>
            </div>
          </div>
          <p className="relative mt-3 text-xs leading-relaxed text-paper/55">
            Record the piece exactly as it is handed over. Weight and condition are snapshotted on the ticket.
          </p>
        </div>

        <div className="space-y-5 p-6">
          {/* Customer */}
          <div>
            <Label extra={<span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Step 1</span>}>Customer</Label>
            {customer ? (
              <div className="flex items-center gap-3 rounded-2xl bg-gold-pale/60 p-3 ring-1 ring-gold-dark/25">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-void text-[11px] font-bold text-gold-light">
                  {customer.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{customer.name}</span>
                  <span className="block truncate text-xs text-ink-4">
                    <span className="g-metric">{customer.code}</span>
                    {customer.phone ? ` · ${customer.phone}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setCustomer(null)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-ink-3 hover:bg-paper hover:text-ink"
                >
                  Change
                </button>
              </div>
            ) : (
              <div>
                <div className="group relative">
                  <SearchIcon size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-5 group-focus-within:text-gold-dark" />
                  <input
                    id="repair-customer-search"
                    autoFocus
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder="Search by name or phone…"
                    autoComplete="off"
                    className={cn(inputCls, "pl-10")}
                  />
                  {customers.isFetching ? (
                    <span className="absolute right-3.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
                  ) : null}
                </div>
                {customerSearch.trim() ? (
                  <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-2xl bg-bone/50 p-1.5 ring-1 ring-ink/[0.06] scrollbar-thin">
                    {customerRows.length === 0 && !customers.isFetching ? (
                      <li className="px-3 py-4 text-center text-xs text-ink-4">No customers match “{customerSearch.trim()}”</li>
                    ) : null}
                    {customerRows.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setCustomer(c)}
                          className="flex w-full items-center gap-3 rounded-xl bg-paper px-3 py-2 text-left ring-1 ring-ink/[0.06] transition-all hover:-translate-y-px hover:ring-gold-dark/30"
                        >
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold-soft to-gold-pale text-[10px] font-semibold text-gold-deep ring-1 ring-gold-dark/15">
                            {c.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
                            <span className="block truncate text-[11px] text-ink-4">
                              <span className="g-metric">{c.code}</span>
                              {c.phone ? ` · ${c.phone}` : ""}
                            </span>
                          </span>
                          <ArrowRightIcon size={13} className="shrink-0 text-ink-5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-xs text-ink-4">Search by name or phone, then pick the customer.</p>
                )}
              </div>
            )}
          </div>

          {/* Piece */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label extra={<span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Step 2</span>}>Item</Label>
              <div className="relative">
                <PackageIcon size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-5" />
                <input
                  id="repair-item"
                  value={itemDesc}
                  maxLength={500}
                  onChange={(e) => setItemDesc(e.target.value)}
                  placeholder="e.g. 22K ladies ring with red stone"
                  className={cn(inputCls, "pl-10")}
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <Label>Repair type</Label>
              <input
                id="repair-type"
                value={repairType}
                maxLength={100}
                onChange={(e) => setRepairType(e.target.value)}
                placeholder="Pick one below or type your own"
                autoComplete="off"
                className={inputCls}
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {REPAIR_TYPES.map((t) => {
                  const on = repairType.trim().toLowerCase() === t.toLowerCase();
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setRepairType(t)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium ring-1 transition-all duration-200",
                        on
                          ? "bg-gradient-to-b from-gold-light to-gold text-void ring-gold/40 shadow-[0_6px_14px_-8px_rgba(205,168,83,0.8)]"
                          : "bg-paper text-ink-3 ring-ink/10 hover:-translate-y-px hover:bg-gold-pale/50 hover:text-ink"
                      )}
                    >
                      {on ? <CheckIcon size={10} /> : null}
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label>Weight</Label>
              <span className="group relative block">
                <ScaleIcon size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-5" />
                <input
                  id="repair-weight"
                  inputMode="decimal"
                  value={weightG}
                  aria-invalid={weightG && !weightOk ? true : undefined}
                  onChange={(e) => setWeightG(e.target.value)}
                  placeholder="0.000"
                  className={cn(inputCls, "g-metric pl-10 pr-14")}
                />
                <span className="pointer-events-none absolute inset-y-1.5 right-1.5 flex items-center rounded-lg bg-bone px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4 transition-colors group-focus-within:bg-void group-focus-within:text-gold-light">
                  g
                </span>
              </span>
              {weightG && !weightOk ? (
                <span className="mt-1.5 flex items-center gap-1 text-xs font-medium text-rose-700">
                  <AlertCircleIcon size={12} /> Enter a weight above 0 g
                </span>
              ) : null}
            </div>

            <div>
              <Label>Estimate</Label>
              <span className="group relative block">
                <input
                  id="repair-estimate"
                  inputMode="decimal"
                  value={estimate}
                  aria-invalid={estimate && !estimateOk ? true : undefined}
                  onChange={(e) => setEstimate(e.target.value)}
                  placeholder="0.00"
                  className={cn(inputCls, "g-metric pr-16")}
                />
                <span className="pointer-events-none absolute inset-y-1.5 right-1.5 flex items-center rounded-lg bg-bone px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4 transition-colors group-focus-within:bg-void group-focus-within:text-gold-light">
                  LKR
                </span>
              </span>
              {estimate && !estimateOk ? (
                <span className="mt-1.5 flex items-center gap-1 text-xs font-medium text-rose-700">
                  <AlertCircleIcon size={12} /> Enter an estimate above 0
                </span>
              ) : null}
            </div>

            <div className="sm:col-span-2">
              <Label extra={<span className="text-[11px] font-normal text-ink-5">{conditionIn.length}/1000</span>}>Condition at intake</Label>
              <textarea
                id="repair-condition"
                value={conditionIn}
                maxLength={1000}
                rows={3}
                onChange={(e) => setConditionIn(e.target.value)}
                placeholder="Scratches, missing stones, breaks: anything the customer should agree to."
                className={cn(inputCls, "h-auto min-h-[5.5rem] resize-y py-3 leading-relaxed")}
              />
            </div>

            <div className="sm:col-span-2">
              <Label>Branch</Label>
              <Select
                id="repair-branch"
                ariaLabel="Branch"
                value={effectiveBranch}
                onChange={setBranchId}
                disabled={branches.isLoading || branchRows.length === 0}
                loading={branches.isLoading}
                placeholder={!branches.isLoading && branchRows.length === 0 ? "No branches available" : "Choose branch"}
                icon={<Building2Icon size={13} />}
                options={branchRows.map((b) => ({ value: b.id, label: b.name }))}
              />
            </div>
          </div>

          {customers.isError ? (
            <Callout tone="danger" title="Could not search customers">
              {errMsg(customers.error, "Please try again.")}
            </Callout>
          ) : null}
          {branches.isError ? (
            <Callout tone="danger" title="Could not load branches">
              {errMsg(branches.error, "Please try again.")}
            </Callout>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-3 rounded-b-[24px] border-t border-ink/[0.06] bg-bone/50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-4">
            {ready ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                <CheckCircleIcon size={13} /> Ready to open the ticket
              </span>
            ) : (
              <>Still needed: {missing.join(", ")}</>
            )}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="g-btn h-11 rounded-xl px-4 text-sm text-ink-3 hover:bg-paper hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => create.mutate()}
              disabled={pending || !ready}
              className="g-btn g-btn-primary h-11 rounded-xl px-5 text-sm"
            >
              {pending ? (
                <>
                  <span className="size-3.5 animate-spin rounded-full border-2 border-gold-light/30 border-t-gold-light" />
                  Opening…
                </>
              ) : (
                <>
                  Open repair
                  <ArrowRightIcon size={14} className="g-btn-arrow text-gold-light" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
