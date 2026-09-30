"use client";

import { Suspense, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CASH_ENTRY_KINDS, type CashEntryKind } from "@goldos/shared";
import {
  Callout,
  EmptyBlock,
  FilterChips,
  Hero,
  Modal,
  Page,
  TableCard,
  TableSkeleton,
  Toolbar,
  controlClass,
  controlSmClass,
  heroBtnGhost,
  heroBtnPrimary,
} from "@/components/ui";
import { ArrowLeftRightIcon, BanknoteIcon, BookOpenIcon, Building2Icon, PlusIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { businessToday } from "@/lib/monthly";
import { lkr, lkrSigned, refLabel, toCents, useAccountsScope, type BankAccount } from "@/lib/accounts";

type StatementRow = {
  entryId: string;
  entryNo: string;
  entryDate: string;
  memo: string | null;
  refEntity: string | null;
  refNo: string | null;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
};
type Statement = { code: string; from: string; to: string; opening: number; closing: number; rows: StatementRow[] };

type ModalKind = null | "in" | "out" | "deposit" | "withdraw" | "bank" | { opening: BankAccount };

function addDays(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function CashView() {
  const qc = useQueryClient();
  const today = businessToday();
  const { branchId, setBranchId, ready, canManage, canShop, visibleBranches, branchName } = useAccountsScope();
  const [account, setAccount] = useState("1000");
  const [range, setRange] = useState("today");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [modal, setModal] = useState<ModalKind>(null);

  const { from, to } =
    range === "today"
      ? { from: today, to: today }
      : range === "week"
        ? { from: addDays(today, -6), to: today }
        : range === "month"
          ? { from: `${today.slice(0, 8)}01`, to: today }
          : { from: customFrom, to: customTo };

  const banks = useQuery({ queryKey: ["bank-accounts"], queryFn: () => api<BankAccount[]>("/api/v1/bank-accounts") });
  const activeBanks = useMemo(() => (banks.data ?? []).filter((b) => b.is_active), [banks.data]);
  const bankTotal = activeBanks.reduce((s, b) => s + b.balance_cents, 0);

  // The drawer is per branch; a bank account belongs to the shop, so its book
  // is never narrowed to one branch's entries.
  const isCash = account === "1000";
  const bq = isCash && branchId ? `&branchId=${encodeURIComponent(branchId)}` : "";
  const drawer = useQuery({
    enabled: ready,
    queryKey: ["cashbook", "drawer", branchId, today],
    queryFn: () => api<Statement>(`/api/v1/accounts/1000/statement?from=${today}&to=${today}${branchId ? `&branchId=${encodeURIComponent(branchId)}` : ""}`),
  });
  const book = useQuery({
    enabled: ready && from <= to,
    queryKey: ["cashbook", account, branchId, from, to],
    queryFn: () => api<Statement>(`/api/v1/accounts/${account}/statement?from=${from}&to=${to}${bq}`),
  });
  const moneyIn = (book.data?.rows ?? []).reduce((s, r) => s + r.debitCents, 0);
  const moneyOut = (book.data?.rows ?? []).reduce((s, r) => s + r.creditCents, 0);
  const accountName = isCash ? "Cash in drawer" : activeBanks.find((b) => b.account_code === account)?.name ?? account;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["cashbook"] });
    qc.invalidateQueries({ queryKey: ["bank-accounts"] });
    qc.invalidateQueries({ queryKey: ["acct"] });
  };

  return (
    <Page>
      <Hero
        kicker="Accounts"
        back={{ href: "/accounts", label: "Accounts dashboard" }}
        title="Cash & bank"
        description="What is in the drawer and the bank right now, and every rupee that moved in or out — with a running balance."
        actions={
          canManage ? (
            <>
              <button type="button" onClick={() => setModal("in")} className={heroBtnPrimary}>
                <PlusIcon size={15} />
                Money in
              </button>
              <button type="button" onClick={() => setModal("out")} className={heroBtnGhost}>
                Money out
              </button>
              <button type="button" onClick={() => setModal("deposit")} className={heroBtnGhost} disabled={!activeBanks.length}>
                <ArrowLeftRightIcon size={15} />
                Bank deposit
              </button>
            </>
          ) : null
        }
        stats={[
          { label: `Drawer now${branchId ? ` · ${branchName(branchId)}` : ""}`, value: drawer.data ? lkr(drawer.data.closing) : "—" },
          { label: "Drawer at start of today", value: drawer.data ? lkr(drawer.data.opening) : "—" },
          { label: "All banks", value: banks.data ? lkr(bankTotal) : "—" },
          { label: "Cash + bank", value: drawer.data && banks.data ? lkr(drawer.data.closing + bankTotal) : "—" },
        ]}
        note="Sales, expenses, receipts and supplier payments land here automatically — use Money in / out only for everything else"
      />

      {/* ------------------------------------------------------------ accounts */}
      <section aria-label="Money accounts" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AccountTile
          active={isCash}
          onClick={() => setAccount("1000")}
          icon={<BanknoteIcon size={16} />}
          title="Cash in drawer"
          sub={branchId ? branchName(branchId) : "All branches"}
          cents={drawer.data?.closing}
        />
        {activeBanks.map((b) => (
          <AccountTile
            key={b.id}
            active={account === b.account_code}
            onClick={() => setAccount(b.account_code)}
            icon={<Building2Icon size={16} />}
            title={b.name}
            sub={[b.bank_name, b.account_number].filter(Boolean).join(" · ") || `Ledger ${b.account_code}`}
            cents={b.balance_cents}
            action={
              canManage && !b.opened_on ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setModal({ opening: b });
                  }}
                  className="text-xs font-medium text-gold-dark hover:text-ink"
                >
                  Set opening balance
                </button>
              ) : null
            }
          />
        ))}
        {canManage ? (
          <button
            type="button"
            onClick={() => setModal("bank")}
            className="flex min-h-[112px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink/20 text-sm text-ink-3 transition-colors hover:border-gold hover:text-ink"
          >
            <PlusIcon size={18} />
            Add bank account
          </button>
        ) : null}
      </section>

      {/* ------------------------------------------------------------ cash book */}
      <Toolbar
        actions={
          <>
            {isCash ? (
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={controlSmClass} aria-label="Branch">
                {canShop ? <option value="">All branches</option> : null}
                {visibleBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            ) : null}
            {canManage && activeBanks.length ? (
              <button type="button" onClick={() => setModal("withdraw")} className="g-btn g-btn-secondary h-9 px-3 text-xs">
                Withdraw from bank
              </button>
            ) : null}
          </>
        }
      >
        <FilterChips
          ariaLabel="Period"
          value={range}
          onChange={setRange}
          options={[
            { key: "today", label: "Today" },
            { key: "week", label: "Last 7 days" },
            { key: "month", label: "This month" },
            { key: "custom", label: "Pick dates" },
          ]}
        />
        {range === "custom" ? (
          <span className="flex items-center gap-2 text-xs text-ink-4">
            <input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} className={controlSmClass} />
            to
            <input type="date" value={customTo} min={customFrom} max={today} onChange={(e) => setCustomTo(e.target.value)} className={controlSmClass} />
          </span>
        ) : null}
      </Toolbar>

      <TableCard
        title={`${accountName} — cash book`}
        icon={<BookOpenIcon size={17} />}
        description={from === to ? from : `${from} to ${to}`}
        actions={
          book.data ? (
            <div className="flex flex-wrap gap-4 text-xs text-ink-4">
              <span>
                Opening <span className="g-metric text-ink">{lkr(book.data.opening)}</span>
              </span>
              <span>
                In <span className="g-metric text-emerald-700">+{lkr(moneyIn)}</span>
              </span>
              <span>
                Out <span className="g-metric text-rose-700">−{lkr(moneyOut)}</span>
              </span>
              <span>
                Closing <span className="g-metric font-semibold text-ink">{lkr(book.data.closing)}</span>
              </span>
            </div>
          ) : null
        }
      >
        {book.isLoading || !ready ? (
          <TableSkeleton rows={6} cols={6} />
        ) : book.isError ? (
          <EmptyBlock title="Could not load the cash book" description={(book.error as Error).message} />
        ) : (book.data?.rows.length ?? 0) === 0 ? (
          <EmptyBlock icon={<BookOpenIcon size={22} />} title="No movement in this period" description={`The balance stayed at ${lkr(book.data?.opening ?? 0)}.`} />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Entry</th>
                <th>What happened</th>
                <th className="!text-right">Money in</th>
                <th className="!text-right">Money out</th>
                <th className="!text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-bone/50">
                <td className="text-ink-4" colSpan={5}>
                  Balance brought forward
                </td>
                <td className="!text-right num-tabular font-medium">{lkrSigned(book.data!.opening)}</td>
              </tr>
              {book.data!.rows.map((r, i) => (
                <tr key={`${r.entryId}-${i}`}>
                  <td className="text-ink-3">{r.entryDate}</td>
                  <td className="g-metric text-xs text-ink-4">
                    {r.entryNo}
                    {r.refNo ? <div className="text-ink-5">{r.refNo}</div> : null}
                  </td>
                  <td>
                    <div className="font-medium text-ink">{refLabel(r.refEntity)}</div>
                    {r.memo ? <div className="max-w-md truncate text-xs text-ink-4">{r.memo}</div> : null}
                  </td>
                  <td className="!text-right num-tabular text-emerald-700">{r.debitCents ? lkr(r.debitCents) : ""}</td>
                  <td className="!text-right num-tabular text-rose-700">{r.creditCents ? lkr(r.creditCents) : ""}</td>
                  <td className={cn("!text-right num-tabular font-medium", r.balanceCents < 0 && "text-rose-700")}>{lkrSigned(r.balanceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {isCash && book.data && book.data.closing < 0 ? (
        <Callout tone="danger" title="The drawer is below zero">
          More cash left than came in. Check for a missing sale, an unrecorded owner top-up, or record the difference as a cash correction.
        </Callout>
      ) : null}

      {modal === "in" || modal === "out" ? (
        <CashEntryModal
          direction={modal}
          defaultBranchId={branchId}
          branches={visibleBranches}
          banks={activeBanks}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            refresh();
          }}
        />
      ) : null}
      {modal === "deposit" || modal === "withdraw" ? (
        <BankMoveModal
          kind={modal}
          defaultBranchId={branchId}
          branches={visibleBranches}
          banks={activeBanks}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            refresh();
          }}
        />
      ) : null}
      {modal === "bank" ? (
        <AddBankModal
          branches={visibleBranches}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            refresh();
          }}
        />
      ) : null}
      {modal && typeof modal === "object" ? (
        <OpeningModal
          bank={modal.opening}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            refresh();
          }}
        />
      ) : null}
    </Page>
  );
}

function AccountTile({
  active,
  onClick,
  icon,
  title,
  sub,
  cents,
  action,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  sub: string;
  cents: number | undefined;
  action?: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}
      className={cn(
        "g-surface cursor-pointer p-4 transition-shadow",
        active ? "shadow-[inset_0_0_0_2px_#C9A227]" : "hover:shadow-[inset_0_0_0_1px_rgba(201,162,39,0.6)]"
      )}
    >
      <div className="flex items-center gap-2 text-ink-3">
        <span className="flex size-8 items-center justify-center rounded-lg bg-bone">{icon}</span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{title}</div>
          <div className="truncate text-xs text-ink-4">{sub}</div>
        </div>
      </div>
      <div className={cn("g-metric mt-3 text-xl", (cents ?? 0) < 0 ? "text-rose-700" : "text-ink")}>{cents === undefined ? "—" : lkrSigned(cents)}</div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

function BranchSelect({ value, onChange, branches }: { value: string; onChange: (v: string) => void; branches: { id: string; name: string }[] }) {
  return (
    <label className="block text-sm text-ink-2">
      Branch
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${controlClass} w-full`}>
        <option value="">Choose a branch…</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function AmountInput({ value, onChange, label = "Amount (LKR)" }: { value: string; onChange: (v: string) => void; label?: string }) {
  const bad = value !== "" && !(toCents(value) > 0);
  return (
    <label className="block text-sm text-ink-2">
      {label}
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0.00" className={`num-tabular ${controlClass} w-full`} />
      {bad ? <span className="mt-1 block text-xs text-rose-700">Enter an amount like 1500 or 1500.50</span> : null}
    </label>
  );
}

function useSubmit<T>(path: string, success: (r: T) => string, onDone: () => void) {
  return useMutation({
    mutationFn: (body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (r) => {
      toast.success(success(r));
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });
}

const KIND_HINT: Record<CashEntryKind, string> = {
  OWNER_CAPITAL: "The owner adds their own money to the till or bank. Not income — it is recorded as owner's equity.",
  OWNER_DRAWING: "The owner takes money for personal use. Not an expense — it reduces owner's equity.",
  OTHER_INCOME: "Money earned that is not a jewellery sale: commission, polishing fees, rent received.",
  CASH_OVER: "The counted drawer has more than the books say. Records the extra so tomorrow starts right.",
  CASH_SHORT: "The counted drawer has less than the books say. Records the loss so tomorrow starts right.",
};

function CashEntryModal({
  direction,
  defaultBranchId,
  branches,
  banks,
  onClose,
  onDone,
}: {
  direction: "in" | "out";
  defaultBranchId: string;
  branches: { id: string; name: string }[];
  banks: BankAccount[];
  onClose: () => void;
  onDone: () => void;
}) {
  const kinds = (Object.keys(CASH_ENTRY_KINDS) as CashEntryKind[]).filter((k) => CASH_ENTRY_KINDS[k].direction === direction);
  const [kind, setKind] = useState<CashEntryKind>(kinds[0]!);
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "bank">("cash");
  const [bankAccountId, setBankAccountId] = useState("");
  const [note, setNote] = useState("");
  const correction = kind === "CASH_OVER" || kind === "CASH_SHORT";
  const effectiveMethod = correction ? "cash" : method;
  const submit = useSubmit<{ number: string }>("/api/v1/cash/entries", (r) => `Recorded — ${r.number}`, onDone);
  const cents = toCents(amount);
  return (
    <Modal
      kicker="Cash & bank"
      title={direction === "in" ? "Money in" : "Money out"}
      onClose={onClose}
      onSubmit={() =>
        submit.mutate({
          branchId,
          kind,
          amountCents: cents,
          method: effectiveMethod,
          bankAccountId: effectiveMethod === "bank" ? bankAccountId : undefined,
          note: note.trim(),
        })
      }
      pending={submit.isPending}
      submitDisabled={!branchId || !(cents > 0) || !note.trim() || (effectiveMethod === "bank" && !bankAccountId)}
    >
      <label className="block text-sm text-ink-2">
        What is it?
        <select value={kind} onChange={(e) => setKind(e.target.value as CashEntryKind)} className={`${controlClass} w-full`}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {CASH_ENTRY_KINDS[k].label}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-ink-4">{KIND_HINT[kind]}</span>
      </label>
      <BranchSelect value={branchId} onChange={setBranchId} branches={branches} />
      <div className="grid gap-3 sm:grid-cols-2">
        <AmountInput value={amount} onChange={setAmount} />
        <label className="block text-sm text-ink-2">
          {direction === "in" ? "Into" : "From"}
          <select
            value={effectiveMethod}
            disabled={correction}
            onChange={(e) => setMethod(e.target.value as "cash" | "bank")}
            className={`${controlClass} w-full`}
          >
            <option value="cash">Cash drawer</option>
            <option value="bank">Bank account</option>
          </select>
        </label>
      </div>
      {effectiveMethod === "bank" ? (
        <label className="block text-sm text-ink-2">
          Bank account
          <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className={`${controlClass} w-full`}>
            <option value="">Choose an account…</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.account_code})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="block text-sm text-ink-2">
        Reason
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Required — so the books explain themselves" className={`${controlClass} w-full`} />
      </label>
      {direction === "out" && !correction ? (
        <p className="text-xs text-ink-4">
          Paying for rent, wages or supplies? Use <Link href="/expenses?new=1" className="text-gold-dark underline">Record expense</Link> instead so it counts against profit.
        </p>
      ) : null}
    </Modal>
  );
}

function BankMoveModal({
  kind,
  defaultBranchId,
  branches,
  banks,
  onClose,
  onDone,
}: {
  kind: "deposit" | "withdraw";
  defaultBranchId: string;
  branches: { id: string; name: string }[];
  banks: BankAccount[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [bankAccountId, setBankAccountId] = useState(banks[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const submit = useSubmit<{ entryNo: string }>(
    kind === "deposit" ? "/api/v1/cash/deposits" : "/api/v1/cash/withdrawals",
    (r) => `${kind === "deposit" ? "Deposit" : "Withdrawal"} recorded — ${r.entryNo}`,
    onDone
  );
  const cents = toCents(amount);
  return (
    <Modal
      kicker="Cash & bank"
      title={kind === "deposit" ? "Deposit cash to bank" : "Withdraw cash from bank"}
      onClose={onClose}
      onSubmit={() => submit.mutate({ branchId, bankAccountId, amountCents: cents, note: note.trim() || undefined })}
      pending={submit.isPending}
      submitDisabled={!branchId || !bankAccountId || !(cents > 0)}
    >
      <p className="text-sm text-ink-3">
        {kind === "deposit" ? "Moves money from the drawer into the bank." : "Moves money from the bank into the drawer."} Your total money does not change.
      </p>
      <BranchSelect value={branchId} onChange={setBranchId} branches={branches} />
      <label className="block text-sm text-ink-2">
        Bank account
        <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className={`${controlClass} w-full`}>
          {banks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.account_code})
            </option>
          ))}
        </select>
      </label>
      <AmountInput value={amount} onChange={setAmount} />
      <label className="block text-sm text-ink-2">
        Note (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. deposit slip no." className={`${controlClass} w-full`} />
      </label>
    </Modal>
  );
}

function AddBankModal({ branches, onClose, onDone }: { branches: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [branchId, setBranchId] = useState("");
  const submit = useSubmit<{ accountCode: string }>("/api/v1/bank-accounts", (r) => `Bank account added (ledger ${r.accountCode}) — set its opening balance next`, onDone);
  return (
    <Modal
      kicker="Cash & bank"
      title="Add bank account"
      onClose={onClose}
      onSubmit={() =>
        submit.mutate({
          name: name.trim(),
          bankName: bankName.trim() || undefined,
          accountNumber: accountNumber.trim() || undefined,
          branchId: branchId || undefined,
        })
      }
      pending={submit.isPending}
      submitDisabled={!name.trim()}
    >
      <label className="block text-sm text-ink-2">
        Name in the books
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BOC Current" className={`${controlClass} w-full`} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-ink-2">
          Bank (optional)
          <input value={bankName} onChange={(e) => setBankName(e.target.value)} className={`${controlClass} w-full`} />
        </label>
        <label className="block text-sm text-ink-2">
          Account number (optional)
          <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className={`${controlClass} w-full`} />
        </label>
      </div>
      <label className="block text-sm text-ink-2">
        Branch (optional)
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={`${controlClass} w-full`}>
          <option value="">Whole shop</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
    </Modal>
  );
}

function OpeningModal({ bank, onClose, onDone }: { bank: BankAccount; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(businessToday());
  const [reason, setReason] = useState("Balance per bank statement");
  const submit = useSubmit<{ entryNo: string }>(`/api/v1/bank-accounts/${bank.id}/opening`, (r) => `Opening balance posted — ${r.entryNo}`, onDone);
  const cents = toCents(amount);
  return (
    <Modal
      kicker="Opening balance"
      title={bank.name}
      onClose={onClose}
      onSubmit={() => submit.mutate({ amountCents: cents, reason: reason.trim(), entryDate: date })}
      pending={submit.isPending}
      submitDisabled={!(cents > 0) || !reason.trim()}
    >
      <p className="text-sm text-ink-3">What the bank statement showed on the day you started using GoldOS for this account. This can be set once.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <AmountInput value={amount} onChange={setAmount} label="Balance (LKR)" />
        <label className="block text-sm text-ink-2">
          As of
          <input type="date" value={date} max={businessToday()} onChange={(e) => setDate(e.target.value)} className={`${controlClass} w-full`} />
        </label>
      </div>
      <label className="block text-sm text-ink-2">
        Reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={`${controlClass} w-full`} />
      </label>
    </Modal>
  );
}

export default function CashBankPage() {
  return (
    <Suspense fallback={null}>
      <CashView />
    </Suspense>
  );
}
