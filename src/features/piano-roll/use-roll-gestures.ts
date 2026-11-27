import { type PointerEvent, type RefObject, useEffect, useRef, useState } from "react";
import type { Bar } from "../../lib/ustx/bars";
import type { VoicePart } from "../../lib/ustx/load";
import { type SelectMode, useSelectionStore } from "../../stores/selection-store";
import { type Camera, drawingOrigin, KEY_WIDTH, RULER_HEIGHT, tickToX } from "./geometry";
import {
  barIndexAt,
  barSpanTicks,
  noteAt,
  notesInRect,
  notesInTickRange,
  type Rect,
  xToTick,
} from "./hit-test";

/*
 * ピアノロールのポインタ操作。表示の移動と選択がぶつからないよう、次のように割り当てる。
 * - マウス：ノートをクリックで選択（Shift / Ctrl / ⌘ で追加・解除）、何もない所のドラッグで矩形選択、
 *   中ボタンのドラッグか Space を押しながらのドラッグで表示の移動
 * - タッチ：1 本指のドラッグで表示の移動、タップでノートを選択（何もない所のタップで解除）
 * - 小節ルーラー：ドラッグで小節単位の範囲を選択（マウス・タッチとも）
 */

/** これ以上動いたら、タップ・クリックではなくドラッグとみなす（px） */
const DRAG_THRESHOLD = 4;

type Gesture =
  | { kind: "pan"; id: number; x: number; y: number }
  | {
      kind: "touch";
      id: number;
      x: number;
      y: number;
      startX: number;
      startY: number;
      moved: boolean;
    }
  | { kind: "marquee"; id: number; mode: SelectMode; anchorTick: number; anchorContentY: number }
  | { kind: "bars"; id: number; startBar: number; endBar: number };

/**
 * 矩形選択の状態。始点は内容の座標（tick と、スクロール 0 のときの y）で持ち、
 * ドラッグ中にホイールでスクロールしても、最初に押した場所から囲めるようにする。
 * 終点は今のポインタの位置（描画領域内の px）
 */
interface Marquee {
  anchorTick: number;
  anchorContentY: number;
  x: number;
  y: number;
}

interface Options {
  containerRef: RefObject<HTMLElement | null>;
  part: VoicePart;
  /** プロジェクト全体の小節（絶対 tick） */
  bars: readonly Bar[];
  maxDuration: number;
  cam: Camera;
  scrollBy: (dx: number, dy: number) => void;
}

const isTextInput = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && !["checkbox", "radio", "button"].includes(target.type)));

/** ピアノロールの外にある、Space で操作するフォーム部品（ボタン・チェックボックス・選択欄など） */
const isOutsideControl = (target: EventTarget | null, roll: HTMLElement | null) =>
  target instanceof Element &&
  target.closest("button, select, input, summary, [role='button']") !== null &&
  !roll?.contains(target);

export function useRollGestures({ containerRef, part, bars, maxDuration, cam, scrollBy }: Options) {
  const gesture = useRef<Gesture | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const { select, selectBars } = useSelectionStore.getState();

  // Space を押している間は、左ドラッグを表示の移動にする
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      if (e.type === "keyup") {
        setSpaceHeld(false);
        return;
      }
      // 文字の入力欄と、ピアノロールの外のボタン・チェックボックス・選択欄では、Space はその部品の操作に使う
      if (isTextInput(e.target) || isOutsideControl(e.target, containerRef.current)) return;
      setSpaceHeld(true);
    };
    const onBlur = () => setSpaceHeld(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [containerRef]);

  /** 描画領域（鍵盤・ルーラーを除く）の左上を原点とした座標 */
  const localPoint = (e: PointerEvent) => {
    const origin = containerRef.current ? drawingOrigin(containerRef.current) : { left: 0, top: 0 };
    return {
      x: e.clientX - origin.left - KEY_WIDTH,
      y: e.clientY - origin.top - RULER_HEIGHT,
    };
  };

  /** 矩形選択の、今のカメラでの矩形（描画領域内の px） */
  const marqueeRect = (m: Marquee): Rect => ({
    x0: tickToX(m.anchorTick, cam),
    y0: m.anchorContentY - cam.scrollY,
    x1: m.x,
    y1: m.y,
  });

  const selectBarsTo = (startBar: number, endBar: number) => {
    const range = barSpanTicks(bars, part.position, startBar, endBar);
    selectBars(
      part.index,
      range,
      notesInTickRange(part.notes, maxDuration, range.fromTick, range.toTick),
    );
  };

  const selectAt = (x: number, y: number, mode: SelectMode) => {
    const hit = noteAt(part.notes, maxDuration, x, y, cam);
    if (hit) select(part.index, [hit.index], mode);
    else if (mode === "replace") select(part.index, [], "replace");
  };

  const start = (e: PointerEvent, next: Gesture) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = next;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (gesture.current) return;
    const { x, y } = localPoint(e);
    const id = e.pointerId;
    const isTouch = e.pointerType === "touch";

    // 小節ルーラー：小節単位の範囲選択
    if (y < 0 && x >= 0 && (isTouch || e.button === 0)) {
      const startBar = barIndexAt(bars, part.position, xToTick(x, cam));
      start(e, { kind: "bars", id, startBar, endBar: startBar });
      selectBarsTo(startBar, startBar);
      return;
    }
    // 鍵盤の上では何もしない
    if (x < 0 || y < 0) return;

    if (isTouch) {
      start(e, {
        kind: "touch",
        id,
        x: e.clientX,
        y: e.clientY,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      });
      return;
    }
    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      e.preventDefault();
      start(e, { kind: "pan", id, x: e.clientX, y: e.clientY });
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;

    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const hit = noteAt(part.notes, maxDuration, x, y, cam);
    if (hit) {
      select(part.index, [hit.index], additive ? "toggle" : "replace");
      return;
    }
    // 始点は操作の状態（gesture）に持ち、指を離したときの判定はそちらを使う。
    // state（marquee）は描画のためだけに使い、描画の反映の順序に判定が左右されないようにする
    const anchor = { anchorTick: xToTick(x, cam), anchorContentY: y + cam.scrollY };
    start(e, { kind: "marquee", id, mode: additive ? "add" : "replace", ...anchor });
    setMarquee({ ...anchor, x, y });
  };

  const onPointerMove = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    switch (g.kind) {
      case "pan":
        scrollBy(g.x - e.clientX, g.y - e.clientY);
        gesture.current = { ...g, x: e.clientX, y: e.clientY };
        break;
      case "touch": {
        const moved =
          g.moved || Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > DRAG_THRESHOLD;
        if (moved) scrollBy(g.x - e.clientX, g.y - e.clientY);
        gesture.current = { ...g, x: e.clientX, y: e.clientY, moved };
        break;
      }
      case "marquee": {
        const { x, y } = localPoint(e);
        setMarquee((m) => m && { ...m, x, y });
        break;
      }
      case "bars": {
        // 同じ小節の上で動いている間は、選択を作り直さない
        const endBar = barIndexAt(bars, part.position, xToTick(localPoint(e).x, cam));
        if (endBar === g.endBar) break;
        gesture.current = { ...g, endBar };
        selectBarsTo(g.startBar, endBar);
        break;
      }
    }
  };

  const finish = (e: PointerEvent, cancelled: boolean) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    setPanning(false);
    setMarquee(null);
    if (cancelled) return;
    const { x, y } = localPoint(e);
    if (g.kind === "touch" && !g.moved) {
      selectAt(x, y, "replace");
    } else if (g.kind === "marquee") {
      const rect = marqueeRect({
        anchorTick: g.anchorTick,
        anchorContentY: g.anchorContentY,
        x,
        y,
      });
      const isClick = Math.hypot(x - rect.x0, y - rect.y0) <= DRAG_THRESHOLD;
      // 何もない所をクリックしたら選択を解除する（追加のときはそのまま）
      if (isClick) {
        if (g.mode === "replace") select(part.index, [], "replace");
      } else {
        select(part.index, notesInRect(part.notes, maxDuration, rect, cam), g.mode);
      }
    }
  };

  return {
    marquee: marquee && marqueeRect(marquee),
    /** 表示の移動中か、Space を押していて移動できる状態か（カーソルの形に使う） */
    panMode: panning || spaceHeld,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e: PointerEvent) => finish(e, false),
      onPointerCancel: (e: PointerEvent) => finish(e, true),
    },
  };
}
