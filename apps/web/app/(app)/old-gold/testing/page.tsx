"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page } from "@/components/ui";
import { Card, CardHead, Empty, FilterPills, GoldHero, HeroBadge, RowsSkeleton, ago, grams, heroGhost, inputCls, th, thead, tr } from "../kit";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleSlashIcon,
  FlaskConicalIcon,
  GemIcon,
  RefreshCwIcon,
  ScaleIcon,
  SearchIcon,
  XIcon,
} from "@/components/icons";

type QueueRow = { id: string; number: string; description: string; status: string; net_mg: number; created_at?: number; customer_name?: string | null };

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

const karatOf = (p: number) => {
  const k = (p / 1000) * 24;
  return Number.isFinite(k) ? `${k.toFixed(k >= 10 ? 1 : 2).replace(/\.0$/, "")}K` : "—";
};

export default function TestingPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [tab, setTab] = useState<"RECEIVED" | "TESTED">("RECEIVED");
  const [testing, setTesting] = useState<QueueRow | null>(null);
  const [method, setMethod] = useState("xrf");
  const [permille, setPermille] = useState("");
  const [result, setResult] = useState("pass");
  const [q, setQ] = useState("");

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
  const waiting = queue.data?.total ?? waitingRows.length;
  const retests = retest.data?.total ?? testedRows.length;
  const loading = queue.isLoading || retest.isLoading;
  const waitingNet = waitingRows.reduce((s, r) => s + r.net_mg, 0);
  const testedNet = testedRows.reduce((s, r) => s + r.net_mg, 0);
  const oldest = waitingRows.reduce((m, r) => (r.created_at ? Math.min(m, r.created_at) : m), Infinity);
  const needle = q.trim().toLowerCase();
  const rows = (tab === "RECEIVED" ? waitingRows : testedRows).filter(
    (r) => !needle || [r.number, r.description, r.customer_name ?? ""].some((x) => x.toLowerCase().includes(needle))
  );

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={FlaskConicalIcon}
        title="Purity testing,"
        accent="assayed true"
        back={{ href: "/old-gold", label: "Old gold" }}
        badge={loading ? null : waiting ? <HeroBadge tone="warn">{waiting} to test</HeroBadge> : <HeroBadge tone="good">Queue clear</HeroBadge>}
        sub="Assay every received piece before valuation. A pass sets the purity; a fail or inconclusive result sends it back for a retest."
        actions={
          <Link href="/old-gold/intake" className={heroGhost}>
            <ScaleIcon size={13} /> New intake
          </Link>
        }
        stats={[
          { label: "Awaiting test", value: loading ? undefined : waiting, tone: waiting ? "warn" : "good", loading, sub: waiting ? "Received, not yet assayed" : "Queue is clear" },
          { label: "Metal waiting", value: loading ? undefined : waitingNet, format: grams, unit: "g", accent: true, loading, sub: "Net weight in the queue" },
          { label: "Oldest waiting", value: null, text: Number.isFinite(oldest) ? ago(oldest) : "—", loading, sub: "Since intake" },
          { label: "Tested", value: loading ? undefined : retests, loading, sub: "Passed · awaiting valuation" },
          { label: "Tested metal", value: loading ? undefined : testedNet, format: grams, unit: "g", loading, sub: "Ready to value" },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <Card>
          <CardHead
            icon={FlaskConicalIcon}
            title="Testing queue"
            sub={`${waiting + retests} item${waiting + retests === 1 ? "" : "s"} · test received pieces, retest tested ones`}
            action={
              <>
                <label className="relative">
                  <span className="sr-only">Filter queue</span>
                  <SearchIcon size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-5" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number, piece, customer…" className={cn(inputCls, "w-48 pl-7")} />
                </label>
                <FilterPills<"RECEIVED" | "TESTED">
                  value={tab}
                  onChange={setTab}
                  items={[
                    { key: "RECEIVED", label: "Awaiting test", count: waiting, dot: waiting ? "bg-amber-400" : undefined },
                    { key: "TESTED", label: "Tested", count: retests },
                  ]}
                />
              </>
            }
          />

          {loading ? (
            <RowsSkeleton rows={6} />
          ) : rows.length === 0 ? (
            <Empty
              icon={CheckCircleIcon}
              title={needle ? "No matches" : tab === "RECEIVED" ? "Nothing awaiting a test" : "No tested items"}
              desc={
                needle
                  ? "Try another number or description."
                  : tab === "RECEIVED"
                    ? "Every received piece has been assayed. New intake lands here automatically."
                    : "Passed items wait here for valuation and can be retested."
              }
              action={
                <Link href="/old-gold/intake" className="g-btn g-btn-primary h-8 rounded-lg px-3 text-[12px]">
                  <ScaleIcon size={12} /> New intake
                </Link>
              }
            />
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[600px] text-[12.5px]">
                <thead className={thead}>
                  <tr>
                    <th className={cn(th, "pl-4")}>Item</th>
                    <th className={th}>Piece</th>
                    <th className={th}>Customer</th>
                    <th className={cn(th, "text-right")}>Net g</th>
                    <th className={cn(th, "text-right")}>Waiting</th>
                    <th className={cn(th, "pr-4 text-right")}>
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const received = r.status === "RECEIVED";
                    return (
                      <tr key={r.id} className={cn(tr, "group cursor-pointer")} onClick={() => router.push(`/old-gold/items/${r.id}`)}>
                        <td className="relative whitespace-nowrap py-1.5 pl-4 pr-2">
                          <span aria-hidden className={cn("absolute inset-y-1 left-0 w-[3px] rounded-r-full", received ? "bg-amber-400" : "bg-gold")} />
                          <Link href={`/old-gold/items/${r.id}`} onClick={(e) => e.stopPropagation()} className="g-metric font-semibold text-ink group-hover:text-gold-deep">
                            {r.number}
                          </Link>
                        </td>
                        <td className="max-w-[18rem] truncate px-2 py-1.5 text-ink-3">{r.description}</td>
                        <td className="max-w-[10rem] truncate px-2 py-1.5 text-ink-4">{r.customer_name ?? "—"}</td>
                        <td className="g-metric px-2 py-1.5 text-right font-medium text-ink">{grams(r.net_mg)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right text-[11px] text-ink-4">{r.created_at ? ago(r.created_at) : "—"}</td>
                        <td className="py-1 pl-2 pr-4 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTesting(r);
                            }}
                            className={cn(
                              "inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[11.5px] font-semibold transition-colors",
                              received ? "bg-void text-paper hover:bg-void/90" : "text-ink-3 ring-1 ring-inset ring-ink/10 hover:bg-void hover:text-paper hover:ring-0"
                            )}
                          >
                            {received ? <FlaskConicalIcon size={11} className="text-gold-light" /> : <RefreshCwIcon size={11} />}
                            {received ? "Test" : "Retest"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-bone/70">
                  <tr className="border-t border-ink/10 text-[12px] font-semibold">
                    <td colSpan={3} className="py-1.5 pl-4 text-[9.5px] uppercase tracking-[0.14em] text-gold-dark">
                      Total · {rows.length} items
                    </td>
                    <td className="g-metric px-2 py-1.5 text-right text-gold-deep">{grams(rows.reduce((n, r) => n + r.net_mg, 0))}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHead icon={GemIcon} title="Common finenesses" sub="One tap in the test dialog" />
            <table className="w-full text-[12px]">
              <tbody>
                {PRESETS.map((pr) => (
                  <tr key={pr.permille} className={tr}>
                    <td className="py-1.5 pl-4">
                      <span className="g-metric rounded bg-gradient-to-b from-gold-light to-gold px-1.5 py-px text-[10px] font-bold text-void">{pr.karat}</span>
                    </td>
                    <td className="g-metric px-2 py-1.5 text-right text-ink">{pr.permille}‰</td>
                    <td className="g-metric py-1.5 pl-2 pr-4 text-right text-ink-4">{(pr.permille / 10).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card>
            <CardHead icon={FlaskConicalIcon} title="Methods" sub="Pick one when recording a test" />
            <ul className="divide-y divide-ink/[0.05] text-[12px]">
              {METHODS.map((m) => (
                <li key={m.key} className="flex items-center justify-between gap-3 px-4 py-1.5">
                  <span className="font-medium text-ink">{m.label}</span>
                  <span className="text-ink-4">{m.hint}</span>
                </li>
              ))}
            </ul>
            <p className="border-t border-ink/[0.06] bg-bone/40 px-4 py-2 text-[10.5px] leading-snug text-ink-4">
              Only a pass sets the purity ({karatOf(916)} = 916‰). Fail or inconclusive sends the piece back to the queue.
            </p>
          </Card>
        </div>
      </div>

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
