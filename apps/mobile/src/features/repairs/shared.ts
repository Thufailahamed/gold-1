import { mgToG } from "@goldos/shared";

export type RepairStatus = "RECEIVED" | "IN_PROGRESS" | "QC" | "READY" | "COLLECTED" | "CANCELLED";

export const STATUS_LABEL: Record<RepairStatus, string> = {
  RECEIVED: "Received",
  IN_PROGRESS: "In progress",
  QC: "Awaiting QC",
  READY: "Ready to collect",
  COLLECTED: "Collected",
  CANCELLED: "Cancelled",
};

export const statusLabel = (s: string) => STATUS_LABEL[s as RepairStatus] ?? s;
export const grams = (mg: number) => mgToG(mg).toLocaleString("en-US", { maximumFractionDigits: 3 });
export const when = (ms: number) => new Date(ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export const REPAIR_TYPES = ["Resize", "Solder", "Polish", "Stone setting", "Clasp replacement", "Re-plating", "Chain repair"];
