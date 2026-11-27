import { describe, expect, it } from "vite-plus/test";
import { TimeAxis } from "../../lib/ustx/time-axis";
import { clampPointTime, pointTime } from "./manual-pitch";

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
});
