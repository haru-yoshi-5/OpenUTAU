import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { UstxError } from "../../lib/ustx/errors";
import type { VoicePart } from "../../lib/ustx/load";
import { noteKey } from "../../lib/ustx/edits";
import { sortPitchPoints, sortPoints } from "../../lib/ustx/normalize";
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
  /** 自動接続で高さが決まる点の番号（無ければ -1）。この点は高さを変えない */
  snapIndex: number;
  /** 押した位置から点の中心までのずれ。ドラッグ開始時に点がカーソルへ飛ばないようにする */
  offsetX: number;
  offsetY: number;
  moved: boolean;
  /** 座標の基準にするピアノロールの要素 */
  section: Element | null;
  /** 最後のポインター位置と、プレビュー更新の予約（1 フレームに 1 回にまとめる） */
  lastX: number;
  lastY: number;
  frame: number;
}

/** ドラッグを終える（予約済みのプレビュー更新も取り消す） */
function stopDrag(drag: RefObject<Drag | null>) {
  if (drag.current?.frame) cancelAnimationFrame(drag.current.frame);
  drag.current = null;
}

/** 矢印キーの長押しを 1 つの操作にまとめるための目印の連番 */
let holdSeq = 0;

/** 点のボタンが自分で処理するキー（修飾キーなしのときだけ） */
const POINT_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Delete", "Backspace"];
/** 点を選ぶキー。ボタンの既定動作（クリック）に任せ、ピアノロールには伝えない */
const SELECT_KEYS = ["Enter", " "];

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
  /** 「ピッチカーブを表示」。オフのときは点を出さない（見えない曲線を動かさないため） */
  showPitch: boolean,
) {
  const note = selected.size === 1 ? part.notes.find((n) => selected.has(n.index)) : undefined;
  const axis = useMemo(() => new TimeAxis(tempos), [tempos]);
  const theme = useRollTheme();
  const edits = useEditStore((s) => s.edits);
  const [active, setActive] = useState(0);
  // プレビューは作成時の編集状態と一緒に保持し、Undo などで編集が変わったら描画時に無効とみなす
  const [draft, setDraft] = useState<{ pitch: Pitch; edits: Edits } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  /** キーボードで点を消した後にフォーカスする点の番号（-1 はピアノロール） */
  const focusAfter = useRef<number | null>(null);
  useEffect(() => {
    const index = focusAfter.current;
    if (index === null) return;
    focusAfter.current = null;
    const container = overlayRef.current;
    const button = container?.querySelectorAll<HTMLButtonElement>("button")[index];
    const target = button ?? container?.closest<HTMLElement>("section");
    target?.focus({ preventScroll: true });
  });
  // 選んでいるノートが変わったら、選択中の点とプレビューを描画時にリセットする
  const noteId = note ? `${part.index}:${note.index}` : null;
  const [shownFor, setShownFor] = useState(noteId);
  if (shownFor !== noteId) {
    setShownFor(noteId);
    setActive(0);
    setDraft(null);
    setError(null);
  }
  // ドラッグ中に点のボタンが消えた場合（Ctrl+A など）も、ドラッグ状態を残さない
  useEffect(() => {
    stopDrag(drag);
  }, [noteId]);
  // 表示の切り替えや表示移動モードで点のボタンが消えると、pointerup が届かずドラッグが残るため、
  // そのときもドラッグとプレビューを片付ける（プレビューは描画時、ドラッグは effect で）
  const dragContext = `${showPitch}:${panMode}`;
  const [contextShown, setContextShown] = useState(dragContext);
  if (contextShown !== dragContext) {
    setContextShown(dragContext);
    setDraft(null);
  }
  useEffect(() => {
    stopDrag(drag);
  }, [showPitch, panMode]);
  /** 長押し中の矢印キーの目印。同じ目印の移動は 1 つの操作にまとめる */
  const holdId = useRef("");
  const cancel = () => {
    stopDrag(drag);
    setDraft(null);
  };
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && drag.current) {
        e.preventDefault();
        e.stopPropagation();
        stopDrag(drag);
        setDraft(null);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  if (!note) {
    return {
      overlay: null,
      controls: (
        <section
          aria-label="手動ピッチ編集"
          className="rounded-lg border p-3 text-sm text-muted-foreground"
        >
          手動ピッチ編集：ノートを 1 つだけ選ぶと、ピッチ点とビブラートを編集できます。
          {selected.size > 1 && `（今は ${selected.size} 個選んでいます）`}
        </section>
      ),
      previewPitch: null,
    };
  }
  const target = note;
  const key = noteKey(part.index, target.index);
  const preview = draft && draft.edits === edits ? draft.pitch : null;
  // 読み込んだ点は OpenUtau と同じく保存順のまま扱うが、編集の記録時は x の昇順に並べ替えられる。
  // 時間順に並んでいないノートは、編集の前後で前のノートに接続される点が入れ替わってしまうため、
  // 点の編集を止め、先に並べ替え（曲線の形が変わる）を 1 つの編集として確かめてもらう
  const locked = sortPitchPoints(target.pitch) !== target.pitch;
  const pitch = preview ?? sortPitchPoints(target.pitch);
  // 自動接続で高さが決まる点の番号（並べ替え後は先頭）
  const snapIndex = pitch.snap_first ? 0 : -1;
  const activeIndex = Math.min(active, pitch.data.length - 1);
  // 自動接続中に点を 0 個にすると OpenUtau で開けなくなるため、最後の 1 点は消せない
  const canRemove = pitch.data.length > (pitch.snap_first ? 1 : 0);
  const previous = part.notes[part.notes.indexOf(target) - 1];
  // 先頭点の自動接続は、曲線と同じく保存順の先頭に当ててから、番号の順序（昇順）に並べる
  const displayed = sortPoints(
    effectivePitchPoints({ ...target, pitch: preview ?? target.pitch }, previous),
  );
  const startMs = axis.tickToMs(part.position + target.position);
  /**
   * 編集を記録する。拒否されたらパネルにエラーを表示して false を返す。
   * quiet のときは表示しない（入力欄が消える時の確定など、対象がもう無いかもしれない場合）
   */
  const record = (
    label: string,
    change: Partial<RawNote>,
    { quiet = false, mergeId }: { quiet?: boolean; mergeId?: string } = {},
  ) => {
    if (!quiet) setError(null);
    try {
      const after = { ...useEditStore.getState().edits.get(key), ...change };
      useEditStore.getState().apply(label, [{ key, after }], { mergeId });
      return true;
    } catch (e) {
      if (!quiet) {
        setError(e instanceof UstxError ? e.message : "編集中に予期しないエラーが発生しました。");
      }
      return false;
    }
  };
  /**
   * ピッチの編集を記録する。ドラッグ中は何もしない（キーボードやパネルの操作が、
   * まだ確定していないドラッグ途中の位置を土台にしてしまうため）
   */
  const apply = (next: Pitch, label: string, mergeId?: string) => {
    // 時間順に並んでいないノートは、「時間順に並べ替える」以外の編集を受け付けない
    if (drag.current || locked) return false;
    return record(label, { pitch: next }, { mergeId });
  };
  const changePoint = (index: number, point: PitchPoint, source = pitch): Pitch => ({
    ...source,
    data: source.data.map((p, i) => (i === index ? point : p)),
  });
  const move = (clientX: number, clientY: number, g: Drag) => {
    if (!g.section) return g.pitch;
    const origin = drawingOrigin(g.section);
    const x = clientX + g.offsetX - origin.left - KEY_WIDTH;
    const y = clientY + g.offsetY - origin.top - RULER_HEIGHT;
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
        y: g.index === g.snapIndex ? old.y : relativeY,
      },
      g.pitch,
    );
  };
  const remove = (index: number) => {
    if (!canRemove) return;
    if (apply({ ...pitch, data: pitch.data.filter((_, i) => i !== index) }, "ピッチ点を削除")) {
      setActive(Math.max(0, index - 1));
      return true;
    }
    return false;
  };
  const pointKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    // Ctrl+Z などのショートカットや Esc（選択の解除）は、ピアノロールとツールバーに任せる
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (SELECT_KEYS.includes(e.key)) {
      setActive(index);
      // Space は「押しながらドラッグで表示を移動」にも使うため、ピアノロールへそのまま伝える
      // （ピアノロールが既定動作を止めてクリックが起きないので、ここで選ぶ）
      if (e.key !== " ") e.stopPropagation();
      return;
    }
    if (!POINT_KEYS.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    setActive(index);
    if (e.key === "Delete" || e.key === "Backspace") {
      // 消した点のボタンが無くなってもキーボード操作を続けられるよう、前の点へフォーカスを移す
      if (remove(index)) focusAfter.current = pitch.data.length > 1 ? Math.max(0, index - 1) : -1;
      return;
    }
    const p = pitch.data[index];
    // 1 回で横 5 ms・縦 10 cent。Shift を押しながらなら 10 倍（50 ms・100 cent）
    const step = e.shiftKey ? 10 : 1;
    const dx = (e.key === "ArrowLeft" ? -5 : e.key === "ArrowRight" ? 5 : 0) * step;
    const dy = (e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0) * step;
    const x = clampPointTime(pitch.data, index, p.x + dx);
    // 長押し（キーリピート）中の移動は、履歴を埋めないよう同じ長押しの最初の移動とまとめる
    if (!e.repeat) holdId.current = `hold-${++holdSeq}`;
    apply(
      changePoint(index, { ...p, x, y: index === snapIndex ? p.y : p.y + dy }),
      "ピッチ点を移動",
      holdId.current,
    );
  };
  const points = displayed.map((p, i) => {
    // 曲線の計算（renderPartPitch）と同じく tick に丸め、点と曲線の折れ目をそろえる
    const tick = Math.round(axis.msToTick(startMs + p.x)) - part.position;
    const x = tickToX(tick, cam);
    const y = centsToY(adjustedTone(target) * 100 + p.y * 10, cam);
    const isActive = activeIndex === i;
    return (
      <button
        key={i}
        type="button"
        aria-label={`ピッチ点 ${i + 1}`}
        aria-pressed={isActive}
        disabled={locked}
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
        onClick={() => setActive(i)}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          // disabled のボタンにも pointer イベントは届くため、ロック中はここで止める
          // （ピアノロールにも伝えないので、押しても矩形選択などは始まらない）
          if (locked) return;
          e.currentTarget.focus({ preventScroll: true });
          e.currentTarget.setPointerCapture(e.pointerId);
          setActive(i);
          const box = e.currentTarget.getBoundingClientRect();
          drag.current = {
            id: e.pointerId,
            index: i,
            pitch,
            snapIndex,
            edits: useEditStore.getState().edits,
            part: part.index,
            note: target.index,
            x: e.clientX,
            y: e.clientY,
            offsetX: box.left + box.width / 2 - e.clientX,
            offsetY: box.top + box.height / 2 - e.clientY,
            moved: false,
            section: e.currentTarget.closest("section"),
            lastX: e.clientX,
            lastY: e.clientY,
            frame: 0,
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
            g.lastX = e.clientX;
            g.lastY = e.clientY;
            // パート全体のピッチを計算し直すため、プレビューの更新は 1 フレームに 1 回にまとめる
            if (!g.frame) {
              g.frame = requestAnimationFrame(() => {
                g.frame = 0;
                if (drag.current !== g) return;
                setDraft({ pitch: move(g.lastX, g.lastY, g), edits: g.edits });
              });
            }
          }
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          const g = drag.current;
          if (!g || g.id !== e.pointerId) return;
          const next = move(e.clientX, e.clientY, g);
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
  // overflow: clip と contain: paint はスクロールコンテナを作らないため、範囲外の点にフォーカスしても
  // 表示がずれない（contain: paint は overflow: clip に未対応の Safari 15.4〜15.x 向け）
  const overlay = showPitch && (
    <div
      ref={overlayRef}
      className="pointer-events-none absolute right-0 bottom-0 z-10 overflow-clip [contain:paint]"
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
  const commitVibrato = (field: keyof Vibrato, value: number, quiet: boolean) => {
    const vibrato = { ...target.vibrato, [field]: value };
    // フェードインとフェードアウトは合計 100% まで。後から入力した方を優先し、もう片方を削る
    if (field === "in") vibrato.out = Math.min(vibrato.out, 100 - clamp100(value));
    if (field === "out") vibrato.in = Math.min(vibrato.in, 100 - clamp100(value));
    record("ビブラートを変更", { vibrato }, { quiet });
  };
  const controls = (
    <section aria-label="手動ピッチ編集" className="space-y-2 rounded-lg border p-3 text-sm">
      <p>
        手動ピッチ編集：点の位置はノート先頭からのミリ秒、音高は 10 cent
        単位です。点をドラッグ、または矢印キー（横 5 ms・縦 10 cent。Shift で 10
        倍）で移動できます。
        {!showPitch && "「ピッチカーブを表示」をオンにすると、ピッチ点が表示されます。"}
      </p>
      {locked && (
        <Alert tone="warning" title="ピッチ点が時間順に並んでいません">
          <p>
            OpenUtau
            は保存された順序のまま曲線を作ります。ピッチ点を編集するには、先に時間順へ並べ替えてください。並べ替えると曲線の形が変わることがあります（元に戻すで戻せます）。
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() =>
              record("ピッチ点を時間順に並べ替え", { pitch: sortPitchPoints(target.pitch) })
            }
          >
            時間順に並べ替える
          </Button>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={locked}
          onClick={() => {
            const data = [
              ...pitch.data,
              { x: (pitch.data.at(-1)?.x ?? -100) + 100, y: 0, shape: "io" as const },
            ];
            if (apply({ ...pitch, data }, "ピッチ点を追加")) setActive(data.length - 1);
          }}
        >
          ピッチ点を追加
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={locked || !canRemove}
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
              disabled={locked}
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
            disabled={locked || !pitch.data.length}
            onChange={(e) =>
              apply(
                {
                  ...pitch,
                  snap_first: e.target.checked,
                  data:
                    !e.target.checked && pitch.snap_first
                      ? pitch.data.map((p, i) =>
                          i === snapIndex ? { ...p, y: displayed[snapIndex].y } : p,
                        )
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
              onCommit={(value, quiet) => commitVibrato(field, value, quiet)}
            />
          ))}
        </div>
      </fieldset>
      {error && (
        <Alert tone="error" title="編集できませんでした">
          {error}
        </Alert>
      )}
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
  /** quiet：入力欄が消える時の確定。対象のノートがもう無いこともあるため、失敗しても表示しない */
  onCommit: (value: number, quiet: boolean) => void;
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
      if (isNumberText(pending.current)) commitRef.current(Number(pending.current), true);
    },
    [],
  );
  /**
   * 「元に戻す」「やり直す」を押している間は、確定を保留する。確定すると新しい編集になり、
   * やり直しの履歴が消えるため。取り消し・やり直しが実際に行われたら入力を捨て、
   * クリックをやめた（ボタンの外で離した）場合は通常どおり確定する。
   * pointerdown は blur より先に起きるため、ボタンにフォーカスが移らないブラウザ（Safari など）でも働く
   */
  const awaitingHistory = useRef(false);
  const flush = (quiet: boolean) => {
    const text = pending.current;
    pending.current = null;
    if (isNumberText(text)) commitRef.current(Number(text), quiet);
    setDraft(null);
  };
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => {
    const onPointerDown = (e: globalThis.PointerEvent) => {
      if (
        pending.current !== null &&
        e.target instanceof Element &&
        e.target.closest("[data-history-action]:not(:disabled)")
      ) {
        awaitingHistory.current = true;
      }
    };
    const onPointerUp = () => {
      if (!awaitingHistory.current) return;
      // クリック（取り消し・やり直しの実行）は pointerup と同じタスクで起きるため、その後で確かめる
      setTimeout(() => {
        if (!awaitingHistory.current) return;
        awaitingHistory.current = false;
        flushRef.current(false);
      }, 0);
    };
    const unsubscribe = useEditStore.subscribe((state, prev) => {
      if (!awaitingHistory.current) return;
      if (state.undoStack === prev.undoStack && state.redoStack === prev.redoStack) return;
      awaitingHistory.current = false;
      pending.current = null;
      setDraft(null);
    });
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);
    return () => {
      unsubscribe();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerUp, true);
    };
  }, []);
  return (
    <label>
      {label}{" "}
      <input
        aria-label={`ビブラート ${label}`}
        className="h-8 w-20 rounded-md border bg-card px-1"
        type="number"
        step="any"
        value={draft ?? String(value)}
        onChange={(e) => {
          pending.current = e.target.value;
          setDraft(e.target.value);
        }}
        onBlur={() => {
          // 履歴ボタンを押している間は、離すまで確定を保留する
          if (!awaitingHistory.current) flush(false);
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
