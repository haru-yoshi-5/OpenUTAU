"use client";

import { Minus, Plus } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { isBlackKey, toneName } from "@/lib/music";
import type { Bar } from "@/lib/ustx/bars";
import type { VoicePart } from "@/lib/ustx/load";
import type { PitchCurve } from "@/lib/ustx/pitch";
import type { Tempo } from "@/lib/ustx/types";

const KEY_WIDTH = 52;
const RULER_HEIGHT = 24;
const ROW_HEIGHT = 14;
/** 1 tick あたりの横幅（px）の段階 */
const ZOOM_LEVELS = [0.03, 0.05, 0.08, 0.12, 0.18, 0.26] as const;
const DEFAULT_ZOOM = 3;

/** 音高（cent）を、その音高の行の中央の y 座標に変換する */
function centsToY(cents: number, toneMax: number) {
  return (toneMax - cents / 100) * ROW_HEIGHT + ROW_HEIGHT / 2;
}

interface PianoRollProps {
  part: VoicePart;
  /** プロジェクト全体の小節（絶対 tick） */
  bars: Bar[];
  tempos: Tempo[];
  pitch: PitchCurve | null;
}

export function PianoRoll({ part, bars, tempos, pitch }: PianoRollProps) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [showPitch, setShowPitch] = useState(true);
  const scrollRef = useRef<HTMLElement>(null);
  const px = ZOOM_LEVELS[zoom];

  const layout = useMemo(() => {
    const notes = part.notes;
    const tones = notes.map((n) => n.tone);
    const lo = tones.length ? Math.min(...tones) : 60;
    const hi = tones.length ? Math.max(...tones) : 72;
    let toneMin = Math.max(0, lo - 7);
    let toneMax = Math.min(127, hi + 7);
    // 最低 2 オクターブ分は表示する
    while (toneMax - toneMin < 24) {
      if (toneMax < 127) toneMax++;
      if (toneMin > 0 && toneMax - toneMin < 24) toneMin--;
    }
    const endTick = notes.reduce(
      (m, n) => Math.max(m, n.position + n.duration),
      part.duration,
    );
    const avgTone = tones.length
      ? tones.reduce((a, b) => a + b, 0) / tones.length
      : 66;
    return { toneMin, toneMax, endTick, avgTone };
  }, [part]);

  const { toneMin, toneMax, endTick, avgTone } = layout;
  const rows = toneMax - toneMin + 1;
  const height = rows * ROW_HEIGHT;
  const width = Math.ceil(endTick * px) + 48;
  const yTone = (tone: number) => (toneMax - tone) * ROW_HEIGHT;

  // パート切り替え時に、ノートが集まる音域が見えるよう縦位置を合わせる
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = Math.max(
      0,
      (toneMax - avgTone) * ROW_HEIGHT - el.clientHeight / 2 + RULER_HEIGHT,
    );
    el.scrollLeft = 0;
  }, [toneMax, avgTone]);

  const partBars = useMemo(
    () =>
      bars
        .map((b) => ({ ...b, rel: b.tick - part.position }))
        .filter((b) => b.rel + b.beatTicks * b.beats > 0 && b.rel <= endTick),
    [bars, part.position, endTick],
  );

  const partTempos = tempos
    .map((t) => ({ ...t, rel: t.position - part.position }))
    .filter((t) => t.rel >= 0 && t.rel <= endTick);

  const pitchPath = useMemo(() => {
    if (!pitch) return "";
    const parts: string[] = [];
    let drawing = false;
    for (let i = 0; i < pitch.cents.length; i++) {
      const c = pitch.cents[i];
      if (Number.isNaN(c)) {
        drawing = false;
        continue;
      }
      const x = ((pitch.startTick + i * pitch.interval) * px).toFixed(1);
      const y = centsToY(c, toneMax).toFixed(1);
      parts.push(`${drawing ? "L" : "M"}${x} ${y}`);
      drawing = true;
    }
    return parts.join("");
  }, [pitch, px, toneMax]);

  const toneRows = Array.from({ length: rows }, (_, i) => toneMax - i);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <fieldset className="flex items-center gap-1">
          <legend className="sr-only">横方向の拡大・縮小</legend>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setZoom((z) => Math.max(0, z - 1))}
            disabled={zoom === 0}
            aria-label="縮小"
          >
            <Minus />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round((px / ZOOM_LEVELS[DEFAULT_ZOOM]) * 100)}%
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() =>
              setZoom((z) => Math.min(ZOOM_LEVELS.length - 1, z + 1))
            }
            disabled={zoom === ZOOM_LEVELS.length - 1}
            aria-label="拡大"
          >
            <Plus />
          </Button>
        </fieldset>
        <label className="flex cursor-pointer items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-pitch-line"
            checked={showPitch}
            onChange={(e) => setShowPitch(e.target.checked)}
          />
          ピッチカーブを表示
        </label>
        <p className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-4 rounded-sm border border-note-border bg-note"
            />
            ノート
          </span>
          <span className="flex items-center gap-1">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-4 bg-pitch-line"
            />
            ピッチ（OpenUtau の計算を近似）
          </span>
        </p>
      </div>

      <section
        ref={scrollRef}
        className="relative max-h-[60vh] min-h-64 overflow-auto rounded-lg border bg-roll-bg"
        aria-label={`ピアノロール：パート「${part.name}」、ノート ${part.notes.length} 個`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: スクロール領域をキーボードで操作できるようにする
        tabIndex={0}
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `${KEY_WIDTH}px ${width}px`,
            gridTemplateRows: `${RULER_HEIGHT}px ${height}px`,
          }}
        >
          {/* 左上の角 */}
          <div className="sticky top-0 left-0 z-30 border-r border-b bg-card" />

          {/* 小節ルーラー */}
          <svg
            className="sticky top-0 z-20 bg-card"
            width={width}
            height={RULER_HEIGHT}
            aria-hidden="true"
          >
            {partBars.map((b) => (
              <g key={b.index}>
                <line
                  x1={b.rel * px}
                  x2={b.rel * px}
                  y1={RULER_HEIGHT - 8}
                  y2={RULER_HEIGHT}
                  className="stroke-roll-bar"
                />
                {b.rel >= 0 && (
                  <text
                    x={b.rel * px + 3}
                    y={11}
                    className="fill-muted-foreground text-[10px]"
                  >
                    {b.index + 1}
                  </text>
                )}
              </g>
            ))}
            {partTempos.map((t) => (
              <text
                key={t.position}
                x={t.rel * px + 3}
                y={21}
                className="fill-foreground text-[9px] font-medium"
              >
                ♩={Number(t.bpm.toFixed(2))}
              </text>
            ))}
            <line
              x1={0}
              x2={width}
              y1={RULER_HEIGHT - 0.5}
              y2={RULER_HEIGHT - 0.5}
              className="stroke-border"
            />
          </svg>

          {/* 鍵盤 */}
          <svg
            className="sticky left-0 z-10 bg-card"
            width={KEY_WIDTH}
            height={height}
            aria-hidden="true"
          >
            {toneRows.map((tone) => (
              <g key={tone}>
                <rect
                  x={0}
                  y={yTone(tone)}
                  width={isBlackKey(tone) ? KEY_WIDTH * 0.62 : KEY_WIDTH}
                  height={ROW_HEIGHT}
                  className={
                    isBlackKey(tone)
                      ? "fill-foreground/80"
                      : "fill-card stroke-border"
                  }
                />
                {tone % 12 === 0 && (
                  <text
                    x={KEY_WIDTH - 4}
                    y={yTone(tone) + ROW_HEIGHT - 3}
                    textAnchor="end"
                    className="fill-muted-foreground text-[9px]"
                  >
                    {toneName(tone)}
                  </text>
                )}
              </g>
            ))}
          </svg>

          {/* グリッド・ノート・ピッチ */}
          <svg width={width} height={height} aria-hidden="true">
            {toneRows.map((tone) =>
              isBlackKey(tone) ? (
                <rect
                  key={tone}
                  x={0}
                  y={yTone(tone)}
                  width={width}
                  height={ROW_HEIGHT}
                  className="fill-roll-black-key"
                />
              ) : null,
            )}
            {toneRows.map((tone) => (
              <line
                key={`l${tone}`}
                x1={0}
                x2={width}
                y1={yTone(tone) + ROW_HEIGHT}
                y2={yTone(tone) + ROW_HEIGHT}
                className={
                  tone % 12 === 0 ? "stroke-roll-bar/60" : "stroke-roll-grid"
                }
                strokeWidth={0.5}
              />
            ))}
            {partBars.flatMap((b) =>
              Array.from({ length: b.beats }, (_, beat) => {
                const x = (b.rel + beat * b.beatTicks) * px;
                return (
                  <line
                    key={`${b.index}-${beat}`}
                    x1={x}
                    x2={x}
                    y1={0}
                    y2={height}
                    className={
                      beat === 0 ? "stroke-roll-bar" : "stroke-roll-grid"
                    }
                    strokeWidth={beat === 0 ? 1 : 0.75}
                  />
                );
              }),
            )}

            {part.notes.map((note) => {
              const x = note.position * px;
              const w = Math.max(2, note.duration * px - 1);
              const y = yTone(note.tone);
              return (
                <g key={note.index}>
                  <title>
                    {`${note.lyric}（${toneName(note.tone)}）位置 ${note.position} / 長さ ${note.duration} tick`}
                  </title>
                  <rect
                    x={x}
                    y={y + 1}
                    width={w}
                    height={ROW_HEIGHT - 2}
                    rx={2}
                    className="fill-note stroke-note-border"
                    strokeWidth={1}
                  />
                  {w > 10 && (
                    <svg
                      aria-hidden="true"
                      x={x}
                      y={y}
                      width={w}
                      height={ROW_HEIGHT}
                      overflow="hidden"
                    >
                      <text
                        x={3}
                        y={ROW_HEIGHT - 4}
                        className="fill-note-foreground text-[10px]"
                      >
                        {note.lyric}
                      </text>
                    </svg>
                  )}
                </g>
              );
            })}

            {showPitch && pitchPath && (
              <path
                d={pitchPath}
                fill="none"
                className="stroke-pitch-line"
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
          </svg>
        </div>
      </section>
    </div>
  );
}
