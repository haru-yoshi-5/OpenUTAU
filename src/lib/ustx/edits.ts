import { type Document, isMap, YAMLSeq } from "yaml";
import { isDeepStrictEqual } from "./deep-equal";
import { UstxError } from "./errors";
import { exportUnchanged, serializeVerified } from "./export";
import type { LoadedUstx, Note, Project } from "./load";
import type { PitchPoint, RawNote, Vibrato } from "./types";

/**
 * ノートへの編集差分。元の YAML 文書は書き換えず、書き出すときに複製した文書へ当てる。
 * Phase 2 で編集するのはピッチ点とビブラートだけ（位置・音高・歌詞は扱わない）。
 */
export interface NoteEdit {
  pitch?: RawNote["pitch"];
  vibrato?: Vibrato;
}

/** ノートを特定するキー。voice_parts と notes の、YAML 上の添字の組 */
export type NoteKey = `${number}:${number}`;

export type EditMap = ReadonlyMap<NoteKey, NoteEdit>;

export const noteKey = (partIndex: number, noteIndex: number): NoteKey =>
  `${partIndex}:${noteIndex}`;

export function parseNoteKey(key: NoteKey): { partIndex: number; noteIndex: number } {
  const [partIndex, noteIndex] = key.split(":").map(Number);
  return { partIndex, noteIndex };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function invalidEdit(message: string, detail?: string): never {
  throw new UstxError("invalid-edit", message, detail);
}

/**
 * OpenUtau（UPitch）が前提とする形にそろえる。
 * - 読み込み時にソートされず、補間は x の昇順を前提にしているため、x の昇順に並べる
 * - snap_first が有効なとき、OpenUtau は先頭の点を無条件に参照するため、0 点を許さない
 */
export function normalizePitch(pitch: RawNote["pitch"]): RawNote["pitch"] {
  const data: PitchPoint[] = pitch.data.map(({ x, y, shape }) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      invalidEdit("ピッチ点の位置・高さに数値以外の値が含まれています。");
    }
    return { x, y, shape };
  });
  if (pitch.snap_first && data.length === 0) {
    invalidEdit("ピッチ点をすべて削除することはできません（OpenUtau で開けなくなるため）。");
  }
  // Array.prototype.sort は安定ソートなので、同じ x の点は元の順序を保つ
  data.sort((a, b) => a.x - b.x);
  return { data, snap_first: pitch.snap_first };
}

/**
 * OpenUtau（UVibrato）のセッターと同じ範囲に丸める。
 * in と out は「in を設定 → out を設定」の順で丸められ、最終的に in + out ≤ 100 になる。
 */
export function normalizeVibrato(vibrato: Vibrato): Vibrato {
  for (const [name, value] of Object.entries(vibrato)) {
    if (!Number.isFinite(value)) invalidEdit("ビブラートに数値以外の値が含まれています。", name);
  }
  const out = clamp(vibrato.out, 0, 100);
  return {
    length: clamp(vibrato.length, 0, 100),
    period: clamp(vibrato.period, 5, 500),
    depth: clamp(vibrato.depth, 5, 200),
    in: Math.min(clamp(vibrato.in, 0, 100), 100 - out),
    out,
    shift: clamp(vibrato.shift, 0, 100),
    drift: clamp(vibrato.drift, -100, 100),
    vol_link: clamp(vibrato.vol_link, -100, 100),
  };
}

/** OpenUtau でビブラートをオンにしたときの長さ（NotePresets.DefaultVibrato.VibratoLength） */
export const DEFAULT_VIBRATO_LENGTH = 75;

export function normalizeEdit(edit: NoteEdit): NoteEdit {
  return {
    ...(edit.pitch && { pitch: normalizePitch(edit.pitch) }),
    ...(edit.vibrato && { vibrato: normalizeVibrato(edit.vibrato) }),
  };
}

/**
 * 今の差分に patch を重ねた、新しい差分を返す。
 * 元データと同じ値に戻った項目は差分から外し、何も残らなければ undefined（＝元データのまま）を返す。
 */
export function mergeNoteEdit(
  original: Pick<RawNote, "pitch" | "vibrato">,
  current: NoteEdit | undefined,
  patch: NoteEdit,
): NoteEdit | undefined {
  const next: NoteEdit = { ...current, ...normalizeEdit(patch) };
  if (next.pitch && isDeepStrictEqual(next.pitch, original.pitch) === null) delete next.pitch;
  if (next.vibrato && isDeepStrictEqual(next.vibrato, original.vibrato) === null) {
    delete next.vibrato;
  }
  return next.pitch || next.vibrato ? next : undefined;
}

/**
 * 表示用のプロジェクトに差分を当てる。
 * 変更の無いパート・ノートは同じオブジェクトを返し、メモ化を効かせる。
 */
export function applyEditsToProject(project: Project, edits: EditMap): Project {
  if (edits.size === 0) return project;
  let changed = false;
  const voiceParts = project.voiceParts.map((part) => {
    let partChanged = false;
    const notes = part.notes.map((note): Note => {
      const edit = edits.get(noteKey(part.index, note.index));
      if (!edit) return note;
      partChanged = true;
      return {
        ...note,
        ...(edit.pitch && { pitch: edit.pitch }),
        ...(edit.vibrato && { vibrato: edit.vibrato }),
      };
    });
    if (!partChanged) return part;
    changed = true;
    return { ...part, notes };
  });
  return changed ? { ...project, voiceParts } : project;
}

const notePath = (key: NoteKey) => {
  const { partIndex, noteIndex } = parseNoteKey(key);
  return ["voice_parts", partIndex, "notes", noteIndex] as const;
};

/** 差分を YAML 文書へ当てる。OpenUtau と同じく、ピッチ点とビブラートはフロー形式で書く */
function applyEditsToDocument(doc: Document, edits: EditMap): void {
  for (const [key, edit] of edits) {
    const path = notePath(key);
    if (!isMap(doc.getIn(path, true))) {
      invalidEdit("編集対象のノートが見つかりません。", key);
    }
    if (edit.pitch) {
      // シーケンス自体はブロック形式、各点は「{x: -25, y: 0, shape: io}」のフロー形式にする
      const data = new YAMLSeq();
      data.items = edit.pitch.data.map((point) => doc.createNode(point, { flow: true }));
      const pitchNode = doc.getIn([...path, "pitch"], true);
      if (isMap(pitchNode)) {
        pitchNode.set("data", data);
        pitchNode.set("snap_first", edit.pitch.snap_first);
      } else {
        doc.setIn([...path, "pitch"], doc.createNode({ data, snap_first: edit.pitch.snap_first }));
      }
    }
    if (edit.vibrato) {
      const vibratoNode = doc.getIn([...path, "vibrato"], true);
      if (isMap(vibratoNode)) {
        // 既存のノードの値だけを差し替え、キーの順序と書式（フロー形式）を保つ
        for (const [name, value] of Object.entries(edit.vibrato)) vibratoNode.set(name, value);
      } else {
        doc.setIn([...path, "vibrato"], doc.createNode(edit.vibrato, { flow: true }));
      }
    }
  }
}

/** 再読み込み後に一致すべきデータ（元データに差分を当てたもの）を作る */
function applyEditsToData(data: unknown, edits: EditMap): unknown {
  const root = structuredClone(data) as {
    voice_parts: { notes: Record<string, unknown>[] }[];
  };
  for (const [key, edit] of edits) {
    const { partIndex, noteIndex } = parseNoteKey(key);
    const note = root.voice_parts[partIndex].notes[noteIndex];
    if (edit.pitch) {
      const pitch = (note.pitch ?? {}) as Record<string, unknown>;
      note.pitch = { ...pitch, data: edit.pitch.data, snap_first: edit.pitch.snap_first };
    }
    if (edit.vibrato) {
      note.vibrato = { ...(note.vibrato as Record<string, unknown>), ...edit.vibrato };
    }
  }
  return root;
}

/** 元ファイルを上書きしないよう、編集版には接尾辞を付ける（例：song.ustx → song_edited.ustx） */
export function editedFileName(fileName: string): string {
  const base = fileName.replace(/\.ustx$/i, "");
  return `${base}_edited.ustx`;
}

/**
 * 差分を当てた USTX を書き出す。差分が無ければ読み込んだバイト列をそのまま返す。
 * 書き出し結果は読み込み直して検証し、期待どおりでなければ出力を止める。
 */
export function exportEdited(loaded: LoadedUstx, edits: EditMap): Uint8Array {
  if (edits.size === 0) return exportUnchanged(loaded);
  const normalized = new Map([...edits].map(([key, edit]) => [key, normalizeEdit(edit)]));
  // clone() の戻り値の型は Parsed ではなくなるが、中身は読み込んだ文書の複製で構造は同じ
  const doc = loaded.doc.clone() as Document.Parsed;
  applyEditsToDocument(doc, normalized);
  const expected = applyEditsToData(loaded.doc.toJS({ maxAliasCount: 0 }), normalized);
  return serializeVerified({ ...loaded, doc }, expected);
}
