"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api, type MeData } from "@/lib/api";
import { logout } from "@/lib/auth";
import { Modal, Pill, controlClass } from "@/components/ui";
import { CheckCircleIcon, ChevronDownIcon, LogOutIcon, ShieldIcon } from "./icons";

const pwSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export function UserMenu({ me }: { me: MeData }) {
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { register, handleSubmit, reset } = useForm<z.infer<typeof pwSchema>>({
    resolver: zodResolver(pwSchema),
  });

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function onLogout() {
    await logout().catch(() => undefined);
    window.location.href = "/login";
  }

  async function onPassword(v: z.infer<typeof pwSchema>) {
    try {
      await api("/api/v1/auth/change-password", { method: "POST", body: JSON.stringify(v) });
      toast.success("Password changed — please sign in again");
      reset();
      setPwOpen(false);
      setOpen(false);
      await logout().catch(() => undefined);
      window.location.href = "/login";
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Change failed");
    }
  }

  const initials = (me.user.name || me.user.email || "U").slice(0, 2).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-ink/5",
          open && "bg-ink/5"
        )}
      >
        <span className="flex size-8 items-center justify-center rounded-lg bg-ink font-mono text-[11px] font-bold text-gold shadow-pop">
          {initials}
        </span>
        <span className="hidden max-w-[9rem] truncate text-sm font-medium text-ink sm:block">
          {me.user.name || "Account"}
        </span>
        <ChevronDownIcon
          size={14}
          className={cn("hidden text-ink-4 transition-transform duration-200 sm:block", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="g-floating absolute right-0 z-40 mt-2 w-72 animate-fade-in overflow-hidden">
          <div className="flex items-center gap-3 border-b border-ink/[0.07] px-4 py-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink font-mono text-sm font-bold text-gold">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink">{me.user.name}</div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-ink-4">{me.user.email}</div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 border-b border-ink/[0.07] px-4 py-2.5">
            <Pill tone="success" dot icon={<CheckCircleIcon size={11} />}>
              Session active
            </Pill>
            <span className="g-metric text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-5">
              {String(me.permissions.length).padStart(2, "0")} perms
            </span>
          </div>
          <div className="p-1.5">
            <button
              onClick={() => {
                setPwOpen(true);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink-2 transition-colors hover:bg-ink/5"
            >
              <ShieldIcon size={15} className="text-ink-4" />
              Change password
            </button>
            <button
              onClick={onLogout}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink-2 transition-colors hover:bg-rose-50 hover:text-rose-700"
            >
              <LogOutIcon size={15} className="text-ink-4" />
              Sign out
            </button>
          </div>
        </div>
      ) : null}
      {pwOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
          onClick={() => setPwOpen(false)}
        >
          <form
            onSubmit={handleSubmit(onPassword)}
            className="g-floating w-full max-w-sm animate-fade-in space-y-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="g-kicker">Security</div>
              <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-ink">
                Change password
              </h2>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">Current password</label>
              <input type="password" className={controlClass} {...register("currentPassword")} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">
                New password (min 8)
              </label>
              <input type="password" className={controlClass} {...register("newPassword")} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPwOpen(false)}
                className="g-btn g-btn-secondary h-9 px-3.5 text-sm"
              >
                Cancel
              </button>
              <button type="submit" className="g-btn g-btn-primary h-9 px-3.5 text-sm">
                Save
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
