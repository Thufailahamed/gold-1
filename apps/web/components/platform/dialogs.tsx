"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Modal, controlClass } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * Every consequential platform action carries a written reason into the
 * audit log. This dialog collects it (min 3 chars, matching the API) and
 * reports failures inline via toast without closing, so the reason is not lost.
 */
export function ReasonDialog({
  title,
  kicker = "Confirm",
  description,
  submitLabel = "Confirm",
  danger = false,
  closeOnSuccess = true,
  onSubmit,
  onClose,
  children,
}: {
  title: ReactNode;
  kicker?: ReactNode;
  description?: ReactNode;
  submitLabel?: string;
  danger?: boolean;
  /** false when a successful submit swaps the dialog for a result view instead. */
  closeOnSuccess?: boolean;
  onSubmit: (reason: string) => Promise<unknown>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const valid = reason.trim().length >= 3;

  async function submit() {
    if (!valid) return;
    setPending(true);
    try {
      await onSubmit(reason.trim());
      if (closeOnSuccess) onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal title={title} kicker={kicker} onClose={onClose} onSubmit={submit} submitLabel={submitLabel} pending={pending} submitDisabled={!valid} danger={danger}>
      {description ? <p className="text-sm text-ink-3">{description}</p> : null}
      {children}
      <div>
        <label htmlFor="reason" className="mb-1.5 block text-xs font-medium text-ink-3">
          Reason <span className="text-ink-5">(recorded in the audit log)</span>
        </label>
        <textarea
          id="reason"
          autoFocus
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
          className={cn(controlClass, "h-auto w-full py-2")}
          placeholder="e.g. Customer requested via ticket TKT-000042"
        />
      </div>
    </Modal>
  );
}

/** Form field wrapper used across platform forms — label, control, optional hint. */
export function F({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mb-1.5 block text-xs font-medium text-ink-3">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-ink-4">{hint}</span> : null}
    </label>
  );
}

/** A usage bar against a plan limit. `max === null` renders "Unlimited". */
export function LimitMeter({ label, used, max, unit }: { label: string; used: number; max: number | null; unit?: string }) {
  const pct = max === null ? 0 : max === 0 ? 100 : Math.min(100, Math.round((used / max) * 100));
  const tone = max === null ? "bg-ink/20" : used >= (max ?? 0) ? "bg-rose-600" : pct >= 80 ? "bg-amber-500" : "bg-gold";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-ink-3">{label}</span>
        <span className="g-metric text-ink">
          {used.toLocaleString()}
          <span className="text-ink-4"> / {max === null ? "∞" : max.toLocaleString()}{unit ? ` ${unit}` : ""}</span>
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max ?? undefined}
        aria-valuenow={used}
      >
        <div className={cn("h-full rounded-full transition-[width] duration-700 ease-brand", tone)} style={{ width: max === null ? "100%" : `${pct}%`, opacity: max === null ? 0.35 : 1 }} />
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50",
        checked ? "bg-ink" : "bg-ink/15"
      )}
    >
      <span className={cn("inline-block size-4 rounded-full bg-paper shadow transition-transform duration-200", checked ? "translate-x-6 bg-gold" : "translate-x-1")} />
    </button>
  );
}
