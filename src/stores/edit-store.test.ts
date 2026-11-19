import { beforeEach, describe, expect, it } from "vite-plus/test";
import { type NoteEdit, noteKey } from "../lib/ustx/edits";
import { UstxError } from "../lib/ustx/errors";
import type { Vibrato } from "../lib/ustx/types";
import { HISTORY_LIMIT, useEditStore } from "./edit-store";

const store = useEditStore;

const vibrato = (length: number): Vibrato => ({
  length,
  period: 175,
  depth: 25,
  in: 10,
  out: 10,
  shift: 0,
  drift: 0,
  vol_link: 0,
});
const withVibrato = (length: number): NoteEdit => ({ vibrato: vibrato(length) });

const a = noteKey(0, 0);
const b = noteKey(0, 1);

describe("useEditStore", () => {
  beforeEach(() => store.getState().reset());

  it("差分を適用し、Undo で元に戻し、Redo でやり直せる", () => {
    store.getState().apply("ビブラート", [{ key: a, after: withVibrato(75) }]);
    expect(store.getState().edits.get(a)).toEqual(withVibrato(75));

    store.getState().undo();
    expect(store.getState().edits.has(a)).toBe(false);
    expect(store.getState().redoStack).toHaveLength(1);

    store.getState().redo();
    expect(store.getState().edits.get(a)).toEqual(withVibrato(75));
    expect(store.getState().undoStack).toHaveLength(1);
  });

  it("複数ノートへの変更を 1 回の Undo でまとめて戻す", () => {
    store.getState().apply("一括", [
      { key: a, after: withVibrato(50) },
      { key: b, after: withVibrato(60) },
    ]);
    store.getState().undo();
    expect(store.getState().edits.size).toBe(0);
  });

  it("前の差分に重ねた変更を Undo すると、前の差分に戻る", () => {
    store.getState().apply("1 回目", [{ key: a, after: withVibrato(50) }]);
    store.getState().apply("2 回目", [{ key: a, after: withVibrato(80) }]);
    store.getState().undo();
    expect(store.getState().edits.get(a)).toEqual(withVibrato(50));
  });

  it("新しい変更をすると、やり直しの履歴を捨てる", () => {
    store.getState().apply("1 回目", [{ key: a, after: withVibrato(50) }]);
    store.getState().undo();
    store.getState().apply("別の変更", [{ key: b, after: withVibrato(60) }]);
    expect(store.getState().redoStack).toEqual([]);
  });

  it("after が undefined なら差分を消し、それも Undo できる", () => {
    store.getState().apply("設定", [{ key: a, after: withVibrato(50) }]);
    store.getState().apply("元に戻す", [{ key: a, after: undefined }]);
    expect(store.getState().edits.has(a)).toBe(false);
    store.getState().undo();
    expect(store.getState().edits.get(a)).toEqual(withVibrato(50));
  });

  it("値が変わらない変更は履歴に積まない", () => {
    store.getState().apply("設定", [{ key: a, after: withVibrato(50) }]);
    store.getState().apply("同じ値", [{ key: a, after: withVibrato(50) }]);
    store.getState().apply("差分なしを消す", [{ key: b, after: undefined }]);
    expect(store.getState().undoStack).toHaveLength(1);
  });

  it("値を OpenUtau と同じ範囲に正規化して保持する", () => {
    store.getState().apply("範囲外", [{ key: a, after: withVibrato(150) }]);
    expect(store.getState().edits.get(a)?.vibrato?.length).toBe(100);
  });

  it("不正な差分は例外にして、状態を変えない", () => {
    expect(() =>
      store.getState().apply("不正", [
        { key: a, after: withVibrato(50) },
        { key: b, after: { pitch: { snap_first: true, data: [] } } },
      ]),
    ).toThrow(UstxError);
    expect(store.getState().edits.size).toBe(0);
    expect(store.getState().undoStack).toEqual([]);
  });

  it(`履歴は ${HISTORY_LIMIT} 件までで、古いものから捨てる`, () => {
    for (let i = 0; i <= HISTORY_LIMIT; i++) {
      // 直前と必ず異なる値にして、毎回履歴に積まれるようにする
      store.getState().apply(`変更 ${i}`, [{ key: a, after: withVibrato(i % 2 === 0 ? 30 : 40) }]);
    }
    const { undoStack } = store.getState();
    expect(undoStack).toHaveLength(HISTORY_LIMIT);
    expect(undoStack[0].label).toBe("変更 1");
  });

  it("reset で差分と履歴を捨てる", () => {
    store.getState().apply("設定", [{ key: a, after: withVibrato(50) }]);
    store.getState().reset();
    expect(store.getState()).toMatchObject({ undoStack: [], redoStack: [] });
    expect(store.getState().edits.size).toBe(0);
  });
});
