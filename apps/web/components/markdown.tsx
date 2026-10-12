import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The small slice of Markdown the assistant writes: paragraphs, bold,
 * italics, inline code, bullet and numbered lists, simple headings and pipe
 * tables. Rendered as React elements, never as HTML, so nothing in a model
 * reply (or in a memo it quotes) can inject markup into the page.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const k = `${key}-${i}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
      return (
        <strong key={k} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return (
        <code key={k} className="rounded bg-mist/70 px-1 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={k}>{part.slice(1, -1)}</em>;
    return <Fragment key={k}>{part}</Fragment>;
  });
}

const NUMERIC = /^[\s(−-]*(LKR|Rs\.?)?\s*[-−]?[\d,]+(\.\d+)?\s*(%|g)?\)?\s*$/i;

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "h"; text: string }
  | { kind: "table"; rows: string[] };

function blocks(src: string): Block[] {
  const out: Block[] = [];
  for (const line of src.replace(/\r\n/g, "\n").split("\n")) {
    const t = line.trim();
    const last = out[out.length - 1];
    if (!t) {
      out.push({ kind: "p", lines: [] });
      continue;
    }
    if (t.startsWith("|")) {
      if (last?.kind === "table") last.rows.push(t);
      else out.push({ kind: "table", rows: [t] });
      continue;
    }
    const ul = /^[-*•]\s+(.*)$/.exec(t);
    if (ul) {
      if (last?.kind === "ul") last.items.push(ul[1] ?? "");
      else out.push({ kind: "ul", items: [ul[1] ?? ""] });
      continue;
    }
    const ol = /^\d+[.)]\s+(.*)$/.exec(t);
    if (ol) {
      if (last?.kind === "ol") last.items.push(ol[1] ?? "");
      else out.push({ kind: "ol", items: [ol[1] ?? ""] });
      continue;
    }
    const h = /^#{1,4}\s+(.*)$/.exec(t);
    if (h) {
      out.push({ kind: "h", text: h[1] ?? "" });
      continue;
    }
    if (last?.kind === "p") last.lines.push(t);
    else out.push({ kind: "p", lines: [t] });
  }
  return out.filter((b) => !(b.kind === "p" && b.lines.length === 0));
}

function Table({ rows, k }: { rows: string[]; k: string }) {
  const parsed = rows.map(cells);
  const hasHead = parsed.length > 1 && (parsed[1] ?? []).every((c) => /^:?-{2,}:?$/.test(c));
  const head = hasHead ? parsed[0] ?? [] : null;
  const body = hasHead ? parsed.slice(2) : parsed;
  // A column of figures is right-aligned, its heading included.
  const numericCol = (i: number) => body.length > 0 && body.filter((r) => NUMERIC.test(r[i] ?? "")).length >= Math.ceil(body.length / 2);
  return (
    <div className="my-3 overflow-x-auto rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(16,32,27,0.08),0_12px_28px_-20px_rgba(16,32,27,0.35)]">
      <table className="w-full text-sm">
        {head && (
          <thead className="bg-gradient-to-b from-gold-pale to-paper">
            <tr>
              {head.map((c, i) => (
                <th key={`${k}-h${i}`} className={cn("whitespace-nowrap border-b border-gold/25 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4", numericCol(i) ? "text-right" : "text-left")}>
                  {inline(c, `${k}-h${i}`)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((r, ri) => (
            <tr key={`${k}-r${ri}`} className="border-t border-ink/[0.05] transition-colors first:border-t-0 hover:bg-gold-pale/40">
              {r.map((c, ci) => (
                <td key={`${k}-r${ri}c${ci}`} className={cn("px-4 py-2 text-[13px] text-ink-2", NUMERIC.test(c) && "g-metric whitespace-nowrap text-right text-ink")}>
                  {inline(c, `${k}-r${ri}c${ci}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("space-y-2 text-sm leading-relaxed text-ink-2", className)}>
      {blocks(text).map((b, i) => {
        const k = `b${i}`;
        if (b.kind === "table") return <Table key={k} rows={b.rows} k={k} />;
        if (b.kind === "h")
          return (
            <p key={k} className="pt-1 font-semibold text-ink">
              {inline(b.text, k)}
            </p>
          );
        if (b.kind === "ul" || b.kind === "ol") {
          const List = b.kind;
          return (
            <List key={k} className={cn("space-y-1.5 pl-5 marker:text-gold-dark", b.kind === "ul" ? "list-disc" : "list-decimal")}>
              {b.items.map((it, j) => (
                <li key={`${k}-${j}`}>{inline(it, `${k}-${j}`)}</li>
              ))}
            </List>
          );
        }
        if (b.kind !== "p") return null;
        return (
          <p key={k}>
            {b.lines.map((l, j) => (
              <Fragment key={`${k}-${j}`}>
                {j > 0 && <br />}
                {inline(l, `${k}-${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
