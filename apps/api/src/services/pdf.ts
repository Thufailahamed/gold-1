/**
 * A small, dependency-free PDF writer for text reports: A4 pages, the two
 * standard Helvetica faces, rules, shaded bands and simple tables. Enough for
 * a printable record without pulling a layout engine into the Worker.
 *
 * Text is reduced to printable ASCII so every byte offset in the xref is the
 * string offset — the standard fonts cannot draw anything outside WinAnsi
 * anyway, and a report must never fail to render over a dash.
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;

export type Rgb = [number, number, number];
export type TextOpts = { size?: number; bold?: boolean; color?: Rgb; x?: number; align?: "left" | "right"; width?: number };
export type Column = { header: string; width: number; align?: "left" | "right" };

const ASCII_MAP: Record<string, string> = {
  "—": "-", "–": "-", "−": "-", "·": "|", "‘": "'", "’": "'",
  "“": '"', "”": '"', "…": "...", "×": "x", "≥": ">=", "≤": "<=", "→": "->",
};

export function pdfSafe(s: string): string {
  return s
    .replace(/[—–−·‘’“”…×≥≤→]/g, (ch) => ASCII_MAP[ch] ?? "?")
    .replace(/[^\x20-\x7e]/g, "?");
}

const esc = (s: string) => pdfSafe(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** Helvetica advance widths (per 1000 em), close enough to align and clip. */
function charWidth(ch: string, bold: boolean): number {
  if (/[0-9]/.test(ch)) return 556;
  if (ch === " " || ch === "." || ch === "," || ch === ":" || ch === ";" || ch === "!" || ch === "|") return 278;
  if (ch === "-" || ch === "(" || ch === ")") return 333;
  if (/[iljtf]/.test(ch)) return bold ? 333 : 278;
  if (/[mw]/.test(ch)) return 833;
  if (/[MW]/.test(ch)) return 889;
  if (/[A-Z]/.test(ch)) return 680;
  return bold ? 590 : 540;
}

export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of pdfSafe(s)) w += charWidth(ch, bold);
  return (w * size) / 1000;
}

function clip(s: string, width: number, size: number, bold: boolean): string {
  const safe = pdfSafe(s);
  if (textWidth(safe, size, bold) <= width) return safe;
  let out = safe;
  while (out.length > 1 && textWidth(`${out}...`, size, bold) > width) out = out.slice(0, -1);
  return `${out}...`;
}

/** Breaks a string into lines that fit the width, on spaces where possible. */
export function wrap(s: string, width: number, size: number, bold = false): string[] {
  const words = pdfSafe(s).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (textWidth(next, size, bold) <= width || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines.map((l) => clip(l, width, size, bold)) : [""];
}

const rgb = (c: Rgb) => c.map((v) => v.toFixed(3)).join(" ");

export class PdfDoc {
  private pages: string[][] = [];
  private ops: string[] = [];
  y = 0;
  readonly left = MARGIN;
  readonly right = PAGE_W - MARGIN;
  readonly contentWidth = PAGE_W - MARGIN * 2;

  constructor(private footer: string) {
    this.addPage();
  }

  addPage(): void {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = PAGE_H - MARGIN;
  }

  /** Starts a new page when fewer than h points remain above the footer. */
  ensure(h: number): void {
    if (this.y - h < MARGIN + 24) this.addPage();
  }

  text(s: string, o: TextOpts = {}): void {
    const size = o.size ?? 10;
    const bold = !!o.bold;
    const width = o.width ?? this.contentWidth;
    const str = clip(s, width, size, bold);
    const x0 = o.x ?? this.left;
    const x = o.align === "right" ? x0 + width - textWidth(str, size, bold) : x0;
    this.ops.push(`BT ${rgb(o.color ?? [0.1, 0.12, 0.11])} rg /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${(this.y - size).toFixed(2)} Td (${esc(str)}) Tj ET`);
  }

  /** Writes a line of text and moves down. */
  line(s: string, o: TextOpts = {}, gap = 3): void {
    const size = o.size ?? 10;
    this.ensure(size + gap);
    this.text(s, o);
    this.y -= size + gap;
  }

  /** Writes wrapped text and moves down. */
  paragraph(s: string, o: TextOpts = {}, gap = 2): void {
    const size = o.size ?? 10;
    for (const l of wrap(s, o.width ?? this.contentWidth, size, o.bold)) this.line(l, o, gap);
  }

  rule(color: Rgb = [0.8, 0.8, 0.78], weight = 0.6): void {
    this.ops.push(`${rgb(color)} RG ${weight} w ${this.left} ${this.y.toFixed(2)} m ${this.right} ${this.y.toFixed(2)} l S`);
  }

  rect(x: number, y: number, w: number, h: number, fill: Rgb): void {
    this.ops.push(`${rgb(fill)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }

  heading(s: string): void {
    this.ensure(40);
    this.y -= 10;
    this.line(s.toUpperCase(), { size: 9, bold: true, color: [0.45, 0.38, 0.2] }, 4);
    this.rule([0.66, 0.54, 0.24], 0.8);
    this.y -= 6;
  }

  /** Two columns: a label and a right-aligned value. */
  pair(label: string, value: string, o: { bold?: boolean; color?: Rgb } = {}): void {
    this.ensure(14);
    this.text(label, { bold: o.bold, width: this.contentWidth * 0.68 });
    this.text(value, { align: "right", bold: o.bold, color: o.color });
    this.y -= 14;
  }

  table(cols: Column[], rows: string[][], o: { size?: number } = {}): void {
    const size = o.size ?? 8.5;
    const rowH = size + 6;
    const total = cols.reduce((s, c) => s + c.width, 0);
    const scale = this.contentWidth / total;
    const xs: number[] = [];
    let acc = this.left;
    for (const c of cols) {
      xs.push(acc);
      acc += c.width * scale;
    }
    const header = () => {
      this.ensure(rowH * 2);
      this.rect(this.left, this.y - rowH + 1, this.contentWidth, rowH, [0.95, 0.93, 0.87]);
      cols.forEach((c, i) =>
        this.text(c.header, { x: xs[i]! + 3, width: c.width * scale - 6, size, bold: true, align: c.align, color: [0.3, 0.3, 0.28] })
      );
      this.y -= rowH;
    };
    header();
    rows.forEach((r, ri) => {
      if (this.y - rowH < MARGIN + 24) {
        this.addPage();
        header();
      }
      if (ri % 2 === 1) this.rect(this.left, this.y - rowH + 1, this.contentWidth, rowH, [0.98, 0.975, 0.96]);
      cols.forEach((c, i) => this.text(r[i] ?? "", { x: xs[i]! + 3, width: c.width * scale - 6, size, align: c.align }));
      this.y -= rowH;
    });
    this.y -= 4;
  }

  /** Serialises the document; page footers are stamped here, once the count is known. */
  toBytes(): ArrayBuffer {
    const n = this.pages.length;
    this.pages.forEach((ops, i) => {
      const label = `Page ${i + 1} of ${n}`;
      ops.push(`${rgb([0.85, 0.85, 0.83])} RG 0.5 w ${MARGIN} ${MARGIN + 14} m ${PAGE_W - MARGIN} ${MARGIN + 14} l S`);
      ops.push(`BT ${rgb([0.5, 0.5, 0.48])} rg /F1 7.5 Tf ${MARGIN} ${MARGIN} Td (${esc(this.footer)}) Tj ET`);
      ops.push(`BT ${rgb([0.5, 0.5, 0.48])} rg /F1 7.5 Tf ${(PAGE_W - MARGIN - textWidth(label, 7.5)).toFixed(2)} ${MARGIN} Td (${esc(label)}) Tj ET`);
    });

    const objects: string[] = [];
    objects.push("<< /Type /Catalog /Pages 2 0 R >>");
    const kids = this.pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ");
    objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    this.pages.forEach((ops, i) => {
      const stream = ops.join("\n");
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`
      );
      objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    });

    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new TextEncoder().encode(out);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
}
