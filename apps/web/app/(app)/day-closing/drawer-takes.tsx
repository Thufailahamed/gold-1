"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardHead } from "@/components/console-kit";
import { controlClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { BanknoteIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { fmt } from "./panels";

type Take = { id: string; number: string; kind: "OWNER_DRAWING" | "STAFF_TAKE"; amount_cents: number; person: string | null; note: string };

/**
 * Cash the owner or an employee took from the drawer. Saved the moment it is
 * added — at the time it happens or while closing — and the expected closing
 * cash above drops by it, so the count balances.
 */
export function DrawerTakes({ branchId, date, canRecord, locked }: { branchId: string; date: string; canRecord: boolean; locked: boolean }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<Take["kind"]>("STAFF_TAKE");
  const [person, setPerson] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const takes = useQuery({
    queryKey: ["day-drawer-takes", branchId, date],
    queryFn: () => api<{ rows: Take[] }>(`/api/v1/day-closings/drawer-takes?branchId=${encodeURIComponent(branchId)}&date=${date}`),
  });
  const cents = Math.round(Number(amount) * 100);
  const valid = cents > 0 && note.trim().length > 0 && (kind === "OWNER_DRAWING" || person.trim().length > 0);

  const add = useMutation({
    mutationFn: () =>
      api("/api/v1/day-closings/drawer-takes", {
        method: "POST",
        body: JSON.stringify({ branchId, date, kind, amountCents: cents, person: person.trim() || undefined, note: note.trim() }),
      }),
    onSuccess: () => {
      toast.success("Recorded — expected cash updated");
      setAmount("");
      setNote("");
      qc.invalidateQueries({ queryKey: ["day-drawer-takes"] });
      qc.invalidateQueries({ queryKey: ["day-closing-preview"] });
      qc.invalidateQueries({ queryKey: ["day-summary"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not record"),
  });

  const rows = takes.data?.rows ?? [];
  const total = rows.reduce((s, r) => s + r.amount_cents, 0);

  return (
    <Card>
      <CardHead icon={BanknoteIcon} title="Cash taken from the drawer" sub="By the owner or an employee — record it now or while closing" />
      <div className="space-y-3 p-4">
        {rows.length ? (
          <div className="divide-y divide-ink/[0.06] rounded-xl ring-1 ring-inset ring-ink/[0.06]">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[12px]">
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{r.kind === "OWNER_DRAWING" ? "Owner" : r.person}</span>
                  <span className="text-ink-4"> · {r.note}</span>
                </span>
                <span className="g-metric shrink-0 text-rose-700">− {fmt(r.amount_cents)}</span>
              </div>
            ))}
            <div className="flex justify-between px-3 py-2 text-[12px] font-semibold">
              <span>Total taken</span>
              <span className="g-metric">{fmt(total)}</span>
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-ink-4">Nothing taken from the drawer on this day.</p>
        )}

        {canRecord && !locked ? (
          <div className="grid gap-2 md:grid-cols-[auto_1fr_8rem_1fr_auto]">
            <span className="flex rounded-lg bg-ink/[0.05] p-0.5 text-[11px] font-semibold">
              {([["STAFF_TAKE", "Employee"], ["OWNER_DRAWING", "Owner"]] as const).map(([v, t]) => (
                <button key={v} type="button" onClick={() => setKind(v)} className={cn("h-7 rounded-md px-2.5", kind === v ? "bg-void text-gold-light" : "text-ink-4 hover:text-ink")}>
                  {t}
                </button>
              ))}
            </span>
            <input
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              disabled={kind === "OWNER_DRAWING"}
              placeholder={kind === "OWNER_DRAWING" ? "Owner" : "Employee name"}
              className={cn(controlClass, "w-full")}
            />
            <input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" className={cn(controlClass, "w-full")} />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (e.g. salary advance, personal)" className={cn(controlClass, "w-full")} />
            <button
              type="button"
              disabled={!valid || add.isPending}
              onClick={() => add.mutate()}
              className="h-9 rounded-lg bg-void px-3 text-[12px] font-semibold text-gold-light disabled:opacity-40"
            >
              Record
            </button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
