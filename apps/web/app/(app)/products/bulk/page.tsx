"use client";

import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { BULK_PRODUCTS_MAX } from "@goldos/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ratePriceLkr } from "@/lib/pricing";
import { Page } from "@/components/ui";
import { GoldHero, HeroBadge, heroGhost, heroGold } from "@/components/console-kit";
import { Select } from "@/components/select";
import {
  CheckCircleIcon,
  CoinsIcon,
  CopyIcon,
  FileTextIcon,
  GemIcon,
  LayersIcon,
  PackageIcon,
  PackagePlusIcon,
  PlusIcon,
  PrinterIcon,
  ScaleIcon,
  SparklesIcon,
  StoreIcon,
  TagsIcon,
  TrashIcon,
} from "@/components/icons";
import { Field, FormSection, UnitInput, fmtG, inputCls, toOptions, type Option } from "../product-form-kit";

/* ------------------------------------------------------------------ model */

/** What every piece in the tray shares. Money/weights here are per-piece defaults. */
const commonSchema = z.object({
  name: z.string().max(100).optional(),
  designId: z.string().optional(),
  productTypeId: z.string().optional(),
  metalTypeId: z.string().min(1),
  stoneTypeId: z.string().optional(),
  purityId: z.string().min(1),
  branchId: z.string().min(1),
  makingLkr: z.string().optional(),
  wastageG: z.string().optional(),
  costLkr: z.string().optional(),
  /** Cost per gram of net weight — each piece's cost follows its own weight. */
  costPerG: z.string().optional(),
  /** Gold rate per gram: the default for every piece; a row can type its own. */
  ratePerGLkr: z.string().optional(),
  sellingPriceLkr: z.string().optional(),
  location: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});
type Common = z.infer<typeof commonSchema>;

/** Per-piece cells are kept as typed text so half-typed numbers survive re-renders. */
type Row = {
  key: string;
  name: string;
  grossG: string;
  /** Gold rate per gram for this piece; blank uses the shared rate. */
  rateLkr: string;
  /** Category for this piece; blank uses the tray's. */
  categoryId: string;
  /** Subcategory for this piece; blank uses the tray's when it's the same category. */
  subcategoryName: string;
  makingLkr: string;
  costLkr: string;
  sellingPriceLkr: string;
  location: string;
};
type Cell = Exclude<keyof Row, "key">;

/** Optional per-piece columns; weight and name are always shown. */
const EXTRA_COLS: { id: Cell; label: string; unit?: string; placeholderFrom: keyof Common; numeric: boolean }[] = [
  { id: "makingLkr", label: "Making", unit: "LKR", placeholderFrom: "makingLkr", numeric: true },
  { id: "costLkr", label: "Cost", unit: "LKR", placeholderFrom: "costLkr", numeric: true },
  { id: "sellingPriceLkr", label: "Price", unit: "LKR", placeholderFrom: "sellingPriceLkr", numeric: true },
  { id: "location", label: "Tray", placeholderFrom: "location", numeric: false },
];

const DRAFT_KEY = "goldos_bulk_intake_draft_v1";

const newRow = (init?: Partial<Row>): Row => ({
  key: crypto.randomUUID(),
  name: "",
  grossG: "",
  rateLkr: "",
  categoryId: "",
  subcategoryName: "",
  makingLkr: "",
  costLkr: "",
  sellingPriceLkr: "",
  location: "",
  ...init,
});

const isBlank = (r: Row) => !r.name.trim() && !r.subcategoryName.trim() && !r.grossG.trim() && !r.rateLkr.trim() && !r.costLkr.trim() && !r.sellingPriceLkr.trim() && !r.makingLkr.trim() && !r.location.trim();

/** "3.250", "3.25g", "1,500" → number; blank → undefined; junk → NaN. */
function num(s: string | undefined): number | undefined {
  const t = (s ?? "").trim().replace(/^(lkr|rs\.?)\s*/i, "").replace(/\s*(g|gr|grams?|lkr)$/i, "").replace(/,(?=\d{3}(\D|$))/g, "");
  if (!t) return undefined;
  return /^\d*\.?\d+$/.test(t) ? Number(t) : NaN;
}

type RowCheck = {
  blank: boolean;
  errors: Partial<Record<Cell, string>>;
  gross?: number;
  net: number | null;
};

function checkRow(r: Row): RowCheck {
  const errors: RowCheck["errors"] = {};
  if (isBlank(r)) return { blank: true, errors, net: null };
  if (!r.categoryId) errors.categoryId = "Pick a category";
  const gross = num(r.grossG);
  if (gross === undefined) errors.grossG = "Weight needed";
  else if (!Number.isFinite(gross) || gross <= 0) errors.grossG = "Must be more than 0";
  else if (gross > 100000) errors.grossG = "Too heavy";
  for (const k of ["rateLkr", "makingLkr", "costLkr", "sellingPriceLkr"] as const) {
    const v = num(r[k]);
    if (v !== undefined && !Number.isFinite(v)) errors[k] = "Not a number";
  }
  if (r.name.length > 100) errors.name = "Max 100 characters";
  const net = gross !== undefined && Number.isFinite(gross) && gross > 0 ? gross : null;
  return { blank: false, errors, gross, net };
}

/**
 * Pasted text → pieces. Accepts a column of weights (from a spreadsheet or a
 * scale's export), "name<TAB>weight" lines, or one line of weights
 * separated by spaces/commas.
 */
function parsePaste(text: string): Partial<Row>[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1 && !lines[0]!.includes("\t")) {
    const toks = lines[0]!.split(/[\s;,]+/).filter(Boolean);
    if (toks.length > 1 && toks.every((t) => Number.isFinite(num(t)))) return toks.map((t) => ({ grossG: String(num(t)) }));
  }
  // A clean number is stored normalised; anything else is kept as typed so
  // the row shows it and flags it, rather than silently dropping it.
  const w = (s: string | undefined) => {
    const v = num(s);
    return v !== undefined && Number.isFinite(v) ? String(v) : (s ?? "");
  };
  return lines.map((line) => {
    const cells = line.split("\t").map((c) => c.trim());
    if (Number.isFinite(num(cells[0]))) return { grossG: w(cells[0]) };
    if (cells.length === 1) return { name: cells[0] };
    return { name: cells[0], grossG: w(cells[1]) };
  });
}

type BulkResult = {
  batchId: string;
  products: { id: string; barcode: string; sku: string; name: string; gross_mg: number; stone_mg: number; net_mg: number; fine_gold_mg: number }[];
  totals: { count: number; gross_mg: number; net_mg: number; fine_gold_mg: number; cost_cents: number };
};

function branchCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split("; ")
    .find((c) => c.startsWith("goldos_branch="))
    ?.split("=")[1];
}

function readDraft(): { common: Partial<Common>; rows: Row[]; cols: Cell[] } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { common: Partial<Common>; rows: Row[]; cols: Cell[] };
    return Array.isArray(d.rows) && d.rows.some((r) => !isBlank(r)) ? d : null;
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

const lkr = (n: number) => Math.round(n).toLocaleString("en-US");

/* ------------------------------------------------------------------- page */

export default function BulkProductsPage() {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 5 }, () => newRow()));
  const [cols, setCols] = useState<Cell[]>(["costLkr"]);
  const [addN, setAddN] = useState("10");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [serverRow, setServerRow] = useState<number | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const cellRefs = useRef(new Map<string, HTMLInputElement>());
  const [focusNext, setFocusNext] = useState<{ key: string; cell: Cell } | null>(null);
  const restored = useRef(false);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    reset,
    formState: { errors },
  } = useForm<Common>({ resolver: zodResolver(commonSchema), defaultValues: { branchId: branchCookie() ?? "" } });
  const common = watch();

  const opt = <T,>(key: string, path: string) =>
    useQuery({ queryKey: [key], queryFn: () => api<{ rows: T[]; total: number }>(path) });
  const cats = opt<Option>("categories-all", "/api/v1/masters/categories?limit=100");
  const designs = opt<Option>("designs-all", "/api/v1/masters/designs?limit=100");
  const ptypes = opt<Option>("ptypes-all", "/api/v1/masters/product-types?limit=100");
  const metals = opt<Option>("metals-all", "/api/v1/masters/metal-types?limit=100");
  const stones = opt<Option>("stones-all", "/api/v1/masters/stone-types?limit=100");
  const purs = opt<Option>("purities-all", "/api/v1/masters/purities?limit=100");
  const branches = opt<Option>("branches", "/api/v1/branches?limit=100");
  const board = useQuery({
    queryKey: ["gold-rates-current"],
    queryFn: () => api<{ purity_id: string; rate_per_gram: number }[]>("/api/v1/gold-rates/current"),
  });
  const rates = Object.fromEntries((board.data ?? []).map((r) => [r.purity_id, r.rate_per_gram]));
  // Each row's subcategory suggestions come from that row's category.
  const rowCategoryIds = useMemo(() => [...new Set(rows.map((r) => r.categoryId).filter(Boolean))], [rows]);
  const rowSubcats = useQueries({
    queries: rowCategoryIds.map((id) => ({
      queryKey: ["subcats-by-cat", id],
      queryFn: () => api<{ rows: Option[]; total: number }>(`/api/v1/masters/subcategories?limit=100&categoryId=${id}`),
    })),
  });
  // The barcodes each category's next pieces will get, shown on the rows before saving.
  const rowBarcodes = useQueries({
    queries: rowCategoryIds.map((id) => ({
      queryKey: ["next-barcodes", id],
      queryFn: () => api<{ barcode: string; barcodes: string[] }>(`/api/v1/products/next-barcode?categoryId=${id}&count=${BULK_PRODUCTS_MAX}`),
    })),
  });

  // A half-weighed tray survives a reload or a closed tab.
  useEffect(() => {
    const d = readDraft();
    if (d) {
      reset({ branchId: branchCookie() ?? "", ...d.common });
      // Drafts saved before the rate and category columns existed lack those fields; default them.
      setRows(
        d.rows.length
          ? d.rows.map((r) => newRow({ ...r, rateLkr: r.rateLkr ?? "", categoryId: r.categoryId ?? "", subcategoryName: r.subcategoryName ?? "" }))
          : [newRow()]
      );
      setCols(d.cols ?? ["costLkr"]);
      toast.message("Draft restored", { description: `${d.rows.filter((r) => !isBlank(r)).length} pieces from your last session` });
    }
    restored.current = true;
  }, [reset]);
  useEffect(() => {
    if (!restored.current || result) return;
    const t = setTimeout(() => {
      try {
        if (rows.some((r) => !isBlank(r))) localStorage.setItem(DRAFT_KEY, JSON.stringify({ common: getValues(), rows, cols }));
        else localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* private window / storage blocked — the tray just isn't remembered */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [rows, cols, common, getValues, result]);

  // Gold · 22K are the shop's usual piece, so they start selected.
  useEffect(() => {
    if (!getValues("metalTypeId")) {
      const gold = metals.data?.rows.find((m) => m.name?.trim().toLowerCase() === "gold");
      if (gold) setValue("metalTypeId", gold.id);
    }
  }, [metals.data, getValues, setValue]);
  useEffect(() => {
    if (!getValues("purityId")) {
      const k22 = purs.data?.rows.find((p) => p.karat?.trim().toLowerCase() === "22k");
      if (k22) setValue("purityId", k22.id);
    }
  }, [purs.data, getValues, setValue]);

  useEffect(() => {
    if (!focusNext) return;
    const el = cellRefs.current.get(`${focusNext.key}:${focusNext.cell}`);
    if (el) {
      el.focus();
      el.select();
    }
    setFocusNext(null);
  }, [focusNext, rows]);

  /* -------------------------------------------------------------- derived */

  const checks = useMemo(() => rows.map((r) => checkRow(r)), [rows]);
  const filled = checks.filter((c) => !c.blank);
  const invalidCount = filled.filter((c) => Object.keys(c.errors).length > 0).length;
  const purity = purs.data?.rows.find((p) => p.id === common.purityId);
  const permille = purity?.permille;
  const rate = common.purityId ? rates[common.purityId] : undefined;
  const commonMaking = num(common.makingLkr);
  const commonCost = num(common.costLkr);
  const commonPrice = num(common.sellingPriceLkr);
  const commonRate = num(common.ratePerGLkr);
  const ok = (n: number | undefined) => (n !== undefined && Number.isFinite(n) ? n : undefined);
  const costPerG = ok(num(common.costPerG));
  /** A piece's cost: its own figure, else net × cost/g, else the shared per-piece cost. */
  const pieceCost = (r: Row, net: number | null) =>
    ok(num(r.costLkr)) ?? (costPerG !== undefined && net !== null ? Math.round(net * costPerG * 100) / 100 : ok(commonCost));
  /** A piece's rate per gram: its own, else the shared one. */
  const rowRate = (r: Row) => ok(num(r.rateLkr)) ?? ok(commonRate);
  /**
   * A piece's selling price: typed, else net × rate + making when a rate is set,
   * else undefined — the live rate prices it at the counter.
   */
  const rowPrice = (r: Row, net: number | null) => {
    const typed = ok(num(r.sellingPriceLkr)) ?? ok(commonPrice);
    if (typed !== undefined) return typed;
    const rr = rowRate(r);
    if (rr === undefined || net === null) return undefined;
    return ratePriceLkr(net, rr, ok(num(r.makingLkr)) ?? commonMaking ?? 0);
  };

  const totals = useMemo(() => {
    let gross = 0, net = 0, fine = 0, value = 0, cost = 0;
    let valued = true;
    rows.forEach((r, i) => {
      const c = checks[i]!;
      if (c.blank || c.net === null) return;
      gross += c.gross ?? 0;
      net += c.net;
      if (permille) fine += (c.net * permille) / 1000;
      const price = rowPrice(r, c.net);
      const making = ok(num(r.makingLkr)) ?? ok(commonMaking) ?? 0;
      if (price !== undefined) value += price;
      else if (rate) value += c.net * rate + making;
      else valued = false;
      cost += pieceCost(r, c.net) ?? 0;
    });
    return { gross, net, fine, value: valued ? value : null, cost };
  }, [rows, checks, permille, rate, commonMaking, commonCost, costPerG, commonPrice, commonRate]);

  /* ---------------------------------------------------------------- edits */

  const setCell = (key: string, cell: Cell, v: string) => {
    setServerRow(null);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [cell]: v } : r)));
  };
  const room = BULK_PRODUCTS_MAX - rows.length;
  const addRows = (n: number) => {
    const k = Math.max(0, Math.min(n, room));
    if (k < n) toast.error(`A tray holds at most ${BULK_PRODUCTS_MAX} pieces`);
    if (k) setRows((rs) => [...rs, ...Array.from({ length: k }, () => newRow())]);
  };
  const removeRow = (key: string) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [newRow()]));
  const duplicateRow = (key: string) => {
    if (room <= 0) return toast.error(`A tray holds at most ${BULK_PRODUCTS_MAX} pieces`);
    const src = rows.find((r) => r.key === key);
    if (!src) return;
    const copy = newRow({ ...src, key: crypto.randomUUID() });
    setRows((rs) => {
      const i = rs.findIndex((r) => r.key === key);
      return [...rs.slice(0, i + 1), copy, ...rs.slice(i + 1)];
    });
    setFocusNext({ key: copy.key, cell: "grossG" });
  };
  const clearBlankRows = () => setRows((rs) => {
    const kept = rs.filter((r) => !isBlank(r));
    return kept.length ? kept : [newRow()];
  });

  /** Fill pasted pieces from row `at` downward, adding rows as needed. */
  const fillFrom = (at: number, pieces: Partial<Row>[]) => {
    setServerRow(null);
    setRows((rs) => {
      const next = [...rs];
      let dropped = 0;
      pieces.forEach((p, j) => {
        const i = at + j;
        if (i >= BULK_PRODUCTS_MAX) return void dropped++;
        next[i] = { ...(next[i] ?? newRow()), ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== "")) };
      });
      if (dropped) toast.error(`${dropped} line${dropped === 1 ? "" : "s"} past the ${BULK_PRODUCTS_MAX}-piece limit were left out`);
      return next;
    });
    toast.success(`Filled ${Math.min(pieces.length, BULK_PRODUCTS_MAX - at)} rows`);
  };

  const onGrossPaste = (i: number) => (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    const pieces = parsePaste(text);
    if (pieces.length <= 1 && !text.includes("\t")) return; // a single value pastes normally
    e.preventDefault();
    fillFrom(i, pieces);
  };

  /** Enter / ↓ moves down the column (adding a row at the end); ↑ moves up. */
  const onCellKey = (i: number, cell: Cell) => (e: KeyboardEvent<HTMLInputElement>) => {
    const down = e.key === "Enter" || e.key === "ArrowDown";
    const up = e.key === "ArrowUp";
    if (!down && !up) return;
    e.preventDefault();
    if (up) {
      const prev = rows[i - 1];
      if (prev) setFocusNext({ key: prev.key, cell });
      return;
    }
    const nxt = rows[i + 1];
    if (nxt) return setFocusNext({ key: nxt.key, cell });
    if (room <= 0) return toast.error(`A tray holds at most ${BULK_PRODUCTS_MAX} pieces`);
    const r = newRow();
    setRows((rs) => [...rs, r]);
    setFocusNext({ key: r.key, cell });
  };

  /* --------------------------------------------------------------- submit */

  const save = useMutation({
    mutationFn: async (c: Common) => {
      const n = (s: string | undefined) => ok(num(s));
      const trimmed = (s: string | undefined) => s?.trim() || undefined;
      const payload = {
        common: {
          name: trimmed(c.name),
          designId: c.designId || undefined,
          productTypeId: c.productTypeId || undefined,
          metalTypeId: c.metalTypeId,
          stoneTypeId: c.stoneTypeId || undefined,
          purityId: c.purityId,
          branchId: c.branchId,
          makingLkr: n(c.makingLkr) ?? 0,
          wastageG: n(c.wastageG) ?? 0,
          costLkr: n(c.costLkr),
          sellingPriceLkr: n(c.sellingPriceLkr),
          location: trimmed(c.location),
          notes: trimmed(c.notes),
        },
        items: rows
          .map((r, i) => ({ r, net: checks[i]!.net }))
          .filter(({ r }) => !isBlank(r))
          .map(({ r, net }) => ({
            name: trimmed(r.name),
            categoryId: r.categoryId || undefined,
            subcategoryName: trimmed(r.subcategoryName),
            grossG: n(r.grossG)!,
            makingLkr: n(r.makingLkr),
            costLkr: pieceCost(r, net),
            sellingPriceLkr: rowPrice(r, net),
            location: trimmed(r.location),
          })),
      };
      return api<BulkResult>("/api/v1/products/bulk", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: (r) => {
      clearDraft();
      setResult(r);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["products-count"] });
      qc.invalidateQueries({ queryKey: ["subcats-by-cat"] });
      qc.invalidateQueries({ queryKey: ["next-barcodes"] });
      toast.success(`${r.totals.count} products created`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Save failed";
      // "Row 3: …" counts only filled rows; map it back onto the grid.
      const m = /^Row (\d+):/.exec(msg);
      if (m) {
        const filledKeys = rows.filter((r) => !isBlank(r)).map((r) => r.key);
        const key = filledKeys[Number(m[1]) - 1];
        const idx = rows.findIndex((r) => r.key === key);
        if (idx >= 0) {
          setServerRow(idx);
          setFocusNext({ key: key!, cell: "grossG" });
          return toast.error(msg.replace(/^Row \d+:/, `Row ${idx + 1}:`));
        }
      }
      toast.error(msg);
    },
  });

  const onSubmit = handleSubmit(
    (c) => {
      setShowErrors(true);
      if (filled.length === 0) {
        toast.error("Weigh at least one piece first");
        if (rows[0]) setFocusNext({ key: rows[0].key, cell: "grossG" });
        return;
      }
      const bad = checks.findIndex((x) => !x.blank && Object.keys(x.errors).length > 0);
      if (bad >= 0) {
        const cell = Object.keys(checks[bad]!.errors)[0] as Cell;
        if (cell !== "grossG" && cell !== "rateLkr" && cell !== "categoryId" && cell !== "name" && !cols.includes(cell)) setCols((cs) => [...cs, cell]);
        setFocusNext({ key: rows[bad]!.key, cell });
        toast.error(`Row ${bad + 1}: ${Object.values(checks[bad]!.errors)[0]}`);
        return;
      }
      if (c.costPerG?.trim() && costPerG === undefined) return toast.error("Cost per gram is not a number");
      save.mutate(c);
    },
    () => {
      document.getElementById("bk-s1")?.scrollIntoView({ behavior: "smooth", block: "start" });
      toast.error("Metal, purity and branch are needed for the whole tray");
    }
  );

  const startAnother = () => {
    setResult(null);
    setRows(Array.from({ length: 5 }, () => newRow()));
    setShowErrors(false);
    setServerRow(null);
  };

  /* ---------------------------------------------------------------- views */

  if (result) return <ResultView result={result} onAnother={startAnother} />;

  const catNameOf = (id: string) => cats.data?.rows.find((c) => c.id === id)?.name;
  // Each filled row takes the next barcode in its category, in row order, as the save will.
  const barcodeOf = new Map<string, string>();
  const takenPerCategory: Record<string, number> = {};
  for (const r of rows) {
    if (isBlank(r) || !r.categoryId) continue;
    const k = takenPerCategory[r.categoryId] ?? 0;
    takenPerCategory[r.categoryId] = k + 1;
    const b = rowBarcodes[rowCategoryIds.indexOf(r.categoryId)]?.data?.barcodes?.[k];
    if (b) barcodeOf.set(r.key, b);
  }
  const visibleExtras = EXTRA_COLS.filter((c) => cols.includes(c.id));

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={PackagePlusIcon}
        title="Bulk"
        accent="intake"
        badge={
          <HeroBadge tone={filled.length && !invalidCount ? "good" : "gold"}>
            {filled.length} piece{filled.length === 1 ? "" : "s"}
            {invalidCount ? ` · ${invalidCount} to fix` : ""}
          </HeroBadge>
        }
        sub="A tray of like pieces in one go · enter the shared details once, then just the weights · every piece gets its own barcode"
        back={{ href: "/products", label: "Products" }}
        actions={
          <>
            <Link href="/products/new" className={heroGhost}>
              Single piece
            </Link>
            <button type="submit" form="bk-form" disabled={save.isPending || filled.length === 0} className={heroGold}>
              {save.isPending ? "Saving…" : `Save ${filled.length || ""} product${filled.length === 1 ? "" : "s"}`}
            </button>
          </>
        }
        stats={[
          { label: "Pieces", value: filled.length, accent: true, sub: `max ${BULK_PRODUCTS_MAX}` },
          { label: "Gross", value: totals.gross || null, format: (n) => n.toFixed(3), unit: "g" },
          { label: "Net", value: totals.net || null, format: (n) => n.toFixed(3), unit: "g" },
          { label: "Fine gold", value: permille ? totals.fine || null : null, format: (n) => n.toFixed(3), unit: "g", sub: purity ? `${purity.karat} · ${permille}‰` : "pick a purity" },
          { label: "Est. value", value: totals.value || null, format: lkr, unit: "LKR", sub: totals.value === null ? "no board rate" : "price or live board" },
          { label: "Cost", value: totals.cost || null, format: lkr, unit: "LKR" },
        ]}
      />

      <form id="bk-form" noValidate onSubmit={onSubmit} className="space-y-5">
        <FormSection
          id="bk-s1"
          n="1"
          title="Shared details"
          description="Set once — applies to every piece in the tray"
          icon={<TagsIcon size={17} />}
          done={Boolean(common.metalTypeId && common.purityId && common.branchId)}
          required
        >
          <div className="grid gap-x-3 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Item" optional hint="Default name for every piece; a row can override it" className="sm:col-span-2">
              <input className={cn(inputCls, "font-medium")} placeholder="e.g. Plain wedding band" {...register("name")} />
            </Field>
            {(
              [
                { name: "metalTypeId", label: "Metal", rows: metals, required: true, icon: <CoinsIcon size={13} /> },
                { name: "purityId", label: "Purity", rows: purs, required: true, icon: <SparklesIcon size={13} /> },
                { name: "branchId", label: "Branch", rows: branches, required: true, icon: <StoreIcon size={13} /> },
                { name: "stoneTypeId", label: "Stone type", rows: stones, icon: <GemIcon size={13} /> },
                { name: "designId", label: "Design", rows: designs, icon: <SparklesIcon size={13} /> },
                { name: "productTypeId", label: "Product type", rows: ptypes, icon: <PackageIcon size={13} /> },
              ] as const
            ).map((f) => (
              <Field
                key={f.name}
                label={f.label}
                required={"required" in f}
                optional={!("required" in f)}
                error={errors[f.name] ? `Pick a ${f.label.toLowerCase()}` : undefined}
                hint={f.name === "purityId" && permille ? `${permille}‰ fine${rate ? ` · board ${lkr(rate)}/g` : ""}` : undefined}
              >
                <Controller
                  control={control}
                  name={f.name}
                  render={({ field }) => (
                    <Select
                      buttonRef={field.ref}
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      options={
                        f.name === "purityId"
                          ? (f.rows.data?.rows ?? []).map((p) => ({ value: p.id, label: p.karat ?? p.name ?? p.id, hint: p.permille ? `${p.permille}‰` : undefined }))
                          : toOptions(f.rows.data?.rows, "required" in f ? undefined : "None")
                      }
                      placeholder={"required" in f ? `Choose ${f.label.toLowerCase()}` : "None"}
                      icon={f.icon}
                      invalid={Boolean(errors[f.name])}
                      loading={f.rows.isLoading}
                      hintInTrigger={f.name === "purityId"}
                      size="sm"
                    />
                  )}
                />
              </Field>
            ))}
          </div>

          <div className="g-kicker mb-3 mt-6 flex items-center gap-2">
            Per-piece defaults
            <span className="h-px flex-1 bg-gradient-to-r from-gold/30 to-transparent" />
          </div>
          <div className="grid gap-x-3 gap-y-3.5 sm:grid-cols-3 lg:grid-cols-4">
            <Field label="Wastage" optional>
              <UnitInput unit="g" {...register("wastageG")} />
            </Field>
            <Field label="Making" optional hint="Per piece">
              <UnitInput unit="LKR" {...register("makingLkr")} />
            </Field>
            <Field label="Rate / g" optional hint="Gold per gram · a row can type its own">
              <UnitInput unit="LKR/g" {...register("ratePerGLkr")} />
            </Field>
            <Field label="Cost" optional hint="Same for every piece">
              <UnitInput unit="LKR" {...register("costLkr")} />
            </Field>
            <Field label="Cost / g" optional hint="× each piece's net weight">
              <UnitInput unit="LKR/g" {...register("costPerG")} />
            </Field>
            <Field label="Selling price" optional hint="Blank = rate × weight, else live">
              <UnitInput unit="LKR" {...register("sellingPriceLkr")} />
            </Field>
            <Field label="Location" optional>
              <input className={inputCls} placeholder="Tray, showcase…" {...register("location")} />
            </Field>
            <Field label="Notes" optional className="sm:col-span-3 lg:col-span-1">
              <span className="relative block">
                <FileTextIcon size={14} className="pointer-events-none absolute left-3.5 top-3 text-ink-5" />
                <input className={cn(inputCls, "pl-10")} placeholder="Supplier lot, hallmark, reference…" {...register("notes")} />
              </span>
            </Field>
          </div>
        </FormSection>

        <FormSection
          id="bk-s2"
          n="2"
          title="Pieces"
          description="One row per piece · category, weight, rate per gram · Enter moves down · paste a column of weights to fill many"
          icon={<ScaleIcon size={17} />}
          done={filled.length > 0 && invalidCount === 0}
          required
        >
          {/* Toolbar */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-4">Columns</span>
            {EXTRA_COLS.map((c) => {
              const on = cols.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setCols((cs) => (on ? cs.filter((x) => x !== c.id) : [...cs, c.id]))}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 transition-colors",
                    on ? "bg-void text-gold-light ring-void" : "bg-paper text-ink-3 ring-ink/10 hover:ring-gold/50"
                  )}
                >
                  {c.label}
                </button>
              );
            })}
            <span className="mx-1 hidden h-5 w-px bg-ink/10 sm:block" />
            <button type="button" onClick={() => setPasteOpen((o) => !o)} className="g-btn g-btn-secondary h-8 rounded-lg px-3 text-xs">
              <CopyIcon size={12} />
              Paste list
            </button>
            <button type="button" onClick={clearBlankRows} className="g-btn h-8 rounded-lg px-3 text-xs text-ink-3 hover:bg-bone">
              Remove empty rows
            </button>
          </div>

          {pasteOpen ? (
            <div className="mb-4 rounded-xl bg-bone/60 p-3 ring-1 ring-ink/[0.06]">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-4" htmlFor="bk-paste">
                One piece per line
              </label>
              <textarea
                id="bk-paste"
                rows={5}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={"3.250\n3.410\n2.980\n\nor  Name ⇥ Gross  (copied from a spreadsheet)"}
                className={cn(inputCls, "g-metric h-auto py-2 leading-relaxed")}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!pasteText.trim()}
                  onClick={() => {
                    const pieces = parsePaste(pasteText);
                    // Fill after the last row that already has something in it.
                    const lastFilled = rows.reduce((at, r, i) => (isBlank(r) ? at : i), -1);
                    fillFrom(lastFilled + 1, pieces);
                    setPasteText("");
                    setPasteOpen(false);
                  }}
                  className="g-btn g-btn-primary h-8 rounded-lg px-3 text-xs"
                >
                  Add {parsePaste(pasteText).length || ""} rows
                </button>
                <span className="text-[11px] text-ink-5">Appended after the rows already filled. Units like “g” are ignored.</span>
              </div>
            </div>
          ) : null}

          {/* Grid */}
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[58rem] border-separate border-spacing-y-1 text-[13px]">
              <thead>
                <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4">
                  <th className="w-10 px-1 py-1 text-right">#</th>
                  <th className="w-40 px-1 py-1">Barcode</th>
                  <th className="px-1 py-1">Item</th>
                  <th className="w-40 px-1 py-1">
                    Category<span className="ml-0.5 text-gold-dark">*</span>
                  </th>
                  <th className="w-36 px-1 py-1">Subcategory</th>
                  <th className="w-28 px-1 py-1">
                    Gross g<span className="ml-0.5 text-gold-dark">*</span>
                  </th>
                  <th className="w-28 px-1 py-1">Rate LKR/g</th>
                  {visibleExtras.map((c) => (
                    <th key={c.id} className={cn("px-1 py-1", c.numeric ? "w-28" : "w-32")}>
                      {c.label}
                      {c.unit ? ` ${c.unit}` : ""}
                    </th>
                  ))}
                  <th className="w-20 px-1 py-1 text-right">Net g</th>
                  <th className="w-28 px-1 py-1 text-right">Price LKR</th>
                  <th className="w-16 px-1 py-1" aria-label="Row actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const c = checks[i]!;
                  const show = (showErrors || serverRow === i) && !c.blank;
                  const err = (cell: Cell) => (show ? c.errors[cell] : undefined);
                  const cellInput = (cell: Cell, opts: { numeric: boolean; placeholder?: string; className?: string; list?: string; onPaste?: (e: ClipboardEvent<HTMLInputElement>) => void }) => (
                    <input
                      ref={(el) => {
                        if (el) cellRefs.current.set(`${r.key}:${cell}`, el);
                        else cellRefs.current.delete(`${r.key}:${cell}`);
                      }}
                      value={r[cell]}
                      onChange={(e) => setCell(r.key, cell, e.target.value)}
                      onKeyDown={onCellKey(i, cell)}
                      onPaste={opts.onPaste}
                      inputMode={opts.numeric ? "decimal" : undefined}
                      autoComplete="off"
                      list={opts.list}
                      placeholder={opts.placeholder}
                      aria-label={`Row ${i + 1} ${cell}`}
                      aria-invalid={err(cell) ? true : undefined}
                      title={err(cell)}
                      className={cn(inputCls, "h-8", opts.numeric && "g-metric text-right", opts.className)}
                    />
                  );
                  return (
                    <tr key={r.key} className={cn("group", serverRow === i && "[&>td]:bg-rose-50")}>
                      <td className="g-metric rounded-l-lg px-1 text-right text-[11px] text-ink-5">{i + 1}</td>
                      <td className="g-metric px-1 text-[12px] text-ink-3" title="Assigned when the pieces are saved">
                        {barcodeOf.get(r.key) ?? (r.categoryId ? "…" : "—")}
                      </td>
                      <td className="px-1">
                        {cellInput("name", { numeric: false, placeholder: common.name?.trim() || catNameOf(r.categoryId) || "Item" })}
                      </td>
                      <td className="px-1">
                        <Select
                          value={r.categoryId}
                          onChange={(v) => setCell(r.key, "categoryId", v)}
                          options={toOptions(cats.data?.rows)}
                          placeholder="Choose"
                          ariaLabel={`Row ${i + 1} category`}
                          invalid={Boolean(err("categoryId"))}
                          loading={cats.isLoading}
                          size="sm"
                        />
                      </td>
                      <td className="px-1">
                        {cellInput("subcategoryName", {
                          numeric: false,
                          placeholder: "None",
                          list: r.categoryId ? `bk-subcats-${r.categoryId}` : undefined,
                        })}
                      </td>
                      <td className="px-1">
                        {cellInput("grossG", { numeric: true, placeholder: "0.000", className: "font-medium", onPaste: onGrossPaste(i) })}
                      </td>
                      <td className="px-1">
                        {cellInput("rateLkr", { numeric: true, placeholder: common.ratePerGLkr?.trim() || "0.00" })}
                      </td>
                      {visibleExtras.map((x) => (
                        <td key={x.id} className="px-1">
                          {cellInput(x.id, {
                            numeric: x.numeric,
                            placeholder:
                              x.id === "sellingPriceLkr"
                                ? (() => {
                                    const v = rowPrice(r, c.net);
                                    return v !== undefined ? lkr(v) : "—";
                                  })()
                                : x.id === "costLkr"
                                ? (() => {
                                    const v = pieceCost({ ...r, costLkr: "" }, c.net);
                                    return v !== undefined ? lkr(v) : "—";
                                  })()
                                : (common[x.placeholderFrom] as string | undefined)?.trim() || (x.numeric ? "—" : ""),
                          })}
                        </td>
                      ))}
                      <td className="g-metric px-1 text-right text-ink-3">
                        {show && Object.keys(c.errors).length ? (
                          <span className="text-[11px] font-medium text-rose-700">{Object.values(c.errors)[0]}</span>
                        ) : (
                          fmtG(c.net)
                        )}
                      </td>
                      <td className="g-metric px-1 text-right font-medium text-ink">
                        {(() => {
                          const p = rowPrice(r, c.net);
                          return p !== undefined ? lkr(p) : <span className="text-[11px] font-normal text-ink-5">live</span>;
                        })()}
                      </td>
                      <td className="rounded-r-lg px-1">
                        <span className="flex justify-end gap-0.5 opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => duplicateRow(r.key)}
                            aria-label={`Duplicate row ${i + 1}`}
                            title="Duplicate"
                            className="flex size-7 items-center justify-center rounded-md text-ink-4 hover:bg-bone hover:text-ink"
                          >
                            <CopyIcon size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeRow(r.key)}
                            aria-label={`Remove row ${i + 1}`}
                            title="Remove"
                            className="flex size-7 items-center justify-center rounded-md text-ink-4 hover:bg-rose-50 hover:text-rose-700"
                          >
                            <TrashIcon size={13} />
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {rowCategoryIds.map((id, k) => (
            <datalist key={id} id={`bk-subcats-${id}`}>
              {(rowSubcats[k]?.data?.rows ?? []).map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
          ))}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => addRows(1)} disabled={room <= 0} className="g-btn g-btn-secondary h-8 rounded-lg px-3 text-xs">
              <PlusIcon size={12} />
              Add row
            </button>
            <span className="flex items-center gap-1">
              <input
                value={addN}
                onChange={(e) => setAddN(e.target.value.replace(/\D/g, "").slice(0, 3))}
                inputMode="numeric"
                aria-label="Rows to add"
                className={cn(inputCls, "g-metric h-8 w-14 text-center")}
              />
              <button type="button" onClick={() => addRows(Number(addN) || 0)} disabled={room <= 0} className="g-btn h-8 rounded-lg px-3 text-xs text-ink-3 hover:bg-bone">
                Add rows
              </button>
            </span>
            <span className="ml-auto text-[11px] text-ink-5">
              {rows.length}/{BULK_PRODUCTS_MAX} rows · empty rows are skipped
            </span>
          </div>
        </FormSection>

        {/* Floating action bar */}
        <div className="sticky bottom-4 z-20 flex items-center justify-between gap-3 rounded-2xl bg-paper/90 px-3 py-2 shadow-[0_24px_48px_-20px_rgba(16,32,27,0.45),inset_0_0_0_1px_rgba(16,32,27,0.08)] backdrop-blur-xl sm:px-4">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded-lg bg-bone px-2.5 py-1 text-ink-4">
              <span className="g-metric font-medium text-ink">{filled.length}</span> pieces
            </span>
            <span className="hidden rounded-lg bg-bone px-2.5 py-1 text-ink-4 sm:inline">
              Net <span className="g-metric font-medium text-ink">{fmtG(totals.net || null)} g</span>
            </span>
            {invalidCount ? (
              <span className="rounded-lg bg-rose-50 px-2.5 py-1 font-medium text-rose-700">{invalidCount} to fix</span>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <Link href="/products" className="g-btn h-9 rounded-lg px-4 text-sm text-ink-3 hover:bg-bone hover:text-ink">
              Cancel
            </Link>
            <button type="submit" disabled={save.isPending || filled.length === 0} className="g-btn g-btn-primary h-9 rounded-lg px-5 text-sm">
              {save.isPending ? (
                <>
                  <span className="size-3.5 animate-spin rounded-full border-2 border-gold-light/30 border-t-gold-light" />
                  Saving…
                </>
              ) : (
                `Save ${filled.length || ""} product${filled.length === 1 ? "" : "s"}`
              )}
            </button>
          </div>
        </div>
      </form>
    </Page>
  );
}

/* ----------------------------------------------------------------- result */

function ResultView({ result, onAnother }: { result: BulkResult; onAnother: () => void }) {
  const ids = result.products.map((p) => p.id).join(",");
  const g = (mg: number) => (mg / 1000).toFixed(3);
  return (
    <Page className="space-y-4">
      <GoldHero
        icon={CheckCircleIcon}
        title={`${result.totals.count}`}
        accent={`product${result.totals.count === 1 ? "" : "s"} created`}
        badge={<HeroBadge tone="good">Saved together</HeroBadge>}
        sub="Every piece has its own barcode and is on the shelf · print the tags next"
        back={{ href: "/products", label: "Products" }}
        actions={
          <>
            <button type="button" onClick={onAnother} className={heroGhost}>
              <PlusIcon size={13} />
              Another tray
            </button>
            <Link href={`/products/labels?ids=${ids}&back=/products`} className={heroGold}>
              <PrinterIcon size={13} />
              Print {result.totals.count} labels
            </Link>
          </>
        }
        stats={[
          { label: "Pieces", value: result.totals.count, accent: true },
          { label: "Gross", value: result.totals.gross_mg / 1000, format: (n) => n.toFixed(3), unit: "g" },
          { label: "Net", value: result.totals.net_mg / 1000, format: (n) => n.toFixed(3), unit: "g" },
          { label: "Fine gold", value: result.totals.fine_gold_mg / 1000, format: (n) => n.toFixed(3), unit: "g" },
          { label: "Cost", value: result.totals.cost_cents / 100 || null, format: lkr, unit: "LKR" },
        ]}
      />
      <section className="overflow-hidden rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-[13px]">
            <thead className="bg-bone/60 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4">
              <tr>
                <th className="px-3 py-2 text-right">#</th>
                <th className="px-3 py-2">Barcode</th>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Gross g</th>
                <th className="px-3 py-2 text-right">Net g</th>
                <th className="px-3 py-2 text-right">Fine g</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/[0.05]">
              {result.products.map((p, i) => (
                <tr key={p.id} className="hover:bg-gold-pale/30">
                  <td className="g-metric px-3 py-2 text-right text-ink-5">{i + 1}</td>
                  <td className="px-3 py-2">
                    <Link href={`/products/${p.id}`} className="g-metric font-medium text-gold-deep hover:underline">
                      {p.barcode}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-ink">{p.name}</td>
                  <td className="g-metric px-3 py-2 text-right">{g(p.gross_mg)}</td>
                  <td className="g-metric px-3 py-2 text-right">{g(p.net_mg)}</td>
                  <td className="g-metric px-3 py-2 text-right text-gold-deep">{g(p.fine_gold_mg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Page>
  );
}
