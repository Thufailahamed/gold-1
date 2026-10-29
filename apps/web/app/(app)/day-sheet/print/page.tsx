"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Page, Skeleton } from "@/components/ui";
import { GoldHero, heroGhost, heroGold } from "@/components/console-kit";
import { FileTextIcon, PrinterIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { businessToday } from "@/lib/busclock";
import { PRINT_ROWS, systemAsSheetLine, type DaySheetView } from "@/lib/daysheet";

/**
 * The paper day sheet. Every choice here serves two readers: the person
 * writing at the counter, and the AI that reads the photo afterwards.
 * Hard black rules, numbered lines, one box per column, the date in boxes
 * and the column meaning printed in every header — so a photo taken at an
 * angle still reads line for line.
 */

type Line = ReturnType<typeof systemAsSheetLine> | null;

const COLS = [
  { key: "no", label: "#", sub: "", w: "7mm" },
  { key: "ref", label: "Bill No", sub: "①", w: "21mm" },
  { key: "who", label: "Customer name · phone · details", sub: "①", w: "61mm" },
  { key: "gold", label: "Gold weight", sub: "② grams", w: "20mm" },
  { key: "rec", label: "Amount received", sub: "③ Rs", w: "28mm" },
  { key: "giv", label: "Amount given", sub: "④ Rs", w: "28mm" },
  { key: "old", label: "Old gold amount", sub: "⑤ Rs", w: "28mm" },
] as const;

const RULE = "1px solid #111";
const HAIR = "0.6px solid #555";

function DateBoxes({ date }: { date: string | null }) {
  const [y, m, d] = date ? date.split("-") : ["", "", ""];
  const box = (ch: string, k: string) => (
    <span key={k} style={{ display: "inline-flex", width: "5.2mm", height: "6.4mm", border: RULE, alignItems: "center", justifyContent: "center", fontSize: "11pt", fontWeight: 700, marginLeft: "-1px" }}>
      {ch}
    </span>
  );
  const group = (s: string, n: number, k: string) => (
    <span style={{ display: "inline-flex" }}>{Array.from({ length: n }, (_, i) => box(s[i] ?? "", `${k}${i}`))}</span>
  );
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "1.5mm" }}>
      {group(d ?? "", 2, "d")}
      <b>/</b>
      {group(m ?? "", 2, "m")}
      <b>/</b>
      {group(y ?? "", 4, "y")}
    </span>
  );
}

function SheetPage({
  shop,
  branch,
  branchCode,
  date,
  page,
  pages,
  lines,
  startNo,
  totals,
}: {
  shop: string;
  branch: string;
  branchCode: string;
  date: string | null;
  page: number;
  pages: number;
  lines: Line[];
  startNo: number;
  totals: { rec: string; giv: string; old: string } | null;
}) {
  const code = `DS-${branchCode || "BR"}-${date ? date.replace(/-/g, "") : "________"}`;
  return (
    <div
      className="day-sheet-page"
      style={{ width: "194mm", minHeight: "279mm", padding: 0, color: "#000", background: "#fff", fontFamily: "Arial, Helvetica, sans-serif", fontSize: "9pt", boxSizing: "border-box" }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "2px solid #000", paddingBottom: "2mm" }}>
        <div>
          <div style={{ fontSize: "8pt", letterSpacing: "0.2em", textTransform: "uppercase" }}>{shop}</div>
          <div style={{ fontSize: "18pt", fontWeight: 800, letterSpacing: "0.04em" }}>DAY SHEET</div>
          <div style={{ fontSize: "9pt", marginTop: "0.5mm" }}>
            Branch: <b>{branch || "______________________"}</b>
          </div>
        </div>
        <div style={{ textAlign: "right", lineHeight: 1.9 }}>
          <div>
            Date&nbsp; <DateBoxes date={date} />
          </div>
          <div>
            Page <b style={{ display: "inline-block", minWidth: "7mm", borderBottom: RULE, textAlign: "center" }}>{page}</b> of{" "}
            <b style={{ display: "inline-block", minWidth: "7mm", borderBottom: RULE, textAlign: "center" }}>{pages || ""}</b>
            <span style={{ marginLeft: "4mm", fontFamily: "monospace", fontSize: "10pt", fontWeight: 700, border: RULE, padding: "0.5mm 1.5mm" }}>{code}</span>
          </div>
        </div>
      </div>

      {/* How to write it */}
      <div style={{ fontSize: "7.4pt", lineHeight: 1.35, padding: "1.5mm 0", borderBottom: HAIR }}>
        <b>One transaction per numbered line.</b> Amounts in rupees (58000). Gold in grams (8.450). After an amount write{" "}
        <b>(B)</b> bank · <b>(C)</b> card · <b>(Q)</b> cheque · <b>(CR)</b> credit — nothing means cash. Wrong value: strike it out with one line and write the
        right one beside it. Keep writing inside the boxes.
      </div>

      {/* The table */}
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: "2mm", border: "2px solid #000" }}>
        <colgroup>
          {COLS.map((c) => (
            <col key={c.key} style={{ width: c.w }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLS.map((c) => (
              <th
                key={c.key}
                style={{ border: RULE, borderBottom: "2px solid #000", padding: "1mm", fontSize: "7.6pt", fontWeight: 800, textAlign: "center", verticalAlign: "bottom", background: "#e9e9e9", lineHeight: 1.15 }}
              >
                {c.sub ? <div style={{ fontSize: "8.5pt" }}>{c.sub}</div> : null}
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} style={{ height: "8.2mm", background: i % 2 ? "#f3f3f3" : "#fff" }}>
              <td style={{ border: RULE, textAlign: "center", fontWeight: 700, fontSize: "8pt" }}>{startNo + i}</td>
              <td style={{ border: HAIR, borderRight: RULE, padding: "0 1mm", fontSize: "8pt", overflow: "hidden", whiteSpace: "nowrap" }}>{l?.refNo ?? ""}</td>
              <td style={{ border: HAIR, borderLeft: "none", padding: "0 1mm", fontSize: "7.6pt", lineHeight: 1.15, overflow: "hidden" }}>
                {l ? (
                  <>
                    <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.who}</div>
                    <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.details}</div>
                  </>
                ) : null}
              </td>
              <td style={{ border: RULE, padding: "0 1mm", textAlign: "right", fontSize: "8.5pt" }}>{l?.gold ?? ""}</td>
              <td style={{ border: RULE, padding: "0 1mm", textAlign: "right", fontSize: "8.5pt" }}>
                {l?.received ?? ""}
                {l?.receivedNote ? <div style={{ fontSize: "6.5pt" }}>({l.receivedNote})</div> : null}
              </td>
              <td style={{ border: RULE, padding: "0 1mm", textAlign: "right", fontSize: "8.5pt" }}>
                {l?.given ?? ""}
                {l?.givenNote ? <div style={{ fontSize: "6.5pt" }}>({l.givenNote})</div> : null}
              </td>
              <td style={{ border: RULE, padding: "0 1mm", textAlign: "right", fontSize: "8.5pt" }}>{l?.oldGold ?? ""}</td>
            </tr>
          ))}
          <tr style={{ height: "9mm", background: "#e9e9e9" }}>
            <td colSpan={4} style={{ border: RULE, borderTop: "2px solid #000", padding: "0 2mm", fontWeight: 800, textAlign: "right", fontSize: "9pt" }}>
              TOTAL {pages > 1 ? "THIS PAGE" : ""}
            </td>
            <td style={{ border: RULE, borderTop: "2px solid #000", padding: "0 1mm", textAlign: "right", fontWeight: 700 }}>{totals?.rec ?? ""}</td>
            <td style={{ border: RULE, borderTop: "2px solid #000", padding: "0 1mm", textAlign: "right", fontWeight: 700 }}>{totals?.giv ?? ""}</td>
            <td style={{ border: RULE, borderTop: "2px solid #000", padding: "0 1mm", textAlign: "right", fontWeight: 700 }}>{totals?.old ?? ""}</td>
          </tr>
        </tbody>
      </table>

      {/* Sign-off */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "5mm", fontSize: "8.5pt" }}>
        <span>
          Written by: <span style={{ display: "inline-block", width: "48mm", borderBottom: RULE }} />
        </span>
        <span>
          Checked by: <span style={{ display: "inline-block", width: "48mm", borderBottom: RULE }} />
        </span>
      </div>
      <div style={{ marginTop: "2mm", fontSize: "6.8pt", color: "#333", textAlign: "center" }}>
        At day end, photograph this sheet flat and straight-on in good light, then upload it in GoldOS → Day Sheet. {code}
      </div>
    </div>
  );
}

function PrintView() {
  const params = useSearchParams();
  const router = useRouter();
  const branchId = params.get("branchId") ?? "";
  const date = params.get("date") || null;
  const mode = params.get("mode") === "system" ? "system" : "blank";
  const pagesWanted = Math.max(1, Math.min(10, Number(params.get("pages")) || 1));

  const branches = useQuery({ queryKey: ["branches"], queryFn: () => api<{ rows: { id: string; name: string; code?: string }[] }>("/api/v1/branches?limit=100") });
  const shop = useQuery({ queryKey: ["shop-name"], queryFn: () => api<{ value: unknown }>("/api/v1/settings/shop_name"), retry: false });
  const view = useQuery({
    enabled: mode === "system" && !!branchId && !!date,
    queryKey: ["day-sheet", branchId, date],
    queryFn: () => api<DaySheetView>(`/api/v1/day-sheets/day?branchId=${encodeURIComponent(branchId)}&date=${date}`),
  });
  const branch = branches.data?.rows.find((b) => b.id === branchId);
  const shopName = typeof shop.data?.value === "string" && shop.data.value.trim() ? shop.data.value.trim() : "GoldOS";

  const pages = useMemo(() => {
    if (mode === "blank") return Array.from({ length: pagesWanted }, () => ({ lines: Array<Line>(PRINT_ROWS).fill(null), totals: null }));
    const sys = view.data?.system ?? [];
    const out: { lines: Line[]; totals: { rec: string; giv: string; old: string } | null }[] = [];
    for (let i = 0; i < Math.max(1, Math.ceil(sys.length / PRINT_ROWS)); i++) {
      const chunk = sys.slice(i * PRINT_ROWS, (i + 1) * PRINT_ROWS);
      const sum = (f: (s: (typeof chunk)[number]) => number) => chunk.reduce((t, s) => t + f(s), 0);
      const lines: Line[] = chunk.map(systemAsSheetLine);
      while (lines.length < PRINT_ROWS) lines.push(null);
      const fmt = (c: number) => (c / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
      out.push({ lines, totals: { rec: fmt(sum((s) => s.receivedCents)), giv: fmt(sum((s) => s.givenCents)), old: fmt(sum((s) => s.oldGoldCents)) } });
    }
    return out;
  }, [mode, pagesWanted, view.data]);

  const loading = branches.isLoading || (mode === "system" && view.isLoading);
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    p.set(k, v);
    router.replace(`/day-sheet/print?${p.toString()}`);
  };

  return (
    <Page className="space-y-4">
      <div className="print:hidden">
        <GoldHero
          icon={FileTextIcon}
          title="Print"
          accent="day sheet"
          sub={
            mode === "blank"
              ? "A blank A4 sheet for the counter. Each line is one transaction; the AI reads it back from a photo at day end."
              : "What the system recorded this day, laid out exactly like the paper sheet."
          }
          back={{ href: `/day-sheet?branchId=${encodeURIComponent(branchId)}${date ? `&date=${date}` : ""}`, label: "Day sheet" }}
          actions={
            <>
              <button type="button" className={heroGhost} onClick={() => setParam("mode", mode === "blank" ? "system" : "blank")} disabled={mode === "blank" && !date}>
                {mode === "blank" ? "Fill from the system" : "Blank sheet"}
              </button>
              <button type="button" className={heroGold} onClick={() => window.print()} disabled={loading}>
                <PrinterIcon size={13} /> Print
              </button>
            </>
          }
        >
          {mode === "blank" ? (
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-paper/70">
              <span>Pages</span>
              {[1, 2, 3, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setParam("pages", String(n))}
                  className={`h-7 rounded-full px-3 text-[11.5px] font-semibold ${n === pagesWanted ? "bg-gold text-void" : "bg-paper/[0.06] text-paper/60 ring-1 ring-inset ring-paper/10"}`}
                >
                  {n}
                </button>
              ))}
              <label className="ml-2 inline-flex items-center gap-2">
                <input type="checkbox" checked={!!date} onChange={(e) => (e.target.checked ? setParam("date", businessToday()) : setParam("date", ""))} />
                Print the date
              </label>
            </div>
          ) : null}
        </GoldHero>
      </div>

      <style>{`@page { size: A4 portrait; margin: 8mm; } @media print { .day-sheet-wrap { break-after: page; page-break-after: always; } .day-sheet-wrap:last-child { break-after: auto; page-break-after: auto; } }`}</style>

      {loading ? (
        <Skeleton className="mx-auto h-[600px] w-full max-w-3xl" />
      ) : (
        <div className="print-area mx-auto w-fit space-y-6 print:space-y-0">
          {pages.map((p, i) => (
            <div key={i} className="day-sheet-wrap rounded-sm bg-white p-[8mm] shadow-[0_30px_60px_-36px_rgba(16,32,27,0.55),0_0_0_1px_rgba(16,32,27,0.07)] print:p-0 print:shadow-none">
              <SheetPage
                shop={shopName}
                branch={branch?.name ?? ""}
                branchCode={branch?.code ?? ""}
                date={date}
                page={i + 1}
                pages={pages.length}
                lines={p.lines}
                startNo={i * PRINT_ROWS + 1}
                totals={p.totals}
              />
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}

export default function DaySheetPrintPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <PrintView />
    </Suspense>
  );
}
