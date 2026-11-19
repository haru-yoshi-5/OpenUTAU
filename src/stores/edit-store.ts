import { create } from "zustand";
import { isDeepStrictEqual } from "../lib/ustx/deep-equal";
import { type EditMap, type NoteEdit, type NoteKey, normalizeEdit } from "../lib/ustx/edits";

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

interface EditState {
  edits: EditMap;
  undoStack: EditCommand[];
  redoStack: EditCommand[];
  /**
   * 差分を変更し、1 回の Undo で戻せる操作として記録する。
   * 値は OpenUtau と同じ範囲に正規化する（不正な差分は UstxError を投げ、何も変えない）。
   * 実際に変わるノートが無ければ何も記録しない。
   */
  apply: (label: string, changes: readonly EditChange[]) => void;
  undo: () => void;
  redo: () => void;
  /** ファイルを読み込み直したとき・破棄したときに、差分と履歴を捨てる */
  reset: () => void;
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
  edits: new Map(),
  undoStack: [],
  redoStack: [],

  apply: (label, changes) => {
    const { edits, undoStack } = get();
    const applied: AppliedChange[] = [];
    for (const { key, after } of changes) {
      const normalized = after && normalizeEdit(after);
      const empty = !normalized || (!normalized.pitch && !normalized.vibrato);
      const next = empty ? undefined : normalized;
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

  reset: () => set({ edits: new Map(), undoStack: [], redoStack: [] }),
}));
