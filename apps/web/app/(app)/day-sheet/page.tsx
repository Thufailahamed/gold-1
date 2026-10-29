"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hasPermission } from "@goldos/shared";
import { Callout, Page, Skeleton } from "@/components/ui";
import { Card, CardHead, Empty, GoldHero, HeroBadge, RowsSkeleton, heroGhost, heroGold, th, thead } from "@/components/console-kit";
import {
  AlertCircleIcon,
  CameraIcon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  EditIcon,
  FileTextIcon,
  HistoryIcon,
  PlusIcon,
  PrinterIcon,
  ScaleIcon,
} from "@/components/icons";
import { cn } from "@/lib/cn";
import { api, assetUrl, formApi, type MeData } from "@/lib/api";
import { readTenantSlug } from "@/lib/tenant";
import { businessToday } from "@/lib/busclock";
import { rupees, systemAsSheetLine, type DaySheetView, type RowResult, type SheetHeader, type SystemRow } from "@/lib/daysheet";
import {
  ActionBtn,
  LinkModal,
  NoteModal,
  RecordModal,
  SheetGrid,
  SystemTable,
  TotalsCompare,
  blankEdit,
  editErrors,
  fromEdit,
  toEdit,
  type EditRow,
  type RecordPayload,
  type RowAction,
} from "./parts";

type TabKey = "check" | "system" | "history";

const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Phone photos are large; the reader needs the handwriting, not 12 MP. Long
 * side capped at 2400px as JPEG, which keeps pen strokes crisp at well under
 * the upload limit. Anything the browser cannot decode is sent as it is.
 */
async function shrink(file: File): Promise<File> {
  if (file.size < 1_500_000 && ["image/jpeg", "image/png", "image/webp"].includes(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

function SheetStatus({ sheet }: { sheet: SheetHeader | null }) {
  if (!sheet) return <HeroBadge tone="muted">No sheet</HeroBadge>;
  if (sheet.status === "DRAFT") return <HeroBadge tone="warn">Draft — not checked</HeroBadge>;
  if (sheet.status === "VERIFIED") return <HeroBadge tone="good">Verified</HeroBadge>;
  return <HeroBadge tone="bad">Issues found</HeroBadge>;
}

function DaySheetScreen() {
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const [branchId, setBranchId] = useState(
    () =>
      params.get("branchId") ||
      (typeof document === "undefined" ? "branch-main" : (document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? "branch-main"))
  );
  const [date, setDate] = useState(() => params.get("date") || businessToday());
  const [tab, setTab] = useState<TabKey>("check");
  const [rows, setRowsState] = useState<EditRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [editingNew, setEditingNew] = useState(false);
  const [photo, setPhoto] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [action, setAction] = useState<RowAction | { kind: "ignore"; ref: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const appendRef = useRef(false);

  useEffect(() => {
    router.replace(`/day-sheet?branchId=${encodeURIComponent(branchId)}&date=${date}`, { scroll: false });
  }, [branchId, date, router]);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const perms = me.data?.permissions ?? [];
  const canManage = hasPermission(perms, "dayclose:manage");
  const canRecord = hasPermission(perms, "accounts:manage");
  const branches = useQuery({ queryKey: ["branches"], queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/branches?limit=100") });
  const branchName = (id: string) => branches.data?.rows.find((b) => b.id === id)?.name ?? id;

  const key = ["day-sheet", branchId, date];
  const view = useQuery({
    queryKey: key,
    queryFn: () => api<DaySheetView>(`/api/v1/day-sheets/day?branchId=${encodeURIComponent(branchId)}&date=${date}`),
  });
  const history = useQuery({
    enabled: tab === "history",
    queryKey: ["day-sheets", branchId],
    queryFn: () => api<{ rows: (SheetHeader & { rows: number })[] }>(`/api/v1/day-sheets?branchId=${encodeURIComponent(branchId)}`),
  });

  const v = view.data;
  const sheet = v?.sheet ?? null;
  const canEdit = canManage && !v?.dayClosed;

  // The server's rows replace the editor's whenever a fresh copy arrives and
  // nothing is being typed. A save, link or accept always brings a fresh copy.
  useEffect(() => {
    if (!v || dirty) return;
    setRowsState(v.rows.map(toEdit));
    setEditingNew(false);
    setPhoto(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  useEffect(() => {
    setDirty(false);
  }, [branchId, date]);

  const setRows = (fn: (r: EditRow[]) => EditRow[]) => {
    setRowsState(fn);
    setDirty(true);
  };

  const results = useMemo(() => new Map<string, RowResult>((v?.reconciliation?.rows ?? []).map((r) => [r.rowId, r])), [v]);
  const sysByRef = useMemo(() => new Map<string, SystemRow>((v?.system ?? []).map((s) => [s.ref, s])), [v]);
  const takenRefs = useMemo(() => new Set((v?.reconciliation?.rows ?? []).map((r) => r.matchRef).filter((x): x is string => !!x)), [v]);

  const onFresh = (data: DaySheetView) => {
    setDirty(false);
    qc.setQueryData(key, data);
    qc.invalidateQueries({ queryKey: ["day-sheets"] });
    qc.invalidateQueries({ queryKey: ["day-sheet-alerts"] });
  };
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Something went wrong");

  const scan = useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData();
      form.set("branchId", branchId);
      form.set("date", date);
      form.set("mode", appendRef.current ? "append" : "replace");
      for (const f of await Promise.all(files.map(shrink))) form.append("file", f);
      return formApi<DaySheetView>("/api/v1/day-sheets/scan", form);
    },
    onSuccess: (data) => {
      onFresh(data);
      setTab("check");
      toast.success(`Read ${data.scan?.read ?? 0} line${data.scan?.read === 1 ? "" : "s"} — check them against the photo, correct anything wrong, then Save & check.`);
    },
    onError: fail,
  });

  const save = useMutation({
    mutationFn: (draft: boolean) =>
      api<DaySheetView>("/api/v1/day-sheets/day", { method: "PUT", body: JSON.stringify({ branchId, date, rows: fromEdit(rows), draft }) }),
    onSuccess: (data, draft) => {
      onFresh(data);
      if (draft) return toast.success("Draft saved");
      const c = data.reconciliation?.counts;
      if (!c) return;
      const open = c.mismatch + c.missingInSystem + c.missingOnSheet;
      if (open === 0) toast.success(`Verified — all ${c.matched} lines agree with the system`);
      else toast.warning(`${open} line${open === 1 ? "" : "s"} need attention: ${c.mismatch} mismatched, ${c.missingInSystem} not in the system, ${c.missingOnSheet} not on the sheet`);
    },
    onError: fail,
  });

  const rowCall = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => api<DaySheetView>(`/api/v1/day-sheets/${sheet!.id}${path}`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (data) => {
      onFresh(data);
      setAction(null);
    },
    onError: fail,
  });

  const record = useMutation({
    mutationFn: ({ rowId, payload }: { rowId: string; payload: RecordPayload }) =>
      api<DaySheetView>(`/api/v1/day-sheets/${sheet!.id}/rows/${rowId}/record`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (data) => {
      onFresh(data);
      setAction(null);
      toast.success("Recorded in the system and linked to the line");
      qc.invalidateQueries({ queryKey: ["day-closing-preview"] });
    },
    onError: fail,
  });

  const onAction = (a: RowAction) => {
    if (a.kind === "useSystem") {
      setRows((rs) =>
        rs.map((r) =>
          r.id === a.rowId
            ? {
                ...r,
                rec: a.sys.receivedCents ? String(a.sys.receivedCents / 100) : "",
                giv: a.sys.givenCents ? String(a.sys.givenCents / 100) : "",
                old: a.sys.oldGoldCents ? String(a.sys.oldGoldCents / 100) : "",
                gold: a.sys.goldMg ? String(a.sys.goldMg / 1000) : r.gold,
                linkedRef: a.sys.ref,
              }
            : r
        )
      );
      toast.info("Copied the system's figures into the line. Save & check to confirm.");
      return;
    }
    if (a.kind === "accept" && !a.accepted) {
      rowCall.mutate({ path: `/rows/${a.rowId}/accept`, body: { accepted: false } });
      return;
    }
    setAction(a);
  };

  const startUpload = (append: boolean) => {
    appendRef.current = append;
    fileRef.current?.click();
  };

  const errors = editErrors(rows);
  const rec = v?.reconciliation ?? null;
  const showEditor = !!sheet || editingNew;
  const actionRow = action && "rowId" in action ? rows.find((r) => r.id === action.rowId) : undefined;
  const slug = readTenantSlug();
  const photoUrl = sheet && sheet.imageCount ? assetUrl(`/api/v1/day-sheets/${sheet.id}/images/${photo}?v=${sheet.updated_at}${slug ? `&shop=${slug}` : ""}`) : null;
  const isToday = date === businessToday();
  const darkCtl =
    "h-8 rounded-lg bg-paper/[0.07] px-2.5 text-[12px] text-paper shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] focus:outline-none [&>option]:text-ink [color-scheme:dark]";

  const tabs: { key: TabKey; label: string; icon: typeof FileTextIcon; count?: number }[] = [
    { key: "check", label: "Check the paper sheet", icon: ClipboardCheckIcon, count: rec ? rec.counts.mismatch + rec.counts.missingInSystem + rec.counts.missingOnSheet : undefined },
    { key: "system", label: "System day sheet", icon: FileTextIcon, count: v?.system.length },
    { key: "history", label: "Past sheets", icon: HistoryIcon },
  ];

  return (
    <Page className="space-y-4">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) scan.mutate(files.slice(0, 4));
        }}
      />
      <GoldHero
        icon={FileTextIcon}
        title="Day"
        accent="sheet"
        badge={<SheetStatus sheet={sheet} />}
        sub={`${branchName(branchId)} · ${new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · the counter's paper record, checked line by line against the books`}
        back={{ href: "/day-closing", label: "Day closing" }}
        actions={
          <>
            <Link href={`/day-sheet/print?branchId=${encodeURIComponent(branchId)}`} className={heroGhost}>
              <PrinterIcon size={13} /> Blank sheet
            </Link>
            <Link href={`/day-sheet/print?branchId=${encodeURIComponent(branchId)}&date=${date}&mode=system`} className={heroGhost}>
              <PrinterIcon size={13} /> System sheet
            </Link>
            {canEdit ? (
              <button type="button" className={heroGold} disabled={scan.isPending} onClick={() => startUpload(false)}>
                <CameraIcon size={13} /> {scan.isPending ? "Reading…" : sheet?.imageCount ? "Re-upload photo" : "Upload photo"}
              </button>
            ) : null}
          </>
        }
        stats={[
          { label: "In the system", value: v ? v.system.length : undefined, loading: view.isLoading, sub: "transactions" },
          { label: "On the sheet", value: v ? v.rows.length : undefined, loading: view.isLoading, sub: sheet ? `${sheet.imageCount} photo${sheet.imageCount === 1 ? "" : "s"}` : "not uploaded" },
          { label: "Matched", value: rec ? rec.counts.matched + rec.counts.accepted : undefined, tone: "good", sub: rec?.counts.accepted ? `${rec.counts.accepted} accepted` : undefined },
          { label: "Mismatched", value: rec ? rec.counts.mismatch : undefined, tone: rec?.counts.mismatch ? "bad" : "good" },
          { label: "Not in system", value: rec ? rec.counts.missingInSystem : undefined, tone: rec?.counts.missingInSystem ? "warn" : "good", sub: "written, not keyed" },
          { label: "Not on sheet", value: rec ? rec.counts.missingOnSheet : undefined, tone: rec?.counts.missingOnSheet ? "warn" : "good", sub: "keyed, not written" },
        ]}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {(branches.data?.rows ?? []).length <= 6 ? (
            (branches.data?.rows ?? []).map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setBranchId(b.id)}
                className={cn(
                  "h-7 rounded-full px-2.5 text-[11.5px] font-semibold transition-colors",
                  b.id === branchId ? "bg-gold text-void" : "bg-paper/[0.06] text-paper/60 ring-1 ring-inset ring-paper/10 hover:text-paper"
                )}
              >
                {b.name}
              </button>
            ))
          ) : (
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={darkCtl} aria-label="Branch">
              {(branches.data?.rows ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <span className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => setDate(shiftDay(date, -1))} aria-label="Previous day" className="flex size-8 items-center justify-center rounded-lg text-paper/60 ring-1 ring-inset ring-paper/12 hover:text-paper">
              <ChevronRightIcon size={13} className="rotate-180" />
            </button>
            <input type="date" value={date} max={businessToday()} onChange={(e) => e.target.value && setDate(e.target.value)} className={cn(darkCtl, "g-metric")} aria-label="Date" />
            <button
              type="button"
              onClick={() => setDate(shiftDay(date, 1))}
              disabled={isToday}
              aria-label="Next day"
              className="flex size-8 items-center justify-center rounded-lg text-paper/60 ring-1 ring-inset ring-paper/12 hover:text-paper disabled:opacity-30"
            >
              <ChevronRightIcon size={13} />
            </button>
          </span>
        </div>
      </GoldHero>

      <div role="tablist" aria-label="Day sheet" className="flex gap-1 overflow-x-auto rounded-xl bg-paper p-1 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)] scrollbar-thin">
        {tabs.map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition-all",
                on ? "bg-void text-gold-light shadow-[0_6px_16px_-8px_rgba(6,42,34,0.8)]" : "text-ink-3 hover:bg-bone hover:text-ink"
              )}
            >
              <t.icon size={13} />
              {t.label}
              {t.count !== undefined ? (
                <span className={cn("g-metric rounded-full px-1.5 text-[10px]", on ? "bg-paper/10" : t.count && t.key === "check" ? "bg-rose-500/15 text-rose-800" : "bg-ink/[0.05] text-ink-4")}>{t.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {v?.dayClosed ? (
        <Callout tone="info" title="This day is closed">
          The sheet can be read but not changed. Re-open the day from Day closing to correct it.
        </Callout>
      ) : null}

      {tab === "check" ? (
        view.isLoading ? (
          <Card>
            <RowsSkeleton rows={6} />
          </Card>
        ) : scan.isPending ? (
          <Card>
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <span className="flex size-12 animate-pulse items-center justify-center rounded-2xl bg-void text-gold-light">
                <CameraIcon size={20} />
              </span>
              <p className="text-[14px] font-semibold text-ink">Reading the handwriting…</p>
              <p className="max-w-md text-[12px] text-ink-4">The AI is transcribing every line of the sheet. This usually takes 20–60 seconds. Keep this page open.</p>
            </div>
          </Card>
        ) : !showEditor ? (
          <Card>
            <CardHead icon={ClipboardCheckIcon} title="No paper sheet for this day yet" sub="Upload a photo of the counter's day sheet, or type it in." />
            <div className="grid gap-3 p-4 md:grid-cols-3">
              <StepCard n={1} title="Write it on the printed sheet" body="One transaction per numbered line: bill no and name, gold grams, received, given, old gold.">
                <Link href={`/day-sheet/print?branchId=${encodeURIComponent(branchId)}`} className="text-[12px] font-semibold text-gold-dark underline">
                  Print blank sheets
                </Link>
              </StepCard>
              <StepCard n={2} title="Photograph it at day end" body="Flat on the counter, straight from above, the whole sheet in frame, good light. One photo per page.">
                {canEdit ? (
                  <ActionBtn primary onClick={() => startUpload(false)}>
                    Upload photo
                  </ActionBtn>
                ) : null}
              </StepCard>
              <StepCard n={3} title="Check, correct, save" body="The AI reads each line. Fix anything it misread, then Save & check against the system.">
                {canEdit ? (
                  <ActionBtn
                    onClick={() => {
                      setRowsState(Array.from({ length: 8 }, blankEdit));
                      setEditingNew(true);
                    }}
                  >
                    Type it in instead
                  </ActionBtn>
                ) : null}
              </StepCard>
            </div>
            {v && v.system.length ? (
              <p className="border-t border-ink/20 px-4 py-3 text-[12px] text-ink-4">
                The system has <b className="text-ink-2">{v.system.length}</b> transaction{v.system.length === 1 ? "" : "s"} for this day —{" "}
                <button type="button" className="font-semibold text-gold-dark underline" onClick={() => setTab("system")}>
                  see the system sheet
                </button>
                .
              </p>
            ) : null}
          </Card>
        ) : (
          <div className="space-y-4">
            {sheet?.warnings.length && sheet.status === "DRAFT" ? (
              <Callout tone="warning" title="The reader is unsure about some lines">
                <ul className="list-disc space-y-0.5 pl-4">
                  {sheet.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </Callout>
            ) : null}
            {sheet?.status === "DRAFT" ? (
              <Callout tone="info" title="Draft — compare every line with the photo">
                The lines below were read by AI. Correct anything wrong (names, amounts, gold weight, Bank/Card notes), then press <b>Save &amp; check</b> to match them with the system.
              </Callout>
            ) : null}

            <div className={cn("grid gap-4", photoUrl && "2xl:grid-cols-[minmax(340px,0.7fr)_minmax(0,2fr)]")}>
              {photoUrl ? (
                <Card className="2xl:sticky 2xl:top-4 2xl:self-start">
                  <CardHead
                    icon={CameraIcon}
                    title="Photo of the sheet"
                    sub={sheet!.imageCount > 1 ? `Photo ${photo + 1} of ${sheet!.imageCount}` : "Tap to zoom"}
                    action={
                      sheet!.imageCount > 1 ? (
                        <span className="flex gap-1">
                          {Array.from({ length: sheet!.imageCount }, (_, i) => (
                            <button key={i} type="button" onClick={() => setPhoto(i)} className={cn("size-6 rounded text-[11px] font-semibold", i === photo ? "bg-void text-gold-light" : "bg-bone text-ink-3")}>
                              {i + 1}
                            </button>
                          ))}
                        </span>
                      ) : undefined
                    }
                  />
                  <div className={cn("overflow-auto p-2 scrollbar-thin", zoom ? "max-h-[80vh]" : "max-h-[45vh] 2xl:max-h-[70vh]")}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photoUrl}
                      alt="Uploaded day sheet"
                      onClick={() => setZoom((z) => !z)}
                      className={cn("cursor-zoom-in rounded-lg", zoom ? "w-[220%] max-w-none cursor-zoom-out" : "w-full")}
                    />
                  </div>
                  {canEdit ? (
                    <div className="border-t border-ink/20 px-3 py-2">
                      <button type="button" onClick={() => startUpload(true)} className="text-[11.5px] font-semibold text-gold-dark underline">
                        Add another page (adds its lines below)
                      </button>
                    </div>
                  ) : null}
                </Card>
              ) : null}

              <Card>
                <CardHead
                  icon={EditIcon}
                  title={sheet?.status === "DRAFT" || !sheet ? "Lines read from the sheet" : "Paper sheet lines"}
                  sub={dirty ? "Unsaved changes — Save & check to compare again" : sheet?.checked_at ? `Checked against the system ${new Date(sheet.checked_at).toLocaleTimeString()}` : "Not checked yet"}
                  action={
                    canEdit ? (
                      <button type="button" onClick={() => setRows((rs) => [...rs, blankEdit()])} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] font-semibold text-ink-3 ring-1 ring-inset ring-ink/20 hover:bg-bone">
                        <PlusIcon size={12} /> Line
                      </button>
                    ) : undefined
                  }
                />
                <SheetGrid rows={rows} setRows={setRows} results={results} sysByRef={sysByRef} dirty={dirty} canEdit={canEdit} onAction={onAction} />
                {errors.length ? <p className="px-4 pt-2 text-[11.5px] font-semibold text-rose-700">{errors.join(" · ")}</p> : null}
                {canEdit ? (
                  <div className="flex flex-wrap items-center gap-2 border-t border-ink/20 px-4 py-3">
                    <button
                      type="button"
                      disabled={save.isPending || errors.length > 0 || (!dirty && sheet?.status !== "DRAFT" && !editingNew)}
                      onClick={() => save.mutate(false)}
                      className="g-btn g-btn-primary h-9 px-4 text-[12.5px] disabled:opacity-50"
                    >
                      <ScaleIcon size={13} /> {save.isPending ? "Checking…" : "Save & check"}
                    </button>
                    <button
                      type="button"
                      disabled={save.isPending || errors.length > 0 || !dirty}
                      onClick={() => save.mutate(true)}
                      className="h-9 rounded-lg px-3 text-[12.5px] font-semibold text-ink-3 ring-1 ring-inset ring-ink/20 hover:bg-bone disabled:opacity-50"
                    >
                      Save draft
                    </button>
                    {dirty ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDirty(false);
                          setRowsState((v?.rows ?? []).map(toEdit));
                          if (!sheet) setEditingNew(false);
                        }}
                        className="h-9 rounded-lg px-3 text-[12.5px] font-semibold text-ink-4 hover:bg-bone"
                      >
                        Discard changes
                      </button>
                    ) : null}
                    <span className="ml-auto text-[11px] text-ink-5">
                      {rows.length} line{rows.length === 1 ? "" : "s"} · Rs {rupees(fromEdit(rows).reduce((t, r) => t + (r.receivedCents ?? 0), 0)) || 0} received
                    </span>
                  </div>
                ) : null}
              </Card>
            </div>

            {rec && sheet?.status !== "DRAFT" ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <Card>
                  <CardHead
                    icon={AlertCircleIcon}
                    title="In the system, not on the paper sheet"
                    sub={rec.missingOnSheet.length ? "Recorded in the books this day, but no line on the sheet matches" : "Every transaction in the books is on the sheet"}
                  />
                  {rec.missingOnSheet.length === 0 ? (
                    <Empty icon={ClipboardCheckIcon} title="Nothing missing" desc="Every system transaction for this day has a line on the paper." />
                  ) : (
                    <div>
                      {rec.missingOnSheet.map((s) => {
                        const l = systemAsSheetLine(s);
                        return (
                          <div key={s.ref} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink/20 px-4 py-2 text-[12px]">
                            <span className="min-w-0 flex-1">
                              <b className="text-ink">
                                {s.href ? (
                                  <Link href={s.href} className="hover:underline">
                                    {s.kind} {s.refNo}
                                  </Link>
                                ) : (
                                  `${s.kind} ${s.refNo ?? ""}`
                                )}
                              </b>
                              <span className="text-ink-3"> · {l.who || "—"}</span>
                              <span className="block truncate text-[11px] text-ink-5">{s.details}</span>
                            </span>
                            <span className="g-metric text-right text-[11.5px]">
                              {l.received ? <span className="block text-emerald-700">received {l.received}</span> : null}
                              {l.given ? <span className="block text-rose-700">given {l.given}</span> : null}
                              {l.oldGold ? <span className="block text-amber-800">old gold {l.oldGold}</span> : null}
                            </span>
                            {canEdit && !dirty ? (
                              <span className="flex gap-1">
                                <ActionBtn primary onClick={() => rowCall.mutate({ path: "/append", body: { ref: s.ref } })}>
                                  Add line to sheet
                                </ActionBtn>
                                <ActionBtn onClick={() => setAction({ kind: "ignore", ref: s.ref })}>Not for the sheet</ActionBtn>
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {rec.ignored.length ? (
                    <div className="border-t border-ink/20 px-4 py-2 text-[11px] text-ink-4">
                      Left off the sheet on purpose:{" "}
                      {rec.ignored.map((i, k) => (
                        <span key={i.ref}>
                          {k ? ", " : ""}
                          {sysByRef.get(i.ref)?.refNo ?? i.ref} ({i.note})
                          {canEdit ? (
                            <button type="button" className="ml-1 underline" onClick={() => rowCall.mutate({ path: "/ignore", body: { ref: i.ref, ignore: false } })}>
                              undo
                            </button>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </Card>
                <Card>
                  <CardHead icon={ScaleIcon} title="Column totals" sub="Paper sheet against the system" />
                  <TotalsCompare rec={rec} />
                </Card>
              </div>
            ) : null}
          </div>
        )
      ) : null}

      {tab === "system" ? (
        <Card>
          <CardHead
            icon={FileTextIcon}
            title="System day sheet"
            sub="Every sale, payment, old-gold purchase and drawer movement in the books for this day, in the paper sheet's columns"
            action={
              <Link href={`/day-sheet/print?branchId=${encodeURIComponent(branchId)}&date=${date}&mode=system`} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] font-semibold text-ink-3 ring-1 ring-inset ring-ink/20 hover:bg-bone">
                <PrinterIcon size={12} /> Print
              </Link>
            }
          />
          {view.isLoading ? <RowsSkeleton rows={6} /> : v && v.system.length ? <SystemTable rows={v.system} /> : <Empty icon={FileTextIcon} title="Nothing recorded" desc="The books have no customer transactions at this branch on this day." />}
        </Card>
      ) : null}

      {tab === "history" ? (
        <Card>
          <CardHead icon={HistoryIcon} title="Past day sheets" sub="Last 60 days at this branch" />
          {history.isLoading ? (
            <RowsSkeleton rows={5} />
          ) : !history.data?.rows.length ? (
            <Empty icon={HistoryIcon} title="No sheets yet" desc="Uploaded day sheets appear here." />
          ) : (
            <table className="w-full text-[12px]">
              <thead className={thead}>
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Status</th>
                  <th className={cn(th, "text-right")}>Lines</th>
                  <th className={cn(th, "text-right")}>Matched</th>
                  <th className={cn(th, "text-right")}>Mismatched</th>
                  <th className={cn(th, "text-right")}>Not in system</th>
                  <th className={cn(th, "text-right")}>Not on sheet</th>
                </tr>
              </thead>
              <tbody>
                {history.data.rows.map((h) => (
                  <tr
                    key={h.id}
                    onClick={() => {
                      setDate(h.sheet_date);
                      setTab("check");
                    }}
                    className="cursor-pointer border-t border-ink/20 hover:bg-gold-pale/30"
                  >
                    <td className="g-metric py-2 pl-2 font-semibold">{h.sheet_date}</td>
                    <td className="py-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                          h.status === "VERIFIED" ? "bg-emerald-500/12 text-emerald-800" : h.status === "ISSUES" ? "bg-rose-500/12 text-rose-800" : "bg-amber-500/14 text-amber-900"
                        )}
                      >
                        {h.status === "VERIFIED" ? "Verified" : h.status === "ISSUES" ? "Issues" : "Draft"}
                      </span>
                    </td>
                    <td className="g-metric py-2 pr-2 text-right">{h.rows}</td>
                    <td className="g-metric py-2 pr-2 text-right">{h.matched_count}</td>
                    <td className={cn("g-metric py-2 pr-2 text-right", h.mismatch_count && "font-semibold text-rose-700")}>{h.mismatch_count}</td>
                    <td className={cn("g-metric py-2 pr-2 text-right", h.missing_in_system_count && "font-semibold text-amber-800")}>{h.missing_in_system_count}</td>
                    <td className={cn("g-metric py-2 pr-2 text-right", h.missing_on_sheet_count && "font-semibold text-amber-800")}>{h.missing_on_sheet_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      {action?.kind === "record" && actionRow && sheet ? (
        canRecord ? (
          <RecordModal row={actionRow} branchId={branchId} pending={record.isPending} onClose={() => setAction(null)} onSubmit={(payload) => record.mutate({ rowId: actionRow.id, payload })} />
        ) : (
          <NoteModal
            title="You cannot record money"
            label="Recording money needs the accounts:manage permission. Ask a manager, or accept the line with a note instead."
            submitLabel="Accept line"
            pending={rowCall.isPending}
            onClose={() => setAction(null)}
            onSubmit={(note) => rowCall.mutate({ path: `/rows/${actionRow.id}/accept`, body: { accepted: true, note } })}
          />
        )
      ) : null}
      {action?.kind === "link" && actionRow && v ? (
        <LinkModal
          row={actionRow}
          system={v.system}
          takenRefs={takenRefs}
          pending={rowCall.isPending}
          onClose={() => setAction(null)}
          onLink={(ref) => rowCall.mutate({ path: `/rows/${actionRow.id}/link`, body: { ref } })}
        />
      ) : null}
      {action?.kind === "accept" && actionRow ? (
        <NoteModal
          title="Accept this line as it is"
          kicker={actionRow.name || actionRow.refNo || "Day sheet line"}
          label="Why is the difference fine? (e.g. discount given, written twice, paid at another branch)"
          submitLabel="Accept"
          pending={rowCall.isPending}
          onClose={() => setAction(null)}
          onSubmit={(note) => rowCall.mutate({ path: `/rows/${actionRow.id}/accept`, body: { accepted: true, note } })}
        />
      ) : null}
      {action?.kind === "ignore" ? (
        <NoteModal
          title="Not for the paper sheet"
          kicker={sysByRef.get(action.ref)?.refNo ?? undefined}
          label="Why does this transaction not go on the counter's sheet? (e.g. bank transfer by the owner)"
          submitLabel="Leave it off"
          pending={rowCall.isPending}
          onClose={() => setAction(null)}
          onSubmit={(note) => rowCall.mutate({ path: "/ignore", body: { ref: action.ref, ignore: true, note } })}
        />
      ) : null}
    </Page>
  );
}

function StepCard({ n, title, body, children }: { n: number; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-bone/60 p-4 ring-1 ring-inset ring-ink/20">
      <span className="flex size-7 items-center justify-center rounded-full bg-void text-[12px] font-bold text-gold-light">{n}</span>
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      <p className="flex-1 text-[11.5px] leading-snug text-ink-4">{body}</p>
      <div>{children}</div>
    </div>
  );
}

export default function DaySheetPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <DaySheetScreen />
    </Suspense>
  );
}
