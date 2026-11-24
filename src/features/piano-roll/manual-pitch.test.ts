import { describe, expect, it } from "vite-plus/test";
import { TimeAxis } from "../../lib/ustx/time-axis";
import { clampPointTime, pointTime, sortedPitch } from "./manual-pitch";

describe("手動ピッチ点の座標", () => {
  const axis = new TimeAxis([
    { position: 0, bpm: 120 },
    { position: 480, bpm: 60 },
  ]);
  it("負の位置とテンポ変更をまたぐ位置をノート先頭からのミリ秒に変換する", () => {
    expect(pointTime(axis, 0, 480, 240)).toBe(-250);
    expect(pointTime(axis, 0, 240, 720)).toBe(750);
    expect(pointTime(axis, 240, 0, 480)).toBe(750);
  });
  it("前後の点を追い越さず、端の点は外側へ移動できる", () => {
    const points = [-50, 0, 100].map((x) => ({ x, y: 0, shape: "io" as const }));
    expect(clampPointTime(points, 1, -100)).toBe(-50);
    expect(clampPointTime(points, 1, 200)).toBe(100);
    expect(clampPointTime(points, 0, -200)).toBe(-200);
  });
  it("時間順でない点を昇順に並べ、同じ位置の点は元の順序を保つ", () => {
    const pitch = {
      snap_first: true,
      data: [
        { x: 50, y: 1, shape: "io" as const },
        { x: -20, y: 2, shape: "l" as const },
        { x: 50, y: 3, shape: "i" as const },
      ],
    };
    expect(sortedPitch(pitch).data.map((p) => p.y)).toEqual([2, 1, 3]);
    expect(sortedPitch(pitch).snap_first).toBe(true);
    const sorted = sortedPitch(pitch);
    expect(sortedPitch(sorted)).toBe(sorted);
  });
});
