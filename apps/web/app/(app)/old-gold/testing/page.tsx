"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, Skeleton } from "@/components/ui";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleSlashIcon,
  FlaskConicalIcon,
  GemIcon,
  InboxIcon,
  RefreshCwIcon,
  ScaleIcon,
  XIcon,
} from "@/components/icons";

type QueueRow = { id: string; number: string; description: string; status: string; net_mg: number };

const METHODS: { key: string; label: string; hint: string }[] = [
  { key: "acid", label: "Acid", hint: "Scratch & acid" },
  { key: "touchstone", label: "Touchstone", hint: "Streak test" },
  { key: "xrf", label: "XRF", hint: "X-ray fluorescence" },
  { key: "electronic", label: "Electronic", hint: "Gold tester" },
  { key: "fire_assay", label: "Fire assay", hint: "Cupellation" },
];

// Common hallmark finenesses, offered as one-tap presets for the permille field.
const PRESETS: { permille: number; karat: string }[] = [
  { permille: 999, karat: "24K" },
  { permille: 916, karat: "22K" },
  { permille: 875, karat: "21K" },
  { permille: 750, karat: "18K" },
  { permille: 585, karat: "14K" },
];

const RESULTS: { key: string; label: string; hint: string; icon: ReactNode; on: string; iconOn: string }[] = [
  {
    key: "pass",
    label: "Pass",
    hint: "Sets purity · ready to value",
    icon: <CheckCircleIcon size={16} />,
    on: "bg-emerald-50 ring-emerald-600/40 shadow-[0_12px_24px_-16px_rgba(5,150,105,0.6)]",
    iconOn: "bg-emerald-600 text-paper",
  },
  {
    key: "fail",
    label: "Fail",
    hint: "Back to the queue",
    icon: <CircleSlashIcon size={16} />,
    on: "bg-rose-50 ring-rose-600/40 shadow-[0_12px_24px_-16px_rgba(225,29,72,0.5)]",
    iconOn: "bg-rose-600 text-paper",
  },
  {
    key: "inconclusive",
    label: "Inconclusive",
    hint: "Back for a retest",
    icon: <AlertCircleIcon size={16} />,
    on: "bg-amber-50 ring-amber-600/40 shadow-[0_12px_24px_-16px_rgba(217,119,6,0.5)]",
    iconOn: "bg-amber-500 text-paper",
  },
];

const TABS = [
  { key: "RECEIVED", label: "Awaiting test" },
  { key: "TESTED", label: "Tested" },
] as const;

const cardShadow =
  "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]";

const karatOf = (p: number) => {
  const k = (p / 1000) * 24;
  return Number.isFinite(k) ? `${k.toFixed(k >= 10 ? 1 : 2).replace(/\.0$/, "")}K` : "—";
};

export default function TestingPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"RECEIVED" | "TESTED">("RECEIVED");
  const [testing, setTesting] = useState<QueueRow | null>(null);
  const [method, setMethod] = useState("xrf");
  const [permille, setPermille] = useState("");
  const [result, setResult] = useState("pass");

  const queue = useQuery({
    queryKey: ["og-queue"],
    queryFn: () => api<{ rows: QueueRow[]; total: number }>(`/api/v1/oldgold/items?status=RECEIVED&limit=50`),
  });
  const retest = useQuery({
    queryKey: ["og-retest"],
    queryFn: () => api<{ rows: QueueRow[]; total: number }>(`/api/v1/oldgold/items?status=TESTED&limit=50`),
  });

  const test = useMutation({
    mutationFn: () =>
      api(`/api/v1/oldgold/items/${testing?.id}/tests`, {
        method: "POST",
        body: JSON.stringify({
          method,
          permille: Number(permille),
          result,
        }),
      }),
    onSuccess: () => {
      // Only a pass sets the purity; anything else sends the item back to RECEIVED.
      if (result === "pass") toast.success("Test recorded — ready for valuation");
      else toast.warning(`Test recorded as ${result}; item is back in the queue for a retest`);
      setTesting(null);
      setPermille("");
      setResult("pass");
      for (const key of ["og-queue", "og-retest", "og-items", "og-item", "og-dash"]) qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Test failed"),
  });

  const waitingRows = queue.data?.rows ?? [];
  const testedRows = retest.data?.rows ?? [];
  const waiting = waitingRows.length;
  const retests = testedRows.length;
  const loading = queue.isLoading || retest.isLoading;
  const waitingNet = waitingRows.reduce((s, r) => s + r.net_mg, 0);
  const rows = tab === "RECEIVED" ? waitingRows : testedRows;

  const stats: { label: string; value: string; sub: string; icon: ReactNode; gold?: boolean; warn?: boolean }[] = [
    { label: "Awaiting test", value: String(waiting), sub: waiting ? "Received, not yet assayed" : "Queue is clear", icon: <InboxIcon size={16} />, warn: waiting > 0 },
    { label: "Tested", value: String(retests), sub: "Passed · can be retested", icon: <CheckCircleIcon size={16} /> },
    {
      label: "Metal waiting",
      value: `${(waitingNet / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })} g`,
      sub: "Net weight in the queue",
      icon: <ScaleIcon size={16} />,
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

        <div className="relative px-5 py-6 sm:px-7 lg:px-8 lg:py-7">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
            <FlaskConicalIcon size={11} />
            Old gold · Lab
          </span>
          <h1 className="g-display mt-3.5 text-3xl text-paper sm:text-[2.6rem]">
            Purity testing, <span className="home-gold-text">assayed true.</span>
          </h1>
          <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-paper/60">
            Assay every received piece before valuation. A pass sets the purity; a fail or inconclusive result sends it
            back for a retest.
          </p>
        </div>

        <div className="relative grid grid-cols-1 gap-px border-t border-paper/[0.08] bg-paper/[0.06] sm:grid-cols-3">
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
                  "flex size-10 shrink-0 items-center justify-center rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ring-1",
                  s.gold
                    ? "bg-gradient-to-b from-gold-light to-gold text-void ring-gold/40"
                    : s.warn
                      ? "bg-amber-400/15 text-amber-200 ring-amber-300/25"
                      : "bg-gradient-to-b from-paper/[0.09] to-paper/[0.03] text-gold-light ring-paper/[0.09]"
                )}
              >
                {s.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">{s.label}</span>
                {loading ? (
                  <Skeleton className="mt-1 h-6 w-14 bg-paper/10" />
                ) : (
                  <span className={cn("g-metric mt-0.5 block truncate text-xl leading-tight", s.gold ? "text-gold-light" : s.warn ? "text-amber-200" : "text-paper")}>
                    {s.value}
                  </span>
                )}
                <span className="mt-1 block truncate text-[10px] text-paper/35">{s.sub}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Queue */}
      <section className={cn("relative overflow-hidden rounded-[22px] bg-paper", cardShadow)}>
        <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
        <div className="flex flex-col gap-4 border-b border-ink/[0.06] px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)]">
              <FlaskConicalIcon size={17} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-sans text-[15px] font-semibold tracking-normal text-ink">Testing queue</h2>
              <p className="truncate text-xs text-ink-4">
                {waiting + retests} item{waiting + retests === 1 ? "" : "s"} · test received pieces, retest tested ones
              </p>
            </div>
          </div>
          <div
            role="tablist"
            aria-label="Queue"
            className="relative grid grid-cols-2 rounded-xl bg-bone p-1 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07)] sm:w-80"
          >
            <span
              aria-hidden
              className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/2)] rounded-lg bg-void shadow-[inset_0_0_0_1px_rgba(205,168,83,0.3),0_8px_18px_-10px_rgba(6,42,34,0.8)] transition-transform duration-320 ease-brand"
              style={{ transform: `translateX(${tab === "TESTED" ? 100 : 0}%)` }}
            />
            {TABS.map((t) => {
              const on = t.key === tab;
              const n = t.key === "RECEIVED" ? waiting : retests;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "relative inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors duration-200",
                    on ? "text-paper" : "text-ink-4 hover:text-ink"
                  )}
                >
                  {t.label}
                  <span
                    className={cn(
                      "g-metric min-w-5 rounded-full px-1.5 text-center text-[10px] font-semibold leading-[18px]",
                      on ? (t.key === "RECEIVED" && n > 0 ? "bg-amber-400 text-void" : "bg-paper/15 text-paper") : "bg-ink/[0.07] text-ink-3"
                    )}
                  >
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-36 rounded-2xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-5 sm:p-6">
            <div className="relative flex flex-col items-center overflow-hidden rounded-[22px] bg-gradient-to-b from-emerald-50 via-emerald-50/30 to-paper px-6 py-14 text-center ring-1 ring-emerald-600/10">
              <div className="pointer-events-none absolute -top-20 left-1/2 size-60 -translate-x-1/2 rounded-full bg-emerald-300/30 blur-[70px]" aria-hidden />
              <span className="relative mb-4 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-b from-emerald-500 to-emerald-700 text-paper shadow-[0_12px_24px_-10px_rgba(5,150,105,0.7)]">
                <CheckCircleIcon size={26} />
              </span>
              <h3 className="relative font-sans text-lg font-semibold tracking-normal text-ink">
                {tab === "RECEIVED" ? "Nothing awaiting a test" : "No tested items"}
              </h3>
              <p className="relative mt-1.5 max-w-sm text-sm text-ink-4">
                {tab === "RECEIVED"
                  ? "Every received piece has been assayed. New intake lands here automatically."
                  : "Passed items wait here for valuation and can be retested."}
              </p>
              <Link href="/old-gold/intake" className="g-btn g-btn-primary relative mt-6 h-10 rounded-xl px-4 text-sm">
                <ScaleIcon size={14} /> New intake
              </Link>
            </div>
          </div>
        ) : (
          <ul className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
            {rows.map((r, i) => {
              const received = r.status === "RECEIVED";
              return (
                <li
                  key={r.id}
                  className={cn(
                    "group relative flex animate-fade-in flex-col overflow-hidden rounded-2xl bg-paper p-4 ring-1 transition-all duration-320 ease-brand",
                    "ring-ink/[0.08] hover:-translate-y-1 hover:shadow-[0_24px_48px_-28px_rgba(126,98,35,0.5)] hover:ring-gold-dark/35"
                  )}
                  style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
                >
                  <span
                    aria-hidden
                    className={cn("absolute inset-x-0 top-0 h-[3px]", received ? "bg-gradient-to-r from-amber-300 to-amber-500" : "bg-gradient-to-r from-gold-dark to-gold-light")}
                  />
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/old-gold/items/${r.id}`} className="min-w-0">
                      <span className="g-metric block text-sm font-semibold text-ink transition-colors group-hover:text-gold-deep">{r.number}</span>
                      <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-ink-3">{r.description}</span>
                    </Link>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ring-1",
                        received ? "bg-amber-50 text-amber-700 ring-amber-600/15" : "bg-gold-pale text-gold-deep ring-gold-dark/20"
                      )}
                    >
                      <span className={cn("size-1.5 rounded-full", received ? "bg-amber-500" : "bg-gold")} />
                      {received ? "Received" : "Tested"}
                    </span>
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <span>
                      <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-5">Net</span>
                      <span className="g-metric text-lg leading-tight text-ink">
                        {(r.net_mg / 1000).toLocaleString("en-US")}
                        <span className="ml-0.5 text-xs text-ink-4">g</span>
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setTesting(r)}
                      className={cn(
                        "inline-flex h-10 items-center gap-1.5 rounded-xl px-4 text-xs font-semibold transition-all duration-200",
                        received
                          ? "bg-void text-paper shadow-[inset_0_0_0_1px_rgba(205,168,83,0.3),0_10px_20px_-12px_rgba(6,42,34,0.8)] hover:-translate-y-px"
                          : "text-ink-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.14)] hover:bg-void hover:text-paper hover:shadow-none"
                      )}
                    >
                      {received ? <FlaskConicalIcon size={13} className="text-gold-light" /> : <RefreshCwIcon size={12} />}
                      {received ? "Test" : "Retest"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {testing ? (
        <TestDialog
          item={testing}
          method={method}
          setMethod={setMethod}
          permille={permille}
          setPermille={setPermille}
          result={result}
          setResult={setResult}
          pending={test.isPending}
          onSubmit={() => test.mutate()}
          onClose={() => setTesting(null)}
        />
      ) : null}
    </Page>
  );
}

/* ------------------------------------------------------------------ dialog */

function TestDialog({
  item,
  method,
  setMethod,
  permille,
  setPermille,
  result,
  setResult,
  pending,
  onSubmit,
  onClose,
}: {
  item: QueueRow;
  method: string;
  setMethod: (v: string) => void;
  permille: string;
  setPermille: (v: string) => void;
  result: string;
  setResult: (v: string) => void;
  pending: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const p = Number(permille);
  const valid = Number.isInteger(p) && p > 0 && p <= 1000;
  const fine = valid ? (item.net_mg * p) / 1000 / 1000 : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in justify-center overflow-y-auto bg-void/60 p-4 backdrop-blur-md"
      onClick={pending ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="test-title"
        onClick={(e) => e.stopPropagation()}
        className="my-auto flex w-full max-w-xl animate-pop-in flex-col rounded-[24px] bg-paper shadow-5 ring-1 ring-ink/[0.06]"
      >
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
              <FlaskConicalIcon size={20} />
            </span>
            <div className="min-w-0 pr-8">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">Old gold · {item.number}</div>
              <h2 id="test-title" className="g-display mt-1 text-xl text-paper">
                Record test
              </h2>
            </div>
          </div>
          <div className="relative mt-4 flex items-center justify-between gap-3 rounded-xl bg-paper/[0.06] px-3.5 py-2.5 ring-1 ring-paper/10">
            <span className="min-w-0 truncate text-sm text-paper/80">{item.description}</span>
            <span className="g-metric shrink-0 text-sm text-gold-light">{(item.net_mg / 1000).toLocaleString("en-US")} g net</span>
          </div>
        </div>

        <div className="space-y-5 p-6">
          <div>
            <span className="mb-2 block text-[12.5px] font-medium text-ink-2">Method</span>
            <div role="radiogroup" aria-label="Method" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {METHODS.map((m) => {
                const on = m.key === method;
                return (
                  <button
                    key={m.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setMethod(m.key)}
                    className={cn(
                      "flex flex-col items-center justify-center rounded-xl px-2 py-2.5 text-center ring-1 transition-all duration-200",
                      on
                        ? "bg-void text-paper ring-gold/40 shadow-[0_10px_20px_-12px_rgba(6,42,34,0.8)]"
                        : "bg-paper text-ink ring-ink/10 hover:-translate-y-px hover:bg-gold-pale/40 hover:ring-gold-dark/30"
                    )}
                  >
                    <span className="text-[13px] font-semibold">{m.label}</span>
                    <span className={cn("mt-0.5 text-[10px]", on ? "text-paper/50" : "text-ink-5")}>{m.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="mb-2 flex items-center justify-between text-[12.5px] font-medium text-ink-2">
              Fineness
              <span className="text-[11px] font-normal text-ink-5">Parts per thousand, 1–1000</span>
            </span>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <span className="group relative block">
                <GemIcon size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-5 group-focus-within:text-gold-dark" />
                <input
                  autoFocus
                  type="number"
                  min="1"
                  max="1000"
                  step="1"
                  inputMode="numeric"
                  value={permille}
                  aria-invalid={permille !== "" && !valid ? true : undefined}
                  onChange={(e) => setPermille(e.target.value)}
                  placeholder="916"
                  className="g-metric h-12 w-full rounded-xl bg-paper pl-10 pr-12 text-lg text-ink placeholder:text-ink-5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12),0_1px_2px_rgba(16,32,27,0.04)] transition-shadow hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.26)] focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)] aria-[invalid=true]:shadow-[inset_0_0_0_1px_#e11d48,0_0_0_4px_rgba(225,29,72,0.12)]"
                />
                <span className="pointer-events-none absolute inset-y-1.5 right-1.5 flex items-center rounded-lg bg-bone px-2.5 text-sm text-ink-4 transition-colors group-focus-within:bg-void group-focus-within:text-gold-light">
                  ‰
                </span>
              </span>
              <div className="flex items-center gap-3 rounded-xl bg-void px-4 py-2 text-paper sm:min-w-[11rem]">
                <span>
                  <span className="block text-[9px] font-semibold uppercase tracking-[0.16em] text-paper/40">Karat</span>
                  <span className="g-metric text-base text-gold-light">{valid ? karatOf(p) : "—"}</span>
                </span>
                <span className="h-8 w-px bg-paper/10" />
                <span>
                  <span className="block text-[9px] font-semibold uppercase tracking-[0.16em] text-paper/40">Fine</span>
                  <span className="g-metric text-base text-paper">
                    {fine !== null ? fine.toLocaleString("en-US", { maximumFractionDigits: 3 }) : "—"}
                    <span className="ml-0.5 text-[10px] text-paper/40">g</span>
                  </span>
                </span>
              </div>
            </div>
            {permille !== "" && !valid ? (
              <span className="mt-1.5 flex items-center gap-1 text-xs font-medium text-rose-700">
                <AlertCircleIcon size={12} /> Enter a whole number from 1 to 1000
              </span>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PRESETS.map((pr) => {
                const on = p === pr.permille;
                return (
                  <button
                    key={pr.permille}
                    type="button"
                    onClick={() => setPermille(String(pr.permille))}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium ring-1 transition-all duration-200",
                      on
                        ? "bg-gradient-to-b from-gold-light to-gold text-void ring-gold/40 shadow-[0_6px_14px_-8px_rgba(205,168,83,0.8)]"
                        : "bg-paper text-ink-3 ring-ink/10 hover:-translate-y-px hover:bg-gold-pale/50 hover:text-ink"
                    )}
                  >
                    <span className="g-metric font-semibold">{pr.karat}</span>
                    <span className={cn("g-metric", on ? "text-void/60" : "text-ink-5")}>{pr.permille}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="mb-2 block text-[12.5px] font-medium text-ink-2">Result</span>
            <div role="radiogroup" aria-label="Result" className="grid gap-2 sm:grid-cols-3">
              {RESULTS.map((r) => {
                const on = r.key === result;
                return (
                  <button
                    key={r.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setResult(r.key)}
                    className={cn(
                      "relative flex items-center gap-2.5 rounded-2xl p-3 text-left ring-1 transition-all duration-200",
                      on ? r.on : "bg-paper ring-ink/10 hover:-translate-y-px hover:bg-bone/60"
                    )}
                  >
                    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors", on ? r.iconOn : "bg-bone text-ink-4")}>
                      {r.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{r.label}</span>
                      <span className="block truncate text-[11px] text-ink-4">{r.hint}</span>
                    </span>
                    {on ? <CheckIcon size={13} className="absolute right-3 top-3 text-ink-3" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 rounded-b-[24px] border-t border-ink/[0.06] bg-bone/50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-4">
            {result === "pass" ? "A pass sets the purity and moves the item to valuation." : "The item goes back to the testing queue."}
          </p>
          <div className="flex justify-end gap-2">
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
              onClick={onSubmit}
              disabled={pending || !valid}
              className="g-btn g-btn-primary h-11 rounded-xl px-5 text-sm"
            >
              {pending ? (
                <>
                  <span className="size-3.5 animate-spin rounded-full border-2 border-gold-light/30 border-t-gold-light" />
                  Saving…
                </>
              ) : (
                <>
                  Save test
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
