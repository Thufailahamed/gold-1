"use client";

import { useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { ArrowLeftIcon } from "@/components/icons";
import {
  EmptyBlock,
  Hero,
  Modal,
  Page,
  Skeleton,
  StatusPill,
  controlClass,
} from "@/components/ui";
import { api, assetUrl, formApi, type MeData } from "@/lib/api";

type Detail = {
  id: string;
  number: string;
  category_name: string;
  account_code: string;
  branch_id: string;
  incurred_on: string;
  amount_cents: number;
  vendor: string | null;
  description: string;
  payment_account_code: string;
  bank_account_id: string | null;
  status: string;
  receipt_key: string | null;
  journal_entry_id: string | null;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: number | null;
  rejection_reason: string | null;
};

const fmt = (c: number) => (c / 100).toLocaleString("en-US");

export default function ExpenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canManage = hasPermission(me.data?.permissions ?? [], "accounts:manage");

  const detail = useQuery({
    queryKey: ["expense", id],
    queryFn: () => api<Detail>(`/api/v1/expenses/${id}`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["expense", id] });
    qc.invalidateQueries({ queryKey: ["expenses"] });
    qc.invalidateQueries({ queryKey: ["expense-summary"] });
  };

  const approve = useMutation({
    mutationFn: () => api(`/api/v1/expenses/${id}/approve`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      toast.success("Approved and posted to the ledger");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not approve"),
  });

  const reject = useMutation({
    mutationFn: () =>
      api(`/api/v1/expenses/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      toast.success("Rejected");
      setRejectOpen(false);
      setReason("");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not reject"),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return formApi<{ key: string }>(`/api/v1/expenses/${id}/receipt`, form);
    },
    onSuccess: () => {
      toast.success("Receipt attached");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Upload failed"),
  });

  const exp = detail.data;

  return (
    <Page>
      <Hero
        kicker="Accounts"
        title={exp ? exp.number : "Expense"}
        description={exp?.description ?? "Expense detail"}
        actions={
          <button
            type="button"
            onClick={() => router.back()}
            className="g-btn g-btn-secondary h-10 px-4 text-sm"
          >
            <ArrowLeftIcon size={15} />
            Back
          </button>
        }
      />

      {detail.isLoading ? (
        <Skeleton className="h-48" />
      ) : !exp ? (
        <EmptyBlock title="Not found" description="This expense does not exist." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="g-surface space-y-2 rounded-xl p-5 text-sm">
            <div className="flex items-center justify-between">
              <p className="g-kicker">Amount</p>
              <StatusPill status={exp.status} />
            </div>
            <p className="g-metric text-2xl font-semibold text-ink">
              {fmt(exp.amount_cents)} <span className="text-sm font-normal text-ink-3">LKR</span>
            </p>
            <dl className="space-y-1.5 pt-2 text-ink-2">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-4">Category</dt>
                <dd>
                  {exp.category_name} ({exp.account_code})
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-4">Incurred</dt>
                <dd>{exp.incurred_on}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-4">Branch</dt>
                <dd>{exp.branch_id}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-4">Paid from</dt>
                <dd className="g-metric">{exp.payment_account_code}</dd>
              </div>
              {exp.vendor ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-4">Vendor</dt>
                  <dd>{exp.vendor}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3">
                <dt className="text-ink-4">Entry</dt>
                <dd className="g-metric text-xs">{exp.journal_entry_id ? "posted" : "not yet posted"}</dd>
              </div>
            </dl>
            {exp.rejection_reason ? (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
                Rejected: {exp.rejection_reason}
              </p>
            ) : null}
            {exp.approved_at ? (
              <p className="pt-1 text-xs text-ink-4">
                Approved {new Date(exp.approved_at).toLocaleString()}
              </p>
            ) : null}
          </div>

          <div className="space-y-4">
            <div className="g-surface space-y-3 rounded-xl p-5">
              <p className="g-kicker">Receipt</p>
              {exp.receipt_key ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={assetUrl(`/api/v1/expenses/${exp.id}/receipt`)}
                  alt="Expense receipt"
                  className="max-h-64 w-full rounded-lg border border-ink/10 object-contain"
                />
              ) : (
                <p className="text-sm text-ink-4">
                  No receipt attached.
                  {exp.status === "PENDING_APPROVAL"
                    ? " This amount is above the receipt threshold, so it cannot be approved without one."
                    : ""}
                </p>
              )}
              {canManage ? (
                <div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) upload.mutate(f);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={upload.isPending}
                    className="g-btn g-btn-secondary h-9 px-3 text-sm"
                  >
                    {upload.isPending ? "Uploading…" : exp.receipt_key ? "Replace receipt" : "Attach receipt"}
                  </button>
                </div>
              ) : null}
            </div>

            {canManage && exp.status === "PENDING_APPROVAL" ? (
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => approve.mutate()}
                  disabled={approve.isPending}
                  className="g-btn g-btn-primary h-10 flex-1 text-sm"
                >
                  {approve.isPending ? "Approving…" : "Approve"}
                </button>
                <button
                  type="button"
                  onClick={() => setRejectOpen(true)}
                  className="g-btn g-btn-secondary h-10 flex-1 text-sm"
                >
                  Reject
                </button>
              </div>
            ) : null}
            {canManage && exp.status === "PENDING_APPROVAL" ? (
              <p className="text-xs text-ink-4">
                Someone other than the person who recorded it must approve this.
              </p>
            ) : null}
          </div>
        </div>
      )}

      {rejectOpen ? (
        <Modal
          kicker="Accounts"
          title="Reject expense"
          danger
          submitLabel="Reject"
          submitDisabled={!reason}
          pending={reject.isPending}
          onClose={() => setRejectOpen(false)}
          onSubmit={() => reject.mutate()}
        >
          <label className="block text-sm text-ink-2">
            Why
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Not a shop expense, capital purchase…"
              className={controlClass}
            />
          </label>
          <p className="text-xs text-ink-4">
            The expense is kept with this reason. Nothing is deleted.
          </p>
        </Modal>
      ) : null}
    </Page>
  );
}
