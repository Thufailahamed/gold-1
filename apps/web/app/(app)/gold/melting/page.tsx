"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Page, Hero, TableCard, TableSkeleton, Pager, EmptyBlock, controlClass } from "@/components/ui";

type Batch = { id: string; number: string; status: string; input_fine_mg: number; output_fine_mg: number; loss_mg: number; created_at: number };

const STATUSES = ["DRAFT", "LOCKED", "MELTED", "APPROVED", "VOID"];

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? "";
}

export default function MeltingPage() {
  const [page, setPage] = useState(1);
  const [fStatus, setFStatus] = useState("");
  const [dialog, setDialog] = useState(false);
  const [notes, setNotes] = useState("");
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["melting", page, fStatus],
    queryFn: () =>
      api<{ rows: Batch[]; total: number }>(
        `/api/v1/melting/batches?page=${page}&limit=20${fStatus ? `&status=${fStatus}` : ""}`
      ),
  });
  const create = useMutation({
    mutationFn: () =>
      api<{ id: string; number: string }>("/api/v1/melting/batches", {
        method: "POST",
        body: JSON.stringify({ branchId: branchDefault(), notes: notes || undefined }),
      }),
    onSuccess: (d) => {
      toast.success(`Batch ${d.number} created`);
      setDialog(false);
      setNotes("");
      qc.invalidateQueries({ queryKey: ["melting"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;

  return (
    <Page>
      <Hero
        kicker="Gold"
        title="Melting batches"
        description="Old gold in, assayed lots out — every difference explained."
        actions={
          <button onClick={() => setDialog(true)} className="g-btn bg-gold px-4 text-sm text-ink">
            New batch
          </button>
        }
      />
      <div>
        <select value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(1); }} className={controlClass}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <TableCard footer={<Pager page={page} onChange={setPage} pageSize={20} count={rows.length} total={total} unit="batches" />}>
        {list.isLoading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No batches" description="Create the first melting batch." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Status</th>
                <th className="!text-right">Input fine g</th>
                <th className="!text-right">Output fine g</th>
                <th className="!text-right">Loss mg</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td className="font-mono">
                    <Link href={`/gold/melting/${b.id}`} className="hover:underline">{b.number}</Link>
                  </td>
                  <td>{b.status}</td>
                  <td className="!text-right">{(b.input_fine_mg / 1000).toLocaleString("en-US")}</td>
                  <td className="!text-right">{(b.output_fine_mg / 1000).toLocaleString("en-US")}</td>
                  <td className="!text-right">{b.loss_mg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      {dialog ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-lg">
            <h2 className="font-semibold">New melting batch</h2>
            <label className="block text-sm">Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} className={controlClass} /></label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDialog(false)} className="rounded-md border px-3 py-2 text-sm">Cancel</button>
              <button onClick={() => create.mutate()} disabled={create.isPending} className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50">
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Page>
  );
}
