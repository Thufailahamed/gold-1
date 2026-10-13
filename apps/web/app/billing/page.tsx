"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, downloadFile, formApi } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { usePlatformContext } from "@/components/platform-banner";
import { controlClass } from "@/components/ui";
import { ArrowRightIcon, GemIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

type Invoice = {
  id: string;
  number: string;
  total_cents: number;
  amount_paid_cents: number;
  status: string;
  due_at: number;
  period_start: number | null;
  period_end: number | null;
};

type Slip = {
  id: string;
  invoice_id: string;
  invoice_number: string;
  amount_cents: number;
  bank_ref: string | null;
  status: string;
  reject_reason: string | null;
  created_at: number;
};

function lkr(cents: number) {
  return `LKR ${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

export default function BillingPage() {
  const { me, loading } = useSession();
  const ctx = usePlatformContext();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [slips, setSlips] = useState<Slip[]>([]);
  const [invoiceId, setInvoiceId] = useState("");
  const [bankRef, setBankRef] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [inv, sl] = await Promise.all([
        api<{ rows: Invoice[] }>("/api/v1/billing/invoices").catch(() => ({ rows: [] as Invoice[] })),
        api<{ rows: Slip[] }>("/api/v1/billing/slips").catch(() => ({ rows: [] as Slip[] })),
      ]);
      setInvoices(inv.rows);
      setSlips(sl.rows);
      if (!invoiceId && inv.rows[0]) setInvoiceId(inv.rows[0].id);
    } catch {
      // Lists stay empty; the banner below explains billing state.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (me) refresh();
  }, [me, refresh]);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !invoiceId) {
      toast.error("Pick an invoice and a slip scan first.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("invoiceId", invoiceId);
      if (bankRef.trim()) form.set("bankRef", bankRef.trim());
      await formApi("/api/v1/billing/slips", form);
      toast.success("Slip uploaded — we will confirm within a day.");
      setFile(null);
      setBankRef("");
      refresh();
      ctx.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <main className="flex min-h-dvh items-center justify-center bg-bone text-sm text-ink-4">Loading…</main>;
  if (!me) return null;

  const d = ctx.data;
  const trialDays =
    d?.managed && d.subscription?.status === "TRIALING" && d.subscription.trialEndsAt
      ? Math.max(0, Math.ceil((d.subscription.trialEndsAt - Date.now()) / 864e5))
      : null;

  return (
    <main className="min-h-dvh bg-bone px-4 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-2xl">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-xs text-ink-4 hover:text-ink hover:underline">
          <GemIcon size={14} className="text-gold-dark" /> Back to console
        </Link>
        <h1 className="g-display mt-3 text-3xl text-ink">Billing</h1>
        <p className="mt-1 text-sm text-ink-4">
          {trialDays !== null ? (
            <>Your trial ends in <strong className="text-ink">{trialDays} day{trialDays === 1 ? "" : "s"}</strong>. Pay by bank transfer and upload the slip below.</>
          ) : (
            <>Pay by bank transfer and upload the slip below. Staff confirm it, usually within a day.</>
          )}
          {d?.managed ? <> Questions? <a className="underline" href={`mailto:${d.supportEmail}`}>{d.supportEmail}</a>.</> : null}
        </p>

        <section aria-label="Open invoices" className="g-elevated mt-6 p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-ink">Open invoices</h2>
          {invoices.length === 0 ? (
            <p className="mt-2 text-sm text-ink-4">Nothing owed right now.</p>
          ) : (
            <ul className="mt-3 divide-y divide-ink/10">
              {invoices.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span>
                    <span className="font-mono font-medium text-ink">{inv.number}</span>
                    <span className="ml-2 text-xs text-ink-4">due {new Date(inv.due_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                  </span>
                  <span className="g-metric font-semibold text-ink">{lkr(inv.total_cents - inv.amount_paid_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Upload a bank slip" className="g-elevated mt-4 p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-ink">Upload a bank slip</h2>
          <form onSubmit={onUpload} className="mt-3 space-y-3">
            <label className="block text-xs font-medium text-ink-3">
              <span className="mb-1.5 block">Invoice</span>
              <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} className={cn(controlClass, "w-full")}>
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.number} — {lkr(inv.total_cents - inv.amount_paid_cents)}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-ink-3">
                <span className="mb-1.5 block">Slip scan (PNG, JPEG or PDF, ≤5MB)</span>
                <input type="file" accept="image/png,image/jpeg,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className={cn(controlClass, "w-full")} />
              </label>
              <label className="block text-xs font-medium text-ink-3">
                <span className="mb-1.5 block">Bank reference (optional)</span>
                <input value={bankRef} onChange={(e) => setBankRef(e.target.value)} placeholder="DEP-001" className={cn(controlClass, "w-full")} />
              </label>
            </div>
            <button type="submit" disabled={uploading || invoices.length === 0} className="g-btn g-btn-primary h-11 px-5 text-sm">
              {uploading ? "Uploading…" : "Upload slip"}
              {!uploading && <ArrowRightIcon size={14} className="g-btn-arrow" />}
            </button>
          </form>
        </section>

        <section aria-label="Your uploads" className="g-elevated mt-4 p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-ink">Your uploads</h2>
          {slips.length === 0 ? (
            <p className="mt-2 text-sm text-ink-4">No uploads yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-ink/10">
              {slips.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span>
                    <span className="font-mono font-medium text-ink">{s.invoice_number}</span>
                    <span className="ml-2 text-ink-4">{lkr(s.amount_cents)}</span>
                    {s.status === "REJECTED" && s.reject_reason ? (
                      <span className="mt-0.5 block text-xs text-rose-700">Rejected: {s.reject_reason}</span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium",
                        s.status === "APPROVED" ? "bg-emerald-100 text-emerald-800" : s.status === "REJECTED" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-900"
                      )}
                    >
                      {s.status}
                    </span>
                    <button
                      type="button"
                      onClick={() => downloadFile(`/api/v1/billing/slips/${s.id}/download`, `slip-${s.invoice_number}`).catch((err) => toast.error(err instanceof Error ? err.message : "Download failed"))}
                      className="text-xs text-ink-4 underline underline-offset-2 hover:text-ink"
                    >
                      Download
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
