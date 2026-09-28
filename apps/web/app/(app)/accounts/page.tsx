"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import {
  Page,
  Hero,
  TableCard,
  TableSkeleton,
  EmptyBlock,
  StatusPill,
  controlClass,
  heroBtnPrimary,
} from "@/components/ui";
import { XIcon } from "@/components/icons";

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
  const fmt = (c: number) => (c / 100).toLocaleString("en-US");
  const byType = (t: string) => rows.filter((r) => r.type === t).reduce((n, r) => n + Math.abs(r.balance_cents), 0);

  return (
    <Page>
      <Hero
        kicker="System"
        title="Chart of accounts"
        description="Double-entry books — every balance derives from a posted journal."
        note="Adjustments post a balanced journal entry: one debit, one credit, one amount, a required reason."
        stats={[
          { label: "Accounts", value: rows.length },
          { label: "Assets", value: `${fmt(byType("ASSET"))} LKR` },
          { label: "Liabilities", value: `${fmt(byType("LIABILITY"))} LKR` },
          { label: "Equity", value: `${fmt(byType("EQUITY"))} LKR` },
        ]}
        actions={
          canManage ? (
            <button onClick={() => setDialog(true)} className={heroBtnPrimary}>
              Post adjustment
            </button>
          ) : null
        }
      />
      <div className="flex flex-wrap gap-2">
        <input
          placeholder="Filter by branch ID (optional)…"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          className={controlClass}
        />
      </div>
      <TableCard>
        {chart.isLoading ? (
          <TableSkeleton rows={8} cols={4} />
        ) : chart.isError ? (
          <EmptyBlock title="Failed to load" description="Check the API connection and retry." />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No accounts" description="Accounts appear as journals post to them." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Account</th>
                <th>Type</th>
                <th className="!text-right">Balance LKR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.code}>
                  <td className="g-metric text-xs">{a.code}</td>
                  <td className="font-medium text-ink">{a.name}</td>
                  <td><StatusPill status={a.type} /></td>
                  <td className={`!text-right num-tabular ${a.balance_cents < 0 ? "text-rose-600" : ""}`}>
                    {fmt(a.balance_cents)}
                  </td>
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
            onSubmit={handleSubmit((v) => adjust.mutate(v))}
            className="g-floating w-full max-w-md animate-fade-in space-y-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="g-kicker">Journal</div>
                <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-ink">Post adjustment</h2>
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
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm text-ink-2">Debit account
                <select className={controlClass} {...register("debitAccount")}>
                  <option value="">Select…</option>
                  {rows.map((a) => (
                    <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-ink-2">Credit account
                <select className={controlClass} {...register("creditAccount")}>
                  <option value="">Select…</option>
                  {rows.map((a) => (
                    <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-sm text-ink-2">Amount LKR
              <input type="number" step="any" className={`num-tabular ${controlClass}`} {...register("amountLkr")} />
            </label>
            <label className="block text-sm text-ink-2">Memo
              <input className={controlClass} {...register("memo")} />
            </label>
            <label className="block text-sm text-ink-2">Reason (required)
              <input className={controlClass} {...register("reason")} />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setDialog(false)} className="g-btn g-btn-secondary h-10 px-4 text-sm">
                Cancel
              </button>
              <button type="submit" disabled={adjust.isPending} className="g-btn g-btn-primary h-10 px-4 text-sm">
                {adjust.isPending ? "Posting…" : "Post"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </Page>
  );
}
