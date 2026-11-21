import {
  drawingOrigin,
  KEY_WIDTH,
  ROW_HEIGHT,
  RULER_HEIGHT,
  tickToX,
  toneToY,
} from "../features/piano-roll/geometry";
import type { NoteEdit, NoteKey } from "../lib/ustx/edits";
import { useEditStore } from "../stores/edit-store";
import { useProjectStore } from "../stores/project-store";
import { useViewStore } from "../stores/view-store";

/**
 * E2E テスト用の入口。開発ビルド（vp dev）でだけ読み込み、本番ビルドには含めない（main.tsx を参照）。
 * テストがストアの内部の形や座標の計算に直接触れないよう、必要な操作をここに閉じ込める。
 */
export interface KoebitTestHooks {
  /**
   * 表示で例外になる壊れた差分を、取り消せる操作として 1 つ加える。
   * 描画エラー時の代替画面（RenderErrorBoundary）を確かめるために使う。
   */
  injectBrokenEdit: (key: NoteKey) => void;
  /** 表示中のパートのノート（Note.index）の中心の、画面上の座標（clientX / clientY） */
  noteCenter: (noteIndex: number) => { x: number; y: number };
  /** 表示中のパート先頭からの tick の、小節ルーラー上の画面座標 */
  rulerPoint: (tick: number) => { x: number; y: number };
}

declare global {
  interface Window {
    __koebitTest?: KoebitTestHooks;
  }
}

function rollContext() {
  const el = document.querySelector('[aria-roledescription="ピアノロール"]');
  const { load, partIndex } = useProjectStore.getState();
  if (!el || load.status !== "loaded") throw new Error("ピアノロールが表示されていません");
  const { pxPerTick, scrollTick, scrollY } = useViewStore.getState();
  return {
    box: drawingOrigin(el),
    part: load.loaded.project.voiceParts[partIndex],
    cam: { pxPerTick, scrollTick, scrollY },
  };
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

    noteCenter: (noteIndex) => {
      const { box, part, cam } = rollContext();
      const note = part.notes.find((n) => n.index === noteIndex);
      if (!note) throw new Error(`ノート ${noteIndex} がありません`);
      return {
        x: box.left + KEY_WIDTH + tickToX(note.position + note.duration / 2, cam),
        y: box.top + RULER_HEIGHT + toneToY(note.tone, cam) + ROW_HEIGHT / 2,
      };
    },

    rulerPoint: (tick) => {
      const { box, cam } = rollContext();
      return { x: box.left + KEY_WIDTH + tickToX(tick, cam), y: box.top + RULER_HEIGHT / 2 };
    },
  };
}
