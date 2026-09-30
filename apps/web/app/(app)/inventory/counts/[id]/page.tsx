"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission, mgToG } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { normalizeCode } from "@/lib/barcode";
import { CameraScanButton } from "@/components/camera-scan";
import {
  Page,
  Hero,
  Panel,
  TableCard,
  Pill,
  StatGrid,
  StatCard,
  Tabs,
  Modal,
  Callout,
  EmptyBlock,
  Skeleton,
  Field,
  controlClass,
  heroBtnPrimary,
  heroBtnGhost,
  type PillTone,
} from "@/components/ui";
import {
  AlertCircleIcon,
  ArchiveIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ClipboardCheckIcon,
  EditIcon,
  HistoryIcon,
  ScanBarcodeIcon,
} from "@/components/icons";
import { cn } from "@/lib/cn";

type CountScope = "FULL" | "CATEGORY" | "BRANCH" | "LOCATION";
type CountStatus = "OPEN" | "COMPLETE" | "CANCELLED";
type ScanFlag = "OK" | "DUPLICATE" | "UNEXPECTED";

type CountLine = {
  productId: string;
  barcode: string;
  name: string | null;
  karat: string | null;
  net_mg: number | null;
  location: string | null;
  status: string | null;
  state: "MATCHED" | "MISSING" | "DUPLICATE";
  note: string | null;
  posted: boolean;
};

type ScanRow = {
  id: string;
  barcode: string;
  product_id: string | null;
  flag: ScanFlag;
  scanned_at: number;
  scanned_by_name: string | null;
};

type CountDetail = {
  count: {
    id: string;
    branch_id: string;
    branch_name: string | null;
    scope: CountScope;
    scope_ref: string | null;
    scope_label: string | null;
    status: CountStatus;
    opened_by: string | null;
    opened_by_name: string | null;
    closed_by: string | null;
    closed_by_name: string | null;
    created_at: number;
  };
  summary: { expected: number; matched: number; missing: number; unexpected: number; duplicates: number; posted: number };
  lines: CountLine[];
  unexpected: string[];
  scans: ScanRow[];
};

type TabKey = "missing" | "matched" | "unexpected" | "log";

const SCOPE_LABEL: Record<CountScope, string> = {
  FULL: "Whole branch",
  BRANCH: "Whole branch",
  CATEGORY: "Category",
  LOCATION: "Location",
};

const FLAG_META: Record<ScanFlag, { tone: PillTone; label: string }> = {
  OK: { tone: "success", label: "Counted" },
  DUPLICATE: { tone: "warning", label: "Duplicate" },
  UNEXPECTED: { tone: "danger", label: "Unexpected" },
};

const when = (ms: number) => new Date(ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
const time = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const grams = (mg: number | null) =>
  mg == null ? "-" : `${mgToG(mg).toLocaleString("en-US", { maximumFractionDigits: 3 })} g`;
const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

export default function StockCountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>("missing");
  const [dialog, setDialog] = useState<null | "approve" | "cancel">(null);
  const [noteFor, setNoteFor] = useState<CountLine | null>(null);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const perms = me.data?.permissions ?? [];
  const canEdit = hasPermission(perms, "products:edit");
  const canApprove = hasPermission(perms, "products:cancel");

  const detail = useQuery({
    queryKey: ["count", id],
    queryFn: () => api<CountDetail>(`/api/v1/counts/${id}`),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["count", id] });
    qc.invalidateQueries({ queryKey: ["counts"] });
  };

  if (detail.isLoading) {
    return (
      <Page>
        <Skeleton className="h-56" />
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </Page>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Page>
        <Callout tone="danger" title="Count not found">
          {detail.error instanceof Error ? detail.error.message : "This stock count could not be loaded."}{" "}
          <Link href="/inventory/counts" className="font-medium underline">
            Back to stock counts
          </Link>
        </Callout>
      </Page>
    );
  }

  const { count, summary, lines, unexpected, scans } = detail.data;
  const open = count.status === "OPEN";
  const scopeText =
    count.scope === "CATEGORY" || count.scope === "LOCATION"
      ? `${SCOPE_LABEL[count.scope]}: ${count.scope_label ?? count.scope_ref ?? "-"}`
      : SCOPE_LABEL[count.scope] ?? count.scope;

  const missing = lines.filter((l) => l.state === "MISSING");
  const matched = lines.filter((l) => l.state !== "MISSING");
  const unexpectedRows = buildUnexpected(unexpected, scans);
  const scanned = summary.expected - summary.missing;

  return (
    <Page>
      <Hero
        back={{ href: "/inventory/counts", label: "Stock counts" }}
        kicker="Stock count"
        title={`${count.branch_name ?? "Branch"} · ${scopeText}`}
        description={`Started ${when(count.created_at)} by ${count.opened_by_name ?? "unknown"}.`}
        meta={
          <>
            <Pill tone="ghost" className="!text-paper">{count.status}</Pill>
            <Pill tone="ghost" className="!text-paper">{count.branch_name ?? count.branch_id}</Pill>
            <Pill tone="ghost" className="!text-paper">{scopeText}</Pill>
            {!open && count.closed_by_name ? (
              <Pill tone="ghost" className="!text-paper">
                {count.status === "COMPLETE" ? "Approved" : "Cancelled"} by {count.closed_by_name}
              </Pill>
            ) : null}
          </>
        }
        actions={
          open ? (
            <>
              {canApprove ? (
                <button type="button" onClick={() => setDialog("approve")} className={heroBtnPrimary}>
                  <CheckCircleIcon size={14} /> Approve & post
                </button>
              ) : null}
              {canEdit ? (
                <button type="button" onClick={() => setDialog("cancel")} className={`${heroBtnGhost} !text-rose-300`}>
                  Cancel count
                </button>
              ) : null}
            </>
          ) : null
        }
      >
        {open && canEdit ? (
          <ScanStation countId={id} scans={scans} paused={dialog !== null || noteFor !== null} onScanned={refresh} />
        ) : null}
      </Hero>

      <StatGrid cols={5}>
        <StatCard label="Expected" value={summary.expected.toLocaleString("en-US")} sub={`${plural(scanned, "piece")} found`} />
        <StatCard label="Matched" value={summary.matched.toLocaleString("en-US")} tone={summary.matched > 0 ? "success" : "neutral"} />
        <StatCard
          label="Missing"
          value={summary.missing.toLocaleString("en-US")}
          tone={summary.missing > 0 ? "danger" : "neutral"}
          sub={!open && summary.posted > 0 ? `${plural(summary.posted, "piece")} written off` : undefined}
        />
        <StatCard label="Unexpected" value={summary.unexpected.toLocaleString("en-US")} tone={summary.unexpected > 0 ? "warning" : "neutral"} />
        <StatCard label="Duplicates" value={summary.duplicates.toLocaleString("en-US")} tone={summary.duplicates > 0 ? "warning" : "neutral"} />
      </StatGrid>

      {count.status === "COMPLETE" ? (
        <Callout tone="success" title="Count approved">
          Closed by {count.closed_by_name ?? "unknown"}.{" "}
          {summary.posted > 0
            ? `${plural(summary.posted, "missing piece")} ${summary.posted === 1 ? "was" : "were"} written off as LOST and posted to the gold ledger.`
            : "Nothing was written off."}
        </Callout>
      ) : null}
      {count.status === "CANCELLED" ? (
        <Callout tone="warning" title="Count cancelled">
          Cancelled by {count.closed_by_name ?? "unknown"}. The stock lock was released and nothing was posted.
        </Callout>
      ) : null}
      {open && !canEdit ? (
        <Callout tone="info" title="Read only">
          You can follow this count, but scanning needs the products:edit permission.
        </Callout>
      ) : null}

      <Tabs<TabKey>
        ariaLabel="Count results"
        value={tab}
        onChange={setTab}
        items={[
          { key: "missing", label: "Missing", count: missing.length, icon: <AlertCircleIcon size={14} /> },
          { key: "matched", label: "Matched", count: matched.length, icon: <CheckCircleIcon size={14} /> },
          { key: "unexpected", label: "Unexpected", count: unexpectedRows.length, icon: <ArchiveIcon size={14} /> },
          { key: "log", label: "Scan log", count: scans.length, icon: <HistoryIcon size={14} /> },
        ]}
      />

      {tab === "missing" ? (
        <TableCard
          title="Missing pieces"
          icon={<AlertCircleIcon size={17} />}
          description={
            open
              ? "Expected on the shelf but not scanned yet. Approving writes these off as LOST."
              : "Pieces that were not found when the count closed."
          }
        >
          {missing.length === 0 ? (
            <EmptyBlock
              icon={<CheckCircleIcon size={22} />}
              title={summary.expected === 0 ? "Nothing expected" : "Nothing missing"}
              description={
                summary.expected === 0
                  ? "No in-stock pieces matched this scope when the count started."
                  : "Every expected piece has been scanned."
              }
            />
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>Barcode</th>
                  <th>Piece</th>
                  <th>Karat</th>
                  <th className="!text-right">Net</th>
                  <th>Location</th>
                  <th>Note</th>
                  <th>{open ? <span className="sr-only">Actions</span> : "Outcome"}</th>
                </tr>
              </thead>
              <tbody>
                {missing.map((l) => (
                  <tr key={l.productId}>
                    <td className="font-mono text-xs">{l.barcode}</td>
                    <td>
                      <ProductLink line={l} />
                    </td>
                    <td>{l.karat ?? "-"}</td>
                    <td className="num num-tabular">{grams(l.net_mg)}</td>
                    <td>{l.location ?? "-"}</td>
                    <td className="max-w-xs">
                      {l.note ? <span className="text-sm text-ink-2 text-pretty">{l.note}</span> : <span className="text-ink-5">-</span>}
                    </td>
                    <td className="!text-right">
                      {open ? (
                        canEdit ? (
                          <button
                            type="button"
                            onClick={() => setNoteFor(l)}
                            className="g-btn g-btn-secondary h-8 px-3 text-xs"
                            aria-label={`${l.note ? "Edit" : "Add"} note for ${l.barcode}`}
                          >
                            <EditIcon size={12} /> {l.note ? "Edit note" : "Add note"}
                          </button>
                        ) : null
                      ) : l.posted ? (
                        <Pill tone="danger" dot>Written off</Pill>
                      ) : (
                        <Pill tone="neutral">Not posted</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : null}

      {tab === "matched" ? (
        <TableCard title="Matched pieces" icon={<CheckCircleIcon size={17} />} description="Expected pieces that were scanned">
          {matched.length === 0 ? (
            <EmptyBlock icon={<ScanBarcodeIcon size={22} />} title="Nothing matched yet" description="Scanned pieces from the expected list appear here." />
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>Barcode</th>
                  <th>Piece</th>
                  <th>Karat</th>
                  <th className="!text-right">Net</th>
                  <th>Location</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {matched.map((l) => (
                  <tr key={l.productId}>
                    <td className="font-mono text-xs">{l.barcode}</td>
                    <td>
                      <ProductLink line={l} />
                    </td>
                    <td>{l.karat ?? "-"}</td>
                    <td className="num num-tabular">{grams(l.net_mg)}</td>
                    <td>{l.location ?? "-"}</td>
                    <td>
                      {l.state === "DUPLICATE" ? (
                        <Pill tone="warning" dot title="Scanned more than once">Scanned twice</Pill>
                      ) : (
                        <Pill tone="success" dot>Matched</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : null}

      {tab === "unexpected" ? (
        <TableCard
          title="Unexpected barcodes"
          icon={<ArchiveIcon size={17} />}
          description="Scanned here but not on the expected list: another branch, another shelf, already sold, or unknown."
        >
          {unexpectedRows.length === 0 ? (
            <EmptyBlock icon={<CheckCircleIcon size={22} />} title="No unexpected scans" description="Every scanned barcode belonged to this count." />
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>Barcode</th>
                  <th>Product</th>
                  <th>Last scanned</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {unexpectedRows.map((u) => (
                  <tr key={u.barcode}>
                    <td className="font-mono text-xs">{u.barcode}</td>
                    <td>
                      {u.productId ? (
                        <Link href={`/products/${u.productId}`} className="inline-flex items-center gap-1 font-medium text-ink hover:text-gold-dark">
                          Open product <ArrowRightIcon size={12} />
                        </Link>
                      ) : (
                        <Pill tone="neutral">Not in catalog</Pill>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-ink-3">{u.scannedAt ? when(u.scannedAt) : "-"}</td>
                    <td>{u.by ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : null}

      {tab === "log" ? (
        <TableCard title="Scan log" icon={<HistoryIcon size={17} />} description="Latest 200 scans, newest first">
          {scans.length === 0 ? (
            <EmptyBlock icon={<ScanBarcodeIcon size={22} />} title="No scans yet" description="Every scan is recorded here with who scanned it." />
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Barcode</th>
                  <th>Result</th>
                  <th>Scanned by</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap text-ink-3">{when(s.scanned_at)}</td>
                    <td className="font-mono text-xs">
                      {s.product_id ? (
                        <Link href={`/products/${s.product_id}`} className="hover:text-gold-dark">
                          {s.barcode}
                        </Link>
                      ) : (
                        s.barcode
                      )}
                    </td>
                    <td>
                      <FlagPill flag={s.flag} />
                    </td>
                    <td>{s.scanned_by_name ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : null}

      {dialog === "approve" ? (
        <ApproveDialog
          countId={id}
          missing={summary.missing}
          expected={summary.expected}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            refresh();
          }}
        />
      ) : null}
      {dialog === "cancel" ? (
        <CancelDialog
          countId={id}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            refresh();
          }}
        />
      ) : null}
      {noteFor ? (
        <NoteDialog
          countId={id}
          line={noteFor}
          onClose={() => setNoteFor(null)}
          onDone={() => {
            setNoteFor(null);
            refresh();
          }}
        />
      ) : null}
    </Page>
  );
}

/* ---------------------------------------------------------------- helpers */

function buildUnexpected(barcodes: string[], scans: ScanRow[]) {
  const map = new Map<string, { barcode: string; productId: string | null; scannedAt: number | null; by: string | null }>();
  for (const b of barcodes) map.set(b, { barcode: b, productId: null, scannedAt: null, by: null });
  // scans are newest first, so the first hit per barcode is the latest one.
  for (const s of scans) {
    if (s.flag !== "UNEXPECTED") continue;
    const cur = map.get(s.barcode);
    if (!cur) map.set(s.barcode, { barcode: s.barcode, productId: s.product_id, scannedAt: s.scanned_at, by: s.scanned_by_name });
    else if (cur.scannedAt === null)
      map.set(s.barcode, { ...cur, productId: s.product_id, scannedAt: s.scanned_at, by: s.scanned_by_name });
  }
  return [...map.values()];
}

function ProductLink({ line }: { line: CountLine }) {
  return (
    <Link href={`/products/${line.productId}`} className="font-medium text-ink transition-colors hover:text-gold-dark">
      {line.name ?? line.barcode}
    </Link>
  );
}

function FlagPill({ flag }: { flag: ScanFlag }) {
  const m = FLAG_META[flag] ?? { tone: "neutral" as PillTone, label: flag };
  return (
    <Pill tone={m.tone} dot>
      {m.label}
    </Pill>
  );
}

/* ---------------------------------------------------------------- scan station */

type LastResult = { flag: ScanFlag | "ERROR"; barcode: string; message: string };

function ScanStation({
  countId,
  scans,
  paused,
  onScanned,
}: {
  countId: string;
  scans: ScanRow[];
  /** A modal is open: don't steal focus from it. */
  paused: boolean;
  onScanned: () => void;
}) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(0);
  const [last, setLast] = useState<LastResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Return focus to the scanner whenever a dialog closes.
  useEffect(() => {
    if (!paused) inputRef.current?.focus();
  }, [paused]);

  async function submit(raw: string) {
    const code = normalizeCode(raw);
    setValue("");
    inputRef.current?.focus();
    if (!code) return;
    setPending((n) => n + 1);
    try {
      const res = await api<{ flag: ScanFlag; productId: string | null; barcode: string }>(`/api/v1/counts/${countId}/scans`, {
        method: "POST",
        body: JSON.stringify({ barcode: code }),
      });
      if (res.flag === "OK") {
        setLast({ flag: "OK", barcode: res.barcode, message: "Counted" });
        toast.success(`${res.barcode} counted`);
      } else if (res.flag === "DUPLICATE") {
        setLast({ flag: "DUPLICATE", barcode: res.barcode, message: "Already counted" });
        toast.warning(`${res.barcode} was already counted`);
      } else {
        setLast({ flag: "UNEXPECTED", barcode: res.barcode, message: "Not expected on this shelf" });
        toast.error(`${res.barcode} is not expected on this shelf`);
      }
      onScanned();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Scan failed";
      setLast({ flag: "ERROR", barcode: code, message });
      toast.error(message);
    } finally {
      setPending((n) => n - 1);
      if (!paused) inputRef.current?.focus();
    }
  }

  const lastCls =
    last?.flag === "OK"
      ? "bg-emerald-500/15 text-emerald-200 ring-emerald-400/30"
      : last?.flag === "DUPLICATE"
        ? "bg-amber-500/15 text-amber-200 ring-amber-400/30"
        : "bg-rose-500/15 text-rose-200 ring-rose-400/30";

  return (
    <div className="relative mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) void submit(value);
          }}
          className="flex w-full flex-col gap-3 sm:flex-row"
        >
          <div className="relative w-full">
            <label htmlFor="count-scan" className="sr-only">
              Scan barcode
            </label>
            <ScanBarcodeIcon
              size={18}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold-dark"
            />
            <input
              id="count-scan"
              ref={inputRef}
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Scan or type barcode, then Enter…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="send"
              className="h-12 w-full rounded-lg bg-paper pl-11 pr-4 font-mono text-base text-ink shadow-[inset_0_0_0_1.5px_rgba(201,162,39,0.6)] transition-shadow placeholder:font-sans placeholder:text-ink-5 focus:outline-none focus:shadow-[inset_0_0_0_1.5px_var(--gold,#C9A227),0_0_0_4px_rgba(201,162,39,0.25)]"
            />
          </div>
          <CameraScanButton onDetected={(c) => void submit(c)} className="h-12" tone="dark" />
          <button
            type="submit"
            className="g-btn h-12 bg-gold px-5 text-sm text-ink transition-colors hover:bg-gold-light"
          >
            Record
            <ArrowRightIcon size={14} className="g-btn-arrow" />
          </button>
        </form>
        <div aria-live="polite" className="mt-3 min-h-10">
          {last ? (
            <div className={cn("flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-sm ring-1", lastCls)}>
              <span className="flex min-w-0 items-center gap-2">
                {last.flag === "OK" ? <CheckCircleIcon size={15} /> : <AlertCircleIcon size={15} />}
                <span className="truncate font-mono">{last.barcode}</span>
              </span>
              <span className="shrink-0 font-medium">{last.message}</span>
            </div>
          ) : (
            <p className="text-xs text-paper/50">
              USB and Bluetooth scanners work here: each scan is recorded on Enter and the box clears for the next one.
            </p>
          )}
          {pending > 0 ? <p className="mt-1.5 text-[11px] text-paper/40">Recording…</p> : null}
        </div>
      </div>
      <div className="rounded-xl bg-paper/[0.04] p-3 ring-1 ring-paper/[0.08]">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">
          <ClipboardCheckIcon size={12} /> Last scans
        </div>
        {scans.length === 0 ? (
          <p className="py-3 text-xs text-paper/50">No scans yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {scans.slice(0, 6).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-mono text-paper/85">{s.barcode}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-paper/40 num-tabular">{time(s.scanned_at)}</span>
                  <FlagPill flag={s.flag} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- dialogs */

function ApproveDialog({
  countId,
  missing,
  expected,
  onClose,
  onDone,
}: {
  countId: string;
  missing: number;
  expected: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [pending, setPending] = useState(false);
  const approvers = useQuery({
    queryKey: ["count-approvers", countId],
    queryFn: () => api<{ id: string; name: string }[]>(`/api/v1/counts/${countId}/approvers`),
  });
  const list = approvers.data ?? [];

  async function save() {
    setPending(true);
    try {
      const res = await api<{ posted: number }>(`/api/v1/counts/${countId}/approve`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim(), approvedBy }),
      });
      toast.success(res.posted > 0 ? `Count approved: ${plural(res.posted, "piece")} written off as LOST` : "Count approved, nothing written off");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      kicker="Stock count"
      title="Approve & post"
      danger={missing > 0}
      onClose={onClose}
      onSubmit={save}
      pending={pending}
      submitDisabled={!reason.trim() || !approvedBy}
      submitLabel={missing > 0 ? `Write off ${plural(missing, "piece")}` : "Approve & close"}
    >
      {missing > 0 ? (
        <Callout tone="danger" title={`${plural(missing, "piece")} will be written off as LOST`}>
          Every piece still missing ({missing} of {expected}) is marked LOST, removed from stock and posted to the gold
          ledger and accounts in one step. This cannot be undone. Scan anything you can still find first.
        </Callout>
      ) : (
        <Callout tone="success" title="Nothing is missing">
          Approving closes the count and releases the stock lock. No pieces will be written off.
        </Callout>
      )}
      <Field
        label="Second approver"
        htmlFor="approve-by"
        hint={
          approvers.isSuccess && list.length === 0
            ? undefined
            : "Another user with gold:manage who is not you and did not open this count."
        }
      >
        <select
          id="approve-by"
          value={approvedBy}
          onChange={(e) => setApprovedBy(e.target.value)}
          className={`w-full ${controlClass}`}
          disabled={approvers.isLoading || list.length === 0}
        >
          <option value="">{approvers.isLoading ? "Loading…" : list.length === 0 ? "No eligible approvers" : "Select approver…"}</option>
          {list.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </Field>
      {approvers.isSuccess && list.length === 0 ? (
        <Callout tone="warning" title="No eligible approver">
          A count must be approved by a second person. Ask an administrator to give another user the gold:manage
          permission (someone other than you and the person who opened this count).
        </Callout>
      ) : null}
      {approvers.isError ? (
        <Callout tone="danger" title="Could not load approvers">
          {approvers.error instanceof Error ? approvers.error.message : "Please try again."}
        </Callout>
      ) : null}
      <Field label="Reason" htmlFor="approve-reason" hint={`${reason.length}/500`}>
        <textarea
          id="approve-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="e.g. Monthly showcase count, missing pieces investigated"
          className={`h-auto w-full py-2 ${controlClass}`}
        />
      </Field>
    </Modal>
  );
}

function CancelDialog({ countId, onClose, onDone }: { countId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  async function save() {
    setPending(true);
    try {
      await api(`/api/v1/counts/${countId}/cancel`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
      toast.success("Count cancelled, stock unlocked");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal
      kicker="Stock count"
      title="Cancel count"
      danger
      onClose={onClose}
      onSubmit={save}
      pending={pending}
      submitDisabled={!reason.trim()}
      submitLabel="Cancel count"
    >
      <p className="text-sm text-ink-3">
        The pieces are unlocked for sale and transfer again. Nothing is written off and the scans are kept for the record.
      </p>
      <Field label="Reason" htmlFor="cancel-reason">
        <textarea
          id="cancel-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={3}
          className={`h-auto w-full py-2 ${controlClass}`}
        />
      </Field>
    </Modal>
  );
}

function NoteDialog({
  countId,
  line,
  onClose,
  onDone,
}: {
  countId: string;
  line: CountLine;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState(line.note ?? "");
  const [pending, setPending] = useState(false);
  async function save() {
    setPending(true);
    try {
      await api(`/api/v1/counts/${countId}/notes`, {
        method: "POST",
        body: JSON.stringify({ productId: line.productId, note: note.trim() }),
      });
      toast.success("Note saved");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save note");
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal
      kicker="Investigation"
      title={`Note for ${line.barcode}`}
      onClose={onClose}
      onSubmit={save}
      pending={pending}
      submitDisabled={!note.trim()}
      submitLabel="Save note"
    >
      <Panel title={line.name ?? line.barcode} description={`${line.karat ?? "-"} · ${grams(line.net_mg)} · ${line.location ?? "no location"}`}>
        <Field label="What happened to this piece?" htmlFor="line-note" hint={`${note.length}/500`}>
          <textarea
            id="line-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={4}
            autoFocus
            placeholder="e.g. Sent for repair on 12 Sep, receipt R-1042"
            className={`h-auto w-full py-2 ${controlClass}`}
          />
        </Field>
      </Panel>
    </Modal>
  );
}
