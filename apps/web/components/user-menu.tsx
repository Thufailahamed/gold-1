"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api, type MeData } from "@/lib/api";
import { logout } from "@/lib/auth";

const pwSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export function UserMenu({ me }: { me: MeData }) {
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const { register, handleSubmit, reset } = useForm<z.infer<typeof pwSchema>>({
    resolver: zodResolver(pwSchema),
  });

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

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100"
      >
        {me.user.name}
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-56 rounded-md border border-stone-200 bg-white shadow-lg">
          <div className="border-b border-stone-100 px-4 py-2 text-xs text-stone-500">
            {me.user.email}
          </div>
          <button
            onClick={() => {
              setPwOpen(true);
              setOpen(false);
            }}
            className="block w-full px-4 py-2 text-left text-sm hover:bg-stone-100"
          >
            Change password
          </button>
          <button
            onClick={onLogout}
            className="block w-full px-4 py-2 text-left text-sm hover:bg-stone-100"
          >
            Sign out
          </button>
        </div>
      ) : null}
      {pwOpen ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <form
            onSubmit={handleSubmit(onPassword)}
            className="w-full max-w-sm space-y-3 rounded-xl bg-white p-6 shadow-lg"
          >
            <h2 className="font-semibold">Change password</h2>
            <div>
              <label className="mb-1 block text-sm font-medium">Current password</label>
              <input
                type="password"
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                {...register("currentPassword")}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">New password (min 8)</label>
              <input
                type="password"
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                {...register("newPassword")}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPwOpen(false)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button type="submit" className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white">
                Save
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
