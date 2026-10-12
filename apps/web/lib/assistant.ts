import { api } from "@/lib/api";

export type AssistantAction = {
  id: string;
  title: string;
  lines: string[];
  status: "PENDING" | "RUNNING" | "DONE" | "SENT_FOR_APPROVAL" | "FAILED" | "CANCELLED" | "EXPIRED";
  result: { message?: string; data?: unknown; approvalId?: string } | null;
  expiresAt: number;
  messageId: string | null;
};

/** `tools`: what the assistant consulted for this answer (assistant messages only). */
export type AssistantMessage = { id: string; role: "user" | "assistant"; content: string; created_at: number; tools?: string[] };

export type ConversationSummary = { id: string; title: string; branch_id: string | null; created_at: number; updated_at: number };

export type ConversationDetail = {
  conversation: ConversationSummary;
  messages: AssistantMessage[];
  actions: AssistantAction[];
};

export type ChatReply = {
  conversationId: string;
  messageId: string;
  reply: string;
  actions: AssistantAction[];
  toolsUsed: string[];
  model: string;
};

export type AssistantStatus = { configured: boolean; model: string; fallbackModel: string; gateway: string };

export const assistantApi = {
  status: () => api<AssistantStatus>("/api/v1/assistant/status"),
  conversations: () => api<{ rows: ConversationSummary[] }>("/api/v1/assistant/conversations?limit=50"),
  conversation: (id: string) => api<ConversationDetail>(`/api/v1/assistant/conversations/${encodeURIComponent(id)}`),
  remove: (id: string) => api<{ id: string }>(`/api/v1/assistant/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  chat: (body: { message: string; conversationId?: string; branchId?: string }) =>
    api<ChatReply>("/api/v1/assistant/chat", { method: "POST", body: JSON.stringify(body) }),
  confirm: (id: string) => api<AssistantAction>(`/api/v1/assistant/actions/${encodeURIComponent(id)}/confirm`, { method: "POST" }),
  cancel: (id: string) => api<AssistantAction>(`/api/v1/assistant/actions/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  brief: () => api<DailyBriefData | null>("/api/v1/assistant/brief"),
  refreshBrief: () => api<DailyBriefData>("/api/v1/assistant/brief/refresh", { method: "POST" }),
};

export type BriefFinding = { id: string; severity: "alert" | "warn" | "info"; branchId: string; branch: string; title: string; detail: string };
export type DailyBriefData = { date: string; summary: string; model: string; source: "cron" | "manual"; generatedAt: number; findings: BriefFinding[] };

/** What each tool reads, in the words on the "Checked" line under an answer. */
const TOOL_LABELS: Record<string, string> = {
  resolve_period: "Dates",
  calculate: "Calculator",
  list_branches: "Branches",
  chart_of_accounts: "Chart of accounts",
  account_balance: "Account balances",
  trial_balance: "Trial balance",
  profit_and_loss: "Profit & loss",
  balance_sheet: "Balance sheet",
  account_statement: "Account statement",
  journal_entries: "Journal",
  journal_entry: "Journal entry",
  cash_position: "Cash position",
  daily_cash_summary: "Daily cash",
  cash_transfers: "Cash transfers",
  receivables: "Customer dues",
  customer_account: "Customer account",
  payables: "Supplier dues",
  supplier_account: "Supplier account",
  expenses: "Expenses",
  expense_summary: "Expense summary",
  expense_categories: "Expense categories",
  day_closing: "Day closing",
  investigate_cash_difference: "Cash difference",
  unclosed_days: "Unclosed days",
  day_closings: "Closing history",
  reconciliation: "Reconciliation",
  vat_report: "VAT report",
  tax_settings: "Tax settings",
  sales_summary: "Sales",
  purchase_summary: "Purchases",
  gold_rates: "Gold rates",
  gold_stock: "Gold stock",
  financial_years: "Financial years",
  find_document: "Document lookup",
};

export function toolLabel(name: string): string {
  if (name.startsWith("propose_")) return "Prepared entry";
  return TOOL_LABELS[name] ?? name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Distinct labels, in first-use order. */
export const toolLabels = (names: string[] | undefined) => [...new Set((names ?? []).map(toolLabel))];

export const SUGGESTIONS = [
  "What is our cash position right now?",
  "Profit and loss for last month",
  "Who owes us the most money?",
  "Is today ready to close at this branch?",
  "Which suppliers do we owe, and how old are the invoices?",
  "Record an electricity bill of LKR 12,500 paid in cash today",
];
