"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PAYMENT_METHODS, PLATFORM_PERMISSIONS as P } from "@goldos/shared";
import { Callout, DetailList, Modal, Skeleton, StatusPill, controlClass } from "@/components/ui";
import { PrinterIcon, XIcon } from "@/components/icons";
import { F, ReasonDialog } from "@/components/platform/dialogs";
import { cn } from "@/lib/cn";
import { can, date, dateTime, money, papi, titleCase, toCents, usePlatformMe } from "@/lib/platform";

type InvoiceDetail = {
  invoice: {
    id: string;
    number: string;
    tenant_id: string;
    tenant_name: string;
    tenant_slug: string;
    tenant_legal_name: string | null;
    tenant_email: string;
    kind: string;
    period_start: number | null;
    period_end: number | null;
    currency: string;
    subtotal_cents: number;
    discount_cents: number;
    tax_cents: number;
    total_cents: number;
    amount_paid_cents: number;
    status: string;
    issued_at: number;
    due_at: number;
    paid_at: number | null;
    void_reason: string | null;
    memo: string | null;
  };
  lines: Array<{ id: string; description: string; quantity: number; unit_cents: number; amount_cents: number }>;
  payments: Array<{ id: string; amount_cents: number; method: string; reference: string | null; received_at: number; recorded_by: string | null }>;
};

export function InvoiceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const me = usePlatformMe();
  const manage = can(me.data, P.BILLING_MANAGE);
  const q = useQuery({ queryKey: ["p-invoice", id], queryFn: () => papi<InvoiceDetail>(`/billing/invoices/${id}`) });
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState<"void" | "uncollectible" | null>(null);
  const inv = q.data?.invoice;
  const balance = inv ? inv.total_cents - inv.amount_paid_cents : 0;
  const overdue = inv?.status === "OPEN" && inv.due_at < Date.now();

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["p-invoice", id] });
    qc.invalidateQueries({ queryKey: ["p-invoices"] });
    qc.invalidateQueries({ queryKey: ["p-tenant"] });
    qc.invalidateQueries({ queryKey: ["platform-overview"] });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/60 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Invoice"
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-lg animate-slide-in space-y-5 overflow-y-auto bg-paper p-6 shadow-4 scrollbar-thin"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="g-kicker">Invoice</div>
            <h2 className="mt-1 font-mono text-lg font-bold text-ink">{inv?.number ?? "…"}</h2>
            {inv ? (
              <Link href={`/platform/tenants/${inv.tenant_id}`} className="text-sm text-gold-dark hover:underline">
                {inv.tenant_name}
              </Link>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => window.print()} aria-label="Print" className="flex size-8 items-center justify-center rounded-lg text-ink-4 hover:bg-ink/5 hover:text-ink">
              <PrinterIcon size={16} />
            </button>
            <button onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-lg text-ink-4 hover:bg-ink/5 hover:text-ink">
              <XIcon size={16} />
            </button>
          </div>
        </div>

        {!inv ? (
          <Skeleton className="h-64" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={overdue ? "overdue" : inv.status} label={overdue ? "Overdue" : titleCase(inv.status)} />
              <span className="text-xs text-ink-4">{inv.kind === "MANUAL" ? "One-off charge" : "Subscription"}</span>
            </div>

            <DetailList
              columns={2}
              items={[
                { label: "Issued", value: date(inv.issued_at) },
                { label: "Due", value: <span className={cn(overdue && "font-semibold text-rose-700")}>{date(inv.due_at)}</span> },
                ...(inv.period_start ? [{ label: "Service period", value: `${date(inv.period_start)} – ${date(inv.period_end)}` }] : []),
                { label: "Bill to", value: inv.tenant_legal_name ?? inv.tenant_name },
                { label: "Contact", value: inv.tenant_email },
                ...(inv.paid_at ? [{ label: "Paid", value: date(inv.paid_at) }] : []),
              ]}
            />

            <div className="overflow-hidden rounded-xl ring-1 ring-ink/[0.08]">
              <table className="g-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="!text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data!.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.description}</td>
                      <td className="num">{money(l.amount_cents, inv.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="space-y-1.5 border-t border-ink/[0.07] bg-bone/60 px-5 py-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-4">Total</dt>
                  <dd className="g-metric font-semibold">{money(inv.total_cents, inv.currency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-4">Paid</dt>
                  <dd className="g-metric">{money(inv.amount_paid_cents, inv.currency)}</dd>
                </div>
                {inv.status === "OPEN" ? (
                  <div className="flex justify-between border-t border-ink/[0.07] pt-1.5">
                    <dt className="font-semibold">Balance due</dt>
                    <dd className="g-metric font-semibold">{money(balance, inv.currency)}</dd>
                  </div>
                ) : null}
              </dl>
            </div>

            {inv.void_reason ? (
              <Callout tone="warning" title={inv.status === "VOID" ? "Voided" : "Written off"}>
                {inv.void_reason}
              </Callout>
            ) : null}
            {inv.memo ? <p className="text-sm text-ink-3">Memo: {inv.memo}</p> : null}

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4">Payments</div>
              {q.data!.payments.length === 0 ? (
                <p className="text-sm text-ink-4">No payments recorded.</p>
              ) : (
                <ul className="space-y-2">
                  {q.data!.payments.map((p) => (
                    <li key={p.id} className="g-surface flex items-center justify-between gap-3 p-3 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium">{titleCase(p.method)}{p.reference ? ` · ${p.reference}` : ""}</div>
                        <div className="text-[11px] text-ink-4">{dateTime(p.received_at)} · by {p.recorded_by ?? "system"}</div>
                      </div>
                      <span className="g-metric">{money(p.amount_cents, inv.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {manage && inv.status === "OPEN" ? (
              <div className="flex flex-wrap gap-2 border-t border-ink/[0.07] pt-4">
                <button onClick={() => setPaying(true)} className="g-btn g-btn-primary h-10 px-4 text-sm">
                  Record payment
                </button>
                {inv.amount_paid_cents === 0 ? (
                  <button onClick={() => setVoiding("void")} className="g-btn g-btn-secondary h-10 px-4 text-sm">
                    Void
                  </button>
                ) : null}
                <button onClick={() => setVoiding("uncollectible")} className="g-btn g-btn-secondary h-10 px-4 text-sm text-rose-700">
                  Write off
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {paying && inv ? <PaymentDialog invoiceId={inv.id} balance={balance} currency={inv.currency} onClose={() => setPaying(false)} onDone={refresh} /> : null}
      {voiding && inv ? (
        <ReasonDialog
          title={voiding === "void" ? `Void ${inv.number}` : `Write off ${inv.number}`}
          danger
          submitLabel={voiding === "void" ? "Void invoice" : "Mark uncollectible"}
          description={
            voiding === "void"
              ? "Use for invoices issued in error. The number stays reserved and the invoice remains visible."
              : `Writes off ${money(balance, inv.currency)}. If this was the last overdue invoice, the account's past-due status and any billing suspension are lifted.`
          }
          onClose={() => setVoiding(null)}
          onSubmit={async (reason) => {
            await papi(`/billing/invoices/${inv.id}/${voiding}`, { method: "POST", json: { reason } });
            toast.success(voiding === "void" ? "Invoice voided" : "Invoice written off");
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function PaymentDialog({ invoiceId, balance, currency, onClose, onDone }: { invoiceId: string; balance: number; currency: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState((balance / 100).toFixed(2));
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>("BANK");
  const [reference, setReference] = useState("");
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10));
  const cents = toCents(amount) ?? 0;
  const pay = useMutation({
    mutationFn: () =>
      papi<{ status: string }>(`/billing/invoices/${invoiceId}/payments`, {
        method: "POST",
        json: { amountCents: cents, method, reference: reference || undefined, receivedAt: new Date(`${receivedOn}T12:00:00`).getTime() },
      }),
    onSuccess: (r) => {
      toast.success(r.status === "PAID" ? "Paid in full" : "Part payment recorded");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Payment failed"),
  });
  return (
    <Modal title="Record payment" kicker="Billing" onClose={onClose} onSubmit={() => pay.mutate()} submitLabel="Record" pending={pay.isPending} submitDisabled={cents <= 0 || cents > balance}>
      <div className="grid gap-4 sm:grid-cols-2">
        <F label={`Amount (${currency})`} hint={`Balance ${money(balance, currency)}`}>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={cn(controlClass, "w-full font-mono")} />
        </F>
        <F label="Method">
          <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className={cn(controlClass, "w-full")}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {titleCase(m)}
              </option>
            ))}
          </select>
        </F>
        <F label="Reference" hint="Bank ref, cheque no., gateway id">
          <input value={reference} onChange={(e) => setReference(e.target.value)} className={cn(controlClass, "w-full")} />
        </F>
        <F label="Received on">
          <input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className={cn(controlClass, "w-full")} />
        </F>
      </div>
    </Modal>
  );
}
