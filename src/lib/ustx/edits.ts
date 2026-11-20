import { type Document, isMap, YAMLSeq } from "yaml";
import { isDeepStrictEqual } from "./deep-equal";
import { UstxError } from "./errors";
import { exportUnchanged, serializeVerified } from "./export";
import type { LoadedUstx, Note, Project } from "./load";
import { normalizePitch, normalizeVibrato } from "./normalize";
import type { RawNote, Vibrato } from "./types";

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

export { DEFAULT_VIBRATO_LENGTH, normalizePitch, normalizeVibrato } from "./normalize";

function invalidEdit(message: string, detail?: string): never {
  throw new UstxError("invalid-edit", message, detail);
}

export function normalizeEdit(edit: NoteEdit): NoteEdit {
  return {
    ...(edit.pitch && { pitch: normalizePitch(edit.pitch) }),
    ...(edit.vibrato && { vibrato: normalizeVibrato(edit.vibrato) }),
  };
}

/** ピッチ点を正規化した形で比べる。元データが正規化できない（0 点など）なら、一致しないとみなす */
function samePitch(a: RawNote["pitch"], original: RawNote["pitch"]): boolean {
  try {
    return isDeepStrictEqual(a, normalizePitch(original)) === null;
  } catch {
    return false;
  }
}

/**
 * 差分を正規化し、元データと同じ値の項目を外す。何も残らなければ undefined（＝元データのまま）を返す。
 * 元データのビブラートは読み込み時に OpenUtau と同じ解釈へそろえてあるので、そのまま比べられる。
 */
export function pruneEdit(
  original: Pick<RawNote, "pitch" | "vibrato">,
  edit: NoteEdit,
): NoteEdit | undefined {
  const next = normalizeEdit(edit);
  if (next.pitch && samePitch(next.pitch, original.pitch)) delete next.pitch;
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
