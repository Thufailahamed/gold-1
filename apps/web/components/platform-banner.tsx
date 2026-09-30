"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { AnnouncementPreview } from "@/components/platform/announcement-preview";
import { AlertCircleIcon, ShieldIcon, XIcon } from "@/components/icons";

type Limit = { used: number; max: number | null; near: boolean; over: boolean };
export type PlatformContext =
  | { managed: false }
  | {
      managed: true;
      tenant: { name: string; slug: string; status: string };
      maintenance: string | null;
      supportEmail: string;
      subscription?: { plan: string; status: string; trialEndsAt: number | null; currentPeriodEnd: number; cancelAtPeriodEnd: boolean } | null;
      billing?: { openInvoices: number; balanceCents: number; firstDueAt: number | null };
      limits?: { users: Limit; branches: Limit; products: Limit } | null;
      features?: Record<string, boolean>;
      announcements?: Array<{ id: string; title: string; body: string; severity: string }>;
    };

const DISMISS_KEY = "goldos_dismissed_announcements";

function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function usePlatformContext() {
  return useQuery({
    queryKey: ["platform-context"],
    queryFn: () => api<PlatformContext>("/api/v1/platform/context"),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

function days(ms: number) {
  return Math.max(0, Math.ceil(ms / 864e5));
}

/**
 * Account notices from the platform: staff sign-in, trial clock, overdue
 * balance, pending cancellation, plan limits and published announcements.
 * Renders nothing on an unmanaged (single-shop) deployment.
 */
export function PlatformBanner() {
  const ctx = usePlatformContext();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [imp, setImp] = useState<{ as: string; by: string | null } | null>(null);
  useEffect(() => {
    setDismissed(readDismissed());
    try {
      const raw = sessionStorage.getItem("goldos_impersonation");
      if (raw) setImp(JSON.parse(raw) as { as: string; by: string | null });
    } catch {
      setImp(null);
    }
  }, []);

  const d = ctx.data;
  if (!d || !d.managed) return imp ? <ImpersonationStrip imp={imp} /> : null;

  const now = Date.now();
  const notices: Array<{ key: string; tone: "warning" | "danger" | "info"; text: React.ReactNode }> = [];
  const s = d.subscription;
  if (s?.status === "TRIALING" && s.trialEndsAt && s.trialEndsAt - now < 7 * 864e5)
    notices.push({ key: "trial", tone: "info", text: <>Your {s.plan} trial ends in {days(s.trialEndsAt - now)} day{days(s.trialEndsAt - now) === 1 ? "" : "s"}. Contact <a className="underline" href={`mailto:${d.supportEmail}`}>{d.supportEmail}</a> to continue without interruption.</> });
  if (s?.status === "PAST_DUE" || (d.billing?.firstDueAt && d.billing.firstDueAt < now && (d.billing.balanceCents ?? 0) > 0))
    notices.push({
      key: "pastdue",
      tone: "danger",
      text: <>Payment overdue: LKR {((d.billing?.balanceCents ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}. Access is suspended if it stays unpaid — contact <a className="underline" href={`mailto:${d.supportEmail}`}>{d.supportEmail}</a>.</>,
    });
  if (s?.cancelAtPeriodEnd)
    notices.push({ key: "cancel", tone: "warning", text: <>Your subscription ends on {new Date(s.currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.</> });
  for (const [k, l] of Object.entries(d.limits ?? {})) {
    if (l.over) notices.push({ key: `limit-${k}`, tone: "warning", text: <>You&rsquo;ve reached your plan&rsquo;s limit of {l.max} {k}. Upgrade to add more.</> });
    else if (l.near) notices.push({ key: `limit-${k}`, tone: "info", text: <>You&rsquo;re using {l.used} of {l.max} {k} on your plan.</> });
  }
  const announcements = (d.announcements ?? []).filter((a) => !dismissed.includes(a.id));
  if (!imp && notices.length === 0 && announcements.length === 0) return null;

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next.slice(-50)));
    } catch {
      // Dismissal just won't persist across reloads.
    }
  };

  return (
    <div className="mb-5 space-y-2">
      {imp ? <ImpersonationStrip imp={imp} /> : null}
      {notices.map((n) => (
        <div
          key={n.key}
          role={n.tone === "danger" ? "alert" : "status"}
          className={cn(
            "flex items-start gap-3 rounded-xl px-4 py-3 text-sm ring-1",
            n.tone === "danger" ? "bg-rose-50 text-rose-900 ring-rose-600/25" : n.tone === "warning" ? "bg-amber-50 text-amber-950 ring-amber-600/25" : "bg-gold/[0.07] text-ink ring-gold-dark/20"
          )}
        >
          <AlertCircleIcon size={16} className="mt-0.5 shrink-0" />
          <span>{n.text}</span>
        </div>
      ))}
      {announcements.map((a) => (
        <div key={a.id} className="relative">
          <AnnouncementPreview a={a} />
          {a.severity !== "CRITICAL" ? (
            <button onClick={() => dismiss(a.id)} aria-label="Dismiss announcement" className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-lg text-ink-4 hover:bg-ink/5 hover:text-ink">
              <XIcon size={14} />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ImpersonationStrip({ imp }: { imp: { as: string; by: string | null } }) {
  return (
    <div className="mb-2 flex items-center gap-3 rounded-xl bg-ink px-4 py-2.5 text-sm text-paper">
      <ShieldIcon size={15} className="shrink-0 text-gold" />
      <span className="min-w-0 flex-1 truncate">
        Staff session{imp.by ? ` · ${imp.by}` : ""} signed in as <strong>{imp.as}</strong>. Actions are audited.
      </span>
      <Link href="/support" className="shrink-0 text-xs text-gold underline">
        Support
      </Link>
    </div>
  );
}
