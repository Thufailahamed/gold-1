"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "./icons";

export type SelectOption = { value: string; label: string; hint?: string };

/**
 * Themed replacement for the native <select>: paper trigger, gold focus ring,
 * floating listbox with a gold check on the chosen row. Keyboard friendly
 * (arrows, Enter/Space, Home/End, Escape, type-ahead on first letter).
 * Long lists (or `searchable`) get a filter box at the top of the panel.
 */
export function Select({
  value,
  onChange,
  onBlur,
  options,
  placeholder = "Select…",
  disabled,
  invalid,
  className,
  ariaLabel,
  capitalize,
  icon,
  searchable,
  loading,
  size = "md",
  hintInTrigger,
  buttonRef,
  id: idProp,
  portal,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  ariaLabel?: string;
  capitalize?: boolean;
  /** Leading glyph inside the trigger. */
  icon?: ReactNode;
  /** Force the filter box on/off; defaults to on for lists longer than 8. */
  searchable?: boolean;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
  /** Echo the chosen option's hint as a chip on the trigger (keep hints short). */
  hintInTrigger?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  id?: string;
  /** Draw the list on the page, for a select inside a table or panel that scrolls and would clip it. */
  portal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Where a portaled list sits: under the trigger, or above it when there is no room below.
  const [spot, setSpot] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const withSearch = searchable ?? options.length > 8;
  const selected = options.findIndex((o) => o.value === value);
  const current = selected >= 0 ? options[selected] : undefined;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !panel.current?.contains(t)) {
        setOpen(false);
        onBlur?.();
      }
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open, onBlur]);

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  useEffect(() => {
    if (open && withSearch) search.current?.focus();
  }, [open, withSearch]);

  useEffect(() => {
    if (!open || !portal) return;
    const place = () => {
      const r = root.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      const above = r.top;
      setSpot(
        below < 320 && above > below
          ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 8 }
          : { left: r.left, width: r.width, top: r.bottom + 8 }
      );
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, portal]);

  const show = () => {
    setQuery("");
    setActive(Math.max(selected, 0));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    root.current?.querySelector<HTMLButtonElement>("button[role=combobox]")?.focus();
  };
  const pick = (i: number) => {
    const o = shown[i];
    if (o) onChange(o.value);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    const typing = e.target === search.current;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Home" && !typing) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && !typing) {
      e.preventDefault();
      setActive(shown.length - 1);
    } else if (e.key === "Enter" || (e.key === " " && !typing)) {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Tab") {
      setOpen(false);
      onBlur?.();
    } else if (e.key.length === 1 && !typing) {
      const k = e.key.toLowerCase();
      const n = shown.findIndex((o, i) => i > active && o.label.toLowerCase().startsWith(k));
      const m = n >= 0 ? n : shown.findIndex((o) => o.label.toLowerCase().startsWith(k));
      if (m >= 0) setActive(m);
    }
  };

  // A portal draws the list on the page, out of any scrolling parent that would clip it.
  const wrap = (el: ReactNode) => {
    if (!portal) return el;
    if (!spot || typeof document === "undefined") return null;
    return createPortal(el, document.body);
  };

  return (
    <div ref={root} className={cn("relative", className)} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        id={idProp}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        className={cn(
          "group flex w-full items-center gap-2.5 rounded-xl bg-paper text-left text-sm text-ink",
          size === "lg" ? "h-12 px-4" : size === "sm" ? "h-9 px-2.5 text-[13px]" : "h-11 px-3.5",
          "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2),0_1px_2px_rgba(16,32,27,0.04)] transition-[box-shadow,background-color] duration-200",
          "hover:bg-gold-pale/40 hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.26),0_1px_2px_rgba(16,32,27,0.04)]",
          "focus:outline-none focus-visible:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)]",
          open && "bg-paper shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)] hover:bg-paper",
          invalid && "shadow-[inset_0_0_0_1px_#e11d48,0_0_0_4px_rgba(225,29,72,0.12)]",
          "disabled:cursor-not-allowed disabled:opacity-60"
        )}
      >
        {icon ? (
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
              current ? "bg-void text-gold-light" : "bg-bone text-ink-5 group-hover:text-gold-dark"
            )}
          >
            {icon}
          </span>
        ) : null}
        <span className={cn("min-w-0 flex-1 truncate", capitalize && "capitalize", !current && "text-ink-5")}>
          {loading && !current ? "Loading…" : current ? current.label : placeholder}
        </span>
        {hintInTrigger && current?.hint ? (
          <span className="g-metric hidden shrink-0 rounded-md bg-gold-pale px-1.5 py-0.5 text-[10px] text-gold-deep sm:inline">
            {current.hint}
          </span>
        ) : null}
        <ChevronDownIcon
          size={15}
          className={cn(
            "shrink-0 text-ink-5 transition-[transform,color] duration-200 group-hover:text-gold-dark",
            open && "rotate-180 text-gold-dark"
          )}
        />
      </button>
      {open ? wrap(
        <div
          ref={panel}
          style={portal && spot ? { position: "fixed", zIndex: 70, left: spot.left, width: spot.width, top: spot.top, bottom: spot.bottom } : undefined}
          className={cn("g-floating origin-top animate-pop-in overflow-hidden", !portal && "absolute left-0 right-0 top-[calc(100%+8px)] z-50")}
        >
          <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
          {withSearch ? (
            <div className="relative border-b border-ink/20 p-1.5">
              <SearchIcon size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-5" />
              <input
                ref={search}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder="Search…"
                aria-label="Filter options"
                aria-controls={listId}
                className="h-9 w-full rounded-lg bg-bone/70 pl-8 pr-3 text-sm text-ink placeholder:text-ink-5 focus:bg-bone focus:outline-none"
              />
            </div>
          ) : null}
          <ul ref={list} id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1.5 scrollbar-thin">
            {shown.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-ink-5">
                {loading ? "Loading…" : query ? `No match for “${query}”` : "Nothing to choose yet"}
              </li>
            ) : null}
            {shown.map((o, i) => {
              const isSel = o.value === value;
              return (
                <li
                  key={o.value || `__${i}`}
                  role="option"
                  aria-selected={isSel}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(i)}
                  className={cn(
                    "relative flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-140",
                    capitalize && "capitalize",
                    i === active ? "bg-gold-pale text-ink" : "text-ink-2",
                    isSel && "font-medium text-ink",
                    !o.value && "text-ink-4"
                  )}
                >
                  {i === active ? (
                    <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-gold" aria-hidden />
                  ) : null}
                  <span className="min-w-0">
                    <span className="block truncate">{o.label}</span>
                    {o.hint ? <span className="block truncate text-xs text-ink-4 normal-case">{o.hint}</span> : null}
                  </span>
                  {isSel ? (
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-void text-gold-light">
                      <CheckIcon size={11} />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
