"use client";

// Account ledger for a customer or supplier, opened from their master list.
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui";
import { BookOpenIcon, XIcon } from "@/components/icons";

type Ledger = {
  opening: number;
  debitSales: number;
  creditPayments: number;
  creditReturns: number;
  creditPurchases: number;
  debitPayments: number;
  debitReturns: number;
  closing: number;
  lines: {
    entryId: string;
    entryNo: string;
    entryDate: string;
    refEntity: string;
    refNo: string | null;
    memo: string | null;
    debitCents: number;
    creditCents: number;
  }[];
};

const fmt = (c: number) => (c / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
/** Balances read as Dr / Cr rather than signed numbers. */
const side = (c: number) => (c === 0 ? "" : c > 0 ? "Dr" : "Cr");

export function LedgerDrawer({ endpoint, id, onClose }: { endpoint: string; id: string; onClose: () => void }) {
  const detail = useQuery({
    queryKey: [endpoint, id],
    queryFn: () =>
      api<{ code: string; name: string; phone: string | null; nic: string | null; notes: string | null }>(`${endpoint}/${id}`),
  });
  const ledger = useQuery({
    queryKey: [endpoint, id, "ledger"],
    queryFn: () => api<Ledger>(`${endpoint}/${id}/ledger`),
  });
  const L = ledger.data;
  const party = endpoint.includes("supplier") ? "Supplier" : "Customer";
  const name = detail.data?.name ?? "";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  // Running balance from the opening figure, debit up and credit down.
  let run = L?.opening ?? 0;
  const lines = (L?.lines ?? []).map((l) => {
    run += l.debitCents - l.creditCents;
    return { ...l, bal: run };
  });
  const totDr = lines.reduce((a, l) => a + l.debitCents, 0);
  const totCr = lines.reduce((a, l) => a + l.creditCents, 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-xl animate-slide-in flex-col overflow-hidden bg-bone shadow-floating"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${party} ledger`}
      >
        {/* header */}
        <div className="relative shrink-0 overflow-hidden bg-void px-5 pb-4 pt-4 text-paper">
          <div className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-gold/[0.16] blur-[80px]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
          <div className="relative flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold-deep font-display text-[14px] font-bold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
              {initials || <BookOpenIcon size={16} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-gold-light/80">{party} ledger</div>
              <h2 className="g-display mt-0.5 truncate text-[20px] leading-tight">{detail.data ? name : "Account ledger"}</h2>
              {detail.data ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-paper/50">
                  <span className="g-metric rounded bg-paper/[0.08] px-1.5 py-px text-paper/80">{detail.data.code}</span>
                  <span>{detail.data.phone ?? "No phone"}</span>
                  <span>·</span>
                  <span>{detail.data.nic ?? "No NIC"}</span>
                </div>
              ) : null}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex size-8 items-center justify-center rounded-lg text-paper/50 transition-colors hover:bg-paper/10 hover:text-paper"
            >
              <XIcon size={16} />
            </button>
          </div>

          <div className="relative mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-paper/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
            {[
              { k: "Opening", v: L?.opening },
              { k: "Closing balance", v: L?.closing, accent: true },
              { k: "Entries", v: L ? L.lines.length * 100 : undefined, plain: true },
            ].map((s) => (
              <div key={s.k} className={cn("bg-void px-3 py-2.5", s.accent && "bg-gradient-to-br from-gold/[0.16] via-void to-void")}>
                <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-paper/40">{s.k}</div>
                {s.v == null ? (
                  <Skeleton className="mt-1.5 h-4 w-16 bg-paper/10" />
                ) : (
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className={cn("g-metric leading-none", s.accent ? "text-[19px] text-gold-light" : "text-[15px]")}>
                      {s.plain ? s.v / 100 : fmt(Math.abs(s.v))}
                    </span>
                    {!s.plain ? <span className="text-[9.5px] font-semibold text-paper/40">LKR {side(s.v)}</span> : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4 scrollbar-thin">
          {detail.data?.notes ? (
            <p className="rounded-xl bg-gold-pale/60 px-3 py-2 text-[12px] text-ink-2 ring-1 ring-inset ring-gold/20">{detail.data.notes}</p>
          ) : null}

          {L ? (
            <div className="grid grid-cols-3 gap-2">
              {[
                { k: party === "Supplier" ? "Purchases" : "Sales", v: L.debitSales + L.creditPurchases, tone: "#B8923F" },
                { k: "Payments", v: L.creditPayments + L.debitPayments, tone: "#059669" },
                { k: "Returns", v: L.creditReturns + L.debitReturns, tone: "#E11D48" },
              ].map((m) => (
                <div key={m.k} className="relative overflow-hidden rounded-xl bg-paper px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07)]">
                  <span className="absolute inset-x-0 top-0 h-[2px]" style={{ background: m.tone }} aria-hidden />
                  <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{m.k}</div>
                  <div className="g-metric mt-0.5 text-[14px] font-semibold text-ink">{fmt(m.v)}</div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="overflow-hidden rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07)]">
            <div className="flex items-center justify-between border-b border-ink/[0.06] px-4 py-2.5">
              <span className="text-[13px] font-semibold text-ink">Entries</span>
              <span className="text-[11px] text-ink-4">Running balance in LKR</span>
            </div>
            {!L ? (
              <div className="space-y-2 p-3">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-7" />
                ))}
              </div>
            ) : lines.length === 0 ? (
              <div className="m-3 rounded-xl border border-dashed border-ink/15 bg-bone/60 px-4 py-5 text-center">
                <p className="text-[13px] font-semibold text-ink">No transactions yet</p>
                <p className="mt-0.5 text-[11px] text-ink-4">The ledger starts with the first {party === "Supplier" ? "purchase" : "sale"} or payment.</p>
              </div>
            ) : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-[12px]">
                  <thead className="bg-bone/60 text-left">
                    <tr className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">
                      <th className="py-1.5 pl-4 pr-2">Date</th>
                      <th className="px-2">Entry</th>
                      <th className="px-2 text-right">Dr</th>
                      <th className="px-2 text-right">Cr</th>
                      <th className="px-2 pr-4 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-ink/[0.05] bg-bone/30 text-ink-4">
                      <td className="py-1.5 pl-4 pr-2 text-[11px]" colSpan={4}>
                        Opening balance
                      </td>
                      <td className="g-metric px-2 pr-4 text-right">
                        {fmt(Math.abs(L.opening))} <span className="text-[9.5px]">{side(L.opening)}</span>
                      </td>
                    </tr>
                    {lines.map((l) => (
                      <tr key={l.entryId} className="border-t border-ink/[0.05] transition-colors hover:bg-gold-pale/30">
                        <td className="whitespace-nowrap py-1.5 pl-4 pr-2 text-[11px] text-ink-3">{l.entryDate}</td>
                        <td className="px-2">
                          <div className="g-metric text-[11.5px] text-ink">{l.entryNo}</div>
                          <div className="truncate text-[10.5px] text-ink-5">{l.memo ?? l.refNo ?? l.refEntity}</div>
                        </td>
                        <td className="g-metric px-2 text-right text-ink-2">{l.debitCents ? fmt(l.debitCents) : <span className="text-ink-6">—</span>}</td>
                        <td className="g-metric px-2 text-right text-emerald-700">{l.creditCents ? fmt(l.creditCents) : <span className="text-ink-6">—</span>}</td>
                        <td className="g-metric whitespace-nowrap px-2 pr-4 text-right font-semibold text-ink">
                          {fmt(Math.abs(l.bal))} <span className="text-[9.5px] font-normal text-ink-5">{side(l.bal)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-ink/10 bg-bone/50 font-semibold">
                      <td className="py-2 pl-4 pr-2 text-[11px] text-ink-3" colSpan={2}>
                        Totals · {lines.length} entries
                      </td>
                      <td className="g-metric px-2 text-right text-ink">{fmt(totDr)}</td>
                      <td className="g-metric px-2 text-right text-emerald-700">{fmt(totCr)}</td>
                      <td className="g-metric px-2 pr-4 text-right text-gold-deep">
                        {fmt(Math.abs(L.closing))} <span className="text-[9.5px] font-normal">{side(L.closing)}</span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
