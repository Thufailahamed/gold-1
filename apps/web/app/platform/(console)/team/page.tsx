"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PLATFORM_PERMISSIONS as P, PLATFORM_ROLE_KEYS, PLATFORM_ROLES, type PlatformRole } from "@goldos/shared";
import { CellStack, EmptyBlock, Hero, heroBtnPrimary, Modal, Page, Panel, Pill, StatusPill, TableCard, TableSkeleton, controlClass } from "@/components/ui";
import { PlusIcon, ShieldIcon } from "@/components/icons";
import { F, ReasonDialog } from "@/components/platform/dialogs";
import { cn } from "@/lib/cn";
import { can, papi, relative, usePlatformMe } from "@/lib/platform";

type Admin = {
  id: string;
  email: string;
  name: string;
  role: PlatformRole;
  is_active: number;
  mfa_enabled: number;
  last_login_at: number | null;
  last_login_ip: string | null;
  locked_until: number | null;
  created_at: number;
};

type Action = { kind: "deactivate" | "activate" | "reset-mfa" | "revoke-sessions" | "reset-password" | "role"; admin: Admin };

export default function TeamPage() {
  const me = usePlatformMe();
  const qc = useQueryClient();
  const manage = can(me.data, P.ADMINS_MANAGE);
  const [inviting, setInviting] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const q = useQuery({ queryKey: ["p-team"], queryFn: () => papi<Admin[]>("/team") });
  const rows = q.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["p-team"] });

  return (
    <Page className="max-w-[88rem]">
      <Hero
        kicker="Administration"
        title="Team"
        description="Staff who can operate the platform. Roles are fixed bundles of permissions; every action anyone takes is audited."
        actions={
          manage ? (
            <button onClick={() => setInviting(true)} className={heroBtnPrimary}>
              <PlusIcon size={15} /> Add staff member
            </button>
          ) : undefined
        }
        stats={[
          { label: "Active staff", value: rows.filter((a) => a.is_active).length },
          { label: "Super admins", value: rows.filter((a) => a.is_active && a.role === "super_admin").length },
          { label: "With 2FA", value: `${rows.filter((a) => a.is_active && a.mfa_enabled).length} / ${rows.filter((a) => a.is_active).length}` },
          { label: "Locked out", value: rows.filter((a) => a.locked_until && a.locked_until > Date.now()).length },
        ]}
      />

      <TableCard>
        {q.isLoading ? (
          <TableSkeleton rows={4} cols={6} />
        ) : rows.length === 0 ? (
          <EmptyBlock title="No staff" />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Staff member</th>
                <th>Role</th>
                <th>Status</th>
                <th>2FA</th>
                <th>Last sign-in</th>
                <th className="!text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const self = a.id === me.data?.admin.id;
                const locked = a.locked_until && a.locked_until > Date.now();
                return (
                  <tr key={a.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink font-mono text-[10px] font-bold text-gold">{a.name.slice(0, 2).toUpperCase()}</span>
                        <CellStack primary={<>{a.name}{self ? <span className="ml-1.5 text-xs font-normal text-ink-4">(you)</span> : null}</>} secondary={a.email} />
                      </div>
                    </td>
                    <td>
                      <Pill tone={a.role === "super_admin" ? "dark" : "neutral"}>{PLATFORM_ROLES[a.role]?.label ?? a.role}</Pill>
                    </td>
                    <td>
                      {locked ? <Pill tone="danger" dot>Locked · {relative(a.locked_until)}</Pill> : <StatusPill status={a.is_active ? "active" : "inactive"} label={a.is_active ? "Active" : "Deactivated"} />}
                    </td>
                    <td>{a.mfa_enabled ? <Pill tone="success">On</Pill> : <Pill tone="warning">Off</Pill>}</td>
                    <td className="text-ink-3">
                      <CellStack primary={relative(a.last_login_at)} secondary={a.last_login_ip ?? undefined} />
                    </td>
                    <td className="text-right">
                      {manage && !self ? (
                        <select
                          aria-label={`Actions for ${a.name}`}
                          value=""
                          onChange={(e) => e.target.value && setAction({ kind: e.target.value as Action["kind"], admin: a })}
                          className="h-8 rounded-lg bg-paper px-2 text-xs shadow-[inset_0_0_0_1px_rgba(28,25,23,0.14)]"
                        >
                          <option value="">Manage…</option>
                          <option value="role">Change role</option>
                          <option value="reset-password">Set new password</option>
                          {a.mfa_enabled ? <option value="reset-mfa">Reset 2FA</option> : null}
                          <option value="revoke-sessions">Sign out everywhere</option>
                          {a.is_active ? <option value="deactivate">Deactivate</option> : <option value="activate">Reactivate</option>}
                        </select>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>

      <Panel title="Roles" description="What each role can do. Permissions are enforced by the API, not the menu." icon={<ShieldIcon size={16} />}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {PLATFORM_ROLE_KEYS.map((k) => (
            <div key={k} className="rounded-xl bg-bone/70 p-4 ring-1 ring-ink/[0.06]">
              <div className="font-semibold text-ink">{PLATFORM_ROLES[k].label}</div>
              <p className="mt-1 text-xs text-ink-4">{PLATFORM_ROLES[k].description}</p>
              <ul className="mt-3 space-y-1">
                {PLATFORM_ROLES[k].permissions.map((p) => (
                  <li key={p} className="font-mono text-[10px] text-ink-3">
                    {p.replace(/^p\./, "")}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Panel>

      {inviting ? <InviteDialog onClose={() => setInviting(false)} onDone={refresh} /> : null}
      {action?.kind === "role" ? <RoleDialog admin={action.admin} onClose={() => setAction(null)} onDone={refresh} /> : null}
      {action?.kind === "reset-password" ? <PasswordDialog admin={action.admin} onClose={() => setAction(null)} onDone={refresh} /> : null}
      {action && ["deactivate", "activate", "reset-mfa"].includes(action.kind) ? (
        <ReasonDialog
          title={{ deactivate: `Deactivate ${action.admin.name}`, activate: `Reactivate ${action.admin.name}`, "reset-mfa": `Reset 2FA for ${action.admin.name}` }[action.kind as "deactivate"]}
          danger={action.kind !== "activate"}
          description={
            {
              deactivate: "They are signed out immediately and cannot sign in again.",
              activate: "They can sign in again with their existing password.",
              "reset-mfa": "Removes their authenticator and signs them out. Use when a device is lost; they should re-enrol at once.",
            }[action.kind as "deactivate"]
          }
          onClose={() => setAction(null)}
          onSubmit={async (reason) => {
            await papi(`/team/${action.admin.id}/${action.kind}`, { method: "POST", json: { reason } });
            toast.success("Done");
            refresh();
          }}
        />
      ) : null}
      {action?.kind === "revoke-sessions" ? (
        <Modal
          title={`Sign ${action.admin.name} out everywhere?`}
          kicker="Sessions"
          onClose={() => setAction(null)}
          danger
          submitLabel="Sign out"
          onSubmit={async () => {
            try {
              await papi(`/team/${action.admin.id}/revoke-sessions`, { method: "POST" });
              toast.success("All sessions revoked");
              setAction(null);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed");
            }
          }}
        >
          <p className="text-sm text-ink-3">Every browser they are signed in on will need a fresh sign-in.</p>
        </Modal>
      ) : null}
    </Page>
  );
}

function InviteDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", email: "", password: "", role: "support" as PlatformRole });
  const m = useMutation({
    mutationFn: () => papi("/team", { method: "POST", json: f }),
    onSuccess: () => {
      toast.success("Staff member added — share the temporary password securely");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const gen = () => {
    const a = crypto.getRandomValues(new Uint8Array(12));
    setF((s) => ({ ...s, password: Array.from(a, (b) => "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 55]).join("") + "!7" }));
  };
  return (
    <Modal title="Add staff member" kicker="Team" onClose={onClose} onSubmit={() => m.mutate()} submitLabel="Add" pending={m.isPending} submitDisabled={!f.name || !f.email || f.password.length < 12}>
      <F label="Full name">
        <input autoFocus value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} className={cn(controlClass, "w-full")} />
      </F>
      <F label="Work email">
        <input type="email" value={f.email} onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} className={cn(controlClass, "w-full")} />
      </F>
      <F label="Role" hint={PLATFORM_ROLES[f.role].description}>
        <select value={f.role} onChange={(e) => setF((s) => ({ ...s, role: e.target.value as PlatformRole }))} className={cn(controlClass, "w-full")}>
          {PLATFORM_ROLE_KEYS.map((k) => (
            <option key={k} value={k}>
              {PLATFORM_ROLES[k].label}
            </option>
          ))}
        </select>
      </F>
      <F label="Temporary password" hint="12+ characters. They should change it and enable 2FA on first sign-in.">
        <div className="flex gap-2">
          <input value={f.password} onChange={(e) => setF((s) => ({ ...s, password: e.target.value }))} className={cn(controlClass, "w-full font-mono")} />
          <button type="button" onClick={gen} className="g-btn g-btn-secondary h-10 shrink-0 px-3 text-xs">
            Generate
          </button>
        </div>
      </F>
    </Modal>
  );
}

function RoleDialog({ admin, onClose, onDone }: { admin: Admin; onClose: () => void; onDone: () => void }) {
  const [role, setRole] = useState<PlatformRole>(admin.role);
  const m = useMutation({
    mutationFn: () => papi(`/team/${admin.id}`, { method: "PATCH", json: { role } }),
    onSuccess: () => {
      toast.success("Role changed — their sessions were signed out");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <Modal title={`Change role for ${admin.name}`} kicker="Team" onClose={onClose} onSubmit={() => m.mutate()} submitLabel="Change role" pending={m.isPending} submitDisabled={role === admin.role}>
      <div className="space-y-2">
        {PLATFORM_ROLE_KEYS.map((k) => (
          <label key={k} className={cn("flex cursor-pointer gap-3 rounded-xl p-3 ring-1", role === k ? "bg-gold-pale ring-gold-dark/30" : "ring-ink/10")}>
            <input type="radio" checked={role === k} onChange={() => setRole(k)} className="mt-1 accent-ink" />
            <span>
              <span className="block text-sm font-medium">{PLATFORM_ROLES[k].label}</span>
              <span className="block text-xs text-ink-4">{PLATFORM_ROLES[k].description}</span>
            </span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

function PasswordDialog({ admin, onClose, onDone }: { admin: Admin; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const m = useMutation({
    mutationFn: () => papi(`/team/${admin.id}/reset-password`, { method: "POST", json: { password } }),
    onSuccess: () => {
      toast.success("Password set and sessions revoked");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <Modal title={`New password for ${admin.name}`} kicker="Team" onClose={onClose} onSubmit={() => m.mutate()} submitLabel="Set password" pending={m.isPending} submitDisabled={password.length < 12}>
      <F label="New password" hint="12+ characters. Also clears any lockout.">
        <input autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className={cn(controlClass, "w-full font-mono")} />
      </F>
    </Modal>
  );
}
