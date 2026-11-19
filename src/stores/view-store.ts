import { create } from "zustand";

/** 横方向の拡大率（1 tick あたりの px）の範囲 */
export const ZOOM = {
  min: 0.02,
  max: 0.6,
  default: 0.12,
  /** ボタン・ホイール 1 段階あたりの倍率 */
  step: 1.25,
} as const;

/** スクロールできる範囲を決める、表示中パートの大きさ */
export interface ContentBounds {
  /** 表示を始められる最小の tick（パート先頭からの相対値。ピッチの助走のため負になりうる） */
  startTick: number;
  /** 表示を終えられる最大の tick */
  endTick: number;
  /** 音高方向の全体の高さ（px） */
  height: number;
}

export interface ViewportSize {
  /** ノートを描く領域の幅（鍵盤を除く、px） */
  width: number;
  /** ノートを描く領域の高さ（ルーラーを除く、px） */
  height: number;
}

interface ViewState {
  pxPerTick: number;
  /** 描画領域の左端にある tick */
  scrollTick: number;
  /** 描画領域の上端の、音高方向の位置（px） */
  scrollY: number;
  showPitch: boolean;
  viewport: ViewportSize;
  content: ContentBounds;

  setViewport: (size: ViewportSize) => void;
  /** パートを切り替えたときに表示範囲を設定し直す。focusY は縦方向の中央に置きたい位置（px） */
  resetContent: (content: ContentBounds, focusY: number) => void;
  /** anchorX（描画領域内の px）の下にある tick を固定したまま拡大・縮小する */
  zoomBy: (factor: number, anchorX?: number) => void;
  /** px 単位でスクロールする */
  scrollBy: (dx: number, dy: number) => void;
  setShowPitch: (show: boolean) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 右端・下端の余白（px） */
const END_MARGIN_PX = 48;

export function clampScroll(
  state: Pick<ViewState, "pxPerTick" | "viewport" | "content">,
  scrollTick: number,
  scrollY: number,
): { scrollTick: number; scrollY: number } {
  const { pxPerTick, viewport, content } = state;
  const visibleTicks = viewport.width / pxPerTick;
  const maxTick = Math.max(
    content.startTick,
    content.endTick + END_MARGIN_PX / pxPerTick - visibleTicks,
  );
  const maxY = Math.max(0, content.height - viewport.height);
  return {
    scrollTick: clamp(scrollTick, content.startTick, maxTick),
    scrollY: clamp(scrollY, 0, maxY),
  };
}

export const useViewStore = create<ViewState>()((set) => ({
  pxPerTick: ZOOM.default,
  scrollTick: 0,
  scrollY: 0,
  showPitch: true,
  viewport: { width: 0, height: 0 },
  content: { startTick: 0, endTick: 0, height: 0 },

  setViewport: (viewport) =>
    set((s) => {
      if (s.viewport.width === viewport.width && s.viewport.height === viewport.height) return s;
      return { viewport, ...clampScroll({ ...s, viewport }, s.scrollTick, s.scrollY) };
    }),

  resetContent: (content, focusY) =>
    set((s) => ({
      content,
      ...clampScroll({ ...s, content }, content.startTick, focusY - s.viewport.height / 2),
    })),

  zoomBy: (factor, anchorX) =>
    set((s) => {
      const pxPerTick = clamp(s.pxPerTick * factor, ZOOM.min, ZOOM.max);
      if (pxPerTick === s.pxPerTick) return s;
      const anchor = anchorX ?? s.viewport.width / 2;
      const anchorTick = s.scrollTick + anchor / s.pxPerTick;
      return {
        pxPerTick,
        ...clampScroll({ ...s, pxPerTick }, anchorTick - anchor / pxPerTick, s.scrollY),
      };
    }),

  scrollBy: (dx, dy) => set((s) => clampScroll(s, s.scrollTick + dx / s.pxPerTick, s.scrollY + dy)),

  setShowPitch: (showPitch) => set({ showPitch }),
}));
