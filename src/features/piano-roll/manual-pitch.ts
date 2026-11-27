import type { TimeAxis } from "../../lib/ustx/time-axis";
import type { PitchPoint } from "../../lib/ustx/types";

/** パート内 tick を、ノート先頭からのミリ秒へ変換する。 */
export function pointTime(
  axis: TimeAxis,
  partPosition: number,
  notePosition: number,
  tick: number,
): number {
  // -0 は 0 と別の値とみなされ、元の位置に戻しても編集が残るため 0 にそろえる
  return (
    Math.round(axis.tickToMs(partPosition + tick) - axis.tickToMs(partPosition + notePosition)) || 0
  );
}

/** 隣接点を追い越さないように位置を制限する。 */
export function clampPointTime(points: readonly PitchPoint[], index: number, x: number): number {
  return Math.max(points[index - 1]?.x ?? -Infinity, Math.min(points[index + 1]?.x ?? Infinity, x));
}
