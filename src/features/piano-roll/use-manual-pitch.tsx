import { useEffect, useMemo, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import type { VoicePart } from "../../lib/ustx/load";
import { noteKey } from "../../lib/ustx/edits";
import { adjustedTone, effectivePitchPoints, renderPartPitch } from "../../lib/ustx/pitch";
import { TimeAxis } from "../../lib/ustx/time-axis";
import type { PitchPoint, RawNote, Tempo, Vibrato } from "../../lib/ustx/types";
import { useEditStore } from "../../stores/edit-store";
import { useSelectionStore } from "../../stores/selection-store";
import { clampPointTime, pointTime } from "./manual-pitch";
import {
  centsToY,
  drawingOrigin,
  KEY_WIDTH,
  ROW_HEIGHT,
  RULER_HEIGHT,
  tickToX,
  type Camera,
} from "./geometry";

type Pitch = RawNote["pitch"];
interface Drag {
  id: number;
  index: number;
  pitch: Pitch;
  edits: ReturnType<typeof useEditStore.getState>["edits"];
  part: number;
  note: number;
  x: number;
  y: number;
  moved: boolean;
}

export function useManualPitch(
  part: VoicePart,
  tempos: readonly Tempo[],
  cam: Camera,
  selected: ReadonlySet<number>,
  panMode: boolean,
) {
  const note = selected.size === 1 ? part.notes.find((n) => selected.has(n.index)) : undefined;
  const axis = useMemo(() => new TimeAxis(tempos), [tempos]);
  const edits = useEditStore((s) => s.edits);
  const [active, setActive] = useState(0);
  // プレビューは作成時の文脈と一緒に保持し、パート・ノート・編集状態が変わったら描画時に無効とみなす
  const [draft, setDraft] = useState<{
    pitch: Pitch;
    edits: Drag["edits"];
    part: number;
    note: number;
  } | null>(null);
  const drag = useRef<Drag | null>(null);
  const cancel = () => {
    drag.current = null;
    setDraft(null);
  };
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && drag.current) {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  if (!note) return { overlay: null, controls: null, previewPitch: null };
  const target = note;
  const key = noteKey(part.index, target.index);
  const preview =
    draft && draft.edits === edits && draft.part === part.index && draft.note === target.index
      ? draft.pitch
      : null;
  const pitch = preview ?? target.pitch;
  const previous = part.notes[part.notes.indexOf(target) - 1];
  const displayed = effectivePitchPoints({ ...target, pitch }, previous);
  const startMs = axis.tickToMs(part.position + target.position);
  const apply = (next: Pitch, label: string) =>
    useEditStore
      .getState()
      .apply(label, [{ key, after: { ...useEditStore.getState().edits.get(key), pitch: next } }]);
  const changePoint = (index: number, point: PitchPoint, source = pitch): Pitch => ({
    ...source,
    data: source.data.map((p, i) => (i === index ? point : p)),
  });
  const move = (e: PointerEvent<HTMLButtonElement>, g: Drag) => {
    const section = e.currentTarget.closest("section");
    if (!section) return g.pitch;
    const origin = drawingOrigin(section);
    const x = e.clientX - origin.left - KEY_WIDTH;
    const y = e.clientY - origin.top - RULER_HEIGHT;
    const tick = x / cam.pxPerTick + cam.scrollTick;
    const ms = pointTime(axis, part.position, target.position, tick);
    const relativeY = Math.round(
      ((centsToY(adjustedTone(target) * 100, cam) - y) / ROW_HEIGHT) * 10,
    );
    const old = g.pitch.data[g.index];
    return changePoint(
      g.index,
      {
        ...old,
        x: clampPointTime(g.pitch.data, g.index, ms),
        y: g.index === 0 && g.pitch.snap_first ? old.y : relativeY,
      },
      g.pitch,
    );
  };
  const pointKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      cancel();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Delete", "Backspace"].includes(e.key))
      return;
    e.preventDefault();
    setActive(index);
    if (e.key === "Delete" || e.key === "Backspace") {
      remove(index);
      return;
    }
    const p = pitch.data[index];
    const dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    const dy = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
    const x = clampPointTime(pitch.data, index, p.x + dx);
    apply(
      changePoint(index, { ...p, x, y: index === 0 && pitch.snap_first ? p.y : p.y + dy }),
      "ピッチ点を移動",
    );
  };
  const remove = (index: number) => {
    const data = pitch.data.filter((_, i) => i !== index);
    apply({ ...pitch, snap_first: data.length ? pitch.snap_first : false, data }, "ピッチ点を削除");
    setActive(Math.max(0, index - 1));
  };
  const overlay = displayed.map((p, i) => {
    const tick = axis.msToTick(startMs + p.x) - part.position;
    const x = KEY_WIDTH + tickToX(tick, cam);
    const y = RULER_HEIGHT + centsToY(adjustedTone(target) * 100 + p.y * 10, cam);
    return (
      <button
        key={i}
        type="button"
        aria-label={`ピッチ点 ${i + 1}`}
        aria-pressed={active === i}
        className="absolute z-10 size-4 rounded-full border-2 border-white bg-blue-700 focus:outline focus:outline-2 focus:outline-blue-600"
        style={{
          left: x - 8,
          top: y - 8,
          touchAction: "none",
          pointerEvents: panMode ? "none" : undefined,
        }}
        onKeyDown={(e) => pointKey(e, i)}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.currentTarget.focus();
          e.currentTarget.setPointerCapture(e.pointerId);
          setActive(i);
          drag.current = {
            id: e.pointerId,
            index: i,
            pitch: target.pitch,
            edits: useEditStore.getState().edits,
            part: part.index,
            note: target.index,
            x: e.clientX,
            y: e.clientY,
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          e.stopPropagation();
          const g = drag.current;
          if (
            g?.id === e.pointerId &&
            (g.moved || Math.hypot(e.clientX - g.x, e.clientY - g.y) >= 2)
          ) {
            g.moved = true;
            setDraft({ pitch: move(e, g), edits: g.edits, part: g.part, note: g.note });
          }
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          const g = drag.current;
          if (!g || g.id !== e.pointerId) return;
          const next = move(e, g);
          const selection = useSelectionStore.getState();
          const valid =
            useEditStore.getState().edits === g.edits &&
            selection.partIndex === g.part &&
            selection.notes.has(g.note) &&
            selection.notes.size === 1;
          cancel();
          if (valid && g.moved) apply(next, "ピッチ点を移動");
        }}
        onPointerCancel={(e) => {
          e.stopPropagation();
          cancel();
        }}
      />
    );
  });
  const vibratoFields: [keyof Vibrato, string][] = [
    ["length", "長さ (%)"],
    ["period", "周期 (ms)"],
    ["depth", "深さ (cent)"],
    ["in", "フェードイン (%)"],
    ["out", "フェードアウト (%)"],
    ["shift", "位相 (%)"],
    ["drift", "ドリフト"],
    ["vol_link", "音量連動"],
  ];
  const controls = (
    <section aria-label="手動ピッチ編集" className="space-y-2 rounded-lg border p-3 text-sm">
      <p>
        手動ピッチ編集：点の位置はノート先頭からのミリ秒、音高は 10 cent
        単位です。点をドラッグ、または矢印キーで移動できます。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded border px-2 py-1"
          onClick={() => {
            const data = [
              ...pitch.data,
              { x: (pitch.data.at(-1)?.x ?? -100) + 100, y: 0, shape: "io" as const },
            ];
            apply({ ...pitch, data }, "ピッチ点を追加");
            setActive(data.length - 1);
          }}
        >
          ピッチ点を追加
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={!pitch.data.length}
          onClick={() => remove(Math.min(active, pitch.data.length - 1))}
        >
          ピッチ点を削除
        </button>
        {pitch.data.length > 0 && (
          <label>
            補間{" "}
            <select
              aria-label="ピッチ点の補間"
              className="rounded border"
              value={pitch.data[Math.min(active, pitch.data.length - 1)].shape}
              onChange={(e) => {
                const i = Math.min(active, pitch.data.length - 1);
                apply(
                  changePoint(i, {
                    ...pitch.data[i],
                    shape: e.target.value as PitchPoint["shape"],
                  }),
                  "ピッチ点の補間を変更",
                );
              }}
            >
              {[
                "io",
                "l",
                "i",
                "o",
                ...(pitch.data[Math.min(active, pitch.data.length - 1)].shape === "sp"
                  ? ["sp"]
                  : []),
              ].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <input
            type="checkbox"
            checked={pitch.snap_first}
            disabled={!pitch.data.length}
            onChange={(e) =>
              apply(
                {
                  ...pitch,
                  snap_first: e.target.checked,
                  data:
                    !e.target.checked && pitch.snap_first
                      ? pitch.data.map((p, i) => (i === 0 ? { ...p, y: displayed[0].y } : p))
                      : pitch.data,
                },
                "先頭点の自動接続を変更",
              )
            }
          />{" "}
          先頭点を前のノートに接続
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        自動接続中は先頭点の音高が前のノートとの音高差に置き換わります。解除すると自由に編集できます。
      </p>
      <fieldset>
        <legend>ビブラート</legend>
        <div className="flex flex-wrap gap-2">
          {vibratoFields.map(([field, label]) => (
            <VibratoInput
              key={`${part.index}:${target.index}:${field}`}
              label={label}
              value={target.vibrato[field]}
              onCommit={(value) => {
                useEditStore.getState().apply("ビブラートを変更", [
                  {
                    key,
                    after: {
                      ...useEditStore.getState().edits.get(key),
                      vibrato: { ...target.vibrato, [field]: value },
                    },
                  },
                ]);
              }}
            />
          ))}
        </div>
      </fieldset>
    </section>
  );
  const previewPitch = preview
    ? renderPartPitch(
        {
          ...part,
          notes: part.notes.map((n) => (n.index === target.index ? { ...n, pitch: preview } : n)),
        },
        axis,
      )
    : null;
  return { overlay, controls, previewPitch };
}

function VibratoInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  return (
    <label>
      {label}{" "}
      <input
        aria-label={`ビブラート ${label}`}
        className="w-20 rounded border px-1"
        type="number"
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (
            !cancelled.current &&
            draft !== null &&
            draft.trim() !== "" &&
            Number.isFinite(Number(draft))
          )
            onCommit(Number(draft));
          cancelled.current = false;
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            cancelled.current = true;
            setDraft(null);
            e.currentTarget.blur();
          } else if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
