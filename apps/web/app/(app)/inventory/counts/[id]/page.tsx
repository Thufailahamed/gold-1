"use client";

import { use, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission, mgToG } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { normalizeCode } from "@/lib/barcode";
import { CameraScanButton } from "@/components/camera-scan";
import {
  Page,
  Panel,
  Pill,
  Modal,
  Callout,
  Skeleton,
  Field,
  controlClass,
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
import { Card, CardHead, Empty, FilterPills, GoldHero, HeroBadge, MiniStats, ShareBar, ago, heroGhost, heroGold, th, thead, tr } from "../../kit";

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
const td = "px-2 py-1.5";

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
      <Page className="space-y-4">
        <Skeleton className="h-44 rounded-[20px]" />
        <Skeleton className="h-72 rounded-2xl" />
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
  const progress = summary.expected > 0 ? scanned / summary.expected : 0;
  const expectedMg = lines.reduce((s, l) => s + (l.net_mg ?? 0), 0);
  const missingMg = missing.reduce((s, l) => s + (l.net_mg ?? 0), 0);
  const noted = missing.filter((l) => l.note).length;

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={ClipboardCheckIcon}
        title="Count ·"
        accent={count.branch_name ?? "Branch"}
        back={{ href: "/inventory/counts", label: "Stock counts" }}
        badge={
          open ? (
            <HeroBadge tone="warn">Open · scanning</HeroBadge>
          ) : count.status === "COMPLETE" ? (
            <HeroBadge tone="good">Posted</HeroBadge>
          ) : (
            <HeroBadge tone="muted">Cancelled</HeroBadge>
          )
        }
        sub={
          <>
            {scopeText} · started {when(count.created_at)} by {count.opened_by_name ?? "unknown"}
            {!open && count.closed_by_name ? ` · ${count.status === "COMPLETE" ? "posted" : "cancelled"} by ${count.closed_by_name}` : ""}
          </>
        }
        actions={
          open ? (
            <>
              {canApprove ? (
                <button type="button" onClick={() => setDialog("approve")} className={heroGold}>
                  <CheckCircleIcon size={13} /> Post count
                </button>
              ) : null}
              {canEdit ? (
                <button type="button" onClick={() => setDialog("cancel")} className={`${heroGhost} !text-rose-300`}>
                  Cancel count
                </button>
              ) : null}
            </>
          ) : null
        }
        stats={[
          { label: "Expected", value: summary.expected, sub: grams(expectedMg) },
          { label: "Found", value: scanned, accent: true, sub: `${Math.round(progress * 100)}% of the list` },
          { label: "Matched", value: summary.matched, tone: summary.matched ? "good" : undefined, sub: "Scanned once" },
          { label: "Missing", value: summary.missing, tone: summary.missing ? "bad" : undefined, sub: summary.missing ? grams(missingMg) : "Nothing missing" },
          { label: "Unexpected", value: summary.unexpected, tone: summary.unexpected ? "warn" : undefined, sub: "Not on the list" },
          { label: "Duplicates", value: summary.duplicates, tone: summary.duplicates ? "warn" : undefined, sub: "Scanned twice" },
          open
            ? { label: "Scans", value: scans.length, sub: scans[0] ? `Last ${ago(scans[0].scanned_at)}` : "None yet" }
            : { label: "Written off", value: summary.posted, tone: summary.posted ? "bad" : undefined, sub: "Posted as LOST" },
        ]}
      >
        <div className="flex items-center gap-3">
          <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-paper/10">
            <span
              className={cn(
                "block h-full rounded-full transition-[width] duration-700 ease-brand",
                progress >= 1 ? "bg-gradient-to-r from-emerald-500 to-emerald-300" : "bg-gradient-to-r from-gold-dark to-gold-light"
              )}
              style={{ width: `${Math.min(progress, 1) * 100}%` }}
            />
          </span>
          <span className="g-metric shrink-0 text-[11px] text-paper/55">
            {scanned.toLocaleString("en-US")} / {summary.expected.toLocaleString("en-US")}
          </span>
        </div>
        {open && canEdit ? <ScanStation countId={id} scans={scans} paused={dialog !== null || noteFor !== null} onScanned={refresh} /> : null}
      </GoldHero>

      {count.status === "COMPLETE" ? (
        <Callout tone="success" title="Count posted">
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <CardHead
            icon={tab === "missing" ? AlertCircleIcon : tab === "matched" ? CheckCircleIcon : tab === "unexpected" ? ArchiveIcon : HistoryIcon}
            title={TAB_TITLE[tab]}
            sub={TAB_SUB[tab](open)}
            action={
              <FilterPills<TabKey>
                value={tab}
                onChange={setTab}
                items={[
                  { key: "missing", label: "Missing", count: missing.length, dot: missing.length ? "bg-rose-500" : undefined },
                  { key: "matched", label: "Matched", count: matched.length },
                  { key: "unexpected", label: "Unexpected", count: unexpectedRows.length, dot: unexpectedRows.length ? "bg-amber-400" : undefined },
                  { key: "log", label: "Scan log", count: scans.length },
                ]}
              />
            }
          />

          {tab === "missing" ? (
            missing.length === 0 ? (
              <Empty
                icon={CheckCircleIcon}
                title={summary.expected === 0 ? "Nothing expected" : "Nothing missing"}
                desc={summary.expected === 0 ? "No in-stock pieces matched this scope when the count started." : "Every expected piece has been scanned."}
              />
            ) : (
              <Table head={["Barcode", "Piece", "Karat", "Net", "Location", "Note", open ? "" : "Outcome"]} right={[3, 6]}>
                {missing.map((l) => (
                  <tr key={l.productId} className={tr}>
                    <td className={cn(td, "pl-4 font-mono text-[11px] text-ink-2")}>{l.barcode}</td>
                    <td className={td}>
                      <ProductLink line={l} />
                    </td>
                    <td className={td}>
                      <KaratTag k={l.karat} />
                    </td>
                    <td className={cn(td, "g-metric text-right")}>{grams(l.net_mg)}</td>
                    <td className={cn(td, "text-ink-3")}>{l.location ?? "-"}</td>
                    <td className={cn(td, "max-w-[16rem]")}>
                      {l.note ? <span className="line-clamp-1 text-[11.5px] text-ink-2" title={l.note}>{l.note}</span> : <span className="text-ink-5">-</span>}
                    </td>
                    <td className={cn(td, "pr-4 text-right")}>
                      {open ? (
                        canEdit ? (
                          <button
                            type="button"
                            onClick={() => setNoteFor(l)}
                            className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-ink-3 ring-1 ring-inset ring-ink/10 hover:bg-void hover:text-paper hover:ring-0"
                            aria-label={`${l.note ? "Edit" : "Add"} note for ${l.barcode}`}
                          >
                            <EditIcon size={10} /> {l.note ? "Edit" : "Note"}
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
              </Table>
            )
          ) : null}

          {tab === "matched" ? (
            matched.length === 0 ? (
              <Empty icon={ScanBarcodeIcon} title="Nothing matched yet" desc="Scanned pieces from the expected list appear here." />
            ) : (
              <Table head={["Barcode", "Piece", "Karat", "Net", "Location", "State"]} right={[3]}>
                {matched.map((l) => (
                  <tr key={l.productId} className={tr}>
                    <td className={cn(td, "pl-4 font-mono text-[11px] text-ink-2")}>{l.barcode}</td>
                    <td className={td}>
                      <ProductLink line={l} />
                    </td>
                    <td className={td}>
                      <KaratTag k={l.karat} />
                    </td>
                    <td className={cn(td, "g-metric text-right")}>{grams(l.net_mg)}</td>
                    <td className={cn(td, "text-ink-3")}>{l.location ?? "-"}</td>
                    <td className={cn(td, "pr-4")}>
                      {l.state === "DUPLICATE" ? (
                        <Pill tone="warning" dot title="Scanned more than once">Scanned twice</Pill>
                      ) : (
                        <Pill tone="success" dot>Matched</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )
          ) : null}

          {tab === "unexpected" ? (
            unexpectedRows.length === 0 ? (
              <Empty icon={CheckCircleIcon} title="No unexpected scans" desc="Every scanned barcode belonged to this count." />
            ) : (
              <Table head={["Barcode", "Product", "Last scanned", "By"]}>
                {unexpectedRows.map((u) => (
                  <tr key={u.barcode} className={tr}>
                    <td className={cn(td, "pl-4 font-mono text-[11px] text-ink-2")}>{u.barcode}</td>
                    <td className={td}>
                      {u.productId ? (
                        <Link href={`/products/${u.productId}`} className="inline-flex items-center gap-1 font-medium text-ink hover:text-gold-dark">
                          Open product <ArrowRightIcon size={11} />
                        </Link>
                      ) : (
                        <Pill tone="neutral">Not in catalog</Pill>
                      )}
                    </td>
                    <td className={cn(td, "whitespace-nowrap text-ink-3")}>{u.scannedAt ? when(u.scannedAt) : "-"}</td>
                    <td className={cn(td, "pr-4 text-ink-3")}>{u.by ?? "-"}</td>
                  </tr>
                ))}
              </Table>
            )
          ) : null}

          {tab === "log" ? (
            scans.length === 0 ? (
              <Empty icon={ScanBarcodeIcon} title="No scans yet" desc="Every scan is recorded here with who scanned it." />
            ) : (
              <Table head={["Time", "Barcode", "Result", "Scanned by"]}>
                {scans.map((s) => (
                  <tr key={s.id} className={tr}>
                    <td className={cn(td, "whitespace-nowrap pl-4 text-ink-3")}>{when(s.scanned_at)}</td>
                    <td className={cn(td, "font-mono text-[11px]")}>
                      {s.product_id ? (
                        <Link href={`/products/${s.product_id}`} className="hover:text-gold-dark">
                          {s.barcode}
                        </Link>
                      ) : (
                        s.barcode
                      )}
                    </td>
                    <td className={td}>
                      <FlagPill flag={s.flag} />
                    </td>
                    <td className={cn(td, "pr-4 text-ink-3")}>{s.scanned_by_name ?? "-"}</td>
                  </tr>
                ))}
              </Table>
            )
          ) : null}
        </Card>

        <MissingBreakdown missing={missing} missingMg={missingMg} expectedMg={expectedMg} noted={noted} open={open} />
      </div>

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

const TAB_TITLE: Record<TabKey, string> = {
  missing: "Missing pieces",
  matched: "Matched pieces",
  unexpected: "Unexpected barcodes",
  log: "Scan log",
};
const TAB_SUB: Record<TabKey, (open: boolean) => string> = {
  missing: (open) => (open ? "Expected but not scanned yet · posting writes these off as LOST" : "Not found when the count closed"),
  matched: () => "Expected pieces that were scanned",
  unexpected: () => "Scanned here but not on the list: another branch, shelf, already sold, or unknown",
  log: () => "Latest 200 scans, newest first",
};

/* ---------------------------------------------------------------- helpers */

function Table({ head, right = [], children }: { head: string[]; right?: number[]; children: ReactNode }) {
  return (
    <div className="max-h-[34rem] overflow-auto scrollbar-thin">
      <table className="w-full text-[12.5px]">
        <thead className={cn(thead, "sticky top-0 z-10 backdrop-blur")}>
          <tr>
            {head.map((h, i) => (
              <th key={i} className={cn(th, i === 0 && "pl-4", i === head.length - 1 && "pr-4", right.includes(i) && "text-right")}>
                {h || <span className="sr-only">Actions</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function KaratTag({ k }: { k: string | null }) {
  return k ? (
    <span className="g-metric rounded bg-gold-pale px-1.5 py-px text-[10.5px] font-semibold text-gold-deep ring-1 ring-gold-dark/15">{k}</span>
  ) : (
    <span className="text-ink-5">-</span>
  );
}

/** Where the gaps are: missing pieces grouped by karat and by location. */
function MissingBreakdown({ missing, missingMg, expectedMg, noted, open }: { missing: CountLine[]; missingMg: number; expectedMg: number; noted: number; open: boolean }) {
  const group = (key: (l: CountLine) => string) => {
    const m = new Map<string, { n: number; mg: number }>();
    for (const l of missing) {
      const k = key(l);
      const cur = m.get(k) ?? { n: 0, mg: 0 };
      m.set(k, { n: cur.n + 1, mg: cur.mg + (l.net_mg ?? 0) });
    }
    return [...m.entries()].sort((a, b) => b[1].mg - a[1].mg);
  };
  const byKarat = group((l) => l.karat ?? "Unknown");
  const byLoc = group((l) => l.location ?? "No location").slice(0, 6);
  const share = expectedMg > 0 ? (missingMg / expectedMg) * 100 : 0;
  return (
    <Card>
      <CardHead icon={AlertCircleIcon} title="Where the gaps are" sub={missing.length ? `${plural(missing.length, "piece")} · ${grams(missingMg)}` : "Nothing missing"} />
      <MiniStats
        items={[
          { k: "Weight short", v: `${share.toFixed(1)}%`, tone: share > 0 ? "text-rose-700" : "text-ink" },
          { k: open ? "Investigated" : "Noted", v: `${noted}/${missing.length}` },
        ]}
      />
      {missing.length === 0 ? (
        <Empty icon={CheckCircleIcon} title="Shelf matches the book" desc="No expected piece is unaccounted for." />
      ) : (
        <div className="space-y-3 p-4">
          {[
            ["By karat", byKarat],
            ["By location", byLoc],
          ].map(([label, rows]) => (
            <div key={label as string}>
              <div className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{label as string}</div>
              <ul className="space-y-1.5">
                {(rows as [string, { n: number; mg: number }][]).map(([k, v]) => (
                  <li key={k}>
                    <div className="flex items-baseline justify-between gap-2 text-[12px]">
                      <span className="truncate text-ink-2">{k}</span>
                      <span className="g-metric shrink-0 text-ink">
                        {grams(v.mg)} <span className="text-[10.5px] text-ink-5">· {v.n}</span>
                      </span>
                    </div>
                    <ShareBar value={missingMg > 0 ? (v.mg / missingMg) * 100 : 0} className="mt-1 h-1" color="bg-gradient-to-r from-rose-600 to-rose-400" />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

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
    <div className="relative mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) void submit(value);
          }}
          className="flex w-full flex-col gap-2 sm:flex-row"
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
              className="h-10 w-full rounded-lg bg-paper pl-11 pr-4 font-mono text-base text-ink shadow-[inset_0_0_0_1.5px_rgba(205,168,83,0.6)] transition-shadow placeholder:font-sans placeholder:text-ink-5 focus:outline-none focus:shadow-[inset_0_0_0_1.5px_var(--gold,#CDA853),0_0_0_4px_rgba(205,168,83,0.25)]"
            />
          </div>
          <CameraScanButton onDetected={(c) => void submit(c)} className="h-10" tone="dark" />
          <button
            type="submit"
            className="g-btn h-10 bg-gold px-4 text-[13px] text-ink transition-colors hover:bg-gold-light"
          >
            Record
            <ArrowRightIcon size={14} className="g-btn-arrow" />
          </button>
        </form>
        <div aria-live="polite" className="mt-2 min-h-8">
          {last ? (
            <div className={cn("flex items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-[13px] ring-1", lastCls)}>
              <span className="flex min-w-0 items-center gap-2">
                {last.flag === "OK" ? <CheckCircleIcon size={15} /> : <AlertCircleIcon size={15} />}
                <span className="truncate font-mono">{last.barcode}</span>
              </span>
              <span className="shrink-0 font-medium">{last.message}</span>
            </div>
          ) : (
            <p className="text-[11px] text-paper/45">
              USB and Bluetooth scanners work here: each scan is recorded on Enter and the box clears for the next one.
            </p>
          )}
          {pending > 0 ? <p className="mt-1.5 text-[11px] text-paper/40">Recording…</p> : null}
        </div>
      </div>
      <div className="rounded-xl bg-paper/[0.04] px-3 py-2 ring-1 ring-paper/[0.08]">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">
          <ClipboardCheckIcon size={12} /> Last scans
        </div>
        {scans.length === 0 ? (
          <p className="py-3 text-xs text-paper/50">No scans yet.</p>
        ) : (
          <ul className="space-y-1">
            {scans.slice(0, 5).map((s) => (
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
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    try {
      const res = await api<{ posted: number }>(`/api/v1/counts/${countId}/approve`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      toast.success(res.posted > 0 ? `Count posted: ${plural(res.posted, "piece")} written off as LOST` : "Count posted, nothing written off");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not post count");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      kicker="Stock count"
      title="Post count"
      danger={missing > 0}
      onClose={onClose}
      onSubmit={save}
      pending={pending}
      submitDisabled={!reason.trim()}
      submitLabel={missing > 0 ? `Write off ${plural(missing, "piece")}` : "Post & close"}
    >
      {missing > 0 ? (
        <Callout tone="danger" title={`${plural(missing, "piece")} will be written off as LOST`}>
          Every piece still missing ({missing} of {expected}) is marked LOST, removed from stock and posted to the gold
          ledger and accounts in one step. This cannot be undone. Scan anything you can still find first.
        </Callout>
      ) : (
        <Callout tone="success" title="Nothing is missing">
          Posting closes the count and releases the stock lock. No pieces will be written off.
        </Callout>
      )}
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
