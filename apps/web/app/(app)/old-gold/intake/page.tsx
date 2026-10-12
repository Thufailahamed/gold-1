"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { api, formApi, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page } from "@/components/ui";
import { GoldHero, HeroBadge, grams, heroGhost } from "../kit";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CameraIcon,
  CheckCircleIcon,
  CheckIcon,
  FileTextIcon,
  FlaskConicalIcon,
  PlusIcon,
  ScaleIcon,
  SearchIcon,
  UsersIcon,
  XIcon,
} from "@/components/icons";

type Customer = { id: string; name: string; code: string };

const ITEM_TYPES = ["chain", "ring", "bangle", "bracelet", "necklace", "earrings", "pendant", "coin"];

function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return (
    document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? ""
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

const cardShadow =
  "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]";

const inputCls =
  "h-10 w-full rounded-xl bg-paper px-3.5 text-[13px] text-ink placeholder:text-ink-5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.12),0_1px_2px_rgba(16,32,27,0.04)] transition-shadow hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.26)] focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)] aria-[invalid=true]:shadow-[inset_0_0_0_1px_#e11d48,0_0_0_4px_rgba(225,29,72,0.12)]";

/* ------------------------------------------------------------------ pieces */

function Section({
  n,
  title,
  sub,
  icon,
  done,
  children,
}: {
  n: string;
  title: string;
  sub: string;
  icon: ReactNode;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "relative rounded-2xl bg-paper transition-shadow duration-320",
        cardShadow,
        "focus-within:shadow-[inset_0_0_0_1px_rgba(205,168,83,0.45),0_1px_2px_rgba(16,32,27,0.04),0_28px_56px_-34px_rgba(16,32,27,0.45)]"
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent to-transparent",
          done ? "via-gold" : "via-gold/40"
        )}
      />
      <header className="flex items-center gap-2.5 border-b border-ink/[0.06] px-4 py-2.5">
        <span className="relative flex size-7 shrink-0 items-center justify-center rounded-lg bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25)]">
          {icon}
          <span className="g-metric absolute -right-1.5 -top-1.5 flex size-[18px] items-center justify-center rounded-full bg-paper text-[9px] text-ink shadow-[0_0_0_1px_rgba(16,32,27,0.12)]">
            {n}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-sans text-[13.5px] font-semibold tracking-normal text-ink">{title}</h2>
          <p className="truncate text-[11px] text-ink-4">{sub}</p>
        </div>
        {done ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-b from-gold-light to-gold px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
            <CheckIcon size={11} /> Done
          </span>
        ) : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Label({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <span className="mb-2 flex items-center justify-between gap-2 text-[12.5px] font-medium text-ink-2">
      {children}
      {extra}
    </span>
  );
}

function UnitInput({
  unit,
  value,
  onChange,
  invalid,
  id,
}: {
  unit: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  id: string;
}) {
  return (
    <span className="group relative block">
      <input
        id={id}
        type="number"
        step="any"
        inputMode="decimal"
        placeholder="0.000"
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputCls, "g-metric pr-14 text-[14px]")}
      />
      <span className="pointer-events-none absolute inset-y-1.5 right-1.5 flex items-center rounded-lg bg-bone px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4 ring-1 ring-ink/[0.05] transition-colors group-focus-within:bg-void group-focus-within:text-gold-light">
        {unit}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ page */

export default function IntakePage() {
  const qc = useQueryClient();
  const [customerSearch, setCustomerSearch] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [itemType, setItemType] = useState("chain");
  const [description, setDescription] = useState("");
  const [grossG, setGrossG] = useState("");
  const [stoneG, setStoneG] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [created, setCreated] = useState<{ id: string; number: string } | null>(null);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  // The selected-branch cookie, else the first branch the user works in. An
  // empty branch used to reach the server and come back as "Branch not found".
  const branchId = branchDefault() || me.data?.branchIds[0] || "";

  const todaySum = useQuery({
    retry: false,
    staleTime: 30_000,
    queryKey: ["og-summary", "today"],
    queryFn: () => api<{ items: number; gross_mg: number; fine_mg: number }>("/api/v1/oldgold/reports/summary?period=today"),
  });
  const queueCount = useQuery({
    retry: false,
    staleTime: 30_000,
    queryKey: ["og-dash", "stage", "RECEIVED"],
    queryFn: () => api<{ rows: unknown[]; total: number }>("/api/v1/oldgold/items?status=RECEIVED&limit=1"),
  });

  const customers = useQuery({
    queryKey: ["og-customers", customerSearch],
    queryFn: () =>
      api<{ rows: Customer[]; total: number }>(
        `/api/v1/customers?search=${encodeURIComponent(customerSearch)}&limit=10`
      ),
    enabled: customerSearch.length > 0 && !customer,
  });

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const intake = useMutation({
    mutationFn: async () => {
      const res = await api<{ id: string; number: string }>("/api/v1/oldgold/items", {
        method: "POST",
        body: JSON.stringify({
          customerId: customer?.id ?? "",
          branchId,
          itemType,
          description,
          grossG: Number(grossG),
          stoneG: stoneG === "" ? 0 : Number(stoneG),
          notes: notes || undefined,
        }),
      });
      // The item exists now; a failed photo must not read as a failed intake.
      let failed = 0;
      for (const f of files.slice(0, 10)) {
        const form = new FormData();
        form.append("kind", "image");
        form.append("file", f);
        try {
          await formApi(`/api/v1/oldgold/items/${res.id}/files`, form);
        } catch {
          failed++;
        }
      }
      return { ...res, failed };
    },
    onSuccess: (d) => {
      setCreated(d);
      toast.success(`Intake ${d.number}`);
      if (d.failed) toast.error(`${d.failed} photo${d.failed === 1 ? "" : "s"} did not upload (jpeg/png/webp, ≤5MB). Add them from the item later.`);
      for (const key of ["og-items", "og-dash", "og-summary", "og-queue"]) qc.invalidateQueries({ queryKey: [key] });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Intake failed"),
  });

  const gross = Number(grossG);
  const stone = stoneG === "" ? 0 : Number(stoneG);
  const grossOk = gross > 0;
  const stoneOk = stoneG === "" || (Number(stoneG) >= 0 && Number(stoneG) < Number(grossG));
  const net = grossOk && stoneOk ? gross - stone : null;
  const canSubmit = !intake.isPending && !!customer && !!description && !!branchId && grossOk && stoneOk;

  const steps = [
    { t: "Customer", done: !!customer },
    { t: "Describe", done: !!description.trim() && !!itemType.trim() },
    { t: "Weigh", done: grossOk && stoneOk },
    { t: "Photograph", done: files.length > 0 },
  ];
  const missing = [
    !customer && "customer",
    !description.trim() && "description",
    !grossOk && "gross weight",
    !stoneOk && "a valid stone weight",
    !branchId && "a branch",
  ].filter(Boolean) as string[];

  const addFiles = (list: FileList | File[] | null) => {
    const imgs = Array.from(list ?? []).filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    if (imgs.length) setFiles((cur) => [...cur, ...imgs].slice(0, 10));
  };

  function reset() {
    setCreated(null);
    setDescription("");
    setGrossG("");
    setStoneG("");
    setNotes("");
    setFiles([]);
  }

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={ScaleIcon}
        title="Old gold intake,"
        accent="weighed true"
        back={{ href: "/old-gold", label: "Old gold" }}
        badge={<HeroBadge tone={steps.every((x) => x.done) ? "good" : "gold"}>{steps.filter((x) => x.done).length} of 4 steps</HeroBadge>}
        sub="Every intake is photographed and weighed before it reaches the testing queue. An OG number is minted on save."
        actions={
          <>
            <Link href="/old-gold/testing" className={heroGhost}>
              <FlaskConicalIcon size={13} /> Testing queue
            </Link>
            <Link href="/old-gold/items" className={heroGhost}>
              Items
            </Link>
          </>
        }
        stats={[
          { label: "Taken in today", value: todaySum.data?.items, loading: todaySum.isLoading, sub: todaySum.data ? `${grams(todaySum.data.gross_mg)} g gross` : undefined },
          { label: "Waiting for test", value: queueCount.data?.total, tone: queueCount.data?.total ? "warn" : undefined, loading: queueCount.isLoading, href: "/old-gold/testing", sub: "Received, not assayed" },
          { label: "This ticket · net", value: net !== null ? net * 1000 : null, format: grams, unit: "g", accent: true, sub: grossOk ? `${grams(gross * 1000)} g gross` : "Weigh the piece" },
          { label: "Photos", value: files.length, sub: "Up to 10" },
        ]}
      >
        <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {steps.map((x, i) => (
            <li key={x.t} className={cn("flex items-center gap-2.5 rounded-xl px-3 py-2 ring-1 ring-inset", x.done ? "bg-gold/[0.14] ring-gold/40" : "bg-paper/[0.04] ring-paper/10")}>
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", x.done ? "bg-gradient-to-b from-gold-light to-gold text-void" : "text-paper/50 ring-1 ring-paper/20")}>
                {x.done ? <CheckIcon size={12} /> : <span className="g-metric">{i + 1}</span>}
              </span>
              <span className={cn("truncate text-[12px] font-medium", x.done ? "text-gold-light" : "text-paper/75")}>{x.t}</span>
            </li>
          ))}
        </ol>
      </GoldHero>

      {/* Success */}
      {created ? (
        <section className="relative flex animate-pop-in flex-col gap-3 overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-50 via-emerald-50/60 to-paper px-4 py-3 ring-1 ring-emerald-600/15 sm:flex-row sm:items-center sm:justify-between">
          <div className="pointer-events-none absolute -left-10 -top-16 size-48 rounded-full bg-emerald-300/30 blur-3xl" aria-hidden />
          <div className="relative flex items-center gap-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-emerald-500 to-emerald-700 text-paper shadow-[0_12px_24px_-10px_rgba(5,150,105,0.7)]">
              <CheckCircleIcon size={22} />
            </span>
            <div>
              <p className="text-[15px] font-semibold text-ink">
                Item <span className="g-metric rounded-md bg-void px-2 py-0.5 text-gold-light">{created.number}</span> received
              </p>
              <p className="mt-1 text-sm text-ink-3">Tag it with the OG number — it is now in the testing queue.</p>
            </div>
          </div>
          <div className="relative flex flex-wrap gap-2">
            <button type="button" onClick={reset} className="g-btn g-btn-secondary h-8 rounded-lg px-3 text-[12px]">
              <PlusIcon size={14} /> New intake
            </button>
            <Link href={`/old-gold/items/${created.id}`} className="g-btn g-btn-primary h-8 rounded-lg px-3 text-[12px]">
              <FlaskConicalIcon size={14} /> Open for testing <ArrowRightIcon size={13} className="g-btn-arrow text-gold-light" />
            </Link>
          </div>
        </section>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {/* 1 Customer */}
          <Section n="1" title="Customer" sub="Who is selling the piece" icon={<UsersIcon size={17} />} done={!!customer}>
            {customer ? (
              <div className="flex items-center gap-3 rounded-2xl bg-gold-pale/60 p-3 ring-1 ring-gold-dark/25">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-void text-xs font-bold text-gold-light">
                  {initials(customer.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{customer.name}</span>
                  <span className="g-metric block text-xs text-ink-4">{customer.code}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setCustomer(null)}
                  className="inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-medium text-ink-3 hover:bg-paper hover:text-ink"
                >
                  Change
                </button>
              </div>
            ) : (
              <div>
                <div className="group relative">
                  <SearchIcon size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-5 group-focus-within:text-gold-dark" />
                  <input
                    autoFocus
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder="Search name or phone…"
                    autoComplete="off"
                    className={cn(inputCls, "pl-10")}
                  />
                  {customers.isFetching ? (
                    <span className="absolute right-3.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
                  ) : null}
                </div>
                {customerSearch ? (
                  <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-2xl bg-bone/50 p-1.5 ring-1 ring-ink/[0.06] scrollbar-thin">
                    {(customers.data?.rows ?? []).length === 0 && !customers.isFetching ? (
                      <li className="px-3 py-4 text-center text-xs text-ink-4">No customers match “{customerSearch}”</li>
                    ) : null}
                    {(customers.data?.rows ?? []).map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setCustomer(c)}
                          className="flex w-full items-center gap-3 rounded-xl bg-paper px-3 py-2.5 text-left ring-1 ring-ink/[0.06] transition-all hover:-translate-y-px hover:ring-gold-dark/30"
                        >
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold-soft to-gold-pale text-[10px] font-semibold text-gold-deep ring-1 ring-gold-dark/15">
                            {initials(c.name)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
                            <span className="g-metric block text-[11px] text-ink-4">{c.code}</span>
                          </span>
                          <ArrowRightIcon size={13} className="shrink-0 text-ink-5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-ink-4">Search, then pick the customer from the results.</p>
                )}
              </div>
            )}
          </Section>

          {/* 2 Item */}
          <Section
            n="2"
            title="The piece"
            sub="What it is, as handed over"
            icon={<FileTextIcon size={17} />}
            done={!!description.trim() && !!itemType.trim()}
          >
            <div className="space-y-4">
              <div>
                <Label>Item type</Label>
                <div className="flex flex-wrap gap-1.5">
                  {ITEM_TYPES.map((t) => {
                    const on = itemType.trim().toLowerCase() === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setItemType(t)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-medium capitalize ring-1 transition-all duration-200",
                          on
                            ? "bg-void text-paper ring-gold/40 shadow-[0_8px_18px_-10px_rgba(6,42,34,0.8)]"
                            : "bg-paper text-ink-3 ring-ink/10 hover:-translate-y-px hover:bg-gold-pale/50 hover:text-ink"
                        )}
                      >
                        {on ? <CheckIcon size={11} className="text-gold-light" /> : null}
                        {t}
                      </button>
                    );
                  })}
                </div>
                <input
                  value={itemType}
                  onChange={(e) => setItemType(e.target.value)}
                  placeholder="Or type another — anklet, chain links…"
                  className={cn(inputCls, "mt-2")}
                />
              </div>
              <label className="block">
                <Label extra={<span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Required</span>}>Description</Label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. 22K rope chain, broken clasp"
                  className={inputCls}
                />
              </label>
            </div>
          </Section>

          {/* 3 Weigh */}
          <Section n="3" title="Weigh" sub="Grams on the counter scale" icon={<ScaleIcon size={17} />} done={grossOk && stoneOk}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <Label extra={<span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gold-dark">Required</span>}>Gross weight</Label>
                <UnitInput id="og-gross" unit="g" value={grossG} onChange={setGrossG} invalid={grossG !== "" && !grossOk} />
                {grossG !== "" && !grossOk ? (
                  <span className="mt-1.5 flex items-center gap-1 text-xs font-medium text-rose-700">
                    <AlertCircleIcon size={12} /> Must be more than 0
                  </span>
                ) : null}
              </label>
              <label className="block">
                <Label extra={<span className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-5">Optional</span>}>Stone weight</Label>
                <UnitInput id="og-stone" unit="g" value={stoneG} onChange={setStoneG} invalid={!stoneOk} />
                {!stoneOk ? (
                  <span className="mt-1.5 flex items-center gap-1 text-xs font-medium text-rose-700">
                    <AlertCircleIcon size={12} /> Must be 0 or more and less than gross
                  </span>
                ) : null}
              </label>
            </div>
            <div className="relative mt-4 flex items-center justify-between overflow-hidden rounded-xl bg-void px-4 py-2.5 text-paper">
              <div className="pointer-events-none absolute -right-10 -top-12 size-32 rounded-full bg-gold/20 blur-[50px]" aria-hidden />
              <span className="relative text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/45">Metal weight · gross − stone</span>
              <span className="g-metric relative text-xl text-gold-light">
                {net !== null ? net.toLocaleString("en-US", { maximumFractionDigits: 3 }) : "—"}
                <span className="ml-1 text-xs text-paper/40">g</span>
              </span>
            </div>
          </Section>

          {/* 4 Photos + notes */}
          <Section n="4" title="Photograph" sub="Up to 10 photos, JPG · PNG · WebP, ≤5 MB each" icon={<CameraIcon size={17} />} done={files.length > 0}>
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                addFiles(e.dataTransfer?.files ?? null);
              }}
              className={cn(
                "group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-5 text-center transition-all duration-200",
                drag
                  ? "scale-[1.01] border-gold-dark/70 bg-gold-pale"
                  : "border-ink/15 bg-gradient-to-b from-bone/40 to-bone/80 hover:border-gold-dark/50 hover:from-gold-pale/40 hover:to-gold-pale/70"
              )}
            >
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <span
                className={cn(
                  "flex size-10 items-center justify-center rounded-xl transition-all duration-200 group-hover:-translate-y-0.5",
                  drag ? "bg-gradient-to-b from-gold-light to-gold text-void" : "bg-void text-gold-light shadow-[0_10px_22px_-12px_rgba(6,42,34,0.8)]"
                )}
              >
                <CameraIcon size={20} />
              </span>
              <span className="text-sm font-semibold text-ink">
                {drag ? "Drop to add" : (
                  <>
                    Drop photos or <span className="text-gold-deep underline decoration-gold/50 underline-offset-4">take / browse</span>
                  </>
                )}
              </span>
              <span className="text-xs text-ink-5">Front, back and any hallmark or damage</span>
            </label>
            {files.length > 0 ? (
              <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
                {previews.map((src, i) => (
                  <span key={src} className={cn("group relative block aspect-square overflow-hidden rounded-xl", i === 0 ? "ring-2 ring-gold" : "ring-1 ring-ink/10")}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={files[i]?.name ?? ""} className="size-full object-cover" />
                    <button
                      type="button"
                      aria-label={`Remove ${files[i]?.name ?? "photo"}`}
                      onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                      className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-ink/80 text-paper opacity-0 backdrop-blur transition-opacity hover:bg-rose-700 focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <XIcon size={11} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <label className="mt-4 block">
              <Label extra={<span className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-5">Optional</span>}>Notes</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Anything the tester should know"
                className={cn(inputCls, "h-auto min-h-[5rem] resize-y py-3 leading-relaxed")}
              />
            </label>
          </Section>
        </div>

        {/* Ticket */}
        <aside className="min-w-0 lg:sticky lg:top-24">
          <section className="relative overflow-hidden rounded-2xl bg-void p-4 text-paper shadow-5 ring-1 ring-gold/10">
            <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-40" aria-hidden />
            <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-gold/20 blur-[80px]" aria-hidden />
            <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" aria-hidden />
            <div className="relative flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">Intake ticket</span>
              <span className="g-metric rounded-md bg-paper/[0.06] px-2 py-0.5 text-[11px] text-paper/50 ring-1 ring-paper/10">OG-·····</span>
            </div>
            <p className="relative mt-3 truncate text-lg font-semibold text-paper">{description.trim() || <span className="text-paper/40">Untitled piece</span>}</p>
            <p className="relative mt-0.5 truncate text-xs capitalize text-paper/50">{itemType || "Item type"}</p>

            <dl className="relative mt-4 space-y-2 border-t border-dashed border-paper/15 pt-4 text-sm">
              {[
                ["Customer", customer ? customer.name : "—"],
                ["Gross", grossOk ? `${gross.toLocaleString("en-US", { maximumFractionDigits: 3 })} g` : "—"],
                ["Stone", stoneG !== "" && stoneOk ? `${stone.toLocaleString("en-US", { maximumFractionDigits: 3 })} g` : "—"],
                ["Photos", files.length ? String(files.length) : "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <dt className="text-paper/50">{k}</dt>
                  <dd className="g-metric max-w-[60%] truncate text-paper">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="relative mt-4 flex items-end justify-between rounded-xl bg-black/20 px-3.5 py-3 ring-1 ring-paper/[0.08]">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/45">Metal</span>
              <span className="g-metric text-2xl leading-none text-gold-light">
                {net !== null ? net.toLocaleString("en-US", { maximumFractionDigits: 3 }) : "—"}
                <span className="ml-1 text-xs text-paper/40">g</span>
              </span>
            </div>

            <button
              type="button"
              onClick={() => intake.mutate()}
              disabled={!canSubmit}
              className="home-btn-gold relative mt-4 h-10 w-full text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {intake.isPending ? (
                <>
                  <span className="size-3.5 animate-spin rounded-full border-2 border-void/30 border-t-void" />
                  Saving…
                </>
              ) : (
                <>
                  <ScaleIcon size={15} /> Receive item
                </>
              )}
            </button>
            <p className="relative mt-3 text-center text-[11px] leading-relaxed text-paper/45">
              {missing.length ? <>Still needed: {missing.join(", ")}</> : "Ready — an OG number is minted on save."}
            </p>
          </section>
        </aside>
      </div>
    </Page>
  );
}
