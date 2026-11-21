import type { Bar } from "../../lib/ustx/bars";
import type { Note } from "../../lib/ustx/load";
import { type Camera, ROW_HEIGHT, TONE_MAX, visibleNotes } from "./geometry";

/*
 * ピアノロール上の位置（描画領域の左上を 0 とする px）から、ノートや小節を求める。
 * 選択操作で使う。描画と同じ座標系（geometry.ts）を前提にする。
 */

/** 描画領域内の x 座標（px）にある tick（パート先頭からの相対値） */
export const xToTick = (x: number, cam: Camera) => cam.scrollTick + x / cam.pxPerTick;

/** 描画領域内の y 座標（px）を含む行の音高 */
export const yToTone = (y: number, cam: Camera) =>
  TONE_MAX - Math.floor((y + cam.scrollY) / ROW_HEIGHT);

/** 描画では 2px より細いノートも 2px で描くため、当たり判定も同じ幅を最低限とする */
const MIN_NOTE_PX = 2;

const minTicks = (cam: Camera) => MIN_NOTE_PX / cam.pxPerTick;

const noteEnd = (note: Note, cam: Camera) => note.position + Math.max(note.duration, minTicks(cam));

/**
 * [fromTick, toTick] の近くにあるノートの候補（position 昇順）。
 * 最低幅で広がった分も含めて、手前から食い込むノートも拾う。
 * visibleNotes は実際の長さで絞り込むため、ここでは使わない
 */
function candidates(
  notes: readonly Note[],
  maxDuration: number,
  fromTick: number,
  toTick: number,
  cam: Camera,
): Note[] {
  const from = fromTick - Math.max(maxDuration, minTicks(cam));
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].position >= from) hi = mid;
    else lo = mid + 1;
  }
  const result: Note[] = [];
  for (let i = lo; i < notes.length && notes[i].position <= toTick; i++) result.push(notes[i]);
  return result;
}

/**
 * 指定位置にあるノート。重なっている場合は、後から描かれる（手前に見える）ものを返す。
 * notes は position の昇順であること。
 */
export function noteAt(
  notes: readonly Note[],
  maxDuration: number,
  x: number,
  y: number,
  cam: Camera,
): Note | undefined {
  const tick = xToTick(x, cam);
  const tone = yToTone(y, cam);
  const found = candidates(notes, maxDuration, tick, tick, cam);
  for (let i = found.length - 1; i >= 0; i--) {
    const note = found[i];
    if (note.tone === tone && note.position <= tick && tick < noteEnd(note, cam)) return note;
  }
  return undefined;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 矩形（描画領域内の px、向きは問わない）に一部でも掛かるノートの Note.index */
export function notesInRect(
  notes: readonly Note[],
  maxDuration: number,
  rect: Rect,
  cam: Camera,
): number[] {
  const fromTick = xToTick(Math.min(rect.x0, rect.x1), cam);
  const toTick = xToTick(Math.max(rect.x0, rect.x1), cam);
  const highTone = yToTone(Math.min(rect.y0, rect.y1), cam);
  const lowTone = yToTone(Math.max(rect.y0, rect.y1), cam);
  return candidates(notes, maxDuration, fromTick, toTick, cam)
    .filter(
      (note) =>
        note.tone >= lowTone &&
        note.tone <= highTone &&
        note.position <= toTick &&
        noteEnd(note, cam) > fromTick,
    )
    .map((note) => note.index);
}

/** [fromTick, toTick) と重なるノートの Note.index（小節範囲の選択に使う） */
export function notesInTickRange(
  notes: readonly Note[],
  maxDuration: number,
  fromTick: number,
  toTick: number,
): number[] {
  return visibleNotes(notes, maxDuration, fromTick, toTick).map((note) => note.index);
}

/** パート先頭からの tick を含む小節の添字（bars はプロジェクト先頭からの絶対 tick） */
export function barIndexAt(bars: readonly Bar[], partPosition: number, tick: number): number {
  const abs = tick + partPosition;
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid].tick <= abs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 小節 a〜b（順不同、両端を含む）の範囲を、パート先頭からの tick で返す */
export function barSpanTicks(
  bars: readonly Bar[],
  partPosition: number,
  a: number,
  b: number,
): { fromTick: number; toTick: number } {
  const first = bars[Math.min(a, b)];
  const last = bars[Math.max(a, b)];
  return {
    fromTick: first.tick - partPosition,
    toTick: last.tick + last.beatTicks * last.beats - partPosition,
  };
}
