"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { SparklesIcon } from "@/components/icons";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { shopDateTime } from "@/lib/busclock";

type Finding = { id: string; severity: "alert" | "warn" | "info"; branchId: string; branch: string; title: string; detail: string };
type Brief = {
  date: string;
  summary: string;
  model: string;
  source: "cron" | "manual";
  generatedAt: number;
  findings: Finding[];
};

const TONE: Record<Finding["severity"], { dot: string; label: string }> = {
  alert: { dot: "bg-rose-500", label: "Alert" },
  warn: { dot: "bg-amber-400", label: "Check" },
  info: { dot: "bg-sky-400", label: "Note" },
};

/** Where a finding is best acted on. */
function fixHref(id: string): string | null {
  if (id.startsWith("cash-diff") || id.startsWith("unclosed")) return "/accounts/cash";
  if (id.startsWith("overdue90")) return "/accounts/receivables";
  if (id.includes("expense")) return "/expenses";
  return null;
}

const when = shopDateTime;

/**
 * The end-of-day brief on the Accounts overview. The findings are computed
 * from the ledger on the server; the sentences are the model's wording of
 * them, and fall back to plain rule-written text when the model is not used.
 */
export function DailyBrief({ className }: { className?: string }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canRefresh = hasPermission(me.data?.permissions ?? [], "accounts:manage");
  const brief = useQuery({
    queryKey: ["acct", "brief"],
    queryFn: () => api<Brief | null>("/api/v1/assistant/brief"),
    retry: false,
    staleTime: 60_000,
  });
  const refresh = useMutation({
    mutationFn: () => api<Brief>("/api/v1/assistant/brief/refresh", { method: "POST" }),
    onSuccess: (b) => qc.setQueryData(["acct", "brief"], b),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not refresh the brief"),
  });

  // The assistant is off, or the user cannot see it: show nothing rather than an error.
  if (brief.isError) return null;
  const b = brief.data;

  return (
    <section
      aria-label="Daily brief"
      className={cn(
        "relative flex flex-col overflow-hidden rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2),0_18px_40px_-30px_rgba(16,32,27,0.28)]",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-ink/20 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="ast-orb flex size-7 shrink-0 items-center justify-center text-void" aria-hidden>
            <SparklesIcon size={13} />
          </span>
          <div className="min-w-0 leading-tight">
            <h2 className="truncate font-sans text-[13.5px] font-semibold tracking-normal text-ink">Daily brief</h2>
            <p className="truncate text-[11px] text-ink-4">
              {b ? `${b.date} · ${when(b.generatedAt)}` : "Written every evening"}
            </p>
          </div>
        </div>
        {canRefresh ? (
          <button
            type="button"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-gold-dark ring-1 ring-inset ring-gold/30 transition hover:bg-gold-pale disabled:opacity-50"
          >
            {refresh.isPending ? "Writing…" : b ? "Refresh" : "Write now"}
          </button>
        ) : null}
      </div>

      {brief.isLoading ? (
        <div className="space-y-2 p-4" aria-hidden>
          <div className="h-3 w-3/4 animate-pulse rounded bg-mist" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-mist" />
        </div>
      ) : !b ? (
        <p className="p-4 text-[12.5px] leading-relaxed text-ink-3">
          No brief yet. It is written automatically in the evening; {canRefresh ? "or write today's now." : "ask someone with accounts access to write it now."}
        </p>
      ) : (
        <div className="max-h-[320px] flex-1 overflow-y-auto p-4 scrollbar-thin">
          <p className="text-[12.5px] leading-relaxed text-ink-2">{b.summary}</p>
          {b.findings.length === 0 ? (
            <p className="mt-2 flex items-center gap-2 text-[12px] text-emerald-700">
              <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
              Nothing needs attention.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-ink/[0.06]">
              {b.findings.slice(0, 6).map((f) => {
                const href = fixHref(f.id);
                const tone = TONE[f.severity];
                return (
                  <li key={f.id} className="flex items-start gap-2.5 py-1.5">
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", tone.dot)} title={tone.label} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-medium text-ink">
                        {f.title} <span className="font-normal text-ink-4">· {f.branch}</span>
                      </p>
                      <p className="text-[11px] text-ink-3">{f.detail}</p>
                    </div>
                    {href ? (
                      <Link href={href} className="shrink-0 text-xs font-medium text-gold-dark hover:underline">
                        Open
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {b.findings.length > 6 ? <p className="mt-2 text-xs text-ink-4">and {b.findings.length - 6} more</p> : null}
          <p className="mt-2 text-[10.5px] text-ink-4">
            Figures come from the ledger{b.model === "rules" ? "" : `; wording by ${b.model.split("/").pop()}`}. Ask the assistant to dig into any item.
          </p>
        </div>
      )}
    </section>
  );
}
