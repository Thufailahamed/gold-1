"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PLATFORM_ROLES } from "@goldos/shared";
import { Callout, DetailList, Hero, Modal, Page, Panel, Pill, TableCard, controlClass } from "@/components/ui";
import { KeyIcon, ShieldIcon } from "@/components/icons";
import { F } from "@/components/platform/dialogs";
import { cn } from "@/lib/cn";
import { dateTime, papi, relative, usePlatformMe } from "@/lib/platform";

type Session = { id: string; ip: string | null; user_agent: string | null; created_at: number; last_seen_at: number; expires_at: number; current: boolean };

function device(ua: string | null) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` on ${os}` : ""}`;
}

export default function AccountPage() {
  const me = usePlatformMe();
  const qc = useQueryClient();
  const [enrol, setEnrol] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [disabling, setDisabling] = useState(false);
  const sessions = useQuery({ queryKey: ["p-sessions"], queryFn: () => papi<Session[]>("/auth/sessions") });
  const a = me.data?.admin;
  const begin = useMutation({
    mutationFn: () => papi<{ secret: string; otpauthUri: string }>("/auth/mfa/enroll", { method: "POST" }),
    onSuccess: setEnrol,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => papi(`/auth/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["p-sessions"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Page className="max-w-5xl">
      <Hero kicker="Your account" title={a?.name ?? "…"} description={a?.email} meta={a ? <Pill tone="ghost">{PLATFORM_ROLES[a.role as keyof typeof PLATFORM_ROLES]?.label ?? a.role}</Pill> : null} />

      {a && !a.mfa_enabled ? (
        <Callout tone="warning" title="Turn on two-factor authentication" action={<button onClick={() => begin.mutate()} className="g-btn g-btn-primary h-9 px-3 text-sm">Set up now</button>}>
          Platform staff can reach every shop&rsquo;s data. A password alone is not enough protection.
        </Callout>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Two-factor authentication" icon={<KeyIcon size={16} />}>
          {a?.mfa_enabled ? (
            <div className="space-y-4">
              <p className="flex items-center gap-2 text-sm">
                <Pill tone="success" dot>Enabled</Pill> Codes from your authenticator app are required at sign-in.
              </p>
              <button onClick={() => setDisabling(true)} className="g-btn g-btn-secondary h-10 px-4 text-sm text-rose-700">
                Turn off two-factor
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-ink-3">Use Google Authenticator, 1Password, Authy or any TOTP app.</p>
              <button onClick={() => begin.mutate()} disabled={begin.isPending} className="g-btn g-btn-primary h-10 px-4 text-sm">
                Set up two-factor
              </button>
            </div>
          )}
        </Panel>
        <PasswordPanel />
      </div>

      <Panel title="Profile" icon={<ShieldIcon size={16} />}>
        {a ? (
          <DetailList
            columns={3}
            items={[
              { label: "Email", value: a.email },
              { label: "Last sign-in", value: `${dateTime(a.last_login_at)}${a.last_login_ip ? ` · ${a.last_login_ip}` : ""}` },
              { label: "Staff since", value: dateTime(a.created_at) },
            ]}
          />
        ) : null}
      </Panel>

      <TableCard title="Active sessions" description="Sessions last 8 hours idle, 24 hours at most." icon={<ShieldIcon size={16} />}>
        <table className="g-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>IP</th>
              <th>Signed in</th>
              <th>Last seen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(sessions.data ?? []).map((s) => (
              <tr key={s.id}>
                <td>
                  {device(s.user_agent)} {s.current ? <Pill tone="success">This device</Pill> : null}
                </td>
                <td className="font-mono text-xs text-ink-3">{s.ip ?? "—"}</td>
                <td className="text-ink-3">{dateTime(s.created_at)}</td>
                <td className="text-ink-3">{relative(s.last_seen_at)}</td>
                <td className="text-right">
                  {!s.current ? (
                    <button onClick={() => revoke.mutate(s.id)} className="text-xs font-medium text-rose-700 hover:underline">
                      Sign out
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      {enrol ? (
        <EnrolDialog
          enrol={enrol}
          onClose={() => setEnrol(null)}
          onDone={() => {
            setEnrol(null);
            qc.invalidateQueries({ queryKey: ["platform-me"] });
          }}
        />
      ) : null}
      {disabling ? <DisableDialog onClose={() => setDisabling(false)} onDone={() => qc.invalidateQueries({ queryKey: ["platform-me"] })} /> : null}
    </Page>
  );
}

function EnrolDialog({ enrol, onClose, onDone }: { enrol: { secret: string; otpauthUri: string }; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState("");
  const confirm = useMutation({
    mutationFn: () => papi("/auth/mfa/confirm", { method: "POST", json: { code } }),
    onSuccess: () => {
      toast.success("Two-factor enabled");
      onDone();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Invalid code");
      setCode("");
    },
  });
  return (
    <Modal title="Set up two-factor" kicker="Security" onClose={onClose} onSubmit={() => confirm.mutate()} submitLabel="Verify & enable" pending={confirm.isPending} submitDisabled={code.length !== 6}>
      <ol className="list-decimal space-y-3 pl-5 text-sm text-ink-3">
        <li>
          In your authenticator app, add an account by <strong>setup key</strong> and paste:
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded-lg bg-bone px-3 py-2 font-mono text-sm tracking-wider text-ink ring-1 ring-ink/[0.08]">{enrol.secret.match(/.{1,4}/g)?.join(" ")}</code>
            <button type="button" onClick={() => navigator.clipboard.writeText(enrol.secret).then(() => toast.success("Copied"))} className="g-btn g-btn-secondary h-9 shrink-0 px-3 text-xs">
              Copy
            </button>
          </div>
          <span className="mt-1 block text-xs text-ink-4">
            Or on this device: <a href={enrol.otpauthUri} className="text-gold-dark underline">open in authenticator</a>. Type: time-based, 6 digits, 30 s.
          </span>
        </li>
        <li>Enter the 6-digit code it shows:</li>
      </ol>
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        aria-label="6-digit code"
        className={cn(controlClass, "h-12 w-full text-center font-mono text-xl tracking-[0.5em]")}
      />
    </Modal>
  );
}

function DisableDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState("");
  const m = useMutation({
    mutationFn: () => papi("/auth/mfa/disable", { method: "POST", json: { code } }),
    onSuccess: () => {
      toast.success("Two-factor turned off");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Invalid code"),
  });
  return (
    <Modal title="Turn off two-factor?" kicker="Security" danger onClose={onClose} onSubmit={() => m.mutate()} submitLabel="Turn off" pending={m.isPending} submitDisabled={code.length !== 6}>
      <p className="text-sm text-ink-3">Confirm with a current code from your authenticator.</p>
      <input inputMode="numeric" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="6-digit code" className={cn(controlClass, "h-12 w-full text-center font-mono text-xl tracking-[0.5em]")} />
    </Modal>
  );
}

function PasswordPanel() {
  const [f, setF] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const mismatch = f.confirm.length > 0 && f.confirm !== f.newPassword;
  const m = useMutation({
    mutationFn: () => papi("/auth/password", { method: "POST", json: { currentPassword: f.currentPassword, newPassword: f.newPassword } }),
    onSuccess: () => {
      toast.success("Password changed — other devices were signed out");
      setF({ currentPassword: "", newPassword: "", confirm: "" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <Panel title="Password" icon={<KeyIcon size={16} />}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!mismatch) m.mutate();
        }}
        className="space-y-3"
      >
        <F label="Current password">
          <input type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF((s) => ({ ...s, currentPassword: e.target.value }))} className={cn(controlClass, "w-full")} />
        </F>
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="New password" hint="12+ characters">
            <input type="password" autoComplete="new-password" value={f.newPassword} onChange={(e) => setF((s) => ({ ...s, newPassword: e.target.value }))} className={cn(controlClass, "w-full")} />
          </F>
          <F label="Confirm">
            <input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF((s) => ({ ...s, confirm: e.target.value }))} className={cn(controlClass, "w-full", mismatch && "shadow-[inset_0_0_0_1px_#be123c]")} />
          </F>
        </div>
        <button type="submit" disabled={m.isPending || mismatch || f.newPassword.length < 12 || !f.currentPassword} className="g-btn g-btn-primary h-10 px-4 text-sm">
          Change password
        </button>
      </form>
    </Panel>
  );
}
