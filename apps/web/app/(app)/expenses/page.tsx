"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import {
  EmptyBlock,
  Hero,
  Modal,
  Page,
  Pager,
  StatusPill,
  TableCard,
  TableSkeleton,
  FilterChips,
  Tabs,
  controlClass,
  heroBtnPrimary,
} from "@/components/ui";
import {
  BanknoteIcon,
  CheckCircleIcon,
  HistoryIcon,
  LayoutGridIcon,
  PlusIcon,
  XIcon,
} from "@/components/icons";
import { api, type MeData } from "@/lib/api";

type Category = {
  id: string;
  name: string;
  account_code: string;
  is_active: number;
  lifetime_cents: number;
};

type BankAccount = { id: string; name: string; account_code: string; is_active: number };

type Expense = {
  id: string;
  number: string;
  category_id: string;
  category_name: string;
  account_code: string;
  branch_id: string;
  incurred_on: string;
  amount_cents: number;
  vendor: string | null;
  description: string;
  payment_account_code: string;
  status: string;
  receipt_key: string | null;
  requested_by: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
};

const fmt = (c: number) => (c / 100).toLocaleString("en-US");
const todayStr = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

function rangeFor(key: string): { from: string; to: string } {
  const t = todayStr();
  if (key === "today") return { from: t, to: t };
  if (key === "week") {
    const d = new Date(`${t}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    return { from: d.toISOString().slice(0, 10), to: t };
  }
  if (key === "month") return { from: `${t.slice(0, 8)}01`, to: t };
  return { from: "", to: "" };
}

function ExpensesView() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const params = useSearchParams();
  const [range, setRange] = useState(params.get("range") ?? "all");
  const { from, to } = rangeFor(range);
  const dateQuery = `${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`;
  const [open, setOpen] = useState(params.get("new") === "1");
  const [categoryId, setCategoryId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [vendor, setVendor] = useState("");
  const [paidFrom, setPaidFrom] = useState<"cash" | "bank">("cash");
  const [bankAccountId, setBankAccountId] = useState("");

  useEffect(() => {
    const saved = document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1];
    if (saved) setBranchId((b) => b || saved);
  }, []);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canManage = hasPermission(me.data?.permissions ?? [], "accounts:manage");

  const cats = useQuery({
    queryKey: ["expense-categories"],
    queryFn: () => api<Category[]>("/api/v1/expense-categories"),
  });
  const banks = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: () => api<BankAccount[]>("/api/v1/bank-accounts"),
  });
  const branchQuery = branchId ? `&branchId=${encodeURIComponent(branchId)}` : "";
  const list = useQuery({
    queryKey: ["expenses", page, status, from, to, branchId],
    queryFn: () =>
      api<{ rows: Expense[]; total: number }>(
        `/api/v1/expenses?page=${page}&limit=20${status ? `&status=${status}` : ""}${dateQuery}${branchQuery}`
      ),
  });
  const summary = useQuery({
    queryKey: ["expense-summary", from, to, branchId],
    queryFn: () => api<{ totalCents: number; pendingCents: number; rejectedCents: number }>(
      `/api/v1/expenses/reports/summary?${dateQuery.slice(1)}${branchQuery}`
    ),
  });
  const branches = useQuery({
    queryKey: ["branches-for-expenses"],
    queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/branches?limit=100"),
  });

  const activeBanks = useMemo(
    () => (banks.data ?? []).filter((b) => b.is_active),
    [banks.data]
  );

  const create = useMutation({
    mutationFn: () =>
      api<{ status: string; requiresReceipt: boolean }>("/api/v1/expenses", {
        method: "POST",
        body: JSON.stringify({
          categoryId,
          branchId,
          amountLkr: Number(amount),
          description,
          vendor: vendor || undefined,
          paidFrom,
          bankAccountId: paidFrom === "bank" ? bankAccountId : undefined,
        }),
      }),
    onSuccess: (r) => {
      toast.success(
        r.status === "PENDING_APPROVAL"
          ? "Recorded — waiting for approval"
          : `Recorded${r.requiresReceipt ? " — attach a receipt when you have it" : ""}`
      );
      setOpen(false);
      setAmount("");
      setDescription("");
      setVendor("");
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["expense-summary"] });
      qc.invalidateQueries({ queryKey: ["acct"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not record"),
  });

  const rows = list.data?.rows ?? [];

  return (
    <Page>
      <Hero
        kicker="Accounts"
        back={{ href: "/accounts", label: "Accounts dashboard" }}
        title="Expenses"
        description="Every expense posts itself to its category's ledger account"
        actions={
          canManage ? (
            <button type="button" onClick={() => setOpen(true)} className={heroBtnPrimary}>
              <PlusIcon size={15} />
              Record expense
            </button>
          ) : null
        }
        stats={[
          { label: "Expenses", value: (list.data?.total ?? 0).toLocaleString("en-US") },
          { label: "Posted", value: fmt(summary.data?.totalCents ?? 0) },
          { label: "Awaiting approval", value: fmt(summary.data?.pendingCents ?? 0) },
        ]}
        note="A large expense holds for approval. Until it is approved the ledger has not seen it, so the day's cash reads high by that amount."
      />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterChips
            ariaLabel="Date range"
            value={range}
            onChange={(k) => {
              setRange(k);
              setPage(1);
            }}
            options={[
              { key: "today", label: "Today" },
              { key: "week", label: "Last 7 days" },
              { key: "month", label: "This month" },
              { key: "all", label: "All time" },
            ]}
          />
        </div>
        <Tabs
          ariaLabel="Expense status"
          value={status}
          onChange={(k) => {
            setStatus(k);
            setPage(1);
          }}
          items={[
            { key: "", label: "All", icon: <LayoutGridIcon size={14} /> },
            { key: "POSTED", label: "Posted", icon: <CheckCircleIcon size={14} /> },
            { key: "PENDING_APPROVAL", label: "Awaiting approval", icon: <HistoryIcon size={14} /> },
            { key: "REJECTED", label: "Rejected", icon: <XIcon size={14} /> },
          ]}
        />

        <TableCard
          title="Expense register"
          icon={<BanknoteIcon size={17} />}
          actions={
            <span className="g-metric text-[11px] font-medium uppercase tracking-[0.14em] text-ink-4">
              {String(list.data?.total ?? 0).padStart(2, "0")} on file
            </span>
          }
          footer={
            <Pager
              page={page}
              onChange={setPage}
              pageSize={20}
              count={rows.length}
              total={list.data?.total ?? 0}
              unit="expenses"
            />
          }
        >
          {list.isLoading ? (
            <TableSkeleton rows={6} cols={5} />
          ) : rows.length === 0 ? (
            <EmptyBlock
              title="No expenses yet"
              description="Record rent, utilities, repairs and anything else the shop spends on."
            />
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Paid from</th>
                  <th className="!text-right">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="g-metric text-xs">
                      <Link href={`/expenses/${r.id}`} className="text-gold-dark transition-colors hover:text-ink">
                        {r.number}
                      </Link>
                    </td>
                    <td className="text-ink-3">{r.incurred_on}</td>
                    <td className="text-ink-2">
                      <Link href={`/expenses/${r.id}`} className="transition-colors hover:text-ink">
                        {r.description}
                      </Link>
                      {r.vendor ? <span className="text-ink-4"> — {r.vendor}</span> : null}
                    </td>
                    <td className="text-ink-3">{r.category_name}</td>
                    <td className="g-metric text-xs">{r.payment_account_code}</td>
                    <td className="!text-right num-tabular">{fmt(r.amount_cents)}</td>
                    <td>
                      {/* statusTone already maps POSTED/PENDING_APPROVAL/REJECTED
                          to success/warning/danger. */}
                      <StatusPill status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      </div>

      {open ? (
        <Modal
          kicker="Accounts"
          title="Record expense"
          onClose={() => setOpen(false)}
          onSubmit={() => create.mutate()}
          pending={create.isPending}
          submitDisabled={!categoryId || !branchId || !amount || !description || (paidFrom === "bank" && !bankAccountId)}
        >
          <label className="block text-sm text-ink-2">
            Category
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={controlClass}>
              <option value="">Choose a category…</option>
              {(cats.data ?? [])
                .filter((c) => c.is_active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.account_code})
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-sm text-ink-2">
            Branch
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={controlClass}>
              <option value="">Choose a branch…</option>
              {(branches.data?.rows ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-ink-2">
            Amount LKR
            <input
              type="number"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`num-tabular ${controlClass}`}
            />
          </label>
          <label className="block text-sm text-ink-2">
            Description
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What was this for?"
              className={controlClass}
            />
          </label>
          <label className="block text-sm text-ink-2">
            Vendor (optional)
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} className={controlClass} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-ink-2">
              Paid from
              <select
                value={paidFrom}
                onChange={(e) => setPaidFrom(e.target.value as "cash" | "bank")}
                className={controlClass}
              >
                <option value="cash">Cash (1000)</option>
                <option value="bank">Bank</option>
              </select>
            </label>
            {paidFrom === "bank" ? (
              <label className="block text-sm text-ink-2">
                Bank account
                <select
                  value={bankAccountId}
                  onChange={(e) => setBankAccountId(e.target.value)}
                  className={controlClass}
                >
                  <option value="">Choose an account…</option>
                  {activeBanks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.account_code})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}

export default function ExpensesPage() {
  return (
    <Suspense fallback={null}>
      <ExpensesView />
    </Suspense>
  );
}
