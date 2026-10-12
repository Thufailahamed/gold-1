"use client";

// Records: the board rate and the market, day by day (for the accountant and
// audit), and rates seen at other shops, typed in by staff.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { PERMISSIONS } from "@goldos/shared";
import { api, downloadCsv } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Card, CardHead, Empty, GoldHero, RowsSkeleton } from "@/components/console-kit";
import { FileDownIcon, HistoryIcon, PlusIcon, StoreIcon, TrashIcon } from "@/components/icons";
import { karatTone } from "../parts";
import { DeskTabs, Field, NumInput, btnDark, btnSoft, fieldCls, lkr, num, signed, toneOf, useMe, when } from "../desk-kit";

type Log = {
  purity: { id: string; karat: string; permille: number } | null;
  purities: { id: string; karat: string }[];
  days: {
    date: string;
    board: { open: number | null; close: number | null; high: number | null; low: number | null; changes: number };
    market: { open: number | null; close: number | null; high: number | null; low: number | null; samples: number };
    gapPct: number | null;
  }[];
};
type Comp = {
  days: number;
  entries: { id: string; shop: string; area: string | null; purityId: string; karat: string; permille: number; side: "SELL" | "BUY"; ratePerG: number; observedAt: number; notes: string | null; by: string | null }[];
  summary: {
    purityId: string;
    karat: string;
    permille: number;
    side: "SELL" | "BUY";
    shops: number;
    low: number;
    high: number;
    avg: number;
    ours: number | null;
    oursVsAvgPct: number | null;
    market: number | null;
    quotes: Comp["entries"];
  }[];
};
type Live = { karats: { purityId: string; karat: string; purity: number; lkrPerGram: number }[] };

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export default function RecordsPage() {
  const qc = useQueryClient();
  const { can } = useMe();
  const canAdd = can(PERMISSIONS.MASTERS_CREATE);
  const canDelete = can(PERMISSIONS.MASTERS_CANCEL);

  /* ---------------- rate log */
  const [from, setFrom] = useState(() => iso(Date.now() - 29 * 86_400_000));
  const [to, setTo] = useState(() => iso(Date.now()));
  const [purityId, setPurityId] = useState("");
  const qs = `from=${from}&to=${to}${purityId ? `&purityId=${purityId}` : ""}`;
  const log = useQuery({
    queryKey: ["desk-rate-log", from, to, purityId],
    queryFn: () => api<Log>(`/api/v1/market-desk/rate-log?${qs}`),
    enabled: from <= to,
  });
  useEffect(() => {
    if (!purityId && log.data?.purity) setPurityId(log.data.purity.id);
  }, [log.data, purityId]);
  const chart = useMemo(
    () =>
      [...(log.data?.days ?? [])].reverse().map((d) => ({ date: d.date.slice(5), board: d.board.close, market: d.market.close })),
    [log.data]
  );
  const logStats = useMemo(() => {
    const days = log.data?.days ?? [];
    const gaps = days.map((d) => d.gapPct).filter((g): g is number => g != null);
    return {
      changes: days.reduce((s, d) => s + d.board.changes, 0),
      avgGap: gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null,
      maxGap: gaps.length ? Math.max(...gaps.map(Math.abs)) : null,
      unchanged: days.filter((d) => d.board.changes === 0).length,
    };
  }, [log.data]);

  /* ---------------- competitors */
  const [days, setDays] = useState(30);
  const comp = useQuery({ queryKey: ["desk-competitors", days], queryFn: () => api<Comp>(`/api/v1/market-desk/competitors?days=${days}`) });
  const live = useQuery({ queryKey: ["market-live"], queryFn: () => api<Live>("/api/v1/market/live") });
  const [shop, setShop] = useState("");
  const [area, setArea] = useState("");
  const [cPurity, setCPurity] = useState("");
  const [side, setSide] = useState<"SELL" | "BUY">("SELL");
  const [rate, setRate] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (!cPurity && live.data?.karats.length) setCPurity((live.data.karats.find((k) => k.karat === "22K") ?? live.data.karats[0]!).purityId);
  }, [live.data, cPurity]);
  const add = useMutation({
    mutationFn: () =>
      api("/api/v1/market-desk/competitors", {
        method: "POST",
        body: JSON.stringify({ shop: shop.trim(), area: area.trim() || undefined, purityId: cPurity, side, ratePerGram: num(rate), notes: notes.trim() || undefined }),
      }),
    onSuccess: () => {
      toast.success("Rate recorded");
      setRate("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["desk-competitors"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/api/v1/market-desk/competitors/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["desk-competitors"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });
  const shops = [...new Set((comp.data?.entries ?? []).map((e) => e.shop))];
  const sellK = comp.data?.summary.find((s) => s.side === "SELL" && s.karat === "22K") ?? comp.data?.summary.find((s) => s.side === "SELL");

  return (
    <div className="space-y-3">
      <GoldHero
        icon={HistoryIcon}
        title="Rate"
        accent="records"
        back={{ href: "/live-rates", label: "Live rates" }}
        sub="Board vs market by day, and what other shops are charging"
        stats={[
          { label: `Board changes (${log.data?.purity?.karat ?? "—"})`, value: log.data ? logStats.changes : undefined, loading: log.isLoading },
          { label: "Days unchanged", value: log.data ? logStats.unchanged : undefined, loading: log.isLoading },
          { label: "Avg board vs market", value: logStats.avgGap, format: (n) => signed(n), loading: log.isLoading },
          { label: "Widest gap", value: logStats.maxGap, format: (n) => `±${n.toFixed(2)}%`, loading: log.isLoading },
          { label: "Shops tracked", value: comp.data ? shops.length : undefined, loading: comp.isLoading, sub: `last ${days} days` },
          {
            label: `Us vs others ${sellK?.karat ?? ""}`,
            value: sellK?.oursVsAvgPct ?? null,
            format: (n) => signed(n),
            sub: sellK ? `avg Rs ${lkr(sellK.avg)}/g` : "no quotes yet",
            loading: comp.isLoading,
          },
        ]}
      >
        <DeskTabs />
      </GoldHero>

      {/* ============================================ rate log */}
      <Card>
        <CardHead
          icon={HistoryIcon}
          title="Daily rate log"
          sub="Board in force each day vs the market (spot × purity), in LKR per gram"
          action={
            <>
              <select value={purityId} onChange={(e) => setPurityId(e.target.value)} className={cn(fieldCls, "w-24")} aria-label="Karat">
                {(log.data?.purities ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.karat}
                  </option>
                ))}
              </select>
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={cn(fieldCls, "w-36")} aria-label="From" />
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={cn(fieldCls, "w-36")} aria-label="To" />
              <button
                className={btnDark}
                onClick={() => downloadCsv(`/api/v1/market-desk/rate-log?${qs}&format=csv`, `rate-log-${log.data?.purity?.karat ?? "gold"}-${from}-to-${to}.csv`).catch((e) => toast.error(e.message))}
              >
                <FileDownIcon size={12} /> CSV
              </button>
            </>
          }
        />
        {log.isLoading ? (
          <RowsSkeleton rows={6} />
        ) : log.isError ? (
          <p className="px-4 py-6 text-center text-[12.5px] text-rose-700">{(log.error as Error).message}</p>
        ) : (
          <>
            {chart.some((c) => c.board != null || c.market != null) ? (
              <div className="h-[200px] border-b border-ink/[0.06] px-2 pt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="rgba(16,32,27,0.06)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#7B867F" }} axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "#7B867F" }} axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => lkr(v)} />
                    <Tooltip formatter={(v) => lkr(Number(v))} contentStyle={{ fontSize: 11, borderRadius: 10 }} />
                    <Line type="stepAfter" dataKey="board" name="Board" stroke="#062a22" strokeWidth={2} dot={false} connectNulls />
                    <Line type="monotone" dataKey="market" name="Market" stroke="#CDA853" strokeWidth={1.6} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : null}
            <div className="max-h-[440px] overflow-auto scrollbar-thin">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 z-[1] bg-bone text-left">
                  <tr className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-ink-5">
                    <th className="py-1.5 pl-4 pr-2">Date</th>
                    <th className="px-2 text-right">Board open</th>
                    <th className="px-2 text-right">High</th>
                    <th className="px-2 text-right">Low</th>
                    <th className="px-2 text-right">Close</th>
                    <th className="px-2 text-right">Changes</th>
                    <th className="border-l border-ink/[0.06] px-2 text-right">Market open</th>
                    <th className="px-2 text-right">High</th>
                    <th className="px-2 text-right">Low</th>
                    <th className="px-2 text-right">Close</th>
                    <th className="px-2 pr-4 text-right">Board vs mkt</th>
                  </tr>
                </thead>
                <tbody>
                  {(log.data?.days ?? []).map((d) => (
                    <tr key={d.date} className="border-t border-ink/[0.05] hover:bg-gold-pale/30">
                      <td className="g-metric py-1.5 pl-4 pr-2 text-ink-2">{d.date}</td>
                      <td className="g-metric px-2 text-right text-ink-3">{lkr(d.board.open)}</td>
                      <td className="g-metric px-2 text-right text-ink-4">{lkr(d.board.high)}</td>
                      <td className="g-metric px-2 text-right text-ink-4">{lkr(d.board.low)}</td>
                      <td className="g-metric px-2 text-right font-semibold text-ink">{lkr(d.board.close)}</td>
                      <td className="px-2 text-right">
                        {d.board.changes ? <span className="g-metric rounded-full bg-void px-1.5 text-[10px] font-bold text-gold-light">{d.board.changes}</span> : <span className="text-ink-6">—</span>}
                      </td>
                      <td className="g-metric border-l border-ink/[0.06] px-2 text-right text-ink-3">{lkr(d.market.open)}</td>
                      <td className="g-metric px-2 text-right text-emerald-700">{lkr(d.market.high)}</td>
                      <td className="g-metric px-2 text-right text-rose-700">{lkr(d.market.low)}</td>
                      <td className="g-metric px-2 text-right text-ink">{lkr(d.market.close)}</td>
                      <td className={cn("g-metric px-2 pr-4 text-right font-semibold", toneOf(d.gapPct))}>{signed(d.gapPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-ink/[0.06] px-4 py-2 text-[10.5px] text-ink-5">
              Days use the shop’s business time zone. Market figures come from stored snapshots (hourly), so days before the feed started are blank.
            </p>
          </>
        )}
      </Card>

      {/* ============================================ competitors */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardHead
            icon={StoreIcon}
            title="Other shops"
            sub="Latest quote per shop, compared with your board and the market"
            action={
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={cn(fieldCls, "w-32")} aria-label="Period">
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            }
          />
          {comp.isLoading ? (
            <RowsSkeleton rows={4} />
          ) : !comp.data?.summary.length ? (
            <Empty icon={StoreIcon} title="No rates recorded" desc="When staff check Pettah or a nearby shop, record what they saw here to compare." />
          ) : (
            <div className="divide-y divide-ink/[0.05]">
              {comp.data.summary.map((s) => {
                const lo = Math.min(s.low, s.ours ?? s.low, s.market ?? s.low);
                const hi = Math.max(s.high, s.ours ?? s.high, s.market ?? s.high);
                const span = hi - lo || 1;
                const at = (v: number) => `${((v - lo) / span) * 100}%`;
                return (
                  <div key={`${s.purityId}-${s.side}`} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("inline-flex h-6 min-w-[38px] items-center justify-center rounded-md px-1.5 text-[11px] font-bold", karatTone(s.permille / 1000).badge)}>{s.karat}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", s.side === "SELL" ? "bg-sky-600/10 text-sky-800" : "bg-amber-500/15 text-amber-800")}>
                        {s.side === "SELL" ? "Selling" : "Buying old gold"}
                      </span>
                      <span className="text-[11px] text-ink-4">
                        {s.shops} shop{s.shops === 1 ? "" : "s"} · avg <b className="g-metric text-ink-2">{lkr(s.avg)}</b>
                      </span>
                      {s.oursVsAvgPct != null ? (
                        <span className={cn("ml-auto g-metric rounded-full px-2 py-0.5 text-[10.5px] font-semibold", Math.abs(s.oursVsAvgPct) < 0.5 ? "bg-emerald-600/10 text-emerald-700" : s.oursVsAvgPct > 0 ? "bg-amber-500/15 text-amber-800" : "bg-sky-600/10 text-sky-800")}>
                          we are {signed(s.oursVsAvgPct)} vs avg
                        </span>
                      ) : null}
                    </div>
                    {/* range strip */}
                    <div className="relative mt-4 h-2 rounded-full bg-ink/[0.05]">
                      <span className="absolute inset-y-0 rounded-full bg-gradient-to-r from-sky-300 to-sky-500" style={{ left: at(s.low), width: `calc(${at(s.high)} - ${at(s.low)})` }} />
                      {s.quotes.map((q) => (
                        <span key={q.id} title={`${q.shop}: ${lkr(q.ratePerG)}`} className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-700 ring-2 ring-paper" style={{ left: at(q.ratePerG) }} />
                      ))}
                      {s.market != null ? (
                        <span title={`Market ${lkr(s.market)}`} className="absolute -top-2.5 h-7 w-0.5 -translate-x-1/2 bg-gold" style={{ left: at(s.market) }} />
                      ) : null}
                      {s.ours != null ? (
                        <span title={`Our board ${lkr(s.ours)}`} className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] bg-void ring-2 ring-paper" style={{ left: at(s.ours) }} />
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-ink-4">
                      {s.quotes.map((q) => (
                        <span key={q.id}>
                          {q.shop} <b className="g-metric text-ink-2">{lkr(q.ratePerG)}</b>
                        </span>
                      ))}
                      {s.ours != null ? (
                        <span>
                          ◆ Us <b className="g-metric text-ink">{lkr(s.ours)}</b>
                        </span>
                      ) : null}
                      {s.market != null ? (
                        <span>
                          <i className="mr-1 inline-block h-2.5 w-0.5 bg-gold align-middle" />
                          Market <b className="g-metric text-ink-2">{lkr(s.market)}</b>
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <div className="space-y-3">
          {canAdd ? (
            <Card>
              <CardHead icon={PlusIcon} title="Record a rate" sub="What another shop is charging or paying per gram" />
              <form
                className="grid gap-3 p-4 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!shop.trim()) return toast.error("Enter the shop name");
                  if (!(num(rate) > 0)) return toast.error("Enter the rate per gram");
                  add.mutate();
                }}
              >
                <Field label="Shop">
                  <input value={shop} onChange={(e) => setShop(e.target.value)} list="desk-shops" maxLength={80} placeholder="e.g. Sea Street jeweller" className={fieldCls} />
                  <datalist id="desk-shops">
                    {shops.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Area (optional)">
                  <input value={area} onChange={(e) => setArea(e.target.value)} maxLength={80} placeholder="Pettah" className={fieldCls} />
                </Field>
                <Field label="Karat">
                  <select value={cPurity} onChange={(e) => setCPurity(e.target.value)} className={fieldCls}>
                    {(live.data?.karats ?? []).map((k) => (
                      <option key={k.purityId} value={k.purityId}>
                        {k.karat}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Their rate">
                  <select value={side} onChange={(e) => setSide(e.target.value as "SELL" | "BUY")} className={fieldCls}>
                    <option value="SELL">Selling price</option>
                    <option value="BUY">Old-gold buying price</option>
                  </select>
                </Field>
                <Field label="Rate per gram">
                  <NumInput value={rate} onChange={setRate} suffix="Rs" />
                </Field>
                <Field label="Note (optional)">
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} className={fieldCls} />
                </Field>
                <button type="submit" className={cn(btnDark, "justify-center sm:col-span-2")} disabled={add.isPending}>
                  <PlusIcon size={12} /> {add.isPending ? "Saving…" : "Record rate"}
                </button>
              </form>
            </Card>
          ) : null}
          <Card>
            <CardHead icon={HistoryIcon} title="Recent entries" sub={comp.data ? `${comp.data.entries.length} in the last ${days} days` : undefined} />
            {!comp.data?.entries.length ? (
              <p className="px-4 py-5 text-center text-[12px] text-ink-4">No entries yet.</p>
            ) : (
              <ul className="max-h-[360px] divide-y divide-ink/[0.05] overflow-y-auto scrollbar-thin">
                {comp.data.entries.map((e) => (
                  <li key={e.id} className="flex items-center gap-2.5 px-4 py-2">
                    <span className={cn("flex h-6 min-w-[36px] items-center justify-center rounded-md px-1 text-[10.5px] font-bold", karatTone(e.permille / 1000).badge)}>{e.karat}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-semibold text-ink">
                        {e.shop}
                        {e.area ? <span className="font-normal text-ink-4"> · {e.area}</span> : null}
                      </div>
                      <div className="truncate text-[10.5px] text-ink-5">
                        {e.side === "SELL" ? "sells" : "buys"} · {when(e.observedAt)}
                        {e.by ? ` · ${e.by}` : ""}
                        {e.notes ? ` · ${e.notes}` : ""}
                      </div>
                    </div>
                    <span className="g-metric text-[12.5px] font-semibold text-ink">{lkr(e.ratePerG)}</span>
                    {canDelete ? (
                      <button
                        aria-label="Delete entry"
                        onClick={() => confirm(`Delete ${e.shop}'s ${e.karat} rate?`) && del.mutate(e.id)}
                        className="flex size-6 items-center justify-center rounded-md text-ink-5 hover:bg-rose-500/10 hover:text-rose-700"
                      >
                        <TrashIcon size={12} />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {!canAdd ? <p className={cn(btnSoft, "pointer-events-none w-full justify-center")}>Recording rates needs masters:create</p> : null}
        </div>
      </div>
    </div>
  );
}
