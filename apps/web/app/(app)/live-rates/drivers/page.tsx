"use client";

// What moves gold today, and the dates ahead that tend to move it (or move
// customers): Fed decisions, jobs reports, festivals, plus the shop's own.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PERMISSIONS } from "@goldos/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Card, CardHead, Empty, GoldHero, HeroBadge, RowsSkeleton } from "@/components/console-kit";
import { FlagIcon, GaugeIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { Sparkline } from "../parts";
import { DeskTabs, Field, btnDark, fieldCls, lkr, signed, toneOf, useMe } from "../desk-kit";

type Drivers = {
  gold: { last: number | null; changePct: number | null; spark: number[] };
  drivers: { ticker: string; name: string; short: string; unit: string; why: string; last: number | null; changePct: number | null; change1mPct: number | null; corr1y: number | null; spark: number[] }[];
};
type Ev = { id: string; date: string; title: string; kind: "macro" | "local" | "shop"; note?: string; builtIn: boolean };
type Calendar = { today: string; events: Ev[]; own: Ev[] };

const KIND = {
  macro: { label: "Market", cls: "bg-sky-600/10 text-sky-800", dot: "#0284C7" },
  local: { label: "Festival", cls: "bg-amber-500/15 text-amber-800", dot: "#D97706" },
  shop: { label: "Shop", cls: "bg-violet-600/10 text-violet-800", dot: "#7C3AED" },
} as const;

/** How a driver's move today reads for gold, from its 1-year correlation. */
function readFor(d: Drivers["drivers"][number]) {
  if (d.changePct == null || d.corr1y == null || Math.abs(d.corr1y) < 0.15 || Math.abs(d.changePct) < 0.05) return null;
  const goodForGold = (d.changePct > 0) === (d.corr1y > 0);
  return { goodForGold, text: goodForGold ? "supportive for gold" : "a headwind for gold" };
}

function daysUntil(date: string, today: string) {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export default function DriversPage() {
  const qc = useQueryClient();
  const { can } = useMe();
  const canEdit = can(PERMISSIONS.MASTERS_EDIT);
  const dq = useQuery({ queryKey: ["desk-drivers"], queryFn: () => api<Drivers>("/api/v1/market-desk/drivers"), refetchInterval: 5 * 60_000 });
  const cq = useQuery({ queryKey: ["desk-events"], queryFn: () => api<Calendar>("/api/v1/market-desk/events") });
  const [date, setDate] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Ev["kind"]>("shop");
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: (events: Omit<Ev, "builtIn">[]) => api("/api/v1/market-desk/events", { method: "PUT", body: JSON.stringify({ events }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["desk-events"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  const own = (cq.data?.own ?? []).map(({ builtIn: _b, ...e }) => e);
  const add = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title.trim()) return toast.error("Pick a date and a title");
    save.mutate([...own, { id: crypto.randomUUID().slice(0, 12), date, title: title.trim(), kind, note: note.trim() || undefined }], {
      onSuccess: () => {
        toast.success("Event added");
        setTitle("");
        setNote("");
      },
    });
  };

  const d = dq.data;
  const reads = (d?.drivers ?? []).map((x) => ({ x, r: readFor(x) })).filter((v) => v.r);
  const support = reads.filter((v) => v.r!.goodForGold).length;
  const head = reads.length - support;

  // Group upcoming events by month.
  const months = new Map<string, Ev[]>();
  for (const e of cq.data?.events ?? []) {
    const k = e.date.slice(0, 7);
    months.set(k, [...(months.get(k) ?? []), e]);
  }
  const next = cq.data?.events[0];

  return (
    <div className="space-y-3">
      <GoldHero
        icon={GaugeIcon}
        title="Market"
        accent="drivers"
        back={{ href: "/live-rates", label: "Live rates" }}
        badge={
          d ? (
            support > head ? (
              <HeroBadge tone="good">Tailwinds today</HeroBadge>
            ) : head > support ? (
              <HeroBadge tone="bad">Headwinds today</HeroBadge>
            ) : (
              <HeroBadge tone="muted">Mixed signals</HeroBadge>
            )
          ) : null
        }
        sub="Daily moves from Yahoo Finance · correlation of daily returns with COMEX gold over the last year"
        stats={[
          { label: "Gold futures", value: d?.gold.last ?? null, format: (n) => `$${lkr(n, 2)}`, sub: signed(d?.gold.changePct), accent: true, loading: dq.isLoading },
          ...(d?.drivers ?? []).slice(0, 4).map((x) => ({
            label: x.name,
            value: x.last,
            format: (n: number) => lkr(n, 2),
            sub: signed(x.changePct),
            tone: (x.changePct == null ? undefined : x.changePct > 0 ? "good" : "bad") as "good" | "bad" | undefined,
          })),
          { label: "Next event", value: null, text: next ? next.title : "—", sub: next && cq.data ? `in ${daysUntil(next.date, cq.data.today)} days · ${next.date}` : undefined, loading: cq.isLoading },
        ]}
      >
        <DeskTabs />
      </GoldHero>

      {/* -------------------------------------------- drivers */}
      <Card>
        <CardHead icon={GaugeIcon} title="What moves gold" sub={d ? `${support} supportive · ${head} headwind · ${(d.drivers.length ?? 0) - reads.length} neutral today` : undefined} />
        {dq.isLoading ? (
          <RowsSkeleton rows={4} />
        ) : !d ? (
          <p className="px-4 py-6 text-center text-[12.5px] text-rose-700">Market drivers are unavailable right now.</p>
        ) : (
          <div className="grid gap-px bg-ink/[0.06] sm:grid-cols-2 xl:grid-cols-3">
            {d.drivers.map((x) => {
              const r = readFor(x);
              const c = x.corr1y;
              return (
                <div key={x.ticker} className="relative bg-paper p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-semibold text-ink">{x.name}</span>
                        <span className="g-metric rounded bg-bone px-1.5 text-[10px] font-semibold text-ink-4">{x.short}</span>
                      </div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="g-metric text-[20px] font-semibold leading-none text-ink">
                          {x.unit === "$" ? "$" : x.unit === "Rs" ? "Rs " : ""}
                          {x.last != null ? lkr(x.last, 2) : "—"}
                          {x.unit === "%" ? "%" : ""}
                        </span>
                        <span className={cn("g-metric text-[12px] font-semibold", toneOf(x.changePct))}>{signed(x.changePct)}</span>
                      </div>
                      <div className="mt-0.5 text-[10.5px] text-ink-5">1 month {signed(x.change1mPct, 1)}</div>
                    </div>
                    <Sparkline values={x.spark} color={(x.change1mPct ?? 0) >= 0 ? "#10B981" : "#F43F5E"} className="h-10 w-28 [&>span]:hidden" />
                  </div>
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[10.5px] text-ink-4">
                      <span>Moves with gold</span>
                      <span className="g-metric font-semibold text-ink-2">{c != null ? `ρ ${c.toFixed(2)}` : "—"}</span>
                    </div>
                    <div className="relative mt-1 h-1.5 rounded-full bg-ink/[0.06]">
                      <span className="absolute inset-y-0 left-1/2 w-px bg-ink/20" />
                      {c != null ? (
                        <span
                          className={cn("absolute inset-y-0 rounded-full", c >= 0 ? "bg-sky-500" : "bg-orange-500")}
                          style={c >= 0 ? { left: "50%", width: `${c * 50}%` } : { right: "50%", width: `${-c * 50}%` }}
                        />
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex justify-between text-[9.5px] text-ink-5">
                      <span>opposite</span>
                      <span>together</span>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] leading-snug text-ink-3">{x.why}</p>
                  {r ? (
                    <p className={cn("mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold", r.goodForGold ? "bg-emerald-600/10 text-emerald-700" : "bg-rose-600/10 text-rose-700")}>
                      Today: {r.text}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        <p className="border-t border-ink/[0.06] px-4 py-2 text-[10.5px] text-ink-5">
          Relationships shift over time; these are context for pricing, not forecasts.
        </p>
      </Card>

      {/* -------------------------------------------- calendar */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHead icon={FlagIcon} title="Calendar" sub="Market events and buying seasons ahead" />
          {cq.isLoading ? (
            <RowsSkeleton rows={6} />
          ) : !cq.data?.events.length ? (
            <Empty icon={FlagIcon} title="Nothing coming up" desc="Add your own dates — wedding season, promotions, stock-take." />
          ) : (
            <div className="max-h-[640px] overflow-y-auto scrollbar-thin">
              {[...months.entries()].map(([m, evs]) => (
                <div key={m}>
                  <div className="sticky top-0 z-[1] bg-bone/90 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-5 backdrop-blur">
                    {new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}
                  </div>
                  <ul className="divide-y divide-ink/[0.05]">
                    {evs.map((e) => {
                      const k = KIND[e.kind];
                      const n = daysUntil(e.date, cq.data!.today);
                      return (
                        <li key={e.id} className="relative flex items-center gap-3 px-4 py-2">
                          <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full" style={{ background: k.dot }} aria-hidden />
                          <div className="w-11 shrink-0 text-center leading-none">
                            <div className="g-metric text-[17px] font-semibold text-ink">{e.date.slice(8)}</div>
                            <div className="text-[9.5px] font-semibold uppercase text-ink-5">
                              {new Date(`${e.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}
                            </div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-[12.5px] font-semibold text-ink">{e.title}</span>
                              <span className={cn("shrink-0 rounded-full px-1.5 text-[9.5px] font-semibold", k.cls)}>{k.label}</span>
                            </div>
                            {e.note ? <div className="truncate text-[10.5px] text-ink-5">{e.note}</div> : null}
                          </div>
                          <span className={cn("g-metric shrink-0 text-[11px] font-semibold", n <= 7 ? "text-rose-700" : n <= 30 ? "text-amber-700" : "text-ink-4")}>
                            {n === 0 ? "today" : n === 1 ? "tomorrow" : `${n} d`}
                          </span>
                          {!e.builtIn && canEdit ? (
                            <button
                              aria-label="Remove event"
                              className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-5 hover:bg-rose-500/10 hover:text-rose-700"
                              onClick={() => save.mutate(own.filter((x) => x.id !== e.id))}
                            >
                              <TrashIcon size={12} />
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-3">
          {canEdit ? (
            <Card>
              <CardHead icon={PlusIcon} title="Add a date" sub="Wedding season, a promotion, stock-take…" />
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                <Field label="Date">
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fieldCls} />
                </Field>
                <Field label="Type">
                  <select value={kind} onChange={(e) => setKind(e.target.value as Ev["kind"])} className={fieldCls}>
                    <option value="shop">Shop</option>
                    <option value="local">Festival / season</option>
                    <option value="macro">Market event</option>
                  </select>
                </Field>
                <Field label="Title" className="sm:col-span-2">
                  <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="e.g. Poson wedding season starts" className={fieldCls} />
                </Field>
                <Field label="Note (optional)" className="sm:col-span-2">
                  <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={fieldCls} />
                </Field>
                <button className={cn(btnDark, "justify-center sm:col-span-2")} onClick={add} disabled={save.isPending}>
                  <PlusIcon size={12} /> Add to calendar
                </button>
              </div>
            </Card>
          ) : null}
          <Card>
            <CardHead icon={FlagIcon} title="About these dates" />
            <ul className="space-y-1.5 px-4 py-3 text-[11.5px] leading-snug text-ink-3">
              <li>
                <b className="text-ink-2">Fed decisions</b> are the published 2026 FOMC dates; add later years as they’re announced.
              </li>
              <li>
                <b className="text-ink-2">US jobs reports</b> usually come out on the first Friday — check bls.gov for exact dates.
              </li>
              <li>
                <b className="text-ink-2">Lunar festivals</b> (Eid, Deepavali) can shift by a day; dates marked approx. depend on the moon.
              </li>
              <li>Use the monthly pattern on the gold market page alongside this to plan stock ahead of busy seasons.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
