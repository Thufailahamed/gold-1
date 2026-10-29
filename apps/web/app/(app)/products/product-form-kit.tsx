"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { AlertCircleIcon, CheckIcon } from "@/components/icons";

/**
 * Building blocks shared by the product intake screens (one piece, or a tray
 * of them), so both read as one family.
 */

export type Option = { id: string; name?: string; code?: string; karat?: string; permille?: number };

/** Matches the trigger of the themed <Select> so every control reads as one family. */
export const inputCls = cn(
  "h-9 w-full rounded-lg bg-paper px-3 text-[13px] text-ink placeholder:text-ink-5",
  "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2),0_1px_2px_rgba(16,32,27,0.04)] transition-[box-shadow,background-color] duration-200",
  "hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.26),0_1px_2px_rgba(16,32,27,0.04)]",
  "focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)]",
  "aria-[invalid=true]:shadow-[inset_0_0_0_1px_#e11d48,0_0_0_4px_rgba(225,29,72,0.12)]"
);

export const fmtG = (v: number | null) => (v !== null && Number.isFinite(v) ? v.toFixed(3) : "—");
export const toOptions = (rows: Option[] | undefined, none?: string): { value: string; label: string }[] => [
  ...(none ? [{ value: "", label: none }] : []),
  ...(rows ?? []).map((r) => ({ value: r.id, label: r.name ?? r.karat ?? r.id })),
];

export function Field({
  label,
  required,
  optional,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("block min-w-0", className)}>
      <span className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-4">
          {label}
          {required ? <span className="ml-0.5 text-gold-dark">*</span> : null}
        </span>
        {optional ? <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-5">Optional</span> : null}
      </span>
      {children}
      {error ? (
        <span role="alert" className="mt-1 flex items-center gap-1 text-[11px] font-medium text-rose-700">
          <AlertCircleIcon size={12} />
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-[10.5px] text-ink-5">{hint}</span>
      ) : null}
    </div>
  );
}

export function FormSection({
  id,
  n,
  title,
  description,
  icon,
  done,
  required,
  children,
}: {
  id: string;
  n: string;
  title: string;
  description: string;
  icon: ReactNode;
  done: boolean;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset
      id={id}
      className={cn(
        "relative scroll-mt-24 rounded-2xl bg-paper transition-shadow duration-320",
        "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]",
        "focus-within:shadow-[inset_0_0_0_1px_rgba(205,168,83,0.45),0_1px_2px_rgba(16,32,27,0.04),0_28px_56px_-34px_rgba(16,32,27,0.45)]"
      )}
    >
      <legend className="sr-only">{title}</legend>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent to-transparent transition-opacity duration-320",
          done ? "via-gold opacity-100" : "via-gold/40 opacity-60"
        )}
      />
      <header className="flex items-center gap-3 border-b border-ink/20 px-4 py-2.5">
        <span className="relative flex size-8 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)]">
          {icon}
          <span className="g-metric absolute -right-1.5 -top-1.5 flex size-[18px] items-center justify-center rounded-full bg-paper text-[9px] text-ink shadow-[0_0_0_1px_rgba(16,32,27,0.12)]">
            {n}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-sans text-[13.5px] font-semibold tracking-normal text-ink">{title}</h2>
          <p className="truncate text-[11px] text-ink-4">{description}</p>
        </div>
        {done ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-b from-gold-light to-gold px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
            <CheckIcon size={11} />
            Done
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-bone px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4 ring-1 ring-ink/20">
            {required ? "Required" : "Optional"}
          </span>
        )}
      </header>
      <div className="px-4 py-4">{children}</div>
    </fieldset>
  );
}

export function UnitInput({
  unit,
  className,
  ...rest
}: React.ComponentProps<"input"> & { unit: string }) {
  return (
    <span className="group relative block">
      <input
        type="number"
        step="any"
        inputMode="decimal"
        placeholder="0.00"
        {...rest}
        className={cn(inputCls, "g-metric pr-14 text-[14px]", className)}
      />
      <span className="pointer-events-none absolute inset-y-1 right-1 flex items-center rounded-md bg-bone px-2 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-ink-4 ring-1 ring-ink/20 transition-colors group-focus-within:bg-void group-focus-within:text-gold-light">
        {unit}
      </span>
    </span>
  );
}
