"use client";

// Old gold taken in against the bill at the till. The customer's valued pieces
// are ticked, and a piece brought in today is added with its weight and amount.
// A piece taken in here is only held until the sale completes; the balance is
// what the counter settles — the customer pays the difference when the new
// pieces win, or the shop pays it out when the old gold does. The POS owns the
// selection, the payment and the save; this only shows and collects.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui";
import { ArrowLeftRightIcon, GemIcon, PlusIcon, XIcon } from "@/components/icons";

export type ValuedOldGold = {
  id: string;
  number: string;
  description: string;
  karat: string | null;
  tested_permille: number | null;
  net_mg: number;
  purchase_value_cents: number | null;
};

/** A piece taken in at the counter and not yet on record. */
export type HeldOldGold = {
  key: string;
  grossG: number;
  valueCents: number;
  description?: string;
  categoryId?: string;
  categoryCode?: string;
};

export type ExchangePayout = "cash" | "store_credit";

/** What the cashier keys for a piece taken in at the counter: its weight and the amount paid for it. */
export type NewOldGold = {
  grossG: number;
  valueLkr: number;
  /** Optional; recorded like the intake desk's description. */
  description?: string;
  /** The old gold category it is filed under; blank means OG. */
  categoryId?: string;
  categoryCode?: string;
};

const money = (c: number) => (c / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
const grams = (mg: number) => (mg / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });

export function OldGoldExchange({
  customerName,
  pieces,
  loading,
  selectedIds,
  onToggle,
  pending,
  onRemovePending,
  saleTotalCents,
  oldTotalCents,
  payout,
  onPayout,
  canAdd,
  onAdd,
}: {
  customerName: string;
  pieces: ValuedOldGold[];
  loading: boolean;
  selectedIds: string[];
  onToggle: (id: string) => void;
  /** Pieces taken in here, held until the sale completes. */
  pending: HeldOldGold[];
  onRemovePending: (key: string) => void;
  /** The new pieces with tax, before any old gold. */
  saleTotalCents: number;
  /** Value of all the old gold in this sale, ticked and taken in. */
  oldTotalCents: number;
  payout: ExchangePayout;
  onPayout: (p: ExchangePayout) => void;
  /** Whether this till may take old gold in. */
  canAdd: boolean;
  /** Holds a new piece for this sale. */
  onAdd: (v: NewOldGold) => void;
}) {
  const [open, setOpen] = useState(false);
  const [weight, setWeight] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  // The old gold categories; OG is the default. The piece is filed under the one chosen.
  const categories = useQuery({
    queryKey: ["og-categories"],
    queryFn: () => api<{ rows: { id: string; name: string; code: string; isDefault: boolean }[] }>("/api/v1/oldgold/categories"),
    staleTime: 5 * 60_000,
  });
  const categoryRows = categories.data?.rows ?? [];
  const [categoryId, setCategoryId] = useState("");
  const category = categoryRows.find((c) => c.id === categoryId) ?? categoryRows.find((c) => c.isDefault);
  const ticked = selectedIds.length + pending.length;
  const balance = saleTotalCents - oldTotalCents;

  const gross = Number(weight);
  const problem = !(gross > 0) ? "Enter the weight" : !(Number(amount) > 0) ? "Enter the amount the shop pays" : null;

  function submit() {
    if (problem) return;
    onAdd({
      grossG: gross,
      valueLkr: Number(amount),
      description: description.trim() || undefined,
      categoryId: category?.id,
      categoryCode: category?.code,
    });
    setWeight("");
    setAmount("");
    setDescription("");
    setOpen(false);
  }

  return (
    <Panel
      title="Old gold exchange"
      icon={<ArrowLeftRightIcon size={17} />}
      description={`${ticked} piece${ticked === 1 ? "" : "s"} in this sale · ${customerName}`}
    >
      {canAdd ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-xs text-ink-3">Old gold the customer brings in today</span>
          {open ? null : (
            <button type="button" onClick={() => setOpen(true)} className="g-btn g-btn-secondary h-8 rounded-lg px-3 text-xs">
              <PlusIcon size={12} /> Take in old gold
            </button>
          )}
        </div>
      ) : null}

      {open ? (
        <div className="mb-4 rounded-xl bg-bone/70 p-4 ring-1 ring-ink/[0.06]">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-ink">New piece from {customerName}</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close intake"
              className="inline-flex size-7 items-center justify-center rounded-md text-ink-4 transition-colors hover:bg-ink/[0.06] hover:text-ink"
            >
              <XIcon size={14} />
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-dark md:col-span-2">
              Description
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. 22K rope chain, broken clasp (optional)"
                className="mt-1.5 h-10 w-full rounded-xl bg-paper px-3 text-sm font-normal text-ink ring-1 ring-ink/10 focus:outline-none focus:ring-gold-dark/50"
              />
            </label>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-dark md:col-span-2">
              Category
              <select
                value={category?.id ?? ""}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={categoryRows.length === 0}
                className="mt-1.5 h-10 w-full rounded-xl bg-paper px-3 text-sm font-normal text-ink ring-1 ring-ink/10 focus:outline-none focus:ring-gold-dark/50"
              >
                {categoryRows.length === 0 ? <option value="">No old gold category</option> : null}
                {categoryRows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-dark">
              Weight (g)
              <input
                type="number"
                step="any"
                min={0}
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                autoFocus
                className="num-tabular mt-1.5 h-10 w-full rounded-xl bg-paper px-3 text-sm font-normal text-ink ring-1 ring-ink/10 focus:outline-none focus:ring-gold-dark/50"
              />
            </label>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-dark">
              Amount the shop pays (LKR)
              <input
                type="number"
                step="any"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Agreed amount"
                className="num-tabular mt-1.5 h-10 w-full rounded-xl bg-paper px-3 text-sm font-normal text-ink ring-1 ring-ink/10 focus:outline-none focus:ring-gold-dark/50"
              />
            </label>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            {problem ? <span className="mr-auto text-xs text-ink-4">{problem}</span> : null}
            <button type="button" onClick={() => setOpen(false)} className="g-btn g-btn-secondary h-9 rounded-xl px-3 text-xs">
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={Boolean(problem)} className="g-btn g-btn-primary h-9 rounded-xl px-4 text-xs">
              Add to sale
            </button>
          </div>
        </div>
      ) : null}

      {!loading && pieces.length === 0 && pending.length === 0 ? (
        <p className="text-sm text-ink-3">
          {canAdd ? (
            `${customerName} has no valued old gold yet. Take the piece in above to add it to this sale.`
          ) : (
            <>
              {customerName} has no valued old gold at this branch. Value it on the{" "}
              <Link href="/old-gold/items?status=VALUED" className="font-medium text-gold-deep underline">
                old gold page
              </Link>{" "}
              to take it in against this sale.
            </>
          )}
        </p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {pending.map((p) => (
            <li key={p.key}>
              <div className="flex items-center gap-3 rounded-xl bg-gold-pale/70 px-3.5 py-2.5 ring-1 ring-gold-dark/40">
                <GemIcon size={15} className="shrink-0 text-gold-dark" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">New piece · {grams(p.grossG * 1000)} g</span>
                  <span className="block text-xs text-ink-4">
                  {[p.categoryCode, p.description].filter(Boolean).join(" · ")}
                  {p.categoryCode || p.description ? " · " : ""}Saved when the sale is completed
                </span>
                </span>
                <span className="num-tabular shrink-0 text-sm font-semibold text-ink">{money(p.valueCents)}</span>
                <button
                  type="button"
                  onClick={() => onRemovePending(p.key)}
                  aria-label={`Remove the new piece of ${grams(p.grossG * 1000)} g`}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-4 transition-colors hover:bg-ink/[0.06] hover:text-ink"
                >
                  <XIcon size={14} />
                </button>
              </div>
            </li>
          ))}
          {pieces.map((p) => {
            const on = selectedIds.includes(p.id);
            return (
              <li key={p.id}>
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl px-3.5 py-2.5 ring-1 transition-colors",
                    on ? "bg-gold-pale/70 ring-gold-dark/40" : "bg-bone/70 ring-ink/[0.06] hover:ring-gold-dark/30"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onToggle(p.id)}
                    aria-label={`Take in ${p.number}`}
                    className="size-4 shrink-0 accent-[#CDA853]"
                  />
                  <GemIcon size={15} className="shrink-0 text-gold-dark" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {p.description}
                      <span className="ml-2 font-mono text-xs font-normal text-ink-4">{p.number}</span>
                    </span>
                    <span className="block text-xs text-ink-4">
                      {grams(p.net_mg)} g
                      {p.karat ? ` · ${p.karat}` : ""}
                    </span>
                  </span>
                  <span className="num-tabular shrink-0 text-sm font-semibold text-ink">{money(p.purchase_value_cents ?? 0)}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {ticked > 0 ? (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-bone/70 px-3.5 py-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.06)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">New pieces</p>
              <p className="num-tabular mt-1 text-lg font-semibold text-ink">{money(saleTotalCents)}</p>
            </div>
            <div className="rounded-xl bg-bone/70 px-3.5 py-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.06)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">Old gold in</p>
              <p className="num-tabular mt-1 text-lg font-semibold text-ink">{money(oldTotalCents)}</p>
            </div>
            <div
              className={cn(
                "rounded-xl px-3.5 py-3 ring-1 ring-inset",
                balance > 0 && "bg-amber-50 ring-amber-600/20",
                balance < 0 && "bg-emerald-50 ring-emerald-600/20",
                balance === 0 && "bg-bone/70 ring-ink/[0.06]"
              )}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">
                {balance > 0 ? "Customer pays" : balance < 0 ? (payout === "cash" ? "Cash to customer" : "Clears bills") : "Balance"}
              </p>
              <p className="num-tabular mt-1 text-lg font-semibold text-ink">
                {balance === 0 ? "Settled" : money(Math.abs(balance))}
              </p>
            </div>
          </div>

          {balance < 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-3">
                {payout === "cash" ? "The old gold left after the bill is paid out in cash" : "The old gold left after the bill clears their open bills"}
              </span>
              {(
                [
                  ["store_credit", "Clear open bills"],
                  ["cash", "Cash to customer"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={payout === value}
                  onClick={() => onPayout(value)}
                  className={cn("g-btn h-8 rounded-lg px-3 text-xs", payout === value ? "g-btn-primary" : "g-btn-secondary")}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </Panel>
  );
}
