"use client";

import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Select } from "./select";
import { usePurchaseOptions, type ItemDraft } from "./purchase-items";
import { BanknoteIcon, CheckCircleIcon, GemIcon, LayersIcon, PlusIcon, ScaleIcon, TagsIcon, TrashIcon, XIcon } from "./icons";

/**
 * Themed building blocks for the purchasing dialogs (orders, invoices):
 * a dialog shell whose overlay scrolls so dropdowns are never clipped,
 * labelled inputs with unit tags, and an item editor using the themed Select.
 */

export const inputCls =
  "h-11 w-full rounded-xl bg-paper px-3.5 text-sm text-ink placeholder:text-ink-5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2),0_1px_2px_rgba(16,32,27,0.04)] transition-shadow hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.26)] focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)] aria-[invalid=true]:shadow-[inset_0_0_0_1px_#e11d48,0_0_0_4px_rgba(225,29,72,0.12)]";

/** Parses a typed amount, tolerating thousands separators. */
export const num = (s: string) => Number(s.replace(/,/g, ""));

export const newItem = (): ItemDraft => ({
  key: Date.now() + Math.random(),
  categoryId: "",
  metalTypeId: "",
  purityId: "",
  name: "",
  grossG: "",
  costLkr: "",
});

/** What a line still lacks before the purchase schemas accept it; a blank cost is sent as 0. */
export const itemMissing = (it: ItemDraft) =>
  [
    !it.name.trim() && "name",
    !it.categoryId && "category",
    !it.metalTypeId && "metal",
    !it.purityId && "purity",
    !(num(it.grossG) > 0 && num(it.grossG) <= 100000) && "weight",
    !(it.costLkr.trim() === "" || num(it.costLkr) >= 0) && "cost",
  ].filter(Boolean) as string[];

export function Dialog({
  icon,
  kicker,
  title,
  intro,
  onClose,
  pending,
  wide,
  footer,
  children,
  danger,
}: {
  icon: ReactNode;
  kicker: string;
  title: string;
  intro?: ReactNode;
  onClose: () => void;
  pending: boolean;
  wide?: boolean;
  footer: ReactNode;
  children: ReactNode;
  danger?: boolean;
}) {
  // Escape closes the dialog, unless an open dropdown inside it already handled the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  return (
    // The overlay scrolls rather than the dialog body, so dropdowns are never clipped.
    <div className="fixed inset-0 z-50 flex animate-fade-in justify-center overflow-y-auto bg-void/60 p-4 backdrop-blur-md" onClick={pending ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cn("my-auto flex w-full animate-pop-in flex-col rounded-[24px] bg-paper shadow-5 ring-1 ring-ink/20", wide ? "max-w-4xl" : "max-w-lg")}
      >
        <div className="relative overflow-hidden rounded-t-[24px] bg-void px-6 pb-5 pt-6 text-paper">
          <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-50" aria-hidden />
          <div className={cn("pointer-events-none absolute -right-16 -top-20 size-56 rounded-full blur-[80px]", danger ? "bg-rose-500/20" : "bg-gold/20")} aria-hidden />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
            className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-lg text-paper/50 transition-colors hover:bg-paper/10 hover:text-paper"
          >
            <XIcon size={16} />
          </button>
          <div className="relative flex items-center gap-3.5">
            <span
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-xl",
                danger
                  ? "bg-rose-500/15 text-rose-200 ring-1 ring-rose-300/25"
                  : "bg-gradient-to-b from-gold-light to-gold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_10px_22px_-10px_rgba(205,168,83,0.7)]"
              )}
            >
              {icon}
            </span>
            <div className="min-w-0 pr-8">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">{kicker}</div>
              <h2 className="g-display mt-1 text-xl text-paper">{title}</h2>
            </div>
          </div>
          {intro ? <div className="relative mt-3 text-xs leading-relaxed text-paper/55">{intro}</div> : null}
        </div>
        {children}
        <div className="flex flex-col-reverse gap-3 rounded-b-[24px] border-t border-ink/20 bg-bone/50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          {footer}
        </div>
      </div>
    </div>
  );
}

export function Label({ children, extra, htmlFor }: { children: ReactNode; extra?: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-2 flex items-center justify-between gap-2 text-[12.5px] font-medium text-ink-2">
      {children}
      {extra}
    </label>
  );
}

export function ItemField({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("min-w-0", className)}>
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-5">{label}</span>
      {children}
    </div>
  );
}

export function UnitInput({
  id,
  value,
  onChange,
  unit,
  placeholder,
  invalid,
  icon,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  unit: string;
  placeholder?: string;
  invalid?: boolean;
  icon?: ReactNode;
}) {
  return (
    <span className="group relative block">
      {icon ? <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-5">{icon}</span> : null}
      <input
        id={id}
        inputMode="decimal"
        value={value}
        aria-invalid={invalid ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(inputCls, "g-metric pr-16", icon && "pl-10")}
      />
      <span className="pointer-events-none absolute inset-y-1.5 right-1.5 flex items-center rounded-lg bg-bone px-2.5 text-[10px] font-semibold tracking-[0.12em] text-ink-4 transition-colors group-focus-within:bg-void group-focus-within:text-gold-light">
        {unit}
      </span>
    </span>
  );
}

export function DialogClose({ onClose, pending }: { onClose: () => void; pending: boolean }) {
  return (
    <button type="button" onClick={onClose} disabled={pending} className="g-btn h-11 rounded-xl px-4 text-sm text-ink-3 hover:bg-paper hover:text-ink">
      Close
    </button>
  );
}

export function Spinner() {
  return <span className="size-3.5 animate-spin rounded-full border-2 border-gold-light/30 border-t-gold-light" />;
}

/** Line items for a purchase: one card per piece with the themed dropdowns. */
export function PurchaseItemsEditor({
  items,
  onChange,
  costLabel = "Cost",
}: {
  items: ItemDraft[];
  onChange: (items: ItemDraft[]) => void;
  costLabel?: string;
}) {
  const { cats, purs, metals } = usePurchaseOptions();
  const set = (key: number, patch: Partial<ItemDraft>) => onChange(items.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-5">
          Items · <span className="g-metric">{items.length}</span>
        </span>
        <button type="button" onClick={() => onChange([...items, newItem()])} className="g-btn g-btn-secondary h-9 rounded-xl px-3 text-xs">
          <PlusIcon size={13} /> Add item
        </button>
      </div>

      <div className="space-y-3">
        {items.map((it, i) => {
          const miss = itemMissing(it);
          const done = miss.length === 0;
          return (
            <div key={it.key} className={cn("relative rounded-2xl bg-bone/40 p-4 ring-1 transition-colors", done ? "ring-emerald-600/20" : "ring-ink/20")}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "g-metric flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                      done ? "bg-emerald-600 text-paper" : "bg-void text-gold-light"
                    )}
                  >
                    {done ? <CheckCircleIcon size={12} /> : i + 1}
                  </span>
                  <span className="truncate text-[13px] font-semibold text-ink">{it.name.trim() || `Item ${i + 1}`}</span>
                  {!done ? <span className="hidden truncate text-[11px] text-ink-5 sm:inline">needs {miss.join(", ")}</span> : null}
                </span>
                {items.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => onChange(items.filter((x) => x.key !== it.key))}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-50"
                  >
                    <TrashIcon size={12} /> Remove
                  </button>
                ) : null}
              </div>
              {/* Row 1: what it is and what it weighs/costs. Row 2: the three classifications. */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
                <ItemField label="Item name" className="sm:col-span-2 lg:col-span-6">
                  <input
                    aria-label={`Item ${i + 1} name`}
                    placeholder="e.g. 22K bangle pair"
                    maxLength={100}
                    value={it.name}
                    onChange={(e) => set(it.key, { name: e.target.value })}
                    className={inputCls}
                  />
                </ItemField>
                <ItemField label="Gross weight" className="lg:col-span-3">
                  <UnitInput
                    value={it.grossG}
                    onChange={(v) => set(it.key, { grossG: v })}
                    unit="g"
                    placeholder="0.000"
                    invalid={it.grossG !== "" && !(num(it.grossG) > 0)}
                    icon={<ScaleIcon size={14} />}
                  />
                </ItemField>
                <ItemField label={costLabel} className="lg:col-span-3">
                  <UnitInput
                    value={it.costLkr}
                    onChange={(v) => set(it.key, { costLkr: v })}
                    unit="LKR"
                    placeholder="0.00"
                    invalid={it.costLkr !== "" && !(num(it.costLkr) >= 0)}
                    icon={<BanknoteIcon size={14} />}
                  />
                </ItemField>
                <ItemField label="Category" className="lg:col-span-4">
                  <Select
                    ariaLabel="Category"
                    value={it.categoryId}
                    onChange={(v) => set(it.key, { categoryId: v })}
                    placeholder="Choose category"
                    icon={<TagsIcon size={13} />}
                    options={cats.map((c) => ({ value: c.id, label: c.name ?? c.id }))}
                  />
                </ItemField>
                <ItemField label="Metal" className="lg:col-span-4">
                  <Select
                    ariaLabel="Metal"
                    value={it.metalTypeId}
                    onChange={(v) => set(it.key, { metalTypeId: v })}
                    placeholder="Choose metal"
                    icon={<LayersIcon size={13} />}
                    options={metals.map((c) => ({ value: c.id, label: c.name ?? c.id }))}
                  />
                </ItemField>
                <ItemField label="Purity" className="sm:col-span-2 lg:col-span-4">
                  <Select
                    ariaLabel="Purity"
                    value={it.purityId}
                    onChange={(v) => set(it.key, { purityId: v })}
                    placeholder="Choose purity"
                    icon={<GemIcon size={13} />}
                    options={purs.map((p) => ({ value: p.id, label: p.karat ?? p.name ?? p.id }))}
                  />
                </ItemField>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
