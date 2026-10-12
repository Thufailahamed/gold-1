"use client";

// Price series for the board's charts. Our own snapshots are exact spot
// prices but only go back as far as the feed has been running; when they
// don't cover the range, the long history from Yahoo Finance (adjusted to
// end on spot) fills in. Either way every point has the same shape.
import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type SeriesPoint = { t: number; priceUsd: number; priceLkr: number; lkrPerGram: number | null };
export type Series = { symbol: string; name: string; unit: "oz" | "lb" | "coin"; points: SeriesPoint[]; source?: "yahoo"; basisAdjustPct?: number };
export type SeriesRange = "1d" | "7d" | "30d" | "1y";

export const RANGE_MS: Record<SeriesRange, number> = { "1d": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, "1y": 365 * 86_400_000 };

/** Snapshots count as covering a range once they reach back 85% of it. */
export function covers(points: SeriesPoint[] | undefined, range: SeriesRange, now = Date.now()) {
  return !!points && points.length >= 2 && points[0]!.t <= now - RANGE_MS[range] * 0.85;
}

const snapQuery = (symbol: string, range: SeriesRange) => ({
  queryKey: ["market-history", symbol, range],
  queryFn: () => api<Series>(`/api/v1/market/history?symbol=${symbol}&range=${range}`),
  staleTime: 60_000,
  refetchInterval: 5 * 60_000,
});
const longQuery = (symbol: string, range: SeriesRange, enabled: boolean) => ({
  queryKey: ["market-long", symbol, range],
  queryFn: () => api<Series>(`/api/v1/market/long-history?symbol=${symbol}&range=${range}`),
  enabled,
  staleTime: range === "1d" ? 60_000 : 10 * 60_000,
  refetchInterval: (range === "1d" ? 5 * 60_000 : false) as number | false,
  retry: 1,
});

function pick(snap: Series | undefined, long: Series | undefined, range: SeriesRange) {
  if (covers(snap?.points, range)) return { data: snap, source: "snapshots" as const };
  if ((long?.points.length ?? 0) >= 2) return { data: long, source: "yahoo" as const };
  return { data: snap, source: "snapshots" as const };
}

export function useMarketSeries(symbol: string, range: SeriesRange) {
  const snaps = useQuery(snapQuery(symbol, range));
  const need = snaps.isFetched && !covers(snaps.data?.points, range);
  const long = useQuery(longQuery(symbol, range, need));
  const chosen = pick(snaps.data, long.data, range);
  return {
    ...chosen,
    basisAdjustPct: chosen.source === "yahoo" ? (long.data?.basisAdjustPct ?? null) : null,
    isLoading: snaps.isLoading || (need && long.isLoading),
  };
}

/** The last day for several markets at once (hero sparklines, hover cards). */
export function useDaySeries(symbols: string[]) {
  const snaps = useQueries({ queries: symbols.map((s) => snapQuery(s, "1d")) });
  const longs = useQueries({
    queries: symbols.map((s, i) => longQuery(s, "1d", !!snaps[i]?.isFetched && !covers(snaps[i]?.data?.points, "1d"))),
  });
  return symbols.map((_, i) => pick(snaps[i]?.data, longs[i]?.data, "1d"));
}
