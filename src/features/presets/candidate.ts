import { isDeepStrictEqual } from "../../lib/ustx/deep-equal";
import { type EditMap, type NoteEdit, noteKey, pruneEdit } from "../../lib/ustx/edits";
import type { Note, VoicePart } from "../../lib/ustx/load";
import type { TimeAxis } from "../../lib/ustx/time-axis";
import { generatePresetEdits, type PresetId } from "../../lib/tuning/presets";
import type { EditChange } from "../../stores/edit-store";

/**
 * 選んだノートにプリセットを当てた「候補」を、編集ストアに渡せる変更の一覧として作る。
 * - 候補はノートの今の差分に重ねる（プリセットが変えない項目は、今の差分のまま残す）
 * - 編集ストアと同じ基準（元データと同じ項目は差分から外す）でそろえ、今の差分と変わらない
 *   ノートは含めない。返す一覧の長さが「実際に変わるノートの数」になる
 * part には差分を当てたパート（ビブラートの shift などを今の値から引き継ぐため）、
 * original には読み込んだときのパートを渡す。
 */
export function buildPresetChanges(
  part: VoicePart,
  original: VoicePart,
  edits: EditMap,
  selected: ReadonlySet<number>,
  timeAxis: TimeAxis,
  presetId: PresetId,
  strength: number,
): EditChange[] {
  if (selected.size === 0) return [];
  const generated = generatePresetEdits(
    { notes: part.notes, targets: selected, partPosition: part.position, timeAxis },
    presetId,
    strength,
  );
  const originals = new Map<number, Note>(original.notes.map((n) => [n.index, n]));
  const changes: EditChange[] = [];
  for (const [noteIndex, edit] of generated) {
    const source = originals.get(noteIndex);
    if (!source) continue;
    const key = noteKey(part.index, noteIndex);
    const current = edits.get(key);
    const after = pruneEdit(source, { ...current, ...edit } satisfies NoteEdit);
    if (isDeepStrictEqual(after, current) === null) continue;
    changes.push({ key, after });
  }
  return changes;
}

/**
 * 候補を差分に重ねた結果（表示・ピッチ計算用）。候補が無ければ edits をそのまま返す。
 * after が undefined の変更は、そのノートを元データに戻す
 */
export function withCandidate(edits: EditMap, changes: readonly EditChange[]): EditMap {
  if (changes.length === 0) return edits;
  const next = new Map(edits);
  for (const { key, after } of changes) {
    if (after) next.set(key, after);
    else next.delete(key);
  }
  return next;
}

/** 候補で変わるノートのピッチの助走（前の音からの遷移）を含めるため、ノートの頭より手前に取る量（tick） */
const LEAD_TICKS = 240;

/**
 * 候補で変わるノートが掛かる区間（パート先頭からの tick、[from, to)）。重なる区間はまとめる。
 * ピアノロールでは、この区間にだけ候補の点線を描く
 */
export function candidateTickRanges(
  part: VoicePart,
  changes: readonly EditChange[],
): { from: number; to: number }[] {
  const changed = new Set(changes.map((c) => c.key));
  const spans = part.notes
    .filter((n) => changed.has(noteKey(part.index, n.index)))
    .map((n) => ({ from: n.position - LEAD_TICKS, to: n.position + n.duration }))
    .sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  return merged;
}
