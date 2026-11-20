import { describe, expect, it } from "vite-plus/test";
import { computeBars } from "../../lib/ustx/bars";
import type { Note } from "../../lib/ustx/load";
import { vibratoSchema } from "../../lib/ustx/types";
import { type Camera, ROW_HEIGHT, TONE_MAX } from "./geometry";
import {
  barIndexAt,
  barSpanTicks,
  noteAt,
  notesInRect,
  notesInTickRange,
  xToTick,
  yToTone,
} from "./hit-test";

const note = (index: number, position: number, duration: number, tone: number): Note => ({
  position,
  duration,
  tone,
  lyric: "a",
  tuning: 0,
  pitch: { data: [], snap_first: true },
  vibrato: vibratoSchema.parse({}),
  index,
});

// 1 tick = 0.1px、左端は 0 tick、上端は 音高 127 の行の上端
const cam: Camera = { pxPerTick: 0.1, scrollTick: 0, scrollY: 0 };
/** 音高 tone の行の中央の y 座標 */
const rowY = (tone: number) => (TONE_MAX - tone) * ROW_HEIGHT + ROW_HEIGHT / 2;

// position 昇順。0 と 1 は同じ音高で隣接、2 は 1 と重なる別の音高、3 は離れたところ
const notes = [
  note(0, 0, 480, 60),
  note(1, 480, 480, 60),
  note(2, 720, 480, 64),
  note(3, 3840, 480, 67),
];
const maxDuration = 480;

describe("座標の変換", () => {
  it("x から tick、y から音高の行を求める", () => {
    expect(xToTick(48, cam)).toBe(480);
    expect(xToTick(48, { ...cam, scrollTick: 960 })).toBe(1440);
    expect(yToTone(rowY(60), cam)).toBe(60);
    expect(yToTone(rowY(60) + ROW_HEIGHT / 2 - 0.1, cam)).toBe(60);
    expect(yToTone(rowY(60) + ROW_HEIGHT / 2 + 0.1, cam)).toBe(59);
  });
});

describe("noteAt", () => {
  it("位置と音高が一致するノートを返す", () => {
    expect(noteAt(notes, maxDuration, 10, rowY(60), cam)?.index).toBe(0);
    expect(noteAt(notes, maxDuration, 50, rowY(60), cam)?.index).toBe(1);
    expect(noteAt(notes, maxDuration, 80, rowY(64), cam)?.index).toBe(2);
  });

  it("ノートの無い場所・音高が違う場所では見つからない", () => {
    expect(noteAt(notes, maxDuration, 200, rowY(60), cam)).toBeUndefined();
    expect(noteAt(notes, maxDuration, 10, rowY(61), cam)).toBeUndefined();
  });

  it("ノートの終わり（次のノートの始まり）は次のノートとして扱う", () => {
    expect(noteAt(notes, maxDuration, 48, rowY(60), cam)?.index).toBe(1);
  });

  it("縮小して 2px より細くなったノートも、描画と同じ 2px 幅で選べる", () => {
    const tiny = [note(0, 0, 10, 60)];
    const far: Camera = { ...cam, pxPerTick: 0.02 };
    expect(noteAt(tiny, 10, 1.5, rowY(60), far)?.index).toBe(0);
  });
});

describe("notesInRect", () => {
  it("矩形に一部でも掛かるノートを、向きに関係なく返す", () => {
    // 50〜75px（500〜750 tick）、音高 60〜64 の範囲
    const rect = { x0: 75, y0: rowY(60), x1: 50, y1: rowY(64) };
    expect(notesInRect(notes, maxDuration, rect, cam).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("音高の範囲外のノートは含めない", () => {
    const rect = { x0: 0, y0: rowY(61), x1: 400, y1: rowY(63) };
    expect(notesInRect(notes, maxDuration, rect, cam)).toEqual([]);
  });
});

describe("小節単位の選択", () => {
  const bars = computeBars([{ bar_position: 0, beat_per_bar: 4, beat_unit: 4 }], 7680);

  it("tick を含む小節の添字を求める（パートの位置を考慮する）", () => {
    expect(barIndexAt(bars, 0, 0)).toBe(0);
    expect(barIndexAt(bars, 0, 1919)).toBe(0);
    expect(barIndexAt(bars, 0, 1920)).toBe(1);
    expect(barIndexAt(bars, 1920, 0)).toBe(1);
    expect(barIndexAt(bars, 0, -100)).toBe(0);
  });

  it("小節 a〜b の範囲を、順不同で両端を含めて返す", () => {
    expect(barSpanTicks(bars, 0, 2, 1)).toEqual({ fromTick: 1920, toTick: 5760 });
    expect(barSpanTicks(bars, 1920, 1, 1)).toEqual({ fromTick: 0, toTick: 1920 });
  });

  it("範囲に掛かるノートを返す", () => {
    expect(notesInTickRange(notes, maxDuration, 0, 1920)).toEqual([0, 1, 2]);
    expect(notesInTickRange(notes, maxDuration, 1920, 3840)).toEqual([]);
    expect(notesInTickRange(notes, maxDuration, 3840, 5760)).toEqual([3]);
  });
});
