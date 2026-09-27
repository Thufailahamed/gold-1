"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";

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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Gold Rates</h1>
          <p className="text-sm text-stone-500">Current buying rates per gram</p>
        </div>
        <button
          onClick={() => setDialog(true)}
          className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
        >
          Publish rate
        </button>
      </div>
      {current.isLoading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-stone-200" />
          ))}
        </div>
      ) : current.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load current rates.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {current.data!.map((r) => (
            <div key={r.purity_id} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-stone-500">{r.karat}</p>
              <p className="mt-1 text-2xl font-semibold">
                {r.rate_per_gram.toLocaleString()} <span className="text-sm font-normal">LKR/g</span>
              </p>
              <p className="mt-1 text-xs text-stone-400">
                From {new Date(r.effective_from).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
              <th className="px-4 py-2">Karat</th>
              <th className="px-4 py-2">Rate/g</th>
              <th className="px-4 py-2">Effective from</th>
            </tr>
          </thead>
          <tbody>
            {(history.data?.rows ?? []).map((r) => (
              <tr key={r.id} className="border-b border-stone-100 last:border-0">
                <td className="px-4 py-2">{r.karat}</td>
                <td className="px-4 py-2">{r.rate_per_gram.toLocaleString()} LKR</td>
                <td className="px-4 py-2">{new Date(r.effective_from).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dialog ? (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
          <form
            onSubmit={handleSubmit((v) => create.mutate(v))}
            className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-lg"
          >
            <h2 className="font-semibold">Publish rate</h2>
            <div>
              <label className="mb-1 block text-sm font-medium">Purity</label>
              <select
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                {...register("purityId")}
              >
                <option value="">Select…</option>
                {(purities.data?.rows ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.karat}
                  </option>
                ))}
              </select>
              {errors.purityId ? <p className="mt-1 text-xs text-red-600">Select a purity</p> : null}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Rate per gram (LKR)</label>
              <input
                type="number"
                step="any"
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                {...register("ratePerGram")}
              />
              {errors.ratePerGram ? <p className="mt-1 text-xs text-red-600">Must be above 0</p> : null}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Effective from</label>
              <input
                type="datetime-local"
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                {...register("effectiveFrom")}
              />
              {errors.effectiveFrom ? <p className="mt-1 text-xs text-red-600">Required</p> : null}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDialog(false)} className="rounded-md border px-3 py-2 text-sm">
                Cancel
              </button>
              <button
                type="submit"
                disabled={create.isPending}
                className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {create.isPending ? "Publishing…" : "Publish"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
