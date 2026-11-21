import { type PointerEvent, type RefObject, useEffect, useRef, useState } from "react";
import type { Bar } from "../../lib/ustx/bars";
import type { VoicePart } from "../../lib/ustx/load";
import { type SelectMode, useSelectionStore } from "../../stores/selection-store";
import { type Camera, KEY_WIDTH, RULER_HEIGHT } from "./geometry";
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
  | { kind: "marquee"; id: number; x0: number; y0: number; mode: SelectMode }
  | { kind: "bars"; id: number; startBar: number };

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

export function useRollGestures({ containerRef, part, bars, maxDuration, cam, scrollBy }: Options) {
  const gesture = useRef<Gesture | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const { select, selectBars } = useSelectionStore.getState();

  // Space を押している間は、左ドラッグを表示の移動にする
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || isTextInput(e.target)) return;
      setSpaceHeld(e.type === "keydown");
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
  }, []);

  /** 描画領域（鍵盤・ルーラーを除く）の左上を原点とした座標 */
  const localPoint = (e: PointerEvent) => {
    const box = containerRef.current?.getBoundingClientRect();
    return {
      x: e.clientX - (box?.left ?? 0) - KEY_WIDTH,
      y: e.clientY - (box?.top ?? 0) - RULER_HEIGHT,
    };
  };

  const selectBarsTo = (startBar: number, x: number) => {
    const endBar = barIndexAt(bars, part.position, xToTick(x, cam));
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
      start(e, { kind: "bars", id, startBar });
      selectBarsTo(startBar, x);
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
    start(e, { kind: "marquee", id, x0: x, y0: y, mode: additive ? "add" : "replace" });
    setMarquee({ x0: x, y0: y, x1: x, y1: y });
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
        setMarquee({ x0: g.x0, y0: g.y0, x1: x, y1: y });
        break;
      }
      case "bars":
        selectBarsTo(g.startBar, localPoint(e).x);
        break;
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
      const rect = { x0: g.x0, y0: g.y0, x1: x, y1: y };
      const isClick = Math.hypot(x - g.x0, y - g.y0) <= DRAG_THRESHOLD;
      // 何もない所をクリックしたら選択を解除する（追加のときはそのまま）
      if (isClick) {
        if (g.mode === "replace") select(part.index, [], "replace");
      } else {
        select(part.index, notesInRect(part.notes, maxDuration, rect, cam), g.mode);
      }
    }
  };

  return {
    marquee,
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
