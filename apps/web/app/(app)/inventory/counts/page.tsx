"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, Callout } from "@/components/ui";
import { Select } from "@/components/select";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  Building2Icon,
  CheckCircleIcon,
  ClipboardCheckIcon,
  LayersIcon,
  PlusIcon,
  ScanBarcodeIcon,
  StoreIcon,
  TagsIcon,
  XIcon,
} from "@/components/icons";
import {
  Avatar,
  Card,
  CardHead,
  COUNT_META,
  CountChip,
  Empty,
  FilterPills,
  GoldHero,
  HeroBadge,
  Progress,
  RowsSkeleton,
  ago,
  heroGold,
  th,
  thead,
  tr,
} from "../kit";

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

const stampOf = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? "";
}

/* ------------------------------------------------------------------ page */

export default function StockCountsPage() {
  const [status, setStatus] = useState("");
  const [starting, setStarting] = useState(false);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canEdit = hasPermission(me.data?.permissions ?? [], "products:edit");

  // One unfiltered list feeds the figures and the pill counts; the filtered
  // list feeds the table (the same query when no filter is set).
  const all = useQuery({
    queryKey: ["counts", ""],
    queryFn: () => api<CountListRow[]>("/api/v1/counts"),
  });
  const counts = useQuery({
    queryKey: ["counts", status],
    queryFn: () => api<CountListRow[]>(`/api/v1/counts${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  });

  const every = all.data ?? [];
  const rows = counts.data ?? [];
  const by = (s: CountStatus) => every.filter((r) => r.status === s).length;
  const open = every.filter((r) => r.status === "OPEN");
  const lockedPieces = open.reduce((s, r) => s + r.expected, 0);
  const scannedSum = rows.reduce((s, r) => s + r.scanned, 0);
  const expectedSum = rows.reduce((s, r) => s + r.expected, 0);
  const coverage = expectedSum > 0 ? Math.min(scannedSum / expectedSum, 1) : null;
  const branchesCovered = new Set(every.map((r) => r.branch_id)).size;
  const last = every.reduce((m, r) => Math.max(m, r.created_at), 0);
  const loading = all.isLoading;

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={ClipboardCheckIcon}
        title="Stock counts,"
        accent="shelf vs book"
        back={{ href: "/inventory", label: "Inventory" }}
        badge={
          all.data ? (
            open.length ? <HeroBadge tone="warn">{open.length} open</HeroBadge> : <HeroBadge tone="good">Nothing locked</HeroBadge>
          ) : null
        }
        sub="Snapshot the expected list, scan the shelf, approve write-offs with a second person. Open counts lock their pieces."
        actions={
          canEdit ? (
            <button type="button" onClick={() => setStarting(true)} className={heroGold}>
              <PlusIcon size={13} /> Start count
            </button>
          ) : null
        }
        stats={[
          { label: "Counts", value: all.data ? every.length : null, sub: "Latest 100", loading },
          { label: "Open now", value: all.data ? open.length : null, tone: open.length ? "warn" : undefined, sub: open.length ? "Scanning in progress" : "None running", loading },
          { label: "Locked pieces", value: all.data ? lockedPieces : null, sub: "Held from sale and transfer", loading },
          { label: "Completed", value: all.data ? by("COMPLETE") : null, tone: "good", sub: "Approved and closed", loading },
          { label: "Cancelled", value: all.data ? by("CANCELLED") : null, sub: "Withdrawn", loading },
          {
            label: "Scanned",
            value: counts.data ? scannedSum : null,
            accent: true,
            sub: coverage !== null ? `of ${expectedSum.toLocaleString("en-US")} · ${Math.round(coverage * 100)}%` : "Nothing expected yet",
            loading: counts.isLoading,
          },
          { label: "Branches", value: all.data ? branchesCovered : null, sub: last ? `Last count ${ago(last)}` : "No counts yet", loading },
        ]}
      >
        <ol className="grid gap-1.5 sm:grid-cols-3">
          {[
            { n: "1", t: "Snapshot", d: "In-stock pieces in scope become the expected list", icon: LayersIcon },
            { n: "2", t: "Scan the shelf", d: "Missing and unexpected pieces surface as you go", icon: ScanBarcodeIcon },
            { n: "3", t: "Approve", d: "A second person signs off write-offs", icon: CheckCircleIcon },
          ].map((s) => (
            <li key={s.n} className="flex items-center gap-2.5 rounded-xl bg-paper/[0.04] px-3 py-2 ring-1 ring-inset ring-paper/10">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-paper/[0.07] text-gold-light">
                <s.icon size={12} />
              </span>
              <span className="min-w-0">
                <span className="block text-[11.5px] font-semibold text-paper">
                  <span className="g-metric mr-1 text-gold-light/70">{s.n}</span>
                  {s.t}
                </span>
                <span className="block truncate text-[10.5px] text-paper/45">{s.d}</span>
              </span>
            </li>
          ))}
        </ol>
      </GoldHero>

      <Card>
        <CardHead
          icon={ClipboardCheckIcon}
          title="Counts"
          sub={counts.data ? `${rows.length} shown · latest 100 across your branches` : "Latest 100 across your branches"}
          action={
            <FilterPills
              items={[
                { key: "", label: "All", count: all.data ? every.length : undefined },
                ...(["OPEN", "COMPLETE", "CANCELLED"] as const).map((k) => ({
                  key: k as string,
                  label: COUNT_META[k]!.label,
                  dot: COUNT_META[k]!.dot,
                  count: all.data ? by(k) : undefined,
                })),
              ]}
              value={status}
              onChange={setStatus}
            />
          }
        />

        {counts.isLoading ? (
          <RowsSkeleton rows={5} />
        ) : counts.isError ? (
          <div className="p-3">
            <Callout tone="danger" title="Could not load counts">
              {counts.error instanceof Error ? counts.error.message : "Please try again."}
            </Callout>
          </div>
        ) : rows.length === 0 ? (
          <Empty
            icon={ClipboardCheckIcon}
            title={status ? "No counts with this status" : "No stock counts yet"}
            desc="Start a count to scan a branch, a category or a single location and find missing pieces."
            action={
              status ? (
                <button type="button" onClick={() => setStatus("")} className="g-btn g-btn-secondary h-8 rounded-lg px-3 text-[12px]">
                  Show all
                </button>
              ) : canEdit ? (
                <button type="button" onClick={() => setStarting(true)} className="g-btn g-btn-primary h-8 rounded-lg px-3 text-[12px]">
                  <PlusIcon size={12} /> Start count
                </button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-[12.5px]">
              <thead className={thead}>
                <tr>
                  <th className={cn(th, "pl-4")}>Branch</th>
                  <th className={th}>Status</th>
                  <th className={th}>Scope</th>
                  <th className={th}>Scanned</th>
                  <th className={cn(th, "hidden text-right sm:table-cell")}>Left</th>
                  <th className={cn(th, "hidden md:table-cell")}>Opened by</th>
                  <th className={cn(th, "text-right")}>Opened</th>
                  <th className={cn(th, "w-20 pr-4")}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <CountRow key={r.id} r={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {starting ? <StartCountDialog onClose={() => setStarting(false)} /> : null}
    </Page>
  );
}

/* ------------------------------------------------------------------ parts */

function CountRow({ r }: { r: CountListRow }) {
  const router = useRouter();
  const share = r.expected > 0 ? Math.min(r.scanned / r.expected, 1) : 0;
  const open = r.status === "OPEN";
  const allFound = open && r.expected > 0 && r.scanned >= r.expected;
  const scopeDetail = r.scope === "CATEGORY" || r.scope === "LOCATION" ? r.scope_label ?? r.scope_ref : null;
  const href = `/inventory/counts/${r.id}`;
  return (
    <tr className={cn(tr, "group cursor-pointer", r.status === "CANCELLED" && "opacity-60")} onClick={() => router.push(href)}>
      <td className="relative py-1.5 pl-4 pr-2">
        {open ? <span aria-hidden className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-gradient-to-b from-gold-light to-gold" /> : null}
        <Link href={href} className="flex items-center gap-2 font-medium text-ink group-hover:text-gold-deep" onClick={(e) => e.stopPropagation()}>
          <Building2Icon size={12} className="shrink-0 text-ink-5" />
          {r.branch_name ?? "—"}
        </Link>
      </td>
      <td className="px-2 py-1.5">
        {allFound ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/10 px-2 py-px text-[10.5px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-600/25">
            <CheckCircleIcon size={10} /> All found
          </span>
        ) : (
          <CountChip status={r.status} />
        )}
      </td>
      <td className="px-2 py-1.5">
        <span className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-ink-3">
          {r.scope === "CATEGORY" ? <TagsIcon size={11} /> : r.scope === "LOCATION" ? <StoreIcon size={11} /> : <LayersIcon size={11} />}
          {SCOPE_LABEL[r.scope] ?? r.scope}
          {scopeDetail ? <span className="max-w-[9rem] truncate text-ink-5">· {scopeDetail}</span> : null}
        </span>
      </td>
      <td className="min-w-[9rem] px-2 py-1.5">
        <span className="flex items-baseline justify-between gap-2 text-[11px]">
          <span className="g-metric text-ink">
            {r.scanned.toLocaleString("en-US")}
            <span className="text-ink-5">/{r.expected.toLocaleString("en-US")}</span>
          </span>
          <span className="g-metric text-ink-5">{Math.round(share * 100)}%</span>
        </span>
        <Progress value={share} tone={allFound || r.status === "COMPLETE" ? "good" : r.status === "CANCELLED" ? "muted" : "gold"} className="mt-1 h-1" />
      </td>
      <td className="g-metric hidden px-2 py-1.5 text-right text-ink-3 sm:table-cell">{Math.max(r.expected - r.scanned, 0).toLocaleString("en-US")}</td>
      <td className="hidden px-2 py-1.5 md:table-cell">
        {r.opened_by_name ? (
          <span className="flex items-center gap-1.5">
            <Avatar name={r.opened_by_name} />
            <span className="max-w-[8rem] truncate text-[11.5px] text-ink-3">{r.opened_by_name}</span>
          </span>
        ) : (
          <span className="text-ink-5">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right text-[11px] text-ink-4" title={stampOf(r.created_at)}>
        {ago(r.created_at)}
      </td>
      <td className="py-1.5 pl-2 pr-4 text-right">
        <span
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-semibold transition-colors",
            open ? "bg-void text-paper" : "text-ink-3 ring-1 ring-inset ring-ink/20 group-hover:bg-void group-hover:text-paper group-hover:ring-0"
          )}
        >
          {open ? "Continue" : "View"}
          <ArrowRightIcon size={10} className={open ? "text-gold-light" : undefined} />
        </span>
      </td>
    </tr>
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
        className="w-full max-w-lg animate-pop-in rounded-[20px] bg-paper shadow-5 ring-1 ring-ink/20"
      >
        {/* Header */}
        <div className="relative overflow-hidden rounded-t-[20px] bg-void px-5 py-4 text-paper">
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
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_10px_22px_-10px_rgba(205,168,83,0.7)]">
              <ClipboardCheckIcon size={20} />
            </span>
            <div className="min-w-0 pr-8">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">Inventory</div>
              <h2 id="start-count-title" className="g-display mt-0.5 text-lg text-paper">
                Start stock count
              </h2>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex items-start gap-2.5 rounded-xl bg-gold-pale/70 p-3 text-[11.5px] leading-relaxed text-ink-3 ring-1 ring-gold-dark/15">
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
                      "relative flex flex-col items-start gap-1.5 rounded-xl p-3 text-left ring-1 transition-all duration-200 ease-brand",
                      on
                        ? "bg-void text-paper shadow-[0_14px_28px_-16px_rgba(6,42,34,0.9)] ring-gold/40"
                        : "bg-paper text-ink ring-ink/20 hover:-translate-y-px hover:bg-gold-pale/40 hover:ring-gold-dark/30"
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-8 items-center justify-center rounded-lg transition-colors",
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
                        on ? "bg-gold ring-gold/30" : "bg-paper ring-ink/20"
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
                  className="h-10 w-full rounded-xl bg-paper pl-10 pr-3.5 text-sm text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2),0_1px_2px_rgba(16,32,27,0.04)] transition-shadow placeholder:text-ink-5 hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.26)] focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)]"
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
        <div className="flex flex-col-reverse gap-3 rounded-b-[20px] border-t border-ink/20 bg-bone/50 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
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
              className="g-btn h-9 rounded-lg px-3.5 text-[13px] text-ink-3 hover:bg-paper hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void start()}
              disabled={pending || !ready}
              className="g-btn g-btn-primary h-9 rounded-lg px-4 text-[13px]"
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
