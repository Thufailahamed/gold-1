"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  Page,
  Hero,
  TableCard,
  TableSkeleton,
  Pager,
  EmptyBlock,
  Pill,
  type PillTone,
  Modal,
  controlClass,
  heroBtnPrimary,
} from "@/components/ui";
import { GemIcon } from "@/components/icons";

type Batch = { id: string; number: string; status: string; input_fine_mg: number; output_fine_mg: number; loss_mg: number; created_at: number };

const STATUSES = ["DRAFT", "LOCKED", "MELTED", "APPROVED", "VOID"];
const TONES: Record<string, PillTone> = {
  DRAFT: "neutral",
  LOCKED: "warning",
  MELTED: "info",
  APPROVED: "success",
  VOID: "danger",
};

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? "";
}

const g = (mg: number) => (mg / 1000).toLocaleString("en-US");

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
  const fineIn = rows.reduce((n, b) => n + b.input_fine_mg, 0);
  const fineOut = rows.reduce((n, b) => n + b.output_fine_mg, 0);

  return (
    <Page>
      <Hero
        kicker="Gold · Vault"
        title="Melting batches"
        description="Old gold in, assayed lots out — every difference explained."
        note="Loss and recovery reconcile on approval — differences need a recorded reason."
        stats={[
          { label: "Batches", value: total },
          { label: "Fine in", value: `${g(fineIn)} g` },
          { label: "Fine out", value: `${g(fineOut)} g` },
        ]}
        actions={
          <button onClick={() => setDialog(true)} className={heroBtnPrimary}>
            New batch
          </button>
        }
      />
      <div className="flex flex-wrap gap-2">
        <select value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(1); }} className={controlClass}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <TableCard
        title="Batches"
        icon={<GemIcon size={17} />}
        actions={<span className="g-metric text-[11px] font-medium uppercase tracking-[0.14em] text-ink-4">{String(total).padStart(2, "0")} on file</span>}
        footer={<Pager page={page} onChange={setPage} pageSize={20} count={rows.length} total={total} unit="batches" />}
      >
        {list.isLoading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : list.isError ? (
          <EmptyBlock title="Failed to load" description="Check the API connection and retry." />
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
                  <td>
                    <Link href={`/gold/melting/${b.id}`} className="g-metric font-medium text-ink hover:text-gold-700">
                      {b.number}
                    </Link>
                  </td>
                  <td><Pill tone={TONES[b.status] ?? "neutral"} dot>{b.status}</Pill></td>
                  <td className="!text-right num-tabular">{g(b.input_fine_mg)}</td>
                  <td className="!text-right num-tabular">{g(b.output_fine_mg)}</td>
                  <td className={`!text-right num-tabular ${b.loss_mg > 0 ? "text-rose-600" : ""}`}>{b.loss_mg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      {dialog ? (
        <Modal
          kicker="Gold"
          title="New melting batch"
          onClose={() => setDialog(false)}
          onSubmit={() => create.mutate()}
          pending={create.isPending}
          submitLabel="Create"
        >
          <label className="block text-sm text-ink-2">Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={controlClass} />
          </label>
        </Modal>
      ) : null}
    </Page>
  );
}
