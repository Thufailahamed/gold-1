"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  BanknoteIcon,
  CheckCircleIcon,
  CheckIcon,
  ClipboardCheckIcon,
  CoinsIcon,
  CopyIcon,
  HistoryIcon,
  LayersIcon,
  PercentIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ScaleIcon,
  SearchIcon,
  SendIcon,
  ShieldIcon,
  SparklesIcon,
  TrashIcon,
  TrendingUpIcon,
  TruckIcon,
  UsersIcon,
  XIcon,
  ArrowLeftRightIcon,
  FileTextIcon,
} from "@/components/icons";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/cn";
import { shopOffsetMs } from "@/lib/busclock";
import { useAccountsScope } from "@/lib/accounts";
import {
  assistantApi,
  toolLabels,
  type AssistantAction,
  type AssistantMessage,
  type BriefFinding,
  type ConversationSummary,
} from "@/lib/assistant";

const MAX_CHARS = 4000;
const ACTION_TTL_MS = 30 * 60_000;

type IconCmp = (p: { size?: number | string; className?: string }) => ReactNode;

const shopDate = (ms: number) => new Date(ms + shopOffsetMs()).toISOString().slice(0, 10);
const shopTime = (ms: number) => new Date(ms + shopOffsetMs()).toISOString().slice(11, 16);
const shopHour = (ms: number) => new Date(ms + shopOffsetMs()).getUTCHours();
const longDay = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(ms + shopOffsetMs()));

function greeting(ms: number): string {
  const h = shopHour(ms);
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Re-renders on an interval, for countdowns and relative times. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/* ------------------------------------------------------------ what it does */

/** Questions: sent as they are. */
const ASK: { icon: IconCmp; title: string; prompt: string }[] = [
  { icon: CoinsIcon, title: "Cash & bank", prompt: "What is our cash position right now, by branch and bank?" },
  { icon: TrendingUpIcon, title: "Profit & loss", prompt: "Show profit and loss for last month and compare gross margin with this month so far." },
  { icon: UsersIcon, title: "Customer dues", prompt: "Who owes us the most, and how much is over 90 days?" },
  { icon: TruckIcon, title: "Supplier dues", prompt: "Which suppliers do we owe, and how old are the unpaid invoices?" },
  { icon: ClipboardCheckIcon, title: "Day closing", prompt: "Is today ready to close at this branch? Anything failing?" },
  { icon: PercentIcon, title: "Sales tax", prompt: "How much VAT do we owe for this month so far?" },
];

/**
 * Instructions: put in the command bar with [blanks] for the user to fill
 * (Tab jumps between them). Nothing posts until a prepared entry is signed off.
 */
const DO: { icon: IconCmp; title: string; template: string }[] = [
  { icon: FileTextIcon, title: "Record an expense", template: "Record an expense of LKR [amount] for [what it was], paid from [cash or which bank] today" },
  { icon: UsersIcon, title: "Customer paid dues", template: "Customer [name] paid LKR [amount] towards their dues, in [cash or which bank]" },
  { icon: TruckIcon, title: "Pay a supplier", template: "Pay supplier [name] LKR [amount] from [cash or which bank]" },
  { icon: BanknoteIcon, title: "Bank deposit", template: "Deposit LKR [amount] of cash from [branch] into [bank account]" },
  { icon: ArrowLeftRightIcon, title: "Move cash", template: "Send LKR [amount] cash from [branch] to [branch]" },
  { icon: ClipboardCheckIcon, title: "Close the day", template: "Check today's closing at [branch] and prepare the day close if everything passes" },
];

const FOLLOW_UPS = ["Break it down by branch", "Compare with last month", "Anything unusual I should know?"];

const WORKING = ["Reading the ledger", "Checking balances", "Cross-checking figures", "Writing it up"];

const BLANK = /\[[^\]\n]{1,40}\]/g;
const HAS_BLANK = /\[[^\]\n]{1,40}\]/;

/** Selects the next [blank] at or after `from`, wrapping around. */
function selectNextBlank(el: HTMLTextAreaElement, from: number): boolean {
  const all = [...el.value.matchAll(BLANK)];
  const hit = all.find((m) => (m.index ?? 0) >= from) ?? all[0];
  if (!hit || hit.index === undefined) return false;
  el.focus();
  el.setSelectionRange(hit.index, hit.index + hit[0].length);
  return true;
}

/* ------------------------------------------------------------- the orb */

function Orb({ size = 32, live = false, className }: { size?: number; live?: boolean; className?: string }) {
  return (
    <span
      className={cn("ast-orb inline-flex shrink-0 items-center justify-center text-void", live && "ast-orb-live", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <SparklesIcon size={Math.round(size * 0.46)} />
    </span>
  );
}

/* ---------------------------------------------------------- sign-off slip */

const SLIP_STATUS: Record<AssistantAction["status"], { label: string; cls: string }> = {
  PENDING: { label: "Needs your sign-off", cls: "bg-gold/15 text-gold-deep ring-gold/40" },
  RUNNING: { label: "Posting…", cls: "bg-sky-50 text-sky-800 ring-sky-200" },
  DONE: { label: "Posted to the books", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  SENT_FOR_APPROVAL: { label: "Sent for approval", cls: "bg-sky-50 text-sky-800 ring-sky-200" },
  FAILED: { label: "Not posted", cls: "bg-rose-50 text-rose-800 ring-rose-200" },
  CANCELLED: { label: "Discarded", cls: "bg-ink/5 text-ink-4 ring-ink/20" },
  EXPIRED: { label: "Expired", cls: "bg-ink/5 text-ink-4 ring-ink/20" },
};

function splitLine(line: string): { label: string; value: string } | null {
  const i = line.indexOf(": ");
  if (i <= 0 || i > 40) return null;
  return { label: line.slice(0, i), value: line.slice(i + 2) };
}

/** A prepared entry still open for sign-off: PENDING and not yet past its expiry on this clock. */
const isOpen = (a: AssistantAction, now: number) => a.status === "PENDING" && a.expiresAt > now;

function SignOffSlip({
  action,
  now,
  busy,
  onConfirm,
  onCancel,
}: {
  action: AssistantAction;
  now: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const open = isOpen(action, now);
  // Past its expiry but the server has not said so yet: show it as expired, not confirmable.
  const status: AssistantAction["status"] = action.status === "PENDING" && !open ? "EXPIRED" : action.status;
  const s = SLIP_STATUS[status];
  const rows = action.lines.map((l) => ({ raw: l, kv: splitLine(l) }));
  const amount = rows.find((r) => r.kv?.label === "Amount")?.kv?.value;
  const facts = rows.filter((r) => r.kv && r.kv.label !== "Amount");
  const notes = rows.filter((r) => !r.kv);
  const left = Math.max(0, action.expiresAt - now);
  const ref = (action.result?.data as { number?: string; entryNo?: string } | undefined) ?? undefined;

  return (
    <div id={`slip-${action.id}`} className={cn("ast-slip scroll-mt-24 animate-fade-in", open && "ast-slip-pending")}>
      <div className="flex items-start gap-3 px-4 pb-3 pt-3.5">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            open ? "bg-gradient-to-b from-gold-light to-gold-deep text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]" : "bg-ink/[0.05] text-ink-3"
          )}
        >
          <ScaleIcon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="g-kicker">Prepared entry</span>
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", s.cls)}>
              <span className={cn("size-1.5 rounded-full bg-current", open && "animate-pulse-soft")} />
              {s.label}
            </span>
          </div>
          <p className="mt-1 text-[14px] font-semibold leading-snug text-ink">{action.title}</p>
        </div>
        {amount && (
          <div className="hidden shrink-0 text-right sm:block">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">Amount</div>
            <div className="g-metric mt-1 text-lg text-ink">{amount}</div>
          </div>
        )}
      </div>

      {(facts.length > 0 || !!amount) && (
        <dl className="mx-4 grid divide-y sm:grid-cols-2 sm:gap-x-6 sm:divide-y-0 [&>div]:sm:border-b [&>div]:sm:border-dashed [&>div]:sm:border-ink/20 divide-dashed divide-ink/10 border-y border-dashed border-ink/20">
          {amount && (
            <div className="flex items-baseline justify-between gap-4 py-2 sm:hidden">
              <dt className="text-xs text-ink-4">Amount</dt>
              <dd className="g-metric text-sm text-ink">{amount}</dd>
            </div>
          )}
          {facts.map((r, i) => (
            <div key={i} className="flex items-baseline justify-between gap-4 py-1.5">
              <dt className="shrink-0 text-xs text-ink-4">{r.kv?.label}</dt>
              <dd className="min-w-0 text-right text-sm text-ink-2">{r.kv?.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {notes.length > 0 && (
        <ul className="mx-4 mt-2.5 space-y-1">
          {notes.map((r, i) => (
            <li key={i} className="flex gap-2 text-xs leading-relaxed text-ink-3">
              <AlertCircleIcon size={13} className="mt-0.5 shrink-0 text-gold-dark" />
              {r.raw}
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <div className="mt-3 border-t border-ink/20 bg-gold-pale/50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <button type="button" onClick={onConfirm} disabled={busy} className="home-btn-gold h-9 px-4 text-[13px] disabled:cursor-not-allowed disabled:opacity-60">
              <CheckCircleIcon size={16} /> {busy ? "Posting…" : "Sign off & post"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium text-ink-3 ring-1 ring-inset ring-ink/20 transition-colors hover:bg-ink/[0.04] hover:text-ink disabled:opacity-50"
            >
              <XIcon size={14} /> Discard
            </button>
            <span className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-4">
              <ShieldIcon size={12} /> Nothing is saved until you sign off
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-3">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold-light transition-[width] duration-1000"
                style={{ width: `${Math.min(100, (left / ACTION_TTL_MS) * 100)}%` }}
              />
            </div>
            <span className="g-metric text-[11px] text-ink-4">{Math.ceil(left / 60_000)} min left</span>
          </div>
        </div>
      ) : action.result?.message ? (
        <div
          className={cn(
            "mt-3 flex items-start gap-2 border-t px-4 py-2.5 text-xs",
            status === "FAILED" ? "border-rose-100 bg-rose-50/60 text-rose-800" : "border-emerald-100 bg-emerald-50/50 text-emerald-800",
            (status === "CANCELLED" || status === "EXPIRED") && "border-ink/20 bg-ink/[0.02] text-ink-4"
          )}
        >
          {status === "FAILED" ? <AlertCircleIcon size={14} className="shrink-0" /> : <CheckCircleIcon size={14} className="shrink-0" />}
          <span>
            {action.result.message}
            {(ref?.number || ref?.entryNo) && <span className="g-metric ml-1.5 font-medium">· {ref.number ?? ref.entryNo}</span>}
          </span>
        </div>
      ) : status === "EXPIRED" ? (
        <p className="mt-3 border-t border-ink/20 px-4 py-2.5 text-xs text-ink-4">Not posted. Ask again to prepare a fresh entry.</p>
      ) : (
        <div className="h-3" />
      )}
    </div>
  );
}

/* ---------------------------------------------------------- brief cards */

type Entry = { key: string; question: AssistantMessage | null; answer: AssistantMessage | null };

/** Pairs each request with the answer that followed it. */
function toEntries(messages: AssistantMessage[]): Entry[] {
  const out: Entry[] = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ key: m.id, question: m, answer: null });
    else {
      const last = out[out.length - 1];
      if (last && !last.answer) last.answer = m;
      else out.push({ key: m.id, question: null, answer: m });
    }
  }
  return out;
}

/** The assistant ended on a question: it is waiting for the user to answer it. */
const asksBack = (text: string) => /\?\s*[*_)\]]*\s*$/.test(text.trim());

function Checked({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-5">
        <LayersIcon size={11} /> Checked
      </span>
      {labels.map((l) => (
        <span key={l} className="rounded-md bg-bone px-1.5 py-0.5 text-[11px] text-ink-3 ring-1 ring-inset ring-ink/20">
          {l}
        </span>
      ))}
    </div>
  );
}

function BriefCard({
  entry,
  index,
  latest,
  tools,
  actions,
  now,
  busyAction,
  onDecide,
  onCopy,
  onAsk,
  onRetry,
}: {
  entry: Entry;
  index: number;
  latest: boolean;
  tools: string[] | undefined;
  actions: AssistantAction[];
  now: number;
  busyAction: string | null;
  onDecide: (id: string, confirm: boolean) => void;
  onCopy: (text: string) => void;
  onAsk: (text: string) => void;
  onRetry: (text: string) => void;
}) {
  const { question, answer } = entry;
  const waiting = latest && !!answer && asksBack(answer.content) && !actions.some((a) => isOpen(a, now));
  const labels = toolLabels(tools);
  const instruction = actions.length > 0;

  return (
    <article className={cn("ast-entry animate-fade-in", latest && "ast-entry-latest")} aria-label={question ? `Request: ${question.content}` : "Assistant note"}>
      {question && (
        <header className="border-b border-ink/20 px-4 pb-3 pt-3.5 sm:px-5">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-5">
            <span className="g-metric rounded bg-ink/[0.05] px-1.5 py-0.5 text-ink-4">#{String(index).padStart(2, "0")}</span>
            <span>{instruction ? "Instruction" : "Request"}</span>
            <span aria-hidden>·</span>
            <span className="g-metric normal-case tracking-normal">{shopTime(question.created_at)}</span>
            {waiting && (
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-2 py-0.5 normal-case tracking-normal text-gold-deep ring-1 ring-inset ring-gold/40">
                <span className="size-1.5 animate-pulse-soft rounded-full bg-current" /> Waiting for your reply
              </span>
            )}
          </div>
          <h2 className="mt-1.5 whitespace-pre-wrap font-sans text-[14.5px] font-semibold leading-snug tracking-[-0.01em] text-ink">{question.content}</h2>
        </header>
      )}

      <div className="px-4 py-3.5 sm:px-5">
        {answer ? (
          <>
            <div className="flex gap-3.5">
              <Orb size={22} className="mt-0.5 hidden sm:inline-flex" />
              <div className="min-w-0 flex-1">
                <Markdown text={answer.content} className="text-[13.5px] leading-[1.65]" />
                {actions.length > 0 && (
                  <div className="mt-4 space-y-3">
                    {actions.map((a) => (
                      <SignOffSlip
                        key={a.id}
                        action={a}
                        now={now}
                        busy={busyAction === a.id}
                        onConfirm={() => onDecide(a.id, true)}
                        onCancel={() => onDecide(a.id, false)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
            <footer className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-dashed border-ink/20 pt-2.5">
              <div className="min-w-0 flex-1">
                <Checked labels={labels} />
              </div>
              <button
                type="button"
                onClick={() => onCopy(answer.content)}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] text-ink-4 transition hover:bg-ink/[0.04] hover:text-ink"
              >
                <CopyIcon size={12} /> Copy
              </button>
            </footer>
            {latest && !waiting && !actions.some((a) => isOpen(a, now)) && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {FOLLOW_UPS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => onAsk(f)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-paper px-2.5 py-1 text-[11.5px] text-ink-3 ring-1 ring-inset ring-ink/20 transition hover:text-ink hover:ring-gold/60"
                  >
                    <ArrowRightIcon size={11} className="text-gold-dark" /> {f}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-bone/70 px-4 py-3 text-sm text-ink-3">
            <AlertCircleIcon size={15} className="shrink-0 text-gold-dark" />
            <span className="flex-1">No answer was recorded for this request.</span>
            {latest && question && (
              <button type="button" onClick={() => onRetry(question.content)} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-gold-dark hover:underline">
                <RotateCcwIcon size={13} /> Ask again
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function WorkingCard({ question, startedAt }: { question: string; startedAt: number }) {
  const now = useNow(1000);
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  const step = WORKING[Math.min(WORKING.length - 1, Math.floor(secs / 3))];
  return (
    <article className="ast-entry ast-entry-latest animate-fade-in" role="status" aria-live="polite">
      <header className="border-b border-ink/20 px-4 pb-3 pt-3.5 sm:px-5">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-5">
          <span>New request</span>
          <span aria-hidden>·</span>
          <span className="g-metric normal-case tracking-normal">{shopTime(startedAt)}</span>
        </div>
        <h2 className="mt-1.5 whitespace-pre-wrap font-sans text-[14.5px] font-semibold leading-snug tracking-[-0.01em] text-ink">{question}</h2>
      </header>
      <div className="flex gap-3 px-4 py-3.5 sm:px-5">
        <Orb size={24} live className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="ast-shimmer-text text-sm font-medium">{step}…</p>
            <span className="g-metric text-[11px] text-ink-5">{secs}s</span>
          </div>
          <div className="mt-3 space-y-2" aria-hidden>
            <div className="h-2.5 w-11/12 rounded-full bg-gradient-to-r from-mist/80 via-gold-soft to-mist/80 bg-[length:200%_100%] animate-shimmer" />
            <div className="h-2.5 w-8/12 rounded-full bg-gradient-to-r from-mist/80 via-gold-soft to-mist/80 bg-[length:200%_100%] animate-shimmer" />
            <div className="h-2.5 w-9/12 rounded-full bg-gradient-to-r from-mist/80 via-gold-soft to-mist/80 bg-[length:200%_100%] animate-shimmer" />
          </div>
        </div>
      </div>
    </article>
  );
}

function FailedCard({ question, error, onRetry, onEdit, onDismiss }: { question: string; error: string; onRetry: () => void; onEdit: () => void; onDismiss: () => void }) {
  return (
    <article className="ast-entry animate-fade-in ring-1 ring-inset ring-rose-200" role="alert">
      <header className="border-b border-ink/20 px-4 pb-3 pt-3.5 sm:px-5">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-700">
          <AlertCircleIcon size={12} /> Not answered
          <button type="button" onClick={onDismiss} aria-label="Dismiss" className="ml-auto rounded-md p-1 text-ink-5 hover:bg-ink/[0.05] hover:text-ink">
            <XIcon size={13} />
          </button>
        </div>
        <h2 className="mt-1.5 whitespace-pre-wrap font-sans text-[14.5px] font-semibold leading-snug tracking-[-0.01em] text-ink">{question}</h2>
      </header>
      <div className="flex flex-wrap items-center gap-2.5 px-4 py-3 sm:px-5">
        <p className="min-w-0 flex-1 text-[13px] text-ink-3">{error}</p>
        <button type="button" onClick={onEdit} className="h-9 rounded-full px-3.5 text-[13px] font-medium text-ink-3 ring-1 ring-inset ring-ink/20 hover:bg-ink/[0.04]">
          Edit
        </button>
        <button type="button" onClick={onRetry} className="home-btn-gold h-9 px-4 text-[13px]">
          <RotateCcwIcon size={13} /> Try again
        </button>
      </div>
    </article>
  );
}

/* --------------------------------------------------------- command bar */

function CommandBar({
  inputRef,
  draft,
  setDraft,
  onSubmit,
  busy,
  hero,
  placeholder,
  branchSlot,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  hero: boolean;
  placeholder: string;
  branchSlot: ReactNode;
}) {
  const hasBlanks = HAS_BLANK.test(draft);
  return (
    <form
      className={cn("ast-composer", hero ? "rounded-2xl p-2 pl-4" : "rounded-xl p-1.5 pl-3.5")}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex items-start gap-3">
        <span className={cn("mt-2.5 hidden shrink-0 text-gold-dark sm:block", hero && "mt-3")} aria-hidden>
          <SparklesIcon size={hero ? 16 : 14} />
        </span>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHARS))}
          onKeyDown={(e) => {
            const el = e.currentTarget;
            if (e.key === "Tab" && !e.shiftKey && HAS_BLANK.test(el.value)) {
              if (selectNextBlank(el, el.selectionEnd)) e.preventDefault();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSubmit();
            } else if (e.key === "Escape" && draft) {
              e.preventDefault();
              setDraft("");
            }
          }}
          rows={Math.min(6, Math.max(1, draft.split("\n").length))}
          placeholder={placeholder}
          aria-label="Ask or instruct the accounts assistant"
          className={cn(
            "max-h-40 min-w-0 flex-1 resize-none bg-transparent leading-relaxed text-ink outline-none placeholder:text-ink-5",
            hero ? "min-h-[46px] py-2.5 text-[15px]" : "min-h-[38px] py-2 text-[13.5px]"
          )}
        />
        <button
          type="submit"
          disabled={!draft.trim() || busy}
          aria-label="Send"
          className={cn("home-btn-gold mt-0.5 shrink-0 p-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none", hero ? "size-10" : "size-9")}
        >
          <SendIcon size={15} />
        </button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink/20 pt-1.5 text-[10.5px] text-ink-5">
        {branchSlot}
        {hasBlanks ? (
          <span className="inline-flex items-center gap-1.5 text-gold-deep">
            <kbd className="rounded border border-gold/40 bg-gold-pale px-1 font-sans text-[10px]">Tab</kbd> fills the next blank
          </span>
        ) : (
          <span className="hidden sm:inline">
            <kbd className="rounded border border-ink/20 bg-paper px-1 font-sans text-[10px] text-ink-4">Enter</kbd> send ·{" "}
            <kbd className="rounded border border-ink/20 bg-paper px-1 font-sans text-[10px] text-ink-4">Shift</kbd>+
            <kbd className="rounded border border-ink/20 bg-paper px-1 font-sans text-[10px] text-ink-4">Enter</kbd> new line ·{" "}
            <kbd className="rounded border border-ink/20 bg-paper px-1 font-sans text-[10px] text-ink-4">/</kbd> focus
          </span>
        )}
        <span className={cn("g-metric ml-auto", draft.length > MAX_CHARS * 0.9 && "text-rose-600")}>
          {draft.length > MAX_CHARS * 0.75 ? `${draft.length} / ${MAX_CHARS}` : null}
        </span>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------ side panel */

/** Today: the time. Earlier: the day and month. */
function stamp(ms: number, now: number): string {
  if (shopDate(ms) === shopDate(now)) return shopTime(ms);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(ms + shopOffsetMs()));
}

function groupSessions(rows: ConversationSummary[], now: number): { label: string; rows: ConversationSummary[] }[] {
  const today = shopDate(now);
  const yesterday = shopDate(now - 86_400_000);
  const weekAgo = shopDate(now - 7 * 86_400_000);
  const groups: Record<string, ConversationSummary[]> = { Today: [], Yesterday: [], "This week": [], Earlier: [] };
  for (const r of rows) {
    const d = shopDate(r.updated_at);
    const k = d === today ? "Today" : d === yesterday ? "Yesterday" : d > weekAgo ? "This week" : "Earlier";
    groups[k]?.push(r);
  }
  return Object.entries(groups)
    .filter(([, v]) => v.length > 0)
    .map(([label, v]) => ({ label, rows: v }));
}

const SEVERITY: Record<BriefFinding["severity"], { dot: string; label: string }> = {
  alert: { dot: "bg-rose-500", label: "Alert" },
  warn: { dot: "bg-amber-400", label: "Check" },
  info: { dot: "bg-sky-400", label: "Note" },
};

function PanelSection({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("ast-panel !rounded-2xl", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-ink/20 px-3.5 py-2.5">
        <h3 className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function SidePanel({
  pending,
  findings,
  briefDate,
  briefLoading,
  briefMissing,
  onWriteBrief,
  writingBrief,
  sessions,
  sessionsLoading,
  activeId,
  now,
  busy,
  onJump,
  onInvestigate,
  onPick,
  onNew,
  onDelete,
}: {
  pending: AssistantAction[];
  findings: BriefFinding[] | null;
  briefDate: string | null;
  briefLoading: boolean;
  /** No brief has been written yet; `onWriteBrief` is set when this user may write one. */
  briefMissing: boolean;
  onWriteBrief: (() => void) | null;
  writingBrief: boolean;
  sessions: ConversationSummary[];
  sessionsLoading: boolean;
  activeId: string | null;
  now: number;
  busy: boolean;
  onJump: (id: string) => void;
  onInvestigate: (f: BriefFinding) => void;
  onPick: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const filtered = useMemo(() => sessions.filter((r) => r.title.toLowerCase().includes(q.trim().toLowerCase())), [sessions, q]);
  const groups = useMemo(() => groupSessions(filtered, now), [filtered, now]);

  return (
    <div className="flex h-full flex-col gap-2.5 overflow-y-auto pb-1 scrollbar-thin">
      {/* Sign-offs waiting in this session */}
      <section className="ast-rail shrink-0 rounded-2xl p-3.5 text-paper">
        <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
        <div className="relative flex items-center justify-between gap-2">
          <h3 className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-light/85">Waiting on you</h3>
          <span className={cn("g-metric rounded-full px-2 py-0.5 text-[11px]", pending.length ? "bg-gold text-void" : "bg-paper/10 text-paper/50")}>
            {pending.length}
          </span>
        </div>
        {pending.length === 0 ? (
          <p className="relative mt-1.5 text-[11.5px] leading-relaxed text-paper/50">
            Nothing to sign off. Prepared entries wait here until you post or discard them.
          </p>
        ) : (
          <ul className="relative mt-3 space-y-1.5">
            {pending.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onJump(a.id)}
                  className="group flex w-full items-center gap-2.5 rounded-lg bg-paper/[0.06] px-2.5 py-2 text-left ring-1 ring-inset ring-paper/10 transition hover:bg-paper/[0.1] hover:ring-gold/40"
                >
                  <ScaleIcon size={14} className="shrink-0 text-gold-light" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-paper">{a.title}</span>
                    <span className="g-metric text-[10.5px] text-paper/45">{Math.ceil(Math.max(0, a.expiresAt - now) / 60_000)} min left</span>
                  </span>
                  <ArrowRightIcon size={13} className="shrink-0 text-paper/40 transition group-hover:translate-x-0.5 group-hover:text-gold-light" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* What the books flagged */}
      {findings !== null && (
        <PanelSection
          title="Watchlist"
          aside={briefDate ? <span className="g-metric text-[10.5px] text-ink-5">{briefDate}</span> : null}
          className="shrink-0"
        >
          {briefMissing ? (
            <div className="px-3.5 py-3">
              <p className="text-[11.5px] leading-relaxed text-ink-4">
                No brief yet today. Written every evening; flags cash differences, unclosed days and overdue dues.
              </p>
              {onWriteBrief && (
                <button
                  type="button"
                  onClick={onWriteBrief}
                  disabled={writingBrief}
                  className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium text-gold-dark ring-1 ring-inset ring-gold/40 transition hover:bg-gold-pale disabled:opacity-50"
                >
                  <SparklesIcon size={12} /> {writingBrief ? "Writing…" : "Write today's brief"}
                </button>
              )}
            </div>
          ) : briefLoading ? (
            <div className="space-y-2 px-3.5 py-3" aria-hidden>
              <div className="h-3 w-3/4 animate-pulse rounded bg-mist" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-mist" />
            </div>
          ) : findings.length === 0 ? (
            <p className="flex items-center gap-2 px-3.5 py-3 text-[11.5px] text-emerald-700">
              <span className="size-2 rounded-full bg-emerald-500" aria-hidden /> Nothing in the latest brief needs attention.
            </p>
          ) : (
            <ul className="divide-y divide-ink/[0.06] px-1.5 py-1">
              {findings.slice(0, 5).map((f) => (
                <li key={f.id} className="px-2 py-2">
                  <div className="flex items-start gap-2.5">
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEVERITY[f.severity].dot)} title={SEVERITY[f.severity].label} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium leading-snug text-ink">{f.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-ink-4">
                        {f.branch} · {f.detail}
                      </p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onInvestigate(f)}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-gold-dark hover:underline disabled:opacity-50"
                      >
                        Look into it <ArrowRightIcon size={11} />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {findings.length > 5 && (
            <Link href="/accounts" className="block px-4 pb-3 text-[11.5px] text-ink-4 hover:text-ink">
              and {findings.length - 5} more in the daily brief →
            </Link>
          )}
        </PanelSection>
      )}

      {/* Earlier sessions */}
      <PanelSection
        title="Sessions"
        aside={
          <button type="button" onClick={onNew} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-gold-dark hover:bg-gold-pale">
            <PlusIcon size={12} /> New
          </button>
        }
        className="flex min-h-[200px] flex-1 flex-col"
      >
        <label className="mx-3 mt-2.5 flex h-8 items-center gap-2 rounded-lg bg-bone px-2.5 text-ink-5 ring-1 ring-inset ring-ink/20 transition focus-within:ring-gold/60">
          <SearchIcon size={13} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a session"
            aria-label="Find a session"
            className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-5"
          />
        </label>
        <nav className="mt-2 flex-1 space-y-2.5 overflow-y-auto px-1.5 pb-2 scrollbar-thin" aria-label="Sessions">
          {sessionsLoading && [0, 1, 2].map((i) => <div key={i} className="mx-2 h-8 animate-pulse rounded-lg bg-mist/60" />)}
          {!sessionsLoading && sessions.length === 0 && (
            <p className="flex items-center gap-2 px-2 py-2 text-[12px] text-ink-4">
              <HistoryIcon size={14} className="text-gold-dark" /> Past sessions will appear here.
            </p>
          )}
          {!sessionsLoading && sessions.length > 0 && filtered.length === 0 && <p className="px-2 text-[12px] text-ink-4">No session matches “{q}”.</p>}
          {groups.map((g) => (
            <div key={g.label}>
              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-5">{g.label}</p>
              <ul>
                {g.rows.map((c) => {
                  const active = c.id === activeId;
                  const confirming = confirmDelete === c.id;
                  return (
                    <li key={c.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => onPick(c.id)}
                        title={c.title}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg py-1.5 pl-2.5 pr-9 text-left text-[12.5px] transition-colors",
                          active ? "bg-void text-paper" : "text-ink-3 hover:bg-ink/[0.04] hover:text-ink"
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{c.title}</span>
                        <span className={cn("g-metric shrink-0 text-[10px] group-hover:opacity-0", active ? "text-paper/50" : "text-ink-5", confirming && "opacity-0")}>
                          {stamp(c.updated_at, now)}
                        </span>
                      </button>
                      {confirming ? (
                        <span className="absolute inset-y-0 right-1 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              onDelete(c.id);
                              setConfirmDelete(null);
                            }}
                            className="rounded-md bg-rose-600 px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-rose-700"
                          >
                            Delete
                          </button>
                          <button type="button" onClick={() => setConfirmDelete(null)} aria-label="Keep session" className="rounded-md p-1 text-ink-4 hover:bg-ink/[0.06]">
                            <XIcon size={12} />
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Delete session ${c.title}`}
                          onClick={() => setConfirmDelete(c.id)}
                          className={cn(
                            "absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 opacity-0 transition hover:bg-rose-500/15 hover:text-rose-600 focus:opacity-100 group-hover:opacity-100",
                            active ? "text-paper/60" : "text-ink-5"
                          )}
                        >
                          <TrashIcon size={12} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </PanelSection>
    </div>
  );
}

/* ------------------------------------------------------------- the page */

/** `conversationId`: the session the request went to (null = a new one). */
type InFlight = { question: string; startedAt: number; conversationId: string | null };
type Failure = { question: string; error: string; conversationId: string | null };

export default function AssistantPage() {
  const qc = useQueryClient();
  const scope = useAccountsScope();
  const now = useNow(15_000);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [inFlight, setInFlight] = useState<InFlight | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  // Tools reported by the chat reply, for servers that do not list them on the conversation.
  const [replyTools, setReplyTools] = useState<Record<string, string[]>>({});
  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const status = useQuery({ queryKey: ["assistant", "status"], queryFn: assistantApi.status, staleTime: 5 * 60_000 });
  const list = useQuery({ queryKey: ["assistant", "conversations"], queryFn: assistantApi.conversations });
  const convo = useQuery({
    queryKey: ["assistant", "conversation", activeId],
    queryFn: () => assistantApi.conversation(activeId as string),
    enabled: !!activeId,
  });
  // Same cache as the daily brief on the overview. Off or not permitted → no watchlist.
  const brief = useQuery({ queryKey: ["acct", "brief"], queryFn: assistantApi.brief, retry: false, staleTime: 60_000 });

  const send = useMutation({
    mutationFn: ({ message, conversationId }: { message: string; conversationId: string | null }) =>
      assistantApi.chat({ message, conversationId: conversationId ?? undefined, branchId: scope.branchId || undefined }),
    onMutate: ({ message, conversationId }) => {
      setFailure(null);
      setInFlight({ question: message, startedAt: Date.now(), conversationId });
      feedRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    },
    onSuccess: async (data, vars) => {
      setReplyTools((m) => ({ ...m, [data.messageId]: data.toolsUsed }));
      // The user may have opened another session while this one was answering.
      setActiveId((cur) => (cur === vars.conversationId ? data.conversationId : cur));
      await qc.invalidateQueries({ queryKey: ["assistant", "conversation", data.conversationId] });
      void qc.invalidateQueries({ queryKey: ["assistant", "conversations"] });
    },
    onError: (err, { message, conversationId }) => {
      setFailure({ question: message, error: err instanceof Error ? err.message : "The assistant could not answer.", conversationId });
      // The server may have opened the session before the model failed.
      void qc.invalidateQueries({ queryKey: ["assistant", "conversations"] });
      if (conversationId) void qc.invalidateQueries({ queryKey: ["assistant", "conversation", conversationId] });
    },
    onSettled: () => setInFlight(null),
  });

  const decide = useMutation({
    mutationFn: ({ id, confirm }: { id: string; confirm: boolean }) => (confirm ? assistantApi.confirm(id) : assistantApi.cancel(id)),
    onMutate: ({ id }) => setBusyAction(id),
    onSuccess: (a) => {
      if (a.status === "DONE") toast.success("Posted to the books");
      else if (a.status === "SENT_FOR_APPROVAL") toast.info("Sent for approval — it posts once approved");
      else if (a.status === "FAILED") toast.error(a.result?.message ?? "It was not posted");
      // A posting changes figures every other screen shows.
      void qc.invalidateQueries();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not complete that");
      void qc.invalidateQueries({ queryKey: ["assistant", "conversation", activeId] });
    },
    onSettled: () => setBusyAction(null),
  });

  const writeBrief = useMutation({
    mutationFn: assistantApi.refreshBrief,
    onSuccess: (b) => qc.setQueryData(["acct", "brief"], b),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not write the brief"),
  });

  const remove = useMutation({
    mutationFn: assistantApi.remove,
    onSuccess: (_d, id) => {
      if (id === activeId) setActiveId(null);
      void qc.invalidateQueries({ queryKey: ["assistant", "conversations"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not delete that session"),
  });

  const messages: AssistantMessage[] = convo.data?.messages ?? [];
  const actions = convo.data?.actions ?? [];
  const actionsByMessage = useMemo(() => {
    const m = new Map<string, AssistantAction[]>();
    for (const a of actions) {
      if (!a.messageId) continue;
      m.set(a.messageId, [...(m.get(a.messageId) ?? []), a]);
    }
    return m;
  }, [actions]);
  const entries = useMemo(() => toEntries(messages), [messages]);
  const openActions = actions.filter((a) => isOpen(a, now));
  // A request or failure shows only in the session it was sent to.
  const pending = inFlight && inFlight.conversationId === activeId ? inFlight : null;
  const failed = failure && failure.conversationId === activeId ? failure : null;

  const ask = (text: string) => {
    const message = text.trim().slice(0, MAX_CHARS);
    if (!message || send.isPending) return;
    send.mutate({ message, conversationId: activeId });
  };

  const submit = () => {
    const el = inputRef.current;
    if (el && HAS_BLANK.test(draft) && DO.some((d) => d.template.match(BLANK)?.some((b) => draft.includes(b)))) {
      toast.info("Fill in the blanks first — Tab jumps to the next one");
      selectNextBlank(el, 0);
      return;
    }
    if (!draft.trim() || send.isPending) return;
    const text = draft;
    setDraft("");
    ask(text);
  };

  const fillTemplate = (template: string) => {
    setDraft(template);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) selectNextBlank(el, 0);
    });
  };

  const newSession = () => {
    setActiveId(null);
    setDraft("");
    setFailure(null);
    setPanelOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const pick = (id: string) => {
    setActiveId(id);
    setFailure(null);
    setPanelOpen(false);
    feedRef.current?.scrollTo({ top: 0 });
  };

  const jumpTo = (actionId: string) => {
    setPanelOpen(false);
    requestAnimationFrame(() => document.getElementById(`slip-${actionId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  const investigate = (f: BriefFinding) =>
    ask(`Look into this from the daily brief: "${f.title}" at ${f.branch} — ${f.detail}. What caused it, and what should I do about it?`);

  // "/" or Ctrl/Cmd+K focuses the command bar from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.key === "/" && !typing) || (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A question handed over from elsewhere in Accounts (?q=…&branch=…) is sent
  // once, under the branch it was asked about, and the URL is cleaned so a
  // reload does not ask it again.
  const handedOff = useRef(false);
  useEffect(() => {
    if (handedOff.current || !scope.ready) return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q")?.trim();
    const b = params.get("branch");
    if (!q) {
      handedOff.current = true;
      return;
    }
    if (b && b !== scope.branchId && scope.visibleBranches.some((x) => x.id === b)) {
      scope.setBranchId(b);
      return;
    }
    handedOff.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    send.mutate({ message: q.slice(0, MAX_CHARS), conversationId: null });
  }, [scope.ready, scope.branchId, scope.visibleBranches]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  const name = scope.me.data?.user.name?.split(" ")[0] ?? "";
  const modelLabel = status.data ? status.data.model.replace(/^@cf\/[^/]+\//, "") : null;
  const empty = !activeId && !pending && !failed;
  const lastEntry = entries[entries.length - 1];
  const lastAnswer = lastEntry?.answer;
  const awaitingReply = !!activeId && !!lastAnswer && asksBack(lastAnswer.content);
  const placeholder = empty
    ? "Ask about the books, or tell me what to record…"
    : awaitingReply
      ? "Reply to the assistant…"
      : "Follow up, or ask something new in this session…";
  const sessionTitle = convo.data?.conversation.title ?? (pending && !activeId ? pending.question : null);
  const findings = brief.isError ? null : (brief.data?.findings ?? []);

  const branchSlot =
    scope.visibleBranches.length > 0 ? (
      <label className="inline-flex items-center gap-1.5" title={scope.canShop ? "Figures are shop-wide unless you name a branch; day closing uses this branch." : "Questions are answered for this branch unless you name another."}>
        <span>{scope.canShop ? "Closing branch" : "Branch"}</span>
        <select
          value={scope.branchId}
          onChange={(e) => scope.setBranchId(e.target.value)}
          className="rounded-md bg-bone px-1.5 py-0.5 text-[11px] font-medium text-ink-2 outline-none ring-1 ring-inset ring-ink/20 focus:ring-gold/60"
        >
          {scope.visibleBranches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {scope.canShop && <span className="hidden text-ink-5 md:inline">· answers cover the whole shop</span>}
      </label>
    ) : null;

  const panel = (
    <SidePanel
      pending={openActions}
      findings={findings}
      briefDate={brief.data?.date ?? null}
      briefLoading={brief.isLoading}
      briefMissing={!brief.isLoading && !brief.isError && !brief.data}
      onWriteBrief={scope.canManage ? () => writeBrief.mutate() : null}
      writingBrief={writeBrief.isPending}
      sessions={list.data?.rows ?? []}
      sessionsLoading={list.isLoading}
      activeId={activeId}
      now={now}
      busy={send.isPending}
      onJump={jumpTo}
      onInvestigate={(f) => {
        setPanelOpen(false);
        investigate(f);
      }}
      onPick={pick}
      onNew={newSession}
      onDelete={(id) => remove.mutate(id)}
    />
  );

  const commandBar = (hero: boolean) => (
    <CommandBar
      inputRef={inputRef}
      draft={draft}
      setDraft={setDraft}
      onSubmit={submit}
      busy={send.isPending}
      hero={hero}
      placeholder={placeholder}
      branchSlot={branchSlot}
    />
  );

  return (
    <div className="mx-auto flex h-[calc(100dvh-9.25rem)] min-h-[560px] max-w-7xl gap-3 animate-fade-in lg:h-[calc(100dvh-10.25rem)]">
      {/* The desk */}
      <section className="ast-stage flex min-w-0 flex-1 flex-col overflow-hidden rounded-[20px]">
        <header className="relative shrink-0 overflow-hidden bg-void text-paper">
          <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-40" />
          <div className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-gold/[0.18] blur-[90px]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
          <div className="relative flex items-center gap-3 px-4 py-3 sm:px-5">
            <Orb size={34} live={send.isPending} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-[14px] font-semibold text-paper">{sessionTitle ?? "Ledger Assistant"}</p>
                <span
                  className={cn(
                    "hidden shrink-0 items-center gap-1.5 rounded-full border px-2 py-px text-[9.5px] font-semibold uppercase tracking-[0.16em] sm:inline-flex",
                    status.data && !status.data.configured
                      ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                      : "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", status.data && !status.data.configured ? "bg-amber-400" : "animate-pulse-soft bg-emerald-400")} />
                  {status.data && !status.data.configured ? "Offline" : send.isPending ? "Working" : "Live ledger"}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-paper/45">
                {longDay(now)} · <span className="g-metric">{shopTime(now)}</span>
                {scope.branchId ? <> · {scope.visibleBranches.find((b) => b.id === scope.branchId)?.name}</> : null}
                {modelLabel && <span className="hidden xl:inline"> · {modelLabel}</span>}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              aria-label="Open sign-offs, watchlist and sessions"
              className="home-btn-ghost relative h-8 px-3 text-[12.5px] lg:hidden"
            >
              <HistoryIcon size={13} />
              <span className="hidden sm:inline">Panel</span>
              {openActions.length > 0 && (
                <span className="g-metric absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-gold text-[10px] text-void">{openActions.length}</span>
              )}
            </button>
            {!empty && (
              <button type="button" onClick={newSession} className="home-btn-gold h-8 px-3.5 text-[12.5px]">
                <PlusIcon size={13} /> <span className="hidden sm:inline">New session</span>
              </button>
            )}
          </div>
          {/* live counters */}
          <div className="relative grid grid-cols-2 gap-px border-t border-paper/[0.08] bg-paper/[0.06] sm:grid-cols-4">
            {[
              {
                label: "Waiting sign-off",
                value: String(openActions.length),
                hint: openActions.length ? "Review below" : "Nothing pending",
                tone: openActions.length ? "text-gold-light" : "text-paper",
              },
              {
                label: "Watchlist",
                value: findings === null ? "—" : String(findings.length),
                hint: findings === null ? "Brief off" : brief.data ? `Brief ${brief.data.date}` : "No brief yet",
                tone: findings && findings.some((f) => f.severity === "alert") ? "text-rose-300" : findings?.length ? "text-amber-300" : "text-paper",
              },
              {
                label: "This session",
                value: activeId ? String(entries.length) : "0",
                hint: activeId ? `${actions.filter((a) => a.status === "DONE").length} posted` : "New session",
                tone: "text-paper",
              },
              {
                label: "Sessions",
                value: list.data ? String(list.data.rows.length) : "—",
                hint: list.data?.rows[0] ? `Last ${stamp(list.data.rows[0].updated_at, now)}` : "None yet",
                tone: "text-paper",
              },
            ].map((c) => (
              <div key={c.label} className="bg-void px-4 py-2 sm:px-5">
                <div className="truncate text-[9.5px] font-semibold uppercase tracking-[0.16em] text-paper/40">{c.label}</div>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span className={cn("g-metric text-[17px] leading-none", c.tone)}>{c.value}</span>
                  <span className="truncate text-[10.5px] text-paper/40">{c.hint}</span>
                </div>
              </div>
            ))}
          </div>
        </header>

        {status.data && !status.data.configured && (
          <div className="mx-4 mt-3 flex items-start gap-2.5 rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 ring-1 ring-inset ring-amber-200 sm:mx-6">
            <AlertCircleIcon size={16} className="mt-0.5 shrink-0" />
            <span>
              The assistant is not connected yet: the API has no Workers AI binding. Add <code className="font-mono text-xs">[ai]</code> to wrangler.toml and deploy.
            </span>
          </div>
        )}

        {!empty && <div className="shrink-0 border-b border-ink/20 bg-paper/60 px-4 py-2.5 sm:px-6">{commandBar(false)}</div>}

        <div ref={feedRef} className="flex-1 overflow-y-auto scrollbar-thin">
          {empty ? (
            <div className="mx-auto w-full max-w-4xl px-4 pb-6 pt-5 sm:px-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div className="min-w-0">
                  <p className="g-kicker !text-[10px]">
                    {greeting(now)}
                    {name ? `, ${name}` : ""}
                  </p>
                  <h1 className="mt-1 g-display text-[24px] leading-[1.05] text-ink text-balance sm:text-[28px]">
                    What do you need from <span className="home-gold-text">the books?</span>
                  </h1>
                </div>
                <ol className="flex shrink-0 items-center gap-1.5 text-[10.5px] text-ink-4">
                  {[
                    { n: "1", t: "Ask or instruct" },
                    { n: "2", t: "I check the ledger" },
                    { n: "3", t: "You sign off" },
                  ].map((x, i) => (
                    <li key={x.n} className="flex items-center gap-1.5">
                      {i > 0 && <span className="h-px w-3 bg-ink/15" aria-hidden />}
                      <span className="g-metric flex size-4 items-center justify-center rounded-full bg-void text-[9px] text-gold-light">{x.n}</span>
                      <span className="whitespace-nowrap">{x.t}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="mt-4">{commandBar(true)}</div>

              <div className="mt-5 space-y-4">
                <div>
                  <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">
                    <SearchIcon size={11} className="text-gold-dark" /> Find out
                    <span className="h-px flex-1 bg-ink/[0.07]" aria-hidden />
                    <span className="font-medium normal-case tracking-normal text-ink-5">Sent as written</span>
                  </p>
                  <ul className="mt-2 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                    {ASK.map((c) => (
                      <li key={c.title}>
                        <button
                          type="button"
                          onClick={() => ask(c.prompt)}
                          title={c.prompt}
                          className="group flex w-full items-center gap-2.5 rounded-xl bg-paper px-2.5 py-2 text-left ring-1 ring-inset ring-ink/20 transition hover:-translate-y-px hover:ring-gold/60 hover:shadow-[0_14px_28px_-20px_rgba(126,98,35,0.6)]"
                        >
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-void text-gold-light">
                            <c.icon size={13} />
                          </span>
                          <span className="min-w-0 flex-1 leading-tight">
                            <span className="block text-[12.5px] font-semibold text-ink">{c.title}</span>
                            <span className="block truncate text-[11px] text-ink-4">{c.prompt}</span>
                          </span>
                          <ArrowRightIcon size={12} className="shrink-0 text-gold-dark opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">
                    <CheckIcon size={11} className="text-gold-dark" /> Get it done
                    <span className="h-px flex-1 bg-ink/[0.07]" aria-hidden />
                    <span className="font-medium normal-case tracking-normal text-ink-5">Fill the blanks · Tab jumps</span>
                  </p>
                  {scope.canManage ? (
                    <ul className="mt-2 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                      {DO.map((d) => (
                        <li key={d.title}>
                          <button
                            type="button"
                            onClick={() => fillTemplate(d.template)}
                            title={d.template}
                            className="group flex w-full items-center gap-2.5 rounded-xl border border-dashed border-ink/20 bg-paper/60 px-2.5 py-2 text-left transition hover:border-gold/70 hover:bg-paper"
                          >
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gold-pale text-gold-deep ring-1 ring-inset ring-gold/30">
                              <d.icon size={13} />
                            </span>
                            <span className="min-w-0 flex-1 leading-tight">
                              <span className="block text-[12.5px] font-semibold text-ink">{d.title}</span>
                              <span className="block truncate text-[11px] text-ink-4">{d.template}</span>
                            </span>
                            <span className="shrink-0 text-[10.5px] font-medium text-gold-dark opacity-0 transition group-hover:opacity-100">Fill</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 rounded-xl border border-dashed border-ink/20 px-3 py-2.5 text-[12px] leading-relaxed text-ink-4">
                      Recording entries needs the accounts:manage permission. You can still ask anything about the books.
                    </p>
                  )}
                </div>
                <p className="flex items-center gap-1.5 text-[11px] text-ink-5">
                  <LayersIcon size={11} className="text-gold-dark" /> Every answer lists the books it checked. Prepared entries wait {ACTION_TTL_MS / 60_000} minutes for your sign-off.
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-4xl space-y-3 px-4 pb-6 pt-3 sm:px-6">
              {failed && (
                <FailedCard
                  question={failed.question}
                  error={failed.error}
                  onRetry={() => ask(failed.question)}
                  onEdit={() => {
                    setDraft(failed.question);
                    setFailure(null);
                    requestAnimationFrame(() => inputRef.current?.focus());
                  }}
                  onDismiss={() => setFailure(null)}
                />
              )}
              {pending && <WorkingCard question={pending.question} startedAt={pending.startedAt} />}

              {activeId && convo.isLoading && (
                <div className="ast-entry space-y-3 p-6" aria-hidden>
                  <div className="h-4 w-2/3 animate-pulse rounded-full bg-mist/70" />
                  <div className="h-3 w-11/12 animate-pulse rounded-full bg-mist/50" />
                  <div className="h-3 w-8/12 animate-pulse rounded-full bg-mist/50" />
                </div>
              )}
              {activeId && convo.isError && (
                <div className="ast-entry flex items-center gap-3 px-6 py-5 text-sm text-ink-3">
                  <AlertCircleIcon size={16} className="text-rose-600" />
                  <span className="flex-1">This session could not be opened.</span>
                  <button type="button" onClick={() => void convo.refetch()} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-gold-dark hover:underline">
                    <RefreshCwIcon size={13} /> Retry
                  </button>
                </div>
              )}

              {entries
                .map((e, i) => ({ e, i }))
                .reverse()
                .map(({ e, i }) => (
                  <BriefCard
                    key={e.key}
                    entry={e}
                    index={i + 1}
                    latest={i === entries.length - 1 && !pending && !failed}
                    tools={e.answer ? e.answer.tools ?? replyTools[e.answer.id] : undefined}
                    actions={e.answer ? actionsByMessage.get(e.answer.id) ?? [] : []}
                    now={now}
                    busyAction={busyAction}
                    onDecide={(id, confirm) => decide.mutate({ id, confirm })}
                    onCopy={(t) => void copy(t)}
                    onAsk={ask}
                    onRetry={ask}
                  />
                ))}

              {entries.length > 1 && (
                <p className="pt-2 text-center text-[11px] text-ink-5">
                  Start of session · {convo.data ? `${shopDate(convo.data.conversation.created_at)} ${shopTime(convo.data.conversation.created_at)}` : ""}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 border-t border-ink/20 bg-bone/50 px-4 py-1.5 text-[10.5px] text-ink-5 sm:px-6">
          <ShieldIcon size={11} className="text-gold-dark" /> Figures come from the live ledger · entries post only after your sign-off
          <span className="ml-auto hidden items-center gap-1 md:inline-flex">
            <kbd className="rounded border border-ink/20 bg-paper px-1 font-sans text-[9.5px] text-ink-4">/</kbd> or
            <kbd className="rounded border border-ink/20 bg-paper px-1 font-sans text-[9.5px] text-ink-4">⌘K</kbd> to ask
          </span>
        </div>
      </section>

      {/* Side panel */}
      <aside className="hidden w-[280px] shrink-0 lg:block" aria-label="Assistant panel">
        {panel}
      </aside>
      {panelOpen && (
        <div className="fixed inset-0 z-50 bg-ink/60 p-3 backdrop-blur-sm lg:hidden" onClick={() => setPanelOpen(false)}>
          <div className="ml-auto flex h-full w-[320px] max-w-[90vw] flex-col animate-slide-in" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end">
              <button type="button" onClick={() => setPanelOpen(false)} aria-label="Close panel" className="rounded-full bg-paper p-2 text-ink-3 shadow-2">
                <XIcon size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1">{panel}</div>
          </div>
        </div>
      )}
    </div>
  );
}
