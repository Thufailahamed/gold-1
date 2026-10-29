"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { lkrSigned } from "@/lib/accounts";
import { Page, Modal, controlClass } from "@/components/ui";
import { Empty, FilterPills, GoldHero, HeroBadge, RowsSkeleton, count, grams, heroGhost, heroGold, inputCls } from "@/components/console-kit";
import {
  ArrowRightIcon,
  Building2Icon,
  ChevronRightIcon,
  CoinsIcon,
  LayoutGridIcon,
  PackageIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  StoreIcon,
} from "@/components/icons";

/** The slice of `/branch-overview/all` the cards show. */
type Snap = {
  branch: { id: string };
  jewellery: { pieces: number };
  gold: { fineMg: number };
  cash: { drawer: number };
  sales: { netCents: number; invoiceCount: number };
};
const TONES = ["#B8923F", "#059669", "#0284C7", "#7C3AED", "#E11D48", "#D97706"];

type Branch = { id: string; name: string; code: string; address: string | null; is_active: number };

const branchSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
  address: z.string().max(500).optional(),
});

export default function BranchesPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [show, setShow] = useState<"all" | "active" | "inactive">("all");
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCreate = hasPermission(me.data?.permissions ?? [], "branches:create");
  const canEdit = hasPermission(me.data?.permissions ?? [], "branches:edit");
  const canSettings = hasPermission(me.data?.permissions ?? [], "settings:manage");
  const canShop = hasPermission(me.data?.permissions ?? [], "branches:manage");

  const list = useQuery({
    queryKey: ["branches", search, page],
    queryFn: () =>
      api<{ rows: Branch[]; total: number }>(
        `/api/v1/branches?search=${encodeURIComponent(search)}&page=${page}&limit=20`
      ),
  });
  const { register, handleSubmit, reset } = useForm<z.infer<typeof branchSchema>>({
    resolver: zodResolver(branchSchema),
  });
  const create = useMutation({
    mutationFn: (v: z.infer<typeof branchSchema>) =>
      api("/api/v1/branches", { method: "POST", body: JSON.stringify(v) }),
    onSuccess: () => {
      toast.success("Branch created");
      setDialog(false);
      reset();
      qc.invalidateQueries({ queryKey: ["branches"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  async function toggleActive(b: Branch) {
    const reason = window.prompt(`Reason to ${b.is_active ? "deactivate" : "activate"} ${b.name} (required):`);
    if (!reason) return;
    try {
      await api(`/api/v1/branches/${b.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: b.is_active ? 0 : 1, reason }),
      });
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["branches"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  // Live figures per branch, when this account may see branches side by side.
  const now = new Date();
  const snaps = useQuery({
    queryKey: ["branch-overview-all", now.getMonth() + 1, now.getFullYear()],
    queryFn: () => api<{ asOf: number; branches: Snap[] }>(`/api/v1/branch-overview/all?month=${now.getMonth() + 1}&year=${now.getFullYear()}`),
    enabled: canShop,
  });
  const snapOf = (id: string) => snaps.data?.branches.find((b) => b.branch.id === id);
  const sum = (f: (s: Snap) => number) => (snaps.data?.branches ?? []).reduce((a, b) => a + f(b), 0);

  const allRows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const activeN = allRows.filter((r) => r.is_active).length;
  const rows = show === "all" ? allRows : allRows.filter((r) => (show === "active" ? !!r.is_active : !r.is_active));
  const pages = Math.max(1, Math.ceil(total / 20));
  const bestSales = Math.max(1, ...(snaps.data?.branches ?? []).map((b) => b.sales.netCents));

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={Building2Icon}
        title="Branches"
        badge={<HeroBadge tone="muted">Organisation</HeroBadge>}
        sub="Shops and vaults in the network · per-branch overrides sit under each branch's Settings"
        back={{ href: "/setup", label: "Setup" }}
        actions={
          <>
            <Link href="/branches/overview" className={heroGhost}>
              <LayoutGridIcon size={13} />
              Overview
            </Link>
            {canCreate ? (
              <button onClick={() => setDialog(true)} className={heroGold}>
                <PlusIcon size={13} />
                New branch
              </button>
            ) : null}
          </>
        }
        stats={[
          { label: "Branches", value: list.isLoading ? undefined : total, loading: list.isLoading, accent: true },
          { label: "Active", value: list.isLoading ? undefined : activeN, loading: list.isLoading, tone: "good", sub: allRows.length - activeN ? `${allRows.length - activeN} inactive` : "all open" },
          ...(canShop
            ? [
                { label: "Pieces in stock", value: snaps.data ? sum((b) => b.jewellery.pieces) : undefined, loading: snaps.isLoading, sub: "network total" },
                { label: "Fine gold held", value: snaps.data ? sum((b) => b.gold.fineMg) : undefined, format: (n: number) => grams(n), unit: "g", loading: snaps.isLoading },
                { label: "Net sales · MTD", value: snaps.data ? sum((b) => b.sales.netCents) / 100 : undefined, format: (n: number) => Math.round(n).toLocaleString("en-US"), unit: "LKR", loading: snaps.isLoading, sub: snaps.data ? `${count(sum((b) => b.sales.invoiceCount))} invoices` : undefined },
              ]
            : []),
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <SearchIcon size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-5" />
          <input
            placeholder="Search branches…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className={cn(inputCls, "w-full pl-8")}
          />
        </div>
        <FilterPills
          value={show}
          onChange={setShow}
          items={[
            { key: "all", label: "All", count: allRows.length },
            { key: "active", label: "Active", count: activeN, dot: "bg-emerald-500" },
            { key: "inactive", label: "Inactive", count: allRows.length - activeN, dot: "bg-ink/30" },
          ]}
        />
        {pages > 1 ? (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-ink-4">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page" className="flex size-7 items-center justify-center rounded-md ring-1 ring-inset ring-ink/20 hover:bg-paper disabled:opacity-40">
              <ChevronRightIcon size={13} className="rotate-180" />
            </button>
            <span className="g-metric px-1">
              {page} / {pages}
            </span>
            <button disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page" className="flex size-7 items-center justify-center rounded-md ring-1 ring-inset ring-ink/20 hover:bg-paper disabled:opacity-40">
              <ChevronRightIcon size={13} />
            </button>
          </span>
        ) : null}
      </div>

      {list.isLoading ? (
        <div className="rounded-2xl bg-paper">
          <RowsSkeleton rows={4} />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)]">
          <Empty icon={Building2Icon} title="No branches" desc={search ? `Nothing matches “${search}”.` : "Create the first branch to get started."} />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {rows.map((b, i) => {
            const tone = TONES[i % TONES.length]!;
            const sn = snapOf(b.id);
            return (
              <article
                key={b.id}
                className={cn(
                  "relative flex flex-col overflow-hidden rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2),0_18px_40px_-30px_rgba(16,32,27,0.3)]",
                  !b.is_active && "opacity-70"
                )}
              >
                <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${tone}, ${tone}00)` }} aria-hidden />
                <div className="flex items-start gap-3 px-4 pb-3 pt-4" style={{ backgroundImage: `radial-gradient(70% 120% at 0% 0%, ${tone}12, transparent 70%)` }}>
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]" style={{ background: `linear-gradient(145deg, ${tone}, ${tone}bb)` }}>
                    <StoreIcon size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-[14px] font-semibold text-ink">{b.name}</h3>
                      <span className="g-metric rounded bg-void px-1.5 py-px text-[10px] font-semibold text-gold-light">{b.code}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11.5px] text-ink-4">{b.address || "No address on file"}</p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset",
                      b.is_active ? "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25" : "bg-ink/[0.04] text-ink-5 ring-ink/20"
                    )}
                  >
                    <span className={cn("size-1.5 rounded-full", b.is_active ? "bg-emerald-500" : "bg-ink/30")} />
                    {b.is_active ? "Active" : "Inactive"}
                  </span>
                </div>

                {canShop ? (
                  <div className="grid grid-cols-4 gap-px border-y border-ink/20 bg-ink/[0.05]">
                    {[
                      { k: "Pieces", v: sn ? count(sn.jewellery.pieces) : null, icon: PackageIcon },
                      { k: "Gold", v: sn ? `${grams(sn.gold.fineMg)} g` : null, icon: CoinsIcon },
                      { k: "Drawer", v: sn ? lkrSigned(sn.cash.drawer).replace(/\.\d+$/, "") : null, icon: CoinsIcon },
                      { k: "Sales MTD", v: sn ? lkrSigned(sn.sales.netCents).replace(/\.\d+$/, "") : null, icon: StoreIcon },
                    ].map((m) => (
                      <div key={m.k} className="min-w-0 bg-paper px-3 py-2">
                        <div className="truncate text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-5">{m.k}</div>
                        {m.v == null ? (
                          snaps.isLoading ? <div className="mt-1 h-3.5 w-12 animate-pulse rounded bg-ink/[0.06]" /> : <div className="mt-0.5 text-[12px] text-ink-6">—</div>
                        ) : (
                          <div className="g-metric mt-0.5 truncate text-[12.5px] font-semibold text-ink">{m.v}</div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
                {canShop && sn ? (
                  <div className="px-4 pt-2">
                    <div className="flex justify-between text-[10px] text-ink-5">
                      <span>Share of network sales</span>
                      <span className="g-metric">{count(sn.sales.invoiceCount)} invoices</span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink/[0.06]">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(0, (sn.sales.netCents / bestSales) * 100)}%`, background: tone }} />
                    </div>
                  </div>
                ) : null}

                <div className="mt-auto flex items-center gap-1 px-3 py-2.5">
                  <Link
                    href={`/branches/overview?branch=${b.id}`}
                    className="group inline-flex items-center gap-1 rounded-md bg-void px-2.5 py-1 text-[11px] font-semibold text-gold-light transition-colors hover:bg-void/85"
                  >
                    Overview
                    <ArrowRightIcon size={11} className="transition-transform group-hover:translate-x-0.5" />
                  </Link>
                  {canSettings ? (
                    <button
                      onClick={() => setSettingsId(b.id)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-ink-3 ring-1 ring-inset ring-ink/20 transition-colors hover:bg-bone hover:text-ink"
                    >
                      <SettingsIcon size={11} />
                      Settings
                    </button>
                  ) : null}
                  {canEdit ? (
                    <button
                      onClick={() => toggleActive(b)}
                      className={cn(
                        "ml-auto rounded-md px-2 py-1 text-[11px] font-semibold transition-colors",
                        b.is_active ? "text-rose-700 hover:bg-rose-500/10" : "text-emerald-700 hover:bg-emerald-500/10"
                      )}
                    >
                      {b.is_active ? "Deactivate" : "Activate"}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {dialog ? (
        <Modal title="New branch" kicker="Organisation" onClose={() => setDialog(false)} footer={false}>
          <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">Name</label>
              <input className={controlClass} {...register("name")} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">Code</label>
              <input className={controlClass} {...register("code")} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">Address</label>
              <input className={controlClass} {...register("address")} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDialog(false)}
                className="g-btn g-btn-secondary h-10 px-4 text-sm"
              >
                Cancel
              </button>
              <button type="submit" className="g-btn g-btn-primary h-10 px-4 text-sm">
                Save
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
      {settingsId ? <BranchSettings id={settingsId} onClose={() => setSettingsId(null)} /> : null}
    </Page>
  );
}

function BranchSettings({ id, onClose }: { id: string; onClose: () => void }) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const fullKey = key ? `branch.${id}.${key}` : "";

  async function save() {
    if (!key) return;
    try {
      await api(`/api/v1/settings/${encodeURIComponent(fullKey)}`, {
        method: "PUT",
        body: JSON.stringify({ value, type: "string" }),
      });
      toast.success("Setting saved");
      setSaved((s) => [...s, fullKey]);
      setKey("");
      setValue("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <Modal title="Overrides" kicker="Branch settings" onClose={onClose} footer={false}>
      <div className="space-y-4">
        <p className="text-xs text-ink-4">
          Keys are stored as <span className="font-mono">branch.{id.slice(0, 8)}…</span>
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            placeholder="key (e.g. receipt_footer)"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className={cn(controlClass, "flex-1")}
          />
          <input
            placeholder="value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={cn(controlClass, "flex-1")}
          />
          <button onClick={save} className="g-btn g-btn-primary h-10 px-4 text-sm">
            Save
          </button>
        </div>
        {saved.length > 0 ? (
          <ul className="space-y-1 text-sm text-ink-3">
            {saved.map((k) => (
              <li key={k} className="font-mono text-xs">
                {k} ✓
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Modal>
  );
}
