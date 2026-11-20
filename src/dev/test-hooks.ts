import type { NoteEdit, NoteKey } from "../lib/ustx/edits";
import { useEditStore } from "../stores/edit-store";

/**
 * E2E テスト用の入口。開発ビルド（vp dev）でだけ読み込み、本番ビルドには含めない（main.tsx を参照）。
 * テストがストアの内部の形に直接触れないよう、必要な操作をここに閉じ込める。
 */
export interface KoebitTestHooks {
  /**
   * 表示で例外になる壊れた差分を、取り消せる操作として 1 つ加える。
   * 描画エラー時の代替画面（RenderErrorBoundary）を確かめるために使う。
   */
  injectBrokenEdit: (key: NoteKey) => void;
}

declare global {
  interface Window {
    __koebitTest?: KoebitTestHooks;
  }
}

export function installTestHooks() {
  window.__koebitTest = {
    injectBrokenEdit: (key) => {
      // ピッチ点の配列が null のノートは、ピッチ計算で例外になる。apply は正規化で弾くため直接入れる
      const broken = { pitch: { data: null, snap_first: true } } as unknown as NoteEdit;
      const { edits, undoStack } = useEditStore.getState();
      useEditStore.setState({
        edits: new Map([...edits, [key, broken]]),
        undoStack: [
          ...undoStack,
          {
            label: "壊れた編集（テスト用）",
            changes: [{ key, before: edits.get(key), after: broken }],
          },
        ],
        redoStack: [],
      });
    },
  };
}
