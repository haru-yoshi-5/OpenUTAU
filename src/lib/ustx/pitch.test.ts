import { describe, expect, it } from "vitest";
import type { Note, VoicePart } from "./load";
import {
  effectivePitchPoints,
  evaluateVibrato,
  interpolateShape,
  PITCH_INTERVAL,
  renderPartPitch,
  sampleCurve,
} from "./pitch";
import { TimeAxis } from "./time-axis";
import { vibratoSchema } from "./types";

/** ノートがある前提でピッチを計算する（null なら失敗させる） */
function render(p: VoicePart, axis: TimeAxis) {
  const curve = renderPartPitch(p, axis);
  if (!curve) throw new Error("ピッチカーブが生成されませんでした");
  return curve;
}

const noVibrato = vibratoSchema.parse({});

function note(
  position: number,
  duration: number,
  tone: number,
  extra: Partial<Note> = {},
): Note {
  return {
    index: 0,
    position,
    duration,
    tone,
    lyric: "a",
    tuning: 0,
    pitch: { data: [], snap_first: true },
    vibrato: noVibrato,
    ...extra,
  };
}

function part(notes: Note[], extra: Partial<VoicePart> = {}): VoicePart {
  return {
    index: 0,
    name: "p",
    trackNo: 0,
    position: 0,
    duration: 1920,
    notes,
    curves: [],
    ...extra,
  };
}

const sampleAt = (
  curve: NonNullable<ReturnType<typeof renderPartPitch>>,
  tick: number,
) => curve.cents[(tick - curve.startTick) / PITCH_INTERVAL];

describe("TimeAxis", () => {
  it("120BPM では 1 tick = 60000/(120*480) ms", () => {
    const axis = new TimeAxis([{ position: 0, bpm: 120 }]);
    expect(axis.tickToMs(480)).toBeCloseTo(500);
    expect(axis.msToTick(500)).toBeCloseTo(480);
  });

  it("テンポ変更をまたいで変換できる", () => {
    const axis = new TimeAxis([
      { position: 0, bpm: 120 },
      { position: 1920, bpm: 60 },
    ]);
    expect(axis.tickToMs(1920)).toBeCloseTo(2000);
    expect(axis.tickToMs(2400)).toBeCloseTo(3000);
    expect(axis.msToTick(3000)).toBeCloseTo(2400);
  });
});

describe("補間・ビブラート・カーブ", () => {
  it("各形状の中点", () => {
    expect(interpolateShape(0, 10, 0, 100, 5, "io")).toBeCloseTo(50);
    expect(interpolateShape(0, 10, 0, 100, 5, "l")).toBeCloseTo(50);
    expect(interpolateShape(0, 10, 0, 100, 5, "i")).toBeCloseTo(
      100 * (1 - Math.cos(Math.PI / 4)),
    );
    expect(interpolateShape(0, 10, 0, 100, 5, "o")).toBeCloseTo(
      100 * Math.sin(Math.PI / 4),
    );
    expect(interpolateShape(3, 3, 0, 100, 3, "io")).toBe(100);
  });

  it("ビブラートは開始前 0、フェードイン後は深さどおりに振れる", () => {
    const v = {
      ...noVibrato,
      length: 50,
      depth: 40,
      in: 0,
      out: 0,
      period: 100,
    };
    expect(evaluateVibrato(v, 0.25, 0.1)).toBe(0);
    expect(evaluateVibrato(v, 0.525, 0.1)).toBeCloseTo(40);
  });

  it("カーブは線形補間し、範囲外は 0", () => {
    const c = { abbr: "pitd", xs: [0, 10], ys: [0, 100] };
    expect(sampleCurve(c, 5)).toBe(50);
    expect(sampleCurve(c, 10)).toBe(100);
    expect(sampleCurve(c, 20)).toBe(0);
  });

  it("snap_first は隣接する直前ノートとの音高差に置き換わる", () => {
    const prev = note(0, 480, 60);
    const cur = note(480, 480, 62, {
      pitch: { data: [{ x: -25, y: 5, shape: "io" }], snap_first: true },
    });
    expect(effectivePitchPoints(cur, prev)[0].y).toBe(-20);
    const apart = note(600, 480, 62, cur);
    expect(effectivePitchPoints({ ...apart, position: 600 }, prev)[0].y).toBe(
      0,
    );
  });
});

describe("renderPartPitch", () => {
  const axis = new TimeAxis([{ position: 0, bpm: 120 }]);

  it("ピッチ点の無いノートは音高そのまま", () => {
    const c = render(part([note(0, 480, 60)]), axis);
    expect(sampleAt(c, 240)).toBe(6000);
  });

  it("隣接ノート間をピッチ点で滑らかに遷移する", () => {
    const pts = {
      data: [
        { x: -25, y: 0, shape: "io" as const },
        { x: 25, y: 0, shape: "io" as const },
      ],
      snap_first: true,
    };
    const c = render(
      part([
        note(0, 480, 60, { pitch: pts }),
        note(480, 480, 62, { pitch: pts }),
      ]),
      axis,
    );
    // 境界（25ms = 24tick 手前〜後）の中央で中間の音高になる
    expect(sampleAt(c, 480)).toBeCloseTo(6100, 0);
    expect(sampleAt(c, 400)).toBe(6000);
    expect(sampleAt(c, 600)).toBe(6200);
  });

  it("休符区間は NaN（表示しない）", () => {
    const c = render(part([note(0, 240, 60), note(960, 240, 64)]), axis);
    expect(Number.isNaN(sampleAt(c, 600))).toBe(true);
    expect(sampleAt(c, 1000)).toBe(6400);
  });

  it("PITD を加算する", () => {
    const c = render(
      part([note(0, 480, 60)], {
        curves: [{ abbr: "pitd", xs: [0, 480], ys: [50, 50] }],
      }),
      axis,
    );
    expect(sampleAt(c, 240)).toBe(6050);
  });

  it("ビブラートを反映する", () => {
    const v = {
      ...noVibrato,
      length: 100,
      depth: 50,
      in: 0,
      out: 0,
      period: 100,
    };
    const c = render(part([note(0, 960, 60, { vibrato: v })]), axis);
    const values = Array.from(c.cents).filter((x) => !Number.isNaN(x));
    expect(Math.max(...values)).toBeGreaterThan(6045);
    expect(Math.min(...values)).toBeLessThan(5955);
  });

  it("ノートが無ければ null", () => {
    expect(renderPartPitch(part([]), axis)).toBeNull();
  });
});
