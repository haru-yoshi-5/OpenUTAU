import { Minus, Plus } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import { Group, Layer, Line, Rect, Stage, Text } from "react-konva";
import { useShallow } from "zustand/react/shallow";
import { Button } from "../../components/ui/button";
import { isBlackKey, toneName } from "../../lib/music";
import type { Bar } from "../../lib/ustx/bars";
import type { VoicePart } from "../../lib/ustx/load";
import type { PitchCurve } from "../../lib/ustx/pitch";
import type { Tempo } from "../../lib/ustx/types";
import { useViewStore, ZOOM } from "../../stores/view-store";
import {
  type Camera,
  contentBoundsOf,
  focusYOf,
  gridLines,
  KEY_WIDTH,
  pitchPolylines,
  ROW_HEIGHT,
  RULER_HEIGHT,
  tickToX,
  toneToY,
  visibleNotes,
  visibleToneRange,
} from "./geometry";
import { useRollTheme } from "./theme";

const FONT = 'system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif';
/** ホイールの deltaMode が行単位のときの 1 行あたりの px */
const LINE_PX = 16;

interface PianoRollProps {
  part: VoicePart;
  /** プロジェクト全体の小節（絶対 tick） */
  bars: readonly Bar[];
  tempos: readonly Tempo[];
  pitch: PitchCurve | null;
}

export function PianoRoll({ part, bars, tempos, pitch }: PianoRollProps) {
  const containerRef = useRef<HTMLElement>(null);
  const helpId = useId();
  const theme = useRollTheme();
  const { pxPerTick, scrollTick, scrollY, showPitch, viewport } = useViewStore(
    useShallow((s) => ({
      pxPerTick: s.pxPerTick,
      scrollTick: s.scrollTick,
      scrollY: s.scrollY,
      showPitch: s.showPitch,
      viewport: s.viewport,
    })),
  );
  const { setViewport, resetContent, zoomBy, scrollBy, setShowPitch } = useViewStore.getState();

  // 描画領域の大きさを、コンテナの大きさに追従させる
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = (width: number, height: number) =>
      setViewport({
        width: Math.max(0, Math.floor(width) - KEY_WIDTH),
        height: Math.max(0, Math.floor(height) - RULER_HEIGHT),
      });
    apply(el.clientWidth, el.clientHeight);
    const observer = new ResizeObserver(([entry]) => {
      apply(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [setViewport]);

  // パートを切り替えたら先頭へ戻り、ノートが集まる音域を縦方向の中央に置く
  useLayoutEffect(() => {
    resetContent(contentBoundsOf(part, pitch), focusYOf(part.notes));
  }, [part, pitch, resetContent]);

  // ホイール：スクロール。Ctrl / ⌘ を押しながらで拡大・縮小（ページのスクロールを止めるため passive: false）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_PX : 1;
      if (e.ctrlKey || e.metaKey) {
        const anchorX = e.clientX - el.getBoundingClientRect().left - KEY_WIDTH;
        zoomBy(e.deltaY < 0 ? ZOOM.step : 1 / ZOOM.step, Math.max(0, anchorX));
      } else if (e.shiftKey) {
        scrollBy((e.deltaY || e.deltaX) * unit, 0);
      } else {
        scrollBy(e.deltaX * unit, e.deltaY * unit);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy, scrollBy]);

  // ドラッグで表示位置を動かす（タッチ操作にも対応）
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  const onKeyDown = (e: KeyboardEvent) => {
    const actions: Record<string, () => void> = {
      ArrowLeft: () => scrollBy(-80, 0),
      ArrowRight: () => scrollBy(80, 0),
      ArrowUp: () => scrollBy(0, -ROW_HEIGHT * 3),
      ArrowDown: () => scrollBy(0, ROW_HEIGHT * 3),
      "+": () => zoomBy(ZOOM.step),
      "=": () => zoomBy(ZOOM.step),
      "-": () => zoomBy(1 / ZOOM.step),
      Home: () => scrollBy(-Number.MAX_SAFE_INTEGER, 0),
      End: () => scrollBy(Number.MAX_SAFE_INTEGER, 0),
    };
    const action = actions[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  };

  const cam: Camera = { pxPerTick, scrollTick, scrollY };
  const { width, height } = viewport;
  const fromTick = scrollTick;
  const toTick = scrollTick + width / pxPerTick;

  const maxDuration = useMemo(
    () => part.notes.reduce((max, n) => Math.max(max, n.duration), 0),
    [part.notes],
  );
  const toneRange = visibleToneRange(cam, height);
  const tones = Array.from(
    { length: Math.max(0, toneRange.high - toneRange.low + 1) },
    (_, i) => toneRange.high - i,
  );
  const lines = gridLines(bars, part.position, fromTick, toTick);
  const notes = visibleNotes(part.notes, maxDuration, fromTick, toTick);
  const pitchLines = showPitch && pitch ? pitchPolylines(pitch, cam, fromTick, toTick) : [];
  const tempoMarks = tempos
    .map((t) => ({ ...t, rel: t.position - part.position }))
    .filter((t) => t.rel >= fromTick - 2000 && t.rel <= toTick);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <fieldset className="flex items-center gap-1">
          <legend className="sr-only">横方向の拡大・縮小</legend>
          <Button
            variant="outline"
            size="icon"
            onClick={() => zoomBy(1 / ZOOM.step)}
            disabled={pxPerTick <= ZOOM.min}
            aria-label="縮小"
          >
            <Minus aria-hidden />
          </Button>
          <output className="w-14 text-center text-xs text-muted-foreground tabular-nums">
            {Math.round((pxPerTick / ZOOM.default) * 100)}%
          </output>
          <Button
            variant="outline"
            size="icon"
            onClick={() => zoomBy(ZOOM.step)}
            disabled={pxPerTick >= ZOOM.max}
            aria-label="拡大"
          >
            <Plus aria-hidden />
          </Button>
        </fieldset>
        <label className="flex cursor-pointer items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="size-4"
            style={{ accentColor: theme.pitchLine }}
            checked={showPitch}
            onChange={(e) => setShowPitch(e.target.checked)}
          />
          ピッチカーブを表示
        </label>
        <ul className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground sm:ml-auto">
          <li className="flex items-center gap-1">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-4 rounded-sm border"
              style={{ background: theme.note, borderColor: theme.noteBorder }}
            />
            ノート
          </li>
          <li className="flex items-center gap-1">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-4"
              style={{ background: theme.pitchLine }}
            />
            ピッチ（OpenUtau の計算を近似）
          </li>
        </ul>
      </div>

      {/* キーボードとポインタで操作する独自のウィジェットのため application ロールを使う */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- 矢印キー・ドラッグでの移動に必要 */}
      <section
        ref={containerRef}
        role="application"
        aria-roledescription="ピアノロール"
        aria-label={`パート「${part.name}」、ノート ${part.notes.length} 個`}
        aria-describedby={helpId}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- キーボードで操作できるようフォーカスを受け取る
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          scrollBy(d.x - e.clientX, d.y - e.clientY);
          drag.current = { id: d.id, x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        className="relative h-[60vh] min-h-72 cursor-grab touch-none overflow-hidden rounded-lg border select-none active:cursor-grabbing"
        style={{ background: theme.background }}
      >
        <div aria-hidden="true">
          <Stage width={width + KEY_WIDTH} height={height + RULER_HEIGHT} listening={false}>
            <Layer listening={false}>
              {/* ノート・グリッド・ピッチ */}
              <Group
                x={KEY_WIDTH}
                y={RULER_HEIGHT}
                clipX={0}
                clipY={0}
                clipWidth={width}
                clipHeight={height}
              >
                {tones.map((tone) => {
                  const y = toneToY(tone, cam);
                  return (
                    <Group key={tone}>
                      {isBlackKey(tone) && (
                        <Rect
                          x={0}
                          y={y}
                          width={width}
                          height={ROW_HEIGHT}
                          fill={theme.blackKeyRow}
                          perfectDrawEnabled={false}
                        />
                      )}
                      <Line
                        points={[0, y + ROW_HEIGHT, width, y + ROW_HEIGHT]}
                        stroke={tone % 12 === 0 ? theme.octaveLine : theme.grid}
                        strokeWidth={tone % 12 === 0 ? 1 : 0.5}
                        perfectDrawEnabled={false}
                      />
                    </Group>
                  );
                })}
                {lines.map((line) => {
                  const x = Math.round(tickToX(line.tick, cam)) + 0.5;
                  return (
                    <Line
                      key={line.key}
                      points={[x, 0, x, height]}
                      stroke={line.kind === "bar" ? theme.barLine : theme.grid}
                      strokeWidth={line.kind === "bar" ? 1 : 0.75}
                      perfectDrawEnabled={false}
                    />
                  );
                })}
                {notes.map((note) => {
                  const x = tickToX(note.position, cam);
                  const w = Math.max(2, note.duration * pxPerTick - 1);
                  const y = toneToY(note.tone, cam);
                  return (
                    <Group key={note.index}>
                      <Rect
                        x={x}
                        y={y + 1}
                        width={w}
                        height={ROW_HEIGHT - 2}
                        cornerRadius={2}
                        fill={theme.note}
                        stroke={theme.noteBorder}
                        strokeWidth={1}
                        perfectDrawEnabled={false}
                      />
                      {w > 14 && (
                        <Text
                          x={x + 3}
                          y={y + 2}
                          width={w - 5}
                          height={ROW_HEIGHT - 3}
                          text={note.lyric}
                          fontSize={10}
                          fontFamily={FONT}
                          fill={theme.noteText}
                          verticalAlign="middle"
                          wrap="none"
                          ellipsis
                          perfectDrawEnabled={false}
                        />
                      )}
                    </Group>
                  );
                })}
                {pitchLines.map((points, i) => (
                  <Line
                    // oxlint-disable-next-line react/no-array-index-key -- 区間は描画ごとに作り直すため順序で識別する
                    key={i}
                    points={points}
                    stroke={theme.pitchLine}
                    strokeWidth={1.5}
                    lineJoin="round"
                    lineCap="round"
                    perfectDrawEnabled={false}
                  />
                ))}
              </Group>

              {/* 小節ルーラー */}
              <Group
                x={KEY_WIDTH}
                y={0}
                clipX={0}
                clipY={0}
                clipWidth={width}
                clipHeight={RULER_HEIGHT}
              >
                <Rect width={width} height={RULER_HEIGHT} fill={theme.rulerBackground} />
                {lines
                  .filter((line) => line.kind === "bar")
                  .map((line) => {
                    const x = Math.round(tickToX(line.tick, cam)) + 0.5;
                    return (
                      <Group key={line.key}>
                        <Line
                          points={[x, RULER_HEIGHT - 9, x, RULER_HEIGHT]}
                          stroke={theme.barLine}
                          strokeWidth={1}
                        />
                        <Text
                          x={x + 3}
                          y={3}
                          text={String(line.barNumber)}
                          fontSize={10}
                          fontFamily={FONT}
                          fill={theme.rulerText}
                        />
                      </Group>
                    );
                  })}
                {tempoMarks.map((t) => (
                  <Text
                    key={t.position}
                    x={tickToX(t.rel, cam) + 3}
                    y={15}
                    text={`♩=${Number(t.bpm.toFixed(2))}`}
                    fontSize={10}
                    fontStyle="bold"
                    fontFamily={FONT}
                    fill={theme.tempoText}
                  />
                ))}
                <Line
                  points={[0, RULER_HEIGHT - 0.5, width, RULER_HEIGHT - 0.5]}
                  stroke={theme.keyBorder}
                  strokeWidth={1}
                />
              </Group>

              {/* 鍵盤 */}
              <Group
                x={0}
                y={RULER_HEIGHT}
                clipX={0}
                clipY={0}
                clipWidth={KEY_WIDTH}
                clipHeight={height}
              >
                <Rect width={KEY_WIDTH} height={height} fill={theme.whiteKey} />
                {tones.map((tone) => {
                  const y = toneToY(tone, cam);
                  const black = isBlackKey(tone);
                  return (
                    <Group key={tone}>
                      <Rect
                        x={0}
                        y={y}
                        width={black ? KEY_WIDTH * 0.62 : KEY_WIDTH}
                        height={ROW_HEIGHT}
                        fill={black ? theme.blackKey : theme.whiteKey}
                        stroke={black ? undefined : theme.keyBorder}
                        strokeWidth={0.5}
                        perfectDrawEnabled={false}
                      />
                      {tone % 12 === 0 && (
                        <Text
                          x={0}
                          y={y + 2}
                          width={KEY_WIDTH - 4}
                          text={toneName(tone)}
                          align="right"
                          fontSize={9}
                          fontFamily={FONT}
                          fill={theme.keyText}
                        />
                      )}
                    </Group>
                  );
                })}
                <Line
                  points={[KEY_WIDTH - 0.5, 0, KEY_WIDTH - 0.5, height]}
                  stroke={theme.keyBorder}
                  strokeWidth={1}
                />
              </Group>

              {/* 左上の角 */}
              <Rect width={KEY_WIDTH} height={RULER_HEIGHT} fill={theme.rulerBackground} />
            </Layer>
          </Stage>
        </div>
      </section>
      <p id={helpId} className="text-xs text-muted-foreground">
        ドラッグまたはホイールで移動、Ctrl（⌘）＋ホイールで拡大・縮小できます。フォーカス中は矢印キーで移動、＋／－キーで拡大・縮小、Home／End
        キーで先頭・末尾へ移動します。
      </p>
    </div>
  );
}
