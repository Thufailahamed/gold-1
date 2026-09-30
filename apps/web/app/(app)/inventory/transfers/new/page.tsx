"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { hasPermission, mgToG } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { normalizeCode } from "@/lib/barcode";
import { CameraScanButton } from "@/components/camera-scan";
import {
  Page,
  Hero,
  Panel,
  TableCard,
  EmptyBlock,
  Callout,
  Field,
  Pill,
  Skeleton,
  controlClass,
} from "@/components/ui";
import { ArrowLeftRightIcon, ScanBarcodeIcon, TrashIcon, TruckIcon } from "@/components/icons";

type Branch = { id: string; name: string; code: string; member: boolean };

type Lookup = {
  product: {
    id: string;
    barcode: string;
    sku: string | null;
    name: string;
    karat: string;
    net_mg: number;
    status: string;
    branch_id: string;
  };
};

type Line = { productId: string; barcode: string; name: string; karat: string; netMg: number };

const MAX_LINES = 100;

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return (
    document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? ""
  );
}

const grams = (mg: number) => mgToG(mg).toLocaleString("en-US", { maximumFractionDigits: 3 });

export default function NewTransferPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const scanRef = useRef<HTMLInputElement>(null);
  const [scan, setScan] = useState("");
  const [fromBranchId, setFromBranchId] = useState("");
  const [toBranchId, setToBranchId] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([]);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCreate = hasPermission(me.data?.permissions ?? [], "products:edit");

  const branches = useQuery({
    queryKey: ["transfer-branches"],
    queryFn: () => api<Branch[]>("/api/v1/transfers/branches"),
  });
  const memberBranches = (branches.data ?? []).filter((b) => b.member);
  const toChoices = (branches.data ?? []).filter((b) => b.id !== fromBranchId);

  // Default the sending branch to the active branch cookie, else the first
  // branch the user belongs to.
  useEffect(() => {
    if (fromBranchId || memberBranches.length === 0) return;
    const cookie = branchDefault();
    const pick = memberBranches.find((b) => b.id === cookie) ?? memberBranches[0];
    if (pick) setFromBranchId(pick.id);
  }, [fromBranchId, memberBranches]);

  function refocus() {
    setScan("");
    scanRef.current?.focus();
  }

  function changeFrom(id: string) {
    if (id === fromBranchId) return;
    if (lines.length > 0) toast.info("Scanned list cleared — pieces must belong to the sending branch");
    setLines([]);
    setFromBranchId(id);
    if (toBranchId === id) setToBranchId("");
    scanRef.current?.focus();
  }

  const lookup = useMutation({
    mutationFn: (code: string) => api<Lookup>(`/api/v1/products/barcode/${encodeURIComponent(code)}`),
    onSuccess: (d) => {
      const p = d.product;
      const reject = (msg: string) => {
        toast.error(msg);
        refocus();
      };
      if (!fromBranchId) return reject("Choose the sending branch first");
      if (lines.some((l) => l.productId === p.id)) return reject(`${p.barcode} is already on the list`);
      if (p.status !== "IN_STOCK")
        return reject(`${p.barcode} is ${p.status.replace(/_/g, " ").toLowerCase()}, not in stock`);
      if (p.branch_id !== fromBranchId) return reject(`${p.barcode} is not at the sending branch`);
      if (lines.length >= MAX_LINES) return reject(`A transfer holds at most ${MAX_LINES} pieces`);
      setLines((ls) => [
        ...ls,
        { productId: p.id, barcode: p.barcode, name: p.name, karat: p.karat, netMg: p.net_mg },
      ]);
      toast.success(`Added ${p.barcode}`);
      refocus();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Lookup failed");
      refocus();
    },
  });

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string; number: string }>("/api/v1/transfers", {
        method: "POST",
        body: JSON.stringify({
          fromBranchId,
          toBranchId,
          productIds: lines.map((l) => l.productId),
          reason: reason.trim() || undefined,
        }),
      }),
    onSuccess: (d) => {
      toast.success(`Transfer ${d.number} requested`);
      qc.invalidateQueries({ queryKey: ["transfers"] });
      router.push(`/inventory/transfers/${d.id}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Request failed"),
  });

  function submitScan(raw: string) {
    const code = normalizeCode(raw);
    if (!code) return refocus();
    if (lines.some((l) => l.barcode === code)) {
      toast.error(`${code} is already on the list`);
      return refocus();
    }
    lookup.mutate(code);
  }

  const totalMg = lines.reduce((n, l) => n + l.netMg, 0);
  const fromName = memberBranches.find((b) => b.id === fromBranchId)?.name;
  const toName = toChoices.find((b) => b.id === toBranchId)?.name;
  const canSubmit =
    canCreate && !!fromBranchId && !!toBranchId && fromBranchId !== toBranchId && lines.length > 0 && !create.isPending;

  return (
    <Page>
      <Hero
        back={{ href: "/inventory/transfers", label: "Branch transfers" }}
        kicker="Inventory"
        title="New transfer"
        description="Choose the route, then scan each piece to send. Enter adds a piece; the scanner keeps focus."
        meta={
          <>
            <Pill tone="ghost" className="!text-paper">
              {fromName ?? "Sending branch"} → {toName ?? "Receiving branch"}
            </Pill>
            <Pill tone="ghost" className="!text-paper">
              {lines.length} piece{lines.length === 1 ? "" : "s"}
            </Pill>
          </>
        }
        stats={[
          { label: "Pieces", value: lines.length },
          { label: "Net weight", value: `${grams(totalMg)} g` },
        ]}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitScan(scan);
          }}
          className="relative mt-6 flex gap-2"
        >
          <div className="relative flex-1">
            <ScanBarcodeIcon
              size={18}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold"
            />
            <label htmlFor="transfer-scan" className="sr-only">
              Scan piece barcode
            </label>
            <input
              id="transfer-scan"
              ref={scanRef}
              autoFocus
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              placeholder={fromBranchId ? "Scan barcode…" : "Choose the sending branch first"}
              autoComplete="off"
              disabled={!canCreate}
              className="h-13 w-full rounded-xl bg-paper/10 py-3.5 pl-11 pr-4 font-mono text-lg text-paper placeholder:text-paper/35 shadow-[inset_0_0_0_1px_rgba(201,162,39,0.45)] transition-shadow focus:outline-none focus:shadow-[inset_0_0_0_2px_#C9A227,0_0_0_4px_rgba(201,162,39,0.2)] disabled:opacity-50"
            />
          </div>
          <CameraScanButton onDetected={(c) => submitScan(c)} tone="dark" className="h-auto rounded-xl" />
          <button
            type="submit"
            disabled={lookup.isPending || !canCreate}
            className="g-btn h-auto rounded-xl bg-gold px-5 text-sm font-medium text-ink transition-colors hover:bg-gold-light disabled:opacity-50"
          >
            {lookup.isPending ? "Looking up…" : "Add"}
          </button>
        </form>
      </Hero>

      {me.data && !canCreate ? (
        <Callout tone="warning" title="You cannot request transfers">
          Requesting a transfer needs the products:edit permission.
        </Callout>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Route" icon={<ArrowLeftRightIcon size={17} />} description="Where the pieces leave from and go to">
          {branches.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : branches.isError ? (
            <Callout tone="danger" title="Could not load branches">
              {branches.error instanceof Error ? branches.error.message : "Retry in a moment."}
            </Callout>
          ) : (
            <div className="space-y-4">
              <Field
                label="From (sending branch)"
                htmlFor="transfer-from"
                hint={memberBranches.length === 0 ? "You are not a member of any branch." : "Changing this clears the scanned list."}
              >
                <select
                  id="transfer-from"
                  value={fromBranchId}
                  onChange={(e) => changeFrom(e.target.value)}
                  className={`w-full ${controlClass}`}
                >
                  <option value="">Select branch…</option>
                  {memberBranches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="To (receiving branch)"
                htmlFor="transfer-to"
                error={toBranchId && toBranchId === fromBranchId ? "Choose a different branch" : undefined}
              >
                <select
                  id="transfer-to"
                  value={toBranchId}
                  onChange={(e) => setToBranchId(e.target.value)}
                  className={`w-full ${controlClass}`}
                >
                  <option value="">Select branch…</option>
                  {toChoices.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Reason (optional)" htmlFor="transfer-reason">
                <textarea
                  id="transfer-reason"
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. Restock for weekend exhibition"
                  className={`w-full !h-auto py-2 ${controlClass}`}
                />
              </Field>
            </div>
          )}
        </Panel>

        <div className="lg:col-span-2">
          <TableCard
            title="Pieces to send"
            icon={<TruckIcon size={17} />}
            description={`${lines.length} piece${lines.length === 1 ? "" : "s"} · ${grams(totalMg)} g net`}
            actions={
              lines.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setLines([]);
                    scanRef.current?.focus();
                  }}
                  className="g-btn g-btn-secondary h-8 px-3 text-xs"
                >
                  Clear list
                </button>
              ) : null
            }
            footer={
              <>
                <span className="num-tabular">
                  {lines.length} piece{lines.length === 1 ? "" : "s"} · {grams(totalMg)} g net
                </span>
                <button
                  type="button"
                  onClick={() => create.mutate()}
                  disabled={!canSubmit}
                  className="g-btn g-btn-primary h-10 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {create.isPending ? "Requesting…" : "Request transfer"}
                </button>
              </>
            }
          >
            {lines.length === 0 ? (
              <EmptyBlock
                icon={<ScanBarcodeIcon size={22} />}
                title="No pieces yet"
                description="Scan pieces that are in stock at the sending branch."
              />
            ) : (
              <table className="g-table">
                <thead>
                  <tr>
                    <th>Barcode</th>
                    <th>Item</th>
                    <th>Karat</th>
                    <th className="!text-right">Net g</th>
                    <th>
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.productId}>
                      <td className="g-metric text-xs">{l.barcode}</td>
                      <td className="font-medium text-ink">{l.name}</td>
                      <td className="text-ink-3">{l.karat}</td>
                      <td className="!text-right num-tabular">{grams(l.netMg)}</td>
                      <td className="!text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setLines((ls) => ls.filter((x) => x.productId !== l.productId));
                            scanRef.current?.focus();
                          }}
                          aria-label={`Remove ${l.barcode}`}
                          className="inline-flex size-7 items-center justify-center rounded-md text-rose-600 transition-colors hover:bg-rose-50"
                        >
                          <TrashIcon size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TableCard>
        </div>
      </div>
    </Page>
  );
}
