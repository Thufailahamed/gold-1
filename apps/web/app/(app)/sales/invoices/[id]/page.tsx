"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { extractScanCode, hasPermission } from "@goldos/shared";
import { api, PendingApprovalError, type MeData } from "@/lib/api";
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
import { ArrowLeftRightIcon, FileTextIcon, PrinterIcon, ScanBarcodeIcon } from "@/components/icons";

type Detail = {
  invoice: {
    id: string;
    number: string;
    customer_id: string | null;
    customer_name: string | null;
    customer_code: string | null;
    salesperson_name: string | null;
    subtotal_cents: number;
    discount_cents: number;
    tax_cents?: number;
    tax_rate_bp?: number;
    total_cents: number;
    paid_cents: number;
    balance_cents: number;
    status: string;
    created_at: number;
    branch_id: string;
    branch_name: string | null;
    customer_phone: string | null;
    tendered_cents: number | null;
    store_credit_cents: number;
    notes: string | null;
  };
  items: { id: string; product_id: string; barcode: string; sku: string; name: string; gross_mg: number; net_mg: number; karat: string; price_cents: number; discount_cents: number }[];
  payments: { id: string; amount_cents: number; method: string; created_at: number; account_code: string | null; bank_account_name: string | null }[];
  receipts: { id: string; number: string; receipt_date: string; method: string; status: string; amount_cents: number }[];
  journal: { id: string; account_code: string; account_name: string | null; debit_cents: number; credit_cents: number; memo: string | null; entry_no: string | null }[];
  returns: { id: string; number: string; type: string; refund_cents: number; credit_cents: number; exchange_sale_id: string | null; status: string }[];
  returnedItemIds: string[];
  exchangeOf: { id: string; number: string; invoice_id: string; invoice_number: string } | null;
};

const STATUS_LABEL: Record<string, string> = {
  PAID: "Paid",
  PARTIAL: "Part paid",
  UNPAID: "Unpaid · on credit",
  VOID: "Void",
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
  const [refundBank, setRefundBank] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [retScan, setRetScan] = useState("");
  // A return over the threshold waits in the Approval Center; the retry
  // carries the approval id and must keep the same items and type.
  const [retPending, setRetPending] = useState<{ approvalId: string; sig: string } | null>(null);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCancel = hasPermission(me.data?.permissions ?? [], "sales:cancel");
  const canCollect = hasPermission(me.data?.permissions ?? [], "accounts:manage");
  const banks = useQuery({
    queryKey: ["pos-bank-accounts", "all"],
    queryFn: () => api<{ id: string; name: string; bank_name: string | null }[]>("/api/v1/sales/bank-accounts"),
    enabled: retOpen && refundMethod === "bank",
    retry: false,
  });
  const approvers = useQuery({
    queryKey: ["pos-approvers"],
    queryFn: () => api<{ id: string; name: string }[]>("/api/v1/sales/approvers"),
    enabled: retOpen,
    retry: false,
  });
  const retSig = JSON.stringify([type, [...selected].sort()]);
  const retApproval = retPending && retPending.sig === retSig ? retPending : null;

  const detail = useQuery({
    queryKey: ["sale", id],
    queryFn: () => api<Detail>(`/api/v1/sales/invoices/${id}`),
  });

  const ret = useMutation({
    mutationFn: () =>
      api<{ returnId: string; number: string }>("/api/v1/sales/returns", {
        method: "POST",
        body: JSON.stringify({
          invoiceId: id,
          itemIds: type === "FULL" ? undefined : selected,
          type,
          reason,
          refundMethod,
          refundBankAccountId: refundMethod === "bank" && refundBank ? refundBank : undefined,
          approvedBy: retApproval ? undefined : approvedBy || undefined,
          approvalId: retApproval?.approvalId,
        }),
      }),
    onSuccess: (d) => {
      toast.success(`Return ${d.number} recorded`);
      setRetOpen(false);
      setSelected([]);
      setReason("");
      setRetPending(null);
      qc.invalidateQueries({ queryKey: ["sale", id] });
      qc.invalidateQueries({ queryKey: ["sale-print", id] });
    },
    onError: (e) => {
      if (e instanceof PendingApprovalError && e.approvalId) {
        setRetPending({ approvalId: e.approvalId, sig: retSig });
        toast.message("Return sent for approval", {
          description: "Once it is approved in the Approval Center, record the return again.",
        });
        return;
      }
      toast.error(e instanceof Error ? e.message : "Return failed");
    },
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
  const { invoice, items, payments, journal, returns, exchangeOf } = detail.data;
  const returned = new Set(detail.data.returnedItemIds ?? []);
  const returnable = items.filter((it) => !returned.has(it.id));
  const creditCents = payments.filter((p) => p.method === "credit").reduce((s, p) => s + p.amount_cents, 0);
  const balance = Math.max(0, invoice.balance_cents ?? invoice.total_cents - invoice.paid_cents);
  const receipts = detail.data.receipts ?? [];

  // Scan the piece the customer brought back to tick its line.
  function scanReturn() {
    const code = extractScanCode(retScan);
    setRetScan("");
    if (!code) return;
    const it = items.find((x) => x.barcode === code || x.sku === code);
    if (!it) return toast.error(`${code} is not on ${invoice.number}`);
    if (returned.has(it.id)) return toast.error(`${code} was already returned`);
    setSelected((s) => (s.includes(it.id) ? s : [...s, it.id]));
  }

  const exchangeHref = (r: { id: string; number: string }) => {
    const q = new URLSearchParams({ exchange: r.id, exchangeNo: r.number });
    if (invoice.customer_id) {
      q.set("customerId", invoice.customer_id);
      q.set("customerName", invoice.customer_name ?? "Customer");
      q.set("customerCode", invoice.customer_code ?? "");
    }
    return `/pos?${q.toString()}`;
  };

  return (
    <Page>
      <Hero
        back={{ href: "/sales/invoices", label: "Sales invoices" }}
        kicker="Sales"
        title={invoice.number}
        description={`${invoice.customer_name ?? "Walk-in"} · ${new Date(invoice.created_at).toLocaleString()}${invoice.salesperson_name ? ` · ${invoice.salesperson_name}` : ""}`}
        meta={
          <>
            <Pill tone="ghost" className="!text-paper">{STATUS_LABEL[invoice.status] ?? invoice.status}</Pill>
            {invoice.discount_cents ? <Pill tone="ghost" className="!text-paper">Discount {fmt(invoice.discount_cents)}</Pill> : null}
          </>
        }
        stats={[
          { label: "Subtotal", value: `${fmt(invoice.subtotal_cents)} LKR` },
          ...(invoice.tax_cents ? [{ label: `Tax ${(invoice.tax_rate_bp ?? 0) / 100}%`, value: `${fmt(invoice.tax_cents)} LKR` }] : []),
          { label: "Total", value: `${fmt(invoice.total_cents)} LKR` },
          { label: "Paid", value: `${fmt(invoice.paid_cents)} LKR` },
          { label: "Balance due", value: `${fmt(balance)} LKR` },
          { label: "Items", value: items.length },
        ]}
        actions={
          <>
            <Link href={`/sales/invoices/${id}/print`} className={heroBtnGhost}>
              <PrinterIcon size={15} /> A4 invoice
            </Link>
            <Link href={`/sales/invoices/${id}/print?format=receipt`} className={heroBtnGhost}>
              <PrinterIcon size={15} /> Receipt
            </Link>
            {balance > 0 && canCollect && invoice.customer_id ? (
              <Link href={`/accounts/receivables?collect=${encodeURIComponent(invoice.customer_id)}`} className={heroBtnPrimary}>
                Collect payment
              </Link>
            ) : null}
            {canCancel && returnable.length > 0 ? (
              <button onClick={() => setRetOpen(true)} className={heroBtnPrimary}>
                Record return
              </button>
            ) : null}
          </>
        }
      />
      {exchangeOf ? (
        <Callout tone="info" title={`Exchange for return ${exchangeOf.number}`}>
          Replacement for pieces returned from{" "}
          <Link href={`/sales/invoices/${exchangeOf.invoice_id}`} className="font-medium underline">
            {exchangeOf.invoice_number}
          </Link>
          .
        </Callout>
      ) : null}
      <TableCard title="Items sold" icon={<FileTextIcon size={17} />} description={`${items.length} piece${items.length === 1 ? "" : "s"}`}>
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
                  <td className="font-medium text-ink">
                    {it.name} <span className="text-ink-4">· {it.karat}</span>
                    {returned.has(it.id) ? <Pill tone="neutral" className="ml-2">Returned</Pill> : null}
                  </td>
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
        <Panel title="Payments" description={creditCents > 0 ? `${fmt(creditCents)} LKR went on the customer's account` : undefined}>
          {payments.length === 0 ? (
            <EmptyBlock title="No payments" description="No payments recorded on this invoice." />
          ) : (
            <ul className="space-y-2.5 text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3">
                  <span className="text-ink-3">
                    <Pill tone="neutral" className="mr-2 uppercase">{p.method === "credit" ? "on account" : p.method}</Pill>
                    {p.bank_account_name ? <span className="mr-2 text-ink-2">{p.bank_account_name}</span> : null}
                    <span className="text-xs">{p.account_code ? `${p.account_code} · ` : ""}{new Date(p.created_at).toLocaleString()}</span>
                  </span>
                  <span className="num-tabular font-medium text-ink">{fmt(p.amount_cents)}</span>
                </li>
              ))}
              {invoice.store_credit_cents > 0 ? (
                <li className="flex items-center justify-between gap-3 text-ink-3">
                  <span>Settled from store credit</span>
                  <span className="num-tabular">{fmt(invoice.store_credit_cents)}</span>
                </li>
              ) : null}
              {receipts.map((r) => (
                <li key={r.id} className={`flex items-center justify-between gap-3 ${r.status === "VOID" ? "text-ink-5 line-through" : "text-ink-3"}`}>
                  <span>
                    <Pill tone="neutral" className="mr-2 uppercase">receipt</Pill>
                    <span className="g-metric mr-2 text-xs text-ink">{r.number}</span>
                    {r.receipt_date} · {r.method}
                  </span>
                  <span className="num-tabular font-medium">{fmt(r.amount_cents)}</span>
                </li>
              ))}
              <li className={`flex items-center justify-between gap-3 border-t border-ink/10 pt-2.5 font-semibold ${balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                <span>{balance > 0 ? "Balance due" : "Settled in full"}</span>
                <span className="num-tabular">{fmt(balance)}</span>
              </li>
            </ul>
          )}
          {invoice.notes ? <p className="mt-3 rounded-lg bg-bone px-3 py-2 text-sm text-ink-2">Note: {invoice.notes}</p> : null}
        </Panel>
        <Panel
          title="Ledger postings"
          description={
            journal.length > 0
              ? journal.reduce((s, j) => s + j.debit_cents - j.credit_cents, 0) === 0
                ? "Balanced — debits equal credits"
                : "Out of balance"
              : undefined
          }
        >
          {journal.length === 0 ? (
            <EmptyBlock title="No postings" description="Journal entries appear after posting." />
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-[0.12em] text-ink-4">
                  <th className="pb-2 font-semibold">Account</th>
                  <th className="pb-2 text-right font-semibold">Debit</th>
                  <th className="pb-2 text-right font-semibold">Credit</th>
                </tr>
              </thead>
              <tbody>
                {journal.map((j) => (
                  <tr key={j.id} className="border-t border-ink/[0.06]">
                    <td className="py-1.5 text-ink-2">
                      <span className="g-metric mr-2 text-ink-4">{j.account_code}</span>
                      {j.account_name ?? ""}
                      {j.memo && !j.memo.startsWith("Sale ") ? <span className="ml-1 text-ink-4">· {j.memo}</span> : null}
                    </td>
                    <td className="py-1.5 text-right num-tabular text-ink">{j.debit_cents ? fmt(j.debit_cents) : ""}</td>
                    <td className="py-1.5 text-right num-tabular text-ink">{j.credit_cents ? fmt(j.credit_cents) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                  {r.type === "EXCHANGE" ? (
                    r.exchange_sale_id ? (
                      <Link href={`/sales/invoices/${r.exchange_sale_id}`} className="inline-flex items-center gap-1 text-xs font-medium underline">
                        <ArrowLeftRightIcon size={12} /> Replacement sale
                      </Link>
                    ) : (
                      <Link href={exchangeHref(r)} className="g-btn g-btn-secondary h-7 px-2.5 text-xs">
                        <ArrowLeftRightIcon size={12} /> Start replacement sale
                      </Link>
                    )
                  ) : null}
                  <span className="num-tabular">{fmt(r.refund_cents + (r.credit_cents ?? 0))}</span>
                  {r.credit_cents ? <Pill tone="neutral">store credit</Pill> : null}
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
          submitDisabled={!reason || (type !== "FULL" && selected.length === 0)}
          submitLabel={retApproval ? "Record approved return" : "Record"}
        >
          {retApproval ? (
            <Callout tone="warning" title="Waiting for approval">
              Once this return is approved in the <Link href="/approvals" className="underline">Approval Center</Link>, press
              Record again. Changing the items or type cancels the request.
            </Callout>
          ) : null}
          <label className="block text-sm text-ink-2">Type
            <select value={type} onChange={(e) => setType(e.target.value)} className={controlClass}>
              <option value="PARTIAL">Partial</option>
              <option value="FULL">Full</option>
              <option value="EXCHANGE">Exchange</option>
            </select>
          </label>
          {type !== "FULL" ? (
            <div className="relative">
              <ScanBarcodeIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
              <input
                autoFocus
                placeholder="Scan returned piece + Enter"
                value={retScan}
                onChange={(e) => setRetScan(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    scanReturn();
                  }
                }}
                autoComplete="off"
                className={`${controlClass} w-full !pl-9 font-mono`}
              />
            </div>
          ) : (
            <p className="text-sm text-ink-3">Returns every remaining piece: {returnable.map((it) => it.barcode).join(", ")}</p>
          )}
          {type !== "FULL" ? (
            <div className="g-surface max-h-48 space-y-1.5 overflow-y-auto rounded-xl p-3 scrollbar-thin">
              {returnable.map((it) => (
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
          {refundMethod === "bank" && (banks.data?.length ?? 0) > 1 ? (
            <label className="block text-sm text-ink-2">Refund from bank account
              <select value={refundBank} onChange={(e) => setRefundBank(e.target.value)} className={controlClass}>
                <option value="">Default bank (1010)</option>
                {(banks.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}{b.bank_name ? ` · ${b.bank_name}` : ""}</option>
                ))}
              </select>
            </label>
          ) : null}
          {refundMethod === "original" && creditCents > 0 ? (
            <p className="text-xs text-ink-3">The part bought on credit comes off what the customer owes; only money actually paid is refunded.</p>
          ) : null}
          <label className="block text-sm text-ink-2">Counter approver (large returns)
            <select value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} className={controlClass}>
              <option value="">None</option>
              {(approvers.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
          {type === "EXCHANGE" ? (
            <p className="text-xs text-ink-3">
              After recording, start the replacement sale from the Returns panel — pick <b>Store credit</b> to carry
              the refund into it.
            </p>
          ) : null}
        </Modal>
      ) : null}
    </Page>
  );
}
