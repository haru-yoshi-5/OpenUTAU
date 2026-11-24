import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "../../components/ui/button";
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
import { useRollTheme } from "./theme";

type Pitch = RawNote["pitch"];
type Edits = ReturnType<typeof useEditStore.getState>["edits"];
interface Drag {
  id: number;
  index: number;
  pitch: Pitch;
  edits: Edits;
  part: number;
  note: number;
  x: number;
  y: number;
  moved: boolean;
}

/** 点のボタンが自分で処理するキー（修飾キーなしのときだけ） */
const POINT_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Delete", "Backspace"];

const SHAPE_LABELS: Record<PitchPoint["shape"], string> = {
  io: "S字 (io)",
  l: "直線 (l)",
  i: "ゆっくり始まる (i)",
  o: "ゆっくり終わる (o)",
  sp: "スプライン (sp)",
};

const clamp100 = (v: number) => Math.min(100, Math.max(0, v));

export function useManualPitch(
  part: VoicePart,
  tempos: readonly Tempo[],
  cam: Camera,
  selected: ReadonlySet<number>,
  panMode: boolean,
) {
  const note = selected.size === 1 ? part.notes.find((n) => selected.has(n.index)) : undefined;
  const axis = useMemo(() => new TimeAxis(tempos), [tempos]);
  const theme = useRollTheme();
  const edits = useEditStore((s) => s.edits);
  const [active, setActive] = useState(0);
  // プレビューは作成時の編集状態と一緒に保持し、Undo などで編集が変わったら描画時に無効とみなす
  const [draft, setDraft] = useState<{ pitch: Pitch; edits: Edits } | null>(null);
  const drag = useRef<Drag | null>(null);
  // 選んでいるノートが変わったら、選択中の点とプレビューを描画時にリセットする
  const noteId = note ? `${part.index}:${note.index}` : null;
  const [shownFor, setShownFor] = useState(noteId);
  if (shownFor !== noteId) {
    setShownFor(noteId);
    setActive(0);
    setDraft(null);
  }
  // ドラッグ中に点のボタンが消えた場合（Ctrl+A など）も、ドラッグ状態を残さない
  useEffect(() => {
    drag.current = null;
  }, [noteId]);
  const cancel = () => {
    drag.current = null;
    setDraft(null);
  };
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && drag.current) {
        e.preventDefault();
        e.stopPropagation();
        drag.current = null;
        setDraft(null);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  if (!note) return { overlay: null, controls: null, previewPitch: null };
  const target = note;
  const key = noteKey(part.index, target.index);
  const preview = draft && draft.edits === edits ? draft.pitch : null;
  const pitch = preview ?? target.pitch;
  const activeIndex = Math.min(active, pitch.data.length - 1);
  // 自動接続中に点を 0 個にすると OpenUtau で開けなくなるため、最後の 1 点は消せない
  const canRemove = pitch.data.length > (pitch.snap_first ? 1 : 0);
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
  const remove = (index: number) => {
    if (!canRemove) return;
    apply({ ...pitch, data: pitch.data.filter((_, i) => i !== index) }, "ピッチ点を削除");
    setActive(Math.max(0, index - 1));
  };
  const pointKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    // Ctrl+Z などのショートカットや Esc（選択の解除）は、ピアノロールとツールバーに任せる
    if (e.ctrlKey || e.metaKey || e.altKey || !POINT_KEYS.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
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
  const points = displayed.map((p, i) => {
    const tick = axis.msToTick(startMs + p.x) - part.position;
    const x = tickToX(tick, cam);
    const y = centsToY(adjustedTone(target) * 100 + p.y * 10, cam);
    const isActive = activeIndex === i;
    return (
      <button
        key={i}
        type="button"
        aria-label={`ピッチ点 ${i + 1}`}
        aria-pressed={isActive}
        className="absolute size-4 rounded-full border-2 focus-visible:outline-2 focus-visible:outline-offset-1"
        style={{
          left: x - 8,
          top: y - 8,
          background: isActive ? theme.noteSelected : theme.pitchLine,
          borderColor: theme.background,
          outlineColor: theme.tempoText,
          touchAction: "none",
          pointerEvents: panMode ? "none" : "auto",
        }}
        onKeyDown={(e) => pointKey(e, i)}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.currentTarget.focus({ preventScroll: true });
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
            setDraft({ pitch: move(e, g), edits: g.edits });
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
        onLostPointerCapture={(e) => {
          if (drag.current?.id === e.pointerId) cancel();
        }}
      />
    );
  });
  // 描画範囲（鍵盤とルーラーを除いた部分）で切り抜き、点が鍵盤やルーラーに重ならないようにする。
  // overflow: clip はスクロールコンテナを作らないため、範囲外の点にフォーカスしても表示がずれない
  const overlay = (
    <div
      className="pointer-events-none absolute right-0 bottom-0 z-10 overflow-clip"
      style={{ left: KEY_WIDTH, top: RULER_HEIGHT }}
    >
      {points}
    </div>
  );
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
  const commitVibrato = (field: keyof Vibrato, value: number) => {
    const vibrato = { ...target.vibrato, [field]: value };
    // フェードインとフェードアウトは合計 100% まで。後から入力した方を優先し、もう片方を削る
    if (field === "in") vibrato.out = Math.min(vibrato.out, 100 - clamp100(value));
    if (field === "out") vibrato.in = Math.min(vibrato.in, 100 - clamp100(value));
    useEditStore
      .getState()
      .apply("ビブラートを変更", [
        { key, after: { ...useEditStore.getState().edits.get(key), vibrato } },
      ]);
  };
  const controls = (
    <section aria-label="手動ピッチ編集" className="space-y-2 rounded-lg border p-3 text-sm">
      <p>
        手動ピッチ編集：点の位置はノート先頭からのミリ秒、音高は 10 cent
        単位です。点をドラッグ、または矢印キーで移動できます。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
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
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canRemove}
          onClick={() => remove(activeIndex)}
        >
          ピッチ点を削除
        </Button>
        {pitch.data.length > 0 && (
          <label>
            補間{" "}
            <select
              aria-label="ピッチ点の補間"
              className="h-8 rounded-md border bg-card px-1"
              value={pitch.data[activeIndex].shape}
              onChange={(e) =>
                apply(
                  changePoint(activeIndex, {
                    ...pitch.data[activeIndex],
                    shape: e.target.value as PitchPoint["shape"],
                  }),
                  "ピッチ点の補間を変更",
                )
              }
            >
              {(
                [
                  "io",
                  "l",
                  "i",
                  "o",
                  ...(pitch.data[activeIndex].shape === "sp" ? ["sp"] : []),
                ] as PitchPoint["shape"][]
              ).map((s) => (
                <option key={s} value={s}>
                  {SHAPE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <input
            type="checkbox"
            className="size-4 align-middle"
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
        {pitch.snap_first &&
          pitch.data.length === 1 &&
          " 自動接続中は最後の 1 点を削除できません（OpenUtau で開けなくなるため）。"}
      </p>
      <fieldset>
        <legend>ビブラート</legend>
        <div className="flex flex-wrap gap-2">
          {vibratoFields.map(([field, label]) => (
            <VibratoInput
              key={`${part.index}:${target.index}:${field}`}
              label={label}
              value={target.vibrato[field]}
              onCommit={(value) => commitVibrato(field, value)}
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

const isNumberText = (text: string | null): text is string =>
  text !== null && text.trim() !== "" && Number.isFinite(Number(text));

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
  // 確定前の入力。Enter・Tab で確定する前に入力欄が消えた場合（別のノートを選んだ時など）も確定させる
  const pending = useRef<string | null>(null);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  });
  useEffect(
    () => () => {
      if (isNumberText(pending.current)) commitRef.current(Number(pending.current));
    },
    [],
  );
  return (
    <label>
      {label}{" "}
      <input
        aria-label={`ビブラート ${label}`}
        className="h-8 w-20 rounded-md border bg-card px-1"
        type="number"
        value={draft ?? String(value)}
        onChange={(e) => {
          pending.current = e.target.value;
          setDraft(e.target.value);
        }}
        onBlur={() => {
          const text = pending.current;
          pending.current = null;
          if (isNumberText(text)) onCommit(Number(text));
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            pending.current = null;
            setDraft(null);
            e.currentTarget.blur();
          } else if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
