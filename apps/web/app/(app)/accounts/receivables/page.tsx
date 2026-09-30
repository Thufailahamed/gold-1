"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Callout,
  EmptyBlock,
  Hero,
  Modal,
  Page,
  Pager,
  StatusPill,
  TableCard,
  TableSkeleton,
  Tabs,
  Toolbar,
  controlClass,
  controlSmClass,
} from "@/components/ui";
import { BanknoteIcon, HistoryIcon, UsersIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { businessToday } from "@/lib/monthly";
import { lkr, longDate, toCents, useAccountsScope, type BankAccount } from "@/lib/accounts";

type Aging = { "0-30": number; "31-60": number; "61-90": number; "90+": number };
type Receivable = {
  customerId: string;
  name: string;
  phone: string | null;
  balanceCents: number;
  openInvoices: number;
  oldestOpenDate: string | null;
  aging: Aging;
};
type OpenInvoice = { invoiceId: string; number: string; date: string; totalCents: number; outstandingCents: number };
type Receipt = {
  id: string;
  number: string;
  customer_name: string;
  branch_id: string;
  receipt_date: string;
  amount_cents: number;
  method: string;
  note: string | null;
  status: string;
  void_reason: string | null;
};

const METHOD_LABEL: Record<string, string> = { cash: "Cash", bank: "Bank transfer", card: "Card" };

function ReceivablesView() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const today = businessToday();
  const scope = useAccountsScope();
  const { branchId, setBranchId, ready, canManage, canShop, visibleBranches, branchName } = scope;
  const [tab, setTab] = useState<"owing" | "received">(params.get("tab") === "received" ? "received" : "owing");
  const [page, setPage] = useState(1);
  const [collectFor, setCollectFor] = useState<Receivable | null>(null);
  const [voiding, setVoiding] = useState<Receipt | null>(null);
  const bq = branchId ? `branchId=${encodeURIComponent(branchId)}` : "";

  const receivables = useQuery({
    enabled: ready,
    queryKey: ["receivables", branchId],
    queryFn: () => api<{ rows: Receivable[]; totalCents: number; aging: Aging }>(`/api/v1/receipts/receivables?${bq}`),
  });
  const monthFrom = `${today.slice(0, 8)}01`;
  const receipts = useQuery({
    enabled: ready,
    queryKey: ["receipts", branchId, page],
    queryFn: () => api<{ rows: Receipt[]; total: number; totalCents: number }>(`/api/v1/receipts?page=${page}&limit=20&${bq}`),
  });
  const monthReceipts = useQuery({
    enabled: ready,
    queryKey: ["receipts", "month", branchId, monthFrom],
    queryFn: () => api<{ total: number; totalCents: number }>(`/api/v1/receipts?limit=1&from=${monthFrom}&to=${today}&${bq}`),
  });

  const rows = receivables.data?.rows ?? [];
  const aging = receivables.data?.aging;

  // ?collect=<customerId> â€” the invoice page's "Collect payment" hand-off
  // opens the collect dialog for that customer once the dues have loaded.
  const collectParam = params.get("collect");
  const [collectHandled, setCollectHandled] = useState(false);
  useEffect(() => {
    if (!collectParam || collectHandled || !receivables.data || !canManage) return;
    const r = receivables.data.rows.find((x) => x.customerId === collectParam);
    if (r) setCollectFor(r);
    else toast.message("That customer owes nothing at this branch");
    setCollectHandled(true);
  }, [collectParam, collectHandled, receivables.data, canManage]);

  const voidMutation = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      api<{ reversalEntryNo: string }>(`/api/v1/receipts/${v.id}/void`, { method: "POST", body: JSON.stringify({ reason: v.reason }) }),
    onSuccess: (r) => {
      toast.success(`Receipt voided â€” reversed in ${r.reversalEntryNo}`);
      setVoiding(null);
      qc.invalidateQueries({ queryKey: ["receivables"] });
      qc.invalidateQueries({ queryKey: ["receipts"] });
      qc.invalidateQueries({ queryKey: ["acct"] });
      // Invoice status and balance due follow the receipt.
      qc.invalidateQueries({ queryKey: ["sale"] });
      qc.invalidateQueries({ queryKey: ["sales-dash"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not void"),
  });

  return (
    <Page>
      <Hero
        kicker="Accounts"
        back={{ href: "/accounts", label: "Accounts dashboard" }}
        title="Customer dues"
        description="Who owes the shop money from credit sales, how old the debt is, and every payment collected against it."
        stats={[
          { label: "Owed to the shop", value: receivables.data ? `${lkr(receivables.data.totalCents)}` : "â€”" },
          { label: "Customers owing", value: receivables.data ? rows.length.toLocaleString("en-US") : "â€”" },
          { label: "Older than 90 days", value: aging ? lkr(aging["90+"]) : "â€”" },
          { label: "Collected this month", value: monthReceipts.data ? lkr(monthReceipts.data.totalCents) : "â€”" },
        ]}
        note="Collecting a payment clears the oldest bill first and posts straight to the ledger"
      />

      <Toolbar
        actions={
          <select
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              setPage(1);
            }}
            className={controlSmClass}
            aria-label="Branch"
          >
            {canShop ? <option value="">All branches</option> : null}
            {visibleBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        }
      >
        <Tabs
          ariaLabel="Dues"
          value={tab}
          onChange={setTab}
          items={[
            { key: "owing", label: "Who owes", icon: <UsersIcon size={14} />, count: receivables.data ? rows.length : null },
            { key: "received", label: "Payments received", icon: <HistoryIcon size={14} /> },
          ]}
        />
      </Toolbar>

      {tab === "owing" ? (
        <TableCard title="Outstanding balances" icon={<UsersIcon size={17} />} description="Largest balance first. Ages come from each open bill's date.">
          {receivables.isLoading || !ready ? (
            <TableSkeleton rows={5} cols={6} />
          ) : receivables.isError ? (
            <EmptyBlock title="Could not load dues" description={(receivables.error as Error).message} />
          ) : rows.length === 0 ? (
            <EmptyBlock icon={<UsersIcon size={22} />} title="Nobody owes the shop" description="Credit sales will show up here until the customer pays them off." />
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="!text-right">Open bills</th>
                  <th>Oldest bill</th>
                  <th className="!text-right">0â€“30 d</th>
                  <th className="!text-right">31â€“60 d</th>
                  <th className="!text-right">61â€“90 d</th>
                  <th className="!text-right">90+ d</th>
                  <th className="!text-right">Owes</th>
                  {canManage ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.customerId}>
                    <td>
                      <div className="font-medium text-ink">{r.name}</div>
                      {r.phone ? <div className="text-xs text-ink-4">{r.phone}</div> : null}
                    </td>
                    <td className="!text-right num-tabular">{r.openInvoices}</td>
                    <td className="text-ink-3">{r.oldestOpenDate ?? "â€”"}</td>
                    <td className="!text-right num-tabular text-ink-3">{r.aging["0-30"] ? lkr(r.aging["0-30"]) : "â€”"}</td>
                    <td className="!text-right num-tabular text-ink-3">{r.aging["31-60"] ? lkr(r.aging["31-60"]) : "â€”"}</td>
                    <td className="!text-right num-tabular text-amber-700">{r.aging["61-90"] ? lkr(r.aging["61-90"]) : "â€”"}</td>
                    <td className="!text-right num-tabular text-rose-700">{r.aging["90+"] ? lkr(r.aging["90+"]) : "â€”"}</td>
                    <td className="!text-right num-tabular font-semibold text-ink">{lkr(r.balanceCents)}</td>
                    {canManage ? (
                      <td className="!text-right">
                        <button type="button" onClick={() => setCollectFor(r)} className="g-btn g-btn-primary h-8 px-3 text-xs">
                          Collect
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : (
        <TableCard
          title="Payments received"
          icon={<BanknoteIcon size={17} />}
          description="Money customers paid against what they owed. Void a mistake â€” it is reversed, never deleted."
          footer={
            <Pager page={page} onChange={setPage} pageSize={20} count={receipts.data?.rows.length ?? 0} total={receipts.data?.total ?? 0} unit="receipts" />
          }
        >
          {receipts.isLoading || !ready ? (
            <TableSkeleton rows={5} cols={6} />
          ) : (receipts.data?.rows.length ?? 0) === 0 ? (
            <EmptyBlock icon={<BanknoteIcon size={22} />} title="No payments collected yet" description="Use Collect on the Who owes tab when a customer pays off a credit sale." />
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Branch</th>
                  <th>Paid by</th>
                  <th className="!text-right">Amount</th>
                  <th>Status</th>
                  {canManage ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {receipts.data!.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="g-metric text-xs">{r.number}</td>
                    <td className="text-ink-3">{r.receipt_date}</td>
                    <td className="text-ink-2">
                      {r.customer_name}
                      {r.note ? <span className="text-ink-4"> â€” {r.note}</span> : null}
                      {r.void_reason ? <div className="text-xs text-rose-700">Voided: {r.void_reason}</div> : null}
                    </td>
                    <td className="text-ink-3">{branchName(r.branch_id)}</td>
                    <td className="text-ink-3">{METHOD_LABEL[r.method] ?? r.method}</td>
                    <td className="!text-right num-tabular">{lkr(r.amount_cents)}</td>
                    <td>
                      <StatusPill status={r.status} />
                    </td>
                    {canManage ? (
                      <td className="!text-right">
                        {r.status === "POSTED" ? (
                          <button type="button" onClick={() => setVoiding(r)} className="g-btn g-btn-secondary h-8 px-3 text-xs">
                            Void
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      )}

      {collectFor ? (
        <CollectModal
          customer={collectFor}
          defaultBranchId={branchId}
          branches={visibleBranches}
          onClose={() => setCollectFor(null)}
          onDone={() => {
            setCollectFor(null);
            qc.invalidateQueries({ queryKey: ["receivables"] });
            qc.invalidateQueries({ queryKey: ["receipts"] });
            qc.invalidateQueries({ queryKey: ["acct"] });
            // Invoice status and balance due follow the receipt.
            qc.invalidateQueries({ queryKey: ["sale"] });
            qc.invalidateQueries({ queryKey: ["sales-dash"] });
          }}
        />
      ) : null}

      {voiding ? (
        <VoidModal
          receipt={voiding}
          pending={voidMutation.isPending}
          onClose={() => setVoiding(null)}
          onSubmit={(reason) => voidMutation.mutate({ id: voiding.id, reason })}
        />
      ) : null}
    </Page>
  );
}

function CollectModal({
  customer,
  defaultBranchId,
  branches,
  onClose,
  onDone,
}: {
  customer: Receivable;
  defaultBranchId: string;
  branches: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "bank" | "card">("cash");
  const [bankAccountId, setBankAccountId] = useState("");
  const [note, setNote] = useState("");

  const open = useQuery({
    enabled: branchId !== "",
    queryKey: ["receipts", "open", customer.customerId, branchId],
    queryFn: () =>
      api<{ balanceCents: number | null; invoices: OpenInvoice[] }>(
        `/api/v1/receipts/customers/${encodeURIComponent(customer.customerId)}/open?branchId=${encodeURIComponent(branchId)}`
      ),
  });
  const banks = useQuery({ queryKey: ["bank-accounts"], queryFn: () => api<BankAccount[]>("/api/v1/bank-accounts") });
  const activeBanks = useMemo(() => (banks.data ?? []).filter((b) => b.is_active), [banks.data]);

  const owed = open.data?.balanceCents ?? 0;
  const cents = toCents(amount);
  const valid = Number.isFinite(cents) && cents > 0 && cents <= owed && (method !== "bank" || !!bankAccountId);

  // Preview which bills this payment clears, oldest first â€” the same rule
  // the server applies, so what the cashier sees is what gets posted.
  const preview = useMemo(() => {
    let left = Number.isFinite(cents) ? cents : 0;
    return (open.data?.invoices ?? []).map((inv) => {
      const take = Math.max(0, Math.min(left, inv.outstandingCents));
      left -= take;
      return { ...inv, take };
    });
  }, [open.data, cents]);

  const create = useMutation({
    mutationFn: () =>
      api<{ number: string; entryNo: string }>("/api/v1/receipts", {
        method: "POST",
        body: JSON.stringify({
          customerId: customer.customerId,
          branchId,
          amountCents: cents,
          method,
          bankAccountId: method === "bank" ? bankAccountId : undefined,
          note: note || undefined,
        }),
      }),
    onSuccess: (r) => {
      toast.success(`Payment recorded â€” ${r.number}`);
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not record the payment"),
  });

  return (
    <Modal
      kicker="Collect payment"
      title={customer.name}
      wide
      onClose={onClose}
      onSubmit={() => create.mutate()}
      submitLabel="Record payment"
      pending={create.isPending}
      submitDisabled={!valid || !branchId}
    >
      <label className="block text-sm text-ink-2">
        Branch collecting the money
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={`${controlClass} w-full`}>
          <option value="">Choose a branchâ€¦</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      {branchId && open.data ? (
        owed <= 0 ? (
          <Callout tone="warning" title="Nothing owed at this branch">
            Collect at the branch where the sale was made â€” each branch keeps its own books.
          </Callout>
        ) : (
          <div className="rounded-xl bg-bone/60 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium uppercase tracking-[0.12em] text-ink-4">Owes at this branch</span>
              <span className="g-metric text-xl text-ink">{lkr(owed)}</span>
            </div>
            {preview.length ? (
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-4">
                    <th className="py-1 font-medium">Bill</th>
                    <th className="py-1 font-medium">Date</th>
                    <th className="py-1 text-right font-medium">Unpaid</th>
                    <th className="py-1 text-right font-medium">This payment</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p) => (
                    <tr key={p.invoiceId} className="border-t border-ink/[0.06]">
                      <td className="py-1.5 font-mono text-xs">{p.number}</td>
                      <td className="py-1.5 text-ink-3">{p.date}</td>
                      <td className="py-1.5 text-right num-tabular">{lkr(p.outstandingCents)}</td>
                      <td className="py-1.5 text-right num-tabular font-medium text-emerald-700">{p.take ? lkr(p.take) : "â€”"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-2 text-xs text-ink-4">No open bills â€” this balance is an opening balance.</p>
            )}
          </div>
        )
      ) : branchId ? (
        <TableSkeleton rows={2} cols={3} />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-ink-2">
          Amount received (LKR)
          <div className="flex gap-2">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={`num-tabular ${controlClass} w-full`} />
            {owed > 0 ? (
              <button type="button" onClick={() => setAmount((owed / 100).toFixed(2))} className="g-btn g-btn-secondary h-10 shrink-0 px-3 text-xs">
                Full
              </button>
            ) : null}
          </div>
          {amount && Number.isFinite(cents) && cents > owed ? (
            <span className="mt-1 block text-xs text-rose-700">More than the customer owes here</span>
          ) : null}
        </label>
        <label className="block text-sm text-ink-2">
          Paid by
          <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className={`${controlClass} w-full`}>
            <option value="cash">Cash (into the drawer)</option>
            <option value="bank">Bank transfer</option>
            <option value="card">Card</option>
          </select>
        </label>
      </div>
      {method === "bank" ? (
        <label className="block text-sm text-ink-2">
          Bank account
          <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className={`${controlClass} w-full`}>
            <option value="">Choose an accountâ€¦</option>
            {activeBanks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.account_code})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="block text-sm text-ink-2">
        Note (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. cheque no., who paid" className={`${controlClass} w-full`} />
      </label>
    </Modal>
  );
}

function VoidModal({
  receipt,
  pending,
  onClose,
  onSubmit,
}: {
  receipt: Receipt;
  pending: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      kicker="Void receipt"
      title={`${receipt.number} Â· ${lkr(receipt.amount_cents)}`}
      danger
      submitLabel="Void receipt"
      onClose={onClose}
      onSubmit={() => onSubmit(reason.trim())}
      pending={pending}
      submitDisabled={!reason.trim()}
    >
      <p className="text-sm text-ink-3">
        {receipt.customer_name} will owe this amount again. The ledger keeps both the receipt and its reversal (dated {longDate(businessToday())}).
      </p>
      <label className="block text-sm text-ink-2">
        Reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. cheque bounced, wrong customer" className={`${controlClass} w-full`} />
      </label>
    </Modal>
  );
}

export default function ReceivablesPage() {
  return (
    <Suspense fallback={null}>
      <ReceivablesView />
    </Suspense>
  );
}
