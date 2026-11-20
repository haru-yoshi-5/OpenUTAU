import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { type NoteEdit, noteKey } from "../lib/ustx/edits";
import { UstxError } from "../lib/ustx/errors";
import { loadUstx } from "../lib/ustx/load";
import type { Vibrato } from "../lib/ustx/types";
import { HISTORY_LIMIT, useEditStore } from "./edit-store";

const store = useEditStore;
// デモの先頭 2 ノート（0:0・0:1）は、ビブラートの長さが 0 で、ほかは既定値
const source = loadUstx(
  "demo.ustx",
  new Uint8Array(readFileSync(join(process.cwd(), "public/samples/demo.ustx"))),
).project;

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
  beforeEach(() => store.getState().reset(source));

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
    store.getState().reset(source);
    expect(store.getState()).toMatchObject({ undoStack: [], redoStack: [] });
    expect(store.getState().edits.size).toBe(0);
  });
});

describe("useEditStore：元データとの比較", () => {
  beforeEach(() => store.getState().reset(source));

  it("元データと同じ値に戻す変更は、差分を消す操作として記録する", () => {
    store.getState().apply("オン", [{ key: a, after: withVibrato(75) }]);
    // デモの先頭ノートは元々 length: 0
    store.getState().apply("オフ", [{ key: a, after: withVibrato(0) }]);
    expect(store.getState().edits.has(a)).toBe(false);
    expect(store.getState().undoStack).toHaveLength(2);
  });

  it("元データと同じ値だけの変更は、何も記録しない", () => {
    store.getState().apply("同じ値", [{ key: a, after: withVibrato(0) }]);
    expect(store.getState().undoStack).toEqual([]);
  });

  it("存在しないノートへの変更は例外にして、状態を変えない", () => {
    expect(() =>
      store.getState().apply("不明", [{ key: noteKey(0, 999), after: withVibrato(75) }]),
    ).toThrow(UstxError);
    expect(store.getState().edits.size).toBe(0);
  });

  it("ファイルを読み込んでいないときは編集できない", () => {
    store.getState().reset(null);
    expect(() => store.getState().apply("設定", [{ key: a, after: withVibrato(75) }])).toThrow(
      UstxError,
    );
  });
});
