"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mgToG } from "@goldos/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Skeleton, StatusPill } from "@/components/ui";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  ArrowUturnLeftIcon,
  CheckCircleIcon,
  PackagePlusIcon,
  RefreshCwIcon,
  ScanBarcodeIcon,
  TruckIcon,
  XIcon,
} from "@/components/icons";
import { humanize, type Piece } from "./columns";

type Target = "RETURNED" | "IN_STOCK";

/**
 * Mirrors the server's transition table (services/inventory.ts ALLOW) for
 * the two moves this panel posts, so the form can explain a refusal before
 * the request is made. The server remains the authority.
 */
const ACTIONS: ReadonlyArray<{
  key: Target;
  title: string;
  body: string;
  verb: string;
  from: readonly string[];
  icon: (p: { size?: number; className?: string }) => ReactNode;
  reasons: readonly string[];
}> = [
  {
    key: "RETURNED",
    title: "Take off the shelf",
    body: "Customer return, damage, or pulled from display.",
    verb: "Take off shelf",
    from: ["IN_STOCK", "SOLD"],
    icon: ArrowUturnLeftIcon,
    reasons: ["Customer return", "Damaged", "Pulled for photos", "Held for inspection"],
  },
  {
    key: "IN_STOCK",
    title: "Put back on the shelf",
    body: "Restock a returned or inspected piece for sale.",
    verb: "Put back on shelf",
    from: ["RETURNED", "TRANSFER_PENDING"],
    icon: PackagePlusIcon,
    reasons: ["Inspected — OK", "Repaired", "Back from display", "Return accepted"],
  },
];

const grams = (mg: number) => mgToG(mg).toLocaleString("en-US", { maximumFractionDigits: 3 });

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function StepLabel({ n, children, done }: { n: number; children: ReactNode; done?: boolean }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold transition-colors",
          done ? "bg-gradient-to-b from-gold-light to-gold text-void shadow-[0_0_0_4px_rgba(205,168,83,0.15)]" : "bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.3)]"
        )}
        aria-hidden
      >
        {done ? <CheckCircleIcon size={13} /> : n}
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{children}</span>
      <span className="h-px flex-1 bg-gradient-to-r from-gold/30 to-transparent" aria-hidden />
    </div>
  );
}

export function MovementComposer({
  barcode,
  onBarcode,
  inputRef,
  branchName,
}: {
  barcode: string;
  onBarcode: (v: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  branchName: (id: string) => string;
}) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<Target>("RETURNED");
  const [reason, setReason] = useState("");
  const code = barcode.trim();
  const debounced = useDebounced(code, 300);

  const lookup = useQuery({
    queryKey: ["piece-by-barcode", debounced],
    queryFn: () => api<Piece>(`/api/v1/products/barcode/${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 0,
    retry: false,
    staleTime: 10_000,
  });
  const piece = lookup.data && lookup.data.product.barcode.toLowerCase() === code.toLowerCase() ? lookup.data.product : null;
  const pending = code.length > 0 && (code !== debounced || lookup.isFetching);
  const notFound = !pending && code.length > 0 && lookup.isError;

  // Pre-select the only sensible action for the scanned piece.
  useEffect(() => {
    if (!piece) return;
    const fits = ACTIONS.find((a) => a.from.includes(piece.status));
    if (fits) setTarget(fits.key);
  }, [piece?.id, piece?.status]);

  const action = ACTIONS.find((a) => a.key === target)!;
  const blocked: string | null = !code
    ? "Scan a piece to begin"
    : notFound
      ? "No piece with that barcode"
      : piece && piece.status === target
        ? `Already ${humanize(target).toLowerCase()}`
        : piece && !action.from.includes(piece.status)
          ? `Not possible while ${humanize(piece.status).toLowerCase()}`
          : null;

  const move = useMutation({
    mutationFn: async () => {
      // A hardware scanner sends Enter before the preview resolves; look it up then.
      const id = piece?.id ?? (await api<Piece>(`/api/v1/products/barcode/${encodeURIComponent(code)}`)).product.id;
      return api("/api/v1/inventory/movements", {
        method: "POST",
        body: JSON.stringify({ productId: id, toStatus: target, reason: reason.trim() || undefined }),
      });
    },
    onSuccess: () => {
      toast.success(`${piece?.name ?? code} · ${humanize(target)}`);
      onBarcode("");
      setReason("");
      qc.invalidateQueries({ queryKey: ["moves"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["inventory", "insights"] });
      qc.invalidateQueries({ queryKey: ["piece-by-barcode"] });
      inputRef.current?.focus();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Movement failed"),
  });

  const canPost = !blocked && !move.isPending;
  const submit = () => {
    if (canPost) move.mutate();
  };
  const clear = () => {
    onBarcode("");
    setReason("");
    inputRef.current?.focus();
  };

  return (
    <section
      id="record-movement"
      aria-labelledby="mv-title"
      className="relative scroll-mt-24 overflow-hidden rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_18px_40px_-30px_rgba(16,32,27,0.28)]"
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25)]">
            <RefreshCwIcon size={14} />
          </span>
          <div>
            <h2 id="mv-title" className="font-sans tracking-normal text-[13.5px] font-semibold text-ink">
              Record movement
            </h2>
            <p className="text-[11px] text-ink-4">Scan a piece, choose what&rsquo;s happening, post it. Every change lands in the history below.</p>
          </div>
        </div>
        <Link
          href="/inventory/transfers/new"
          className="group inline-flex items-center gap-2 rounded-full bg-paper py-1 pl-1 pr-3 text-[11px] font-medium text-ink-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)] transition-all hover:-translate-y-px hover:text-ink hover:shadow-[inset_0_0_0_1px_rgba(168,138,62,0.4)]"
        >
          <span className="flex size-5 items-center justify-center rounded-full bg-gold-pale text-gold-deep transition-colors group-hover:bg-void group-hover:text-gold-light">
            <TruckIcon size={12} />
          </span>
          Moving to another branch? Start a transfer
        </Link>
      </div>

      <div className="grid border-t border-ink/[0.07] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Step 1 — scan */}
        <div className="border-b border-ink/[0.06] bg-gradient-to-b from-bone/50 to-transparent p-4 lg:border-b-0 lg:border-r">
          <StepLabel n={1} done={!!piece}>
            Scan piece
          </StepLabel>
          <label htmlFor="mv-barcode" className="sr-only">
            Barcode
          </label>
          <div
            className={cn(
              "group relative flex h-11 items-center rounded-xl bg-paper shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12),0_1px_2px_rgba(16,32,27,0.05)] transition-shadow hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.26)] focus-within:shadow-[inset_0_0_0_1.5px_#10201b,0_0_0_4px_rgba(205,168,83,0.25)]",
              notFound && "shadow-[inset_0_0_0_1.5px_#be123c] focus-within:shadow-[inset_0_0_0_1.5px_#be123c,0_0_0_4px_rgba(190,18,60,0.15)]"
            )}
          >
            <ScanBarcodeIcon size={17} className="pointer-events-none absolute left-3.5 text-ink-4 group-focus-within:text-gold-dark" />
            <input
              id="mv-barcode"
              ref={inputRef}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={barcode}
              onChange={(e) => onBarcode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
                if (e.key === "Escape") clear();
              }}
              placeholder="Scan or type JW-XXXXXX"
              aria-invalid={notFound}
              aria-describedby="mv-barcode-hint"
              className="h-full w-full rounded-xl bg-transparent pl-10 pr-20 font-mono text-[14px] tracking-wide text-ink placeholder:font-sans placeholder:text-sm placeholder:tracking-normal placeholder:text-ink-5 focus:outline-none"
            />
            <span className="absolute right-3 flex items-center gap-1.5">
              {barcode ? (
                <button
                  type="button"
                  onClick={clear}
                  aria-label="Clear barcode"
                  className="flex size-7 items-center justify-center rounded-md text-ink-4 hover:bg-ink/5 hover:text-ink"
                >
                  <XIcon size={14} />
                </button>
              ) : null}
              <kbd className="flex h-6 min-w-6 items-center justify-center rounded-md bg-paper px-1.5 font-mono text-[11px] font-semibold text-ink-4 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12),0_1px_0_rgba(16,32,27,0.08)]">⏎</kbd>
            </span>
          </div>
          <p id="mv-barcode-hint" className="mt-2 text-[11px] text-ink-4">
            Scanners post on Enter automatically · Esc clears
          </p>

          <div className="mt-3">
            {!code ? (
              <div className="flex items-center gap-3.5 rounded-xl border border-dashed border-ink/15 bg-paper/70 px-3.5 py-3">
                <span className="relative flex size-9 shrink-0 items-center justify-center rounded-lg bg-void text-gold-light shadow-[0_10px_20px_-12px_rgba(6,42,34,0.8)]">
                  <span className="absolute inset-0 animate-pulse-soft rounded-xl ring-4 ring-gold/15" aria-hidden />
                  <ScanBarcodeIcon size={18} />
                </span>
                <p className="text-xs leading-relaxed text-ink-4">The piece&rsquo;s details, weight and current status appear here as soon as it&rsquo;s scanned.</p>
              </div>
            ) : pending && !piece ? (
              <Skeleton className="h-[6.5rem] rounded-xl" />
            ) : notFound ? (
              <div role="alert" className="flex items-start gap-3 rounded-xl bg-rose-700/[0.06] p-4 ring-1 ring-rose-700/20">
                <AlertCircleIcon size={16} className="mt-0.5 shrink-0 text-rose-700" />
                <div className="text-sm">
                  <div className="font-semibold text-rose-800">No piece with barcode {code}</div>
                  <p className="mt-0.5 text-xs text-ink-3">Check the label and scan again, or search the catalog.</p>
                </div>
              </div>
            ) : piece ? (
              <div className="animate-fade-in overflow-hidden rounded-2xl bg-paper shadow-[0_14px_30px_-20px_rgba(16,32,27,0.45)] ring-1 ring-gold-dark/20">
                <div className="relative flex items-start justify-between gap-3 overflow-hidden bg-void px-3.5 py-2.5 text-paper">
                  <div className="pointer-events-none absolute -right-10 -top-14 size-36 rounded-full bg-gold/20 blur-[50px]" aria-hidden />
                  <div className="min-w-0">
                    <div className="relative truncate text-sm font-semibold text-paper">{piece.name}</div>
                    <div className="relative mt-1 flex items-center gap-2 text-xs text-paper/55">
                      <span className="font-mono">{piece.barcode}</span>
                      <span className="g-metric rounded bg-gradient-to-b from-gold-light to-gold px-1.5 py-px text-[10px] font-semibold text-void">{piece.karat}</span>
                    </div>
                  </div>
                  <span className="relative rounded-full bg-paper">
                    <StatusPill status={piece.status} />
                  </span>
                </div>
                <dl className="grid grid-cols-3 divide-x divide-ink/[0.06] border-t border-ink/[0.06] text-xs">
                  {[
                    ["Branch", branchName(piece.branch_id)],
                    ["Net", `${grams(piece.net_mg)} g`],
                    ["Fine", `${grams(piece.fine_gold_mg)} g`],
                  ].map(([k, v]) => (
                    <div key={k} className="min-w-0 px-3.5 py-2">
                      <dt className="text-ink-4">{k}</dt>
                      <dd className="g-metric mt-0.5 truncate text-sm text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </div>
        </div>

        {/* Step 2 — action */}
        <div className="flex flex-col p-4">
          <StepLabel n={2}>What&rsquo;s happening?</StepLabel>
          <div role="radiogroup" aria-label="Movement" className="grid gap-2.5 sm:grid-cols-2">
            {ACTIONS.map((a) => {
              const selected = a.key === target;
              const impossible = !!piece && !a.from.includes(piece.status) && piece.status !== a.key;
              return (
                <button
                  key={a.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTarget(a.key)}
                  className={cn(
                    "relative flex items-start gap-2.5 overflow-hidden rounded-xl p-3 text-left ring-1 transition-all duration-200 ease-brand",
                    selected
                      ? "bg-void text-paper shadow-[0_16px_32px_-18px_rgba(6,42,34,0.9)] ring-gold/40"
                      : "bg-paper ring-ink/10 hover:-translate-y-px hover:bg-gold-pale/40 hover:ring-gold-dark/30",
                    impossible && !selected && "opacity-55"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                      selected ? "bg-gradient-to-b from-gold-light to-gold text-void" : "bg-bone text-ink-3"
                    )}
                  >
                    <a.icon size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{a.title}</span>
                    <span className={cn("mt-0.5 block text-xs leading-snug", selected ? "text-paper/60" : "text-ink-4")}>
                      {impossible ? `Not possible while ${humanize(piece!.status).toLowerCase()}` : a.body}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "absolute right-3 top-3 size-3.5 rounded-full ring-2 transition-colors",
                      selected ? "bg-gold ring-gold/30" : "bg-paper ring-ink/15"
                    )}
                  />
                </button>
              );
            })}
          </div>

          <div className="mt-3">
            <label htmlFor="mv-reason" className="mb-1.5 flex items-baseline justify-between text-xs font-medium text-ink-3">
              Reason <span className="font-normal text-ink-5">Optional · saved on the movement</span>
            </label>
            <input
              id="mv-reason"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="Why is this piece moving?"
              className="h-9 w-full rounded-lg bg-paper px-3 text-[13px] text-ink placeholder:text-ink-5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12),0_1px_2px_rgba(16,32,27,0.04)] transition-shadow hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.26)] focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)]"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {action.reasons.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 transition-all duration-200",
                    reason === r
                      ? "bg-gradient-to-b from-gold-light to-gold text-void ring-gold/40 shadow-[0_6px_14px_-8px_rgba(205,168,83,0.8)]"
                      : "bg-paper text-ink-3 ring-ink/10 hover:-translate-y-px hover:bg-gold-pale/50 hover:text-ink"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Confirm bar */}
          <div className="mt-4 flex flex-col gap-2 rounded-xl bg-bone/70 p-2.5 ring-1 ring-ink/[0.06] sm:flex-row sm:items-center sm:justify-between lg:mt-auto">
            <div className="flex min-w-0 items-center gap-2 text-xs" aria-live="polite">
              {blocked ? (
                <span className={cn("flex items-center gap-1.5", code ? "font-medium text-rose-700" : "text-ink-4")}>
                  {code ? <AlertCircleIcon size={14} /> : null}
                  {blocked}
                </span>
              ) : piece ? (
                <>
                  <StatusPill status={piece.status} />
                  <ArrowRightIcon size={13} className="shrink-0 text-ink-4" />
                  <StatusPill status={target} />
                </>
              ) : (
                <span className="text-ink-4">Will set {code} to {humanize(target).toLowerCase()}</span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={clear} className="g-btn h-9 rounded-lg px-3 text-[13px] text-ink-3 hover:bg-paper hover:text-ink">
                Clear
              </button>
              <button type="button" onClick={submit} disabled={!canPost} className="g-btn g-btn-primary h-9 rounded-lg px-4 text-[13px] disabled:cursor-not-allowed disabled:opacity-40">
                {move.isPending ? "Posting…" : action.verb}
                {!move.isPending ? <kbd className="ml-1 rounded bg-paper/15 px-1 font-mono text-[10px]">⏎</kbd> : null}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Routing footer */}
      <div className="flex flex-wrap items-center gap-2 border-t border-ink/[0.06] bg-bone/40 px-4 py-2 text-[11px] text-ink-4">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-dark">Elsewhere</span>
        {[
          ["/pos", "Sales", "POS"],
          ["/inventory/counts", "Shortages", "Stock counts"],
          ["/products", "Voids", "Product page"],
        ].map(([href, k, v]) => (
          <Link
            key={href}
            href={href!}
            className="group inline-flex items-center gap-1.5 rounded-full bg-paper px-2.5 py-0.5 ring-1 ring-ink/[0.07] transition-all hover:-translate-y-px hover:text-ink hover:ring-gold-dark/30"
          >
            {k}
            <ArrowRightIcon size={10} className="text-gold-dark transition-transform group-hover:translate-x-0.5" />
            <span className="font-medium text-ink-2">{v}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
