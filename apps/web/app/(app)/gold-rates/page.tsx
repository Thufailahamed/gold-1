"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, Callout, Modal, controlClass } from "@/components/ui";
import { Card, CardHead, Empty, GoldHero, HeroBadge, RowsSkeleton, ago, heroGhost, heroGold, stamp, th, thead, tr } from "@/components/console-kit";
import { CoinsIcon, HistoryIcon, TrendingUpIcon } from "@/components/icons";

type Rate = {
  id: string;
  purity_id: string;
  karat: string;
  rate_per_gram: number;
  effective_from: number;
  created_at: number;
};

type Purity = { id: string; karat: string };

const rateSchema = z.object({
  purityId: z.string().min(1),
  ratePerGram: z.coerce.number().gt(0),
  effectiveFrom: z.string().min(1),
});

export default function GoldRatesPage() {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState(false);
  const current = useQuery({
    queryKey: ["gold-rates-current"],
    queryFn: () => api<Rate[]>("/api/v1/gold-rates/current"),
  });
  const history = useQuery({
    queryKey: ["gold-rates-history"],
    queryFn: () => api<{ rows: Rate[]; total: number }>("/api/v1/gold-rates?limit=50"),
  });
  const purities = useQuery({
    queryKey: ["purities-all"],
    queryFn: () => api<{ rows: Purity[]; total: number }>("/api/v1/masters/purities?limit=100"),
  });
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<z.infer<typeof rateSchema>>({ resolver: zodResolver(rateSchema) });
  const create = useMutation({
    mutationFn: (v: z.infer<typeof rateSchema>) =>
      api("/api/v1/gold-rates", {
        method: "POST",
        body: JSON.stringify({
          purityId: v.purityId,
          ratePerGram: v.ratePerGram,
          effectiveFrom: new Date(v.effectiveFrom).getTime(),
        }),
      }),
    onSuccess: () => {
      toast.success("Rate published");
      setDialog(false);
      reset();
      qc.invalidateQueries({ queryKey: ["gold-rates-current"] });
      qc.invalidateQueries({ queryKey: ["gold-rates-history"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Publish failed"),
  });

  const rates = [...(current.data ?? [])].sort((x, y) => y.rate_per_gram - x.rate_per_gram);
  const hist = history.data?.rows ?? [];
  // Newest first from the API; per purity, oldest → newest for sparklines.
  const byPurity = new Map<string, Rate[]>();
  for (const r of [...hist].sort((x, y) => x.effective_from - y.effective_from)) {
    byPurity.set(r.purity_id, [...(byPurity.get(r.purity_id) ?? []), r]);
  }
  /** The revision before this one, for the same purity. */
  const prevOf = (r: Rate) => {
    const seq = byPurity.get(r.purity_id) ?? [];
    const i = seq.findIndex((x) => x.id === r.id);
    return i > 0 ? seq[i - 1] : undefined;
  };
  const prevForCurrent = (r: Rate) => {
    const seq = (byPurity.get(r.purity_id) ?? []).filter((x) => x.effective_from < r.effective_from);
    return seq[seq.length - 1];
  };
  const top = rates[0];
  const latest = rates.reduce<number | null>((a, r) => (a == null || r.effective_from > a ? r.effective_from : a), null);
  const unpublished = (purities.data?.rows ?? []).filter((p) => !rates.some((r) => r.purity_id === p.id));
  const dayAgo = Date.now() - 86_400_000;
  const today = hist.filter((r) => r.created_at >= dayAgo).length;
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={CoinsIcon}
        title="Gold"
        accent="Rates"
        badge={<HeroBadge tone={unpublished.length ? "warn" : "good"}>{unpublished.length ? `${unpublished.length} unpriced` : "Board complete"}</HeroBadge>}
        sub={latest ? `Board last changed ${ago(latest)} · applies instantly to intake and pricing in every branch` : "Publish a board rate per purity"}
        back={{ href: "/setup", label: "Setup" }}
        actions={
          <>
            <Link href="/live-rates" className={heroGhost}>
              <TrendingUpIcon size={13} />
              Live market
            </Link>
            <button onClick={() => setDialog(true)} className={heroGold}>
              <CoinsIcon size={13} />
              Publish rate
            </button>
          </>
        }
        stats={[
          { label: top ? `Top board · ${top.karat}` : "Top board", value: top?.rate_per_gram, format: fmt, unit: "LKR/g", accent: true, loading: current.isLoading },
          { label: "Pawn · 8 g", value: top ? top.rate_per_gram * 8 : undefined, format: fmt, unit: "LKR", loading: current.isLoading, sub: top?.karat },
          { label: "Purities priced", value: rates.length, loading: current.isLoading, sub: purities.data ? `of ${purities.data.total} defined` : undefined, tone: unpublished.length ? "warn" : "good" },
          { label: "Revisions", value: history.data?.total, loading: history.isLoading, sub: "all time" },
          { label: "Changes · 24h", value: history.isLoading ? undefined : today, loading: history.isLoading, sub: "in the last day" },
          { label: "Last change", value: null, text: latest ? ago(latest) : "—", sub: latest ? stamp(latest) : undefined },
        ]}
      />

      {current.isError ? (
        <Callout tone="danger" title="Failed to load current rates">
          Check the API connection and retry.
        </Callout>
      ) : null}
      {unpublished.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-500/10 px-4 py-2.5 text-[12px] text-amber-900 ring-1 ring-inset ring-amber-500/25">
          <span className="size-1.5 rounded-full bg-amber-500" />
          No board rate yet for
          {unpublished.map((p) => (
            <span key={p.id} className="g-metric rounded bg-amber-500/15 px-1.5 py-px text-[11px] font-semibold">
              {p.karat}
            </span>
          ))}
          <button onClick={() => setDialog(true)} className="ml-auto rounded-md bg-void px-2.5 py-1 text-[11px] font-semibold text-gold-light">
            Publish now
          </button>
        </div>
      ) : null}

      {/* the board */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {current.isLoading
          ? [0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[118px] animate-pulse rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(16,32,27,0.06)]" />)
          : rates.map((r, i) => {
              const prev = prevForCurrent(r);
              const d = prev ? ((r.rate_per_gram - prev.rate_per_gram) / prev.rate_per_gram) * 100 : null;
              const seq = byPurity.get(r.purity_id) ?? [];
              return (
                <div
                  key={r.purity_id}
                  className={cn(
                    "relative overflow-hidden rounded-2xl p-3.5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_18px_40px_-30px_rgba(16,32,27,0.3)]",
                    i === 0 ? "bg-void text-paper" : "bg-paper"
                  )}
                >
                  {i === 0 ? <div className="pointer-events-none absolute -right-10 -top-12 size-40 rounded-full bg-gold/20 blur-3xl" /> : null}
                  <div className="relative flex items-center justify-between">
                    <span className="g-metric rounded-md bg-gradient-to-b from-gold-light to-gold px-1.5 py-0.5 text-[11px] font-bold text-void">{r.karat}</span>
                    {d != null ? (
                      <span
                        className={cn(
                          "g-metric rounded-full px-1.5 py-px text-[10px] font-semibold",
                          d > 0 ? "bg-emerald-500/15 text-emerald-600" : d < 0 ? "bg-rose-500/15 text-rose-600" : "bg-ink/10 text-ink-4"
                        )}
                      >
                        {d > 0 ? "▲" : d < 0 ? "▼" : ""}
                        {Math.abs(d).toFixed(2)}%
                      </span>
                    ) : (
                      <span className={cn("text-[10px]", i === 0 ? "text-paper/40" : "text-ink-5")}>first rate</span>
                    )}
                  </div>
                  <div className="relative mt-2 flex items-baseline gap-1">
                    <span className={cn("g-metric text-[22px] leading-none", i === 0 ? "text-gold-light" : "text-ink")}>{fmt(r.rate_per_gram)}</span>
                    <span className={cn("text-[10px] font-semibold", i === 0 ? "text-paper/40" : "text-ink-5")}>LKR/g</span>
                  </div>
                  <div className={cn("relative mt-1 text-[10.5px]", i === 0 ? "text-paper/45" : "text-ink-4")}>
                    Pawn <span className="g-metric">{fmt(r.rate_per_gram * 8)}</span> · {ago(r.effective_from)}
                  </div>
                  <Spark values={seq.map((x) => x.rate_per_gram)} dark={i === 0} />
                </div>
              );
            })}
      </div>

      <Card>
        <CardHead
          icon={HistoryIcon}
          title="Rate history"
          sub={`Last ${hist.length} published rates · change is against the previous rate for the same purity`}
        />
        {history.isLoading ? (
          <RowsSkeleton rows={6} />
        ) : hist.length === 0 ? (
          <Empty icon={CoinsIcon} title="No rates yet" desc="Publish the first board rate to begin." />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-[12.5px]">
              <thead className={thead}>
                <tr>
                  <th className={cn(th, "pl-4")}>Karat</th>
                  <th className={cn(th, "text-right")}>Rate / g</th>
                  <th className={cn(th, "text-right")}>Pawn</th>
                  <th className={cn(th, "text-right")}>Change</th>
                  <th className={cn(th, "text-right")}>Was</th>
                  <th className={th}>Effective from</th>
                  <th className={cn(th, "pr-4")}>Published</th>
                </tr>
              </thead>
              <tbody>
                {hist.map((r) => {
                  const prev = prevOf(r);
                  const diff = prev ? r.rate_per_gram - prev.rate_per_gram : null;
                  const live = rates.some((c) => c.purity_id === r.purity_id && c.effective_from === r.effective_from);
                  return (
                    <tr key={r.id} className={tr}>
                      <td className="py-1.5 pl-4 pr-2">
                        <span className="flex items-center gap-2">
                          <span className="g-metric rounded bg-gradient-to-b from-gold-light to-gold px-1.5 py-px text-[10px] font-bold text-void">{r.karat}</span>
                          {live ? <span className="rounded-full bg-emerald-600/10 px-1.5 text-[9.5px] font-semibold text-emerald-700">On board</span> : null}
                        </span>
                      </td>
                      <td className="g-metric px-2 text-right font-semibold text-ink">{fmt(r.rate_per_gram)}</td>
                      <td className="g-metric px-2 text-right text-ink-3">{fmt(r.rate_per_gram * 8)}</td>
                      <td
                        className={cn(
                          "g-metric px-2 text-right text-[11.5px] font-semibold",
                          diff == null ? "text-ink-6" : diff > 0 ? "text-emerald-700" : diff < 0 ? "text-rose-700" : "text-ink-4"
                        )}
                      >
                        {diff == null ? "—" : `${diff > 0 ? "+" : ""}${fmt(diff)} (${((diff / prev!.rate_per_gram) * 100).toFixed(2)}%)`}
                      </td>
                      <td className="g-metric px-2 text-right text-ink-5">{prev ? fmt(prev.rate_per_gram) : "—"}</td>
                      <td className="whitespace-nowrap px-2 text-ink-3">{stamp(r.effective_from)}</td>
                      <td className="whitespace-nowrap px-2 pr-4 text-ink-5">{ago(r.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dialog ? (
        <Modal title="Publish rate" kicker="Board rate" onClose={() => setDialog(false)} footer={false}>
          <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">Purity</label>
              <select className={controlClass} {...register("purityId")}>
                <option value="">Select…</option>
                {(purities.data?.rows ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.karat}
                  </option>
                ))}
              </select>
              {errors.purityId ? <p className="mt-1 text-xs text-rose-700">Select a purity</p> : null}
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">
                Rate per gram (LKR)
              </label>
              <input
                type="number"
                step="any"
                className={controlClass}
                {...register("ratePerGram")}
              />
              {errors.ratePerGram ? <p className="mt-1 text-xs text-rose-700">Must be above 0</p> : null}
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">Effective from</label>
              <input type="datetime-local" className={controlClass} {...register("effectiveFrom")} />
              {errors.effectiveFrom ? <p className="mt-1 text-xs text-rose-700">Required</p> : null}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDialog(false)}
                className="g-btn g-btn-secondary h-10 px-4 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={create.isPending}
                className="g-btn g-btn-primary h-10 px-4 text-sm"
              >
                {create.isPending ? "Publishing…" : "Publish"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </Page>
  );
}

/** Tiny trend of a purity's published rates. */
function Spark({ values, dark }: { values: number[]; dark?: boolean }) {
  if (values.length < 2) return <div className="mt-2 h-6" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${22 - ((v - min) / span) * 20}`).join(" ");
  const up = values[values.length - 1]! >= values[0]!;
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="relative mt-2 h-6 w-full" aria-hidden>
      <polyline points={pts} fill="none" stroke={dark ? "#E2C27A" : up ? "#059669" : "#E11D48"} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
