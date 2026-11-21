import { isToneInMidiRange, MIDI_TONE_MAX, MIDI_TONE_MIN, toneName } from "../music";
import type { Project } from "./load";

/** ピッチ表示に反映しているカーブ */
const DISPLAYED_CURVES = new Set(["pitd"]);

/**
 * 読み込めたが、このツールでは表示・計算に反映していないデータを列挙する。
 * データ自体は元の YAML 文書に残り、書き出し時にも保持される。
 */
export function detectUnsupported(project: Project): string[] {
  const notices: string[] = [];

  if (project.wavePartCount > 0) {
    notices.push(`音声パート ${project.wavePartCount} 個は表示の対象外です。`);
  }

  const curveNames = new Set<string>();
  for (const part of project.voiceParts) {
    for (const curve of part.curves) {
      if (!DISPLAYED_CURVES.has(curve.abbr) && curve.xs.length > 0) curveNames.add(curve.abbr);
    }
  }
  if (curveNames.size > 0) {
    notices.push(
      `表現カーブ（${[...curveNames].sort().join(", ")}）は表示に反映していません。ピッチには PITD のみ反映しています。`,
    );
  }

  const outOfRange = project.voiceParts.reduce(
    (sum, part) => sum + part.notes.filter((n) => !isToneInMidiRange(n.tone)).length,
    0,
  );
  if (outOfRange > 0) {
    notices.push(
      `音高が表示範囲（${toneName(MIDI_TONE_MIN)}〜${toneName(MIDI_TONE_MAX)}）の外にあるノート ${outOfRange} 個は、ピアノロールに表示されません。`,
    );
  }

  return notices;
}
