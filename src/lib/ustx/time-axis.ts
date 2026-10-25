import type { Tempo } from "./types";

/** OpenUtau は分解能を 480 tick / 四分音符 に固定している（USTX の resolution は読み込み時に無視される） */
export const RESOLUTION = 480;

interface TempoSegment {
  tick: number;
  ms: number;
  msPerTick: number;
}

/**
 * テンポマップに基づく tick ⇔ ミリ秒 変換。
 * tick はプロジェクト先頭からの絶対位置。
 */
export class TimeAxis {
  private readonly segments: TempoSegment[];

  constructor(tempos: readonly Tempo[]) {
    const sorted = [...tempos].sort((a, b) => a.position - b.position);
    if (sorted.length === 0 || sorted[0].position > 0) {
      sorted.unshift({ position: 0, bpm: sorted[0]?.bpm ?? 120 });
    }
    const segments: TempoSegment[] = [];
    let ms = 0;
    for (let i = 0; i < sorted.length; i++) {
      const tempo = sorted[i];
      if (i > 0) {
        const prev = segments[i - 1];
        ms = prev.ms + (tempo.position - prev.tick) * prev.msPerTick;
      }
      segments.push({
        tick: tempo.position,
        ms,
        msPerTick: 60000 / (tempo.bpm * RESOLUTION),
      });
    }
    this.segments = segments;
  }

  tickToMs(tick: number): number {
    const seg = this.findByTick(tick);
    return seg.ms + (tick - seg.tick) * seg.msPerTick;
  }

  msToTick(ms: number): number {
    const seg = this.findByMs(ms);
    return seg.tick + (ms - seg.ms) / seg.msPerTick;
  }

  private findByTick(tick: number): TempoSegment {
    let found = this.segments[0];
    for (const seg of this.segments) {
      if (seg.tick <= tick) found = seg;
      else break;
    }
    return found;
  }

  private findByMs(ms: number): TempoSegment {
    let found = this.segments[0];
    for (const seg of this.segments) {
      if (seg.ms <= ms) found = seg;
      else break;
    }
    return found;
  }
}
