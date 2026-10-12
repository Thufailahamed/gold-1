"use client";

// Price watches. Rules are checked hourly by the server and whenever anyone
// opens the board; a fired alert shows in the top-bar bell and, if allowed,
// as a desktop notification.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PERMISSIONS } from "@goldos/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Card, CardHead, Empty, GoldHero, HeroBadge, RowsSkeleton } from "@/components/console-kit";
import { BellIcon, PlusIcon, RefreshCwIcon, TrashIcon } from "@/components/icons";
import { MetalCoin, karatTone } from "../parts";
import { DeskTabs, Field, NumInput, btnDark, btnSoft, fieldCls, lkr, num, useAlerts, useMe, when, type AlertsData } from "../desk-kit";

type Live = {
  quotes: { symbol: string; name: string; unit: string; priceUsd: number; change24hPct: number | null }[];
  karats: { purityId: string; karat: string; purity: number; lkrPerGram: number; change24hPct: number | null; boardDiffPct: number | null }[];
};
type Kind = AlertsData["alerts"][number]["kind"];

const KINDS: { key: Kind; label: string; help: string }[] = [
  { key: "PRICE_ABOVE", label: "Price rises above", help: "Fires when the price reaches or passes your level" },
  { key: "PRICE_BELOW", label: "Price falls below", help: "Fires when the price drops to or under your level" },
  { key: "MOVE_PCT", label: "Moves more than ±%", help: "24-hour change, either direction" },
  { key: "BOARD_GAP", label: "Board drifts from market ±%", help: "Your published rate vs the market for a karat" },
];

function describe(a: AlertsData["alerts"][number]) {
  const target = a.karat ? `${a.karat} gold` : a.symbol;
  const unit = a.karat ? "LKR/g" : "USD";
  switch (a.kind) {
    case "PRICE_ABOVE":
      return `${target} at or above ${lkr(a.threshold, 2)} ${unit}`;
    case "PRICE_BELOW":
      return `${target} at or below ${lkr(a.threshold, 2)} ${unit}`;
    case "MOVE_PCT":
      return `${target} moves ±${a.threshold}% in 24h`;
    default:
      return `${target} board ±${a.threshold}% from market`;
  }
}

export default function AlertsPage() {
  const qc = useQueryClient();
  const { can } = useMe();
  const canEdit = can(PERMISSIONS.MASTERS_EDIT);
  const alerts = useAlerts();
  const live = useQuery({ queryKey: ["market-live"], queryFn: () => api<Live>("/api/v1/market/live"), refetchInterval: 60_000 });
  const inval = () => qc.invalidateQueries({ queryKey: ["market-alerts"] });

  /* ---------------- new rule */
  const [kind, setKind] = useState<Kind>("PRICE_ABOVE");
  const [target, setTarget] = useState("k:");
  const [threshold, setThreshold] = useState("");
  const [note, setNote] = useState("");
  // Default target: 22K (or the first karat) once the board loads.
  useEffect(() => {
    if (target !== "k:" || !live.data) return;
    const k = live.data.karats.find((x) => x.karat === "22K") ?? live.data.karats[0];
    setTarget(k ? `k:${k.purityId}` : "s:XAU");
  }, [live.data, target]);
  const isKarat = target.startsWith("k:");
  useEffect(() => {
    if (kind === "BOARD_GAP" && !isKarat && live.data?.karats[0]) setTarget(`k:${live.data.karats[0].purityId}`);
  }, [kind, isKarat, live.data]);

  const k = isKarat ? live.data?.karats.find((x) => x.purityId === target.slice(2)) : undefined;
  const qte = !isKarat ? live.data?.quotes.find((x) => x.symbol === target.slice(2)) : undefined;
  const current =
    kind === "MOVE_PCT"
      ? (k?.change24hPct ?? qte?.change24hPct ?? null)
      : kind === "BOARD_GAP"
        ? (k?.boardDiffPct ?? null)
        : (k?.lkrPerGram ?? qte?.priceUsd ?? null);
  const unit = kind === "MOVE_PCT" || kind === "BOARD_GAP" ? "%" : isKarat ? "LKR/g" : qte?.unit === "coin" ? "USD" : `USD/${qte?.unit ?? "oz"}`;

  const create = useMutation({
    mutationFn: () =>
      api("/api/v1/market-desk/alerts", {
        method: "POST",
        body: JSON.stringify({
          kind,
          ...(isKarat ? { purityId: target.slice(2) } : { symbol: target.slice(2) }),
          threshold: num(threshold),
          note: note.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      toast.success("Alert created");
      setThreshold("");
      setNote("");
      inval();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create alert"),
  });
  const patch = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api(`/api/v1/market-desk/alerts/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
    onSuccess: inval,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/v1/market-desk/alerts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Alert deleted");
      inval();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });
  const check = useMutation({
    mutationFn: () => api<{ checked: number; fired: number }>("/api/v1/market-desk/alerts/check", { method: "POST" }),
    onSuccess: (r) => {
      toast.success(r.fired ? `${r.fired} alert${r.fired > 1 ? "s" : ""} fired` : `Checked ${r.checked} rule${r.checked === 1 ? "" : "s"} — nothing new`);
      inval();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Check failed"),
  });
  const seen = useMutation({ mutationFn: () => api("/api/v1/market-desk/alerts/seen", { method: "POST" }), onSuccess: inval });

  /* ---------------- desktop notifications */
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => {
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  const d = alerts.data;
  const active = d?.alerts.filter((a) => a.isActive) ?? [];
  const tripped = active.filter((a) => a.isTripped);
  const lastCheck = Math.max(0, ...(d?.alerts.map((a) => a.lastCheckedAt ?? 0) ?? [0]));

  return (
    <div className="space-y-3">
      <GoldHero
        icon={BellIcon}
        title="Price"
        accent="alerts"
        back={{ href: "/live-rates", label: "Live rates" }}
        badge={d?.unseen ? <HeroBadge tone="bad">{d.unseen} new</HeroBadge> : <HeroBadge tone="muted">Watching</HeroBadge>}
        sub="Checked every hour and whenever the board is opened · fired alerts show in the bell"
        actions={
          <>
            <button className="home-btn-ghost h-8 px-3 text-[12.5px]" onClick={() => check.mutate()} disabled={check.isPending}>
              <RefreshCwIcon size={12} className={cn(check.isPending && "animate-spin")} /> Check now
            </button>
            {perm === "default" ? (
              <button className="home-btn-gold h-8 px-3.5 text-[12.5px]" onClick={() => Notification.requestPermission().then(setPerm)}>
                Enable desktop alerts
              </button>
            ) : null}
          </>
        }
        stats={[
          { label: "Active rules", value: d ? active.length : undefined, loading: alerts.isLoading },
          { label: "Triggered now", value: d ? tripped.length : undefined, tone: tripped.length ? "warn" : "good", loading: alerts.isLoading },
          { label: "Unread alerts", value: d?.unseen, tone: d?.unseen ? "bad" : undefined, loading: alerts.isLoading },
          { label: "Fired (last 50)", value: d?.events.length, loading: alerts.isLoading },
          { label: "Last checked", value: null, text: lastCheck ? when(lastCheck) : "—", loading: alerts.isLoading },
          {
            label: "Desktop alerts",
            value: null,
            text: perm === "granted" ? "On" : perm === "denied" ? "Blocked" : perm === "unsupported" ? "Not supported" : "Off",
            tone: perm === "granted" ? "good" : perm === "denied" ? "bad" : undefined,
          },
        ]}
      >
        <DeskTabs />
      </GoldHero>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          {canEdit ? (
            <Card>
              <CardHead icon={PlusIcon} title="New alert" sub={KINDS.find((x) => x.key === kind)?.help} />
              <form
                className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr]"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!(num(threshold) > 0)) return toast.error("Enter a level above zero");
                  create.mutate();
                }}
              >
                <Field label="When">
                  <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={fieldCls}>
                    {KINDS.map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Market">
                  <select value={target} onChange={(e) => setTarget(e.target.value)} className={fieldCls}>
                    <optgroup label="Karat gold (LKR / g)">
                      {(live.data?.karats ?? []).map((x) => (
                        <option key={x.purityId} value={`k:${x.purityId}`}>
                          {x.karat} gold
                        </option>
                      ))}
                    </optgroup>
                    {kind !== "BOARD_GAP" ? (
                      <optgroup label="World markets (USD)">
                        {(live.data?.quotes ?? []).map((x) => (
                          <option key={x.symbol} value={`s:${x.symbol}`}>
                            {x.name} ({x.symbol})
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                </Field>
                <Field label="Level" hint={current != null ? `Now ${unit === "%" ? `${current.toFixed(2)}%` : `${lkr(current, 2)} ${unit}`}` : undefined}>
                  <NumInput value={threshold} onChange={setThreshold} suffix={unit} />
                </Field>
                <Field label="Note (optional)" className="sm:col-span-2">
                  <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="e.g. Re-price 22K board" className={fieldCls} />
                </Field>
                <div className="flex items-end">
                  <button type="submit" className={cn(btnDark, "w-full justify-center")} disabled={create.isPending}>
                    <PlusIcon size={12} /> {create.isPending ? "Adding…" : "Add alert"}
                  </button>
                </div>
              </form>
            </Card>
          ) : null}

          <Card>
            <CardHead icon={BellIcon} title="Rules" sub={d ? `${active.length} active of ${d.alerts.length}` : undefined} />
            {alerts.isLoading ? (
              <RowsSkeleton rows={3} />
            ) : !d?.alerts.length ? (
              <Empty icon={BellIcon} title="No alerts yet" desc="Add one above — for example, 22K gold above a price, or the board drifting 1% from market." />
            ) : (
              <ul className="divide-y divide-ink/[0.05]">
                {d.alerts.map((a) => {
                  const kt = a.karat && live.data ? live.data.karats.find((x) => x.purityId === a.purityId) : null;
                  return (
                    <li key={a.id} className={cn("relative flex items-center gap-3 px-4 py-2.5", !a.isActive && "opacity-55")}>
                      <span
                        className="absolute inset-y-2 left-0 w-[3px] rounded-r-full"
                        style={{ background: !a.isActive ? "#94A3B8" : a.isTripped ? "#F43F5E" : "#10B981" }}
                        aria-hidden
                      />
                      {a.symbol ? (
                        <MetalCoin symbol={a.symbol} size={28} />
                      ) : (
                        <span className={cn("flex h-7 min-w-[36px] items-center justify-center rounded-md px-1 text-[10.5px] font-bold", karatTone(kt?.purity ?? 0.916).badge)}>{a.karat}</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-semibold text-ink">{describe(a)}</div>
                        <div className="truncate text-[10.5px] text-ink-5">
                          {a.note ? `${a.note} · ` : ""}
                          {a.lastValue != null ? `last ${a.kind === "MOVE_PCT" || a.kind === "BOARD_GAP" ? `${a.lastValue.toFixed(2)}%` : lkr(a.lastValue, 2)}` : "not checked yet"}
                          {a.lastFiredAt ? ` · fired ${when(a.lastFiredAt)}` : ""}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          !a.isActive ? "bg-ink/[0.06] text-ink-4" : a.isTripped ? "bg-rose-600/10 text-rose-700" : "bg-emerald-600/10 text-emerald-700"
                        )}
                      >
                        {!a.isActive ? "Paused" : a.isTripped ? "Triggered" : "Armed"}
                      </span>
                      {canEdit ? (
                        <div className="flex shrink-0 gap-1">
                          <button className={cn(btnSoft, "h-7 px-2 text-[11px]")} onClick={() => patch.mutate({ id: a.id, isActive: !a.isActive })}>
                            {a.isActive ? "Pause" : "Resume"}
                          </button>
                          <button
                            className="flex size-7 items-center justify-center rounded-lg text-ink-5 transition-colors hover:bg-rose-500/10 hover:text-rose-700"
                            aria-label="Delete alert"
                            onClick={() => confirm("Delete this alert and its history?") && remove.mutate(a.id)}
                          >
                            <TrashIcon size={13} />
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <Card className="xl:self-start">
          <CardHead
            icon={RefreshCwIcon}
            title="Fired alerts"
            sub="Most recent first"
            action={
              d?.unseen ? (
                <button className={cn(btnSoft, "h-7 text-[11px]")} onClick={() => seen.mutate()}>
                  Mark all read
                </button>
              ) : null
            }
          />
          {alerts.isLoading ? (
            <RowsSkeleton rows={4} />
          ) : !d?.events.length ? (
            <Empty icon={BellIcon} title="Nothing has fired" desc="When a rule's condition becomes true, it appears here once. It re-arms after the condition clears." />
          ) : (
            <ul className="max-h-[560px] divide-y divide-ink/[0.05] overflow-y-auto scrollbar-thin">
              {d.events.map((e) => (
                <li key={e.id} className={cn("flex gap-2.5 px-4 py-2.5", !e.seen && "bg-gold-pale/40")}>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", e.seen ? "bg-ink/15" : "bg-rose-500")} />
                  <div className="min-w-0">
                    <p className="text-[12px] leading-snug text-ink">{e.message}</p>
                    <p className="mt-0.5 text-[10.5px] text-ink-5">{when(e.firedAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
