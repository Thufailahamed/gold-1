/** The largest batch the label station will prepare in one run. */
export const LABEL_BATCH_MAX = 200;

/** Copies of each label the station offers. */
export const LABEL_COPIES_MAX = 10;

/** Tags per printed row the station offers. */
export const LABELS_PER_ROW_MIN = 1;
export const LABELS_PER_ROW_MAX = 6;
export const LABELS_PER_ROW_DEFAULT = 2;

/** Parse `?ids=a,b,c` into a clean, ordered batch. */
export function parseLabelIds(raw: string | undefined, max = LABEL_BATCH_MAX): string[] {
  return Array.from(new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean))).slice(0, max);
}

/** Add pieces to a batch, skipping duplicates and never passing the cap. */
export function addLabelIds(ids: string[], add: string[], max = LABEL_BATCH_MAX): string[] {
  const out = [...ids];
  for (const id of add) {
    if (out.length >= max) break;
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Remove pieces from a batch. */
export function removeLabelIds(ids: string[], remove: string[]): string[] {
  const gone = new Set(remove);
  return ids.filter((id) => !gone.has(id));
}

/** Tick or untick one piece; a full batch refuses a new piece. */
export function toggleLabelId(ids: string[], id: string, max = LABEL_BATCH_MAX): string[] {
  return ids.includes(id) ? removeLabelIds(ids, [id]) : addLabelIds(ids, [id], max);
}

/** Keep copies within the printable range. */
export function clampCopies(n: number): number {
  return Math.max(1, Math.min(LABEL_COPIES_MAX, Number.isFinite(n) ? Math.trunc(n) : 1));
}

/** Keep the tags-per-row choice within the printable range. */
export function clampLabelsPerRow(n: number): number {
  return Math.max(
    LABELS_PER_ROW_MIN,
    Math.min(
      LABELS_PER_ROW_MAX,
      Number.isFinite(n) ? Math.trunc(n) : LABELS_PER_ROW_DEFAULT
    )
  );
}

/** A printable tag slot: one copy of one piece, with a stable load-state key. */
export type LabelSlot = { key: string; pieceId: string; copy: number };

/** Every tag slot in the run, in print order. */
export function labelSlots(pieceIds: string[], copies: number): LabelSlot[] {
  const n = clampCopies(copies);
  return pieceIds.flatMap((pieceId) =>
    Array.from({ length: n }, (_, i) => ({
      key: `${pieceId}#${i + 1}`,
      pieceId,
      copy: i + 1,
    }))
  );
}

/** Split a batch into bounded requests (e.g. D1 bind limits). */
export function chunkIds(ids: string[], size = 50): string[][] {
  const width = Math.max(1, Math.trunc(size));
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += width) out.push(ids.slice(i, i + width));
  return out;
}
