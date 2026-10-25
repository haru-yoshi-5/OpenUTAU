import { RESOLUTION } from "./time-axis";
import type { TimeSignature } from "./types";

export interface Bar {
  /** 0 始まりの小節番号 */
  index: number;
  /** プロジェクト先頭からの tick */
  tick: number;
  beatTicks: number;
  beats: number;
}

/** 拍子記号（bar_position は小節番号）から、endTick までの小節位置を求める */
export function computeBars(
  timeSignatures: readonly TimeSignature[],
  endTick: number,
): Bar[] {
  const sigs = [...timeSignatures].sort(
    (a, b) => a.bar_position - b.bar_position,
  );
  if (sigs.length === 0 || sigs[0].bar_position > 0) {
    sigs.unshift({ bar_position: 0, beat_per_bar: 4, beat_unit: 4 });
  }
  const bars: Bar[] = [];
  let tick = 0;
  let sigIndex = 0;
  for (let index = 0; tick <= endTick; index++) {
    while (
      sigIndex + 1 < sigs.length &&
      sigs[sigIndex + 1].bar_position <= index
    )
      sigIndex++;
    const sig = sigs[sigIndex];
    const beatTicks = (RESOLUTION * 4) / sig.beat_unit;
    bars.push({ index, tick, beatTicks, beats: sig.beat_per_bar });
    tick += beatTicks * sig.beat_per_bar;
  }
  return bars;
}
