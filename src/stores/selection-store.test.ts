import { beforeEach, describe, expect, it } from "vite-plus/test";
import { selectedNotesIn, useSelectionStore } from "./selection-store";

const store = useSelectionStore;
const notesOf = () => [...store.getState().notes].sort((a, b) => a - b);

describe("useSelectionStore", () => {
  beforeEach(() => store.getState().clear());

  it("replace は選択を置き換え、add は追加し、toggle は選択・解除を切り替える", () => {
    store.getState().select(0, [1, 2], "replace");
    expect(notesOf()).toEqual([1, 2]);
    store.getState().select(0, [3], "add");
    expect(notesOf()).toEqual([1, 2, 3]);
    store.getState().select(0, [2, 4], "toggle");
    expect(notesOf()).toEqual([1, 3, 4]);
    store.getState().select(0, [5], "replace");
    expect(notesOf()).toEqual([5]);
  });

  it("別のパートのノートを選ぶと、前のパートの選択は解除する", () => {
    store.getState().select(0, [1, 2], "replace");
    store.getState().select(1, [7], "add");
    expect(store.getState().partIndex).toBe(1);
    expect(notesOf()).toEqual([7]);
    expect(selectedNotesIn(store.getState(), 0).size).toBe(0);
  });

  it("すべて解除すると、パートも未選択に戻る", () => {
    store.getState().select(0, [1], "replace");
    store.getState().select(0, [1], "toggle");
    expect(store.getState().partIndex).toBeNull();
  });

  it("小節範囲を選ぶと範囲を覚え、ノートを選び直すと範囲は消える", () => {
    store.getState().selectBars(0, { fromTick: 0, toTick: 1920 }, [0, 1]);
    expect(store.getState().barRange).toEqual({ fromTick: 0, toTick: 1920 });
    expect(notesOf()).toEqual([0, 1]);
    store.getState().select(0, [3], "add");
    expect(store.getState().barRange).toBeNull();
  });

  it("ノートが無い小節範囲も、範囲として選べる", () => {
    store.getState().selectBars(0, { fromTick: 0, toTick: 1920 }, []);
    expect(store.getState().partIndex).toBe(0);
    expect(store.getState().barRange).not.toBeNull();
  });

  it("clear で何も選んでいない状態に戻る", () => {
    store.getState().selectBars(0, { fromTick: 0, toTick: 1920 }, [0]);
    store.getState().clear();
    expect(store.getState()).toMatchObject({ partIndex: null, barRange: null });
    expect(store.getState().notes.size).toBe(0);
  });
});
