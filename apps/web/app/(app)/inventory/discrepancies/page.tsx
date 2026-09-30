"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission, mgToG } from "@goldos/shared";
import { api, downloadCsv, type MeData } from "@/lib/api";
import {
  Callout,
  controlClass,
  EmptyBlock,
  Hero,
  Page,
  Panel,
  Pill,
  StatCard,
  StatGrid,
  TableCard,
  TableSkeleton,
  Tabs,
} from "@/components/ui";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ClipboardCheckIcon,
  FileDownIcon,
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

const linkCls = "font-medium text-ink underline-offset-2 transition-colors hover:text-gold-dark hover:underline";

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "branch";
}

const TAB_LABEL: Record<TabKey, string> = {
  missing: "Missing",
  unexpected: "Unexpected",
  duplicates: "Duplicates",
  unreceived: "Unreceived",
};

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

  const csvButton = canExport ? (
    <button
      type="button"
      onClick={() => void exportCsv(tab)}
      disabled={downloading || !branchId}
      className="g-btn g-btn-secondary h-9 gap-1.5 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
    >
      <FileDownIcon size={14} />
      {downloading ? "Preparing…" : "Download CSV"}
    </button>
  ) : null;

  const noBranches = branches.isSuccess && branchRows.length === 0;

  return (
    <Page className="space-y-5">
      <Hero
        back={{ href: "/inventory", label: "Inventory" }}
        kicker="Inventory"
        title="Discrepancies"
        description="Live reads of stock counts, scans, transfers and the gold ledger for one branch. Every figure is computed when you open the page, not a frozen statement."
        actions={
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className={controlClass}
            aria-label="Branch"
            disabled={branchRows.length === 0}
          >
            {branchRows.length === 0 ? <option value="">No branches</option> : null}
            {branchRows.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        }
        meta={
          branchName ? (
            <Pill tone="ghost" dot>
              {branchName}
            </Pill>
          ) : null
        }
      />

      {branches.isError ? (
        <Callout tone="danger" title="Could not load branches">
          {errMsg(branches.error)}
        </Callout>
      ) : null}

      {noBranches ? (
        <EmptyBlock
          title="No branches available"
          description="You are not a member of any branch, so there is nothing to check."
        />
      ) : null}

      {/* ------------------------------------------------ Summary */}
      {summary.isError ? (
        <Callout tone="danger" title="Could not load the summary">
          {errMsg(summary.error)}
        </Callout>
      ) : (
        <StatGrid cols={5}>
          <StatCard
            label="Missing pieces"
            value={s ? n(s.missing) : "-"}
            icon={<SearchIcon size={16} />}
            tone={s && s.missing > 0 ? "warning" : "neutral"}
            sub="Not found by a stock count"
            loading={summary.isLoading || !branchId}
          />
          <StatCard
            label="Unexpected scans"
            value={s ? n(s.unexpected) : "-"}
            icon={<ScanBarcodeIcon size={16} />}
            tone={s && s.unexpected > 0 ? "warning" : "neutral"}
            sub="Scanned where not expected"
            loading={summary.isLoading || !branchId}
          />
          <StatCard
            label="Duplicate scans"
            value={s ? n(s.duplicates) : "-"}
            icon={<ClipboardCheckIcon size={16} />}
            sub="Same piece scanned twice"
            loading={summary.isLoading || !branchId}
          />
          <StatCard
            label="Unreceived transfers"
            value={s ? n(s.unreceived) : "-"}
            icon={<TruckIcon size={16} />}
            tone={s && s.unreceived > 0 ? "warning" : "neutral"}
            sub="Lines stuck in transit"
            loading={summary.isLoading || !branchId}
          />
          <StatCard
            label="Gold consistency"
            value={!gold ? "-" : gold.passed ? "Passed" : `Off by ${fmtG(gold.differenceMg)} g`}
            icon={<ScaleIcon size={16} />}
            tone={!gold ? "neutral" : gold.passed ? "success" : "danger"}
            sub="Ledger vs held stock, exact mg"
            loading={summary.isLoading || !branchId}
          />
        </StatGrid>
      )}

      {s && !s.hasData ? (
        <Callout tone="success" title="No open discrepancies for this branch">
          Nothing was found by these checks right now. That covers counts, scans, transfers in
          transit and the gold ledger only; it is not a full audit of the branch.
        </Callout>
      ) : null}

      {/* ------------------------------------------------ Transfer warnings */}
      {s && s.transfers.length > 0 ? (
        <Panel
          title="Transfer warnings"
          description="Open transfers whose reconciliation raised warnings."
          icon={<AlertCircleIcon size={16} />}
        >
          <ul className="divide-y divide-ink/[0.06]">
            {s.transfers.map((t) => (
              <li key={t.transferId} className="py-3 first:pt-0 last:pb-0">
                <Link href={`/inventory/transfers/${t.transferId}`} className={`${linkCls} font-mono text-sm`}>
                  {t.number}
                </Link>
                <ul className="mt-1.5 space-y-1">
                  {t.warnings.map((w, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-ink-3">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-600" aria-hidden />
                      {w}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {/* ------------------------------------------------ Tabs */}
      <Tabs
        ariaLabel="Discrepancy type"
        value={tab}
        onChange={setTab}
        items={[
          { key: "missing" as const, label: "Missing", count: s ? s.missing : null, icon: <SearchIcon size={15} /> },
          { key: "unexpected" as const, label: "Unexpected", count: s ? s.unexpected : null, icon: <ScanBarcodeIcon size={15} /> },
          { key: "duplicates" as const, label: "Duplicates", count: s ? s.duplicates : null, icon: <ClipboardCheckIcon size={15} /> },
          { key: "unreceived" as const, label: "Unreceived", count: s ? s.unreceived : null, icon: <TruckIcon size={15} /> },
        ]}
      />

      <TabBody
        tab={tab}
        loading={detail.isLoading || !branchId}
        error={detail.isError ? errMsg(detail.error) : undefined}
        data={detail.data}
        actions={csvButton}
      />
    </Page>
  );
}

/* ---------------------------------------------------------------- Tab body */

function TabBody({
  tab,
  loading,
  error,
  data,
  actions,
}: {
  tab: TabKey;
  loading: boolean;
  error: string | undefined;
  data: TabData[TabKey] | undefined;
  actions: ReactNode;
}) {
  const meta = {
    missing: {
      description: "Pieces a stock count expected but could not find.",
      icon: <SearchIcon size={16} />,
    },
    unexpected: {
      description: "Scans of pieces that were not expected on that shelf.",
      icon: <ScanBarcodeIcon size={16} />,
    },
    duplicates: {
      description: "The same piece scanned more than once in a count. Scan hygiene, not stock movement.",
      icon: <ClipboardCheckIcon size={16} />,
    },
    unreceived: {
      description:
        data && "thresholdDays" in data
          ? `Transfer lines in transit ≥ ${data.thresholdDays} days.`
          : "Transfer lines that have been in transit too long.",
      icon: <TruckIcon size={16} />,
    },
  }[tab];

  const note = data && "note" in data && data.note ? data.note : null;

  let body: ReactNode;
  if (error) {
    body = (
      <div className="px-5 pb-5 sm:px-6">
        <Callout tone="danger" title={`Could not load ${TAB_LABEL[tab].toLowerCase()} rows`}>
          {error}
        </Callout>
      </div>
    );
  } else if (loading || !data) {
    body = <TableSkeleton rows={5} cols={5} />;
  } else if (data.rows.length === 0) {
    body = (
      <EmptyBlock
        icon={<CheckCircleIcon size={22} />}
        title={`No ${TAB_LABEL[tab].toLowerCase()} rows`}
        description="This check found nothing for the selected branch."
      />
    );
  } else if (tab === "missing") {
    body = <MissingTable rows={(data as TabData["missing"]).rows} />;
  } else if (tab === "unreceived") {
    body = <UnreceivedTable rows={(data as TabData["unreceived"]).rows} />;
  } else {
    body = <ScanTable rows={(data as TabData["unexpected"]).rows} />;
  }

  return (
    <TableCard
      title={TAB_LABEL[tab]}
      description={meta.description}
      icon={meta.icon}
      actions={actions}
      toolbar={note ? <p className="text-xs text-ink-4">{note}</p> : undefined}
    >
      {body}
    </TableCard>
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
          <th className="!text-right">Days open</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.countId}:${r.productId}`}>
            <td>
              <Link href={`/products/${r.productId}`} className={`${linkCls} block truncate`}>
                {r.productName || "Unnamed piece"}
              </Link>
              <span className="block font-mono text-[11px] text-ink-4">{r.barcode}</span>
            </td>
            <td>
              <Link href={`/inventory/counts/${r.countId}`} className={`${linkCls} font-mono text-xs`}>
                {r.countId.slice(0, 8)}
              </Link>
            </td>
            <td className="num">{n(r.daysOpen)}</td>
            <td>
              {r.status === "OPEN" ? (
                <Pill tone="warning" dot>
                  Count open
                </Pill>
              ) : r.posted ? (
                <Pill tone="danger" dot>
                  Written off
                </Pill>
              ) : (
                <Pill tone="neutral" dot>
                  Not posted
                </Pill>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
            <td className="font-mono text-xs">{r.barcode}</td>
            <td>
              <Link href={`/inventory/counts/${r.countId}`} className={`${linkCls} font-mono text-xs`}>
                {r.countId.slice(0, 8)}
              </Link>
            </td>
            <td className="text-sm text-ink-3">{new Date(r.scannedAt).toLocaleString()}</td>
            <td className="font-mono text-[11px] text-ink-4">{r.scannedBy}</td>
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
              <Link href={`/inventory/transfers/${r.transferId}`} className={`${linkCls} font-mono text-xs`}>
                {r.number}
              </Link>
            </td>
            <td>
              <Link href={`/products/${r.productId}`} className={`${linkCls} font-mono text-xs`}>
                {r.barcode}
              </Link>
            </td>
            <td className="text-sm text-ink-3">
              {r.fromBranchName || r.fromBranch.slice(0, 8)} → {r.toBranchName || r.toBranch.slice(0, 8)}
            </td>
            <td className="num">
              {n(r.ageDays)} {r.ageDays === 1 ? "day" : "days"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
