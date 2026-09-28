"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, downloadCsv, type MeData } from "@/lib/api";
import { Page, Hero, Panel, Pill, EmptyBlock, controlClass, heroBtnGhost } from "@/components/ui";
import { FileDownIcon } from "@/components/icons";

type ApprovalRow = {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  requesterId: string;
  approverId: string | null;
  oldValue: string;
  newValue: string;
  reason: string;
  branchId: string | null;
  status: string;
  expiresAt: number;
  decidedAt: number | null;
  createdAt: number;
};

const STATUSES = ["PENDING", "APPROVED", "REJECTED", "EXPIRED"] as const;
const ACTIONS = [
  "SALES_DISCOUNT",
  "PRICE_OVERRIDE",
  "GOLD_RATE_CHANGE",
  "GOLD_STOCK_ADJUST",
  "INVENTORY_ADJUST",
  "OLDGOLD_VALUATION",
  "MELT_DIFFERENCE",
  "MFG_DIFFERENCE",
  "SALES_CANCEL",
  "PURCHASE_CANCEL",
  "SALES_RETURN",
  "FIN_ADJUST",
] as const;

function parseJson(raw: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw);
    return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function fmtTs(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-GB");
}

export default function ApprovalsPage() {
  const [status, setStatus] = useState<string>("PENDING");
  const [action, setAction] = useState("");
  const [branchId, setBranchId] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/branches?limit=100"),
  });
  const canExport = hasPermission(me.data?.permissions ?? [], "audit:export");
  const query = `/api/v1/approvals?status=${status}${action ? `&action=${action}` : ""}${branchId ? `&branchId=${branchId}` : ""}`;
  const list = useQuery({
    queryKey: ["approvals", status, action, branchId],
    queryFn: () => api<{ rows: ApprovalRow[]; total: number }>(query),
  });
  const rows = list.data?.rows ?? [];

  async function decide(id: string, approve: boolean) {
    setError(null);
    try {
      await api(`/api/v1/approvals/${id}/${approve ? "approve" : "reject"}`, {
        method: "POST",
        body: JSON.stringify(approve ? {} : { reason: rejectReason }),
      });
      setRejectId(null);
      setRejectReason("");
      await qc.invalidateQueries({ queryKey: ["approvals"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decision failed");
    }
  }

  return (
    <Page>
      <Hero
        kicker="Controls"
        title="Approval Center"
        description="High-risk actions awaiting a second person. Expired requests must be re-requested."
        stats={[
          { label: "Showing", value: list.isLoading ? "—" : rows.length },
          { label: "Total", value: list.data?.total ?? "—" },
        ]}
        actions={
          canExport ? (
            <button
              onClick={() => downloadCsv(`${query}&format=csv`, `approvals-${status.toLowerCase()}.csv`).catch((e: unknown) => setError(e instanceof Error ? e.message : "Export failed"))}
              className={heroBtnGhost}
            >
              <FileDownIcon size={14} /> Export CSV
            </button>
          ) : undefined
        }
      />
      <div className="no-print flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`g-btn h-9 px-3.5 text-xs ${status === s ? "g-btn-primary" : "g-btn-secondary"}`}>
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
        <select value={action} onChange={(e) => setAction(e.target.value)} className={controlClass} aria-label="Action">
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={controlClass} aria-label="Branch">
          <option value="">All branches</option>
          {(branches.data?.rows ?? []).map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>
      {error ? <Pill tone="danger">{error}</Pill> : null}
      {list.isLoading ? (
        <EmptyBlock title="Loading" description="Fetching approval requests." />
      ) : rows.length === 0 ? (
        <EmptyBlock title={`No ${status.toLowerCase()} requests`} description="Nothing in this view for the selected filters." />
      ) : (
        rows.map((r) => {
          const oldV = parseJson(r.oldValue);
          const newV = parseJson(r.newValue);
          const keys = [...new Set([...Object.keys(oldV), ...Object.keys(newV)])];
          const open = openId === r.id;
          return (
            <Panel key={r.id} title={`${r.action} · ${r.entity}`} description={`${r.entityId} — requested ${fmtTs(r.createdAt)}`}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Pill tone={r.status === "PENDING" ? "warning" : r.status === "APPROVED" ? "success" : "ghost"}>{r.status}</Pill>
                <span className="text-ink-4">Requester {r.requesterId}</span>
                <span className="text-ink-4">Approver {r.approverId ?? "—"}</span>
                <span className="text-ink-4">Expires {fmtTs(r.expiresAt)}</span>
                {r.decidedAt ? <span className="text-ink-4">Decided {fmtTs(r.decidedAt)}</span> : null}
                <button onClick={() => setOpenId(open ? null : r.id)} className="g-btn ml-auto h-8 px-3 text-xs">
                  {open ? "Hide changes" : "Show changes"}
                </button>
                {r.status === "PENDING" ? (
                  <>
                    <button onClick={() => decide(r.id, true)} className="g-btn h-8 px-3 text-xs">Approve</button>
                    <button onClick={() => setRejectId(r.id)} className="g-btn h-8 px-3 text-xs">Reject</button>
                  </>
                ) : null}
              </div>
              <div className="mt-2 text-sm text-ink-3">Reason: {r.reason}</div>
              {r.status === "EXPIRED" ? <div className="mt-1 text-sm text-ink-4">Expired — re-request to proceed.</div> : null}
              {open ? (
                <table className="g-table mt-3">
                  <thead>
                    <tr><th>Field</th><th>Old value</th><th>New value</th></tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => (
                      <tr key={k}>
                        <td className="font-medium text-ink">{k}</td>
                        <td className="num-tabular">{JSON.stringify(oldV[k] ?? null)}</td>
                        <td className="num-tabular">{JSON.stringify(newV[k] ?? null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {rejectId === r.id ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Rejection reason (required)"
                    className={controlClass}
                  />
                  <button onClick={() => decide(r.id, false)} className="g-btn h-8 px-3 text-xs">Confirm reject</button>
                  <button onClick={() => { setRejectId(null); setRejectReason(""); }} className="g-btn h-8 px-3 text-xs">Cancel</button>
                </div>
              ) : null}
            </Panel>
          );
        })
      )}
    </Page>
  );
}
