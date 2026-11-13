import type { Bar } from "../../lib/ustx/bars";
import type { Note, VoicePart } from "../../lib/ustx/load";
import type { PitchCurve } from "../../lib/ustx/pitch";
import type { ContentBounds } from "../../stores/view-store";

/** 左側の鍵盤の幅（px） */
export const KEY_WIDTH = 52;
/** 上部の小節ルーラーの高さ（px） */
export const RULER_HEIGHT = 28;
/** 1 半音あたりの高さ（px） */
export const ROW_HEIGHT = 14;
/** 表示する音高の範囲（MIDI ノート番号）。編集時に任意の音高へ動かせるよう全域を持つ */
export const TONE_MIN = 0;
export const TONE_MAX = 127;
export const CONTENT_HEIGHT = (TONE_MAX - TONE_MIN + 1) * ROW_HEIGHT;

/** 表示中の座標系。x は描画領域の左端、y は描画領域の上端を 0 とする */
export interface Camera {
  pxPerTick: number;
  scrollTick: number;
  scrollY: number;
}

export const tickToX = (tick: number, cam: Camera) => (tick - cam.scrollTick) * cam.pxPerTick;
/** 音高の行の上端 */
export const toneToY = (tone: number, cam: Camera) => (TONE_MAX - tone) * ROW_HEIGHT - cam.scrollY;
/** 音高（cent）を、その音高の行の中央の y 座標に変換する */
export const centsToY = (cents: number, cam: Camera) =>
  (TONE_MAX - cents / 100) * ROW_HEIGHT + ROW_HEIGHT / 2 - cam.scrollY;

/** ノートが集まっている音域の中心（行の中央の y 座標、スクロール 0 のとき） */
export function focusYOf(notes: readonly Note[]): number {
  const avg = notes.length ? notes.reduce((sum, n) => sum + n.tone, 0) / notes.length : 66;
  return (TONE_MAX - avg) * ROW_HEIGHT + ROW_HEIGHT / 2;
}

export function contentBoundsOf(part: VoicePart, pitch: PitchCurve | null): ContentBounds {
  const endTick = part.notes.reduce(
    (max, n) => Math.max(max, n.position + n.duration),
    part.duration,
  );
  return {
    startTick: Math.min(0, pitch?.startTick ?? 0),
    endTick,
    height: CONTENT_HEIGHT,
  };
}

/** 描画領域に入る音高の範囲（上端・下端の行を含む） */
export function visibleToneRange(cam: Camera, height: number): { high: number; low: number } {
  const high = Math.min(TONE_MAX, TONE_MAX - Math.floor(cam.scrollY / ROW_HEIGHT));
  const low = Math.max(TONE_MIN, TONE_MAX - Math.ceil((cam.scrollY + height) / ROW_HEIGHT));
  return { high, low };
}

/** 最初に pred が真になる添字（無ければ length）。arr は pred について単調であること */
function lowerBound<T>(arr: readonly T[], pred: (item: T) => boolean): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pred(arr[mid])) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * [fromTick, toTick) と重なるノートを返す。notes は position の昇順であること。
 * 長いノートが前から食い込む場合も拾えるよう、最長ノートの長さぶん手前から探す。
 */
export function visibleNotes(
  notes: readonly Note[],
  maxDuration: number,
  fromTick: number,
  toTick: number,
): Note[] {
  const start = lowerBound(notes, (n) => n.position >= fromTick - maxDuration);
  const result: Note[] = [];
  for (let i = start; i < notes.length; i++) {
    const n = notes[i];
    if (n.position >= toTick) break;
    if (n.position + n.duration > fromTick) result.push(n);
  }
  return result;
}

export interface GridLine {
  key: string;
  /** パート先頭からの tick */
  tick: number;
  kind: "bar" | "beat";
  /** 小節線のときの小節番号（1 始まり） */
  barNumber?: number;
}

/** 描画範囲内の小節線・拍線。bars はプロジェクト先頭からの絶対 tick */
export function gridLines(
  bars: readonly Bar[],
  partPosition: number,
  fromTick: number,
  toTick: number,
): GridLine[] {
  const lines: GridLine[] = [];
  for (const bar of bars) {
    const barTick = bar.tick - partPosition;
    if (barTick + bar.beatTicks * bar.beats < fromTick) continue;
    if (barTick > toTick) break;
    for (let beat = 0; beat < bar.beats; beat++) {
      const tick = barTick + beat * bar.beatTicks;
      if (tick < fromTick || tick > toTick) continue;
      lines.push(
        beat === 0
          ? { key: `b${bar.index}`, tick, kind: "bar", barNumber: bar.index + 1 }
          : { key: `b${bar.index}-${beat}`, tick, kind: "beat" },
      );
    }
  }
  return lines;
}

/**
 * ピッチカーブのうち描画範囲内の部分を、Konva の Line 用の点列（[x0, y0, x1, y1, ...]）に変換する。
 * 休符（NaN）で線を区切る。縮小表示では 1px 未満の間隔のサンプルを間引く。
 */
export function pitchPolylines(
  pitch: PitchCurve,
  cam: Camera,
  fromTick: number,
  toTick: number,
): number[][] {
  const { startTick, interval, cents } = pitch;
  const step = Math.max(1, Math.floor(1 / (interval * cam.pxPerTick)));
  const first = Math.max(0, Math.floor((fromTick - startTick) / interval) - step);
  const last = Math.min(cents.length - 1, Math.ceil((toTick - startTick) / interval) + step);

  const lines: number[][] = [];
  let current: number[] | null = null;
  for (let i = first; i <= last; i += step) {
    const c = cents[i];
    if (Number.isNaN(c)) {
      current = null;
      continue;
    }
    if (!current) {
      current = [];
      lines.push(current);
    }
    current.push(tickToX(startTick + i * interval, cam), centsToY(c, cam));
  }
  // 線にならない 1 点だけの区間は捨てる
  return lines.filter((points) => points.length >= 4);
}
