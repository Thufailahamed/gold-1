"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Callout,
  DetailList,
  EmptyBlock,
  Hero,
  Modal,
  Page,
  Panel,
  TableCard,
  TableSkeleton,
  Toolbar,
  controlClass,
  controlSmClass,
} from "@/components/ui";
import { BanknoteIcon, FileTextIcon, SettingsIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { businessToday } from "@/lib/monthly";
import { lkr, toCents, useAccountsScope, type BankAccount } from "@/lib/accounts";

type TaxConfig = { rateBp: number; label: string; registrationNo: string };
type TaxPayment = {
  id: string;
  number: string;
  branch_id: string;
  paid_on: string;
  period_from: string;
  period_to: string;
  amount_cents: number;
  method: string;
  reference: string | null;
  note: string | null;
};
type TaxReport = {
  from: string;
  to: string;
  config: TaxConfig;
  openingCents: number;
  outputTaxCents: number;
  refundedTaxCents: number;
  netOutputTaxCents: number;
  paidCents: number;
  otherCents: number;
  closingCents: number;
  taxableSalesCents: number;
  taxableReturnsCents: number;
  invoices: number;
  byDay: { date: string; outputCents: number; refundedCents: number }[];
  payments: TaxPayment[];
};

const pct = (bp: number) => `${(bp / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

export default function TaxPage() {
  const qc = useQueryClient();
  const today = businessToday();
  const { branchId, setBranchId, ready, canManage, canShop, visibleBranches, branchName } = useAccountsScope();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const bq = branchId ? `&branchId=${encodeURIComponent(branchId)}` : "";

  const report = useQuery({
    enabled: ready && from <= to,
    queryKey: ["acct", "tax", from, to, branchId],
    queryFn: () => api<TaxReport>(`/api/v1/accounts/tax/report?from=${from}&to=${to}${bq}`),
  });
  const r = report.data;
  const cfg = r?.config;
  const refresh = () => qc.invalidateQueries({ queryKey: ["acct"] });

  return (
    <Page>
      <Hero
        kicker="Accounts"
        back={{ href: "/accounts", label: "Accounts dashboard" }}
        title={`${cfg?.label ?? "VAT"} on sales`}
        description="Output tax charged on sales, refunded on returns and paid to the revenue authority — read straight from the Tax Payable account."
        stats={[
          { label: "Rate", value: cfg ? (cfg.rateBp > 0 ? pct(cfg.rateBp) : "Off") : "—" },
          { label: "Collected (net)", value: r ? lkr(r.netOutputTaxCents) : "—" },
          { label: "Paid in period", value: r ? lkr(r.paidCents) : "—" },
          { label: "Owed at period end", value: r ? lkr(r.closingCents) : "—" },
        ]}
        note={cfg?.registrationNo ? `Registration no. ${cfg.registrationNo}` : "Tax is added on top of the after-discount price, per line"}
      />

      {cfg && cfg.rateBp === 0 ? (
        <Callout tone="info" title="Sales tax is switched off">
          No tax is charged on new sales. Set a rate if the shop is registered — it applies to sales made from then on; earlier invoices keep the rate they were issued at.
        </Callout>
      ) : null}

      <Toolbar
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={controlSmClass} aria-label="Branch">
              {canShop ? <option value="">All branches</option> : null}
              {visibleBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {canManage ? (
              <>
                <button type="button" onClick={() => setEditing(true)} className="g-btn g-btn-secondary h-9 px-3 text-xs">
                  <SettingsIcon size={13} /> Tax setting
                </button>
                <button type="button" onClick={() => setPaying(true)} className="g-btn g-btn-primary h-9 px-3 text-xs" disabled={!r || r.closingCents <= 0}>
                  <BanknoteIcon size={13} /> Record payment
                </button>
              </>
            ) : null}
          </div>
        }
      >
        <label className="flex items-center gap-2 text-sm text-ink-3">
          From
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={controlSmClass} />
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-3">
          To
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={controlSmClass} />
        </label>
      </Toolbar>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Tax return summary" icon={<FileTextIcon size={17} />} description={`${from} to ${to}`}>
          {!r ? (
            <TableSkeleton rows={6} cols={2} />
          ) : (
            <DetailList
              items={[
                { label: "Owed at period start", value: lkr(r.openingCents) },
                { label: `Taxable sales (${r.invoices} invoices)`, value: lkr(r.taxableSalesCents) },
                { label: "Taxable returns", value: lkr(r.taxableReturnsCents) },
                { label: "Output tax charged", value: lkr(r.outputTaxCents) },
                { label: "Less: tax refunded on returns", value: lkr(r.refundedTaxCents) },
                { label: "Net output tax", value: lkr(r.netOutputTaxCents) },
                { label: "Less: paid to the authority", value: lkr(r.paidCents) },
                ...(r.otherCents ? [{ label: "Manual corrections", value: lkr(r.otherCents) }] : []),
                { label: "Owed at period end", value: <span className="font-semibold text-ink">{lkr(r.closingCents)}</span> },
              ]}
            />
          )}
        </Panel>
        <TableCard title="By day" icon={<FileTextIcon size={17} />} description="Tax charged and refunded each business day">
          {!r ? (
            <TableSkeleton rows={4} cols={3} />
          ) : r.byDay.length === 0 ? (
            <EmptyBlock title="No taxed sales in this period" description="Days with taxed sales or returns appear here." />
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="!text-right">Charged</th>
                  <th className="!text-right">Refunded</th>
                  <th className="!text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {r.byDay.map((d) => (
                  <tr key={d.date}>
                    <td className="text-ink-3">{d.date}</td>
                    <td className="!text-right num-tabular">{lkr(d.outputCents)}</td>
                    <td className="!text-right num-tabular text-ink-3">{d.refundedCents ? lkr(d.refundedCents) : "—"}</td>
                    <td className="!text-right num-tabular font-medium text-ink">{lkr(d.outputCents - d.refundedCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      </div>

      <TableCard title="Payments to the authority" icon={<BanknoteIcon size={17} />} description="In this period. Each one posts DR Tax Payable / CR the account it was paid from.">
        {!r ? (
          <TableSkeleton rows={3} cols={5} />
        ) : r.payments.length === 0 ? (
          <EmptyBlock icon={<BanknoteIcon size={22} />} title="No tax payments in this period" />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Payment</th>
                <th>Paid on</th>
                <th>For period</th>
                <th>Branch</th>
                <th>From</th>
                <th>Reference</th>
                <th className="!text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {r.payments.map((p) => (
                <tr key={p.id}>
                  <td className="g-metric text-xs">{p.number}</td>
                  <td className="text-ink-3">{p.paid_on}</td>
                  <td className="text-ink-3">
                    {p.period_from} – {p.period_to}
                  </td>
                  <td className="text-ink-3">{branchName(p.branch_id)}</td>
                  <td className="text-ink-3 capitalize">{p.method}</td>
                  <td className="text-ink-3">{p.reference ?? "—"}</td>
                  <td className="!text-right num-tabular">{lkr(p.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {editing && cfg ? (
        <ConfigModal
          config={cfg}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            refresh();
            qc.invalidateQueries({ queryKey: ["pos-tax-config"] });
          }}
        />
      ) : null}
      {paying && r ? (
        <PayModal
          report={r}
          defaultBranchId={branchId || visibleBranches[0]?.id || ""}
          branches={visibleBranches}
          onClose={() => setPaying(false)}
          onDone={() => {
            setPaying(false);
            refresh();
          }}
        />
      ) : null}
    </Page>
  );
}

function ConfigModal({ config, onClose, onDone }: { config: TaxConfig; onClose: () => void; onDone: () => void }) {
  const [rate, setRate] = useState(String(config.rateBp / 100));
  const [label, setLabel] = useState(config.label);
  const [reg, setReg] = useState(config.registrationNo);
  const rateBp = Math.round(Number(rate) * 100);
  const valid = Number.isFinite(rateBp) && rateBp >= 0 && rateBp <= 5000 && label.trim().length > 0;
  const save = useMutation({
    mutationFn: () =>
      api<TaxConfig>("/api/v1/accounts/tax/config", {
        method: "PUT",
        body: JSON.stringify({ rateBp, label: label.trim(), registrationNo: reg.trim() }),
      }),
    onSuccess: (c) => {
      toast.success(c.rateBp > 0 ? `${c.label} set to ${pct(c.rateBp)}` : "Sales tax switched off");
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });
  return (
    <Modal kicker="Sales tax" title="Tax setting" onClose={onClose} onSubmit={() => save.mutate()} submitLabel="Save" pending={save.isPending} submitDisabled={!valid}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-ink-2">
          Rate (%)
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={`num-tabular ${controlClass} w-full`} />
        </label>
        <label className="block text-sm text-ink-2">
          Name on invoices
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="VAT" className={`${controlClass} w-full`} />
        </label>
      </div>
      <label className="block text-sm text-ink-2">
        Registration number
        <input value={reg} onChange={(e) => setReg(e.target.value)} placeholder="Printed on tax invoices" className={`${controlClass} w-full`} />
      </label>
      <p className="text-xs text-ink-4">0 switches tax off. A change applies to sales made after saving; issued invoices keep their rate.</p>
    </Modal>
  );
}

function PayModal({
  report,
  defaultBranchId,
  branches,
  onClose,
  onDone,
}: {
  report: TaxReport;
  defaultBranchId: string;
  branches: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "bank">("bank");
  const [bankAccountId, setBankAccountId] = useState("");
  const [reference, setReference] = useState("");
  const banks = useQuery({ queryKey: ["bank-accounts"], queryFn: () => api<BankAccount[]>("/api/v1/bank-accounts") });
  const activeBanks = useMemo(() => (banks.data ?? []).filter((b) => b.is_active), [banks.data]);
  useEffect(() => {
    setAmount((report.closingCents / 100).toFixed(2));
  }, [report.closingCents]);
  const cents = toCents(amount);
  const valid = Number.isFinite(cents) && cents > 0 && !!branchId && (method !== "bank" || !!bankAccountId);
  const pay = useMutation({
    mutationFn: () =>
      api<{ number: string; entryNo: string }>("/api/v1/accounts/tax/payments", {
        method: "POST",
        body: JSON.stringify({
          branchId,
          periodFrom: report.from,
          periodTo: report.to,
          amountCents: cents,
          method,
          bankAccountId: method === "bank" ? bankAccountId : undefined,
          reference: reference.trim() || undefined,
        }),
      }),
    onSuccess: (p) => {
      toast.success(`Tax payment recorded — ${p.number}`);
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not record the payment"),
  });
  return (
    <Modal kicker="Pay tax" title={`Period ${report.from} – ${report.to}`} onClose={onClose} onSubmit={() => pay.mutate()} submitLabel="Record payment" pending={pay.isPending} submitDisabled={!valid}>
      <label className="block text-sm text-ink-2">
        Branch paying
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={`${controlClass} w-full`}>
          <option value="">Choose a branch…</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-ink-2">
          Amount (LKR)
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`num-tabular ${controlClass} w-full`} />
        </label>
        <label className="block text-sm text-ink-2">
          Paid from
          <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className={`${controlClass} w-full`}>
            <option value="bank">Bank account</option>
            <option value="cash">Cash drawer</option>
          </select>
        </label>
      </div>
      {method === "bank" ? (
        <label className="block text-sm text-ink-2">
          Bank account
          <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className={`${controlClass} w-full`}>
            <option value="">Choose an account…</option>
            {activeBanks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.account_code})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="block text-sm text-ink-2">
        Reference (optional)
        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. payment slip no." className={`${controlClass} w-full`} />
      </label>
      <p className="text-xs text-ink-4">Owed at period end: {lkr(report.closingCents)}. A payment cannot exceed what the Tax Payable account holds.</p>
    </Modal>
  );
}
