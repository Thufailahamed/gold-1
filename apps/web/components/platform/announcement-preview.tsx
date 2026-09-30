import { AlertCircleIcon, MegaphoneIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

type Severity = "INFO" | "WARNING" | "CRITICAL";
const SEVERITY_STYLE: Record<Severity, string> = {
  INFO: "bg-gold/[0.08] ring-gold-dark/25 text-ink",
  WARNING: "bg-amber-100 ring-amber-600/30 text-amber-950",
  CRITICAL: "bg-rose-100 ring-rose-600/30 text-rose-950",
};

/** What the shop sees at the top of every page. */
export function AnnouncementPreview({ a }: { a: { title: string; body: string; severity: Severity | string } }) {
  return (
    <div className={cn("flex items-start gap-3 rounded-xl p-3.5 ring-1", SEVERITY_STYLE[a.severity as Severity] ?? SEVERITY_STYLE.INFO)}>
      {a.severity === "INFO" ? <MegaphoneIcon size={16} className="mt-0.5 shrink-0 text-gold-dark" /> : <AlertCircleIcon size={16} className="mt-0.5 shrink-0" />}
      <div className="min-w-0 text-sm">
        <div className="font-semibold">{a.title || "Title"}</div>
        <p className="mt-0.5 whitespace-pre-wrap opacity-80">{a.body || "Message body"}</p>
      </div>
    </div>
  );
}
