"use client";

// Shop TV / counter display: today's board in large type, a clock, world
// prices and (optionally) Gulf-currency prices. Refreshes itself every
// minute and keeps the screen awake. Open it from Live Rates → Share on a
// browser signed in as any staff member who can see rates.
//   /display?unit=pawn|g|both&ccy=AED,SAR&market=0
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, errorCode } from "@/lib/api";
import { cn } from "@/lib/cn";
import { MarketIcon } from "@/components/market-icons";

type Rate = { purity_id: string; karat: string; rate_per_gram: number; effective_from: number };
type Live = {
  usdLkr: number;
  rates: Record<string, number>;
  karats: { purityId: string; purity: number }[];
  quotes: { symbol: string; name: string; priceUsd: number; change24hPct: number | null }[];
};

const REFRESH_MS = 60_000;
const fmt = (n: number, dp = 0) => n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

function pillGradient(p: number) {
  if (p >= 0.99) return "from-[#F3DB9B] to-[#B8923F]";
  if (p >= 0.9) return "from-amber-300 to-amber-600";
  if (p >= 0.85) return "from-orange-300 to-orange-600";
  return "from-rose-300 to-rose-600";
}

export default function DisplayPage() {
  const [board, setBoard] = useState<Rate[] | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [shop, setShop] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [state, setState] = useState<"loading" | "ok" | "signin" | "error">("loading");
  const [opts, setOpts] = useState<{ unit: "both" | "g" | "pawn"; ccy: string[]; market: boolean }>({ unit: "both", ccy: [], market: true });

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const unit = q.get("unit");
    setOpts({
      unit: unit === "g" || unit === "pawn" ? unit : "both",
      ccy: (q.get("ccy") ?? "").split(",").map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c)).slice(0, 6),
      market: q.get("market") !== "0",
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const [b, l, s] = await Promise.all([
        api<Rate[]>("/api/v1/gold-rates/current"),
        api<Live>("/api/v1/market/live").catch(() => null),
        api<{ shopName: string }>("/api/v1/market-desk/settings").catch(() => null),
      ]);
      setBoard(b);
      if (l) setLive(l);
      if (s) setShop(s.shopName);
      setState("ok");
    } catch (e) {
      setState(errorCode(e) === "UNAUTHORIZED" || errorCode(e) === "FORBIDDEN" ? "signin" : "error");
    }
  }, []);

  useEffect(() => {
    load();
    const a = setInterval(load, REFRESH_MS);
    const b = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [load]);

  // Keep a TV from sleeping while this page is open (where supported).
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const req = async () => {
      try {
        lock = await (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null;
      } catch {
        /* not allowed: fine */
      }
    };
    req();
    const onVis = () => document.visibilityState === "visible" && req();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => undefined);
    };
  }, []);

  const purity = new Map((live?.karats ?? []).map((k) => [k.purityId, k.purity]));
  const rows = [...(board ?? [])].sort((a, b) => b.rate_per_gram - a.rate_per_gram);
  const lkrPer = (code: string) => (live?.rates[code] && live.rates.LKR ? live.rates.LKR / live.rates[code]! : null);
  const updated = rows.length ? Math.max(...rows.map((r) => r.effective_from)) : null;
  const showG = opts.unit !== "pawn";
  const showP = opts.unit !== "g";

  if (state === "signin")
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-void text-paper">
        <p className="text-xl">Sign in to show the rate board.</p>
        <Link href="/login" className="rounded-xl bg-gold px-5 py-2.5 font-semibold text-void">
          Sign in
        </Link>
      </main>
    );

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-[#021b15] text-paper">
      <div className="pointer-events-none absolute -right-40 -top-56 size-[720px] rounded-full bg-gold/[0.18] blur-[160px]" />
      <div className="pointer-events-none absolute -bottom-60 -left-40 size-[620px] rounded-full bg-emerald-500/10 blur-[160px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" />

      {/* header */}
      <header className="relative flex items-end justify-between gap-6 px-[4vw] pt-[3.5vh]">
        <div className="min-w-0">
          <h1 className="truncate font-display text-[clamp(32px,4.6vw,96px)] font-semibold leading-none text-transparent [background:linear-gradient(90deg,#B8923F,#F3DB9B,#B8923F)] [-webkit-background-clip:text] [background-clip:text]">
            {shop || "Today's Gold Rates"}
          </h1>
          <p className="mt-[1vh] text-[clamp(14px,1.5vw,30px)] text-paper/60">{shop ? "Today's gold rates" : ""}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="g-metric text-[clamp(28px,4vw,84px)] font-semibold leading-none">
            {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div className="mt-[0.8vh] text-[clamp(12px,1.3vw,26px)] text-paper/55">
            {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </div>
        </div>
      </header>

      {/* board */}
      <section className="relative flex flex-1 flex-col justify-center px-[4vw] py-[3vh]">
        {state === "loading" ? (
          <p className="text-center text-2xl text-paper/50">Loading rates…</p>
        ) : !rows.length ? (
          <p className="text-center text-2xl text-paper/50">No board rates published yet.</p>
        ) : (
          <>
            <div className="mb-[1.5vh] grid grid-cols-[1fr_auto_auto] gap-x-[5vw] border-b border-gold/30 pb-[1vh] text-[clamp(12px,1.25vw,26px)] font-semibold uppercase tracking-[0.18em] text-gold-light/80">
              <span>Karat</span>
              {showG ? <span className="text-right">Per gram</span> : <span />}
              {showP ? <span className="text-right">Per pawn (8 g)</span> : <span />}
            </div>
            <div className="flex flex-col gap-[1.6vh]">
              {rows.map((r) => {
                const p = purity.get(r.purity_id) ?? 0.9;
                return (
                  <div key={r.purity_id} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-[5vw] border-b border-paper/[0.07] pb-[1.6vh]">
                    <span
                      className={cn(
                        "inline-flex w-fit items-center justify-center rounded-[1.2vw] bg-gradient-to-b px-[1.6vw] py-[0.6vh] text-[clamp(22px,3.2vw,68px)] font-extrabold text-[#062a22] shadow-[inset_0_2px_0_rgba(255,255,255,0.5)]",
                        pillGradient(p)
                      )}
                    >
                      {r.karat}
                    </span>
                    <span className={cn("g-metric text-right text-[clamp(30px,5vw,112px)] font-semibold leading-none", !showG && "invisible")}>{fmt(r.rate_per_gram)}</span>
                    <span
                      className={cn(
                        "g-metric text-right text-[clamp(30px,5vw,112px)] font-semibold leading-none",
                        showG ? "text-gold-light" : "text-paper",
                        !showP && "invisible"
                      )}
                    >
                      {fmt(r.rate_per_gram * 8)}
                    </span>
                  </div>
                );
              })}
            </div>
            {opts.ccy.length && rows[0] ? (
              <div className="mt-[3vh] flex flex-wrap items-baseline gap-x-[3vw] gap-y-[1vh] text-[clamp(14px,1.8vw,38px)]">
                <span className="text-paper/50">{rows[0].karat} per pawn:</span>
                {opts.ccy.map((c) => {
                  const per = lkrPer(c);
                  return per ? (
                    <span key={c} className="g-metric font-semibold">
                      <span className="text-gold-light/80">{c}</span> {fmt((rows[0]!.rate_per_gram * 8) / per, (rows[0]!.rate_per_gram * 8) / per > 1000 ? 0 : 1)}
                    </span>
                  ) : null;
                })}
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* footer: world prices */}
      <footer className="relative flex flex-wrap items-center justify-between gap-4 border-t border-paper/10 bg-black/20 px-[4vw] py-[2vh] text-[clamp(12px,1.25vw,26px)]">
        {opts.market && live ? (
          <div className="flex flex-wrap items-center gap-x-[2.5vw] gap-y-2">
            {live.quotes
              .filter((q) => ["XAU", "XAG", "XPT"].includes(q.symbol))
              .map((q) => (
                <span key={q.symbol} className="flex items-center gap-2">
                  <MarketIcon symbol={q.symbol} size={28} />
                  <span className="text-paper/60">{q.name}</span>
                  <span className="g-metric font-semibold">${fmt(q.priceUsd, 2)}</span>
                  {q.change24hPct != null ? (
                    <span className={cn("g-metric font-semibold", q.change24hPct >= 0 ? "text-emerald-300" : "text-rose-300")}>
                      {q.change24hPct >= 0 ? "▲" : "▼"} {Math.abs(q.change24hPct).toFixed(2)}%
                    </span>
                  ) : null}
                </span>
              ))}
            <span className="text-paper/50">
              USD/LKR <span className="g-metric text-paper/80">{live.usdLkr.toFixed(2)}</span>
            </span>
          </div>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3 text-paper/45">
          {state === "error" ? <span className="text-amber-300">Connection lost — showing last rates</span> : null}
          {updated ? <span>Board updated {new Date(updated).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> : null}
          <button
            onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)}
            className="rounded-lg border border-paper/15 px-3 py-1 text-[0.8em] text-paper/60 hover:bg-paper/10"
          >
            Full screen
          </button>
        </div>
      </footer>
    </main>
  );
}
