import type { Note, VoicePart } from "./load";
import type { TimeAxis } from "./time-axis";
import type { Curve, PitchPoint, PitchShape, Vibrato } from "./types";

/** OpenUtau のピッチ計算間隔（tick） */
export const PITCH_INTERVAL = 5;
/** 表示開始位置を先頭ノートより手前に取る量（tick） */
const LEADING_TICKS = 120;

export interface PitchCurve {
  /** パート先頭からの tick（samples[0] の位置） */
  startTick: number;
  interval: number;
  /** 各サンプルの音高（cent、MIDI ノート番号 × 100）。ノートの無い区間は NaN */
  cents: Float64Array;
}

const ease = {
  io: (t: number) => (1 - Math.cos(t * Math.PI)) / 2,
  i: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  o: (t: number) => Math.sin((t * Math.PI) / 2),
  l: (t: number) => t,
} satisfies Record<Exclude<PitchShape, "sp">, (t: number) => number>;

/** MusicMath.InterpolateShape 相当。sp（スプライン）は近似として io で補間する */
export function interpolateShape(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  x: number,
  shape: PitchShape,
): number {
  if (x1 - x0 < 1e-6) return y1;
  const t = (x - x0) / (x1 - x0);
  const fn = shape === "sp" ? ease.io : ease[shape];
  return y0 + (y1 - y0) * fn(t);
}

export function adjustedTone(note: Note): number {
  return note.tone + note.tuning / 100;
}

/**
 * snap_first が有効なとき、OpenUtau は先頭ピッチ点の y を
 * 「直前に隣接するノートとの音高差」に置き換える（UNote.Validate）。
 */
export function effectivePitchPoints(
  note: Note,
  prev: Note | undefined,
): PitchPoint[] {
  const data = note.pitch.data.map((p) => ({ ...p }));
  if (note.pitch.snap_first && data.length > 0) {
    data[0].y =
      prev && prev.position + prev.duration === note.position
        ? (adjustedTone(prev) - adjustedTone(note)) * 10
        : 0;
  }
  return data;
}

/** UVibrato.Evaluate 相当。戻り値はノート音高からの差分（cent） */
export function evaluateVibrato(
  vibrato: Vibrato,
  nPos: number,
  nPeriod: number,
): number {
  const nStart = 1 - vibrato.length / 100;
  const nIn = (vibrato.length / 100) * (vibrato.in / 100);
  const nOut = (vibrato.length / 100) * (vibrato.out / 100);
  const t = (nPos - nStart) / nPeriod + vibrato.shift / 100;
  let y =
    Math.sin(2 * Math.PI * t) * vibrato.depth +
    (vibrato.depth / 100) * vibrato.drift;
  if (nPos < nStart) y = 0;
  else if (nPos < nStart + nIn) y *= (nPos - nStart) / nIn;
  else if (nPos > 1 - nOut) y *= (1 - nPos) / nOut;
  return y;
}

/** UCurve.Sample 相当（範囲外は既定値 0） */
export function sampleCurve(curve: Curve, x: number): number {
  const { xs, ys } = curve;
  if (xs.length === 0) return 0;
  let lo = 0;
  let hi = xs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] === x) return ys[mid];
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid - 1;
  }
  if (lo > 0 && lo < xs.length) {
    const x0 = xs[lo - 1];
    const x1 = xs[lo];
    return Math.round(
      ys[lo - 1] + ((ys[lo] - ys[lo - 1]) * (x - x0)) / (x1 - x0),
    );
  }
  return 0;
}

interface AbsPoint {
  /** パート先頭からの tick */
  x: number;
  /** cent */
  y: number;
  shape: PitchShape;
}

/**
 * パート全体のピッチカーブを計算する。OpenUtau の RenderPhrase と同じ順序で
 * 「ノート音高のステップ → ビブラート → ピッチ点 → PITD カーブ」を重ねる。
 * 発音記号（音素）単位の補正やスプライン補間は省略した近似であり、表示・比較用途とする。
 */
export function renderPartPitch(
  part: VoicePart,
  timeAxis: TimeAxis,
): PitchCurve | null {
  const notes = part.notes;
  if (notes.length === 0) return null;

  const toPartTick = (note: Note, xMs: number) => {
    const noteMs = timeAxis.tickToMs(part.position + note.position);
    return Math.round(timeAxis.msToTick(noteMs + xMs)) - part.position;
  };

  const pointsByNote = notes.map((note, i) => {
    const tone = adjustedTone(note) * 100;
    const pts: AbsPoint[] = effectivePitchPoints(note, notes[i - 1]).map(
      (p) => ({
        x: toPartTick(note, p.x),
        y: p.y * 10 + tone,
        shape: p.shape,
      }),
    );
    return pts;
  });

  const firstX = Math.min(
    notes[0].position,
    pointsByNote[0][0]?.x ?? notes[0].position,
  );
  const startTick =
    Math.floor(
      Math.max(firstX - LEADING_TICKS, -part.position) / PITCH_INTERVAL,
    ) * PITCH_INTERVAL;
  const endTick = notes.reduce(
    (max, n) => Math.max(max, n.position + n.duration),
    0,
  );
  const length = Math.floor((endTick - startTick) / PITCH_INTERVAL) + 1;
  const pitches = new Float64Array(length);
  const xAt = (i: number) => startTick + i * PITCH_INTERVAL;

  // 1. ノート音高のステップ（休符区間は次のノートの音高で埋まる点も OpenUtau と同じ）
  let index = 0;
  for (const note of notes) {
    while (xAt(index) < note.position + note.duration && index < length) {
      pitches[index] = adjustedTone(note) * 100;
      index++;
    }
  }
  index = Math.max(1, index);
  for (; index < length; index++) pitches[index] = pitches[index - 1];

  // 2. ビブラート
  for (const note of notes) {
    if (note.vibrato.length <= 0) continue;
    const start = Math.max(
      0,
      Math.ceil((note.position - startTick) / PITCH_INTERVAL),
    );
    const end = Math.min(
      length,
      Math.floor((note.position + note.duration - startTick) / PITCH_INTERVAL),
    );
    const durationMs =
      timeAxis.tickToMs(part.position + note.position + note.duration) -
      timeAxis.tickToMs(part.position + note.position);
    const nPeriod = note.vibrato.period / durationMs;
    for (let i = start; i < end; i++) {
      const nPos = (xAt(i) - note.position) / note.duration;
      pitches[i] =
        adjustedTone(note) * 100 + evaluateVibrato(note.vibrato, nPos, nPeriod);
    }
  }

  // 3. ピッチ点（ノート音高からの差分として加算）
  notes.forEach((note, noteIdx) => {
    const tone = adjustedTone(note) * 100;
    const noteEnd = note.position + note.duration;
    const pts = [...pointsByNote[noteIdx]];
    if (pts.length === 0) {
      pts.push(
        { x: note.position, y: tone, shape: "io" },
        { x: noteEnd, y: tone, shape: "io" },
      );
    }
    if (noteIdx === 0 && pts[0].x > startTick) {
      pts.unshift({ x: startTick, y: pts[0].y, shape: "io" });
    } else if (pts[0].x > note.position) {
      pts.unshift({ x: note.position, y: pts[0].y, shape: "io" });
    }
    const lastPt = pts[pts.length - 1];
    if (lastPt.x < noteEnd) pts.push({ x: noteEnd, y: lastPt.y, shape: "io" });

    const prev = notes[noteIdx - 1];
    let i = Math.max(0, Math.trunc((pts[0].x - startTick) / PITCH_INTERVAL));
    for (let k = 0; k < pts.length - 1; k++) {
      const p0 = pts[k];
      const p1 = pts[k + 1];
      while (xAt(i) < p1.x && i < length) {
        const x = xAt(i);
        const base =
          prev && x < prev.position + prev.duration
            ? adjustedTone(prev) * 100
            : tone;
        pitches[i] +=
          interpolateShape(p0.x, p1.x, p0.y, p1.y, x, p0.shape) - base;
        i++;
      }
    }
  });

  // 4. PITD（ピッチ偏差カーブ、cent）
  const pitd = part.curves.find((c) => c.abbr === "pitd");
  if (pitd?.ys.some((y) => y !== 0)) {
    for (let i = 0; i < length; i++) pitches[i] += sampleCurve(pitd, xAt(i));
  }

  // 表示用に、どのノート（とそのピッチ点）にも掛からない休符区間を NaN にする
  const visible = new Uint8Array(length);
  notes.forEach((note, noteIdx) => {
    const xs = pointsByNote[noteIdx].map((p) => p.x);
    const from = Math.min(note.position, ...xs);
    const to = Math.max(note.position + note.duration, ...xs);
    const a = Math.max(0, Math.ceil((from - startTick) / PITCH_INTERVAL));
    const b = Math.min(
      length - 1,
      Math.floor((to - startTick) / PITCH_INTERVAL),
    );
    for (let i = a; i <= b; i++) visible[i] = 1;
  });
  for (let i = 0; i < length; i++) if (!visible[i]) pitches[i] = Number.NaN;

  return { startTick, interval: PITCH_INTERVAL, cents: pitches };
}
