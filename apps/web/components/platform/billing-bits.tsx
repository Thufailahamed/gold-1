"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Modal, Pill, StatusPill, controlClass } from "@/components/ui";
import { F } from "@/components/platform/dialogs";
import { cn } from "@/lib/cn";
import { date, money, papi, titleCase, toCents } from "@/lib/platform";

export type InvoiceRow = { id: string; number: string; kind: string; status: string; total_cents: number; amount_paid_cents: number; issued_at: number; due_at: number; currency: string };
export function InvoiceTable({ rows, onOpen, showTenant }: { rows: Array<InvoiceRow & { tenant_name?: string }>; onOpen: (id: string) => void; showTenant?: boolean }) {
  return (
    <table className="g-table">
      <thead>
        <tr>
          <th>Number</th>
          {showTenant ? <th>Account</th> : null}
          <th>Status</th>
          <th>Issued</th>
          <th>Due</th>
          <th className="!text-right">Total</th>
          <th className="!text-right">Balance</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const overdue = r.status === "OPEN" && r.due_at < Date.now();
          return (
            <tr key={r.id} className="cursor-pointer" onClick={() => onOpen(r.id)}>
              <td className="font-mono text-xs font-semibold">{r.number}</td>
              {showTenant ? <td>{r.tenant_name}</td> : null}
              <td>
                <StatusPill status={overdue ? "overdue" : r.status} label={overdue ? "Overdue" : undefined} />
              </td>
              <td className="text-ink-3">{date(r.issued_at)}</td>
              <td className={cn("text-ink-3", overdue && "font-medium text-rose-700")}>{date(r.due_at)}</td>
              <td className="num">{money(r.total_cents, r.currency)}</td>
              <td className="num">{r.status === "OPEN" ? money(r.total_cents - r.amount_paid_cents, r.currency) : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ManualInvoiceDialog({ tenantId, currency, onClose, onDone }: { tenantId: string; currency: string; onClose: () => void; onDone: () => void }) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDays, setDueDays] = useState("7");
  const [memo, setMemo] = useState("");
  const cents = toCents(amount) ?? 0;
  const m = useMutation({
    mutationFn: () => papi<{ number: string }>("/billing/invoices", { method: "POST", json: { tenantId, description, amountCents: cents, dueDays: Number(dueDays), memo: memo || undefined } }),
    onSuccess: (r) => {
      toast.success(`Invoice ${r.number} issued`);
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <Modal title="One-off invoice" kicker="Billing" onClose={onClose} onSubmit={() => m.mutate()} submitLabel="Issue invoice" pending={m.isPending} submitDisabled={!description || cents <= 0}>
      <F label="Description" hint="e.g. Onboarding & data migration, extra branch pro-rata">
        <input autoFocus value={description} onChange={(e) => setDescription(e.target.value)} className={cn(controlClass, "w-full")} />
      </F>
      <div className="grid gap-4 sm:grid-cols-2">
        <F label={`Amount before tax (${currency})`}>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={cn(controlClass, "w-full font-mono")} />
        </F>
        <F label="Due in (days)">
          <input type="number" min={0} max={120} value={dueDays} onChange={(e) => setDueDays(e.target.value)} className={cn(controlClass, "w-full")} />
        </F>
      </div>
      <F label="Memo (internal)">
        <input value={memo} onChange={(e) => setMemo(e.target.value)} className={cn(controlClass, "w-full")} />
      </F>
    </Modal>
  );
}

export function PriorityPill({ p }: { p: string }) {
  const tone = p === "URGENT" ? "danger" : p === "HIGH" ? "warning" : p === "LOW" ? "neutral" : "info";
  return <Pill tone={tone}>{titleCase(p)}</Pill>;
}

