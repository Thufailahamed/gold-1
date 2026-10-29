"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Callout, EmptyBlock, Hero, Modal, Page, Pager, SearchField, TableCard, TableSkeleton, Tabs, Toolbar, controlClass, controlSmClass } from "@/components/ui";
import { UsersIcon, FileTextIcon, HistoryIcon, SettingsIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { lkr } from "@/lib/accounts";

type Invoice = {
  id: string;
  number: string;
  customer_id: string | null;
  customer_name: string | null;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  status: string;
  created_at: number;
};
type Paged = { rows: Invoice[]; total: number };

type SmsSettings = {
  configured: boolean;
  userId: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
  senderId: string;
  shopName: string;
  template: string;
  autoEnabled: boolean;
  autoAfterDays: number;
  repeatDays: number;
  sendHour: number;
  minAmountLkr: number;
};
type SmsLogRow = {
  id: string;
  customer_name: string | null;
  phone: string;
  message: string;
  kind: "MANUAL" | "AUTO" | "TEST";
  status: "SENT" | "FAILED";
  error: string | null;
  amount_cents: number | null;
  created_at: number;
};
type Outcome = { customerId: string; name: string; status: "SENT" | "FAILED" | "SKIPPED"; detail?: string };
type Target = { id: string; name: string };

const stamp = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const PLACEHOLDERS = "{name} {amount} {shop} {bills} {oldest}";

const DAY = 86_400_000;
const dateOf = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

function ageTone(days: number) {
  return days > 90 ? "text-rose-700" : days > 60 ? "text-amber-700" : "text-ink-3";
}

export default function CreditsPage() {
  const [tab, setTab] = useState<"bills" | "customers" | "log">("bills");
  const [q, setQ] = useState("");
  // Customer filters. Two people can share a name, so name, address and phone each narrow the list.
  const [nameQ, setNameQ] = useState("");
  const [addressQ, setAddressQ] = useState("");
  const [phoneQ, setPhoneQ] = useState("");
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [remind, setRemind] = useState<Target[] | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [logPage, setLogPage] = useState(1);
  const smsCfg = useQuery({ queryKey: ["sms-settings"], queryFn: () => api<SmsSettings>("/api/v1/sms/settings"), retry: false });
  const smsLog = useQuery({
    enabled: tab === "log",
    queryKey: ["sms-log", logPage],
    queryFn: () => api<{ rows: SmsLogRow[]; total: number }>(`/api/v1/sms/log?page=${logPage}&limit=20`),
  });
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // The search runs on the server, so a match on the bill, the customer's name, phone or address
  // is found even beyond the first page of results.
  const term = q.trim();
  const searchParam = term ? `&search=${encodeURIComponent(term)}` : "";
  const customerFilters = { customerName: nameQ.trim(), customerAddress: addressQ.trim(), customerPhone: phoneQ.trim() };
  const customerParam = Object.entries(customerFilters)
    .filter(([, v]) => v)
    .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`)
    .join("");
  const filtering = Boolean(term || customerParam);
  const unpaid = useQuery({
    queryKey: ["credits", "UNPAID", term, customerFilters],
    queryFn: () => api<Paged>(`/api/v1/sales/invoices?status=UNPAID&limit=100${searchParam}${customerParam}`),
  });
  const partial = useQuery({
    queryKey: ["credits", "PARTIAL", term, customerFilters],
    queryFn: () => api<Paged>(`/api/v1/sales/invoices?status=PARTIAL&limit=100${searchParam}${customerParam}`),
  });
  const loading = unpaid.isLoading || partial.isLoading;
  const error = (unpaid.error ?? partial.error) as Error | null;

  const now = Date.now();
  const rows = useMemo(
    () =>
      [...(unpaid.data?.rows ?? []), ...(partial.data?.rows ?? [])]
        .filter((r) => r.balance_cents > 0)
        .sort((a, b) => a.created_at - b.created_at),
    [unpaid.data, partial.data]
  );
  // Already filtered by the server (bill, name, phone, address).
  const shown = rows;
  const truncated = (unpaid.data?.total ?? 0) > 100 || (partial.data?.total ?? 0) > 100;

  const owed = rows.reduce((s, r) => s + r.balance_cents, 0);
  const received = rows.reduce((s, r) => s + r.paid_cents, 0);
  const over90 = rows.filter((r) => (now - r.created_at) / DAY > 90).reduce((s, r) => s + r.balance_cents, 0);

  const byCustomer = useMemo(() => {
    const m = new Map<string, { id: string | null; name: string; bills: number; owed: number; oldest: number }>();
    for (const r of shown) {
      const key = r.customer_id ?? "walk-in";
      const g = m.get(key) ?? { id: r.customer_id, name: r.customer_name ?? "Walk-in", bills: 0, owed: 0, oldest: r.created_at };
      g.bills += 1;
      g.owed += r.balance_cents;
      g.oldest = Math.min(g.oldest, r.created_at);
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => b.owed - a.owed);
  }, [shown]);

  return (
    <Page>
      <Hero
        compact
        kicker="Sales"
        title="Credits"
        description="Balances customers still owe from part-paid and credit sales. Each one is printed on the invoice as a balance due."
        stats={[
          { label: "To come in", value: loading ? "—" : lkr(owed) },
          { label: "Open bills", value: loading ? "—" : rows.length.toLocaleString("en-US") },
          { label: "Already paid on these", value: loading ? "—" : lkr(received) },
          { label: "Older than 90 days", value: loading ? "—" : lkr(over90) },
        ]}
        note="Collect a payment (cash, cheque, bank or card) from Customer dues — it clears the oldest bill first"
      />

      <Toolbar
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {selected.size > 0 ? (
              <button
                type="button"
                onClick={() => setRemind(byCustomer.filter((g) => g.id && selected.has(g.id)).map((g) => ({ id: g.id!, name: g.name })))}
                className="g-btn g-btn-primary h-10 shrink-0 px-4 text-xs"
              >
                SMS {selected.size} selected
              </button>
            ) : null}
            <button type="button" onClick={() => setShowSettings(true)} className="g-btn g-btn-secondary h-10 shrink-0 px-4 text-xs">
              <SettingsIcon size={13} /> SMS reminders{smsCfg.data?.autoEnabled ? " · auto on" : ""}
            </button>
            <SearchField value={q} onChange={setQ} placeholder="Search bill, name, phone or address" />
          </div>
        }
      >
        <Tabs
          ariaLabel="Credits view"
          value={tab}
          onChange={setTab}
          items={[
            { key: "bills", label: "By bill", icon: <FileTextIcon size={14} />, count: shown.length },
            { key: "customers", label: "By customer", icon: <UsersIcon size={14} />, count: byCustomer.length },
            { key: "log", label: "SMS sent", icon: <HistoryIcon size={14} /> },
          ]}
        />
      </Toolbar>

      {tab !== "log" ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <SearchField value={nameQ} onChange={setNameQ} placeholder="Customer name" className="sm:max-w-none" />
          <SearchField value={addressQ} onChange={setAddressQ} placeholder="Address" className="sm:max-w-none" />
          <SearchField value={phoneQ} onChange={setPhoneQ} placeholder="Phone number" className="sm:max-w-none" />
        </div>
      ) : null}

      {tab === "log" ? (
        <TableCard
          title="SMS sent"
          icon={<HistoryIcon size={17} />}
          description="Every reminder, manual or automatic, with what the gateway answered."
          footer={<Pager page={logPage} onChange={setLogPage} pageSize={20} count={smsLog.data?.rows.length ?? 0} total={smsLog.data?.total ?? 0} unit="messages" />}
        >
          {smsLog.isLoading ? (
            <TableSkeleton rows={5} cols={5} />
          ) : (smsLog.data?.rows.length ?? 0) === 0 ? (
            <EmptyBlock icon={<HistoryIcon size={22} />} title="No SMS sent yet" description="Reminders you send, or that go out automatically, are listed here." />
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Customer</th>
                  <th>Message</th>
                  <th>Type</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {smsLog.data!.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-ink-3">{stamp(r.created_at)}</td>
                    <td>
                      <div className="font-medium text-ink">{r.customer_name ?? "—"}</div>
                      <div className="text-xs text-ink-4">{r.phone}</div>
                    </td>
                    <td className="max-w-md text-ink-3"><span className="line-clamp-2">{r.message}</span></td>
                    <td className="text-ink-3">{r.kind === "AUTO" ? "Automatic" : r.kind === "TEST" ? "Test" : "Manual"}</td>
                    <td>
                      {r.status === "SENT" ? (
                        <span className="font-medium text-emerald-700">Sent</span>
                      ) : (
                        <span className="font-medium text-rose-700" title={r.error ?? ""}>Failed{r.error ? ` — ${r.error}` : ""}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : (
      <TableCard
        title={tab === "bills" ? "Credit bills" : "Customers who owe"}
        icon={<UsersIcon size={17} />}
        description={tab === "bills" ? "Oldest first. Paid is what the customer handed over at the sale or since." : "Largest balance first."}
      >
        {loading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : error ? (
          <EmptyBlock title="Could not load credits" description={error.message} />
        ) : shown.length === 0 ? (
          filtering ? (
            <EmptyBlock icon={<UsersIcon size={22} />} title="No matching credits" description="Check the name, address or phone you entered, or clear the search boxes." />
          ) : (
            <EmptyBlock icon={<UsersIcon size={22} />} title="No credits outstanding" description="When a customer pays only part of a bill, the rest appears here until it is collected." />
          )
        ) : tab === "bills" ? (
          <table className="g-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Date</th>
                <th className="!text-right">Bill total</th>
                <th className="!text-right">Paid</th>
                <th className="!text-right">Credit owed</th>
                <th className="!text-right">Age</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const days = Math.floor((now - r.created_at) / DAY);
                return (
                  <tr key={r.id}>
                    <td className="g-metric text-xs">
                      <Link href={`/sales/invoices/${r.id}`} className="underline-offset-2 hover:underline">
                        {r.number}
                      </Link>
                    </td>
                    <td className="font-medium text-ink">{r.customer_name ?? "—"}</td>
                    <td className="text-ink-3">{dateOf(r.created_at)}</td>
                    <td className="!text-right num-tabular">{lkr(r.total_cents)}</td>
                    <td className="!text-right num-tabular text-emerald-700">{lkr(r.paid_cents)}</td>
                    <td className="!text-right num-tabular font-semibold text-ink">{lkr(r.balance_cents)}</td>
                    <td className={`!text-right num-tabular ${ageTone(days)}`}>{days} d</td>
                    <td className="!text-right">
                      {r.customer_id ? (
                        <div className="flex justify-end gap-1.5">
                          <button type="button" onClick={() => setRemind([{ id: r.customer_id!, name: r.customer_name ?? "Customer" }])} className="g-btn g-btn-secondary h-8 px-3 text-xs">
                            Remind
                          </button>
                          <Link href={`/accounts/receivables?collect=${r.customer_id}`} className="g-btn g-btn-primary h-8 px-3 text-xs">
                            Collect
                          </Link>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th className="w-8" />
                <th>Customer</th>
                <th className="!text-right">Open bills</th>
                <th>Oldest bill</th>
                <th className="!text-right">Credit owed</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {byCustomer.map((g) => (
                <tr key={g.id ?? "walk-in"}>
                  <td>
                    {g.id ? (
                      <input type="checkbox" className="size-4 cursor-pointer accent-[#10201b]" aria-label={`Select ${g.name}`} checked={selected.has(g.id)} onChange={() => toggle(g.id!)} />
                    ) : null}
                  </td>
                  <td className="font-medium text-ink">{g.name}</td>
                  <td className="!text-right num-tabular">{g.bills}</td>
                  <td className="text-ink-3">{dateOf(g.oldest)}</td>
                  <td className="!text-right num-tabular font-semibold text-ink">{lkr(g.owed)}</td>
                  <td className="!text-right">
                    {g.id ? (
                      <div className="flex justify-end gap-1.5">
                        <button type="button" onClick={() => setRemind([{ id: g.id!, name: g.name }])} className="g-btn g-btn-secondary h-8 px-3 text-xs">
                          Remind
                        </button>
                        <Link href={`/accounts/receivables?collect=${g.id}`} className="g-btn g-btn-primary h-8 px-3 text-xs">
                          Collect
                        </Link>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      )}
      {truncated ? <p className="text-xs text-ink-4">Showing the 100 oldest-first per status; use Customer dues for the full ledger.</p> : null}
      {remind ? (
        <RemindModal
          targets={remind}
          configured={Boolean(smsCfg.data?.configured)}
          onSetup={() => {
            setRemind(null);
            setShowSettings(true);
          }}
          onClose={() => setRemind(null)}
          onDone={() => {
            setRemind(null);
            setSelected(new Set());
            qc.invalidateQueries({ queryKey: ["sms-log"] });
          }}
        />
      ) : null}
      {showSettings ? <SettingsModal initial={smsCfg.data} onClose={() => setShowSettings(false)} /> : null}
    </Page>
  );
}

function Lbl({ text, hint, children }: { text: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="block min-w-0">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-4">{text}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-ink-4">{hint}</span> : null}
    </div>
  );
}

function RemindModal({
  targets,
  configured,
  onSetup,
  onClose,
  onDone,
}: {
  targets: Target[];
  configured: boolean;
  onSetup: () => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const single = targets.length === 1 ? targets[0]! : null;
  const preview = useQuery({
    enabled: Boolean(single) && configured,
    queryKey: ["sms-preview", single?.id],
    queryFn: () => api<{ message: string; phone: string | null; rawPhone: string | null }>(`/api/v1/sms/preview/${single!.id}`),
  });
  const [text, setText] = useState<string | null>(null);
  const message = text ?? preview.data?.message ?? "";
  const [results, setResults] = useState<Outcome[] | null>(null);

  const send = useMutation({
    mutationFn: () =>
      api<{ results: Outcome[] }>("/api/v1/sms/remind", {
        method: "POST",
        body: JSON.stringify({ customerIds: targets.map((t) => t.id), message: single && text !== null ? text : undefined }),
      }),
    onSuccess: (d) => {
      setResults(d.results);
      const ok = d.results.filter((r) => r.status === "SENT").length;
      if (ok) toast.success(`${ok} reminder${ok === 1 ? "" : "s"} sent`);
      else toast.error("No reminder was sent");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not send"),
  });

  if (!configured)
    return (
      <Modal kicker="SMS reminder" title="Set up the SMS gateway first" onClose={onClose} onSubmit={onSetup} submitLabel="Open SMS settings">
        <p className="text-sm text-ink-3">Enter your SMSlenz user id, API key and approved sender id once, then reminders can go out.</p>
      </Modal>
    );

  if (results)
    return (
      <Modal kicker="SMS reminder" title="Done" onClose={onDone} footer={false}>
        <ul className="divide-y divide-ink/[0.06] text-sm">
          {results.map((r) => (
            <li key={r.customerId} className="flex items-start justify-between gap-3 py-2">
              <span className="font-medium text-ink">{r.name}</span>
              <span className={r.status === "SENT" ? "text-emerald-700" : r.status === "FAILED" ? "text-rose-700" : "text-ink-4"}>
                {r.status === "SENT" ? "Sent" : `${r.status === "FAILED" ? "Failed" : "Skipped"}${r.detail ? ` — ${r.detail}` : ""}`}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <button type="button" onClick={onDone} className="g-btn g-btn-primary h-10 px-4 text-sm">Close</button>
        </div>
      </Modal>
    );

  return (
    <Modal
      kicker="SMS reminder"
      title={single ? single.name : `${targets.length} customers`}
      onClose={onClose}
      onSubmit={() => send.mutate()}
      submitLabel={single ? "Send SMS" : `Send ${targets.length} SMS`}
      pending={send.isPending}
      submitDisabled={Boolean(single) && (preview.isLoading || !preview.data?.phone || !message.trim())}
    >
      {single ? (
        preview.isLoading ? (
          <p className="text-sm text-ink-4">Preparing the message…</p>
        ) : preview.isError ? (
          <Callout tone="warning" title="Could not prepare the message">{(preview.error as Error).message}</Callout>
        ) : (
          <>
            {preview.data?.phone ? (
              <p className="text-sm text-ink-3">To <span className="font-medium text-ink">{preview.data.phone}</span></p>
            ) : (
              <Callout tone="warning" title={preview.data?.rawPhone ? "Phone number looks wrong" : "No phone number on file"}>
                Add a Sri Lankan mobile number to this customer, then try again.
              </Callout>
            )}
            <Lbl text="Message" hint={`${message.length}/1500 characters`}>
              <textarea rows={5} value={message} onChange={(e) => setText(e.target.value)} className={`${controlClass} h-auto w-full py-2.5 leading-relaxed`} />
            </Lbl>
          </>
        )
      ) : (
        <p className="text-sm text-ink-3">
          Each customer gets the reminder from your SMS settings with their own balance. Customers without a valid mobile number are skipped.
        </p>
      )}
    </Modal>
  );
}

function SettingsModal({ initial, onClose }: { initial: SmsSettings | undefined; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    userId: initial?.userId ?? "",
    apiKey: "",
    senderId: initial?.senderId ?? "",
    shopName: initial?.shopName ?? "",
    template: initial?.template ?? "",
    autoEnabled: initial?.autoEnabled ?? false,
    autoAfterDays: String(initial?.autoAfterDays ?? 7),
    repeatDays: String(initial?.repeatDays ?? 7),
    sendHour: String(initial?.sendHour ?? 10),
    minAmountLkr: String(initial?.minAmountLkr ?? 0),
  });
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));
  const [testPhone, setTestPhone] = useState("");

  const save = useMutation({
    mutationFn: () =>
      api<SmsSettings>("/api/v1/sms/settings", {
        method: "PUT",
        body: JSON.stringify({
          userId: f.userId,
          apiKey: f.apiKey || undefined,
          senderId: f.senderId,
          shopName: f.shopName,
          template: f.template,
          autoEnabled: f.autoEnabled,
          autoAfterDays: Number(f.autoAfterDays) || 0,
          repeatDays: Math.max(1, Number(f.repeatDays) || 1),
          sendHour: Math.min(23, Math.max(0, Number(f.sendHour) || 0)),
          minAmountLkr: Number(f.minAmountLkr) || 0,
        }),
      }),
    onSuccess: () => {
      toast.success("SMS settings saved");
      qc.invalidateQueries({ queryKey: ["sms-settings"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });
  const balance = useMutation({
    mutationFn: () => api<{ status?: string; sms_credit_balance?: string }>("/api/v1/sms/status"),
    onSuccess: (d) => toast.success(`SMSlenz connected${d.sms_credit_balance ? ` — balance ${d.sms_credit_balance}` : ""}`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not reach SMSlenz"),
  });
  const test = useMutation({
    mutationFn: () => api("/api/v1/sms/test", { method: "POST", body: JSON.stringify({ phone: testPhone }) }),
    onSuccess: () => toast.success("Test SMS sent"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Test failed"),
  });

  return (
    <Modal
      kicker="Credit reminders"
      title="SMS settings"
      wide
      onClose={onClose}
      onSubmit={() => save.mutate()}
      submitLabel="Save settings"
      pending={save.isPending}
    >
      <p className="text-sm text-ink-3">
        Reminders are sent through your <a href="https://smslenz.lk" target="_blank" rel="noreferrer" className="underline">SMSlenz</a> account. Find the user id and API key under API Settings there; the sender id must be approved.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Lbl text="User id">
          <input value={f.userId} onChange={(e) => set({ userId: e.target.value })} className={`${controlClass} w-full`} />
        </Lbl>
        <Lbl text="API key" hint={initial?.hasApiKey ? `Saved (${initial.apiKeyMasked}). Leave blank to keep.` : undefined}>
          <input type="password" autoComplete="off" value={f.apiKey} onChange={(e) => set({ apiKey: e.target.value })} placeholder={initial?.hasApiKey ? "••••••••" : ""} className={`${controlClass} w-full`} />
        </Lbl>
        <Lbl text="Sender id" hint="Case sensitive">
          <input value={f.senderId} onChange={(e) => set({ senderId: e.target.value })} className={`${controlClass} w-full`} />
        </Lbl>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <button type="button" disabled={balance.isPending || !initial?.hasApiKey} onClick={() => balance.mutate()} className="g-btn g-btn-secondary h-9 px-3 text-xs" title="Save first if you changed the credentials">
          {balance.isPending ? "Checking…" : "Check connection & balance"}
        </button>
        <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="Test number, e.g. 0771234567" className={`${controlSmClass} w-56`} />
        <button type="button" disabled={test.isPending || !testPhone.trim() || !initial?.configured} onClick={() => test.mutate()} className="g-btn g-btn-secondary h-9 px-3 text-xs">
          {test.isPending ? "Sending…" : "Send test SMS"}
        </button>
      </div>

      <Lbl text="Message" hint={`Placeholders: ${PLACEHOLDERS}`}>
        <textarea rows={4} value={f.template} onChange={(e) => set({ template: e.target.value })} className={`${controlClass} h-auto w-full py-2.5 leading-relaxed`} />
      </Lbl>
      <Lbl text="Shop name in the message" hint="Used for {shop}">
        <input value={f.shopName} onChange={(e) => set({ shopName: e.target.value })} className={`${controlClass} w-full`} />
      </Lbl>

      <div className="rounded-xl bg-bone/60 p-4">
        <label className="flex items-center gap-2.5 text-sm font-medium text-ink">
          <input type="checkbox" className="size-4 accent-[#10201b]" checked={f.autoEnabled} onChange={(e) => set({ autoEnabled: e.target.checked })} />
          Send reminders automatically
        </label>
        <div className={`mt-3 grid gap-4 sm:grid-cols-4 ${f.autoEnabled ? "" : "opacity-50"}`}>
          <Lbl text="After (days)" hint="Oldest unpaid bill is this old">
            <input inputMode="numeric" value={f.autoAfterDays} onChange={(e) => set({ autoAfterDays: e.target.value })} className={`${controlClass} w-full`} />
          </Lbl>
          <Lbl text="Repeat every (days)" hint="Gap between reminders">
            <input inputMode="numeric" value={f.repeatDays} onChange={(e) => set({ repeatDays: e.target.value })} className={`${controlClass} w-full`} />
          </Lbl>
          <Lbl text="Send at (hour)" hint="Shop time, 0–23">
            <input inputMode="numeric" value={f.sendHour} onChange={(e) => set({ sendHour: e.target.value })} className={`${controlClass} w-full`} />
          </Lbl>
          <Lbl text="Min. owed (LKR)" hint="Skip smaller balances">
            <input inputMode="decimal" value={f.minAmountLkr} onChange={(e) => set({ minAmountLkr: e.target.value })} className={`${controlClass} w-full`} />
          </Lbl>
        </div>
        <p className="mt-3 text-xs text-ink-4">Checked every hour. Only customers with a valid mobile number are texted, never more than once per repeat period.</p>
      </div>
    </Modal>
  );
}
