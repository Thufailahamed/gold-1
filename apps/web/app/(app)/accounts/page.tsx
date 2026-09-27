"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";

type Account = { code: string; name: string; type: string; balance_cents: number };

const adjustSchema = z.object({
  debitAccount: z.string().min(1),
  creditAccount: z.string().min(1),
  amountLkr: z.coerce.number().gt(0),
  memo: z.string().max(500).optional(),
  reason: z.string().min(1).max(500),
});

export default function AccountsPage() {
  const [branch, setBranch] = useState("");
  const [dialog, setDialog] = useState(false);
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canManage = hasPermission(me.data?.permissions ?? [], "accounts:manage");

  const chart = useQuery({
    queryKey: ["accounts", branch],
    queryFn: () =>
      api<Account[]>(`/api/v1/accounts${branch ? `?branchId=${encodeURIComponent(branch)}` : ""}`),
  });

  const { register, handleSubmit, reset } = useForm<z.infer<typeof adjustSchema>>({
    resolver: zodResolver(adjustSchema),
  });
  const adjust = useMutation({
    mutationFn: (v: z.infer<typeof adjustSchema>) =>
      api("/api/v1/accounts/adjustments", {
        method: "POST",
        body: JSON.stringify({
          debitAccount: v.debitAccount,
          creditAccount: v.creditAccount,
          amountCents: Math.round(v.amountLkr * 100),
          memo: v.memo,
          reason: v.reason,
        }),
      }),
    onSuccess: () => {
      toast.success("Adjustment posted");
      setDialog(false);
      reset();
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Post failed"),
  });

  const rows = chart.data ?? [];
  const inputCls =
    "w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Chart of Accounts</h1>
          <p className="text-sm text-stone-500">Double-entry books; balances derived from journal</p>
        </div>
        {canManage ? (
          <button
            onClick={() => setDialog(true)}
            className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
          >
            Adjustment
          </button>
        ) : null}
      </div>
      <input
        placeholder="Branch filter (ID, optional)"
        value={branch}
        onChange={(e) => setBranch(e.target.value)}
        className="w-full max-w-sm rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
      />
      {chart.isLoading ? (
        <div className="h-48 animate-pulse rounded-xl bg-stone-200" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2 text-right">Balance LKR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.code} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-2 font-mono">{a.code}</td>
                  <td className="px-4 py-2">{a.name}</td>
                  <td className="px-4 py-2">{a.type}</td>
                  <td className="px-4 py-2 text-right">
                    {(a.balance_cents / 100).toLocaleString("en-US")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog ? (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
          <form
            onSubmit={handleSubmit((v) => adjust.mutate(v))}
            className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-lg"
          >
            <h2 className="font-semibold">Post adjustment</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Debit account</label>
                <select className={inputCls} {...register("debitAccount")}>
                  <option value="">Select…</option>
                  {rows.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Credit account</label>
                <select className={inputCls} {...register("creditAccount")}>
                  <option value="">Select…</option>
                  {rows.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Amount LKR</label>
              <input type="number" step="any" className={inputCls} {...register("amountLkr")} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Memo</label>
              <input className={inputCls} {...register("memo")} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Reason (required)</label>
              <input className={inputCls} {...register("reason")} />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(false)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={adjust.isPending}
                className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                Post
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
