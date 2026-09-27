"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  Page,
  Hero,
  heroBtnPrimary,
  StatGrid,
  StatCard,
  TableCard,
  TableSkeleton,
  EmptyBlock,
  Callout,
  controlClass,
} from "@/components/ui";
import { ArrowRightIcon, CoinsIcon, TrendingUpIcon, XIcon } from "@/components/icons";

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

  return (
    <Page>
      <Hero
        kicker="Masters · Live board"
        title="Gold Rates"
        description="Current buying rates per gram, published by purity."
        actions={
          <button onClick={() => setDialog(true)} className={heroBtnPrimary}>
            <CoinsIcon size={15} />
            Publish rate
            <ArrowRightIcon size={14} className="g-btn-arrow" />
          </button>
        }
        stats={(() => {
          const rates = current.data ?? [];
          const top = rates.length
            ? rates.reduce((a, b) => (a.rate_per_gram >= b.rate_per_gram ? a : b))
            : null;
          return [
            {
              label: top ? `Board rate · ${top.karat}` : "Board rate",
              value: top ? `${top.rate_per_gram.toLocaleString()} LKR/g` : "—",
            },
            { label: "Purities", value: current.isLoading ? "—" : rates.length },
            { label: "Revisions", value: history.data?.total ?? "—" },
          ];
        })()}
        note="Published rates apply instantly to intake and live pricing across all branches"
      />

      {current.isLoading ? (
        <StatGrid cols={4}>
          {[0, 1, 2, 3].map((i) => (
            <StatCard key={i} label="—" value="—" loading icon={<CoinsIcon size={16} />} />
          ))}
        </StatGrid>
      ) : current.isError ? (
        <Callout tone="danger" title="Failed to load current rates">
          Check the API connection and retry.
        </Callout>
      ) : (
        <StatGrid cols={4}>
          {current.data!.map((r) => (
            <StatCard
              key={r.purity_id}
              label={r.karat}
              value={r.rate_per_gram.toLocaleString()}
              sub={`From ${new Date(r.effective_from).toLocaleString()}`}
              icon={<TrendingUpIcon size={16} />}
              status={<span className="text-[11px] font-semibold text-ink-4">LKR/g</span>}
            />
          ))}
        </StatGrid>
      )}

      <TableCard title="Rate history" description="Last 50 published rates">
        {history.isLoading ? (
          <TableSkeleton rows={5} cols={3} />
        ) : (history.data?.rows ?? []).length === 0 ? (
          <EmptyBlock title="No rates yet" description="Publish the first board rate to begin." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Karat</th>
                <th className="!text-right">Rate/g</th>
                <th>Effective from</th>
              </tr>
            </thead>
            <tbody>
              {(history.data?.rows ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.karat}</td>
                  <td className="num">{r.rate_per_gram.toLocaleString()} LKR</td>
                  <td className="text-ink-3">{new Date(r.effective_from).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {dialog ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
          onClick={() => setDialog(false)}
        >
          <form
            onSubmit={handleSubmit((v) => create.mutate(v))}
            className="g-floating w-full max-w-md animate-fade-in space-y-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="g-kicker">Board rate</div>
                <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-ink">
                  Publish rate
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDialog(false)}
                aria-label="Close"
                className="flex size-8 items-center justify-center rounded-lg text-ink-4 transition-colors hover:bg-ink/5 hover:text-ink"
              >
                <XIcon size={16} />
              </button>
            </div>
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
        </div>
      ) : null}
    </Page>
  );
}
