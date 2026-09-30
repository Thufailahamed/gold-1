"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Callout, controlClass } from "@/components/ui";
import { F } from "@/components/platform/dialogs";
import { PlatformWordmark } from "@/components/platform/shell";
import { cn } from "@/lib/cn";
import { papi } from "@/lib/platform";

/**
 * First-run: creates the first super admin. The API only allows this while
 * there are no staff accounts AND the caller knows PLATFORM_BOOTSTRAP_TOKEN.
 */
export default function PlatformSetupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ token: "", name: "", email: "", password: "", confirm: "" });
  const [pending, setPending] = useState(false);
  const boot = useQuery({ queryKey: ["platform-bootstrap"], queryFn: () => papi<{ needsBootstrap: boolean }>("/auth/bootstrap"), retry: false });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setPending(true);
    try {
      const { confirm: _c, ...body } = form;
      await papi("/auth/bootstrap", { method: "POST", json: body });
      await papi("/auth/login", { method: "POST", json: { email: form.email, password: form.password } });
      toast.success("Super admin created — set up two-factor next");
      router.replace("/platform/account");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-void px-4 py-10">
      <div className="pointer-events-none absolute -right-24 -top-32 size-[28rem] rounded-full bg-gold/15 blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <PlatformWordmark />
        </div>
        <div className="g-elevated p-6 sm:p-8">
          <div className="g-kicker">First-run setup</div>
          <h1 className="g-display mt-2 text-2xl text-ink">Create the first super admin</h1>
          {boot.data && !boot.data.needsBootstrap ? (
            <Callout tone="warning" className="mt-5" title="Already set up">
              This platform already has administrators. <a href="/platform/login" className="underline">Sign in</a> instead.
            </Callout>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <F label="Bootstrap token" hint="The PLATFORM_BOOTSTRAP_TOKEN secret set on the API worker.">
                <input type="password" required value={form.token} onChange={set("token")} className={cn(controlClass, "w-full font-mono")} />
              </F>
              <F label="Full name">
                <input required value={form.name} onChange={set("name")} className={cn(controlClass, "w-full")} />
              </F>
              <F label="Work email">
                <input type="email" required autoComplete="username" value={form.email} onChange={set("email")} className={cn(controlClass, "w-full")} />
              </F>
              <div className="grid gap-4 sm:grid-cols-2">
                <F label="Password" hint="12+ characters">
                  <input type="password" required minLength={12} autoComplete="new-password" value={form.password} onChange={set("password")} className={cn(controlClass, "w-full")} />
                </F>
                <F label="Confirm">
                  <input type="password" required autoComplete="new-password" value={form.confirm} onChange={set("confirm")} className={cn(controlClass, "w-full", mismatch && "shadow-[inset_0_0_0_1px_#be123c]")} />
                </F>
              </div>
              <button
                type="submit"
                disabled={pending || mismatch || form.password.length < 12 || form.token.length < 16}
                className="g-btn g-btn-primary h-11 w-full text-sm"
              >
                {pending ? "Creating…" : "Create super admin"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
