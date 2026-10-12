"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, Pager, Modal, controlClass } from "@/components/ui";
import { FlaskConicalIcon, GemIcon, PlusIcon } from "@/components/icons";
import {
  BATCH_META,
  BATCH_STATUSES,
  Card,
  CardHead,
  Empty,
  FilterPills,
  GoldHero,
  HeroBadge,
  MiniStats,
  RowsSkeleton,
  StatusChip,
  ago,
  grams,
  heroGold,
  th,
  thead,
  tr,
} from "../kit";

type Batch = { id: string; number: string; status: string; input_fine_mg: number; output_fine_mg: number; loss_mg: number; created_at: number };
type Paged = { rows: Batch[]; total: number };

const STATUSES: readonly string[] = BATCH_STATUSES;
const PAGE = 20;

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? "";
}

const yieldTone = (y: number) => (y >= 99 ? "text-emerald-700" : y >= 97 ? "text-amber-700" : "text-rose-700");

export default function MeltingPage() {
  const [page, setPage] = useState(1);
  const [fStatus, setFStatus] = useState("");
  const [dialog, setDialog] = useState(false);
  const [notes, setNotes] = useState("");
  const qc = useQueryClient();

  // The gold dashboard links here with ?status= or ?new=1.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get("status");
    if (s && STATUSES.includes(s)) setFStatus(s);
    if (q.get("new") === "1") setDialog(true);
  }, []);

  const list = useQuery({
    queryKey: ["melting", page, fStatus],
    queryFn: () => api<Paged>(`/api/v1/melting/batches?page=${page}&limit=${PAGE}${fStatus ? `&status=${fStatus}` : ""}`),
  });
  // One cheap count per status for the filter pills and the header.
  const counts = useQueries({
    queries: ["", ...STATUSES].map((s) => ({
      queryKey: ["melting", "count", s],
      queryFn: () => api<Paged>(`/api/v1/melting/batches?limit=1${s ? `&status=${s}` : ""}`),
      staleTime: 30_000,
      retry: false,
    })),
  });
  const countOf = (s: string) => counts[["", ...STATUSES].indexOf(s)]?.data?.total;

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
      qc.invalidateQueries({ queryKey: ["gold-dash"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const fineIn = rows.reduce((n, b) => n + b.input_fine_mg, 0);
  const done = rows.filter((b) => b.output_fine_mg > 0);
  const doneIn = done.reduce((n, b) => n + b.input_fine_mg, 0);
  const fineOut = done.reduce((n, b) => n + b.output_fine_mg, 0);
  const loss = rows.reduce((n, b) => n + b.loss_mg, 0);
  const pageYield = doneIn > 0 ? (fineOut / doneIn) * 100 : undefined;
  const active = (countOf("DRAFT") ?? 0) + (countOf("LOCKED") ?? 0) + (countOf("MELTED") ?? 0);
  const awaiting = countOf("MELTED") ?? 0;
  const countsLoading = counts.some((c) => c.isLoading);

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={FlaskConicalIcon}
        title="Melting"
        accent="batches"
        badge={awaiting > 0 ? <HeroBadge tone="warn">{awaiting} awaiting approval</HeroBadge> : <HeroBadge>Every milligram explained</HeroBadge>}
        sub="Old gold in, assayed lots out · loss and recovery reconcile on approval with a recorded reason"
        actions={
          <button type="button" onClick={() => setDialog(true)} className={heroGold}>
            <PlusIcon size={13} />
            New batch
          </button>
        }
        stats={[
          { label: "All batches", value: countOf(""), accent: true, loading: countsLoading, sub: `${countOf("VOID") ?? 0} void` },
          { label: "Active", value: countsLoading ? undefined : active, loading: countsLoading, sub: "Draft · locked · melted" },
          { label: "Draft", value: countOf("DRAFT"), loading: countsLoading, sub: BATCH_META.DRAFT!.hint },
          { label: "Locked", value: countOf("LOCKED"), loading: countsLoading, sub: BATCH_META.LOCKED!.hint },
          { label: "Melted", value: countOf("MELTED"), loading: countsLoading, tone: awaiting > 0 ? "warn" : undefined, sub: BATCH_META.MELTED!.hint },
          { label: "Approved", value: countOf("APPROVED"), loading: countsLoading, tone: "good", sub: BATCH_META.APPROVED!.hint },
        ]}
      />

      <Card>
        <CardHead
          icon={GemIcon}
          title="Batches"
          sub={`${total} ${fStatus ? BATCH_META[fStatus]?.label.toLowerCase() : ""} batch${total === 1 ? "" : "es"} · newest first`}
          action={
            <FilterPills
              value={fStatus}
              onChange={(s) => {
                setFStatus(s);
                setPage(1);
              }}
              items={[
                { key: "", label: "All", count: countOf("") },
                ...STATUSES.map((s) => ({ key: s, label: BATCH_META[s]!.label, count: countOf(s), dot: BATCH_META[s]!.dot })),
              ]}
            />
          }
        />
        <MiniStats
          items={[
            { k: "Fine in · this page", v: `${grams(fineIn)} g` },
            { k: "Fine out · melted", v: fineOut ? `${grams(fineOut)} g` : "—" },
            { k: "Yield · melted", v: pageYield !== undefined ? `${pageYield.toFixed(2)}%` : "—", tone: pageYield !== undefined ? yieldTone(pageYield) : undefined },
            { k: "Loss · this page", v: loss ? `${grams(loss)} g` : "—", tone: loss ? "text-rose-700" : undefined },
          ]}
        />
        {list.isLoading ? (
          <RowsSkeleton rows={6} />
        ) : list.isError ? (
          <Empty icon={GemIcon} title="Failed to load" desc="Check the API connection and retry." />
        ) : rows.length === 0 ? (
          <Empty
            icon={FlaskConicalIcon}
            title="No batches"
            desc={fStatus ? "Nothing in this status." : "Create the first melting batch to turn old gold into refined fine gold."}
            action={
              <button type="button" onClick={() => setDialog(true)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-void px-3 text-[12px] font-semibold text-gold-light">
                <PlusIcon size={12} /> New
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Batch</th>
                  <th className={th}>Status</th>
                  <th className={th}>Created</th>
                  <th className={cn(th, "text-right")}>Input fine g</th>
                  <th className={cn(th, "text-right")}>Output fine g</th>
                  <th className={cn(th, "w-[18%]")}>Yield</th>
                  <th className={cn(th, "pr-4 text-right")}>Loss g</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const y = b.input_fine_mg > 0 && b.output_fine_mg > 0 ? (b.output_fine_mg / b.input_fine_mg) * 100 : undefined;
                  return (
                    <tr key={b.id} className={tr}>
                      <td className="py-1.5 pl-4 pr-2">
                        <Link href={`/gold/melting/${b.id}`} className="g-metric font-semibold text-ink hover:text-gold-dark">
                          {b.number}
                        </Link>
                      </td>
                      <td className="px-2">
                        <StatusChip status={b.status} />
                      </td>
                      <td className="whitespace-nowrap px-2 text-ink-4" title={new Date(b.created_at).toLocaleString()}>
                        {ago(b.created_at)}
                      </td>
                      <td className="g-metric px-2 text-right text-ink-2">{grams(b.input_fine_mg)}</td>
                      <td className="g-metric px-2 text-right text-ink-2">{b.output_fine_mg ? grams(b.output_fine_mg) : "—"}</td>
                      <td className="px-2">
                        {y !== undefined ? (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/[0.06]">
                              <div
                                className={cn("h-full rounded-full", y >= 99 ? "bg-emerald-500" : y >= 97 ? "bg-amber-500" : "bg-rose-500")}
                                style={{ width: `${Math.min(100, y)}%` }}
                              />
                            </div>
                            <span className={cn("g-metric w-12 text-right text-[11px]", yieldTone(y))}>{y.toFixed(1)}%</span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-ink-6">Not melted</span>
                        )}
                      </td>
                      <td className={cn("g-metric py-1.5 pl-2 pr-4 text-right", b.loss_mg > 0 ? "text-rose-700" : "text-ink-5")}>
                        {b.loss_mg > 0 ? `−${grams(b.loss_mg)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-ink/[0.06] px-4 py-2">
          <Pager page={page} onChange={setPage} pageSize={PAGE} count={rows.length} total={total} unit="batches" />
        </div>
      </Card>

      {dialog ? (
        <Modal kicker="Gold" title="New melting batch" onClose={() => setDialog(false)} onSubmit={() => create.mutate()} pending={create.isPending} submitLabel="Create">
          <p className="text-[12.5px] leading-relaxed text-ink-4">
            The batch opens as a draft at your current branch. Scan old-gold items into it, then lock it for the furnace.
          </p>
          <label className="block text-sm text-ink-2">
            Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={controlClass} placeholder="Optional — e.g. furnace, smith, lot" />
          </label>
        </Modal>
      ) : null}
    </Page>
  );
}
