import { z } from "zod";
import { normalizePitch, normalizeVibrato } from "../ustx/normalize";
import type { PitchPoint, RawNote, Vibrato } from "../ustx/types";

/*
 * 調声のテクニックを、ピッチ点・ビブラートの数値として生成する純粋関数。UI には依存しない。
 *
 * 単位は OpenUtau のピッチ点に合わせる。
 * - x：ノート先頭からの相対位置（ミリ秒）
 * - y：ノートの音高からの相対値（0.1 半音。パラメータは半音で受け取り、10 倍して点にする）
 * 先頭の点は snap_first により、直前に隙間なく続くノートとの音高差へ OpenUtau が置き換えるため、
 * y = 0 で置いておけば「前の音からつながる音程遷移」になる。
 */

const ms = (min: number, max: number) => z.number().finite().min(min).max(max);
const semitones = (max: number) => z.number().finite().min(0).max(max);

/** なめらかな音程遷移（Smooth Transition）。前の音からの移り変わりにかける時間 */
export const transitionSchema = z.object({ lengthMs: ms(10, 400) });
/** しゃくり（Scoop）。下から持ち上げて目標の音高に入る */
export const scoopSchema = z.object({
  transitionMs: ms(10, 400),
  /** 下がる深さ（半音） */
  depth: semitones(3),
  /** 下から目標の音高まで戻る時間 */
  lengthMs: ms(20, 400),
});
/** オーバーシュート（Accent）。目標の音高を少し越えてから戻る */
export const overshootSchema = z.object({
  transitionMs: ms(10, 400),
  /** 越える高さ（半音） */
  depth: semitones(2),
  /** 越えてから目標の音高に落ち着くまでの時間 */
  lengthMs: ms(20, 400),
});
/** フォール（Fall）。ノートの終わりで音高を下げる */
export const fallSchema = z.object({
  /** 下げる深さ（半音） */
  depth: semitones(5),
  /** 下げ始めてからノートの終わりまでの時間 */
  lengthMs: ms(20, 600),
});
/** ビブラート。周期・深さは OpenUtau と同じ範囲 */
export const vibratoParamsSchema = z.object({
  /** ノート長に対するビブラートの長さ（%） */
  lengthPct: z.number().finite().min(0).max(100),
  periodMs: ms(5, 500),
  /** 深さ（cent） */
  depthCents: z.number().finite().min(5).max(200),
  /** ビブラート長に対するフェードイン・フェードアウト（%）。合計 100 以下 */
  fadeInPct: z.number().finite().min(0).max(100),
  fadeOutPct: z.number().finite().min(0).max(100),
});

export type TransitionParams = z.infer<typeof transitionSchema>;
export type ScoopParams = z.infer<typeof scoopSchema>;
export type OvershootParams = z.infer<typeof overshootSchema>;
export type FallParams = z.infer<typeof fallSchema>;
export type VibratoParams = z.infer<typeof vibratoParamsSchema>;

/** ノートの入り方。どれか 1 つを選ぶ */
export type Attack =
  | { kind: "transition"; params: TransitionParams }
  | { kind: "scoop"; params: ScoopParams }
  | { kind: "overshoot"; params: OvershootParams };

/** OpenUtau の新規ノートと同じ音程遷移（-40ms〜+40ms） */
export const DEFAULT_TRANSITION_MS = 80;

/** 入りのテクニックが使えるのは、ノートの長さのこの割合まで（残りを本体とフォールに残す） */
const MAX_ATTACK_RATIO = 0.6;
/** フォールが入りと重なる場合、これより短くしか入らないならフォールを付けない（ms） */
const MIN_FALL_MS = 20;

const point = (x: number, y: number, shape: PitchPoint["shape"] = "io"): PitchPoint => ({
  x: Math.round(x * 10) / 10,
  y: Math.round(y * 100) / 100,
  shape,
});

/**
 * ノートの入りのピッチ点。どれも「前の音からの音程遷移の点」から始まる。
 * 入りの長さがノートに収まらない場合は、ノートの長さに合わせて縮める。
 */
export function attackPoints(attack: Attack, durationMs: number): PitchPoint[] {
  const limit = durationMs * MAX_ATTACK_RATIO;
  switch (attack.kind) {
    case "transition": {
      const { lengthMs } = transitionSchema.parse(attack.params);
      const half = Math.min(lengthMs / 2, limit);
      return [point(-lengthMs / 2, 0), point(half, 0)];
    }
    case "scoop": {
      const { transitionMs, depth, lengthMs } = scoopSchema.parse(attack.params);
      const dip = Math.min(transitionMs / 2, limit / 2);
      const end = Math.min(dip + lengthMs, limit);
      // 前の音から下がった所へ移り、そこから目標の音高へ持ち上げる（後半ほどゆっくり）
      return [point(-transitionMs / 2, 0), point(dip, -depth * 10, "o"), point(end, 0)];
    }
    case "overshoot": {
      const { transitionMs, depth, lengthMs } = overshootSchema.parse(attack.params);
      const peak = Math.min(transitionMs / 2, limit / 2);
      const end = Math.min(peak + lengthMs, limit);
      return [point(-transitionMs / 2, 0), point(peak, depth * 10), point(end, 0)];
    }
  }
}

/** ノートの終わりで下げるピッチ点。入りの点と重なる場合は短くし、入らなければ付けない */
export function fallPoints(
  params: FallParams,
  durationMs: number,
  attackEndMs: number,
): PitchPoint[] {
  const { depth, lengthMs } = fallSchema.parse(params);
  const length = Math.min(lengthMs, durationMs - attackEndMs);
  if (length < MIN_FALL_MS || depth === 0) return [];
  // 最初はゆっくり、終わりに向けて急に下げる
  return [point(durationMs - length, 0, "i"), point(durationMs, -depth * 10)];
}

/**
 * 入りとフォールを組み合わせたピッチ。OpenUtau の制約（x の昇順、snap_first で 0 点にしない）を満たす。
 * fall を渡さなければフォールは付けない。
 */
export function composePitch(
  attack: Attack,
  durationMs: number,
  fall?: FallParams,
): RawNote["pitch"] {
  const head = attackPoints(attack, durationMs);
  const attackEnd = head[head.length - 1].x;
  const tail = fall ? fallPoints(fall, durationMs, attackEnd) : [];
  return normalizePitch({ data: [...head, ...tail], snap_first: true });
}

/** ビブラートの値。shift・drift・vol_link など、パラメータに無い値は今のノートの値を引き継ぐ */
export function vibratoFor(params: VibratoParams, current: Vibrato): Vibrato {
  const p = vibratoParamsSchema.parse(params);
  return normalizeVibrato({
    ...current,
    length: p.lengthPct,
    period: p.periodMs,
    depth: p.depthCents,
    in: p.fadeInPct,
    out: p.fadeOutPct,
  });
}
