"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { hasPermission, PERMISSIONS } from "@goldos/shared";
import { api, PendingApprovalError, type MeData } from "@/lib/api";
import { lkr, readBranchCookie, toCents } from "@/lib/accounts";
import {
  Page,
  Hero,
  TableCard,
  TableSkeleton,
  Pager,
  EmptyBlock,
  Callout,
  StatusPill,
  Pill,
  FilterChips,
  Modal,
  Field,
  controlClass,
  heroBtnPrimary,
} from "@/components/ui";
import { ArrowRightIcon, GemIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

type CustomStatus = "QUOTE" | "ADVANCED" | "IN_PRODUCTION" | "QC_PASSED" | "READY" | "DELIVERED" | "CANCELLED";

type CustomOrderRow = {
  id: string;
  number: string;
  customer_id: string;
  branch_id: string;
  design: string;
  gold_source: "CUSTOMER" | "SHOP" | "MIXED";
  quote_cents: number;
  advance_cents: number;
  status: CustomStatus;
  created_at: number;
};

type Customer = { id: string; name: string; code: string };
type Branch = { id: string; name: string; code?: string };

const STATUS_LABEL: Record<CustomStatus, string> = {
  QUOTE: "Quote",
  ADVANCED: "Advance taken",
  IN_PRODUCTION: "In production",
  QC_PASSED: "QC passed",
  READY: "Ready to deliver",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

const SOURCE_LABEL: Record<CustomOrderRow["gold_source"], string> = {
  CUSTOMER: "Customer gold",
  SHOP: "Shop gold",
  MIXED: "Mixed",
};

const STATUS_FILTERS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "", label: "All" },
  ...(Object.keys(STATUS_LABEL) as CustomStatus[]).map((s) => ({ key: s, label: STATUS_LABEL[s] })),
];

const PAGE_SIZE = 20;
const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function CustomOrdersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [dialog, setDialog] = useState(false);

  // Dashboards link here with ?status= or ?new=1.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get("status");
    if (s && s in STATUS_LABEL) setStatus(s);
    if (q.get("new") === "1") setDialog(true);
  }, []);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCreate = hasPermission(me.data?.permissions ?? [], PERMISSIONS.MFG_CREATE);

  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () => api<{ rows: Branch[] }>("/api/v1/branches?limit=100"),
  });
  const branchName = (id: string) => branches.data?.rows.find((b) => b.id === id)?.name ?? "—";

  const list = useQuery({
    queryKey: ["custom-orders", page, status, branchFilter, search],
    queryFn: () =>
      api<{ rows: CustomOrderRow[]; total: number }>(
        `/api/v1/custom-orders?page=${page}&limit=${PAGE_SIZE}&search=${encodeURIComponent(search)}${status ? `&status=${status}` : ""}${branchFilter ? `&branchId=${encodeURIComponent(branchFilter)}` : ""}`
      ),
  });

  // The list endpoint ignores `search` today, so narrow the page client-side
  // as well; this stays correct once the server filters too.
  const needle = search.trim().toLowerCase();
  const all = list.data?.rows ?? [];
  const rows = needle
    ? all.filter((r) => r.number.toLowerCase().includes(needle) || r.design.toLowerCase().includes(needle))
    : all;
  const total = list.data?.total ?? 0;
  const open = all.filter((r) => r.status !== "DELIVERED" && r.status !== "CANCELLED").length;
  const ready = all.filter((r) => r.status === "READY").length;
  const advances = all.reduce((n, r) => n + (r.status === "CANCELLED" ? 0 : r.advance_cents), 0);

  return (
    <Page>
      <Hero
        kicker="Workshop"
        title="Custom orders"
        description="Quote, take advances, earmark gold, produce and deliver one customer's piece."
        note="A quote posts nothing. Advances book to customer payables and are applied at delivery."
        stats={[
          { label: "Orders", value: total },
          { label: "Open on this page", value: open },
          { label: "Ready to deliver", value: ready },
          { label: "Advances held", value: `${lkr(advances)} LKR` },
        ]}
        actions={
          canCreate ? (
            <button type="button" onClick={() => setDialog(true)} className={heroBtnPrimary}>
              <PlusIcon size={15} /> New custom order
            </button>
          ) : null
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterChips
          ariaLabel="Filter by status"
          value={status}
          onChange={(k) => {
            setStatus(k);
            setPage(1);
          }}
          options={STATUS_FILTERS}
        />
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <SearchIcon size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
            <label htmlFor="co-search" className="sr-only">
              Search custom orders
            </label>
            <input
              id="co-search"
              placeholder="Search number or design…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className={`pl-8 ${controlClass}`}
            />
          </div>
          <label htmlFor="co-branch" className="sr-only">
            Branch
          </label>
          <select
            id="co-branch"
            value={branchFilter}
            onChange={(e) => {
              setBranchFilter(e.target.value);
              setPage(1);
            }}
            className={controlClass}
          >
            <option value="">All branches</option>
            {(branches.data?.rows ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <TableCard
        title="Orders"
        icon={<GemIcon size={17} />}
        actions={
          <span className="g-metric text-[11px] font-medium uppercase tracking-[0.14em] text-ink-4">
            {String(total).padStart(2, "0")} on file
          </span>
        }
        footer={<Pager page={page} onChange={setPage} pageSize={PAGE_SIZE} count={all.length} total={total} unit="orders" />}
      >
        {list.isLoading ? (
          <TableSkeleton rows={5} cols={7} />
        ) : list.isError ? (
          <div className="p-5">
            <Callout tone="danger" title="Could not load custom orders">
              {errMsg(list.error, "Check the API connection and retry.")}
            </Callout>
          </div>
        ) : rows.length === 0 ? (
          <EmptyBlock
            icon={<GemIcon size={22} />}
            title={all.length === 0 && !status && !branchFilter ? "No custom orders yet" : "No custom orders match"}
            description={
              all.length === 0 && !status && !branchFilter
                ? "Record a quote for a customer's bespoke piece to start."
                : "Try a different status, branch or search."
            }
            action={
              canCreate && all.length === 0 && !status && !branchFilter ? (
                <button type="button" onClick={() => setDialog(true)} className="g-btn g-btn-primary h-10 px-4 text-sm">
                  <PlusIcon size={15} /> New custom order
                </button>
              ) : null
            }
          />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Design</th>
                <th>Customer</th>
                <th>Branch</th>
                <th>Gold</th>
                <th className="!text-right">Quote LKR</th>
                <th className="!text-right">Advance LKR</th>
                <th>Status</th>
                <th>Date</th>
                <th>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/custom-orders/${r.id}`} className="g-metric font-medium text-ink hover:text-gold-700">
                      {r.number}
                    </Link>
                  </td>
                  <td className="font-medium text-ink">{r.design}</td>
                  <td className="text-ink-3">
                    <CustomerName id={r.customer_id} />
                  </td>
                  <td className="text-ink-3">{branchName(r.branch_id)}</td>
                  <td>
                    <Pill tone="neutral">{SOURCE_LABEL[r.gold_source] ?? r.gold_source}</Pill>
                  </td>
                  <td className="!text-right num-tabular">{lkr(r.quote_cents)}</td>
                  <td className="!text-right num-tabular">{lkr(r.advance_cents)}</td>
                  <td>
                    <StatusPill status={r.status} label={STATUS_LABEL[r.status] ?? r.status} />
                  </td>
                  <td className="whitespace-nowrap text-ink-3">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="!text-right">
                    <Link
                      href={`/custom-orders/${r.id}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-gold-dark hover:text-ink"
                      aria-label={`Open custom order ${r.number}`}
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

      {dialog ? <NewOrderDialog me={me.data} branches={branches.data?.rows ?? []} onClose={() => setDialog(false)} /> : null}
    </Page>
  );
}

/**
 * The list rows carry only customer_id; resolve the name per id. Each id is
 * cached under ["customer", id] so repeat customers cost one request.
 */
function CustomerName({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["customer", id],
    queryFn: () => api<Customer>(`/api/v1/customers/${id}`),
    staleTime: 5 * 60_000,
  });
  if (q.isLoading) return <span className="text-ink-5">…</span>;
  if (!q.data) return <span className="g-metric text-xs">{id.slice(0, 8)}</span>;
  return (
    <span>
      {q.data.name} <span className="text-ink-4">({q.data.code})</span>
    </span>
  );
}

/* ---------------------------------------------------------------- New order */

function NewOrderDialog({ me, branches, onClose }: { me: MeData | undefined; branches: Branch[]; onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [design, setDesign] = useState("");
  const [description, setDescription] = useState("");
  const [goldReqG, setGoldReqG] = useState("");
  const [goldSource, setGoldSource] = useState<"CUSTOMER" | "SHOP" | "MIXED">("SHOP");
  const [quote, setQuote] = useState("");

  // Shop-wide roles may quote for any branch; everyone else for their own.
  const canShop = hasPermission(me?.permissions ?? [], PERMISSIONS.BRANCHES_MANAGE);
  const visibleBranches = useMemo(
    () => branches.filter((b) => canShop || (me?.branchIds ?? []).includes(b.id)),
    [branches, canShop, me]
  );
  // Default to the branch picked in the top bar, then the first visible one.
  useEffect(() => {
    if (branchId || visibleBranches.length === 0) return;
    const saved = readBranchCookie();
    setBranchId(visibleBranches.find((b) => b.id === saved)?.id ?? visibleBranches[0]?.id ?? "");
  }, [branchId, visibleBranches]);

  const customers = useQuery({
    queryKey: ["co-customers", customerSearch],
    queryFn: () =>
      api<{ rows: Customer[]; total: number }>(`/api/v1/customers?search=${encodeURIComponent(customerSearch)}&limit=10`),
    enabled: customerSearch.length > 0,
  });

  const goldNum = Number(goldReqG);
  const quoteCents = toCents(quote);
  const valid =
    !!customerId && !!branchId && design.trim().length > 0 && goldNum > 0 && Number.isFinite(quoteCents) && quoteCents > 0;

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string; number: string }>("/api/v1/custom-orders", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          branchId,
          design: design.trim(),
          description: description.trim() || undefined,
          goldReqG: goldNum,
          goldSource,
          quoteLkr: quoteCents / 100,
        }),
      }),
    onSuccess: (d) => {
      toast.success(`Custom order ${d.number} quoted`);
      qc.invalidateQueries({ queryKey: ["custom-orders"] });
      onClose();
      router.push(`/custom-orders/${d.id}`);
    },
    onError: (e) => {
      if (e instanceof PendingApprovalError) {
        toast.message("Sent for approval", { description: e.message });
        return;
      }
      toast.error(errMsg(e, "Create failed"));
    },
  });

  return (
    <Modal
      wide
      kicker="Custom order"
      title="New custom order"
      onClose={onClose}
      onSubmit={() => create.mutate()}
      pending={create.isPending}
      submitDisabled={!valid}
      submitLabel="Record quote"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Find customer" htmlFor="co-customer-search">
          <input
            id="co-customer-search"
            autoFocus
            placeholder="Name, code or phone…"
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            className={`w-full ${controlClass}`}
          />
        </Field>
        <Field
          label="Customer"
          htmlFor="co-customer"
          hint={customerSearch.length === 0 ? "Search to list customers." : customers.isFetching ? "Searching…" : undefined}
          error={customers.isError ? errMsg(customers.error, "Customer search failed") : undefined}
        >
          <select
            id="co-customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={`w-full ${controlClass}`}
          >
            <option value="">Select customer…</option>
            {(customers.data?.rows ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Branch" htmlFor="co-new-branch">
          <select
            id="co-new-branch"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className={`w-full ${controlClass}`}
          >
            <option value="">Select branch…</option>
            {visibleBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Gold source" htmlFor="co-source" hint="Customer gold must be bought through old-gold first, then earmarked.">
          <select
            id="co-source"
            value={goldSource}
            onChange={(e) => setGoldSource(e.target.value as "CUSTOMER" | "SHOP" | "MIXED")}
            className={`w-full ${controlClass}`}
          >
            <option value="SHOP">Shop gold</option>
            <option value="CUSTOMER">Customer gold</option>
            <option value="MIXED">Mixed</option>
          </select>
        </Field>
      </div>
      <Field label="Design" htmlFor="co-design">
        <input
          id="co-design"
          value={design}
          maxLength={200}
          onChange={(e) => setDesign(e.target.value)}
          className={`w-full ${controlClass}`}
        />
      </Field>
      <Field label="Description (optional)" htmlFor="co-description">
        <textarea
          id="co-description"
          value={description}
          maxLength={2000}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
          className={cn(controlClass, "h-auto w-full py-2")}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Gold required (g)" htmlFor="co-gold">
          <input
            id="co-gold"
            type="number"
            step="any"
            min="0"
            value={goldReqG}
            onChange={(e) => setGoldReqG(e.target.value)}
            className={`w-full num-tabular ${controlClass}`}
          />
        </Field>
        <Field
          label="Quote (LKR, net of tax)"
          htmlFor="co-quote"
          error={quote && !Number.isFinite(quoteCents) ? "Enter an amount with at most 2 decimals." : undefined}
        >
          <input
            id="co-quote"
            inputMode="decimal"
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
            className={`w-full num-tabular ${controlClass}`}
          />
        </Field>
      </div>
    </Modal>
  );
}
