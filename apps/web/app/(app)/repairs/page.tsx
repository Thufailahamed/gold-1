"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission, PERMISSIONS } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { lkr } from "@/lib/accounts";
import {
  Page,
  Hero,
  TableCard,
  TableSkeleton,
  Pager,
  EmptyBlock,
  Callout,
  StatusPill,
  FilterChips,
  CellStack,
  Modal,
  Field,
  controlClass,
  heroBtnPrimary,
} from "@/components/ui";
import { ArrowRightIcon, HammerIcon, PlusIcon } from "@/components/icons";
import {
  CustomerName,
  branchDefault,
  errMsg,
  statusLabel,
  useBranches,
  when,
  type Customer,
  type RepairStatus,
} from "./shared";

type RepairListRow = {
  id: string;
  number: string;
  customer_id: string;
  branch_id: string;
  item_desc: string;
  repair_type: string;
  estimate_cents: number;
  actual_cents: number | null;
  status: RepairStatus;
  created_at: number;
};

const PAGE_SIZE = 20;

const FILTERS: ReadonlyArray<{ key: "" | RepairStatus; label: string }> = [
  { key: "", label: "All" },
  { key: "RECEIVED", label: "Received" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "QC", label: "Awaiting QC" },
  { key: "READY", label: "Ready to collect" },
  { key: "COLLECTED", label: "Collected" },
  { key: "CANCELLED", label: "Cancelled" },
];

// Hero counters: one `limit=1` request per status, reading only `total`.
const COUNTED: ReadonlyArray<RepairStatus> = ["RECEIVED", "IN_PROGRESS", "QC", "READY"];

const REPAIR_TYPES = ["Resize", "Solder", "Polish", "Stone setting", "Clasp replacement", "Re-plating", "Chain repair"];

export default function RepairsPage() {
  const [status, setStatus] = useState<"" | RepairStatus>("");
  const [branchId, setBranchId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCreate = hasPermission(me.data?.permissions ?? [], PERMISSIONS.SALES_CREATE);
  const branches = useBranches();
  const branchRows = branches.data?.rows ?? [];
  const branchName = (id: string) => branchRows.find((b) => b.id === id)?.name ?? "-";

  const qs = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (branchId) p.set("branchId", branchId);
    for (const [k, v] of Object.entries(extra)) if (v !== "") p.set(k, String(v));
    return p.toString();
  };

  const list = useQuery({
    queryKey: ["repairs", "list", { status, branchId, search, page }],
    queryFn: () =>
      api<{ rows: RepairListRow[]; total: number }>(
        `/api/v1/repairs?${qs({ page, limit: PAGE_SIZE, status, search: search.trim() })}`
      ),
  });

  const counts = useQueries({
    queries: COUNTED.map((s) => ({
      queryKey: ["repairs", "count", s, branchId],
      queryFn: () => api<{ rows: RepairListRow[]; total: number }>(`/api/v1/repairs?${qs({ status: s, limit: 1 })}`),
    })),
  });
  const countOf = (s: RepairStatus) => counts[COUNTED.indexOf(s)]?.data?.total;
  const sum = (...ss: RepairStatus[]) => {
    const vals = ss.map(countOf);
    return vals.some((v) => v === undefined) ? "-" : vals.reduce<number>((n, v) => n + (v ?? 0), 0);
  };

  // The list endpoint does not filter on `search` yet, so narrow the loaded page here too.
  const term = search.trim().toLowerCase();
  const pageRows = list.data?.rows ?? [];
  const rows = term
    ? pageRows.filter((r) =>
        [r.number, r.item_desc, r.repair_type].some((v) => v.toLowerCase().includes(term))
      )
    : pageRows;
  const total = list.data?.total ?? 0;

  return (
    <Page>
      <Hero
        kicker="Sales"
        title="Repairs"
        description="Customer pieces in for repair: intake, workshop, quality check and paid collection."
        stats={[
          { label: status ? statusLabel(status) : "Jobs", value: list.data ? total : "-" },
          { label: "Awaiting technician", value: countOf("RECEIVED") ?? "-" },
          { label: "In workshop / QC", value: sum("IN_PROGRESS", "QC") },
          { label: "Ready to collect", value: countOf("READY") ?? "-" },
        ]}
        actions={
          canCreate ? (
            <button type="button" onClick={() => setCreating(true)} className={heroBtnPrimary}>
              <PlusIcon size={15} /> New repair
            </button>
          ) : null
        }
      />

      <TableCard
        title="Repair jobs"
        icon={<HammerIcon size={17} />}
        description="Newest first."
        actions={
          <span className="g-metric text-[11px] font-medium uppercase tracking-[0.14em] text-ink-4">
            {String(total).padStart(2, "0")} on file
          </span>
        }
        toolbar={
          <div className="flex flex-col gap-3">
            <FilterChips
              ariaLabel="Filter by status"
              options={FILTERS}
              value={status}
              onChange={(k) => {
                setStatus(k as "" | RepairStatus);
                setPage(1);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <label htmlFor="repair-search" className="sr-only">
                Search repairs
              </label>
              <input
                id="repair-search"
                placeholder="Search number, item or repair type…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className={`min-w-0 flex-1 sm:max-w-sm ${controlClass}`}
              />
              <label htmlFor="repair-branch-filter" className="sr-only">
                Branch
              </label>
              <select
                id="repair-branch-filter"
                value={branchId}
                onChange={(e) => {
                  setBranchId(e.target.value);
                  setPage(1);
                }}
                className={controlClass}
              >
                <option value="">All branches</option>
                {branchRows.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        }
        footer={<Pager page={page} onChange={setPage} pageSize={PAGE_SIZE} count={pageRows.length} total={total} unit="jobs" />}
      >
        {list.isLoading ? (
          <TableSkeleton rows={5} cols={7} />
        ) : list.isError ? (
          <div className="p-5">
            <Callout tone="danger" title="Could not load repairs">
              {errMsg(list.error, "Check the API connection and retry.")}
            </Callout>
          </div>
        ) : rows.length === 0 ? (
          <EmptyBlock
            icon={<HammerIcon size={22} />}
            title={total === 0 && !status && !branchId ? "No repairs yet" : "No repairs match"}
            description={
              total === 0 && !status && !branchId
                ? "Take in a customer's piece to open the first repair job."
                : "Try a different status, branch or search."
            }
            action={
              canCreate && total === 0 && !status && !branchId ? (
                <button type="button" onClick={() => setCreating(true)} className="g-btn g-btn-primary h-10 px-4 text-sm">
                  <PlusIcon size={15} /> New repair
                </button>
              ) : null
            }
          />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Item</th>
                <th>Customer</th>
                <th>Branch</th>
                <th>Status</th>
                <th className="!text-right">Estimate</th>
                <th className="!text-right">Actual</th>
                <th>Received</th>
                <th>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/repairs/${r.id}`} className="g-metric font-medium text-ink hover:text-gold-700">
                      {r.number}
                    </Link>
                  </td>
                  <td>
                    <CellStack primary={r.item_desc} secondary={r.repair_type} />
                  </td>
                  <td className="text-ink-3">
                    <CustomerName id={r.customer_id} />
                  </td>
                  <td className="text-ink-3">{branchName(r.branch_id)}</td>
                  <td>
                    <StatusPill status={r.status} label={statusLabel(r.status)} />
                  </td>
                  <td className="!text-right num-tabular">{lkr(r.estimate_cents)}</td>
                  <td className="!text-right num-tabular">
                    {r.actual_cents == null ? <span className="text-ink-4">-</span> : lkr(r.actual_cents)}
                  </td>
                  <td className="whitespace-nowrap text-ink-3">{when(r.created_at)}</td>
                  <td className="!text-right">
                    <Link
                      href={`/repairs/${r.id}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-gold-dark hover:text-ink"
                      aria-label={`Open repair ${r.number}`}
                    >
                      Open <ArrowRightIcon size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {creating ? <NewRepairDialog me={me.data} onClose={() => setCreating(false)} /> : null}
    </Page>
  );
}

/* ---------------------------------------------------------------- New repair */

function NewRepairDialog({ me, onClose }: { me: MeData | undefined; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [branchId, setBranchId] = useState(branchDefault);
  const [itemDesc, setItemDesc] = useState("");
  const [weightG, setWeightG] = useState("");
  const [repairType, setRepairType] = useState("");
  const [conditionIn, setConditionIn] = useState("");
  const [estimate, setEstimate] = useState("");

  const branches = useBranches();
  const customers = useQuery({
    queryKey: ["repair-customers", customerSearch],
    queryFn: () =>
      api<{ rows: Customer[]; total: number }>(`/api/v1/customers?search=${encodeURIComponent(customerSearch)}&limit=10`),
    enabled: customerSearch.trim().length > 0,
  });

  // Intake happens at a branch the user works at; shop-wide roles may pick any.
  const shopWide = hasPermission(me?.permissions ?? [], PERMISSIONS.BRANCHES_MANAGE);
  const branchRows = (branches.data?.rows ?? []).filter((b) => shopWide || (me?.branchIds ?? []).includes(b.id));
  // The cookie branch may not be one the user belongs to; fall back to the first listed.
  const effectiveBranch = branchRows.some((b) => b.id === branchId) ? branchId : branchRows[0]?.id ?? "";

  const weight = Number(weightG);
  const estimateLkr = Number(estimate.replace(/,/g, ""));
  const weightOk = Number.isFinite(weight) && weight > 0 && weight <= 100000;
  const estimateOk = Number.isFinite(estimateLkr) && estimateLkr > 0;
  const ready =
    !!customerId && !!effectiveBranch && !!itemDesc.trim() && !!repairType.trim() && !!conditionIn.trim() && weightOk && estimateOk;

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string; number: string }>("/api/v1/repairs", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          branchId: effectiveBranch,
          itemDesc: itemDesc.trim(),
          weightG: weight,
          conditionIn: conditionIn.trim(),
          repairType: repairType.trim(),
          estimateLkr,
        }),
      }),
    onSuccess: (d) => {
      toast.success(`Repair ${d.number} opened`);
      qc.invalidateQueries({ queryKey: ["repairs"] });
      router.push(`/repairs/${d.id}`);
    },
    onError: (e) => toast.error(errMsg(e, "Could not open the repair")),
  });

  const customerRows = customers.data?.rows ?? [];

  return (
    <Modal
      kicker="Repairs"
      title="New repair"
      wide
      onClose={onClose}
      onSubmit={() => create.mutate()}
      pending={create.isPending}
      submitDisabled={!ready}
      submitLabel="Open repair"
    >
      <p className="text-sm text-ink-3">
        Record the piece exactly as it is handed over. Weight and condition are snapshotted on the ticket.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Find customer" htmlFor="repair-customer-search" hint="Search by name or phone">
          <input
            id="repair-customer-search"
            autoFocus
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            placeholder="Name or phone…"
            autoComplete="off"
            className={`w-full ${controlClass}`}
          />
        </Field>
        <Field label="Customer" htmlFor="repair-customer">
          <select
            id="repair-customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={`w-full ${controlClass}`}
          >
            <option value="">
              {customers.isFetching ? "Searching…" : customerSearch.trim() ? "Select customer…" : "Search first…"}
            </option>
            {customerRows.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code}){c.phone ? ` · ${c.phone}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Branch" htmlFor="repair-branch">
          <select
            id="repair-branch"
            value={effectiveBranch}
            onChange={(e) => setBranchId(e.target.value)}
            className={`w-full ${controlClass}`}
            disabled={branches.isLoading}
          >
            {branches.isLoading ? <option value="">Loading…</option> : null}
            {!branches.isLoading && branchRows.length === 0 ? <option value="">No branches available</option> : null}
            {branchRows.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Repair type" htmlFor="repair-type">
          <input
            id="repair-type"
            list="repair-type-options"
            value={repairType}
            maxLength={100}
            onChange={(e) => setRepairType(e.target.value)}
            placeholder="e.g. Resize"
            autoComplete="off"
            className={`w-full ${controlClass}`}
          />
          <datalist id="repair-type-options">
            {REPAIR_TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Item" htmlFor="repair-item" hint="What the piece is, e.g. 22K ladies ring with red stone">
            <input
              id="repair-item"
              value={itemDesc}
              maxLength={500}
              onChange={(e) => setItemDesc(e.target.value)}
              className={`w-full ${controlClass}`}
            />
          </Field>
        </div>
        <Field
          label="Weight (g)"
          htmlFor="repair-weight"
          error={weightG && !weightOk ? "Enter a weight above 0 g" : undefined}
        >
          <input
            id="repair-weight"
            inputMode="decimal"
            value={weightG}
            onChange={(e) => setWeightG(e.target.value)}
            placeholder="0.000"
            className={`w-full num-tabular ${controlClass}`}
          />
        </Field>
        <Field
          label="Estimate (LKR)"
          htmlFor="repair-estimate"
          error={estimate && !estimateOk ? "Enter an estimate above 0" : undefined}
        >
          <input
            id="repair-estimate"
            inputMode="decimal"
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            placeholder="0.00"
            className={`w-full num-tabular ${controlClass}`}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Condition at intake" htmlFor="repair-condition" hint="Scratches, missing stones, breaks: anything the customer should agree to.">
            <textarea
              id="repair-condition"
              value={conditionIn}
              maxLength={1000}
              rows={3}
              onChange={(e) => setConditionIn(e.target.value)}
              className={`w-full py-2 !h-auto ${controlClass}`}
            />
          </Field>
        </div>
      </div>
      {customers.isError ? (
        <Callout tone="danger" title="Could not search customers">
          {errMsg(customers.error, "Please try again.")}
        </Callout>
      ) : null}
      {branches.isError ? (
        <Callout tone="danger" title="Could not load branches">
          {errMsg(branches.error, "Please try again.")}
        </Callout>
      ) : null}
    </Modal>
  );
}
