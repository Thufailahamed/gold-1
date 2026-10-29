"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { papi } from "@/lib/platform";
import { cn } from "@/lib/cn";

type SearchResult = {
  tenants: Array<{ id: string; name: string; slug: string; owner_email: string; status: string }>;
  invoices: Array<{ id: string; number: string; tenant_name: string; status: string; total_cents: number }>;
  tickets: Array<{ id: string; number: string; subject: string; status: string; tenant_name: string }>;
  admins: Array<{ id: string; email: string; name: string; role: string }>;
};

const EMPTY: SearchResult = { tenants: [], invoices: [], tickets: [], admins: [] };

/** Global command-K palette — admin can jump to anything. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [data, setData] = useState<SearchResult>(EMPTY);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setData(EMPTY);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open ]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setData(EMPTY);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        setData(await papi<SearchResult>(`/search?q=${encodeURIComponent(q.trim())}`));
      } catch {
        // keep previous results on error
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const sections: Array<{ title: string; rows: React.ReactNode[] }> = [
    {
      title: "Accounts",
      rows: data.tenants.map((t) => (
        <button key={t.id} onClick={() => go(`/platform/tenants/${t.id}`)} className="flex w-full items-center gap-1 rounded-lg px-3 py-2 text-left text-sm hover:bg-ink/5">
          <span className="font-medium">{t.name}</span>
          <span className="ml-2 font-mono text-[11px] text-ink-4">{t.slug} · {t.status}</span>
        </button>
      )),
    },
    {
      title: "Invoices",
      rows: data.invoices.map((i) => (
        <button key={i.id} onClick={() => go(`/platform/billing?search=${encodeURIComponent(i.number)}`)} className="flex w-full items-center gap-1 rounded-lg px-3 py-2 text-left text-sm hover:bg-ink/5">
          <span className="font-mono font-medium">{i.number}</span>
          <span className="ml-2 text-[11px] text-ink-4">{i.tenant_name} · {i.status}</span>
        </button>
      )),
    },
    {
      title: "Tickets",
      rows: data.tickets.map((t) => (
        <button key={t.id} onClick={() => go(`/platform/support/${t.id}`)} className="flex w-full items-center gap-1 rounded-lg px-3 py-2 text-left text-sm hover:bg-ink/5">
          <span className="font-mono font-medium">{t.number}</span>
          <span className="ml-2 truncate text-[11px] text-ink-4">{t.subject}</span>
        </button>
      )),
    },
    {
      title: "Staff",
      rows: data.admins.map((a) => (
        <button key={a.id} onClick={() => go(`/platform/team`)} className="flex w-full items-center gap-1 rounded-lg px-3 py-2 text-left text-sm hover:bg-ink/5">
          <span className="font-medium">{a.name}</span>
          <span className="ml-2 font-mono text-[11px] text-ink-4">{a.email}</span>
        </button>
      )),
    },
  ];

  const total = sections.reduce((n, s) => n + s.rows.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/60 p-4 pt-[12vh] backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-paper shadow-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Search">
        <div className="flex items-center gap-2 border-b border-ink/20 px-4">
          <span className="text-ink-4">⌘K</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search accounts, invoices, tickets, staff…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-ink-4"
          />
          {loading ? <span className="text-xs text-ink-4">…</span> : null}
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {q.trim().length < 2 ? (
            <p className="px-3 py-6 text-center text-xs text-ink-4">Type at least 2 characters to search the whole platform.</p>
          ) : total === 0 && !loading ? (
            <p className="px-3 py-6 text-center text-xs text-ink-4">No matches for “{q.trim()}”.</p>
          ) : (
            sections.map((s) =>
              s.rows.length ? (
                <div key={s.title} className="mb-1">
                  <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4">{s.title}</div>
                  <div className={cn("space-y-0.5")}>{s.rows}</div>
                </div>
              ) : null
            )
          )}
        </div>
        <div className="border-t border-ink/20 px-4 py-2 text-[11px] text-ink-4">
          <Link href="/platform/tenants" onClick={onClose} className="underline">Accounts</Link>
          {" · "}
          <Link href="/platform/billing" onClick={onClose} className="underline">Billing</Link>
          {" · "}
          <Link href="/platform/support" onClick={onClose} className="underline">Support</Link>
          {" · Esc to close"}
        </div>
      </div>
    </div>
  );
}
