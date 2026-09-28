"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import {
  Page,
  Hero,
  Panel,
  TableCard,
  StatusPill,
  Pill,
  Modal,
  Skeleton,
  Callout,
  EmptyBlock,
  controlClass,
  heroBtnPrimary,
  heroBtnGhost,
} from "@/components/ui";

type Detail = {
  invoice: {
    id: string;
    number: string;
    supplier_id: string;
    subtotal_cents: number;
    charges_cents: number;
    total_cents: number;
    paid_cents: number;
    status: string;
  };
  items: { id: string; product_id: string; barcode: string; sku: string; name: string; net_mg: number; cost_cents: number }[];
  payments: { id: string; amount_cents: number; method: string; created_at: number }[];
  journal: { id: string; account_code: string; debit_cents: number; credit_cents: number; memo: string | null }[];
};

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canEdit = hasPermission(me.data?.permissions ?? [], "purchases:edit");
  const canCancel = hasPermission(me.data?.permissions ?? [], "purchases:cancel");

  const detail = useQuery({
    queryKey: ["invoice", id],
    queryFn: () => api<Detail>(`/api/v1/purchases/invoices/${id}`),
  });

  const pay = useMutation({
    mutationFn: () =>
      api(`/api/v1/purchases/invoices/${id}/payments`, {
        method: "POST",
        body: JSON.stringify({ amountLkr: Number(amount), method }),
      }),
    onSuccess: () => {
      toast.success("Payment recorded");
      setPayOpen(false);
      setAmount("");
      qc.invalidateQueries({ queryKey: ["invoice", id] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Payment failed"),
  });

  async function voidIt() {
    const reason = window.prompt("Reason to void (required):");
    if (!reason) return;
    try {
      await api(`/api/v1/purchases/invoices/${id}/void`, {
        method: "PATCH",
        body: JSON.stringify({ reason }),
      });
      toast.success("Invoice voided with reversal");
      qc.invalidateQueries({ queryKey: ["invoice", id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Void failed");
    }
  }

  const fmt = (c: number) => (c / 100).toLocaleString("en-US");

  if (detail.isLoading) {
    return (
      <Page>
        <Skeleton className="h-56" />
        <Skeleton className="h-72" />
      </Page>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Page>
        <Callout tone="danger" title="Invoice not found">
          This purchase invoice does not exist or could not be loaded.{" "}
          <button onClick={() => router.push("/purchases/invoices")} className="font-medium underline">
            Back to invoices
          </button>
        </Callout>
      </Page>
    );
  }
  const { invoice, items, payments, journal } = detail.data;
  const outstanding = invoice.total_cents - invoice.paid_cents;

  return (
    <Page>
      <Hero
        back={{ href: "/purchases/invoices", label: "Purchase invoices" }}
        kicker="Purchases"
        title={invoice.number}
        description={`Supplier invoice — ${items.length} item${items.length === 1 ? "" : "s"} received into stock.`}
        meta={
          <>
            <Pill tone="ghost" className="!text-paper">{invoice.status}</Pill>
            {invoice.charges_cents ? <Pill tone="ghost" className="!text-paper">Charges {fmt(invoice.charges_cents)}</Pill> : null}
          </>
        }
        stats={[
          { label: "Total", value: `${fmt(invoice.total_cents)} LKR` },
          { label: "Paid", value: `${fmt(invoice.paid_cents)} LKR` },
          { label: "Outstanding", value: `${fmt(outstanding)} LKR` },
          { label: "Items", value: items.length },
        ]}
        actions={
          <>
            {invoice.status !== "PAID" && invoice.status !== "VOID" && canEdit ? (
              <button onClick={() => setPayOpen(true)} className={heroBtnPrimary}>
                Record payment
              </button>
            ) : null}
            {invoice.status !== "VOID" && canCancel ? (
              <button onClick={voidIt} className={`${heroBtnGhost} !text-rose-300`}>
                Void
              </button>
            ) : null}
          </>
        }
      />
      <TableCard title="Items" icon={<FileTextIcon size={17} />} description={`${items.length} received`}>
        {items.length === 0 ? (
          <EmptyBlock title="No items" description="This invoice has no line items." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Barcode</th>
                <th>Name</th>
                <th className="!text-right">Net g</th>
                <th className="!text-right">Cost LKR</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <Link href={`/products/${it.product_id}`} className="g-metric text-xs text-ink hover:text-gold-700">
                      {it.barcode}
                    </Link>
                  </td>
                  <td className="font-medium text-ink">{it.name}</td>
                  <td className="!text-right num-tabular">{(it.net_mg / 1000).toLocaleString("en-US")}</td>
                  <td className="!text-right num-tabular">{fmt(it.cost_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Payments">
          {payments.length === 0 ? (
            <EmptyBlock title="No payments yet" description="Record a payment to settle the balance." />
          ) : (
            <ul className="space-y-2.5 text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3">
                  <span className="text-ink-3">
                    <Pill tone="neutral" className="mr-2 uppercase">{p.method}</Pill>
                    {new Date(p.created_at).toLocaleString()}
                  </span>
                  <span className="num-tabular font-medium text-ink">{fmt(p.amount_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Journal">
          {journal.length === 0 ? (
            <EmptyBlock title="No postings" description="Journal entries appear after posting." />
          ) : (
            <ul className="space-y-2 g-metric text-xs">
              {journal.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-3">
                  <span className="text-ink-3">{j.account_code}{j.memo ? ` · ${j.memo}` : ""}</span>
                  <span className="text-ink">{j.debit_cents ? `DR ${fmt(j.debit_cents)}` : `CR ${fmt(j.credit_cents)}`}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {payOpen ? (
        <Modal
          kicker="Purchases"
          title="Record payment"
          onClose={() => setPayOpen(false)}
          onSubmit={() => pay.mutate()}
          pending={pay.isPending}
          submitDisabled={!amount}
          submitLabel="Record"
        >
          <p className="text-sm text-ink-3">Outstanding: <span className="num-tabular font-medium text-ink">{fmt(outstanding)} LKR</span></p>
          <label className="block text-sm text-ink-2">Amount LKR
            <input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className={`num-tabular ${controlClass}`} />
          </label>
          <label className="block text-sm text-ink-2">Method
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={controlClass}>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
            </select>
          </label>
        </Modal>
      ) : null}
    </Page>
  );
}
