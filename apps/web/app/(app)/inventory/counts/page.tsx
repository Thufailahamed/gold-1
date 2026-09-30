"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import {
  Page,
  Hero,
  TableCard,
  TableSkeleton,
  StatusPill,
  Pill,
  Modal,
  Callout,
  EmptyBlock,
  FilterChips,
  Field,
  CellStack,
  controlClass,
  heroBtnPrimary,
} from "@/components/ui";
import { ArrowRightIcon, ClipboardCheckIcon, PlusIcon } from "@/components/icons";

type CountScope = "FULL" | "CATEGORY" | "BRANCH" | "LOCATION";
type CountStatus = "OPEN" | "COMPLETE" | "CANCELLED";

type CountListRow = {
  id: string;
  branch_id: string;
  branch_name: string | null;
  scope: CountScope;
  scope_ref: string | null;
  scope_label: string | null;
  status: CountStatus;
  opened_by: string | null;
  opened_by_name: string | null;
  created_at: number;
  expected: number;
  scanned: number;
};

const SCOPE_LABEL: Record<CountScope, string> = {
  FULL: "Whole branch",
  BRANCH: "Whole branch",
  CATEGORY: "Category",
  LOCATION: "Location",
};

const FILTERS = [
  { key: "", label: "All" },
  { key: "OPEN", label: "Open" },
  { key: "COMPLETE", label: "Complete" },
  { key: "CANCELLED", label: "Cancelled" },
] as const;

const when = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? "";
}

export default function StockCountsPage() {
  const [status, setStatus] = useState("");
  const [starting, setStarting] = useState(false);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canEdit = hasPermission(me.data?.permissions ?? [], "products:edit");

  const counts = useQuery({
    queryKey: ["counts", status],
    queryFn: () =>
      api<CountListRow[]>(`/api/v1/counts${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  });

  const rows = counts.data ?? [];
  const openCount = status === "" ? rows.filter((r) => r.status === "OPEN").length : null;

  return (
    <Page>
      <Hero
        back={{ href: "/inventory", label: "Inventory" }}
        kicker="Inventory"
        title="Stock counts"
        description="Scan every piece on the shelf and compare it with the book. While a count is open, the pieces it covers are locked from sale and transfer."
        actions={
          canEdit ? (
            <button type="button" onClick={() => setStarting(true)} className={heroBtnPrimary}>
              <PlusIcon size={14} /> Start count
            </button>
          ) : null
        }
        stats={
          counts.data && openCount !== null
            ? [
                { label: "Counts shown", value: rows.length },
                { label: "Open now", value: openCount },
              ]
            : undefined
        }
      />

      <TableCard
        title="Counts"
        icon={<ClipboardCheckIcon size={17} />}
        description="The latest 100 counts across your branches"
        toolbar={
          <FilterChips
            ariaLabel="Filter by status"
            options={FILTERS}
            value={status}
            onChange={setStatus}
          />
        }
      >
        {counts.isLoading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : counts.isError ? (
          <div className="p-5">
            <Callout tone="danger" title="Could not load counts">
              {counts.error instanceof Error ? counts.error.message : "Please try again."}
            </Callout>
          </div>
        ) : rows.length === 0 ? (
          <EmptyBlock
            icon={<ClipboardCheckIcon size={22} />}
            title={status ? "No counts with this status" : "No stock counts yet"}
            description="Start a count to scan a branch, a category or a single location and find missing pieces."
            action={
              canEdit ? (
                <button type="button" onClick={() => setStarting(true)} className="g-btn g-btn-primary h-10 px-4 text-sm">
                  <PlusIcon size={14} /> Start count
                </button>
              ) : null
            }
          />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Branch</th>
                <th>Scope</th>
                <th>Status</th>
                <th className="!text-right">Progress</th>
                <th>Opened by</th>
                <th>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-ink-3">{when(r.created_at)}</td>
                  <td>{r.branch_name ?? "-"}</td>
                  <td>
                    <CellStack
                      primary={SCOPE_LABEL[r.scope] ?? r.scope}
                      secondary={r.scope === "CATEGORY" || r.scope === "LOCATION" ? r.scope_label ?? r.scope_ref : undefined}
                    />
                  </td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                  <td className="num">
                    <span className="num-tabular">
                      {r.scanned.toLocaleString("en-US")} / {r.expected.toLocaleString("en-US")}
                    </span>
                    {r.status === "OPEN" && r.expected > 0 && r.scanned >= r.expected ? (
                      <Pill tone="success" className="ml-2">All found</Pill>
                    ) : null}
                  </td>
                  <td>{r.opened_by_name ?? "-"}</td>
                  <td className="!text-right">
                    <Link
                      href={`/inventory/counts/${r.id}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-gold-dark transition-colors hover:text-ink"
                    >
                      {r.status === "OPEN" ? "Continue" : "View"}
                      <ArrowRightIcon size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {starting ? <StartCountDialog onClose={() => setStarting(false)} /> : null}
    </Page>
  );
}

function StartCountDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState(branchDefault);
  const [scope, setScope] = useState<"FULL" | "CATEGORY" | "LOCATION">("FULL");
  const [categoryId, setCategoryId] = useState("");
  const [location, setLocation] = useState("");
  const [pending, setPending] = useState(false);

  const branches = useQuery({
    queryKey: ["branches-options"],
    queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/branches?limit=100"),
  });
  const categories = useQuery({
    queryKey: ["categories-options"],
    queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/masters/categories?limit=100"),
    enabled: scope === "CATEGORY",
  });

  const branchRows = branches.data?.rows ?? [];
  // The cookie branch may not be one the user belongs to; fall back to the first listed.
  const effectiveBranch = branchRows.some((b) => b.id === branchId) ? branchId : branchRows[0]?.id ?? "";

  const scopeRef = scope === "CATEGORY" ? categoryId : scope === "LOCATION" ? location.trim() : "";
  const ready = Boolean(effectiveBranch) && (scope === "FULL" || scopeRef.length > 0);

  async function start() {
    if (!ready) return;
    setPending(true);
    try {
      const res = await api<{ id: string; expectedCount: number }>("/api/v1/counts", {
        method: "POST",
        body: JSON.stringify({
          branchId: effectiveBranch,
          scope,
          ...(scope === "FULL" ? {} : { scopeRef }),
        }),
      });
      toast.success(`Count started: ${res.expectedCount} piece${res.expectedCount === 1 ? "" : "s"} expected`);
      qc.invalidateQueries({ queryKey: ["counts"] });
      router.push(`/inventory/counts/${res.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the count");
      setPending(false);
    }
  }

  return (
    <Modal
      kicker="Inventory"
      title="Start stock count"
      onClose={onClose}
      onSubmit={start}
      pending={pending}
      submitDisabled={!ready}
      submitLabel="Start count"
    >
      <p className="text-sm text-ink-3">
        Every in-stock piece in the chosen scope is snapshotted as the expected list and locked from sale and
        transfer until the count is approved or cancelled.
      </p>
      <Field label="Branch" htmlFor="count-branch">
        <select
          id="count-branch"
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
      <Field label="Scope" htmlFor="count-scope">
        <select
          id="count-scope"
          value={scope}
          onChange={(e) => setScope(e.target.value as "FULL" | "CATEGORY" | "LOCATION")}
          className={`w-full ${controlClass}`}
        >
          <option value="FULL">Whole branch</option>
          <option value="CATEGORY">Category</option>
          <option value="LOCATION">Location</option>
        </select>
      </Field>
      {scope === "CATEGORY" ? (
        <Field label="Category" htmlFor="count-category">
          <select
            id="count-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={`w-full ${controlClass}`}
          >
            <option value="">{categories.isLoading ? "Loading…" : "Select category…"}</option>
            {(categories.data?.rows ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {scope === "LOCATION" ? (
        <Field label="Location" htmlFor="count-location" hint="Exactly as recorded on the pieces, e.g. Showcase A">
          <input
            id="count-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Showcase A"
            autoComplete="off"
            className={`w-full ${controlClass}`}
          />
        </Field>
      ) : null}
      {branches.isError ? (
        <Callout tone="danger" title="Could not load branches">
          {branches.error instanceof Error ? branches.error.message : "Please try again."}
        </Callout>
      ) : null}
    </Modal>
  );
}
