"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission, mgToG } from "@goldos/shared";
import { api, downloadCsv, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Callout, Page, Skeleton } from "@/components/ui";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  Building2Icon,
  CheckCircleIcon,
  ClipboardCheckIcon,
  FileDownIcon,
  RefreshCwIcon,
  ScaleIcon,
  ScanBarcodeIcon,
  SearchIcon,
  ShieldIcon,
  TruckIcon,
} from "@/components/icons";
import { Card, CardHead, Empty, FilterPills, GoldHero, HeroBadge, RowsSkeleton, heroGhost, stamp, th, thead, tr, type IconCmp } from "../kit";

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

const TABS: Record<TabKey, { label: string; short: string; sub: string; icon: IconCmp; severe: boolean }> = {
  missing: { label: "Missing pieces", short: "Missing", sub: "Not found by a stock count", icon: SearchIcon, severe: true },
  unexpected: { label: "Unexpected scans", short: "Unexpected", sub: "Scanned where not expected", icon: ScanBarcodeIcon, severe: true },
  duplicates: { label: "Duplicate scans", short: "Duplicates", sub: "Same piece scanned twice", icon: ClipboardCheckIcon, severe: false },
  unreceived: { label: "Unreceived transfers", short: "Unreceived", sub: "Lines stuck in transit", icon: TruckIcon, severe: true },
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
    queryFn: () => api<{ rows: Array<{ id: string; name: string }>; total: number }>("/api/v1/branches?limit=100"),
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
    queryFn: () => api<Summary>(`/api/v1/discrepancies/summary?branchId=${encodeURIComponent(branchId)}`),
    enabled: Boolean(branchId),
    retry: false,
  });

  const detail = useQuery({
    queryKey: ["discrepancies", tab, branchId],
    queryFn: () => api<TabData[typeof tab]>(`/api/v1/discrepancies/${tab}?branchId=${encodeURIComponent(branchId)}`),
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
  const loading = summary.isLoading || !branchId;
  const goldFailed = !!gold && !gold.passed;
  const openIssues = s ? s.missing + s.unexpected + s.duplicates + s.unreceived + (goldFailed ? 1 : 0) : null;
  const severe = s ? s.missing + s.unexpected + s.unreceived + (goldFailed ? 1 : 0) : 0;
  const noBranches = branches.isSuccess && branchRows.length === 0;
  const val = (k: TabKey) => (s ? s[k] : null);

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={AlertCircleIcon}
        title="Discrepancies,"
        accent="caught early"
        back={{ href: "/inventory", label: "Inventory" }}
        badge={
          openIssues === null ? (
            <HeroBadge>Live check</HeroBadge>
          ) : openIssues > 0 ? (
            <HeroBadge tone="warn">{n(openIssues)} to review</HeroBadge>
          ) : (
            <HeroBadge tone="good">All clear</HeroBadge>
          )
        }
        sub={`Live reads of counts, scans, transfers and the gold ledger${branchName ? ` for ${branchName}` : ""}. Computed when you open the page.`}
        actions={
          <>
            <button type="button" onClick={() => void summary.refetch()} disabled={!branchId} className={heroGhost}>
              <RefreshCwIcon size={12} className={summary.isFetching ? "animate-spin" : undefined} /> Re-check
            </button>
            <Link href="/inventory/counts" className={heroGhost}>
              <ClipboardCheckIcon size={13} /> Counts
            </Link>
            <Link href="/inventory/transfers" className={heroGhost}>
              <TruckIcon size={13} /> Transfers
            </Link>
          </>
        }
        stats={[
          { label: "To review", value: openIssues, accent: true, sub: `${n(severe)} need action`, loading },
          { label: "Missing", value: val("missing"), tone: val("missing") ? "bad" : "good", sub: "Not found by a count", loading },
          { label: "Unexpected", value: val("unexpected"), tone: val("unexpected") ? "warn" : undefined, sub: "Wrong shelf scans", loading },
          { label: "Duplicates", value: val("duplicates"), sub: "Scan hygiene", loading },
          { label: "Unreceived", value: val("unreceived"), tone: val("unreceived") ? "warn" : undefined, sub: "Stuck in transit", loading },
          { label: "Transfer warnings", value: s ? s.transfers.length : null, tone: s?.transfers.length ? "warn" : undefined, sub: "Failed reconciliation", loading },
          {
            label: "Gold ledger",
            value: gold ? mgToG(Math.abs(gold.differenceMg)) : null,
            format: (x) => x.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
            unit: gold ? "g off" : undefined,
            text: s && !gold ? "No reading" : undefined,
            tone: gold ? (gold.passed ? "good" : "bad") : undefined,
            sub: gold ? (gold.passed ? "Agrees to the mg" : "Ledger and stock disagree") : "Ledger vs held stock",
            loading,
          },
        ]}
      >
        {branchRows.length > 1 ? (
          <div role="tablist" aria-label="Branch" className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-paper/40">Branch</span>
            {branchRows.map((b) => {
              const on = b.id === branchId;
              return (
                <button
                  key={b.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setBranchId(b.id)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium ring-1 ring-inset transition-colors",
                    on ? "bg-gold/[0.16] text-gold-light ring-gold/45" : "text-paper/60 ring-paper/15 hover:bg-paper/[0.06] hover:text-paper"
                  )}
                >
                  <Building2Icon size={11} />
                  {b.name}
                </button>
              );
            })}
          </div>
        ) : null}
      </GoldHero>

      {branches.isError ? (
        <Callout tone="danger" title="Could not load branches">
          {errMsg(branches.error)}
        </Callout>
      ) : null}
      {noBranches ? (
        <Card>
          <Empty icon={Building2Icon} title="No branches available" desc="You are not a member of any branch, so there is nothing to check." />
        </Card>
      ) : null}
      {summary.isError ? (
        <Card>
          <Empty
            icon={AlertCircleIcon}
            title="Could not load the summary"
            desc={errMsg(summary.error)}
            action={
              <button type="button" onClick={() => void summary.refetch()} className="g-btn g-btn-secondary h-8 rounded-lg px-3 text-[12px]">
                <RefreshCwIcon size={11} /> Retry
              </button>
            }
          />
        </Card>
      ) : null}

      {s && !s.hasData ? (
        <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-emerald-50 via-emerald-50/50 to-paper px-4 py-3 ring-1 ring-emerald-600/15">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-emerald-500 to-emerald-700 text-paper">
            <CheckCircleIcon size={15} />
          </span>
          <p className="min-w-0 text-[12.5px] text-ink-3">
            <span className="font-semibold text-ink">No open discrepancies for this branch.</span> Covers counts, scans, transfers in transit and the gold ledger; it is not a full audit.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
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
                className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-medium text-ink-3 ring-1 ring-inset ring-ink/20 transition-colors hover:bg-void hover:text-paper hover:ring-0 disabled:pointer-events-none disabled:opacity-50"
              >
                {downloading ? <span className="size-3 animate-spin rounded-full border-2 border-gold/30 border-t-gold" /> : <FileDownIcon size={12} className="text-gold-dark" />}
                {downloading ? "Preparing…" : "CSV"}
              </button>
            ) : null
          }
        />

        <div className="min-w-0 space-y-4">
          <GoldCard loading={loading} gold={gold} />

          <Card>
            <CardHead icon={ShieldIcon} title="Checks" sub={branchName || "Choose a branch"} />
            <ul className="divide-y divide-ink/[0.05]">
              {TAB_ORDER.map((k) => {
                const t = TABS[k];
                const v = val(k);
                const flagged = v !== null && v > 0 && t.severe;
                return (
                  <li key={k}>
                    <button
                      type="button"
                      onClick={() => {
                        setTab(k);
                        document.getElementById("discrepancy-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      className={cn("group flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-gold-pale/30", tab === k && "bg-gold-pale/40")}
                    >
                      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", flagged ? "bg-amber-500/10 text-amber-700" : v === 0 ? "bg-emerald-600/10 text-emerald-700" : "bg-ink/[0.05] text-ink-3")}>
                        <t.icon size={13} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium text-ink">{t.label}</span>
                        <span className="block truncate text-[10.5px] text-ink-4">{t.sub}</span>
                      </span>
                      <span className={cn("g-metric text-[15px]", flagged ? "text-amber-700" : v === 0 ? "text-emerald-700" : "text-ink")}>{loading ? "—" : v !== null ? n(v) : "—"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardHead
              icon={TruckIcon}
              title="Transfer warnings"
              sub="Open transfers whose reconciliation raised warnings"
              action={
                s?.transfers.length ? (
                  <span className="g-metric rounded-full bg-amber-500/10 px-2 py-px text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-500/25">{s.transfers.length}</span>
                ) : null
              }
            />
            {loading ? (
              <RowsSkeleton rows={2} />
            ) : !s || s.transfers.length === 0 ? (
              <p className="flex items-center gap-2 px-4 py-3 text-[12px] text-ink-4">
                <CheckCircleIcon size={13} className="text-emerald-600" /> Every open transfer reconciles.
              </p>
            ) : (
              <ul className="divide-y divide-ink/[0.05]">
                {s.transfers.map((t) => (
                  <li key={t.transferId}>
                    <Link href={`/inventory/transfers/${t.transferId}`} className="group block px-4 py-2 transition-colors hover:bg-gold-pale/30">
                      <span className="flex items-center justify-between gap-2">
                        <span className="g-metric text-[12.5px] font-semibold text-ink group-hover:text-gold-deep">{t.number}</span>
                        <ArrowRightIcon size={11} className="text-ink-5 transition-all group-hover:translate-x-0.5 group-hover:text-gold-dark" />
                      </span>
                      <ul className="mt-1 space-y-0.5">
                        {t.warnings.map((w, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-ink-3">
                            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-amber-500" aria-hidden />
                            {w}
                          </li>
                        ))}
                      </ul>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}

/* ---------------------------------------------------------------- Gold */

function GoldCard({ loading, gold }: { loading: boolean; gold: { passed: boolean; differenceMg: number } | undefined }) {
  const failed = gold && !gold.passed;
  return (
    <section aria-label="Gold consistency" className="relative overflow-hidden rounded-2xl bg-void p-4 text-paper shadow-5 ring-1 ring-gold/10">
      <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-40" aria-hidden />
      <div className={cn("pointer-events-none absolute -right-16 -top-20 size-48 rounded-full blur-[70px]", failed ? "bg-rose-500/25" : gold ? "bg-emerald-400/20" : "bg-gold/20")} aria-hidden />
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" aria-hidden />
      <div className="relative flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-gold-light to-gold-deep text-void">
          <ScaleIcon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-sans text-[13.5px] font-semibold tracking-normal text-paper">Gold consistency</h2>
          <p className="text-[11px] text-paper/45">Ledger vs held stock, exact mg</p>
        </div>
        {gold ? <HeroBadge tone={failed ? "bad" : "good"}>{failed ? "Mismatch" : "Passed"}</HeroBadge> : null}
      </div>
      <div className="relative mt-3">
        {loading ? (
          <Skeleton className="h-9 w-32 bg-paper/10" />
        ) : !gold ? (
          <p className="text-[12px] text-paper/50">No ledger reading for this branch yet.</p>
        ) : (
          <>
            <div className="flex items-baseline gap-1.5 whitespace-nowrap">
              {failed ? <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">Off by</span> : null}
              <span className={cn("g-metric text-[28px] leading-none", failed ? "text-rose-300" : "text-gold-light")}>{failed ? fmtG(gold.differenceMg) : "0.000"}</span>
              <span className="g-metric text-[13px] text-paper/50">g</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-paper/50">
              {failed ? "The ledger and the pieces held here disagree. Reconcile before the next count is approved." : "Ledger and held stock agree to the milligram."}
            </p>
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
    missing: "Pieces a stock count expected but could not find",
    unexpected: "Scans of pieces that were not expected on that shelf",
    duplicates: "The same piece scanned more than once in a count · scan hygiene, not movement",
    unreceived: data && "thresholdDays" in data ? `Transfer lines in transit ≥ ${data.thresholdDays} days` : "Transfer lines in transit too long",
  }[tab];
  const note = data && "note" in data && data.note ? data.note : null;

  let body: ReactNode;
  if (error) {
    body = (
      <Empty
        icon={AlertCircleIcon}
        title={`Could not load ${TABS[tab].label.toLowerCase()}`}
        desc={error}
        action={
          <button type="button" onClick={onRetry} className="g-btn g-btn-secondary h-8 rounded-lg px-3 text-[12px]">
            <RefreshCwIcon size={11} /> Retry
          </button>
        }
      />
    );
  } else if (loading || !data) {
    body = <RowsSkeleton rows={5} />;
  } else if (data.rows.length === 0) {
    body = (
      <div className="m-3 flex items-center gap-3 rounded-xl bg-gradient-to-r from-emerald-50 to-paper px-4 py-3.5 ring-1 ring-emerald-600/10">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-emerald-500 to-emerald-700 text-paper">
          <CheckCircleIcon size={15} />
        </span>
        <div>
          <p className="text-[13px] font-semibold text-ink">No {TABS[tab].label.toLowerCase()}</p>
          <p className="text-[11px] text-ink-4">This check found nothing for the selected branch.</p>
        </div>
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
    <div id="discrepancy-detail" className="min-w-0 scroll-mt-24">
      <Card>
        <CardHead icon={TABS[tab].icon} title={TABS[tab].label} sub={description} action={actions} />
        <div className="-mx-px overflow-x-auto border-b border-ink/20 px-4 py-2 scrollbar-thin">
          <FilterPills<TabKey>
            value={tab}
            onChange={onTab}
            items={TAB_ORDER.map((k) => {
              const c = counts?.[k];
              return { key: k, label: TABS[k].short, count: c ?? undefined, dot: c && TABS[k].severe ? "bg-amber-400" : undefined };
            })}
          />
        </div>
        {note ? (
          <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg bg-gold-pale/60 px-3 py-2 text-[11.5px] text-ink-3 ring-1 ring-gold-dark/15">
            <AlertCircleIcon size={12} className="mt-0.5 shrink-0 text-gold-deep" />
            {note}
          </div>
        ) : null}
        <div className="max-h-[36rem] overflow-auto scrollbar-thin">{body}</div>
        {data && data.rows.length > 0 ? (
          <div className="border-t border-ink/20 bg-bone/40 px-4 py-1.5 text-[11px] text-ink-4">
            <span className="g-metric font-semibold text-ink">{n(data.rows.length)}</span> {data.rows.length === 1 ? "row" : "rows"}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

const codeLink =
  "inline-flex items-center gap-1 rounded-md bg-bone px-1.5 py-px font-mono text-[10.5px] font-medium text-ink-3 ring-1 ring-ink/20 transition-colors hover:bg-void hover:text-gold-light hover:ring-transparent";

function AgeBadge({ days }: { days: number }) {
  const tone = days >= 14 ? "bg-rose-500/10 text-rose-800 ring-rose-500/25" : days >= 7 ? "bg-amber-500/10 text-amber-800 ring-amber-500/25" : "bg-ink/[0.04] text-ink-3 ring-ink/20";
  return (
    <span className={cn("g-metric inline-flex rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset", tone)}>
      {n(days)}d
    </span>
  );
}

function StatusTag({ tone, children }: { tone: "amber" | "rose" | "neutral"; children: ReactNode }) {
  const cls = {
    amber: ["bg-amber-500/10 text-amber-800 ring-amber-500/25", "bg-amber-400"],
    rose: ["bg-rose-500/10 text-rose-800 ring-rose-500/25", "bg-rose-500"],
    neutral: ["bg-ink/[0.04] text-ink-4 ring-ink/20", "bg-ink/30"],
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset", cls[0])}>
      <span className={cn("size-1.5 rounded-full", cls[1])} />
      {children}
    </span>
  );
}

function Head({ cols, right = [] }: { cols: string[]; right?: number[] }) {
  return (
    <thead className={cn(thead, "sticky top-0 z-10 backdrop-blur")}>
      <tr>
        {cols.map((c, i) => (
          <th key={c} className={cn(th, i === 0 && "pl-4", i === cols.length - 1 && "pr-4", right.includes(i) && "text-right")}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function MissingTable({ rows }: { rows: MissingRow[] }) {
  return (
    <table className="w-full text-[12.5px]">
      <caption className="sr-only">Missing pieces</caption>
      <Head cols={["Piece", "Barcode", "Count", "Open for", "Status"]} right={[3]} />
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.countId}:${r.productId}`} className={cn(tr, "group")}>
            <td className="py-1.5 pl-4 pr-2">
              <Link href={`/products/${r.productId}`} className="block max-w-[18rem] truncate font-medium text-ink group-hover:text-gold-deep">
                {r.productName || "Unnamed piece"}
              </Link>
            </td>
            <td className="px-2 py-1.5 font-mono text-[11px] text-ink-3">{r.barcode}</td>
            <td className="px-2 py-1.5">
              <Link href={`/inventory/counts/${r.countId}`} className={codeLink}>
                <ClipboardCheckIcon size={10} />
                {r.countId.slice(0, 8)}
              </Link>
            </td>
            <td className="px-2 py-1.5 text-right">
              <AgeBadge days={r.daysOpen} />
            </td>
            <td className="py-1.5 pl-2 pr-4">
              {r.status === "OPEN" ? <StatusTag tone="amber">Count open</StatusTag> : r.posted ? <StatusTag tone="rose">Written off</StatusTag> : <StatusTag tone="neutral">Not posted</StatusTag>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ScanTable({ rows }: { rows: ScanRow[] }) {
  return (
    <table className="w-full text-[12.5px]">
      <caption className="sr-only">Scans</caption>
      <Head cols={["Barcode", "Count", "Scanned", "Scanned by"]} />
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.countId}:${r.barcode}:${r.scannedAt}:${i}`} className={tr}>
            <td className="py-1.5 pl-4 pr-2">
              <span className="inline-flex items-center gap-1.5 font-mono text-[11.5px] font-medium text-ink">
                <ScanBarcodeIcon size={11} className="text-gold-dark" />
                {r.barcode}
              </span>
            </td>
            <td className="px-2 py-1.5">
              <Link href={`/inventory/counts/${r.countId}`} className={codeLink}>
                <ClipboardCheckIcon size={10} />
                {r.countId.slice(0, 8)}
              </Link>
            </td>
            <td className="whitespace-nowrap px-2 py-1.5 text-[11.5px] text-ink-3">{stamp(r.scannedAt)}</td>
            <td className="py-1.5 pl-2 pr-4">
              <span className="rounded bg-bone px-1.5 py-px font-mono text-[10.5px] text-ink-4 ring-1 ring-ink/20">{r.scannedBy}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UnreceivedTable({ rows }: { rows: UnreceivedRow[] }) {
  return (
    <table className="w-full text-[12.5px]">
      <caption className="sr-only">Unreceived transfer lines</caption>
      <Head cols={["Transfer", "Piece", "Route", "In transit"]} right={[3]} />
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.transferId}:${r.productId}`} className={tr}>
            <td className="py-1.5 pl-4 pr-2">
              <Link href={`/inventory/transfers/${r.transferId}`} className={codeLink}>
                <TruckIcon size={10} />
                {r.number}
              </Link>
            </td>
            <td className="px-2 py-1.5">
              <Link href={`/products/${r.productId}`} className={codeLink}>
                <ScanBarcodeIcon size={10} />
                {r.barcode}
              </Link>
            </td>
            <td className="px-2 py-1.5">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-ink-2">
                {r.fromBranchName || r.fromBranch.slice(0, 8)}
                <ArrowRightIcon size={10} className="text-gold-dark" />
                {r.toBranchName || r.toBranch.slice(0, 8)}
              </span>
            </td>
            <td className="py-1.5 pl-2 pr-4 text-right">
              <AgeBadge days={r.ageDays} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
