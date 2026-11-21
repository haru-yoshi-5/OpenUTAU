import { type EditMap, type NoteEdit, noteKey } from "../../lib/ustx/edits";
import type { VoicePart } from "../../lib/ustx/load";
import type { TimeAxis } from "../../lib/ustx/time-axis";
import { generatePresetEdits, type PresetId } from "../../lib/tuning/presets";
import type { EditChange } from "../../stores/edit-store";

/**
 * 選んだノートにプリセットを当てた「候補」を、編集ストアに渡せる変更の一覧として作る。
 * 候補はノートの今の差分に重ねる（プリセットが変えない項目は、今の差分のまま残す）。
 * part には差分を当てたパートを渡す（ビブラートの shift などを今の値から引き継ぐため）。
 */
export function buildPresetChanges(
  part: VoicePart,
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
  return [...generated].map(([noteIndex, edit]) => {
    const key = noteKey(part.index, noteIndex);
    const after: NoteEdit = { ...edits.get(key), ...edit };
    return { key, after };
  });
}

/** 候補を差分に重ねた結果（表示・ピッチ計算用）。候補が無ければ edits をそのまま返す */
export function withCandidate(edits: EditMap, changes: readonly EditChange[]): EditMap {
  if (changes.length === 0) return edits;
  const next = new Map(edits);
  for (const { key, after } of changes) {
    if (after) next.set(key, after);
  }
  return next;
}
