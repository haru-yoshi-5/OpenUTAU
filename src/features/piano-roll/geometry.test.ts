import { describe, expect, it } from "vite-plus/test";
import { computeBars } from "../../lib/ustx/bars";
import type { Note } from "../../lib/ustx/load";
import type { PitchCurve } from "../../lib/ustx/pitch";
import { vibratoSchema } from "../../lib/ustx/types";
import {
  type Camera,
  centsToY,
  gridLines,
  pitchPolylines,
  ROW_HEIGHT,
  TONE_MAX,
  tickToX,
  toneToY,
  visibleNotes,
  visibleToneRange,
} from "./geometry";

const note = (position: number, duration: number, index = 0): Note => ({
  position,
  duration,
  tone: 60,
  lyric: "a",
  tuning: 0,
  pitch: { data: [], snap_first: true },
  vibrato: vibratoSchema.parse({}),
  index,
});

const cam: Camera = { pxPerTick: 0.1, scrollTick: 480, scrollY: 100 };

describe("座標変換", () => {
  it("tick と音高を描画領域の座標に変換する", () => {
    expect(tickToX(480, cam)).toBe(0);
    expect(tickToX(1480, cam)).toBe(100);
    expect(toneToY(TONE_MAX, cam)).toBe(-100);
    expect(toneToY(TONE_MAX - 10, cam)).toBe(10 * ROW_HEIGHT - 100);
  });

  it("cent は行の中央に対応する", () => {
    expect(centsToY(6000, cam)).toBe(toneToY(60, cam) + ROW_HEIGHT / 2);
    // 半音上は 1 行ぶん上
    expect(centsToY(6100, cam)).toBe(centsToY(6000, cam) - ROW_HEIGHT);
  });

  it("描画領域に入る音高の範囲を返す", () => {
    const range = visibleToneRange({ ...cam, scrollY: ROW_HEIGHT * 10 }, ROW_HEIGHT * 5);
    expect(range).toEqual({ high: TONE_MAX - 10, low: TONE_MAX - 15 });
    expect(visibleToneRange({ ...cam, scrollY: 0 }, 1e6).low).toBe(0);
  });
});

describe("visibleNotes", () => {
  const notes = [note(0, 2000, 0), note(480, 240, 1), note(960, 240, 2), note(1920, 480, 3)];

  it("範囲と重なるノートだけを返す", () => {
    expect(visibleNotes(notes, 2000, 900, 1300).map((n) => n.index)).toEqual([0, 2]);
  });

  it("前から食い込む長いノートも含める", () => {
    expect(visibleNotes(notes, 2000, 1950, 1960).map((n) => n.index)).toEqual([0, 3]);
  });

  it("範囲の終端ちょうどで始まるノートは含めない", () => {
    expect(visibleNotes(notes, 2000, 2400, 3000)).toEqual([]);
    expect(visibleNotes(notes, 2000, 700, 960).map((n) => n.index)).toEqual([0, 1]);
  });
});

describe("gridLines", () => {
  const bars = computeBars([{ bar_position: 0, beat_per_bar: 4, beat_unit: 4 }], 1920 * 4);

  it("パート位置を引いた相対 tick で、小節線と拍線を返す", () => {
    const lines = gridLines(bars, 1920, 0, 1920);
    expect(lines.map((l) => [l.tick, l.kind, l.barNumber])).toEqual([
      [0, "bar", 2],
      [480, "beat", undefined],
      [960, "beat", undefined],
      [1440, "beat", undefined],
      [1920, "bar", 3],
    ]);
  });
});

describe("pitchPolylines", () => {
  const pitch: PitchCurve = {
    startTick: 0,
    interval: 5,
    cents: Float64Array.from([6000, 6000, Number.NaN, 6100, 6100, 6100, Number.NaN, 6200]),
  };
  const flat: Camera = { pxPerTick: 1, scrollTick: 0, scrollY: 0 };

  it("休符で線を区切り、1 点だけの区間は捨てる", () => {
    const lines = pitchPolylines(pitch, flat, 0, 100);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual([0, centsToY(6000, flat), 5, centsToY(6000, flat)]);
    expect(lines[1].filter((_, i) => i % 2 === 0)).toEqual([15, 20, 25]);
  });

  it("縮小表示では 1px 未満の間隔のサンプルを間引く", () => {
    const long: PitchCurve = {
      startTick: 0,
      interval: 5,
      cents: new Float64Array(1000).fill(6000),
    };
    const zoomedOut = pitchPolylines(long, { ...flat, pxPerTick: 0.05 }, 0, 5000);
    // 5 tick × 0.05 = 0.25px 間隔なので、4 サンプルに 1 つ
    expect(zoomedOut[0].length / 2).toBeLessThanOrEqual(1000 / 4 + 2);
  });
});
