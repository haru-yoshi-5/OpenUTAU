import { beforeEach, describe, expect, it } from "vite-plus/test";
import { useViewStore, ZOOM } from "./view-store";

const store = useViewStore;
const content = { startTick: -120, endTick: 7680, height: 1000 };

describe("useViewStore", () => {
  beforeEach(() => {
    store.setState({ pxPerTick: ZOOM.default, scrollTick: 0, scrollY: 0 });
    store.getState().setViewport({ width: 600, height: 300 });
    store.getState().resetContent(content, 500);
  });

  it("resetContent はパート先頭へ移動し、指定位置を縦方向の中央に置く", () => {
    const s = store.getState();
    expect(s.scrollTick).toBe(-120);
    expect(s.scrollY).toBe(500 - 150);
  });

  it("スクロールは内容の範囲内に収まる", () => {
    store.getState().scrollBy(-10_000, -10_000);
    expect(store.getState()).toMatchObject({ scrollTick: -120, scrollY: 0 });

    store.getState().scrollBy(1e9, 1e9);
    const s = store.getState();
    // 右端：最後の tick に余白 48px を足した位置が、描画領域の右端に来る
    expect(s.scrollTick).toBeCloseTo(7680 + 48 / ZOOM.default - 600 / ZOOM.default);
    expect(s.scrollY).toBe(1000 - 300);
  });

  it("拡大・縮小しても、基準位置の下にある tick は動かない", () => {
    store.getState().scrollBy(1200, 0);
    const before = store.getState();
    const anchorX = 200;
    const tickAtAnchor = before.scrollTick + anchorX / before.pxPerTick;

    store.getState().zoomBy(ZOOM.step, anchorX);
    const after = store.getState();
    expect(after.pxPerTick).toBeCloseTo(ZOOM.default * ZOOM.step);
    expect(after.scrollTick + anchorX / after.pxPerTick).toBeCloseTo(tickAtAnchor);
  });

  it("拡大率は上限・下限で止まる", () => {
    for (let i = 0; i < 50; i++) store.getState().zoomBy(ZOOM.step);
    expect(store.getState().pxPerTick).toBe(ZOOM.max);
    for (let i = 0; i < 50; i++) store.getState().zoomBy(1 / ZOOM.step);
    expect(store.getState().pxPerTick).toBe(ZOOM.min);
  });

  it("内容が描画領域より小さいときは先頭に固定する", () => {
    store.getState().resetContent({ startTick: 0, endTick: 100, height: 100 }, 0);
    store.getState().scrollBy(500, 500);
    expect(store.getState()).toMatchObject({ scrollTick: 0, scrollY: 0 });
  });
});
