"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { hasPermission, mgToG } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { normalizeCode } from "@/lib/barcode";
import { CameraScanButton } from "@/components/camera-scan";
import { Page, Callout, Field, Skeleton, controlClass } from "@/components/ui";
import { ArrowLeftRightIcon, CheckCircleIcon, CheckIcon, ScanBarcodeIcon, TrashIcon, TruckIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { Card, CardHead, Empty, GoldHero, HeroBadge, heroGold, th, thead, tr } from "../../kit";

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
  const karats = new Set(lines.map((l) => l.karat)).size;
  const avg = lines.length ? totalMg / lines.length : 0;
  const ready = [
    { ok: !!fromBranchId, label: "Sending branch" },
    { ok: !!toBranchId && toBranchId !== fromBranchId, label: "Receiving branch" },
    { ok: lines.length > 0, label: "At least one piece" },
  ];

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={TruckIcon}
        title="New"
        accent="transfer"
        back={{ href: "/inventory/transfers", label: "Branch transfers" }}
        badge={
          <HeroBadge tone={canSubmit ? "good" : "muted"}>
            {fromName ?? "From"} → {toName ?? "To"}
          </HeroBadge>
        }
        sub="Choose the route, then scan each piece to send. Enter adds a piece and the scanner keeps focus."
        actions={
          <button type="button" onClick={() => create.mutate()} disabled={!canSubmit} className={cn(heroGold, "disabled:cursor-not-allowed disabled:opacity-50")}>
            <TruckIcon size={13} /> {create.isPending ? "Requesting…" : "Request transfer"}
          </button>
        }
        stats={[
          { label: "Pieces", value: lines.length, sub: `Up to ${MAX_LINES}` },
          { label: "Net weight", value: totalMg, format: grams, unit: "g", accent: true, sub: "Leaving the branch" },
          { label: "Average piece", value: avg, format: grams, unit: "g", sub: "Net weight" },
          { label: "Purities", value: karats, sub: karats ? [...new Set(lines.map((l) => l.karat))].join(" · ") : "None yet" },
        ]}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitScan(scan);
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <ScanBarcodeIcon size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gold" />
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
              className="h-10 w-full rounded-xl bg-paper/10 pl-10 pr-4 font-mono text-[15px] text-paper placeholder:font-sans placeholder:text-[13px] placeholder:text-paper/35 shadow-[inset_0_0_0_1px_rgba(205,168,83,0.45)] transition-shadow focus:outline-none focus:shadow-[inset_0_0_0_2px_#CDA853,0_0_0_4px_rgba(205,168,83,0.2)] disabled:opacity-50"
            />
          </div>
          <CameraScanButton onDetected={(c) => submitScan(c)} tone="dark" className="h-10 rounded-xl" />
          <button
            type="submit"
            disabled={lookup.isPending || !canCreate}
            className="g-btn h-10 rounded-xl bg-gold px-4 text-[13px] font-medium text-ink transition-colors hover:bg-gold-light disabled:opacity-50"
          >
            {lookup.isPending ? "Looking up…" : "Add"}
          </button>
        </form>
      </GoldHero>

      {me.data && !canCreate ? (
        <Callout tone="warning" title="You cannot request transfers">
          Requesting a transfer needs the products:edit permission.
        </Callout>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHead icon={ArrowLeftRightIcon} title="Route" sub="Where the pieces leave from and go to" />
            <div className="p-4">
              {branches.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                </div>
              ) : branches.isError ? (
                <Callout tone="danger" title="Could not load branches">
                  {branches.error instanceof Error ? branches.error.message : "Retry in a moment."}
                </Callout>
              ) : (
                <div className="space-y-3">
                  <Field
                    label="From (sending branch)"
                    htmlFor="transfer-from"
                    hint={memberBranches.length === 0 ? "You are not a member of any branch." : "Changing this clears the scanned list."}
                  >
                    <select id="transfer-from" value={fromBranchId} onChange={(e) => changeFrom(e.target.value)} className={`w-full ${controlClass}`}>
                      <option value="">Select branch…</option>
                      {memberBranches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.code})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="To (receiving branch)" htmlFor="transfer-to" error={toBranchId && toBranchId === fromBranchId ? "Choose a different branch" : undefined}>
                    <select id="transfer-to" value={toBranchId} onChange={(e) => setToBranchId(e.target.value)} className={`w-full ${controlClass}`}>
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
                      rows={2}
                      placeholder="e.g. Restock for weekend exhibition"
                      className={`w-full !h-auto py-2 ${controlClass}`}
                    />
                  </Field>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHead icon={CheckCircleIcon} title="Ready to request" sub={canSubmit ? "Everything is in place" : "Complete the checklist"} />
            <ul className="divide-y divide-ink/[0.05]">
              {ready.map((r) => (
                <li key={r.label} className="flex items-center gap-2 px-4 py-1.5 text-[12px]">
                  <span className={cn("flex size-4 items-center justify-center rounded-full", r.ok ? "bg-emerald-500 text-paper" : "bg-ink/[0.07] text-ink-5")}>
                    {r.ok ? <CheckIcon size={10} /> : null}
                  </span>
                  <span className={r.ok ? "text-ink" : "text-ink-4"}>{r.label}</span>
                </li>
              ))}
            </ul>
            <p className="border-t border-ink/[0.06] bg-bone/40 px-4 py-2 text-[11px] leading-snug text-ink-4">
              Pieces stay on the sending branch&rsquo;s shelf until the transfer is dispatched.
            </p>
          </Card>
        </div>

        <Card>
          <CardHead
            icon={TruckIcon}
            title="Pieces to send"
            sub={`${lines.length} piece${lines.length === 1 ? "" : "s"} · ${grams(totalMg)} g net`}
            action={
              lines.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setLines([]);
                    scanRef.current?.focus();
                  }}
                  className="inline-flex h-7 items-center rounded-lg px-2.5 text-[11.5px] font-medium text-ink-3 ring-1 ring-inset ring-ink/10 hover:bg-bone hover:text-ink"
                >
                  Clear list
                </button>
              ) : null
            }
          />
          {lines.length === 0 ? (
            <Empty icon={ScanBarcodeIcon} title="No pieces yet" desc="Scan pieces that are in stock at the sending branch." />
          ) : (
            <div className="max-h-[32rem] overflow-auto scrollbar-thin">
              <table className="w-full text-[12.5px]">
                <thead className={cn(thead, "sticky top-0 z-10 backdrop-blur")}>
                  <tr>
                    <th className={cn(th, "w-8 pl-4")}>#</th>
                    <th className={th}>Barcode</th>
                    <th className={th}>Item</th>
                    <th className={th}>Karat</th>
                    <th className={cn(th, "text-right")}>Net g</th>
                    <th className={cn(th, "w-10 pr-4")}>
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.productId} className={tr}>
                      <td className="g-metric py-1.5 pl-4 pr-2 text-[11px] text-ink-5">{i + 1}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px] text-ink-2">{l.barcode}</td>
                      <td className="px-2 py-1.5 font-medium text-ink">{l.name}</td>
                      <td className="px-2 py-1.5">
                        <span className="g-metric rounded bg-gold-pale px-1.5 py-px text-[10.5px] font-semibold text-gold-deep ring-1 ring-gold-dark/15">{l.karat}</span>
                      </td>
                      <td className="g-metric px-2 py-1.5 text-right">{grams(l.netMg)}</td>
                      <td className="py-1 pl-2 pr-4 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setLines((ls) => ls.filter((x) => x.productId !== l.productId));
                            scanRef.current?.focus();
                          }}
                          aria-label={`Remove ${l.barcode}`}
                          className="inline-flex size-6 items-center justify-center rounded-md text-rose-600 transition-colors hover:bg-rose-50"
                        >
                          <TrashIcon size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 bg-bone/90 backdrop-blur">
                  <tr className="border-t border-ink/10 text-[12px] font-semibold">
                    <td colSpan={4} className="py-1.5 pl-4 text-[9.5px] uppercase tracking-[0.14em] text-gold-dark">
                      Total · {lines.length} pieces
                    </td>
                    <td className="g-metric px-2 py-1.5 text-right text-gold-deep">{grams(totalMg)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-ink/[0.06] bg-bone/40 px-4 py-2">
            <span className="g-metric text-[11.5px] text-ink-4">
              {lines.length} piece{lines.length === 1 ? "" : "s"} · {grams(totalMg)} g net
            </span>
            <button
              type="button"
              onClick={() => create.mutate()}
              disabled={!canSubmit}
              className="g-btn g-btn-primary h-8 rounded-lg px-3.5 text-[12.5px] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {create.isPending ? "Requesting…" : "Request transfer"}
            </button>
          </div>
        </Card>
      </div>
    </Page>
  );
}
