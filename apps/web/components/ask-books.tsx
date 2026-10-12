"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, SparklesIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

const EXAMPLES = [
  "Why is today's cash short?",
  "Profit and loss for last month",
  "Who owes us the most?",
  "How much VAT do we owe this month?",
  "Record rent of LKR 85,000 paid from the bank",
];

const CHIPS = ["Cash position right now", "P&L last month", "Is today ready to close?"];

/**
 * The assistant's front door on the Accounts overview, built for the dark
 * hero. Asking opens the assistant with the question already sent, for the
 * branch picked on the overview.
 */
export function AskBooks({ branchId, className }: { branchId?: string; className?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hint, setHint] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setHint((n) => (n + 1) % EXAMPLES.length), 3200);
    return () => clearInterval(t);
  }, []);

  const ask = (text: string) => {
    const question = text.trim();
    const params = new URLSearchParams();
    if (question) params.set("q", question.slice(0, 4000));
    if (branchId) params.set("branch", branchId);
    const qs = params.toString();
    router.push(`/accounts/assistant${qs ? `?${qs}` : ""}`);
  };

  return (
    <div className={cn("relative flex flex-col gap-2 border-t border-paper/[0.08] bg-paper/[0.02] px-4 py-2.5 sm:px-5 lg:flex-row lg:items-center lg:gap-3", className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="home-glass group flex min-w-0 items-center gap-2.5 !rounded-xl p-1 pl-1.5 transition-shadow lg:flex-1 focus-within:shadow-[inset_0_0_0_1px_rgba(226,194,122,0.6),0_0_0_4px_rgba(205,168,83,0.12)]"
      >
        <span className="ast-orb flex size-7 shrink-0 items-center justify-center text-void" aria-hidden>
          <SparklesIcon size={13} />
        </span>
        <div className="relative min-w-0 flex-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Ask the accounts assistant"
            className="peer h-8 w-full bg-transparent text-[13px] text-paper outline-none"
          />
          {!q && (
            <span className="pointer-events-none absolute inset-y-0 left-0 flex min-w-0 items-center gap-1.5 text-[13px] text-paper/40">
              <span className="hidden shrink-0 sm:inline">Ask the books —</span>
              <span key={hint} className="truncate text-paper/60 animate-fade-in">
                “{EXAMPLES[hint]}”
              </span>
            </span>
          )}
        </div>
        <button type="submit" className="home-btn-gold h-8 shrink-0 px-3.5 text-[12.5px]">
          <span className="hidden sm:inline">Ask</span>
          <ArrowRightIcon size={13} />
        </button>
      </form>
      <div className="flex flex-wrap items-center gap-1.5 lg:shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-paper/35">Try</span>
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => ask(c)}
            className="rounded-full bg-paper/[0.04] px-2.5 py-0.5 text-[11px] text-paper/60 ring-1 ring-inset ring-paper/10 transition hover:bg-paper/[0.08] hover:text-gold-light hover:ring-gold/40"
          >
            {c}
          </button>
        ))}
        <span className="ml-auto hidden items-center gap-1.5 pl-1 text-[10.5px] text-paper/35 md:inline-flex lg:hidden 2xl:inline-flex">
          <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden />
          Answers from the live ledger
        </span>
      </div>
    </div>
  );
}
