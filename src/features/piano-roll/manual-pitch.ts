import type { TimeAxis } from "../../lib/ustx/time-axis";
import type { PitchPoint, RawNote } from "../../lib/ustx/types";

/** パート内 tick を、ノート先頭からのミリ秒へ変換する。 */
export function pointTime(
  axis: TimeAxis,
  partPosition: number,
  notePosition: number,
  tick: number,
): number {
  return Math.round(
    axis.tickToMs(partPosition + tick) - axis.tickToMs(partPosition + notePosition),
  );
}

/** 隣接点を追い越さないように位置を制限する。 */
export function clampPointTime(points: readonly PitchPoint[], index: number, x: number): number {
  return Math.max(points[index - 1]?.x ?? -Infinity, Math.min(points[index + 1]?.x ?? Infinity, x));
}

/**
 * ピッチ点を x の昇順に並べる（同じ x の点は元の順序を保つ）。
 * 編集を記録するときに同じ順序へ並べ替えられるため、点の番号もこの順序で付ける。
 */
export function sortedPitch(pitch: RawNote["pitch"]): RawNote["pitch"] {
  if (pitch.data.every((p, i) => i === 0 || pitch.data[i - 1].x <= p.x)) return pitch;
  return { ...pitch, data: [...pitch.data].sort((a, b) => a.x - b.x) };
}
