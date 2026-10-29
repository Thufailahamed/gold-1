"use client";

import { use, useEffect, useState, type CSSProperties } from "react";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import {
  LABEL_BATCH_MAX,
  LABEL_COPIES_MAX,
  LABELS_PER_ROW_DEFAULT,
  LABELS_PER_ROW_MAX,
  LABELS_PER_ROW_MIN,
  addLabelIds,
  chunkIds,
  clampCopies,
  clampLabelsPerRow,
  labelSlots,
  parseLabelIds,
  removeLabelIds,
  toggleLabelId,
} from "@goldos/shared";
import { toast } from "sonner";
import { Page, Skeleton } from "@/components/ui";
import { Card, CardHead, Empty, GoldHero, HeroBadge, heroGold } from "@/components/console-kit";
import { Select } from "@/components/select";
import { cn } from "@/lib/cn";
import { api, assetUrl } from "@/lib/api";
import {
  AlertCircleIcon,
  CheckIcon,
  PackageIcon,
  PrinterIcon,
  RefreshCwIcon,
  ScanBarcodeIcon,
  SearchIcon,
  TagsIcon,
  XIcon,
} from "@/components/icons";

const PICKER_PAGE = 24;
const PICKER_MAX = 96;
const DETAIL_CHUNK = 50;

const STATUS_OPTIONS = [
  { value: "IN_STOCK", label: "In stock" },
  { value: "", label: "All statuses" },
  { value: "RESERVED", label: "Reserved" },
  { value: "SOLD", label: "Sold" },
  { value: "IN_REPAIR", label: "In repair" },
  { value: "IN_MANUFACTURING", label: "In manufacturing" },
];

const STATUS_DOT: Record<string, string> = {
  IN_STOCK: "bg-emerald-500",
  RESERVED: "bg-amber-500",
  SOLD: "bg-sky-500",
  IN_REPAIR: "bg-rose-500",
  IN_MANUFACTURING: "bg-violet-500",
  RETURNED: "bg-teal-500",
  TRANSFER_PENDING: "bg-indigo-500",
  MELTING: "bg-orange-500",
  MELTED: "bg-ink/40",
  LOST: "bg-rose-700",
  VOID: "bg-ink/30",
};

const softBtn =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[11.5px] font-medium text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)] transition-all duration-200 hover:-translate-y-px hover:bg-void hover:text-paper hover:shadow-none disabled:pointer-events-none disabled:opacity-40";

const CODE_RE = /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/i;

type Product = {
  id: string;
  barcode: string;
  sku: string;
  name: string;
  category_name: string;
  karat: string;
  net_mg: number;
  status: string;
};

type ProductPage = { rows: Product[]; total: number };
type LabelState = Record<string, "loaded" | "failed">;

const grams = (mg: number) => (mg / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });
const humanize = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/**
 * Batch label printing: /products/labels?ids=a,b,c[&back=/purchases/invoices/x]
 *
 * Opened empty it is a label station: search or scan pieces, tick the batch,
 * set copies and print. Opened from a purchase receive, manufacturing finish
 * or bulk add, the ids arrive preselected.
 */
export default function BatchLabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; back?: string }>;
}) {
  const sp = use(searchParams);
  const back = sp.back && sp.back.startsWith("/") && !sp.back.startsWith("//") ? sp.back : "/products";

  const [selected, setSelected] = useState<string[]>(() => parseLabelIds(sp.ids));
  const [copies, setCopies] = useState(1);
  const [perRow, setPerRow] = useState(LABELS_PER_ROW_DEFAULT);
  const [labelState, setLabelState] = useState<LabelState>({});
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("IN_STOCK");
  const [limit, setLimit] = useState(PICKER_PAGE);
  const [scanBusy, setScanBusy] = useState(false);

  // Scanning types a barcode and presses Enter; wait a beat before asking the
  // catalogue so a typed search does not fire a request on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setLimit(PICKER_PAGE);
  }, [query, status]);

  const picker = useQuery({
    queryKey: ["label-picker", query, status, limit],
    queryFn: () => {
      const p = new URLSearchParams({ page: "1", limit: String(limit) });
      if (query) p.set("search", query);
      if (status) p.set("status", status);
      return api<ProductPage>(`/api/v1/products?${p.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const rows = picker.data?.rows ?? [];
  const total = picker.data?.total ?? 0;

  // Deep-linked batches can be larger than one catalogue page. Resolve them in
  // bounded chunks (D1's bind cap), so the selected list can show real tags.
  const detailQueries = useQueries({
    queries: chunkIds(selected, DETAIL_CHUNK).map((ids) => ({
      queryKey: ["label-pieces", ids],
      queryFn: () =>
        api<ProductPage>(`/api/v1/products?ids=${ids.map(encodeURIComponent).join(",")}&limit=${ids.length}`),
      staleTime: 60_000,
    })),
  });
  const detailsLoading = selected.length > 0 && detailQueries.some((q) => q.isLoading);

  const byId = new Map<string, Product>();
  for (const p of rows) byId.set(p.id, p);
  for (const q of detailQueries) for (const p of q.data?.rows ?? []) byId.set(p.id, p);

  const slots = labelSlots(selected, copies);
  const labels = slots.length;
  const failedSlots = slots.filter((s) => labelState[s.key] === "failed");
  const failedPieceIds = Array.from(new Set(failedSlots.map((s) => s.pieceId)));
  const failedPieceSet = new Set(failedPieceIds);
  const pending = slots.filter((s) => !labelState[s.key]).length;
  const failed = failedSlots.length;
  const canPrint = labels > 0 && pending === 0 && failed === 0;
  const allShownSelected = rows.length > 0 && rows.every((r) => selected.includes(r.id));

  function clearKeys(keys: string[]) {
    setLabelState((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of keys) {
        if (next[key]) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }

  function clearPieceState(ids: string[]) {
    const wanted = new Set(ids);
    setLabelState((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        const pieceId = key.slice(0, key.lastIndexOf("#"));
        if (wanted.has(pieceId)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }

  function addIds(ids: string[]) {
    const fresh = ids.filter((id) => !selected.includes(id));
    if (fresh.length === 0) return;
    if (selected.length + fresh.length > LABEL_BATCH_MAX) {
      toast.error(`A label run is limited to ${LABEL_BATCH_MAX} pieces.`);
      return;
    }
    setSelected((prev) => addLabelIds(prev, fresh));
    clearPieceState(fresh);
  }

  function addPieces(pieces: Product[]) {
    addIds(pieces.map((p) => p.id));
  }

  function toggle(id: string) {
    if (!selected.includes(id) && selected.length >= LABEL_BATCH_MAX) {
      toast.error(`A label run is limited to ${LABEL_BATCH_MAX} pieces.`);
      return;
    }
    setSelected((prev) => toggleLabelId(prev, id));
    clearPieceState([id]);
  }

  function remove(id: string) {
    setSelected((prev) => removeLabelIds(prev, [id]));
    clearPieceState([id]);
  }

  function clearAll() {
    setSelected([]);
    setLabelState({});
  }

  function selectShown() {
    const ids = rows.map((r) => r.id);
    if (allShownSelected) {
      setSelected((prev) => removeLabelIds(prev, ids));
      clearPieceState(ids);
      return;
    }
    addIds(ids);
  }

  function removeFailed() {
    setSelected((prev) => removeLabelIds(prev, failedPieceIds));
    clearPieceState(failedPieceIds);
  }

  function retryFailed() {
    clearKeys(failedSlots.map((s) => s.key));
    setRetry((n) => n + 1);
  }

  /** A scanner ends with Enter; add the tag instead of making the operator tick it. */
  async function addScanned(raw: string) {
    const code = raw.trim();
    if (!code) return;

    const exact = rows.find(
      (r) => r.barcode.toUpperCase() === code.toUpperCase() || r.sku.toUpperCase() === code.toUpperCase()
    );
    if (exact) {
      if (selected.includes(exact.id)) toast.info(`${exact.barcode} is already in this batch.`);
      else addPieces([exact]);
      setSearch("");
      return;
    }

    // A plain name search stays a search; only code-shaped input is looked up.
    if (!CODE_RE.test(code)) return;

    setScanBusy(true);
    try {
      const found = await api<{ product: Product }>(`/api/v1/products/barcode/${encodeURIComponent(code)}`);
      if (selected.includes(found.product.id)) {
        toast.info(`${found.product.barcode} is already in this batch.`);
      } else {
        addPieces([found.product]);
        toast.success(`${found.product.barcode} added`);
      }
      setSearch("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Piece not found");
    } finally {
      setScanBusy(false);
    }
  }

  function markLoaded(key: string) {
    setLabelState((prev) => (prev[key] === "loaded" ? prev : { ...prev, [key]: "loaded" }));
  }

  function markFailed(key: string) {
    setLabelState((prev) => (prev[key] === "failed" ? prev : { ...prev, [key]: "failed" }));
  }

  const labelSrc = (id: string) => {
    const q = new URLSearchParams({ qr: "0", price: "0" });
    if (retry) q.set("retry", String(retry));
    return assetUrl(`/api/v1/products/${encodeURIComponent(id)}/label?${q.toString()}`);
  };

  function printLabels() {
    if (canPrint) window.print();
  }

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={PrinterIcon}
        title="Print"
        accent="labels"
        badge={
          <HeroBadge tone={selected.length === 0 ? "muted" : failed ? "bad" : pending ? "warn" : "good"}>
            {selected.length === 0 ? "Nothing selected" : failed ? "Check labels" : pending ? "Preparing" : "Ready"}
          </HeroBadge>
        }
        sub="Pick pieces to tag, or open this page from a purchase receive or manufacturing finish"
        back={{ href: back, label: "Back" }}
        actions={
          <button type="button" onClick={printLabels} disabled={!canPrint} className={heroGold}>
            <PrinterIcon size={13} />
            Print {labels} label{labels === 1 ? "" : "s"}
          </button>
        }
        stats={[
          { label: "Pieces", value: selected.length, accent: true },
          { label: "Copies each", value: copies },
          { label: "Labels", value: labels },
          {
            label: "Failed",
            value: failed,
            tone: failed ? "bad" : pending ? "warn" : "good",
            sub:
              selected.length === 0
                ? "select pieces"
                : failed
                  ? "remove to print"
                  : pending
                    ? "loading labels"
                    : "all loaded",
          },
        ]}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-paper/55">
          {selected.length ? (
            <span className="flex flex-wrap items-center gap-2">
              <span>Copies per piece</span>
              <span className="flex flex-wrap items-center rounded-lg bg-paper/[0.07] p-0.5 ring-1 ring-inset ring-paper/12">
                {Array.from({ length: LABEL_COPIES_MAX }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCopies(clampCopies(n))}
                    aria-pressed={copies === n}
                    className={`g-metric h-6 w-6 rounded-md text-[11px] font-semibold transition-colors ${
                      copies === n ? "bg-gold text-void" : "text-paper/60 hover:text-paper"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </span>
              <span className="text-paper/35">
                {selected.length} × {copies} = {labels}
              </span>
            </span>
          ) : (
            <p className="min-w-0 text-paper/45">
              Search the catalogue below, tick the pieces, then print. A scanner can type straight into the search box.
            </p>
          )}
          <span className="flex flex-wrap items-center gap-2">
            <span>Labels per row</span>
            <span className="flex flex-wrap items-center rounded-lg bg-paper/[0.07] p-0.5 ring-1 ring-inset ring-paper/12">
              {Array.from(
                { length: LABELS_PER_ROW_MAX - LABELS_PER_ROW_MIN + 1 },
                (_, i) => LABELS_PER_ROW_MIN + i
              ).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPerRow(clampLabelsPerRow(n))}
                  aria-pressed={perRow === n}
                  aria-label={`${n} label${n === 1 ? "" : "s"} per row`}
                  className={`g-metric h-6 w-6 rounded-md text-[11px] font-semibold transition-colors ${
                    perRow === n ? "bg-gold text-void" : "text-paper/60 hover:text-paper"
                  }`}
                >
                  {n}
                </button>
              ))}
            </span>
          </span>
        </div>
      </GoldHero>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card>
          <CardHead
            icon={ScanBarcodeIcon}
            title="Pick pieces"
            sub="Search by name, barcode or SKU, or scan a tag"
            action={
              <button type="button" onClick={selectShown} disabled={rows.length === 0} className={softBtn}>
                <CheckIcon size={12} />
                {allShownSelected ? "Deselect shown" : `Select shown (${rows.length})`}
              </button>
            }
          />
          <div className="border-b border-ink/20 p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void addScanned(search);
              }}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <div className="group relative min-w-0 flex-1">
                <SearchIcon
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-5 transition-colors group-focus-within:text-gold-dark"
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, barcode or SKU…"
                  autoComplete="off"
                  aria-label="Search pieces or scan a barcode"
                  className="h-9 w-full rounded-lg bg-bone/60 pl-9 pr-10 text-[13px] text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)] transition-all duration-200 placeholder:text-ink-5 hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)] focus:bg-paper focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)]"
                />
                {search ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-ink-4 hover:bg-ink/5 hover:text-ink"
                  >
                    <XIcon size={14} />
                  </button>
                ) : null}
              </div>
              <div className="sm:w-44">
                <Select
                  value={status}
                  onChange={setStatus}
                  options={STATUS_OPTIONS}
                  icon={<PackageIcon size={13} />}
                  ariaLabel="Piece status"
                />
              </div>
            </form>
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-ink-4">
              <span>
                {picker.isLoading ? (
                  "Loading pieces…"
                ) : (
                  <>
                    <span className="g-metric font-medium text-ink">{total.toLocaleString("en-US")}</span>{" "}
                    {total === 1 ? "piece" : "pieces"}
                    {query ? (
                      <>
                        {" "}
                        matching <span className="font-medium text-ink">&ldquo;{query}&rdquo;</span>
                      </>
                    ) : null}
                  </>
                )}
              </span>
              {scanBusy ? (
                <span className="flex items-center gap-1.5">
                  <span className="size-3 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
                  Looking up tag…
                </span>
              ) : picker.isFetching && !picker.isLoading ? (
                <span className="flex items-center gap-1.5">
                  <span className="size-3 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
                  Updating…
                </span>
              ) : null}
            </div>
          </div>

          {picker.isError ? (
            <Empty
              icon={AlertCircleIcon}
              title="Could not load pieces"
              desc="Check the API connection and try again."
              action={
                <button type="button" onClick={() => void picker.refetch()} className={softBtn}>
                  <RefreshCwIcon size={12} />
                  Retry
                </button>
              }
            />
          ) : picker.isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-11 rounded-lg" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <Empty
              icon={SearchIcon}
              title="No pieces found"
              desc={query ? "Nothing matches this search. Try a barcode, SKU or a different status." : "No pieces in this status yet."}
            />
          ) : (
            <div className="scrollbar-thin max-h-[30rem] overflow-y-auto">
              {rows.map((p) => {
                const checked = selected.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 border-b border-ink/20 px-3 py-2.5 text-[12px] transition-colors last:border-0",
                      checked ? "bg-gold-pale/55" : "hover:bg-bone/70"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(p.id)}
                      className="size-4 shrink-0 cursor-pointer accent-gold-deep"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="g-metric font-semibold text-gold-deep">{p.barcode}</span>
                        <span className="truncate font-medium text-ink">{p.name}</span>
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-ink-4">
                        <span>{p.category_name}</span>
                        <span>·</span>
                        <span>{grams(p.net_mg)} g</span>
                        <span>·</span>
                        <span className="g-metric">{p.sku}</span>
                      </span>
                    </span>
                    <span className="g-metric shrink-0 rounded bg-gradient-to-b from-gold-light to-gold px-1.5 py-px text-[10px] font-bold text-void">
                      {p.karat}
                    </span>
                    <span className="hidden shrink-0 items-center gap-1 text-[10px] font-semibold text-ink-4 sm:flex">
                      <span className={cn("size-1.5 rounded-full", STATUS_DOT[p.status] ?? "bg-ink/30")} />
                      {humanize(p.status)}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {rows.length < total ? (
            <div className="border-t border-ink/20 p-3">
              <button
                type="button"
                onClick={() => setLimit((l) => Math.min(PICKER_MAX, l + PICKER_PAGE))}
                disabled={limit >= PICKER_MAX}
                className={cn(softBtn, "w-full justify-center")}
              >
                {limit >= PICKER_MAX
                  ? `Showing the first ${PICKER_MAX} — search to narrow`
                  : `Load more (${rows.length} of ${total.toLocaleString("en-US")})`}
              </button>
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHead
            icon={TagsIcon}
            title="Selected pieces"
            sub={
              selected.length
                ? `${selected.length} of ${LABEL_BATCH_MAX} pieces in this run`
                : "Nothing selected yet"
            }
            action={
              selected.length ? (
                <button type="button" onClick={clearAll} className={softBtn}>
                  <XIcon size={12} />
                  Clear all
                </button>
              ) : undefined
            }
          />
          {selected.length === 0 ? (
            <Empty
              icon={TagsIcon}
              title="No pieces selected"
              desc="Search on the left and tick the pieces that need labels. A scanned tag is added with Enter."
            />
          ) : (
            <>
              <div className="scrollbar-thin max-h-60 overflow-y-auto p-3">
                <div className="flex flex-wrap gap-1.5">
                  {selected.map((id) => {
                    const p = byId.get(id);
                    const hasFailed = failedPieceSet.has(id);
                    return (
                      <span
                        key={id}
                        className={cn(
                          "inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pl-2.5 pr-1 text-[11px] ring-1 ring-inset",
                          hasFailed
                            ? "bg-rose-500/10 text-rose-800 ring-rose-500/25"
                            : "bg-gold-pale text-gold-deep ring-gold-dark/20"
                        )}
                      >
                        {p ? (
                          <>
                            <span className="g-metric font-semibold">{p.barcode}</span>
                            <span className="max-w-[7rem] truncate text-ink-4">{p.name}</span>
                          </>
                        ) : detailsLoading ? (
                          <span className="inline-block h-3 w-16 animate-pulse rounded bg-ink/10" />
                        ) : (
                          <span className="g-metric">{id.slice(0, 8)}…</span>
                        )}
                        {hasFailed ? <AlertCircleIcon size={10} /> : null}
                        <button
                          type="button"
                          aria-label={`Remove ${p?.barcode ?? id}`}
                          onClick={() => remove(id)}
                          className="flex size-5 items-center justify-center rounded-full transition-colors hover:bg-gold-deep hover:text-paper"
                        >
                          <XIcon size={10} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink/20 px-3 py-2 text-[11px] text-ink-4">
                <span>
                  {failed
                    ? `${failed} label${failed === 1 ? "" : "s"} failed`
                    : pending
                      ? `Preparing ${labels - pending} of ${labels} labels`
                      : "All labels ready"}
                </span>
                <span className="g-metric font-medium text-ink">
                  {labels} label{labels === 1 ? "" : "s"}
                </span>
              </div>
            </>
          )}
        </Card>
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2 print:hidden">
          <div>
            <h2 className="text-[13.5px] font-semibold text-ink">Label preview</h2>
            <p className="text-[11px] text-ink-4">
              {selected.length
                ? `${selected.length} piece${selected.length === 1 ? "" : "s"} × ${copies} cop${
                    copies === 1 ? "y" : "ies"
                  } = ${labels} label${labels === 1 ? "" : "s"} · ${perRow} tag${
                    perRow === 1 ? "" : "s"
                  } per row`
                : "Pick pieces to preview their tags."}
            </p>
          </div>
          <button
            type="button"
            onClick={printLabels}
            disabled={!canPrint}
            className="g-btn g-btn-primary h-9 px-4 text-[12.5px] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PrinterIcon size={13} />
            Print {labels} label{labels === 1 ? "" : "s"}
          </button>
        </div>

        {failed > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-rose-500/10 px-4 py-2.5 text-[12px] text-rose-900 ring-1 ring-inset ring-rose-500/25 print:hidden">
            <AlertCircleIcon size={14} />
            <span className="min-w-0 flex-1">
              {failed} label{failed === 1 ? "" : "s"} failed to load. Check that the pieces still exist and that you
              are signed in.
            </span>
            <button type="button" onClick={retryFailed} className={softBtn}>
              <RefreshCwIcon size={11} />
              Retry
            </button>
            <button type="button" onClick={removeFailed} className={softBtn}>
              <XIcon size={11} />
              Remove {failedPieceIds.length} piece{failedPieceIds.length === 1 ? "" : "s"}
            </button>
          </div>
        ) : pending > 0 && labels > 0 ? (
          <div
            aria-live="polite"
            className="flex items-center gap-2 rounded-xl bg-ink/[0.04] px-4 py-2.5 text-[12px] text-ink-3 ring-1 ring-inset ring-ink/20 print:hidden"
          >
            <span className="size-3 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
            Preparing {labels - pending} of {labels} label{labels === 1 ? "" : "s"}…
          </div>
        ) : null}

        {selected.length === 0 ? (
          <Card className="print:hidden">
            <Empty
              icon={PrinterIcon}
              title="Nothing to print yet"
              desc="Select one or more pieces above. Their barcode tags render here exactly as they will print."
            />
          </Card>
        ) : (
          <div
            className="print-area label-sheet mt-4 grid gap-3 rounded-2xl bg-[repeating-linear-gradient(45deg,rgba(16,32,27,0.025)_0_8px,transparent_8px_16px)] p-4 print:mt-0 print:rounded-none print:bg-none print:p-0"
            style={{ "--label-cols": perRow } as CSSProperties}
          >
            {slots.map((slot) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={`${slot.key}-${retry}`}
                src={labelSrc(slot.pieceId)}
                alt={`Barcode label${byId.get(slot.pieceId) ? ` for ${byId.get(slot.pieceId)!.barcode}` : ""}`}
                className="label-img w-full max-w-sm rounded-md bg-white shadow-[0_12px_28px_-18px_rgba(16,32,27,0.5)] print:rounded-none print:shadow-none"
                onLoad={() => markLoaded(slot.key)}
                onError={() => markFailed(slot.key)}
              />
            ))}
          </div>
        )}
      </section>
    </Page>
  );
}
