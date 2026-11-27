import { describe, expect, it } from "vite-plus/test";
import { normalizePitch, sortPitchPoints, sortPoints } from "./normalize";

describe("ピッチ点の並べ替え", () => {
  const pitch = {
    snap_first: true,
    data: [
      { x: 50, y: 1, shape: "io" as const },
      { x: -20, y: 2, shape: "l" as const },
      { x: 50, y: 3, shape: "i" as const },
    ],
  };

  it("x の昇順に並べ、同じ x の点は元の順序を保つ", () => {
    expect(sortPitchPoints(pitch).data.map((p) => p.y)).toEqual([2, 1, 3]);
    expect(sortPitchPoints(pitch).snap_first).toBe(true);
    expect(pitch.data.map((p) => p.y)).toEqual([1, 2, 3]);
  });

  it("並んでいれば同じオブジェクトを返す", () => {
    const sorted = sortPitchPoints(pitch);
    expect(sortPitchPoints(sorted)).toBe(sorted);
    expect(sortPoints(sorted.data)).toBe(sorted.data);
  });
});

describe("ピッチ点の正規化", () => {
  it("丸めで生じた -0 は 0 にそろえる（元の 0 と同じ値とみなすため）", () => {
    const { data } = normalizePitch({ data: [{ x: -0, y: -0, shape: "io" }], snap_first: false });
    expect(Object.is(data[0].x, 0)).toBe(true);
    expect(Object.is(data[0].y, 0)).toBe(true);
  });
});
