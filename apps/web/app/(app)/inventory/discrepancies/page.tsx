"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission, mgToG } from "@goldos/shared";
import { api, downloadCsv, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Callout, Page, Skeleton } from "@/components/ui";
import { Select } from "@/components/select";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  Building2Icon,
  CheckCircleIcon,
  ClipboardCheckIcon,
  FileDownIcon,
  RefreshCwIcon,
  ScaleIcon,
  ScanBarcodeIcon,
  SearchIcon,
  TruckIcon,
} from "@/components/icons";

/* ---------------------------------------------------------------- Types */

type Summary = {
  missing: number;
  unexpected: number;
  duplicates: number;
  unreceived: number;
  gold: Array<{ branchId: string; passed: boolean; differenceMg: number }>;
  transfers: Array<{ transferId: string; number: string; warnings: string[] }>;
  hasData: boolean;
};

type MissingRow = {
  countId: string;
  productId: string;
  barcode: string;
  productName: string;
  daysOpen: number;
  status: "OPEN" | "COMPLETE";
  posted: boolean;
};

type ScanRow = { countId: string; barcode: string; scannedAt: number; scannedBy: string };

type UnreceivedRow = {
  transferId: string;
  number: string;
  barcode: string;
  productId: string;
  fromBranch: string;
  toBranch: string;
  fromBranchName: string;
  toBranchName: string;
  ageDays: number;
};

type TabKey = "missing" | "unexpected" | "duplicates" | "unreceived";

type TabData = {
  missing: { rows: MissingRow[]; hasData: boolean };
  unexpected: { rows: ScanRow[]; hasData: boolean; note?: string };
  duplicates: { rows: ScanRow[]; hasData: boolean; note?: string };
  unreceived: { rows: UnreceivedRow[]; hasData: boolean; thresholdDays: number };
};

/* ---------------------------------------------------------------- Helpers */

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return (
    document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? ""
  );
}

const fmtG = (mg: number) =>
  mgToG(Math.abs(mg)).toLocaleString("en-US", { maximumFractionDigits: 3 });

const n = (v: number) => v.toLocaleString("en-US");

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "branch";
}

const cardShadow =
  "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]";

const TABS: Record<TabKey, { label: string; sub: string; icon: (p: { size?: number }) => ReactNode; severe: boolean }> = {
  missing: { label: "Missing pieces", sub: "Not found by a stock count", icon: SearchIcon, severe: true },
  unexpected: { label: "Unexpected scans", sub: "Scanned where not expected", icon: ScanBarcodeIcon, severe: true },
  duplicates: { label: "Duplicate scans", sub: "Same piece scanned twice", icon: ClipboardCheckIcon, severe: false },
  unreceived: { label: "Unreceived transfers", sub: "Lines stuck in transit", icon: TruckIcon, severe: true },
};
const TAB_ORDER: TabKey[] = ["missing", "unexpected", "duplicates", "unreceived"];

/* ---------------------------------------------------------------- Page */

export default function DiscrepanciesPage() {
  const [branchId, setBranchId] = useState("");
  const [tab, setTab] = useState<TabKey>("missing");

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canExport = hasPermission(me.data?.permissions ?? [], "audit:export");

  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () =>
      api<{ rows: Array<{ id: string; name: string }>; total: number }>("/api/v1/branches?limit=100"),
    staleTime: 60_000,
  });
  const branchRows = branches.data?.rows ?? [];

  // Pick the cookie branch when the user can see it, else the first branch.
  useEffect(() => {
    if (branchId || branchRows.length === 0) return;
    const cookie = branchDefault();
    const pick = branchRows.find((b) => b.id === cookie)?.id ?? branchRows[0]?.id ?? "";
    setBranchId(pick);
  }, [branchId, branchRows]);

  const branchName = branchRows.find((b) => b.id === branchId)?.name ?? "";

  const summary = useQuery({
    queryKey: ["discrepancies", "summary", branchId],
    queryFn: () =>
      api<Summary>(`/api/v1/discrepancies/summary?branchId=${encodeURIComponent(branchId)}`),
    enabled: Boolean(branchId),
    retry: false,
  });

  const detail = useQuery({
    queryKey: ["discrepancies", tab, branchId],
    queryFn: () =>
      api<TabData[typeof tab]>(`/api/v1/discrepancies/${tab}?branchId=${encodeURIComponent(branchId)}`),
    enabled: Boolean(branchId),
    retry: false,
  });

  const [downloading, setDownloading] = useState(false);
  async function exportCsv(kind: TabKey) {
    setDownloading(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      await downloadCsv(
        `/api/v1/discrepancies/${kind}?branchId=${encodeURIComponent(branchId)}&format=csv`,
        `${kind}-${slug(branchName || branchId)}-${date}.csv`
      );
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setDownloading(false);
    }
  }

  const s = summary.data;
  const gold = s?.gold.find((g) => g.branchId === branchId) ?? s?.gold[0];
  const summaryLoading = summary.isLoading || !branchId;
  const openIssues = s ? s.missing + s.unexpected + s.duplicates + s.unreceived + (gold && !gold.passed ? 1 : 0) : null;
  const noBranches = branches.isSuccess && branchRows.length === 0;

  function pickTab(k: TabKey) {
    setTab(k);
    document.getElementById("discrepancy-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <Page className="space-y-6">
      {/* Hero */}
      {/* z-30 keeps the branch dropdown above the summary cards, whose fade-in transforms form their own stacking contexts. */}
      <section className="relative z-30 rounded-[28px] bg-void text-paper shadow-5 ring-1 ring-gold/10">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]" aria-hidden>
          <div className="home-grid-bg absolute inset-0 opacity-60" />
          <div className="home-drift absolute -right-24 -top-32 size-[22rem] rounded-full bg-gold/20 blur-[120px]" />
          <div className="absolute -bottom-40 -left-24 size-80 rounded-full bg-emerald-400/10 blur-[110px]" />
          <div className="home-noise absolute inset-0" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
        </div>

        <div className="relative flex flex-col gap-6 px-5 py-6 sm:px-7 lg:flex-row lg:items-end lg:justify-between lg:px-8 lg:py-7">
          <div className="min-w-0">
            <Link
              href="/inventory"
              className="group inline-flex items-center gap-1.5 text-xs font-medium text-paper/55 transition-colors hover:text-gold-light"
            >
              <ArrowLeftIcon size={13} className="transition-transform group-hover:-translate-x-0.5" />
              Inventory
            </Link>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
                <span className="size-1.5 animate-pulse-soft rounded-full bg-gold" />
                Inventory · Live check
              </span>
              {openIssues !== null ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ring-1",
                    openIssues > 0
                      ? "bg-amber-400/10 text-amber-200 ring-amber-300/25"
                      : "bg-emerald-400/10 text-emerald-200 ring-emerald-300/25"
                  )}
                >
                  {openIssues > 0 ? <AlertCircleIcon size={11} /> : <CheckCircleIcon size={11} />}
                  {openIssues > 0 ? `${n(openIssues)} to review` : "All clear"}
                </span>
              ) : null}
            </div>
            <h1 className="g-display mt-3.5 text-3xl text-paper sm:text-[2.6rem]">
              Discrepancies, <span className="home-gold-text">caught early.</span>
            </h1>
            <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-paper/60">
              Live reads of stock counts, scans, transfers and the gold ledger for one branch. Every figure is
              computed when you open the page, not a frozen statement.
            </p>
          </div>

          <div className="w-full shrink-0 rounded-2xl bg-paper/[0.06] p-3 ring-1 ring-paper/10 backdrop-blur sm:w-72">
            <div className="mb-2 flex items-center justify-between px-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/45">
              Branch
              {summary.isFetching ? (
                <span className="size-3 animate-spin rounded-full border-2 border-gold/30 border-t-gold" aria-label="Refreshing" />
              ) : null}
            </div>
            <Select
              ariaLabel="Branch"
              value={branchId}
              onChange={setBranchId}
              disabled={branchRows.length === 0}
              loading={branches.isLoading}
              placeholder={noBranches ? "No branches" : "Choose branch"}
              icon={<Building2Icon size={13} />}
              options={branchRows.map((b) => ({ value: b.id, label: b.name }))}
            />
          </div>
        </div>
      </section>

      {branches.isError ? (
        <Callout tone="danger" title="Could not load branches">
          {errMsg(branches.error)}
        </Callout>
      ) : null}

      {noBranches ? (
        <EmptyState
          title="No branches available"
          body="You are not a member of any branch, so there is nothing to check."
          icon={<Building2Icon size={26} />}
        />
      ) : null}

      {/* Summary */}
      {summary.isError ? (
        <div className={cn("rounded-[22px] bg-paper p-5", cardShadow)}>
          <Callout tone="danger" title="Could not load the summary">
            {errMsg(summary.error)}
          </Callout>
          <button
            type="button"
            onClick={() => void summary.refetch()}
            className="g-btn g-btn-secondary mt-3 h-9 rounded-xl px-3.5 text-xs"
          >
            <RefreshCwIcon size={12} /> Retry
          </button>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="grid gap-4 sm:grid-cols-2">
            {TAB_ORDER.map((k, i) => {
              const t = TABS[k];
              const value = s ? s[k] : null;
              const flagged = value !== null && value > 0 && t.severe;
              const active = tab === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => pickTab(k)}
                  aria-pressed={active}
                  className={cn(
                    "group relative flex min-w-0 animate-fade-in items-center gap-4 overflow-hidden rounded-[22px] bg-paper p-4 text-left transition-all duration-320 ease-brand sm:p-5",
                    cardShadow,
                    "hover:-translate-y-1 hover:shadow-[inset_0_0_0_1px_rgba(168,138,62,0.4),0_30px_60px_-30px_rgba(126,98,35,0.45)]",
                    active && "shadow-[inset_0_0_0_1.5px_rgba(168,138,62,0.65),0_24px_48px_-30px_rgba(126,98,35,0.5)]"
                  )}
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent to-transparent transition-opacity",
                      flagged ? "via-amber-400 opacity-100" : "via-gold/70 opacity-0 group-hover:opacity-100",
                      active && "opacity-100"
                    )}
                  />
                  <span
                    className={cn(
                      "flex size-12 shrink-0 items-center justify-center rounded-2xl transition-transform duration-320 group-hover:scale-105",
                      flagged
                        ? "bg-amber-100/80 text-amber-700 ring-1 ring-amber-600/15"
                        : "bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)]"
                    )}
                  >
                    <t.icon size={19} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{t.label}</span>
                    <span className="mt-0.5 block truncate text-xs text-ink-4">{t.sub}</span>
                    {value !== null ? (
                      flagged ? (
                        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-700 ring-1 ring-amber-600/15">
                          <AlertCircleIcon size={10} /> Review
                        </span>
                      ) : value === 0 ? (
                        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-700 ring-1 ring-emerald-600/15">
                          <CheckCircleIcon size={10} /> Clear
                        </span>
                      ) : (
                        <span className="mt-2 inline-flex rounded-full bg-bone px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-4 ring-1 ring-ink/[0.07]">
                          Hygiene
                        </span>
                      )
                    ) : null}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1.5">
                    {summaryLoading ? (
                      <Skeleton className="h-9 w-10" />
                    ) : (
                      <span className={cn("g-metric text-[2.25rem] leading-none", flagged ? "text-amber-700" : "text-ink")}>
                        {value !== null ? n(value) : "—"}
                      </span>
                    )}
                    <ArrowRightIcon
                      size={13}
                      className="-translate-x-1 text-gold-dark opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
                    />
                  </span>
                </button>
              );
            })}
          </div>

          <GoldCard loading={summaryLoading} gold={gold} />
        </div>
      )}

      {s && !s.hasData ? (
        <div className="relative flex items-start gap-4 overflow-hidden rounded-[22px] bg-gradient-to-r from-emerald-50 via-emerald-50/50 to-paper p-5 ring-1 ring-emerald-600/15">
          <div className="pointer-events-none absolute -left-10 -top-16 size-40 rounded-full bg-emerald-300/30 blur-3xl" aria-hidden />
          <span className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-emerald-500 to-emerald-700 text-paper shadow-[0_12px_24px_-10px_rgba(5,150,105,0.7)]">
            <CheckCircleIcon size={20} />
          </span>
          <div className="relative min-w-0">
            <p className="text-[15px] font-semibold text-ink">No open discrepancies for this branch</p>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-3">
              Nothing was found by these checks right now. That covers counts, scans, transfers in transit and the
              gold ledger only; it is not a full audit of the branch.
            </p>
          </div>
        </div>
      ) : null}

      {/* Transfer warnings */}
      {s && s.transfers.length > 0 ? (
        <section className={cn("relative overflow-hidden rounded-[22px] bg-paper", cardShadow)}>
          <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/70 to-transparent" />
          <div className="flex items-center gap-3.5 border-b border-ink/[0.06] px-5 py-4 sm:px-6">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100/80 text-amber-700 ring-1 ring-amber-600/15">
              <AlertCircleIcon size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-sans tracking-normal text-[15px] font-semibold text-ink">Transfer warnings</h2>
              <p className="text-xs text-ink-4">Open transfers whose reconciliation raised warnings.</p>
            </div>
            <span className="g-metric rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-600/15">
              {s.transfers.length}
            </span>
          </div>
          <ul className="grid gap-3 p-5 sm:p-6 md:grid-cols-2">
            {s.transfers.map((t) => (
              <li key={t.transferId}>
                <Link
                  href={`/inventory/transfers/${t.transferId}`}
                  className="group block h-full rounded-2xl bg-bone/60 p-4 ring-1 ring-ink/[0.06] transition-all duration-200 hover:-translate-y-px hover:bg-gold-pale/50 hover:ring-gold-dark/25"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 font-mono text-sm font-medium text-ink">
                      <TruckIcon size={14} className="text-gold-dark" />
                      {t.number}
                    </span>
                    <ArrowRightIcon size={13} className="text-ink-5 transition-all group-hover:translate-x-0.5 group-hover:text-gold-dark" />
                  </span>
                  <ul className="mt-2.5 space-y-1.5">
                    {t.warnings.map((w, i) => (
                      <li key={i} className="flex items-start gap-2 text-[13px] leading-snug text-ink-3">
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                        {w}
                      </li>
                    ))}
                  </ul>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Detail */}
      <TabBody
        tab={tab}
        onTab={setTab}
        counts={s ? { missing: s.missing, unexpected: s.unexpected, duplicates: s.duplicates, unreceived: s.unreceived } : null}
        loading={detail.isLoading || !branchId}
        error={detail.isError ? errMsg(detail.error) : undefined}
        onRetry={() => void detail.refetch()}
        data={detail.data}
        actions={
          canExport ? (
            <button
              type="button"
              onClick={() => void exportCsv(tab)}
              disabled={downloading || !branchId}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-paper px-3.5 text-xs font-medium text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12)] transition-all hover:-translate-y-px hover:bg-void hover:text-paper hover:shadow-none disabled:pointer-events-none disabled:opacity-50"
            >
              {downloading ? (
                <span className="size-3.5 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
              ) : (
                <FileDownIcon size={14} className="text-gold-dark" />
              )}
              {downloading ? "Preparing…" : "Download CSV"}
            </button>
          ) : null
        }
      />
    </Page>
  );
}

/* ---------------------------------------------------------------- Gold */

function GoldCard({
  loading,
  gold,
}: {
  loading: boolean;
  gold: { passed: boolean; differenceMg: number } | undefined;
}) {
  const failed = gold && !gold.passed;
  return (
    <section
      aria-label="Gold consistency"
      className="relative flex flex-col overflow-hidden rounded-[22px] bg-void p-5 text-paper shadow-5 ring-1 ring-gold/10 sm:p-6"
    >
      <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-50" aria-hidden />
      <div
        className={cn(
          "pointer-events-none absolute -right-16 -top-20 size-56 rounded-full blur-[80px]",
          failed ? "bg-rose-500/25" : gold ? "bg-emerald-400/20" : "bg-gold/20"
        )}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" aria-hidden />

      <div className="relative flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold-deep text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_10px_22px_-10px_rgba(205,168,83,0.6)]">
          <ScaleIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-sans tracking-normal text-[15px] font-semibold text-paper">Gold consistency</h2>
          <p className="text-xs text-paper/45">Ledger vs held stock, exact mg</p>
        </div>
        {gold ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ring-1",
              failed ? "bg-rose-400/15 text-rose-200 ring-rose-300/30" : "bg-emerald-400/15 text-emerald-200 ring-emerald-300/30"
            )}
          >
            {failed ? <AlertCircleIcon size={11} /> : <CheckCircleIcon size={11} />}
            {failed ? "Mismatch" : "Passed"}
          </span>
        ) : null}
      </div>

      <div className="relative mt-auto pt-6">
        {loading ? (
          <Skeleton className="h-12 w-40 bg-paper/10" />
        ) : !gold ? (
          <p className="text-sm text-paper/50">No ledger reading for this branch yet.</p>
        ) : failed ? (
          <>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">Off by</div>
            <div className="mt-1 flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="g-metric text-[2.5rem] leading-none text-rose-300">{fmtG(gold.differenceMg)}</span>
              <span className="g-metric text-lg text-paper/50">g</span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-paper/50">
              The gold ledger and the pieces held at this branch disagree. Reconcile before the next count is approved.
            </p>
          </>
        ) : (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="g-metric text-[2.5rem] leading-none text-gold-light">0.000</span>
              <span className="g-metric text-lg text-paper/50">g</span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-paper/50">Ledger and held stock agree to the milligram.</p>
          </>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Tab body */

function TabBody({
  tab,
  onTab,
  counts,
  loading,
  error,
  onRetry,
  data,
  actions,
}: {
  tab: TabKey;
  onTab: (k: TabKey) => void;
  counts: Record<TabKey, number> | null;
  loading: boolean;
  error: string | undefined;
  onRetry: () => void;
  data: TabData[TabKey] | undefined;
  actions: ReactNode;
}) {
  const description = {
    missing: "Pieces a stock count expected but could not find.",
    unexpected: "Scans of pieces that were not expected on that shelf.",
    duplicates: "The same piece scanned more than once in a count. Scan hygiene, not stock movement.",
    unreceived:
      data && "thresholdDays" in data
        ? `Transfer lines in transit ≥ ${data.thresholdDays} days.`
        : "Transfer lines that have been in transit too long.",
  }[tab];
  const Icon = TABS[tab].icon;
  const note = data && "note" in data && data.note ? data.note : null;
  const idx = TAB_ORDER.indexOf(tab);

  let body: ReactNode;
  if (error) {
    body = (
      <div className="p-5 sm:p-6">
        <Callout tone="danger" title={`Could not load ${TABS[tab].label.toLowerCase()}`}>
          {error}
        </Callout>
        <button type="button" onClick={onRetry} className="g-btn g-btn-secondary mt-3 h-9 rounded-xl px-3.5 text-xs">
          <RefreshCwIcon size={12} /> Retry
        </button>
      </div>
    );
  } else if (loading || !data) {
    body = (
      <div className="space-y-2.5 p-5 sm:p-6">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 rounded-2xl" />
        ))}
      </div>
    );
  } else if (data.rows.length === 0) {
    body = (
      <div className="p-5 sm:p-6">
        <EmptyState
          title={`No ${TABS[tab].label.toLowerCase()}`}
          body="This check found nothing for the selected branch."
          icon={<CheckCircleIcon size={26} />}
          good
        />
      </div>
    );
  } else if (tab === "missing") {
    body = <MissingTable rows={(data as TabData["missing"]).rows} />;
  } else if (tab === "unreceived") {
    body = <UnreceivedTable rows={(data as TabData["unreceived"]).rows} />;
  } else {
    body = <ScanTable rows={(data as TabData["unexpected"]).rows} />;
  }

  return (
    <section id="discrepancy-detail" className={cn("relative scroll-mt-24 overflow-hidden rounded-[22px] bg-paper", cardShadow)}>
      <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />

      {/* Tab switcher */}
      <div className="border-b border-ink/[0.06] px-5 pt-4 sm:px-6">
        <div className="-mx-1 overflow-x-auto px-1 pb-4 scrollbar-thin">
          <div
            role="tablist"
            aria-label="Discrepancy type"
            className="relative grid min-w-max grid-cols-4 rounded-xl bg-bone p-1 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07)]"
          >
            <span
              aria-hidden
              className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/4)] rounded-lg bg-void shadow-[inset_0_0_0_1px_rgba(205,168,83,0.3),0_8px_18px_-10px_rgba(6,42,34,0.8)] transition-transform duration-320 ease-brand"
              style={{ transform: `translateX(${idx * 100}%)` }}
            />
            {TAB_ORDER.map((k) => {
              const active = k === tab;
              const T = TABS[k].icon;
              const c = counts?.[k];
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onTab(k)}
                  className={cn(
                    "relative inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-[13px] font-medium transition-colors duration-200",
                    active ? "text-paper" : "text-ink-4 hover:text-ink"
                  )}
                >
                  <span className={active ? "text-gold-light" : "text-ink-5"}>
                    <T size={14} />
                  </span>
                  {TABS[k].label.split(" ")[0]}
                  {c !== undefined && c !== null ? (
                    <span
                      className={cn(
                        "g-metric min-w-5 rounded-full px-1.5 text-center text-[10px] font-semibold leading-[18px]",
                        active
                          ? c > 0 && TABS[k].severe
                            ? "bg-amber-400 text-void"
                            : "bg-paper/15 text-paper"
                          : c > 0 && TABS[k].severe
                            ? "bg-amber-100 text-amber-800"
                            : "bg-ink/[0.07] text-ink-3"
                      )}
                    >
                      {n(c)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)]">
            <Icon size={17} />
          </span>
          <div className="min-w-0">
            <h2 className="font-sans tracking-normal text-[15px] font-semibold text-ink">{TABS[tab].label}</h2>
            <p className="text-xs text-ink-4">{description}</p>
          </div>
        </div>
        {actions}
      </div>
      {note ? (
        <div className="mx-5 mb-4 flex items-start gap-2 rounded-xl bg-gold-pale/60 px-3.5 py-2.5 text-xs text-ink-3 ring-1 ring-gold-dark/15 sm:mx-6">
          <AlertCircleIcon size={13} className="mt-0.5 shrink-0 text-gold-deep" />
          {note}
        </div>
      ) : null}

      <div className="overflow-x-auto border-t border-ink/[0.06] scrollbar-thin">{body}</div>
    </section>
  );
}

function EmptyState({ title, body, icon, good }: { title: string; body: string; icon: ReactNode; good?: boolean }) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center overflow-hidden rounded-[22px] px-6 py-12 text-center",
        good
          ? "bg-gradient-to-b from-emerald-50 via-emerald-50/30 to-paper ring-1 ring-emerald-600/10"
          : "border border-dashed border-ink/15 bg-paper/70"
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -top-20 left-1/2 size-60 -translate-x-1/2 rounded-full blur-[70px]",
          good ? "bg-emerald-300/30" : "bg-gold/10"
        )}
        aria-hidden
      />
      <span
        className={cn(
          "relative mb-4 flex size-14 items-center justify-center rounded-2xl text-paper",
          good
            ? "bg-gradient-to-b from-emerald-500 to-emerald-700 shadow-[0_12px_24px_-10px_rgba(5,150,105,0.7)]"
            : "bg-void text-gold-light shadow-4"
        )}
      >
        {icon}
      </span>
      <h3 className="font-sans tracking-normal relative text-base font-semibold text-ink">{title}</h3>
      <p className="relative mt-1 max-w-sm text-sm text-ink-4">{body}</p>
    </div>
  );
}

const codeLink =
  "inline-flex items-center gap-1 rounded-md bg-bone px-1.5 py-0.5 font-mono text-[11px] font-medium text-ink-3 ring-1 ring-ink/[0.06] transition-colors hover:bg-void hover:text-gold-light hover:ring-transparent";

function AgeBadge({ days }: { days: number }) {
  const tone =
    days >= 14
      ? "bg-rose-50 text-rose-700 ring-rose-600/15"
      : days >= 7
        ? "bg-amber-50 text-amber-700 ring-amber-600/15"
        : "bg-bone text-ink-3 ring-ink/[0.07]";
  return (
    <span className={cn("g-metric inline-flex rounded-full px-2 py-0.5 text-xs ring-1", tone)}>
      {n(days)} {days === 1 ? "day" : "days"}
    </span>
  );
}

function MissingTable({ rows }: { rows: MissingRow[] }) {
  return (
    <table className="g-table">
      <caption className="sr-only">Missing pieces</caption>
      <thead>
        <tr>
          <th>Piece</th>
          <th>Count</th>
          <th className="!text-right">Open for</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.countId}:${r.productId}`} className="group">
            <td>
              <Link href={`/products/${r.productId}`} className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100/70 text-amber-700 ring-1 ring-amber-600/15">
                  <SearchIcon size={15} />
                </span>
                <span className="min-w-0">
                  <span className="block max-w-[18rem] truncate font-medium text-ink transition-colors group-hover:text-gold-deep">
                    {r.productName || "Unnamed piece"}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-ink-4">
                    <ScanBarcodeIcon size={10} className="text-gold-dark" />
                    {r.barcode}
                  </span>
                </span>
              </Link>
            </td>
            <td>
              <Link href={`/inventory/counts/${r.countId}`} className={codeLink}>
                <ClipboardCheckIcon size={10} />
                {r.countId.slice(0, 8)}
              </Link>
            </td>
            <td className="num">
              <AgeBadge days={r.daysOpen} />
            </td>
            <td>
              {r.status === "OPEN" ? (
                <StatusTag tone="amber">Count open</StatusTag>
              ) : r.posted ? (
                <StatusTag tone="rose">Written off</StatusTag>
              ) : (
                <StatusTag tone="neutral">Not posted</StatusTag>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatusTag({ tone, children }: { tone: "amber" | "rose" | "neutral"; children: ReactNode }) {
  const cls = {
    amber: ["bg-amber-50 text-amber-700 ring-amber-600/15", "bg-amber-500"],
    rose: ["bg-rose-50 text-rose-700 ring-rose-600/15", "bg-rose-500"],
    neutral: ["bg-bone text-ink-3 ring-ink/[0.08]", "bg-ink-5"],
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1", cls[0])}>
      <span className={cn("size-1.5 rounded-full", cls[1])} />
      {children}
    </span>
  );
}

function ScanTable({ rows }: { rows: ScanRow[] }) {
  return (
    <table className="g-table">
      <caption className="sr-only">Scans</caption>
      <thead>
        <tr>
          <th>Barcode</th>
          <th>Count</th>
          <th>Scanned at</th>
          <th>Scanned by</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.countId}:${r.barcode}:${r.scannedAt}:${i}`}>
            <td>
              <span className="inline-flex items-center gap-2 font-mono text-xs font-medium text-ink">
                <span className="flex size-8 items-center justify-center rounded-lg bg-void text-gold-light">
                  <ScanBarcodeIcon size={13} />
                </span>
                {r.barcode}
              </span>
            </td>
            <td>
              <Link href={`/inventory/counts/${r.countId}`} className={codeLink}>
                <ClipboardCheckIcon size={10} />
                {r.countId.slice(0, 8)}
              </Link>
            </td>
            <td className="text-sm text-ink-3">
              {new Date(r.scannedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}
              <span className="ml-1.5 text-xs text-ink-5">
                {new Date(r.scannedAt).toLocaleTimeString("en-US", { timeStyle: "short" })}
              </span>
            </td>
            <td>
              <span className="rounded-md bg-bone px-1.5 py-0.5 font-mono text-[11px] text-ink-4 ring-1 ring-ink/[0.06]">
                {r.scannedBy}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UnreceivedTable({ rows }: { rows: UnreceivedRow[] }) {
  return (
    <table className="g-table">
      <caption className="sr-only">Unreceived transfer lines</caption>
      <thead>
        <tr>
          <th>Transfer</th>
          <th>Piece</th>
          <th>Route</th>
          <th className="!text-right">In transit</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.transferId}:${r.productId}`}>
            <td>
              <Link href={`/inventory/transfers/${r.transferId}`} className={codeLink}>
                <TruckIcon size={10} />
                {r.number}
              </Link>
            </td>
            <td>
              <Link href={`/products/${r.productId}`} className={codeLink}>
                <ScanBarcodeIcon size={10} />
                {r.barcode}
              </Link>
            </td>
            <td>
              <span className="inline-flex items-center gap-2 text-sm text-ink-2">
                <span className="truncate">{r.fromBranchName || r.fromBranch.slice(0, 8)}</span>
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-gold-pale text-gold-deep">
                  <ArrowRightIcon size={10} />
                </span>
                <span className="truncate">{r.toBranchName || r.toBranch.slice(0, 8)}</span>
              </span>
            </td>
            <td className="num">
              <AgeBadge days={r.ageDays} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
