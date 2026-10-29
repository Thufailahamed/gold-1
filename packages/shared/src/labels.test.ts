import { describe, expect, it } from "vitest";
import {
  LABEL_BATCH_MAX,
  LABEL_COPIES_MAX,
  LABELS_PER_ROW_DEFAULT,
  LABELS_PER_ROW_MAX,
  LABELS_PER_ROW_MIN,
  addLabelIds,
  chunkIds,
  clampCopies,
  clampLabelsPerRow,
  labelSlots,
  parseLabelIds,
  removeLabelIds,
  toggleLabelId,
} from "./labels";

describe("label batch ids", () => {
  it("parses a comma list, trimming blanks and duplicate ids", () => {
    expect(parseLabelIds(" a, b ,,a, c ")).toEqual(["a", "b", "c"]);
  });

  it("returns an empty batch for a missing or blank query", () => {
    expect(parseLabelIds(undefined)).toEqual([]);
    expect(parseLabelIds(" , ,, ")).toEqual([]);
  });

  it("caps the batch at the label limit", () => {
    const raw = Array.from({ length: LABEL_BATCH_MAX + 5 }, (_, i) => `p${i}`).join(",");
    expect(parseLabelIds(raw)).toHaveLength(LABEL_BATCH_MAX);
  });

  it("adds ids without duplicates up to the cap", () => {
    expect(addLabelIds(["a"], ["a", "b", "b"], 3)).toEqual(["a", "b"]);
    expect(addLabelIds(["a", "b"], ["c", "d"], 3)).toEqual(["a", "b", "c"]);
  });

  it("removes several ids at once", () => {
    expect(removeLabelIds(["a", "b", "c"], ["b", "c"])).toEqual(["a"]);
  });

  it("toggles one piece on and off", () => {
    expect(toggleLabelId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleLabelId(["a", "b"], "b")).toEqual(["a"]);
  });

  it("will not grow a full batch when toggling a new piece on", () => {
    expect(toggleLabelId(["a", "b"], "c", 2)).toEqual(["a", "b"]);
  });
});

describe("label copies", () => {
  it("clamps copies to the printable range", () => {
    expect(clampCopies(0)).toBe(1);
    expect(clampCopies(4)).toBe(4);
    expect(clampCopies(99)).toBe(LABEL_COPIES_MAX);
    expect(clampCopies(Number.NaN)).toBe(1);
  });

  it("keys every copy of every piece for load tracking", () => {
    expect(labelSlots(["a", "b"], 2)).toEqual([
      { key: "a#1", pieceId: "a", copy: 1 },
      { key: "a#2", pieceId: "a", copy: 2 },
      { key: "b#1", pieceId: "b", copy: 1 },
      { key: "b#2", pieceId: "b", copy: 2 },
    ]);
    expect(labelSlots([], 5)).toEqual([]);
    expect(labelSlots(["a"], 0)).toHaveLength(1);
  });
});

describe("labels per row", () => {
  it("clamps the row count to the printable range", () => {
    expect(clampLabelsPerRow(0)).toBe(LABELS_PER_ROW_MIN);
    expect(clampLabelsPerRow(4)).toBe(4);
    expect(clampLabelsPerRow(9)).toBe(LABELS_PER_ROW_MAX);
    expect(clampLabelsPerRow(Number.NaN)).toBe(LABELS_PER_ROW_DEFAULT);
  });
});

describe("label api chunks", () => {
  it("splits ids into requests no larger than the chunk size", () => {
    expect(chunkIds(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("keeps a non-positive chunk size safe", () => {
    expect(chunkIds(["a", "b"], 0)).toEqual([["a"], ["b"]]);
  });
});
