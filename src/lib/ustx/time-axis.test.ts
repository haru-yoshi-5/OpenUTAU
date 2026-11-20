import { describe, expect, it } from "vite-plus/test";
import { RESOLUTION, TimeAxis } from "./time-axis";

/** 1 拍（RESOLUTION tick）の長さ（ms） */
const beatMs = (bpm: number) => 60000 / bpm;

describe("TimeAxis", () => {
  it("テンポが 1 つなら一定の速さで変換する", () => {
    const axis = new TimeAxis([{ position: 0, bpm: 120 }]);
    expect(axis.tickToMs(RESOLUTION)).toBeCloseTo(500);
    expect(axis.msToTick(500)).toBeCloseTo(RESOLUTION);
  });

  it("テンポ変更の前後で速さを切り替える", () => {
    const axis = new TimeAxis([
      { position: 0, bpm: 120 },
      { position: RESOLUTION * 4, bpm: 60 },
    ]);
    const changeMs = beatMs(120) * 4;
    expect(axis.tickToMs(RESOLUTION * 4)).toBeCloseTo(changeMs);
    expect(axis.tickToMs(RESOLUTION * 5)).toBeCloseTo(changeMs + beatMs(60));
    expect(axis.msToTick(changeMs + beatMs(60))).toBeCloseTo(RESOLUTION * 5);
  });

  it("先頭より前・最初のテンポより前は、最初の区間の速さで外挿する", () => {
    const axis = new TimeAxis([{ position: RESOLUTION, bpm: 120 }]);
    expect(axis.tickToMs(-RESOLUTION)).toBeCloseTo(-500);
    expect(axis.msToTick(-500)).toBeCloseTo(-RESOLUTION);
  });

  it("同じ位置にテンポが複数あるときは、後のものを使う", () => {
    const axis = new TimeAxis([
      { position: 0, bpm: 120 },
      { position: 0, bpm: 60 },
    ]);
    expect(axis.tickToMs(RESOLUTION)).toBeCloseTo(beatMs(60));
  });

  it("テンポ変更が多くても、各区間の境界で往復変換が一致する", () => {
    const tempos = Array.from({ length: 5000 }, (_, i) => ({
      position: i * RESOLUTION,
      bpm: 60 + (i % 7) * 20,
    }));
    const axis = new TimeAxis(tempos);
    let ms = 0;
    for (let i = 0; i < tempos.length; i += 499) {
      // 区間 i の開始位置の ms を、前の区間の長さを積み上げて求める
      ms = tempos.slice(0, i).reduce((sum, t) => sum + beatMs(t.bpm), 0);
      expect(axis.tickToMs(i * RESOLUTION)).toBeCloseTo(ms, 6);
      expect(axis.msToTick(ms)).toBeCloseTo(i * RESOLUTION, 6);
      // 区間の途中（半拍後）
      const mid = ms + beatMs(tempos[i].bpm) / 2;
      expect(axis.msToTick(mid)).toBeCloseTo(i * RESOLUTION + RESOLUTION / 2, 6);
    }
  });
});
