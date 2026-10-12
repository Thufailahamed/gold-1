"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, StatusPill, Callout, Skeleton } from "@/components/ui";
import { Select } from "@/components/select";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  Building2Icon,
  CheckCircleIcon,
  ClipboardCheckIcon,
  HistoryIcon,
  LayersIcon,
  PlusIcon,
  ScanBarcodeIcon,
  StoreIcon,
  TagsIcon,
  XIcon,
} from "@/components/icons";

type CountScope = "FULL" | "CATEGORY" | "BRANCH" | "LOCATION";
type CountStatus = "OPEN" | "COMPLETE" | "CANCELLED";

type CountListRow = {
  id: string;
  branch_id: string;
  branch_name: string | null;
  scope: CountScope;
  scope_ref: string | null;
  scope_label: string | null;
  status: CountStatus;
  opened_by: string | null;
  opened_by_name: string | null;
  created_at: number;
  expected: number;
  scanned: number;
};

const SCOPE_LABEL: Record<CountScope, string> = {
  FULL: "Whole branch",
  BRANCH: "Whole branch",
  CATEGORY: "Category",
  LOCATION: "Location",
};

const FILTERS = [
  { key: "", label: "All", dot: "" },
  { key: "OPEN", label: "Open", dot: "bg-amber-500" },
  { key: "COMPLETE", label: "Complete", dot: "bg-emerald-500" },
  { key: "CANCELLED", label: "Cancelled", dot: "bg-ink-5" },
] as const;

const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { dateStyle: "medium" });
const time = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { timeStyle: "short" });

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? "";
}

const cardShadow =
  "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]";

/* ------------------------------------------------------------------ page */

export default function StockCountsPage() {
  const [status, setStatus] = useState("");
  const [starting, setStarting] = useState(false);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canEdit = hasPermission(me.data?.permissions ?? [], "products:edit");

  const counts = useQuery({
    queryKey: ["counts", status],
    queryFn: () =>
      api<CountListRow[]>(`/api/v1/counts${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  });

  const rows = counts.data ?? [];
  const openCount = status === "" ? rows.filter((r) => r.status === "OPEN").length : null;
  const completeCount = rows.filter((r) => r.status === "COMPLETE").length;
  const scannedSum = rows.reduce((s, r) => s + r.scanned, 0);
  const expectedSum = rows.reduce((s, r) => s + r.expected, 0);
  const coverage = expectedSum > 0 ? Math.min(scannedSum / expectedSum, 1) : null;

  const stats: { label: string; value: string; sub: string; icon: ReactNode; bar?: number | null; gold?: boolean }[] = [
    {
      label: "Counts shown",
      value: counts.data ? rows.length.toLocaleString("en-US") : "—",
      sub: status ? `${FILTERS.find((f) => f.key === status)?.label} only` : "Latest 100",
      icon: <ClipboardCheckIcon size={16} />,
    },
    {
      label: "Open now",
      value: counts.data && openCount !== null ? openCount.toLocaleString("en-US") : "—",
      sub: openCount ? "Pieces locked from sale" : "Nothing locked",
      icon: <HistoryIcon size={16} />,
    },
    {
      label: "Completed",
      value: counts.data ? completeCount.toLocaleString("en-US") : "—",
      sub: "Approved and closed",
      icon: <CheckCircleIcon size={16} />,
    },
    {
      label: "Pieces scanned",
      value: counts.data ? `${scannedSum.toLocaleString("en-US")} / ${expectedSum.toLocaleString("en-US")}` : "—",
      sub: coverage !== null ? `${Math.round(coverage * 100)}% of expected` : "No pieces expected yet",
      icon: <ScanBarcodeIcon size={16} />,
      bar: coverage,
      gold: true,
    },
  ];

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
            <Link
              href="/inventory"
              className="group inline-flex items-center gap-1.5 text-xs font-medium text-paper/55 transition-colors hover:text-gold-light"
            >
              <ArrowLeftIcon size={13} className="transition-transform group-hover:-translate-x-0.5" />
              Inventory
            </Link>
            <div className="mt-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
                <span className="size-1.5 animate-pulse-soft rounded-full bg-gold" />
                Inventory
              </span>
            </div>
            <h1 className="g-display mt-3.5 text-3xl text-paper sm:text-[2.6rem]">
              Stock counts, <span className="home-gold-text">shelf vs book.</span>
            </h1>
            <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-paper/60">
              Scan every piece on the shelf and compare it with the book. While a count is open, the pieces it
              covers are locked from sale and transfer.
            </p>
          </div>
          {canEdit ? (
            <button type="button" onClick={() => setStarting(true)} className="home-btn-gold h-11 shrink-0 px-5 text-sm">
              <PlusIcon size={15} />
              Start count
            </button>
          ) : null}
        </div>

        <div className="relative grid grid-cols-2 gap-px border-t border-paper/[0.08] bg-paper/[0.06] lg:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.label}
              className={cn(
                "group flex min-w-0 items-center gap-3.5 bg-void/95 px-4 py-4 transition-colors hover:bg-void/80 sm:px-6",
                s.gold && "bg-gradient-to-br from-void/95 to-[#0d3a2c]/95"
              )}
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 transition-colors",
                  s.gold
                    ? "bg-gradient-to-b from-gold-light to-gold text-void ring-gold/40"
                    : "bg-gradient-to-b from-paper/[0.09] to-paper/[0.03] text-gold-light ring-paper/[0.09] group-hover:text-gold"
                )}
              >
                {s.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">{s.label}</span>
                {counts.isLoading ? (
                  <Skeleton className="mt-1 h-6 w-16 bg-paper/10" />
                ) : (
                  <span className={cn("g-metric mt-0.5 block truncate text-xl leading-tight", s.gold ? "text-gold-light" : "text-paper")}>
                    {s.value}
                  </span>
                )}
                {s.bar !== undefined && s.bar !== null ? (
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-paper/10">
                    <span
                      className="block h-full rounded-full bg-gradient-to-r from-gold-dark to-gold-light transition-[width] duration-700 ease-brand"
                      style={{ width: `${Math.round(s.bar * 100)}%` }}
                    />
                  </span>
                ) : null}
                <span className="mt-1 block truncate text-[10px] text-paper/35">{s.sub}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <ol className="grid gap-4 sm:grid-cols-3">
        {[
          { n: "1", t: "Snapshot", d: "Every in-stock piece in scope becomes the expected list and is locked.", icon: <LayersIcon size={17} /> },
          { n: "2", t: "Scan the shelf", d: "Scan each piece; missing and unexpected ones surface as you go.", icon: <ScanBarcodeIcon size={17} /> },
          { n: "3", t: "Approve", d: "A second person signs off write-offs before the count closes.", icon: <CheckCircleIcon size={17} /> },
        ].map((s, i) => (
          <li
            key={s.n}
            className={cn("relative flex animate-fade-in items-start gap-3.5 overflow-hidden rounded-[22px] bg-paper p-5", cardShadow)}
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <span className="g-display pointer-events-none absolute -bottom-4 right-3 select-none text-[5rem] leading-none text-gold/[0.09]" aria-hidden>
              {s.n}
            </span>
            <span className="relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_10px_20px_-12px_rgba(6,42,34,0.8)]">
              {s.icon}
            </span>
            <span className="relative min-w-0">
              <span className="block text-[15px] font-semibold text-ink">{s.t}</span>
              <span className="mt-1 block text-xs leading-relaxed text-ink-4">{s.d}</span>
            </span>
          </li>
        ))}
      </ol>

      {/* Counts */}
      <section className={cn("relative overflow-hidden rounded-[22px] bg-paper", cardShadow)}>
        <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
        <div className="flex flex-col gap-4 border-b border-ink/[0.06] px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)]">
              <ClipboardCheckIcon size={17} />
            </span>
            <div className="min-w-0">
              <h2 className="font-sans tracking-normal truncate text-[15px] font-semibold text-ink">Counts</h2>
              <p className="truncate text-xs text-ink-4">The latest 100 counts across your branches</p>
            </div>
          </div>
          <StatusSwitch value={status} onChange={setStatus} />
        </div>

        {counts.isLoading ? (
          <div className="space-y-2.5 p-5 sm:p-6">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[4.5rem] rounded-2xl" />
            ))}
          </div>
        ) : counts.isError ? (
          <div className="p-5 sm:p-6">
            <Callout tone="danger" title="Could not load counts">
              {counts.error instanceof Error ? counts.error.message : "Please try again."}
            </Callout>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-5 sm:p-6">
            <div className="relative flex flex-col items-center overflow-hidden rounded-[22px] border border-dashed border-ink/15 bg-gradient-to-b from-bone/70 to-paper px-6 py-14 text-center">
              <div className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-gold/10 blur-[80px]" aria-hidden />
              <span className="relative mb-5 flex size-16 items-center justify-center rounded-2xl bg-void text-gold-light shadow-4">
                <span className="absolute inset-0 animate-pulse-soft rounded-2xl ring-4 ring-gold/20" aria-hidden />
                <ClipboardCheckIcon size={26} />
              </span>
              <h3 className="g-display relative text-2xl text-ink">
                {status ? "No counts with this status" : "No stock counts yet"}
              </h3>
              <p className="relative mt-2 max-w-sm text-sm text-ink-4">
                Start a count to scan a branch, a category or a single location and find missing pieces.
              </p>
              <div className="relative mt-6 flex gap-2">
                {status ? (
                  <button type="button" onClick={() => setStatus("")} className="g-btn g-btn-secondary h-10 rounded-xl px-4 text-sm">
                    Show all counts
                  </button>
                ) : null}
                {canEdit ? (
                  <button type="button" onClick={() => setStarting(true)} className="g-btn g-btn-primary h-10 rounded-xl px-4 text-sm">
                    <PlusIcon size={14} /> Start count
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {rows.map((r, i) => (
              <CountRow key={r.id} r={r} index={i} />
            ))}
          </ul>
        )}
      </section>

      {starting ? <StartCountDialog onClose={() => setStarting(false)} /> : null}
    </Page>
  );
}

/* ------------------------------------------------------------------ parts */

function StatusSwitch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const idx = Math.max(
    0,
    FILTERS.findIndex((f) => f.key === value)
  );
  return (
    <div className="-mx-1 overflow-x-auto px-1 scrollbar-thin">
      <div
        role="tablist"
        aria-label="Filter by status"
        className="relative grid min-w-max grid-cols-4 rounded-xl bg-bone p-1 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07)]"
      >
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/4)] rounded-lg bg-void shadow-[inset_0_0_0_1px_rgba(205,168,83,0.3),0_8px_18px_-10px_rgba(6,42,34,0.8)] transition-transform duration-320 ease-brand"
          style={{ transform: `translateX(${idx * 100}%)` }}
        />
        {FILTERS.map((f) => {
          const active = f.key === value;
          return (
            <button
              key={f.key || "all"}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(f.key)}
              className={cn(
                "relative inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-4 text-[13px] font-medium transition-colors duration-200",
                active ? "text-paper" : "text-ink-4 hover:text-ink"
              )}
            >
              {f.dot ? <span className={cn("size-1.5 rounded-full", f.dot)} /> : null}
              {f.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CountRow({ r, index }: { r: CountListRow; index: number }) {
  const share = r.expected > 0 ? Math.min(r.scanned / r.expected, 1) : 0;
  const allFound = r.status === "OPEN" && r.expected > 0 && r.scanned >= r.expected;
  const open = r.status === "OPEN";
  const scopeDetail = r.scope === "CATEGORY" || r.scope === "LOCATION" ? r.scope_label ?? r.scope_ref : null;
  return (
    <li className="animate-fade-in" style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}>
      <Link
        href={`/inventory/counts/${r.id}`}
        className="group relative grid items-center gap-x-5 gap-y-3 px-5 py-4 transition-colors hover:bg-gold-pale/40 sm:px-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]"
      >
        {open ? <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-gradient-to-b from-gold-light to-gold" /> : null}

        {/* Branch + when */}
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors",
              open
                ? "bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)]"
                : "bg-bone text-ink-4 ring-1 ring-ink/[0.06] group-hover:bg-paper"
            )}
          >
            <Building2Icon size={17} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-ink transition-colors group-hover:text-gold-deep">
                {r.branch_name ?? "—"}
              </span>
              <StatusPill status={r.status} />
            </div>
            <div className="mt-0.5 truncate text-xs text-ink-4">
              {day(r.created_at)} · {time(r.created_at)}
              <span className="text-ink-5"> · {ago(r.created_at)}</span>
            </div>
          </div>
        </div>

        {/* Scope */}
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-bone px-2 py-1 text-[11px] font-medium text-ink-3 ring-1 ring-ink/[0.06]">
            {r.scope === "CATEGORY" ? <TagsIcon size={11} /> : r.scope === "LOCATION" ? <StoreIcon size={11} /> : <LayersIcon size={11} />}
            {SCOPE_LABEL[r.scope] ?? r.scope}
          </span>
          {scopeDetail ? <span className="truncate text-xs text-ink-3">{scopeDetail}</span> : null}
        </div>

        {/* Progress */}
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="g-metric text-ink">
              <span className="text-sm">{r.scanned.toLocaleString("en-US")}</span>
              <span className="text-ink-5"> / {r.expected.toLocaleString("en-US")}</span>
            </span>
            {allFound ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-600/15">
                <CheckCircleIcon size={10} /> All found
              </span>
            ) : (
              <span className="g-metric text-[11px] text-ink-4">{Math.round(share * 100)}%</span>
            )}
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-700 ease-brand",
                allFound || r.status === "COMPLETE"
                  ? "bg-gradient-to-r from-emerald-600 to-emerald-400"
                  : r.status === "CANCELLED"
                    ? "bg-ink-5"
                    : "bg-gradient-to-r from-gold-dark to-gold-light"
              )}
              style={{ width: `${Math.max(share * 100, r.scanned > 0 ? 3 : 0)}%` }}
            />
          </div>
        </div>

        {/* Who + action */}
        <div className="flex items-center justify-between gap-3 md:justify-end">
          {r.opened_by_name ? (
            <span className="flex min-w-0 items-center gap-2" title={`Opened by ${r.opened_by_name}`}>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold-soft to-gold-pale text-[10px] font-semibold text-gold-deep ring-1 ring-gold-dark/15">
                {initials(r.opened_by_name)}
              </span>
              <span className="max-w-[8rem] truncate text-xs text-ink-3 xl:inline md:hidden">{r.opened_by_name}</span>
            </span>
          ) : null}
          <span
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold transition-all duration-200",
              open
                ? "bg-void text-paper shadow-[inset_0_0_0_1px_rgba(205,168,83,0.3)] group-hover:-translate-y-px"
                : "text-ink-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12)] group-hover:bg-void group-hover:text-paper group-hover:shadow-none"
            )}
          >
            {open ? "Continue" : "View"}
            <ArrowRightIcon size={12} className={cn("transition-transform group-hover:translate-x-0.5", open && "text-gold-light")} />
          </span>
        </div>
      </Link>
    </li>
  );
}

const SCOPES: { key: "FULL" | "CATEGORY" | "LOCATION"; title: string; body: string; icon: ReactNode }[] = [
  { key: "FULL", title: "Whole branch", body: "Every in-stock piece", icon: <LayersIcon size={16} /> },
  { key: "CATEGORY", title: "Category", body: "One category only", icon: <TagsIcon size={16} /> },
  { key: "LOCATION", title: "Location", body: "A tray or showcase", icon: <StoreIcon size={16} /> },
];

function StartCountDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState(branchDefault);
  const [scope, setScope] = useState<"FULL" | "CATEGORY" | "LOCATION">("FULL");
  const [categoryId, setCategoryId] = useState("");
  const [location, setLocation] = useState("");
  const [pending, setPending] = useState(false);

  const branches = useQuery({
    queryKey: ["branches-options"],
    queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/branches?limit=100"),
  });
  const categories = useQuery({
    queryKey: ["categories-options"],
    queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/masters/categories?limit=100"),
    enabled: scope === "CATEGORY",
  });

  const branchRows = branches.data?.rows ?? [];
  // The cookie branch may not be one the user belongs to; fall back to the first listed.
  const effectiveBranch = branchRows.some((b) => b.id === branchId) ? branchId : branchRows[0]?.id ?? "";

  const scopeRef = scope === "CATEGORY" ? categoryId : scope === "LOCATION" ? location.trim() : "";
  const ready = Boolean(effectiveBranch) && (scope === "FULL" || scopeRef.length > 0);

  // Escape closes the dialog, unless an open dropdown inside it already handled the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  async function start() {
    if (!ready) return;
    setPending(true);
    try {
      const res = await api<{ id: string; expectedCount: number }>("/api/v1/counts", {
        method: "POST",
        body: JSON.stringify({
          branchId: effectiveBranch,
          scope,
          ...(scope === "FULL" ? {} : { scopeRef }),
        }),
      });
      toast.success(`Count started: ${res.expectedCount} piece${res.expectedCount === 1 ? "" : "s"} expected`);
      qc.invalidateQueries({ queryKey: ["counts"] });
      router.push(`/inventory/counts/${res.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the count");
      setPending(false);
    }
  }

  const branchName = branchRows.find((b) => b.id === effectiveBranch)?.name;

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-void/60 p-4 backdrop-blur-md sm:items-center"
      onClick={pending ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-count-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg animate-pop-in rounded-[24px] bg-paper shadow-5 ring-1 ring-ink/[0.06]"
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
              <ClipboardCheckIcon size={20} />
            </span>
            <div className="min-w-0 pr-8">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">Inventory</div>
              <h2 id="start-count-title" className="g-display mt-1 text-xl text-paper">
                Start stock count
              </h2>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-6">
          <div className="flex items-start gap-2.5 rounded-2xl bg-gold-pale/70 p-3.5 text-xs leading-relaxed text-ink-3 ring-1 ring-gold-dark/15">
            <AlertCircleIcon size={14} className="mt-0.5 shrink-0 text-gold-deep" />
            Every in-stock piece in the chosen scope is snapshotted as the expected list and locked from sale and
            transfer until the count is approved or cancelled.
          </div>

          <div>
            <span className="mb-2 block text-[12.5px] font-medium text-ink-2">Branch</span>
            <Select
              id="count-branch"
              ariaLabel="Branch"
              value={effectiveBranch}
              onChange={setBranchId}
              disabled={branches.isLoading || branchRows.length === 0}
              loading={branches.isLoading}
              placeholder={branchRows.length === 0 && !branches.isLoading ? "No branches available" : "Choose branch"}
              icon={<Building2Icon size={13} />}
              options={branchRows.map((b) => ({ value: b.id, label: b.name }))}
            />
          </div>

          <div>
            <span className="mb-2 block text-[12.5px] font-medium text-ink-2">Scope</span>
            <div role="radiogroup" aria-label="Scope" className="grid gap-2 sm:grid-cols-3">
              {SCOPES.map((s) => {
                const on = s.key === scope;
                return (
                  <button
                    key={s.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setScope(s.key)}
                    className={cn(
                      "relative flex flex-col items-start gap-2 rounded-2xl p-3.5 text-left ring-1 transition-all duration-200 ease-brand",
                      on
                        ? "bg-void text-paper shadow-[0_14px_28px_-16px_rgba(6,42,34,0.9)] ring-gold/40"
                        : "bg-paper text-ink ring-ink/10 hover:-translate-y-px hover:bg-gold-pale/40 hover:ring-gold-dark/30"
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-9 items-center justify-center rounded-xl transition-colors",
                        on ? "bg-gradient-to-b from-gold-light to-gold text-void" : "bg-bone text-ink-3"
                      )}
                    >
                      {s.icon}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{s.title}</span>
                      <span className={cn("block text-[11px]", on ? "text-paper/55" : "text-ink-4")}>{s.body}</span>
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "absolute right-3 top-3 size-3.5 rounded-full ring-2 transition-colors",
                        on ? "bg-gold ring-gold/30" : "bg-paper ring-ink/15"
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {scope === "CATEGORY" ? (
            <div className="animate-fade-in">
              <span className="mb-2 block text-[12.5px] font-medium text-ink-2">Category</span>
              <Select
                id="count-category"
                ariaLabel="Category"
                value={categoryId}
                onChange={setCategoryId}
                loading={categories.isLoading}
                placeholder="Select category…"
                icon={<TagsIcon size={13} />}
                options={(categories.data?.rows ?? []).map((c) => ({ value: c.id, label: c.name }))}
              />
            </div>
          ) : null}
          {scope === "LOCATION" ? (
            <label className="block animate-fade-in">
              <span className="mb-2 block text-[12.5px] font-medium text-ink-2">Location</span>
              <span className="relative block">
                <StoreIcon size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-5" />
                <input
                  id="count-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Showcase A"
                  autoComplete="off"
                  className="h-11 w-full rounded-xl bg-paper pl-10 pr-3.5 text-sm text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12),0_1px_2px_rgba(16,32,27,0.04)] transition-shadow placeholder:text-ink-5 hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.26)] focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)]"
                />
              </span>
              <span className="mt-1.5 block text-xs text-ink-4">Exactly as recorded on the pieces, e.g. Showcase A</span>
            </label>
          ) : null}

          {branches.isError ? (
            <Callout tone="danger" title="Could not load branches">
              {branches.error instanceof Error ? branches.error.message : "Please try again."}
            </Callout>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-3 rounded-b-[24px] border-t border-ink/[0.06] bg-bone/50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="truncate text-xs text-ink-4">
            {ready ? (
              <>
                Counting <span className="font-medium text-ink">{SCOPES.find((s) => s.key === scope)?.title.toLowerCase()}</span>
                {scope !== "FULL" ? (
                  <>
                    {" "}· <span className="font-medium text-ink">{scope === "CATEGORY" ? categories.data?.rows.find((c) => c.id === categoryId)?.name : location.trim()}</span>
                  </>
                ) : null}
                {branchName ? <> at <span className="font-medium text-ink">{branchName}</span></> : null}
              </>
            ) : (
              "Choose what to count"
            )}
          </p>
          <div className="flex shrink-0 justify-end gap-2">
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
              onClick={() => void start()}
              disabled={pending || !ready}
              className="g-btn g-btn-primary h-11 rounded-xl px-5 text-sm"
            >
              {pending ? (
                <>
                  <span className="size-3.5 animate-spin rounded-full border-2 border-gold-light/30 border-t-gold-light" />
                  Starting…
                </>
              ) : (
                <>
                  Start count
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
