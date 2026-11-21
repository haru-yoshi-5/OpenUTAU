import { describe, expect, it } from "vite-plus/test";
import { vibratoSchema } from "../ustx/types";
import {
  attackPoints,
  composePitch,
  fallPoints,
  overshootSchema,
  scoopSchema,
  transitionSchema,
  vibratoFor,
  vibratoParamsSchema,
} from "./techniques";

const xy = (points: { x: number; y: number }[]) => points.map((p) => [p.x, p.y]);

describe("入りのテクニック", () => {
  it("なめらかな音程遷移：前の音から、長さの半分ずつかけて移る", () => {
    const points = attackPoints({ kind: "transition", params: { lengthMs: 120 } }, 500);
    expect(xy(points)).toEqual([
      [-60, 0],
      [60, 0],
    ]);
  });

  it("しゃくり：下がった所へ移ってから、目標の音高へ持ち上げる", () => {
    const points = attackPoints(
      { kind: "scoop", params: { transitionMs: 80, depth: 1, lengthMs: 120 } },
      500,
    );
    expect(xy(points)).toEqual([
      [-40, 0],
      [40, -10],
      [160, 0],
    ]);
    // 持ち上げる区間は後半ほどゆっくり（ease-out）
    expect(points[1].shape).toBe("o");
  });

  it("オーバーシュート：目標の音高を越えてから戻る", () => {
    const points = attackPoints(
      { kind: "overshoot", params: { transitionMs: 50, depth: 0.6, lengthMs: 90 } },
      500,
    );
    expect(xy(points)).toEqual([
      [-25, 0],
      [25, 6],
      [115, 0],
    ]);
  });

  it("短いノートでは、入りをノートの長さの 6 割までに縮める", () => {
    const points = attackPoints(
      { kind: "scoop", params: { transitionMs: 80, depth: 1, lengthMs: 120 } },
      100,
    );
    expect(points[points.length - 1].x).toBeLessThanOrEqual(60);
    const xs = points.map((p) => p.x);
    expect(xs).toEqual(xs.toSorted((a, b) => a - b));
  });
});

describe("フォール", () => {
  it("ノートの終わりに向けて下げる（最初はゆっくり）", () => {
    const points = fallPoints({ depth: 1.5, lengthMs: 180 }, 600, 160);
    expect(xy(points)).toEqual([
      [420, 0],
      [600, -15],
    ]);
    expect(points[0].shape).toBe("i");
  });

  it("入りと重なる分は短くし、入らなければ付けない", () => {
    expect(fallPoints({ depth: 1, lengthMs: 300 }, 400, 200)[0].x).toBe(200);
    expect(fallPoints({ depth: 1, lengthMs: 300 }, 210, 200)).toEqual([]);
    expect(fallPoints({ depth: 0, lengthMs: 100 }, 600, 100)).toEqual([]);
  });
});

describe("composePitch", () => {
  it("入りとフォールをつなぎ、OpenUtau の制約（x の昇順、snap_first で 2 点以上）を満たす", () => {
    const pitch = composePitch(
      { kind: "scoop", params: { transitionMs: 80, depth: 1, lengthMs: 120 } },
      600,
      { depth: 1.5, lengthMs: 180 },
    );
    expect(pitch.snap_first).toBe(true);
    expect(xy(pitch.data)).toEqual([
      [-40, 0],
      [40, -10],
      [160, 0],
      [420, 0],
      [600, -15],
    ]);
  });

  it("同じ入力からは同じ出力になる", () => {
    const attack = {
      kind: "overshoot",
      params: { transitionMs: 50, depth: 0.6, lengthMs: 90 },
    } as const;
    expect(composePitch(attack, 480)).toEqual(composePitch(attack, 480));
  });
});

describe("vibratoFor", () => {
  const current = { ...vibratoSchema.parse({}), shift: 20, drift: 5 };

  it("パラメータの値を設定し、shift・drift などは今の値を引き継ぐ", () => {
    expect(
      vibratoFor(
        { lengthPct: 60, periodMs: 210, depthCents: 25, fadeInPct: 45, fadeOutPct: 15 },
        current,
      ),
    ).toEqual({ ...current, length: 60, period: 210, depth: 25, in: 45, out: 15 });
  });
});

describe("パラメータの範囲", () => {
  it("範囲外の値は受け付けない", () => {
    expect(transitionSchema.safeParse({ lengthMs: 0 }).success).toBe(false);
    expect(scoopSchema.safeParse({ transitionMs: 80, depth: 4, lengthMs: 120 }).success).toBe(
      false,
    );
    expect(overshootSchema.safeParse({ transitionMs: 80, depth: -1, lengthMs: 120 }).success).toBe(
      false,
    );
    expect(
      vibratoParamsSchema.safeParse({
        lengthPct: 50,
        periodMs: 1000,
        depthCents: 20,
        fadeInPct: 10,
        fadeOutPct: 10,
      }).success,
    ).toBe(false);
  });

  it("範囲外のパラメータで呼ぶと例外にする", () => {
    expect(() => attackPoints({ kind: "transition", params: { lengthMs: 9999 } }, 500)).toThrow(
      /too_big|Too big|<=/,
    );
  });
});
