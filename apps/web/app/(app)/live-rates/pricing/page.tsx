"use client";

// Pricing desk: what the board should read given today's market and the
// shop's margin policy, and what a 24K bar costs landed in Sri Lanka.
// Publishing uses the normal gold-rate route, so approvals still apply.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PERMISSIONS } from "@goldos/shared";
import { api, errorCode } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Card, CardHead, GoldHero, HeroBadge, RowsSkeleton } from "@/components/console-kit";
import { CheckIcon, CoinsIcon, EditIcon, LayersIcon, SettingsIcon } from "@/components/icons";
import { karatTone } from "../parts";
import { DeskTabs, Field, NumInput, btnDark, btnSoft, fieldCls, lkr, num, signed, toneOf, useMe, when } from "../desk-kit";

type Policy = {
  defaultMarginPct: number;
  roundTo: number;
  roundMode: "nearest" | "up" | "down";
  driftAlertPct: number;
  orderPermille: number;
  perKarat: Record<string, { marginPct?: number; roundTo?: number }>;
};
type Suggest = {
  policy: Policy;
  usdLkr: number;
  stale: boolean;
  fetchedAt: number;
  rows: {
    purityId: string;
    karat: string;
    purity: number;
    marketPerG: number;
    marginPct: number;
    roundTo: number;
    suggestedPerG: number;
    suggestedPerPawn: number;
    boardPerG: number | null;
    boardEffectiveFrom: number | null;
    boardVsSuggestedPct: number | null;
    marketAtPublish: number | null;
    driftPct: number | null;
    stale: boolean;
  }[];
};
type Costs = { premiumUsdPerOz: number; bankFeePct: number; dutyPct: number; ssclPct: number; vatPct: number; otherLkrPerG: number };
type Parity = {
  costs: Costs;
  usdLkr: number;
  spotUsd: number;
  steps: { k: string; v: number }[];
  landedPerG: number;
  landedPerPawn: number;
  landedUsdPerOz: number;
  markupOverSpotPct: number | null;
  karats: { purityId: string; karat: string; purity: number; landedPerG: number; boardPerG: number | null; boardMarginPct: number | null }[];
};

const TROY = 31.1034768;

function roundRate(v: number, step: number, mode: Policy["roundMode"]) {
  if (!(step > 0)) return Math.round(v * 100) / 100;
  const q = v / step;
  return (mode === "up" ? Math.ceil(q - 1e-9) : mode === "down" ? Math.floor(q + 1e-9) : Math.round(q)) * step;
}

/** Same customs order as the server: duty & SSCL on CIF, VAT on CIF + levies. */
function landedSteps(spotUsd: number, fx: number, c: Costs) {
  const spot = (spotUsd * fx) / TROY;
  const premium = (c.premiumUsdPerOz * fx) / TROY;
  const bank = ((spot + premium) * c.bankFeePct) / 100;
  const cif = spot + premium + bank;
  const duty = (cif * c.dutyPct) / 100;
  const sscl = (cif * c.ssclPct) / 100;
  const vat = ((cif + duty + sscl) * c.vatPct) / 100;
  const steps = [
    { k: "Spot", v: spot, tone: "#CDA853" },
    { k: "Premium", v: premium, tone: "#A88A3E" },
    { k: "Freight, insurance & bank", v: bank, tone: "#0EA5E9" },
    { k: "Import duty", v: duty, tone: "#F43F5E" },
    { k: "SSCL", v: sscl, tone: "#F97316" },
    { k: "VAT", v: vat, tone: "#8B5CF6" },
    { k: "Other costs", v: c.otherLkrPerG, tone: "#64748B" },
  ];
  return { steps, spot, landed: steps.reduce((s, x) => s + x.v, 0) };
}

const COST_FIELDS: { key: keyof Costs; label: string; suffix: string; hint: string }[] = [
  { key: "premiumUsdPerOz", label: "Premium over spot", suffix: "$/oz", hint: "Dealer or bank bar premium" },
  { key: "bankFeePct", label: "Freight, insurance & bank", suffix: "%", hint: "Of the bar's value" },
  { key: "dutyPct", label: "Import duty", suffix: "%", hint: "On the landed (CIF) value" },
  { key: "ssclPct", label: "SSCL", suffix: "%", hint: "Social security levy" },
  { key: "vatPct", label: "VAT", suffix: "%", hint: "On CIF + duty + SSCL" },
  { key: "otherLkrPerG", label: "Other costs", suffix: "Rs/g", hint: "Assay, clearing, transport" },
];

export default function PricingPage() {
  const qc = useQueryClient();
  const { can } = useMe();
  const canEdit = can(PERMISSIONS.MASTERS_EDIT);
  const canPublish = can(PERMISSIONS.MASTERS_CREATE);

  const sug = useQuery({ queryKey: ["desk-suggest"], queryFn: () => api<Suggest>("/api/v1/market-desk/suggest"), refetchInterval: 60_000 });
  const par = useQuery({ queryKey: ["desk-parity"], queryFn: () => api<Parity>("/api/v1/market-desk/import-parity"), refetchInterval: 60_000 });

  /* ---------------- policy draft (edits preview live before saving) */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<Policy["roundMode"]>("nearest");
  const [perK, setPerK] = useState<Record<string, string>>({});
  const loadDraft = (p: Policy) => {
    setDraft({ defaultMarginPct: String(p.defaultMarginPct), roundTo: String(p.roundTo), driftAlertPct: String(p.driftAlertPct), orderPermille: String(p.orderPermille) });
    setMode(p.roundMode);
    setPerK(Object.fromEntries(Object.entries(p.perKarat).map(([k, v]) => [k, v.marginPct == null ? "" : String(v.marginPct)])));
  };
  useEffect(() => {
    if (sug.data && !editing) loadDraft(sug.data.policy);
  }, [sug.data, editing]);

  const policy: Policy | null = sug.data
    ? editing
      ? {
          defaultMarginPct: num(draft.defaultMarginPct ?? "0"),
          roundTo: num(draft.roundTo ?? "0"),
          roundMode: mode,
          driftAlertPct: num(draft.driftAlertPct ?? "1") || 1,
          orderPermille: Math.round(num(draft.orderPermille ?? "916")) || 916,
          perKarat: Object.fromEntries(Object.entries(perK).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, { marginPct: num(v) }])),
        }
      : sug.data.policy
    : null;

  const rows = useMemo(() => {
    if (!sug.data || !policy) return [];
    return sug.data.rows.map((r) => {
      const margin = policy.perKarat[r.purityId]?.marginPct ?? policy.defaultMarginPct;
      const step = policy.perKarat[r.purityId]?.roundTo ?? policy.roundTo;
      const suggested = roundRate(r.marketPerG * (1 + margin / 100), step, policy.roundMode);
      const vs = r.boardPerG != null && suggested ? ((r.boardPerG - suggested) / suggested) * 100 : null;
      return { ...r, marginPct: margin, suggestedPerG: suggested, suggestedPerPawn: suggested * 8, boardVsSuggestedPct: vs, stale: r.driftPct != null && Math.abs(r.driftPct) >= policy.driftAlertPct };
    });
  }, [sug.data, policy]);

  const savePolicy = useMutation({
    mutationFn: (p: Policy) => api("/api/v1/market-desk/policy", { method: "PUT", body: JSON.stringify(p) }),
    onSuccess: () => {
      toast.success("Pricing policy saved");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["desk-suggest"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  /* ---------------- publish */
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const chosen = rows.filter((r) => pick[r.purityId]);
  const publish = useMutation({
    mutationFn: async () => {
      const at = Date.now();
      let done = 0;
      let pending = 0;
      const failed: string[] = [];
      for (const r of chosen) {
        const rate = overrides[r.purityId] ? num(overrides[r.purityId]!) : r.suggestedPerG;
        if (!(rate > 0)) {
          failed.push(`${r.karat}: invalid rate`);
          continue;
        }
        try {
          await api("/api/v1/gold-rates", { method: "POST", body: JSON.stringify({ purityId: r.purityId, ratePerGram: rate, effectiveFrom: at }) });
          done++;
        } catch (e) {
          if (errorCode(e) === "PENDING") pending++;
          else failed.push(`${r.karat}: ${e instanceof Error ? e.message : "failed"}`);
        }
      }
      return { done, pending, failed };
    },
    onSuccess: ({ done, pending, failed }) => {
      if (done) toast.success(`${done} rate${done > 1 ? "s" : ""} published`);
      if (pending) toast.message(`${pending} rate${pending > 1 ? "s" : ""} sent for approval`, { description: "They go live once an approver accepts them." });
      for (const f of failed) toast.error(f);
      setPick({});
      setOverrides({});
      for (const k of ["desk-suggest", "desk-parity", "market-live", "gold-rates-current", "gold-rates-history"]) qc.invalidateQueries({ queryKey: [k] });
    },
  });

  /* ---------------- import costs draft */
  const [costEdit, setCostEdit] = useState(false);
  const [costDraft, setCostDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    if (par.data && !costEdit) setCostDraft(Object.fromEntries(Object.entries(par.data.costs).map(([k, v]) => [k, String(v)])));
  }, [par.data, costEdit]);
  const costs: Costs | null = par.data
    ? costEdit
      ? (Object.fromEntries(COST_FIELDS.map((f) => [f.key, num(costDraft[f.key] ?? "0")])) as Costs)
      : par.data.costs
    : null;
  const land = par.data && costs ? landedSteps(par.data.spotUsd, par.data.usdLkr, costs) : null;
  const saveCosts = useMutation({
    mutationFn: (c: Costs) => api("/api/v1/market-desk/import-costs", { method: "PUT", body: JSON.stringify(c) }),
    onSuccess: () => {
      toast.success("Import costs saved");
      setCostEdit(false);
      qc.invalidateQueries({ queryKey: ["desk-parity"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const staleCount = rows.filter((r) => r.stale).length;
  const k22 = rows.find((r) => r.karat === "22K") ?? rows[0];
  const loading = sug.isLoading;

  return (
    <div className="space-y-3">
      <GoldHero
        icon={CoinsIcon}
        title="Pricing"
        accent="desk"
        back={{ href: "/live-rates", label: "Live rates" }}
        badge={
          loading ? null : staleCount ? (
            <HeroBadge tone="warn">{staleCount} rate{staleCount > 1 ? "s" : ""} behind the market</HeroBadge>
          ) : (
            <HeroBadge tone="good">Board in line</HeroBadge>
          )
        }
        sub={sug.data ? `Market from spot at USD/LKR ${sug.data.usdLkr.toFixed(2)} · updated ${when(sug.data.fetchedAt)}` : "Suggested board rates from the live market"}
        stats={[
          { label: `${k22?.karat ?? "22K"} market / g`, value: k22?.marketPerG, format: (n) => lkr(n), loading },
          { label: `${k22?.karat ?? "22K"} suggested / g`, value: k22?.suggestedPerG, format: (n) => lkr(n), accent: true, loading },
          { label: `${k22?.karat ?? "22K"} board / g`, value: k22?.boardPerG ?? null, format: (n) => lkr(n), loading, sub: k22?.boardEffectiveFrom ? `since ${when(k22.boardEffectiveFrom)}` : "not set" },
          {
            label: "Moved since publish",
            value: k22?.driftPct ?? null,
            format: (n) => signed(n),
            tone: k22?.stale ? "warn" : "good",
            loading,
          },
          { label: "24K landed / g", value: land?.landed ?? null, format: (n) => lkr(n), loading: par.isLoading, sub: "import parity" },
          { label: "Landed over spot", value: land ? ((land.landed - land.spot) / land.spot) * 100 : null, format: (n) => signed(n), loading: par.isLoading },
        ]}
      >
        <DeskTabs />
      </GoldHero>

      {/* ============================================ suggested board */}
      <Card>
        <CardHead
          icon={LayersIcon}
          title="Suggested board rates"
          sub={policy ? `Market × (1 + margin), rounded ${policy.roundMode} to Rs ${lkr(policy.roundTo, 0)} · flag after ${policy.driftAlertPct}% move` : "Loading"}
          action={
            <>
              {canEdit ? (
                editing ? (
                  <>
                    <button className={btnSoft} onClick={() => setEditing(false)}>
                      Cancel
                    </button>
                    <button className={btnDark} disabled={!policy || savePolicy.isPending} onClick={() => policy && savePolicy.mutate(policy)}>
                      <CheckIcon size={12} /> {savePolicy.isPending ? "Saving…" : "Save policy"}
                    </button>
                  </>
                ) : (
                  <button className={btnSoft} onClick={() => setEditing(true)} disabled={!sug.data}>
                    <EditIcon size={12} /> Edit margins
                  </button>
                )
              ) : null}
              {canPublish && !editing ? (
                <button className={btnDark} disabled={!chosen.length || publish.isPending} onClick={() => publish.mutate()}>
                  {publish.isPending ? "Publishing…" : `Publish ${chosen.length || ""} selected`}
                </button>
              ) : null}
            </>
          }
        />
        {editing ? (
          <div className="grid gap-3 border-b border-ink/[0.06] bg-gold-pale/30 px-4 py-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Default margin" hint="Over market, all karats">
              <NumInput value={draft.defaultMarginPct ?? ""} onChange={(v) => setDraft({ ...draft, defaultMarginPct: v })} suffix="%" />
            </Field>
            <Field label="Round to" hint="Rupees per gram">
              <NumInput value={draft.roundTo ?? ""} onChange={(v) => setDraft({ ...draft, roundTo: v })} suffix="Rs" />
            </Field>
            <Field label="Rounding">
              <select value={mode} onChange={(e) => setMode(e.target.value as Policy["roundMode"])} className={fieldCls}>
                <option value="nearest">Nearest</option>
                <option value="up">Always up</option>
                <option value="down">Always down</option>
              </select>
            </Field>
            <Field label="Flag board after" hint="Market move since publish">
              <NumInput value={draft.driftAlertPct ?? ""} onChange={(v) => setDraft({ ...draft, driftAlertPct: v })} suffix="%" />
            </Field>
            <Field label="Custom-order purity" hint="Used by Exposure (‰)">
              <NumInput value={draft.orderPermille ?? ""} onChange={(v) => setDraft({ ...draft, orderPermille: v })} suffix="‰" />
            </Field>
          </div>
        ) : null}
        {loading ? (
          <RowsSkeleton rows={4} />
        ) : sug.isError ? (
          <p className="px-4 py-6 text-center text-[12.5px] text-rose-700">Market data is unavailable right now.</p>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-[12px]">
              <thead className="bg-bone/60 text-left">
                <tr className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">
                  {canPublish && !editing ? <th className="w-8 py-1.5 pl-4" /> : null}
                  <th className="py-1.5 pl-4 pr-2">Karat</th>
                  <th className="px-2 text-right">Market / g</th>
                  <th className="px-2 text-right">Margin</th>
                  <th className="px-2 text-right">Suggested / g</th>
                  <th className="px-2 text-right">/ pawn</th>
                  <th className="px-2 text-right">Board now</th>
                  <th className="px-2 text-right">Board vs suggested</th>
                  <th className="px-2 pr-4 text-right">Market since publish</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const t = karatTone(r.purity);
                  return (
                    <tr key={r.purityId} className={cn("border-t border-ink/[0.05] transition-colors hover:bg-gold-pale/30", r.stale && "bg-amber-50/60")}>
                      {canPublish && !editing ? (
                        <td className="py-1.5 pl-4">
                          <input
                            type="checkbox"
                            checked={!!pick[r.purityId]}
                            onChange={(e) => setPick({ ...pick, [r.purityId]: e.target.checked })}
                            className="size-4 accent-[#062a22]"
                            aria-label={`Publish ${r.karat}`}
                          />
                        </td>
                      ) : null}
                      <td className="relative py-1.5 pl-4 pr-2">
                        <span className={cn("inline-flex h-6 min-w-[38px] items-center justify-center rounded-md px-1.5 text-[11px] font-bold", t.badge)}>{r.karat}</span>
                      </td>
                      <td className="g-metric px-2 text-right text-ink-3">{lkr(r.marketPerG)}</td>
                      <td className="px-2 text-right">
                        {editing ? (
                          <NumInput
                            value={perK[r.purityId] ?? ""}
                            onChange={(v) => setPerK({ ...perK, [r.purityId]: v })}
                            placeholder={draft.defaultMarginPct}
                            suffix="%"
                            className="ml-auto w-24"
                          />
                        ) : (
                          <span className="g-metric text-ink-2">{r.marginPct.toFixed(2)}%</span>
                        )}
                      </td>
                      <td className="px-2 text-right">
                        {pick[r.purityId] && !editing ? (
                          <NumInput value={overrides[r.purityId] ?? String(r.suggestedPerG)} onChange={(v) => setOverrides({ ...overrides, [r.purityId]: v })} className="ml-auto w-28" />
                        ) : (
                          <span className="g-metric text-[13px] font-semibold text-ink">{lkr(r.suggestedPerG)}</span>
                        )}
                      </td>
                      <td className="g-metric px-2 text-right text-ink-3">{lkr(r.suggestedPerPawn)}</td>
                      <td className="px-2 text-right">
                        <div className="g-metric text-ink-2">{r.boardPerG != null ? lkr(r.boardPerG) : <span className="text-ink-6">not set</span>}</div>
                        {r.boardEffectiveFrom ? <div className="text-[10px] text-ink-5">{when(r.boardEffectiveFrom)}</div> : null}
                      </td>
                      <td className={cn("g-metric px-2 text-right font-semibold", toneOf(r.boardVsSuggestedPct))}>{signed(r.boardVsSuggestedPct)}</td>
                      <td className="px-2 pr-4 text-right">
                        {r.driftPct == null ? (
                          <span className="text-[10.5px] text-ink-5">no snapshot at publish</span>
                        ) : (
                          <span
                            className={cn(
                              "g-metric rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                              r.stale ? "bg-amber-500/15 text-amber-800" : "bg-emerald-600/10 text-emerald-700"
                            )}
                          >
                            {signed(r.driftPct)}
                            {r.stale ? " · update" : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-ink/[0.06] px-4 py-2 text-[10.5px] text-ink-5">
          {canPublish
            ? "Tick karats to publish at the suggested rate (you can edit it first). Each goes through the usual approval rules and takes effect now."
            : "You can view suggestions; publishing needs the masters:create permission."}
        </p>
      </Card>

      {/* ============================================ import parity */}
      <div className="grid gap-3 xl:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHead
            icon={SettingsIcon}
            title="Import cost of a 24K bar"
            sub={par.data ? `Spot $${lkr(par.data.spotUsd, 2)}/oz at USD/LKR ${par.data.usdLkr.toFixed(2)}` : "What a bar costs landed in Sri Lanka"}
            action={
              canEdit ? (
                costEdit ? (
                  <>
                    <button className={btnSoft} onClick={() => setCostEdit(false)}>
                      Cancel
                    </button>
                    <button className={btnDark} disabled={!costs || saveCosts.isPending} onClick={() => costs && saveCosts.mutate(costs)}>
                      <CheckIcon size={12} /> {saveCosts.isPending ? "Saving…" : "Save costs"}
                    </button>
                  </>
                ) : (
                  <button className={btnSoft} onClick={() => setCostEdit(true)} disabled={!par.data}>
                    <EditIcon size={12} /> Edit costs
                  </button>
                )
              ) : null
            }
          />
          {costEdit ? (
            <div className="grid gap-3 border-b border-ink/[0.06] bg-gold-pale/30 px-4 py-3 sm:grid-cols-3">
              {COST_FIELDS.map((f) => (
                <Field key={f.key} label={f.label} hint={f.hint}>
                  <NumInput value={costDraft[f.key] ?? ""} onChange={(v) => setCostDraft({ ...costDraft, [f.key]: v })} suffix={f.suffix} />
                </Field>
              ))}
            </div>
          ) : null}
          {!land ? (
            <RowsSkeleton rows={5} />
          ) : (
            <div className="p-4">
              {/* waterfall */}
              <div className="space-y-1.5">
                {land.steps.map((s, i) => {
                  const before = land.steps.slice(0, i).reduce((a, x) => a + x.v, 0);
                  return (
                    <div key={s.k} className="grid grid-cols-[150px_1fr_96px] items-center gap-2">
                      <span className="truncate text-[11.5px] text-ink-3">{s.k}</span>
                      <div className="relative h-4 rounded bg-ink/[0.04]">
                        <span
                          className="absolute inset-y-0 rounded"
                          style={{ left: `${(before / land.landed) * 100}%`, width: `${Math.max(s.v > 0 ? 0.6 : 0, (s.v / land.landed) * 100)}%`, background: s.tone }}
                        />
                      </div>
                      <span className={cn("g-metric text-right text-[12px]", s.v ? "text-ink" : "text-ink-6")}>{s.v ? lkr(s.v) : "—"}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  { k: "Landed / g", v: lkr(land.landed), accent: true },
                  { k: "Landed / pawn", v: lkr(land.landed * 8) },
                  { k: "Landed $/oz", v: lkr((land.landed * TROY) / (par.data?.usdLkr || 1), 2) },
                ].map((m) => (
                  <div key={m.k} className={cn("rounded-xl px-3 py-2 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.06)]", m.accent ? "bg-void text-gold-light" : "bg-bone/60")}>
                    <div className={cn("text-[9.5px] font-semibold uppercase tracking-[0.14em]", m.accent ? "text-paper/45" : "text-ink-5")}>{m.k}</div>
                    <div className={cn("g-metric mt-0.5 text-[15px] font-semibold", m.accent ? "" : "text-ink")}>{m.v}</div>
                  </div>
                ))}
              </div>
              {Object.values(costs ?? {}).every((v) => !v) ? (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900 ring-1 ring-inset ring-amber-200">
                  No import costs entered yet, so landed cost equals spot. {canEdit ? "Use Edit costs to add your premium, duty and levies." : ""}
                </p>
              ) : null}
            </div>
          )}
        </Card>

        <Card>
          <CardHead icon={LayersIcon} title="Board vs landed cost" sub="Your margin over what the metal costs to bring in" />
          {!land || !par.data ? (
            <RowsSkeleton rows={4} />
          ) : (
            <table className="w-full text-[12px]">
              <thead className="bg-bone/60 text-left">
                <tr className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">
                  <th className="py-1.5 pl-4 pr-2">Karat</th>
                  <th className="px-2 text-right">Landed / g</th>
                  <th className="px-2 text-right">Board / g</th>
                  <th className="px-2 pr-4 text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {par.data.karats.map((k) => {
                  const landed = land.landed * k.purity;
                  const m = k.boardPerG != null ? ((k.boardPerG - landed) / landed) * 100 : null;
                  return (
                    <tr key={k.purityId} className="border-t border-ink/[0.05]">
                      <td className="py-2 pl-4 pr-2">
                        <span className={cn("inline-flex h-6 min-w-[38px] items-center justify-center rounded-md px-1.5 text-[11px] font-bold", karatTone(k.purity).badge)}>{k.karat}</span>
                      </td>
                      <td className="g-metric px-2 text-right text-ink-3">{lkr(landed)}</td>
                      <td className="g-metric px-2 text-right text-ink">{k.boardPerG != null ? lkr(k.boardPerG) : <span className="text-ink-6">not set</span>}</td>
                      <td className="px-2 pr-4 text-right">
                        {m == null ? (
                          <span className="text-ink-6">—</span>
                        ) : (
                          <span className={cn("g-metric rounded-full px-2 py-0.5 text-[10.5px] font-semibold", m < 0 ? "bg-rose-600/10 text-rose-700" : m < 2 ? "bg-amber-500/15 text-amber-800" : "bg-emerald-600/10 text-emerald-700")}>
                            {signed(m)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="border-t border-ink/[0.06] px-4 py-2 text-[10.5px] text-ink-5">Red: board below landed cost. Amber: under 2% over it. Rates you enter here are estimates you control; check current duty and levy rates with your bank or customs agent.</p>
        </Card>
      </div>
    </div>
  );
}
