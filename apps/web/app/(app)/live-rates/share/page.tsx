"use client";

// Share today's board: a rate-card image for WhatsApp / Facebook, the same
// as plain text, board prices in Gulf currencies, and the shop TV display.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Card, CardHead, Empty, GoldHero, RowsSkeleton } from "@/components/console-kit";
import { CopyIcon, FileDownIcon, LayersIcon, SendIcon } from "@/components/icons";
import { CountryFlag } from "@/components/market-icons";
import { karatTone } from "../parts";
import { DeskTabs, NumInput, btnDark, btnSoft, fieldCls, lkr, num, when } from "../desk-kit";

type Rate = { purity_id: string; karat: string; rate_per_gram: number; effective_from: number };
type Live = {
  usdLkr: number;
  rates: Record<string, number>;
  karats: { purityId: string; karat: string; purity: number; lkrPerGram: number }[];
  quotes: { symbol: string; priceUsd: number }[];
};
type Desk = { shopName: string };

const GULF = ["AED", "SAR", "QAR", "KWD", "OMR", "BHD"];
const EXTRA = ["USD", "GBP", "EUR", "INR", "AUD", "CAD"];
const SIZES = { square: { w: 1080, h: 1080, label: "Square (post)" }, story: { w: 1080, h: 1920, label: "Story / status" } } as const;
type Size = keyof typeof SIZES;

/* ---------------------------------------------------------------- card art */

function drawCard(
  cv: HTMLCanvasElement,
  o: { size: Size; shop: string; rows: { karat: string; perG: number; perPawn: number; purity: number }[]; unit: "both" | "g" | "pawn"; date: Date; spot: number | null; footer: string; extra: { code: string; perPawn: number }[] }
) {
  const { w, h } = SIZES[o.size];
  cv.width = w;
  cv.height = h;
  const c = cv.getContext("2d")!;
  // background: deep emerald with a gold glow
  const bg = c.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#073a2f");
  bg.addColorStop(1, "#021b15");
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  const glow = c.createRadialGradient(w * 0.85, h * 0.08, 10, w * 0.85, h * 0.08, w * 0.7);
  glow.addColorStop(0, "rgba(226,194,122,0.35)");
  glow.addColorStop(1, "rgba(226,194,122,0)");
  c.fillStyle = glow;
  c.fillRect(0, 0, w, h);
  // frame
  c.strokeStyle = "rgba(226,194,122,0.55)";
  c.lineWidth = 3;
  c.strokeRect(36, 36, w - 72, h - 72);
  c.strokeStyle = "rgba(226,194,122,0.18)";
  c.lineWidth = 1;
  c.strokeRect(50, 50, w - 100, h - 100);

  const gold = c.createLinearGradient(0, 0, w, 0);
  gold.addColorStop(0, "#B8923F");
  gold.addColorStop(0.5, "#F3DB9B");
  gold.addColorStop(1, "#B8923F");

  const story = o.size === "story";
  let y = story ? 230 : 150;
  c.textAlign = "center";
  c.fillStyle = gold;
  c.font = `700 ${story ? 74 : 64}px Georgia, 'Times New Roman', serif`;
  c.fillText(o.shop || "Today's Gold Rates", w / 2, y, w - 160);
  y += story ? 70 : 58;
  c.fillStyle = "rgba(245,240,228,0.75)";
  c.font = `500 ${story ? 34 : 30}px system-ui, -apple-system, Segoe UI, sans-serif`;
  c.fillText(o.shop ? "Today's Gold Rates" : "", w / 2, y);
  y += story ? 54 : 46;
  c.fillStyle = "rgba(245,240,228,0.55)";
  c.font = `500 ${story ? 30 : 26}px system-ui, -apple-system, Segoe UI, sans-serif`;
  c.fillText(o.date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + " · " + o.date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), w / 2, y);

  // column heads
  y += story ? 110 : 80;
  const left = 110;
  const right = w - 110;
  const showG = o.unit !== "pawn";
  const showP = o.unit !== "g";
  const colG = showP ? w * 0.6 : right;
  c.font = `700 ${story ? 26 : 22}px system-ui, -apple-system, Segoe UI, sans-serif`;
  c.fillStyle = "rgba(226,194,122,0.8)";
  c.textAlign = "left";
  c.fillText("KARAT", left, y);
  c.textAlign = "right";
  if (showG) c.fillText("PER GRAM (Rs)", colG, y);
  if (showP) c.fillText("PER PAWN 8g (Rs)", right, y);
  y += 22;
  c.fillStyle = "rgba(226,194,122,0.35)";
  c.fillRect(left, y, right - left, 2);

  const n = Math.max(1, o.rows.length);
  const avail = (story ? h - 560 : h - 420) - y - (o.extra.length ? (story ? 260 : 150) : 0);
  const rowH = Math.min(story ? 170 : 120, avail / n);
  const big = Math.min(story ? 72 : 60, rowH * 0.5);
  for (const r of o.rows) {
    const cy = y + rowH / 2 + 8;
    // karat pill
    const pillW = big * 2.1;
    const pillH = big * 1.15;
    const pg = c.createLinearGradient(left, cy - pillH / 2, left, cy + pillH / 2);
    pg.addColorStop(0, r.purity >= 0.99 ? "#F3DB9B" : r.purity >= 0.9 ? "#FCD34D" : r.purity >= 0.85 ? "#FDBA74" : "#FDA4AF");
    pg.addColorStop(1, r.purity >= 0.99 ? "#B8923F" : r.purity >= 0.9 ? "#D97706" : r.purity >= 0.85 ? "#EA580C" : "#E11D48");
    c.fillStyle = pg;
    c.beginPath();
    c.roundRect(left, cy - pillH / 2, pillW, pillH, 14);
    c.fill();
    c.fillStyle = "#062a22";
    c.textAlign = "center";
    c.font = `800 ${big * 0.62}px system-ui, -apple-system, Segoe UI, sans-serif`;
    c.fillText(r.karat, left + pillW / 2, cy + big * 0.22);
    // figures
    c.textAlign = "right";
    c.fillStyle = "#F5F0E4";
    c.font = `700 ${big}px system-ui, -apple-system, Segoe UI, sans-serif`;
    if (showG) c.fillText(lkr(r.perG, 0), colG, cy + big * 0.35);
    if (showP) {
      c.fillStyle = showG ? gold : "#F5F0E4";
      c.fillText(lkr(r.perPawn, 0), right, cy + big * 0.35);
    }
    y += rowH;
    c.fillStyle = "rgba(245,240,228,0.08)";
    c.fillRect(left, y + 8, right - left, 1);
  }

  if (o.extra.length) {
    y += story ? 80 : 50;
    c.textAlign = "center";
    c.fillStyle = "rgba(226,194,122,0.8)";
    c.font = `700 ${story ? 26 : 21}px system-ui, -apple-system, Segoe UI, sans-serif`;
    c.fillText(`${o.rows[0]?.karat ?? ""} PER PAWN IN`, w / 2, y);
    y += story ? 60 : 44;
    const per = story ? 2 : 3;
    const cellW = (right - left) / per;
    o.extra.slice(0, story ? 6 : 6).forEach((e, i) => {
      const cx = left + cellW * (i % per) + cellW / 2;
      const ry = y + Math.floor(i / per) * (story ? 70 : 48);
      c.fillStyle = "#F5F0E4";
      c.font = `700 ${story ? 36 : 28}px system-ui, -apple-system, Segoe UI, sans-serif`;
      c.fillText(`${e.code} ${e.perPawn.toLocaleString("en-US", { maximumFractionDigits: e.perPawn > 1000 ? 0 : 1 })}`, cx, ry);
    });
  }

  // footer
  c.textAlign = "center";
  c.fillStyle = "rgba(245,240,228,0.5)";
  c.font = `500 ${story ? 26 : 22}px system-ui, -apple-system, Segoe UI, sans-serif`;
  if (o.spot) c.fillText(`World gold $${lkr(o.spot, 2)}/oz`, w / 2, h - (story ? 170 : 120));
  c.fillStyle = "rgba(245,240,228,0.4)";
  c.font = `400 ${story ? 22 : 19}px system-ui, -apple-system, Segoe UI, sans-serif`;
  c.fillText(o.footer, w / 2, h - (story ? 130 : 86), w - 160);
}

/* ---------------------------------------------------------------- page */

export default function SharePage() {
  const board = useQuery({ queryKey: ["gold-rates-current"], queryFn: () => api<Rate[]>("/api/v1/gold-rates/current") });
  const live = useQuery({ queryKey: ["market-live"], queryFn: () => api<Live>("/api/v1/market/live"), refetchInterval: 60_000 });
  const desk = useQuery({ queryKey: ["desk-settings"], queryFn: () => api<Desk>("/api/v1/market-desk/settings") });

  const [size, setSize] = useState<Size>("square");
  const [unit, setUnit] = useState<"both" | "g" | "pawn">("both");
  const [shop, setShop] = useState("");
  const [footer, setFooter] = useState("Rates change with the market · prices exclude making charges");
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [withGulf, setWithGulf] = useState(false);
  const [ccys, setCcys] = useState<string[]>(GULF);
  const [weight, setWeight] = useState("8");
  const cv = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (desk.data && !shop) setShop(desk.data.shopName);
  }, [desk.data, shop]);

  const purity = useMemo(() => new Map((live.data?.karats ?? []).map((k) => [k.purityId, k.purity])), [live.data]);
  const all = useMemo(
    () =>
      [...(board.data ?? [])]
        .map((r) => ({ id: r.purity_id, karat: r.karat, perG: r.rate_per_gram, perPawn: r.rate_per_gram * 8, purity: purity.get(r.purity_id) ?? 0, at: r.effective_from }))
        .sort((a, b) => b.perG - a.perG),
    [board.data, purity]
  );
  const rows = all.filter((r) => !hidden[r.id]);
  const lkrPer = (code: string) => (live.data?.rates[code] && live.data.rates.LKR ? live.data.rates.LKR / live.data.rates[code]! : null);
  const spot = live.data?.quotes.find((q) => q.symbol === "XAU")?.priceUsd ?? null;
  const top = rows[0];
  const extra = withGulf && top ? ccys.map((code) => ({ code, perPawn: lkrPer(code) ? top.perPawn / lkrPer(code)! : 0 })).filter((e) => e.perPawn > 0) : [];

  useEffect(() => {
    if (!cv.current || !rows.length) return;
    drawCard(cv.current, { size, shop, rows, unit, date: new Date(), spot, footer, extra });
  }, [size, shop, rows, unit, spot, footer, extra]);

  const blob = () => new Promise<Blob | null>((res) => cv.current?.toBlob(res, "image/png"));
  const fileName = `gold-rates-${new Date().toISOString().slice(0, 10)}.png`;
  const download = async () => {
    const b = await blob();
    if (!b) return;
    const url = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };
  const share = async () => {
    const b = await blob();
    if (!b) return;
    const file = new File([b], fileName, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Today's gold rates", text: text });
      } catch {
        /* cancelled */
      }
    } else {
      await download();
      toast.message("Image downloaded", { description: "This browser can't share images directly — attach the downloaded file." });
    }
  };

  const text = useMemo(() => {
    const d = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const lines = [`*${shop || "Gold rates"}* — ${d}`, ""];
    for (const r of rows) {
      const parts = [];
      if (unit !== "pawn") parts.push(`Rs ${lkr(r.perG, 0)}/g`);
      if (unit !== "g") parts.push(`Rs ${lkr(r.perPawn, 0)}/pawn`);
      lines.push(`*${r.karat}*  ${parts.join("  ·  ")}`);
    }
    if (extra.length && top) {
      lines.push("", `${top.karat} per pawn: ${extra.map((e) => `${e.code} ${e.perPawn.toLocaleString("en-US", { maximumFractionDigits: e.perPawn > 1000 ? 0 : 1 })}`).join(" · ")}`);
    }
    if (footer) lines.push("", `_${footer}_`);
    return lines.join("\n");
  }, [shop, rows, unit, extra, top, footer]);

  const w = num(weight);
  const loading = board.isLoading || live.isLoading;

  return (
    <div className="space-y-3">
      <GoldHero
        icon={SendIcon}
        title="Share"
        accent="rates"
        back={{ href: "/live-rates", label: "Live rates" }}
        sub={all[0] ? `Board last published ${when(Math.max(...all.map((r) => r.at)))}` : "Post today's board, put it on a TV, or quote in Gulf currencies"}
        actions={
          <Link href={`/display?unit=${unit}${withGulf && ccys.length ? `&ccy=${ccys.join(",")}` : ""}`} target="_blank" className="home-btn-gold h-8 px-3.5 text-[12.5px]">
            Open TV display ↗
          </Link>
        }
        stats={[
          { label: "Karats on board", value: board.data ? all.length : undefined, loading },
          { label: `${all[0]?.karat ?? "Top"} / gram`, value: all[0]?.perG ?? null, format: (n) => lkr(n), accent: true, loading },
          { label: `${all[0]?.karat ?? "Top"} / pawn`, value: all[0]?.perPawn ?? null, format: (n) => lkr(n), loading },
          { label: "AED / pawn", value: all[0] && lkrPer("AED") ? all[0].perPawn / lkrPer("AED")! : null, format: (n) => lkr(n, 0), loading },
          { label: "SAR / pawn", value: all[0] && lkrPer("SAR") ? all[0].perPawn / lkrPer("SAR")! : null, format: (n) => lkr(n, 0), loading },
          { label: "World gold", value: spot, format: (n) => `$${lkr(n, 2)}`, unit: "/oz", loading },
        ]}
      >
        <DeskTabs />
      </GoldHero>

      {!loading && !all.length ? (
        <Card>
          <Empty icon={LayersIcon} title="No board rates published" desc="Publish rates on Gold rates or the Pricing desk first; the card uses your published board." />
        </Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* ---------------- rate card */}
          <Card>
            <CardHead
              icon={SendIcon}
              title="Rate card"
              sub="From your published board · download or share"
              action={
                <>
                  <button className={btnSoft} onClick={download} disabled={!rows.length}>
                    <FileDownIcon size={12} /> PNG
                  </button>
                  <button className={btnDark} onClick={share} disabled={!rows.length}>
                    <SendIcon size={12} /> Share
                  </button>
                </>
              }
            />
            <div className="grid gap-3 border-b border-ink/[0.06] p-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-5">Shop name</span>
                <input value={shop} onChange={(e) => setShop(e.target.value)} maxLength={40} className={fieldCls} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-5">Format</span>
                <select value={size} onChange={(e) => setSize(e.target.value as Size)} className={fieldCls}>
                  {Object.entries(SIZES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-5">Show</span>
                <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)} className={fieldCls}>
                  <option value="both">Per gram & per pawn</option>
                  <option value="g">Per gram only</option>
                  <option value="pawn">Per pawn only</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-5">Footer line</span>
                <input value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={90} className={fieldCls} />
              </label>
              <div className="sm:col-span-2">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-5">Karats</span>
                <div className="flex flex-wrap gap-1">
                  {all.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setHidden({ ...hidden, [r.id]: !hidden[r.id] })}
                      className={cn("h-7 rounded-md px-2.5 text-[11.5px] font-bold transition-all", hidden[r.id] ? "bg-ink/[0.05] text-ink-5 line-through" : karatTone(r.purity).badge)}
                    >
                      {r.karat}
                    </button>
                  ))}
                  <label className="ml-auto flex items-center gap-1.5 text-[11.5px] text-ink-3">
                    <input type="checkbox" checked={withGulf} onChange={(e) => setWithGulf(e.target.checked)} className="size-4 accent-[#062a22]" />
                    Add Gulf prices
                  </label>
                </div>
              </div>
            </div>
            <div className="flex justify-center bg-bone/50 p-4">
              <canvas ref={cv} className={cn("h-auto rounded-lg shadow-[0_20px_40px_-20px_rgba(6,42,34,0.6)]", size === "story" ? "w-[46%]" : "w-[82%]")} />
            </div>
            <div className="border-t border-ink/[0.06] p-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-5">WhatsApp text</span>
                <button
                  className={cn(btnSoft, "h-7 text-[11px]")}
                  onClick={() => navigator.clipboard?.writeText(text).then(() => toast.success("Copied — paste into WhatsApp"))}
                >
                  <CopyIcon size={11} /> Copy
                </button>
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-bone/70 px-3 py-2 font-sans text-[12px] leading-relaxed text-ink-2 scrollbar-thin">{text}</pre>
            </div>
          </Card>

          {/* ---------------- Gulf & world board */}
          <Card>
            <CardHead icon={LayersIcon} title="Board in other currencies" sub={live.data ? `Converted at today's rates · 1 USD = Rs ${live.data.usdLkr.toFixed(2)}` : "For customers paying from abroad"} />
            <div className="flex flex-wrap items-center gap-1 border-b border-ink/[0.06] px-4 py-2.5">
              {[...GULF, ...EXTRA].map((code) => {
                const on = ccys.includes(code);
                return (
                  <button
                    key={code}
                    onClick={() => setCcys(on ? ccys.filter((c) => c !== code) : [...ccys, code])}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-full pl-1 pr-2.5 text-[11px] font-semibold transition-colors",
                      on ? "bg-void text-gold-light" : "text-ink-3 ring-1 ring-inset ring-ink/10 hover:bg-bone"
                    )}
                  >
                    <CountryFlag code={code} size={18} />
                    {code}
                  </button>
                );
              })}
            </div>
            {loading ? (
              <RowsSkeleton rows={5} />
            ) : (
              <>
                <div className="overflow-x-auto scrollbar-thin">
                  <table className="w-full text-[12px]">
                    <thead className="bg-bone/60 text-left">
                      <tr className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-ink-5">
                        <th className="py-1.5 pl-4 pr-2">Currency</th>
                        <th className="px-2 text-right">Rs per unit</th>
                        {rows.slice(0, 4).map((r) => (
                          <th key={r.id} className="px-2 text-right">
                            {r.karat} / pawn
                          </th>
                        ))}
                        <th className="px-2 pr-4 text-right">{rows[0]?.karat} / g</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ccys.map((code) => {
                        const per = lkrPer(code);
                        return (
                          <tr key={code} className="border-t border-ink/[0.05] hover:bg-gold-pale/30">
                            <td className="py-1.5 pl-4 pr-2">
                              <span className="flex items-center gap-2 font-semibold text-ink">
                                <CountryFlag code={code} size={18} />
                                {code}
                              </span>
                            </td>
                            <td className="g-metric px-2 text-right text-ink-4">{per ? per.toFixed(2) : "—"}</td>
                            {rows.slice(0, 4).map((r) => (
                              <td key={r.id} className="g-metric px-2 text-right font-semibold text-ink">
                                {per ? lkr(r.perPawn / per, r.perPawn / per > 1000 ? 0 : 2) : "—"}
                              </td>
                            ))}
                            <td className="g-metric px-2 pr-4 text-right text-ink-3">{per && rows[0] ? lkr(rows[0].perG / per, 2) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* quick quote */}
                <div className="border-t border-ink/[0.06] p-4">
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
                    Quote
                    <NumInput value={weight} onChange={setWeight} suffix="g" className="w-24" />
                    of {rows[0]?.karat ?? "gold"} (metal only):
                    <b className="g-metric text-[14px] text-ink">Rs {top ? lkr(top.perG * w) : "—"}</b>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {ccys.map((code) => {
                      const per = lkrPer(code);
                      return (
                        <div key={code} className="flex items-center justify-between rounded-lg bg-bone/60 px-2.5 py-1.5">
                          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-3">
                            <CountryFlag code={code} size={16} />
                            {code}
                          </span>
                          <span className="g-metric text-[12.5px] font-semibold text-ink">{per && top ? lkr((top.perG * w) / per, 2) : "—"}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[10.5px] text-ink-5">Mid-market exchange rates; a bank or exchange house will quote slightly differently.</p>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
