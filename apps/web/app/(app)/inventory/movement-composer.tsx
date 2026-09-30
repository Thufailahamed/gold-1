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
    <div className="mb-3 flex items-center gap-2.5">
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold transition-colors",
          done ? "bg-emerald-700 text-paper" : "bg-ink text-gold"
        )}
        aria-hidden
      >
        {done ? <CheckCircleIcon size={13} /> : n}
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{children}</span>
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
    <section id="record-movement" aria-labelledby="mv-title" className="g-surface overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4 pt-5 sm:px-6">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gold-pale text-gold-deep ring-1 ring-gold-dark/15">
            <RefreshCwIcon size={16} />
          </span>
          <div>
            <h2 id="mv-title" className="text-base font-semibold text-ink">
              Record movement
            </h2>
            <p className="mt-0.5 text-xs text-ink-4">Scan a piece, choose what&rsquo;s happening, post it. Every change lands in the history below.</p>
          </div>
        </div>
        <Link
          href="/inventory/transfers/new"
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-3 ring-1 ring-ink/10 transition-colors hover:bg-bone hover:text-ink"
        >
          <TruckIcon size={13} /> Moving to another branch? Start a transfer
        </Link>
      </div>

      <div className="grid border-t border-ink/[0.07] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Step 1 — scan */}
        <div className="border-b border-ink/[0.07] p-5 sm:p-6 lg:border-b-0 lg:border-r">
          <StepLabel n={1} done={!!piece}>
            Scan piece
          </StepLabel>
          <label htmlFor="mv-barcode" className="sr-only">
            Barcode
          </label>
          <div
            className={cn(
              "group relative flex h-14 items-center rounded-xl bg-paper shadow-[inset_0_0_0_1px_rgba(28,25,23,0.14)] transition-shadow focus-within:shadow-[inset_0_0_0_1.5px_#1c1917,0_0_0_4px_rgba(201,162,39,0.25)]",
              notFound && "shadow-[inset_0_0_0_1.5px_#be123c] focus-within:shadow-[inset_0_0_0_1.5px_#be123c,0_0_0_4px_rgba(190,18,60,0.15)]"
            )}
          >
            <ScanBarcodeIcon size={20} className="pointer-events-none absolute left-4 text-ink-4 group-focus-within:text-gold-dark" />
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
              className="h-full w-full rounded-xl bg-transparent pl-12 pr-24 font-mono text-base tracking-wide text-ink placeholder:font-sans placeholder:text-sm placeholder:tracking-normal placeholder:text-ink-5 focus:outline-none"
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
              <kbd className="rounded-md bg-bone px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-4 ring-1 ring-ink/10">⏎</kbd>
            </span>
          </div>
          <p id="mv-barcode-hint" className="mt-2 text-[11px] text-ink-4">
            Scanners post on Enter automatically · Esc clears
          </p>

          <div className="mt-4">
            {!code ? (
              <div className="flex items-center gap-3 rounded-xl border border-dashed border-ink/15 bg-bone/40 px-4 py-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-paper text-ink-5 ring-1 ring-ink/[0.08]">
                  <ScanBarcodeIcon size={18} />
                </span>
                <p className="text-xs leading-relaxed text-ink-4">The piece&rsquo;s details, weight and current status appear here as soon as it&rsquo;s scanned.</p>
              </div>
            ) : pending && !piece ? (
              <Skeleton className="h-[8.5rem] rounded-xl" />
            ) : notFound ? (
              <div role="alert" className="flex items-start gap-3 rounded-xl bg-rose-700/[0.06] p-4 ring-1 ring-rose-700/20">
                <AlertCircleIcon size={16} className="mt-0.5 shrink-0 text-rose-700" />
                <div className="text-sm">
                  <div className="font-semibold text-rose-800">No piece with barcode {code}</div>
                  <p className="mt-0.5 text-xs text-ink-3">Check the label and scan again, or search the catalog.</p>
                </div>
              </div>
            ) : piece ? (
              <div className="animate-fade-in overflow-hidden rounded-xl ring-1 ring-ink/[0.08]">
                <div className="flex items-start justify-between gap-3 bg-bone/60 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink">{piece.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-4">
                      <span className="font-mono">{piece.barcode}</span>
                      <span className="g-metric rounded bg-gold-pale px-1.5 py-px text-[10px] font-semibold text-gold-deep ring-1 ring-gold-dark/15">{piece.karat}</span>
                    </div>
                  </div>
                  <StatusPill status={piece.status} />
                </div>
                <dl className="grid grid-cols-3 divide-x divide-ink/[0.06] border-t border-ink/[0.06] text-xs">
                  {[
                    ["Branch", branchName(piece.branch_id)],
                    ["Net", `${grams(piece.net_mg)} g`],
                    ["Fine", `${grams(piece.fine_gold_mg)} g`],
                  ].map(([k, v]) => (
                    <div key={k} className="min-w-0 px-4 py-3">
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
        <div className="flex flex-col p-5 sm:p-6">
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
                    "relative flex items-start gap-3 rounded-xl p-3.5 text-left ring-1 transition-all duration-200 ease-brand",
                    selected ? "bg-ink text-paper ring-ink shadow-pop" : "bg-paper ring-ink/10 hover:ring-ink/25",
                    impossible && !selected && "opacity-55"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-lg",
                      selected ? "bg-gold/20 text-gold" : "bg-bone text-ink-3"
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
                      selected ? "bg-gold ring-gold/40" : "ring-ink/15"
                    )}
                  />
                </button>
              );
            })}
          </div>

          <div className="mt-5">
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
              className="h-11 w-full rounded-lg bg-paper px-3 text-sm text-ink placeholder:text-ink-5 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.14)] transition-shadow focus:outline-none focus:shadow-[inset_0_0_0_1px_#1c1917,0_0_0_3px_rgba(201,162,39,0.3)]"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {action.reasons.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 transition-colors",
                    reason === r ? "bg-gold-pale text-gold-deep ring-gold-dark/30" : "bg-paper text-ink-3 ring-ink/10 hover:bg-bone hover:text-ink"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Confirm bar */}
          <div className="mt-6 flex flex-col gap-3 rounded-xl bg-bone/70 p-3.5 ring-1 ring-ink/[0.06] sm:flex-row sm:items-center sm:justify-between lg:mt-auto">
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
              <button type="button" onClick={clear} className="g-btn h-10 px-3 text-sm text-ink-3 hover:bg-ink/5 hover:text-ink">
                Clear
              </button>
              <button type="button" onClick={submit} disabled={!canPost} className="g-btn g-btn-primary h-10 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-40">
                {move.isPending ? "Posting…" : action.verb}
                {!move.isPending ? <kbd className="ml-1 rounded bg-paper/15 px-1 font-mono text-[10px]">⏎</kbd> : null}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Routing footer */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-ink/[0.07] bg-bone/50 px-5 py-3 text-[11px] text-ink-4 sm:px-6">
        <span className="font-semibold uppercase tracking-[0.12em]">Elsewhere</span>
        <Link href="/pos" className="hover:text-ink hover:underline">Sales → POS</Link>
        <Link href="/inventory/counts" className="hover:text-ink hover:underline">Shortages → Stock counts</Link>
        <Link href="/products" className="hover:text-ink hover:underline">Voids → Product page</Link>
      </div>
    </section>
  );
}
