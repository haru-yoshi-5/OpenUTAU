import { create } from "zustand";
import { isDeepStrictEqual } from "../lib/ustx/deep-equal";
import { type EditMap, type NoteEdit, type NoteKey, noteKey, pruneEdit } from "../lib/ustx/edits";
import { UstxError } from "../lib/ustx/errors";
import type { Note, Project } from "../lib/ustx/load";

/** 取り消せる操作の数。古いものから捨てる */
export const HISTORY_LIMIT = 200;

/** 1 つのノートの差分を、どう変えるか。after が undefined なら差分を消して元データに戻す */
export interface EditChange {
  key: NoteKey;
  after: NoteEdit | undefined;
}

interface AppliedChange extends EditChange {
  before: NoteEdit | undefined;
}

/** Undo/Redo の単位。複数ノートへの一括変更も 1 つのコマンドにまとめる */
export interface EditCommand {
  /** 画面に出す操作名（例：「ビブラートをオンにする」） */
  label: string;
  changes: AppliedChange[];
}

/** ノートのキーから、読み込んだときのノートを引く索引 */
type OriginalNotes = ReadonlyMap<NoteKey, Note>;

interface EditState {
  /** 差分の基準になる、読み込んだときのノート。ファイルを読み込んでいなければ null */
  originals: OriginalNotes | null;
  edits: EditMap;
  undoStack: EditCommand[];
  redoStack: EditCommand[];
  /**
   * 差分を変更し、1 回の Undo で戻せる操作として記録する。after にはそのノートの差分全体を渡す。
   * - 値は OpenUtau と同じ範囲に正規化する
   * - 元データと同じ値の項目は差分から外す（どの画面から呼んでも「編集済み」が正しくなるように）
   * - 不正な差分・存在しないノートへの差分は UstxError を投げ、何も変えない
   * 実際に変わるノートが無ければ何も記録しない。
   */
  apply: (label: string, changes: readonly EditChange[]) => void;
  undo: () => void;
  redo: () => void;
  /** ファイルを読み込んだとき（source を渡す）・破棄したとき（null）に、差分と履歴を捨てる */
  reset: (source: Project | null) => void;
}

/**
 * 読み込み時に 1 度だけ索引を作る。変更のたびにパートの全ノートを探すと、
 * 多数のノートへの一括変更（プリセットの適用など）でノート数の 2 乗の時間がかかるため
 */
function indexNotes(source: Project): OriginalNotes {
  const map = new Map<NoteKey, Note>();
  for (const part of source.voiceParts) {
    for (const note of part.notes) map.set(noteKey(part.index, note.index), note);
  }
  return map;
}

function withChanges(
  edits: EditMap,
  changes: readonly AppliedChange[],
  side: "before" | "after",
): EditMap {
  const next = new Map(edits);
  for (const change of changes) {
    const value = change[side];
    if (value) next.set(change.key, value);
    else next.delete(change.key);
  }
  return next;
}

export const useEditStore = create<EditState>()((set, get) => ({
  originals: null,
  edits: new Map(),
  undoStack: [],
  redoStack: [],

  apply: (label, changes) => {
    const { originals, edits, undoStack } = get();
    if (!originals) {
      throw new UstxError("invalid-edit", "編集できるファイルが読み込まれていません。");
    }
    const applied: AppliedChange[] = [];
    for (const { key, after } of changes) {
      const original = originals.get(key);
      if (!original) throw new UstxError("invalid-edit", "編集対象のノートが見つかりません。", key);
      const next = after && pruneEdit(original, after);
      const before = edits.get(key);
      if (isDeepStrictEqual(before, next) === null) continue;
      applied.push({ key, before, after: next });
    }
    if (applied.length === 0) return;
    set({
      edits: withChanges(edits, applied, "after"),
      undoStack: [...undoStack, { label, changes: applied }].slice(-HISTORY_LIMIT),
      redoStack: [],
    });
  },

  undo: () => {
    const { edits, undoStack, redoStack } = get();
    const command = undoStack.at(-1);
    if (!command) return;
    set({
      edits: withChanges(edits, command.changes, "before"),
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, command],
    });
  },

  redo: () => {
    const { edits, undoStack, redoStack } = get();
    const command = redoStack.at(-1);
    if (!command) return;
    set({
      edits: withChanges(edits, command.changes, "after"),
      undoStack: [...undoStack, command],
      redoStack: redoStack.slice(0, -1),
    });
  },

  reset: (source) =>
    set({
      originals: source && indexNotes(source),
      edits: new Map(),
      undoStack: [],
      redoStack: [],
    }),
}));
