import { create } from "zustand";

/** 選択の仕方。replace は置き換え、add は追加、toggle は選択・解除の切り替え */
export type SelectMode = "replace" | "add" | "toggle";

/** 小節ルーラーで選んだ範囲（パート先頭からの tick、[fromTick, toTick)） */
export interface TickRange {
  fromTick: number;
  toTick: number;
}

interface SelectionState {
  /** 選択しているノートのパート。何も選んでいなければ null */
  partIndex: number | null;
  /** 選択しているノートの Note.index */
  notes: ReadonlySet<number>;
  /** 小節単位で選んだときの範囲（ルーラーの強調表示に使う）。ノートを選び直すと消える */
  barRange: TickRange | null;
  /**
   * ノートを選ぶ。別のパートのノートを選ぶと、前のパートの選択は解除する
   * （プリセットなどの対象は 1 つのパートに限るため）
   */
  select: (partIndex: number, indices: Iterable<number>, mode: SelectMode) => void;
  /** 小節範囲を選ぶ。範囲に掛かるノートを選択に置き換える */
  selectBars: (partIndex: number, range: TickRange, indices: Iterable<number>) => void;
  clear: () => void;
}

const EMPTY: ReadonlySet<number> = new Set();

export const useSelectionStore = create<SelectionState>()((set, get) => ({
  partIndex: null,
  notes: EMPTY,
  barRange: null,

  select: (partIndex, indices, mode) => {
    const current = get().partIndex === partIndex ? get().notes : EMPTY;
    const next = new Set(mode === "replace" ? [] : current);
    for (const index of indices) {
      if (mode === "toggle" && current.has(index)) next.delete(index);
      else next.add(index);
    }
    set({ partIndex: next.size > 0 ? partIndex : null, notes: next, barRange: null });
  },

  selectBars: (partIndex, range, indices) =>
    set({ partIndex, notes: new Set(indices), barRange: range }),

  clear: () => set({ partIndex: null, notes: EMPTY, barRange: null }),
}));

/** 指定したパートで選択しているノート（別のパートを選んでいれば空） */
export const selectedNotesIn = (
  state: Pick<SelectionState, "partIndex" | "notes">,
  partIndex: number,
): ReadonlySet<number> => (state.partIndex === partIndex ? state.notes : EMPTY);
