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
import { PrinterIcon } from "@/components/icons";

type Detail = {
  invoice: {
    id: string;
    number: string;
    customer_name: string | null;
    customer_code: string | null;
    salesperson_name: string | null;
    subtotal_cents: number;
    discount_cents: number;
    total_cents: number;
    paid_cents: number;
    status: string;
    created_at: number;
    branch_id: string;
  };
  items: { id: string; product_id: string; barcode: string; sku: string; name: string; gross_mg: number; net_mg: number; karat: string; price_cents: number; discount_cents: number }[];
  payments: { id: string; amount_cents: number; method: string; created_at: number }[];
  journal: { id: string; account_code: string; debit_cents: number; credit_cents: number; memo: string | null }[];
  returns: { id: string; number: string; type: string; refund_cents: number; status: string }[];
};

export default function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [retOpen, setRetOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [type, setType] = useState("PARTIAL");
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState("original");
  const [approvedBy, setApprovedBy] = useState("");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCancel = hasPermission(me.data?.permissions ?? [], "sales:cancel");

  const detail = useQuery({
    queryKey: ["sale", id],
    queryFn: () => api<Detail>(`/api/v1/sales/invoices/${id}`),
  });

  const ret = useMutation({
    mutationFn: () =>
      api("/api/v1/sales/returns", {
        method: "POST",
        body: JSON.stringify({
          invoiceId: id,
          itemIds: type === "FULL" ? undefined : selected,
          type,
          reason,
          refundMethod,
          approvedBy: approvedBy || undefined,
        }),
      }),
    onSuccess: () => {
      toast.success("Return recorded");
      setRetOpen(false);
      qc.invalidateQueries({ queryKey: ["sale", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Return failed"),
  });

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
        <Callout tone="danger" title="Sale not found">
          This invoice does not exist or could not be loaded.{" "}
          <button onClick={() => router.push("/sales/invoices")} className="font-medium underline">
            Back to invoices
          </button>
        </Callout>
      </Page>
    );
  }
  const { invoice, items, payments, journal, returns } = detail.data;

  return (
    <Page>
      <Hero
        back={{ href: "/sales/invoices", label: "Sales invoices" }}
        kicker="Sales"
        title={invoice.number}
        description={`${invoice.customer_name ?? "Walk-in"} · ${new Date(invoice.created_at).toLocaleString()}${invoice.salesperson_name ? ` · ${invoice.salesperson_name}` : ""}`}
        meta={
          <>
            <Pill tone="ghost" className="!text-paper">{invoice.status}</Pill>
            {invoice.discount_cents ? <Pill tone="ghost" className="!text-paper">Discount {fmt(invoice.discount_cents)}</Pill> : null}
          </>
        }
        stats={[
          { label: "Subtotal", value: `${fmt(invoice.subtotal_cents)} LKR` },
          { label: "Total", value: `${fmt(invoice.total_cents)} LKR` },
          { label: "Paid", value: `${fmt(invoice.paid_cents)} LKR` },
          { label: "Items", value: items.length },
        ]}
        actions={
          <>
            <Link href={`/sales/invoices/${id}/print`} className={heroBtnGhost}>
              <PrinterIcon size={15} /> Print
            </Link>
            {canCancel ? (
              <button onClick={() => setRetOpen(true)} className={heroBtnPrimary}>
                Record return
              </button>
            ) : null}
          </>
        }
      />
      <TableCard title="Items sold" description={`${items.length} piece${items.length === 1 ? "" : "s"}`}>
        {items.length === 0 ? (
          <EmptyBlock title="No items" description="This invoice has no line items." />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Barcode</th>
                <th>Item</th>
                <th className="!text-right">Net g</th>
                <th className="!text-right">Price</th>
                <th className="!text-right">Discount</th>
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
                  <td className="font-medium text-ink">{it.name} <span className="text-ink-4">· {it.karat}</span></td>
                  <td className="!text-right num-tabular">{(it.net_mg / 1000).toLocaleString("en-US")}</td>
                  <td className="!text-right num-tabular">{fmt(it.price_cents)}</td>
                  <td className="!text-right num-tabular">{fmt(it.discount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Payments">
          {payments.length === 0 ? (
            <EmptyBlock title="No payments" description="No payments recorded on this invoice." />
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
      {returns.length > 0 ? (
        <Panel title="Returns" description={`${returns.length} recorded`}>
          <ul className="space-y-2.5 text-sm">
            {returns.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3">
                <span className="text-ink-3">
                  <span className="g-metric mr-2 text-xs text-ink">{r.number}</span>
                  {r.type}
                </span>
                <span className="flex items-center gap-3">
                  <span className="num-tabular">{fmt(r.refund_cents)}</span>
                  <StatusPill status={r.status} />
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {retOpen ? (
        <Modal
          kicker="Sales"
          title="Record return"
          onClose={() => setRetOpen(false)}
          onSubmit={() => ret.mutate()}
          pending={ret.isPending}
          submitDisabled={!reason}
          submitLabel="Record"
        >
          <label className="block text-sm text-ink-2">Type
            <select value={type} onChange={(e) => setType(e.target.value)} className={controlClass}>
              <option value="PARTIAL">Partial</option>
              <option value="FULL">Full</option>
              <option value="EXCHANGE">Exchange</option>
            </select>
          </label>
          {type !== "FULL" ? (
            <div className="g-surface max-h-48 space-y-1.5 overflow-y-auto rounded-xl p-3 scrollbar-thin">
              {items.map((it) => (
                <label key={it.id} className="flex items-center gap-2.5 rounded-md px-1.5 py-1 text-sm text-ink-2 transition-colors hover:bg-ink/[0.03]">
                  <input
                    type="checkbox"
                    checked={selected.includes(it.id)}
                    onChange={(e) =>
                      setSelected((s) => (e.target.checked ? [...s, it.id] : s.filter((x) => x !== it.id)))
                    }
                    className="accent-gold"
                  />
                  <span className="g-metric text-xs text-ink-4">{it.barcode}</span> {it.name}
                </label>
              ))}
            </div>
          ) : null}
          <label className="block text-sm text-ink-2">Reason (required)
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={controlClass} />
          </label>
          <label className="block text-sm text-ink-2">Refund method
            <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)} className={controlClass}>
              <option value="original">Refund to original methods</option>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
              <option value="credit">Store credit</option>
            </select>
          </label>
          <label className="block text-sm text-ink-2">Approver user ID (large returns)
            <input value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} className={controlClass} />
          </label>
        </Modal>
      ) : null}
    </Page>
  );
}
