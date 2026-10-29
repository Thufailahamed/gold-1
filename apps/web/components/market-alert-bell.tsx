"use client";

// Top-bar bell: price alerts fired by the market-desk rules. Polls once a
// minute; when the browser allows it, a new alert also pops a desktop
// notification so it is seen even with Live Rates closed.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { BellIcon } from "@/components/icons";

type Events = {
  events: { id: string; firedAt: number; message: string; seen: boolean; target: string | null }[];
  unseen: number;
};

const NOTIFIED_KEY = "goldos.alerts.notifiedAt";

function readNotified(): number | null {
  try {
    const v = localStorage.getItem(NOTIFIED_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}
function writeNotified(t: number) {
  try {
    localStorage.setItem(NOTIFIED_KEY, String(t));
  } catch {
    /* private mode: notifications just repeat less carefully */
  }
}

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return new Date(t).toLocaleDateString();
};

export function MarketAlertBell({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ["market-alerts"],
    queryFn: () => api<Events>("/api/v1/market-desk/alerts"),
    refetchInterval: 60_000,
    enabled,
    retry: false,
  });
  const seen = useMutation({
    mutationFn: () => api("/api/v1/market-desk/alerts/seen", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["market-alerts"] }),
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Desktop notifications for alerts fired since the last one we showed.
  useEffect(() => {
    const evs = q.data?.events;
    if (!evs?.length) return;
    const newest = Math.max(...evs.map((e) => e.firedAt));
    const last = readNotified();
    if (last == null) {
      writeNotified(newest);
      return;
    }
    const fresh = evs.filter((e) => e.firedAt > last && !e.seen).slice(0, 3);
    if (fresh.length && typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const e of fresh) {
        try {
          new Notification("GoldOS price alert", { body: e.message, tag: e.id });
        } catch {
          /* some browsers only allow notifications from a service worker */
        }
      }
    }
    if (newest > last) writeNotified(newest);
  }, [q.data]);

  const unseen = q.data?.unseen ?? 0;
  const events = q.data?.events.slice(0, 8) ?? [];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        title="Notifications"
        aria-label={unseen ? `Notifications, ${unseen} new` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((b) => !b)}
        className="relative flex size-9 items-center justify-center rounded-lg text-ink transition-colors hover:bg-ink/5"
      >
        <BellIcon size={16} />
        {unseen ? (
          <span className="g-metric absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9.5px] font-bold text-white ring-2 ring-bone">
            {unseen > 9 ? "9+" : unseen}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="g-floating absolute right-0 z-40 mt-2 w-[22rem] animate-fade-in overflow-hidden">
          <div className="flex items-center justify-between border-b border-ink/20 px-4 py-3">
            <span className="g-kicker">Price alerts</span>
            <div className="flex items-center gap-2">
              {unseen ? (
                <button onClick={() => seen.mutate()} className="text-[11px] font-semibold text-gold-deep hover:underline">
                  Mark all read
                </button>
              ) : null}
              <span className="g-metric rounded-full bg-ink/[0.06] px-2 py-0.5 text-[10px] font-semibold text-ink-4">{String(unseen).padStart(2, "0")}</span>
            </div>
          </div>
          {events.length ? (
            <ul className="max-h-80 divide-y divide-ink/[0.05] overflow-y-auto scrollbar-thin">
              {events.map((e) => (
                <li key={e.id} className={cn("flex gap-2.5 px-4 py-2.5", !e.seen && "bg-gold-pale/40")}>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", e.seen ? "bg-ink/15" : "bg-rose-500")} />
                  <div className="min-w-0">
                    <p className="text-[12px] leading-snug text-ink">{e.message}</p>
                    <p className="mt-0.5 text-[10.5px] text-ink-5">{ago(e.firedAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4">
              <div className="flex flex-col items-center rounded-xl border border-dashed border-ink/20 bg-bone/50 px-5 py-8 text-center">
                <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-paper text-ink-4 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)]">
                  <BellIcon size={18} />
                </span>
                <p className="text-sm font-medium text-ink">All clear</p>
                <p className="mt-1 max-w-[15rem] text-xs leading-relaxed text-ink-4">Price alerts you set on Live Rates land here.</p>
              </div>
            </div>
          )}
          {enabled ? (
            <Link
              href="/live-rates/alerts"
              onClick={() => setOpen(false)}
              className="block border-t border-ink/20 px-4 py-2.5 text-center text-[12px] font-semibold text-gold-deep hover:bg-gold-pale/30"
            >
              Manage alerts →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
