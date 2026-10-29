/** The day sheet as the API returns it (see apps/api/src/services/daysheet.ts). */

export type Method = "cash" | "bank" | "card" | "cheque" | "credit";
export const METHODS: Method[] = ["cash", "bank", "card", "cheque", "credit"];
export const METHOD_SHORT: Record<Method, string> = { cash: "Cash", bank: "Bank", card: "Card", cheque: "Chq", credit: "Credit" };

export type SheetRow = {
  id: string;
  lineNo: number;
  refNo: string | null;
  name: string | null;
  phone: string | null;
  details: string | null;
  goldText: string | null;
  goldMg: number | null;
  receivedCents: number | null;
  receivedMethod: Method | null;
  givenCents: number | null;
  givenMethod: Method | null;
  oldGoldCents: number | null;
  linkedRef: string | null;
  accepted: boolean;
  acceptNote: string | null;
};

export type SystemRow = {
  ref: string;
  refEntity: string;
  refId: string;
  refNo: string | null;
  kind: string;
  name: string | null;
  phone: string | null;
  customerId: string | null;
  details: string | null;
  goldMg: number | null;
  receivedCents: number;
  givenCents: number;
  oldGoldCents: number;
  creditCents: number;
  receivedMethods: Method[];
  givenMethods: Method[];
  at: number;
  href: string | null;
};

export type RowIssue = { field: string; label: string; sheet: string; system: string };
export type RowStatus = "MATCHED" | "MISMATCH" | "MISSING_IN_SYSTEM" | "ACCEPTED" | "EMPTY";
export type RowResult = { rowId: string; lineNo: number; status: RowStatus; matchRef: string | null; matchedBy: string[]; issues: RowIssue[] };

type Totals = { receivedCents: number; givenCents: number; oldGoldCents: number; goldMg: number };

export type Reconciliation = {
  rows: RowResult[];
  missingOnSheet: SystemRow[];
  ignored: { ref: string; note: string | null }[];
  totals: { sheet: Totals; system: Totals };
  counts: { matched: number; mismatch: number; missingInSystem: number; missingOnSheet: number; accepted: number };
  status: "VERIFIED" | "ISSUES";
};

export type SheetHeader = {
  id: string;
  branch_id: string;
  sheet_date: string;
  status: "DRAFT" | "VERIFIED" | "ISSUES";
  ai_model: string | null;
  matched_count: number;
  mismatch_count: number;
  missing_in_system_count: number;
  missing_on_sheet_count: number;
  checked_at: number | null;
  created_at: number;
  updated_at: number;
  imageCount: number;
  warnings: string[];
};

export type DaySheetView = {
  sheet: SheetHeader | null;
  rows: SheetRow[];
  system: SystemRow[];
  reconciliation: Reconciliation | null;
  dayClosed: boolean;
  scan?: { date: string | null; read: number; warnings: string[] };
};

/** Rows on one printed page: sized so each line is tall enough to write in clearly. */
export const PRINT_ROWS = 25;

export const rupees = (c: number | null | undefined) =>
  c === null || c === undefined || c === 0 ? "" : (c / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
export const rupeesAlways = (c: number) => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const gramsText = (mg: number | null | undefined) => (mg === null || mg === undefined || mg === 0 ? "" : (mg / 1000).toFixed(3));

/** "58,000" / "58000.50" → cents; "" → null. */
export function toCents(v: string): number | null {
  const s = v.replace(/[,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export function toMg(v: string): number | null {
  const s = v.replace(/[,\sg]/gi, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : null;
}

export const blankRow = (lineNo: number): SheetRow => ({
  id: `new-${crypto.randomUUID()}`,
  lineNo,
  refNo: null,
  name: null,
  phone: null,
  details: null,
  goldText: null,
  goldMg: null,
  receivedCents: null,
  receivedMethod: null,
  givenCents: null,
  givenMethod: null,
  oldGoldCents: null,
  linkedRef: null,
  accepted: false,
  acceptNote: null,
});

/** A system transaction written the way the paper sheet would have it. */
export function systemAsSheetLine(s: SystemRow) {
  const paid = s.receivedMethods.filter((m) => m !== "credit");
  return {
    refNo: s.refNo,
    who: [s.name, s.phone].filter(Boolean).join(" · "),
    details: [s.kind, s.details].filter(Boolean).join(" — "),
    gold: gramsText(s.goldMg),
    received: rupees(s.receivedCents),
    receivedNote: s.receivedCents && paid.some((m) => m !== "cash") ? paid.map((m) => METHOD_SHORT[m]).join("+") : s.creditCents ? `Credit ${rupees(s.creditCents)}` : "",
    given: rupees(s.givenCents),
    givenNote: s.givenCents && s.givenMethods.some((m) => m !== "cash") ? s.givenMethods.map((m) => METHOD_SHORT[m]).join("+") : "",
    oldGold: rupees(s.oldGoldCents),
  };
}
