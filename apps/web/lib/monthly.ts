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
