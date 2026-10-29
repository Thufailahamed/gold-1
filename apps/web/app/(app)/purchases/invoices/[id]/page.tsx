"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { Page, Modal, Skeleton, Callout, controlClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { BanknoteIcon, BookOpenIcon, CreditCardIcon, FileTextIcon, PrinterIcon } from "@/components/icons";
import { BillChip, Card, CardHead, Empty, GoldHero, HeroBadge, ShareBar, grams, heroGhost, heroGold, lkr2, th, thead, tr } from "../../kit";

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
  const [bankAccountId, setBankAccountId] = useState("");
  const banks = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: () => api<{ id: string; name: string; account_code: string; is_active: number }[]>(
      "/api/v1/bank-accounts"
    ),
  });
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
        body: JSON.stringify({ amountLkr: Number(amount), bankAccountId }),
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
      <Page className="space-y-4">
        <Skeleton className="h-44 rounded-[20px]" />
        <Skeleton className="h-72 rounded-2xl" />
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
  const isVoid = invoice.status === "VOID";
  const paidShare = invoice.total_cents > 0 ? Math.min(100, (invoice.paid_cents / invoice.total_cents) * 100) : 0;
  const netMg = items.reduce((n, it) => n + it.net_mg, 0);
  const itemCost = items.reduce((n, it) => n + it.cost_cents, 0);
  const dr = journal.reduce((n, j) => n + j.debit_cents, 0);
  const cr = journal.reduce((n, j) => n + j.credit_cents, 0);
  const lastPay = payments.reduce((m, p) => Math.max(m, p.created_at), 0);

  return (
    <Page className="space-y-4">
      <GoldHero
        back={{ href: "/purchases/invoices", label: "Purchase invoices" }}
        icon={CreditCardIcon}
        title={<span className="g-metric tracking-tight">{invoice.number}</span>}
        badge={
          <HeroBadge tone={isVoid ? "muted" : invoice.status === "PAID" ? "good" : invoice.status === "PARTIAL" ? "gold" : "warn"}>
            {invoice.status === "PARTIAL" ? "Part-paid" : invoice.status.charAt(0) + invoice.status.slice(1).toLowerCase()}
          </HeroBadge>
        }
        sub={`Supplier invoice · ${items.length} item${items.length === 1 ? "" : "s"} received into stock${invoice.charges_cents ? ` · charges ${fmt(invoice.charges_cents)} LKR` : ""}`}
        actions={
          <>
            {invoice.status !== "PAID" && !isVoid && canEdit ? (
              <button onClick={() => setPayOpen(true)} className={heroGold}>
                <BanknoteIcon size={13} /> Record payment
              </button>
            ) : null}
            {items.length > 0 ? (
              <Link
                href={`/products/labels?ids=${items.map((it) => it.product_id).join(",")}&back=${encodeURIComponent(`/purchases/invoices/${id}`)}`}
                className={heroGhost}
              >
                <PrinterIcon size={13} /> Labels
              </Link>
            ) : null}
            {!isVoid && canCancel ? (
              <button onClick={voidIt} className={cn(heroGhost, "!text-rose-300")}>
                Void
              </button>
            ) : null}
          </>
        }
        stats={[
          { label: "Total", value: invoice.total_cents, format: (n) => fmt(Math.round(n)), unit: "LKR", accent: true, sub: `Subtotal ${fmt(invoice.subtotal_cents)} + charges ${fmt(invoice.charges_cents)}` },
          { label: "Paid", value: invoice.paid_cents, format: (n) => fmt(Math.round(n)), unit: "LKR", tone: "good", sub: `${paidShare.toFixed(0)}% · ${payments.length} payment${payments.length === 1 ? "" : "s"}` },
          {
            label: "Outstanding",
            value: isVoid ? 0 : outstanding,
            format: (n) => fmt(Math.round(n)),
            unit: "LKR",
            tone: !isVoid && outstanding > 0 ? "warn" : undefined,
            sub: isVoid ? "Voided with reversal" : outstanding > 0 ? "Owed to the supplier" : "Settled in full",
          },
          { label: "Items", value: items.length, sub: `${grams(netMg)} g net` },
          { label: "Last payment", value: null, text: lastPay ? new Date(lastPay).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—", sub: lastPay ? new Date(lastPay).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "No payments yet" },
        ]}
      >
        {!isVoid ? (
          <div className="max-w-xl">
            <div className="flex items-baseline justify-between text-[10.5px] text-paper/45">
              <span>Settlement</span>
              <span className="g-metric text-paper/80">{paidShare.toFixed(0)}% paid</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paper/10">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-[width] duration-700" style={{ width: `${paidShare}%` }} />
            </div>
          </div>
        ) : null}
      </GoldHero>

      <Card>
        <CardHead icon={FileTextIcon} title="Items" sub={`${items.length} received · ${grams(netMg)} g net · ${fmt(itemCost)} LKR at cost`} />
        {items.length === 0 ? (
          <Empty icon={FileTextIcon} title="No items" desc="This invoice has no line items." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Barcode</th>
                  <th className={th}>Name</th>
                  <th className={th}>SKU</th>
                  <th className={cn(th, "text-right")}>Net g</th>
                  <th className={cn(th, "text-right")}>Cost / g</th>
                  <th className={cn(th, "pr-4 text-right")}>Cost LKR</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className={tr}>
                    <td className="py-1.5 pl-4 pr-2">
                      <Link href={`/products/${it.product_id}`} className="g-metric font-semibold text-ink hover:text-gold-dark">
                        {it.barcode}
                      </Link>
                    </td>
                    <td className="max-w-[260px] truncate px-2 font-medium text-ink-2">{it.name}</td>
                    <td className="g-metric px-2 text-[11px] text-ink-5">{it.sku}</td>
                    <td className="g-metric px-2 text-right text-ink-3">{grams(it.net_mg)}</td>
                    <td className="g-metric px-2 text-right text-ink-4">{it.net_mg ? fmt(Math.round((it.cost_cents / it.net_mg) * 1000)) : "—"}</td>
                    <td className="g-metric py-1.5 pl-2 pr-4 text-right font-semibold text-ink">{fmt(it.cost_cents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-ink/20 bg-bone text-[12px] font-semibold text-ink">
                  <td className="py-1.5 pl-4" colSpan={3}>
                    Total
                  </td>
                  <td className="g-metric px-2 text-right">{grams(netMg)}</td>
                  <td />
                  <td className="g-metric py-1.5 pr-4 text-right">{fmt(itemCost)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-4">
          <CardHead icon={CreditCardIcon} title="Bill summary" sub={<BillChip status={invoice.status} />} />
          <dl className="flex-1 px-4 py-2 text-[12.5px]">
            {[
              ["Subtotal", invoice.subtotal_cents],
              ["Charges", invoice.charges_cents],
              ["Total", invoice.total_cents],
              ["Paid", -invoice.paid_cents],
            ].map(([k, v]) => (
              <div key={k as string} className="flex items-baseline justify-between border-b border-dashed border-ink/20 py-1.5">
                <dt className="text-ink-3">{k}</dt>
                <dd className={cn("g-metric", (v as number) < 0 ? "text-emerald-700" : "text-ink")}>
                  {(v as number) < 0 ? "−" : ""}
                  {lkr2(Math.abs(v as number))}
                </dd>
              </div>
            ))}
            <div className={cn("mt-1.5 flex items-baseline justify-between rounded-lg px-3 py-2 font-semibold", !isVoid && outstanding > 0 ? "bg-amber-50 text-amber-800" : "bg-bone text-ink")}>
              <dt>{isVoid ? "Void" : "Outstanding"}</dt>
              <dd className="g-metric">{lkr2(isVoid ? 0 : outstanding)} LKR</dd>
            </div>
            {!isVoid ? <ShareBar value={paidShare} className="mt-2.5" color="bg-gradient-to-r from-emerald-700 to-emerald-400" /> : null}
          </dl>
        </Card>

        <Card className="xl:col-span-4">
          <CardHead icon={BanknoteIcon} title="Payments" sub={payments.length ? `${payments.length} recorded` : "None yet"} />
          {payments.length === 0 ? (
            <Empty icon={BanknoteIcon} title="No payments yet" desc="Record a payment to settle the balance." />
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>When</th>
                  <th className={th}>Method</th>
                  <th className={cn(th, "pr-4 text-right")}>LKR</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className={tr}>
                    <td className="whitespace-nowrap py-1.5 pl-4 text-ink-3">{new Date(p.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-2">
                      <span className="rounded bg-bone px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-ink-3 ring-1 ring-inset ring-ink/20">{p.method}</span>
                    </td>
                    <td className="g-metric py-1.5 pr-4 text-right font-semibold text-ink">{fmt(p.amount_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="xl:col-span-4">
          <CardHead
            icon={BookOpenIcon}
            title="Journal"
            sub={journal.length ? (dr === cr ? `Balanced · ${fmt(dr)} LKR` : `Out of balance by ${fmt(Math.abs(dr - cr))}`) : "Entries appear after posting"}
          />
          {journal.length === 0 ? (
            <Empty icon={BookOpenIcon} title="No postings" desc="Journal entries appear after posting." />
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Account</th>
                  <th className={cn(th, "text-right")}>Dr</th>
                  <th className={cn(th, "pr-4 text-right")}>Cr</th>
                </tr>
              </thead>
              <tbody>
                {journal.map((j) => (
                  <tr key={j.id} className={tr}>
                    <td className="max-w-[160px] truncate py-1.5 pl-4" title={j.memo ?? undefined}>
                      <span className="g-metric font-semibold text-ink">{j.account_code}</span>
                      {j.memo ? <span className="ml-1 text-[10.5px] text-ink-5">{j.memo}</span> : null}
                    </td>
                    <td className="g-metric px-2 text-right text-ink">{j.debit_cents ? fmt(j.debit_cents) : ""}</td>
                    <td className="g-metric py-1.5 pr-4 text-right text-ink">{j.credit_cents ? fmt(j.credit_cents) : ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-ink/20 bg-bone text-[12px] font-semibold text-ink">
                  <td className="py-1.5 pl-4">Total</td>
                  <td className="g-metric px-2 text-right">{fmt(dr)}</td>
                  <td className="g-metric py-1.5 pr-4 text-right">{fmt(cr)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </Card>
      </div>
      {payOpen ? (
        <Modal
          kicker="Purchases"
          title="Record payment"
          onClose={() => setPayOpen(false)}
          onSubmit={() => pay.mutate()}
          pending={pay.isPending}
          submitLabel="Record"
          submitDisabled={!amount || !bankAccountId}
        >
          <p className="text-sm text-ink-3">Outstanding: <span className="num-tabular font-medium text-ink">{fmt(outstanding)} LKR</span></p>
          <label className="block text-sm text-ink-2">Amount LKR
            <input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className={`num-tabular ${controlClass}`} />
          </label>
          <label className="block text-sm text-ink-2">Pay from
            {(banks.data ?? []).filter((b) => b.is_active).length === 0 ? (
              <p className="mt-1 text-xs text-ink-4">
                No bank account registered yet. Add one under Accounts first.
              </p>
            ) : (
              <select
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                className={controlClass}
              >
                <option value="">Choose an account…</option>
                {(banks.data ?? [])
                  .filter((b) => b.is_active)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.account_code})
                    </option>
                  ))}
              </select>
            )}
          </label>
        </Modal>
      ) : null}
    </Page>
  );
}
