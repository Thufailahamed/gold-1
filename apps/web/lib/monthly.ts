export type MonthlySummary = {
  meta: { month: string; branchId: string | null };
  sales: { netCents: number; invoiceCount: number };
  profit: { revenueCents: number; netProfitCents: number };
  cashflow: { inflowsCents: number; outflowsCents: number; closingCents: number };
  gold: { inFineMg: number; outFineMg: number; closingFineMg: number };
  receivables: { totalCents: number; aging: Record<string, number> };
  inventory: { jewelleryCents: number; goldCents: number; byPurity: { key: string; cents: number }[] };
  estimates: { kind: string; label: string; note: string }[];
};

export function last12Months(now: Date): { month: number; year: number; label: string }[] {
  const out: { month: number; year: number; label: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    out.push({ month, year, label: `${year}-${String(month).padStart(2, "0")}` });
  }
  return out;
}

/** Full monthly report as served by GET /api/v1/reports/monthly. */
export type MonthlyReport = {
  meta: { month: string; from: string; to: string; branchId: string | null };
  sales: { netCents: number; invoiceCount: number; grossCents: number; returnsCents: number; hasData: boolean };
  purchases: { purchaseValueCents: number; oldGoldCents: number; goldFineMg: number; hasData: boolean };
  gold: { openingFineMg: number; inFineMg: number; outFineMg: number; closingFineMg: number; hasData: boolean };
  expenses: { totalCents: number; pendingCents: number; byCategory: { accountCode: string; name: string; cents: number }[]; hasData: boolean };
  profit: { revenueCents: number; cogsCents: number; grossProfitCents: number; operatingExpensesCents: number; netProfitCents: number; basis: string };
  cashflow: { openingCents: number; inflowsCents: number; outflowsCents: number; closingCents: number; unclassifiedCents: number; hasData: boolean };
  receivables: { totalCents: number; aging: Record<string, number>; outstanding: { id: string; number: string; outstandingCents: number }[]; hasData: boolean };
  payables: { totalCents: number; aging: Record<string, number>; outstanding: { id: string; number: string; outstandingCents: number }[]; hasData: boolean };
  inventory: { jewelleryCents: number; goldCents: number; byBranch: { key: string; cents: number }[]; byCategory: { key: string; cents: number }[]; byPurity: { key: string; cents: number }[]; uncostedPieces: number; method: string; basis: string; hasData: boolean };
  estimates: { kind: string; label: string; note: string }[];
  warnings: string[];
};

/** Business "today" (Sri Lanka, UTC+5:30) as YYYY-MM-DD. */
export const businessToday = (): string => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** First and last calendar day of a YYYY-MM month. */
export function monthBounds(ym: string): { from: string; to: string; days: number } {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(days).padStart(2, "0")}`, days };
}
