import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { UstxError } from "../../lib/ustx/errors";
import type { VoicePart } from "../../lib/ustx/load";
import { noteKey } from "../../lib/ustx/edits";
import { clamp, sortPitchPoints, sortPoints } from "../../lib/ustx/normalize";
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
import { xToTick } from "./hit-test";
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
  /** ポインター位置からドラッグ後のピッチを求める。表示位置は計算する時点のものを使う */
  compute: (clientX: number, clientY: number, g: Drag) => Pitch;
  /** 押した位置から点の中心までのずれ。ドラッグ開始時に点がカーソルへ飛ばないようにする */
  offsetX: number;
  offsetY: number;
  /**
   * 押した時の点の位置（tick と、ノートの音高からの高さ。高さは 10 cent 単位で丸める前の値）。
   * 片方の向きにだけ動かした時に、動かしていない向きの値を丸めて変えないために使う
   */
  startTick: number;
  startHeight: number;
  moved: boolean;
  /** 座標の基準にするピアノロールの要素 */
  section: Element | null;
  /** 最後のポインター位置と、プレビュー更新の予約（1 フレームに 1 回にまとめる） */
  lastX: number;
  lastY: number;
  frame: number;
}

/** ドラッグのプレビューを次のフレームで更新する（パート全体のピッチを計算し直すため、1 フレームに 1 回） */
function schedulePreview(
  drag: RefObject<Drag | null>,
  g: Drag,
  setDraft: (draft: { pitch: Pitch; edits: Edits }) => void,
) {
  if (g.frame) return;
  g.frame = requestAnimationFrame(() => {
    g.frame = 0;
    if (drag.current !== g) return;
    setDraft({ pitch: g.compute(g.lastX, g.lastY, g), edits: g.edits });
  });
}

/** ドラッグを終える（予約済みのプレビュー更新も取り消す） */
function stopDrag(drag: RefObject<Drag | null>) {
  if (drag.current?.frame) cancelAnimationFrame(drag.current.frame);
  drag.current = null;
}

/** ドラッグ中に点を編集しようとした時の案内 */
const DRAG_NOTICE = "ドラッグ中は点を編集できません。離してから操作してください。";

/** ノートを切り替えた時などに、確定前のビブラートの入力を反映できなかった時の案内 */
const LOST_NOTICE = "確定前のビブラートの入力は、反映できなかったため取り消しました。";

/**
 * フォーカスのあった要素が消えるなどして、どこにもフォーカスが無いか。フォーカスのある要素が
 * disabled になった場合も含める（ブラウザが後でフォーカスを外すため）
 */
const lostFocus = () => {
  const el = document.activeElement;
  return !el || el === document.body || el.matches(":disabled");
};

/** 押せる「元に戻す」「やり直す」のボタン（target がその中なら、そのボタン） */
const historyButton = (target: EventTarget | null) =>
  target instanceof Element ? target.closest("[data-history-action]:not(:disabled)") : null;

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

const VIBRATO_FIELDS: [keyof Vibrato, string][] = [
  ["length", "長さ (%)"],
  ["period", "周期 (ms)"],
  ["depth", "深さ (cent)"],
  ["in", "フェードイン (%)"],
  ["out", "フェードアウト (%)"],
  ["shift", "位相 (%)"],
  ["drift", "ドリフト"],
  ["vol_link", "音量連動"],
];

export function useManualPitch(
  part: VoicePart,
  tempos: readonly Tempo[],
  cam: Camera,
  selected: ReadonlySet<number>,
  panMode: boolean,
  /** 「ピッチカーブを表示」。オフのときは点を出さない（見えない曲線を動かさないため） */
  showPitch: boolean,
  /** 描画範囲（鍵盤とルーラーを除く）の大きさ。範囲外の点は Tab で移れないようにする */
  viewport: { width: number; height: number },
) {
  const note = selected.size === 1 ? part.notes.find((n) => selected.has(n.index)) : undefined;
  const axis = useMemo(() => new TimeAxis(tempos), [tempos]);
  const theme = useRollTheme();
  const edits = useEditStore((s) => s.edits);
  const [active, setActive] = useState(0);
  // プレビューは作成時の編集状態と一緒に保持し、Undo などで編集が変わったら描画時に無効とみなす
  const [draft, setDraft] = useState<{ pitch: Pitch; edits: Edits } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 操作が受け付けられなかった理由の案内（エラーではないもの） */
  const [notice, setNotice] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  /** キーボードで点を消した後にフォーカスする点の番号（-1 はピアノロール） */
  const focusAfter = useRef<number | null>(null);
  /**
   * 編集が変わる直前にフォーカスのあった点の番号と、ピアノロールの要素。
   * Ctrl+Z などで点のボタンが消えてフォーカスが外れたら、近くの点（無ければピアノロール）へ戻す
   */
  const keepFocus = useRef<{ index: number; section: HTMLElement | null } | null>(null);
  useEffect(
    () =>
      useEditStore.subscribe(() => {
        const container = overlayRef.current;
        const focused = document.activeElement;
        if (!container || !(focused instanceof HTMLButtonElement)) return;
        const index = [...container.querySelectorAll("button")].indexOf(focused);
        if (index >= 0) keepFocus.current = { index, section: container.closest("section") };
      }),
    [],
  );
  useEffect(() => {
    const keep = keepFocus.current;
    keepFocus.current = null;
    const index = focusAfter.current ?? (lostFocus() ? keep?.index : null);
    if (index === null || index === undefined) return;
    focusAfter.current = null;
    const container = overlayRef.current;
    const buttons = container?.querySelectorAll<HTMLButtonElement>("button");
    const button = buttons?.[Math.min(index, buttons.length - 1)];
    // 描画範囲の外の点（Tab で移れない点）には移さず、ピアノロールへ戻す
    const target =
      // 押せない点（並べ替えが必要な時の disabled）にも移さない（focus が効かず、フォーカスが無くなるため）
      button && button.tabIndex !== -1 && !button.disabled
        ? button
        : (container?.closest<HTMLElement>("section") ?? keep?.section);
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
    setNotice(null);
  }
  // 表示の切り替えや表示移動モードで点のボタンが消えると、pointerup が届かずドラッグが残るため、
  // そのときもプレビューを描画時に片付ける
  const dragContext = `${showPitch}:${panMode}`;
  const [contextShown, setContextShown] = useState(dragContext);
  if (contextShown !== dragContext) {
    setContextShown(dragContext);
    setDraft(null);
  }
  // ノートが変わった時（Ctrl+A など）や上の切り替えで点のボタンが消えても、ドラッグ状態を残さない
  useEffect(() => {
    stopDrag(drag);
  }, [noteId, showPitch, panMode]);
  // ドラッグ開始時から編集が変わった時（ドラッグ中の Ctrl+Z など）も片付ける。ドラッグ中の点が
  // 消えると pointerup が届かないうえ、離しても確定しない（ドラッグ開始時と編集が違う）ため。
  // 押した時に確定したビブラートの入力は開始時の編集に含まれるので、ドラッグを止めない
  useEffect(() => {
    if (drag.current && drag.current.edits !== edits) stopDrag(drag);
  }, [edits]);
  /**
   * 最新の表示位置（スクロール・拡大率）。ドラッグのプレビューは後のフレームで計算するため、
   * ドラッグ中にスクロールしても、その時点の表示位置で計算できるよう ref で持つ
   */
  const camRef = useRef(cam);
  useEffect(() => {
    camRef.current = cam;
  });
  // ドラッグ中にスクロール・拡大縮小したら、ポインターを動かさなくてもプレビューを計算し直す
  useEffect(() => {
    const g = drag.current;
    if (g?.moved) schedulePreview(drag, g, setDraft);
  }, [cam.pxPerTick, cam.scrollTick, cam.scrollY]);
  /**
   * 長押し中の矢印キーの目印と、その長押しを始めた点の番号。同じ目印の移動は 1 つの操作にまとめる。
   * 押したまま別の点へフォーカスを移すとキーリピートしか届かないため、点の番号でも区別する
   */
  const hold = useRef<{ id: string; note: string | null; index: number } | null>(null);
  /** ドラッグをやめる。ドラッグ中に出した案内も消す */
  const cancel = () => {
    stopDrag(drag);
    setDraft(null);
    setNotice(null);
  };
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && drag.current) {
        e.preventDefault();
        e.stopPropagation();
        stopDrag(drag);
        setDraft(null);
        setNotice(null);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  const preview = draft && draft.edits === edits ? draft.pitch : null;
  // パート全体のピッチの計算は重いため、プレビューが変わった時だけ計算し直す
  // （スクロールなど関係のない再描画では使い回す）
  const previewPitch = useMemo(
    () =>
      preview && note
        ? renderPartPitch(
            {
              ...part,
              notes: part.notes.map((n) => (n.index === note.index ? { ...n, pitch: preview } : n)),
            },
            axis,
          )
        : null,
    [preview, note, part, axis],
  );
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
          <output className="mt-1 block text-xs empty:hidden">{notice}</output>
        </section>
      ),
      previewPitch: null,
    };
  }
  const target = note;
  const key = noteKey(part.index, target.index);
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
  // パネルのピッチ点の操作も、曲線が見えている（「ピッチカーブを表示」がオン）ときだけ使える
  const editable = !locked && showPitch;
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
    if (!quiet) {
      setError(null);
      setNotice(null);
    }
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
    if (locked) return false;
    // ドラッグ中（別の指でパネルを操作した時など）は、黙って無視せず理由を出す
    if (drag.current) {
      setNotice(DRAG_NOTICE);
      return false;
    }
    return record(label, { pitch: next }, { mergeId });
  };
  const changePoint = (index: number, point: PitchPoint, source = pitch): Pitch => ({
    ...source,
    data: source.data.map((p, i) => (i === index ? point : p)),
  });
  /**
   * ポインター位置にある点の中心の、tick とノートの音高からの高さ（10 cent 単位、丸める前）。
   * 表示位置は計算する時点のものを使う
   */
  const locate = (
    clientX: number,
    clientY: number,
    g: Pick<Drag, "section" | "offsetX" | "offsetY">,
  ) => {
    if (!g.section) return null;
    const origin = drawingOrigin(g.section);
    const x = clientX + g.offsetX - origin.left - KEY_WIDTH;
    const y = clientY + g.offsetY - origin.top - RULER_HEIGHT;
    const view = camRef.current;
    return {
      tick: xToTick(x, view),
      height: ((centsToY(adjustedTone(target) * 100, view) - y) / ROW_HEIGHT) * 10,
    };
  };
  const move = (clientX: number, clientY: number, g: Drag) => {
    const at = locate(clientX, clientY, g);
    if (!at) return g.pitch;
    const old = g.pitch.data[g.index];
    // 片方の向きにだけ動かした時は、もう片方の値を変えない（読み込んだ点の端数を丸めてしまわないよう）。
    // 横は 1 px 未満、縦は丸めても値が変わらない幅（半単位 = 5 cent）未満の動きを「動かしていない」とする
    const keepX = Math.abs(at.tick - g.startTick) * camRef.current.pxPerTick < 1;
    const keepY = Math.abs(at.height - g.startHeight) < 0.5;
    return changePoint(
      g.index,
      {
        ...old,
        x: keepX
          ? old.x
          : clampPointTime(
              g.pitch.data,
              g.index,
              pointTime(axis, part.position, target.position, at.tick),
            ),
        // 自動接続で高さが決まる点（並べ替え後は先頭）は高さを変えない
        y: (g.index === 0 && g.pitch.snap_first) || keepY ? old.y : Math.round(at.height),
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
  /**
   * 点の描画位置と、描画範囲の中にあるか。範囲の外の点は Tab で移れず、キーでも編集しない
   * （見えないまま動かしたり消したりしないため）
   */
  const placeOf = (p: PitchPoint) => {
    // 曲線の計算（renderPartPitch）と同じく tick に丸め、点と曲線の折れ目をそろえる
    const tick = Math.round(axis.msToTick(startMs + p.x)) - part.position;
    const x = tickToX(tick, cam);
    const y = centsToY(adjustedTone(target) * 100 + p.y * 10, cam);
    return { x, y, visible: x >= 0 && x <= viewport.width && y >= 0 && y <= viewport.height };
  };
  /** 点が描画範囲の外にあるか。外なら、編集しない理由を案内する（キー操作とパネルの操作で共通） */
  const isHidden = (index: number) => {
    const p = displayed[index];
    if (!p || placeOf(p).visible) return false;
    setNotice("表示範囲の外の点は編集できません。点が見える位置までスクロールしてください。");
    return true;
  };
  const pointKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    // Esc（選択の解除）と Ctrl / ⌘ + A（全選択）はピアノロールに任せる。ノートが 1 つだけ選ばれた
    // 状態でなくなり点のボタンが消えるため、選択が変わる前にピアノロールへフォーカスを移す
    if (e.key === "Escape" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a")) {
      e.currentTarget.closest("section")?.focus({ preventScroll: true });
      return;
    }
    // Ctrl+Z などのショートカットは、ピアノロールとツールバーに任せる
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // 点をドラッグしている間の Space は無視する。表示移動モードに入ると、ドラッグが取り消されるため
    if (e.key === " " && drag.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (SELECT_KEYS.includes(e.key)) {
      setActive(index);
      // Space は「押しながらドラッグで表示を移動」にも使うため、ピアノロールへそのまま伝える
      // （意図した動き。点をクリックした後も Space＋ドラッグで表示を動かせるようにするため。
      // 押している間は表示移動モードになる。ピアノロールが既定動作を止めてクリックが起きないので、ここで選ぶ）
      if (e.key !== " ") e.stopPropagation();
      return;
    }
    if (!POINT_KEYS.includes(e.key)) return;
    // Space を押している（表示移動モード）間は点を編集せず、ピアノロールへ任せる（矢印キーで表示を動かす）
    if (panMode) return;
    e.preventDefault();
    e.stopPropagation();
    // ドラッグで点を動かしている間は、キーでは編集しない（確定前のドラッグを土台にしないため）。
    // 選んでいる点も変えず、黙って無視せず理由を出す
    if (drag.current?.moved) {
      setNotice(DRAG_NOTICE);
      return;
    }
    // スクロールで描画範囲の外へ出た点は、フォーカスが残っていてもキーで編集しない
    // （見えないまま動かしたり消したりしないため）
    if (isHidden(index)) return;
    // 点を押しただけで、まだ動かしていないなら、ドラッグをやめてキー操作を受け付ける
    // （ドラッグ中の編集は受け付けないため、押している間のキー操作が黙って失われないようにする）
    if (drag.current && !drag.current.moved) cancel();
    setActive(index);
    if (e.key === "Delete" || e.key === "Backspace") {
      // 長押しでは消さない。消した後はフォーカスが前の点へ移るため、キーリピートで次々と消えてしまう
      if (e.repeat) return;
      // 消せない時（自動接続中の最後の 1 点）は、黙って無視せず理由を出す
      if (!canRemove) {
        setNotice("自動接続中は最後の 1 点を削除できません（OpenUtau で開けなくなるため）。");
        return;
      }
      // 消した点のボタンが無くなってもキーボード操作を続けられるよう、前の点へフォーカスを移す
      if (remove(index)) focusAfter.current = pitch.data.length > 1 ? Math.max(0, index - 1) : -1;
      return;
    }
    const p = pitch.data[index];
    // 1 回で横 5 ms・縦 10 cent。Shift を押しながらなら 10 倍（50 ms・100 cent）
    const step = e.shiftKey ? 10 : 1;
    const dx = (e.key === "ArrowLeft" ? -5 : e.key === "ArrowRight" ? 5 : 0) * step;
    const dy = (e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0) * step;
    // 自動接続中の先頭点は高さが決まっているため、上下キーでは動かない。黙って無視せず理由を出す
    if (index === snapIndex && dx === 0) {
      setNotice(
        "自動接続中の先頭点は高さを変えられません。「先頭点を前のノートに接続」を外すと編集できます。",
      );
      return;
    }
    const x = clampPointTime(pitch.data, index, p.x + dx);
    // 隣の点に追いついて横に動けない時も、黙って無視せず理由を出す
    if (dx !== 0 && x === p.x) {
      setNotice("隣の点を越えて動かすことはできません。");
      return;
    }
    // 長押し（キーリピート）中の移動は、履歴を埋めないよう同じ長押しの最初の移動とまとめる
    if (!e.repeat || hold.current?.note !== noteId || hold.current.index !== index) {
      hold.current = { id: `hold-${++holdSeq}`, note: noteId, index };
    }
    apply(
      changePoint(index, { ...p, x, y: index === snapIndex ? p.y : p.y + dy }),
      "ピッチ点を移動",
      hold.current.id,
    );
  };
  const points = displayed.map((p, i) => {
    const { x, y, visible } = placeOf(p);
    const isActive = activeIndex === i;
    return (
      <button
        key={i}
        type="button"
        aria-label={`ピッチ点 ${i + 1}`}
        aria-pressed={isActive}
        disabled={locked}
        tabIndex={visible ? undefined : -1}
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
        onBlur={() => {
          hold.current = null;
        }}
        onClick={() => {
          setActive(i);
          setNotice(null);
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          // disabled のボタンにも pointer イベントは届くため、ロック中はここで止める。
          // ピアノロールにも伝えない（意図した動き）。伝えると、点を動かすつもりのドラッグで
          // 選んでいるノート自体が動いてしまうため。点の上で他のノートを選んだり矩形選択を
          // 始めたりはできないが、並べ替えの案内を出しているので、並べ替えれば普段どおり使える
          if (locked) return;
          // 別の指などで点をドラッグしている間は、ほかのポインターで新しいドラッグを始めない
          // （始めると、まだ離していない前のドラッグの移動まで一緒に確定してしまうため）
          if (drag.current && drag.current.id !== e.pointerId) return;
          // フォーカスを移すと、ビブラート欄の確定前の入力がここで（同期的に）確定する。
          // その後の編集をドラッグ開始時の編集として取るため、先にフォーカスを移す
          e.currentTarget.focus({ preventScroll: true });
          e.currentTarget.setPointerCapture(e.pointerId);
          setActive(i);
          setNotice(null);
          const box = e.currentTarget.getBoundingClientRect();
          const grip = {
            offsetX: box.left + box.width / 2 - e.clientX,
            offsetY: box.top + box.height / 2 - e.clientY,
            section: e.currentTarget.closest("section"),
          };
          const start = locate(e.clientX, e.clientY, grip);
          drag.current = {
            id: e.pointerId,
            index: i,
            // 土台はプレビューではなく記録済みのピッチにする（確定していない移動を含めないため）
            pitch: sortPitchPoints(target.pitch),
            compute: move,
            edits: useEditStore.getState().edits,
            part: part.index,
            note: target.index,
            x: e.clientX,
            y: e.clientY,
            ...grip,
            startTick: start?.tick ?? 0,
            startHeight: start?.height ?? 0,
            moved: false,
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
            schedulePreview(drag, g, setDraft);
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
  const commitVibrato = (field: keyof Vibrato, value: number, quiet: boolean) => {
    const vibrato = { ...target.vibrato, [field]: value };
    // フェードインとフェードアウトは合計 100% まで。後から入力した方を優先し、もう片方を削る
    if (field === "in") vibrato.out = Math.min(vibrato.out, 100 - clamp(value, 0, 100));
    if (field === "out") vibrato.in = Math.min(vibrato.in, 100 - clamp(value, 0, 100));
    return record("ビブラートを変更", { vibrato }, { quiet });
  };
  const controls = (
    <section aria-label="手動ピッチ編集" className="space-y-2 rounded-lg border p-3 text-sm">
      <p>
        手動ピッチ編集：点の位置はノート先頭からのミリ秒、音高は 10 cent
        単位です。点をドラッグ、または矢印キー（横 5 ms・縦 10 cent。Shift で 10
        倍）で移動できます。
        {!showPitch && "「ピッチカーブを表示」をオンにすると、ピッチ点を表示・編集できます。"}
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
            disabled={!showPitch}
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
          disabled={!editable}
          onClick={() => {
            const data = [
              ...pitch.data,
              { x: (pitch.data.at(-1)?.x ?? -100) + 100, y: 0, shape: "io" as const },
            ];
            if (!apply({ ...pitch, data }, "ピッチ点を追加")) return;
            setActive(data.length - 1);
            // 追加した点が描画範囲の外なら、見えないまま気づかずに編集しないよう知らせる
            if (!placeOf(data[data.length - 1]).visible) {
              setNotice("追加した点は表示範囲の外にあります。スクロールして確かめてください。");
            }
          }}
        >
          ピッチ点を追加
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!editable || !canRemove}
          onClick={() => {
            // 選んでいる点が見えない時は、パネルからも消さない（キー操作と同じく）
            if (!isHidden(activeIndex)) remove(activeIndex);
          }}
        >
          ピッチ点を削除
        </Button>
        {pitch.data.length > 0 && (
          <label>
            補間{" "}
            <select
              aria-label="ピッチ点の補間"
              className="h-8 rounded-md border bg-card px-1"
              disabled={!editable}
              value={pitch.data[activeIndex].shape}
              onChange={(e) => {
                // 選んでいる点が見えない時は、パネルからも変えない（キー操作と同じく）
                if (isHidden(activeIndex)) return;
                apply(
                  changePoint(activeIndex, {
                    ...pitch.data[activeIndex],
                    shape: e.target.value as PitchPoint["shape"],
                  }),
                  "ピッチ点の補間を変更",
                );
              }}
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
            disabled={!editable || !pitch.data.length}
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
      {pitch.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          このノートにはピッチ点がありません。「ピッチ点を追加」で追加できます。
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        自動接続中は先頭点の音高が前のノートとの音高差に置き換わります。解除すると自由に編集できます。
        {pitch.snap_first &&
          pitch.data.length === 1 &&
          " 自動接続中は最後の 1 点を削除できません（OpenUtau で開けなくなるため）。"}
      </p>
      <fieldset>
        <legend>ビブラート</legend>
        <div className="flex flex-wrap gap-2">
          {VIBRATO_FIELDS.map(([field, label]) => (
            <VibratoInput
              key={`${part.index}:${target.index}:${field}`}
              label={label}
              value={target.vibrato[field]}
              onCommit={(value, quiet) => commitVibrato(field, value, quiet)}
              onLost={() => setNotice(LOST_NOTICE)}
            />
          ))}
        </div>
      </fieldset>
      <output className="block text-xs text-muted-foreground empty:hidden">{notice}</output>
      {error && (
        <Alert tone="error" title="編集できませんでした">
          {error}
        </Alert>
      )}
    </section>
  );
  return { overlay, controls, previewPitch };
}

/** 「元に戻す」「やり直す」の上で離してから、クリックが届くのを待つ時間 */
const CLICK_WAIT_MS = 1000;

const isNumberText = (text: string | null): text is string =>
  text !== null && text.trim() !== "" && Number.isFinite(Number(text));

function VibratoInput({
  label,
  value,
  onCommit,
  onLost,
}: {
  label: string;
  value: number;
  /**
   * 確定する。記録できたら true。quiet：入力欄が消える時の確定。対象のノートがもう無いことも
   * あるため、失敗してもエラーは表示しない（代わりに onLost で知らせる）
   */
  onCommit: (value: number, quiet: boolean) => boolean;
  /** 入力欄が消える時に、確定前の入力を反映できなかった（数値でない・記録できない） */
  onLost: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  /** 確定前の入力を「やり直す」「元に戻す」で取り消した時の、その操作（案内に使う） */
  const [dropped, setDropped] = useState<"元に戻した" | "やり直した" | null>(null);
  // 確定前の入力。Enter・Tab で確定する前に入力欄が消えた場合（別のノートを選んだ時など）も確定させる
  const pending = useRef<string | null>(null);
  const commitRef = useRef(onCommit);
  const lostRef = useRef(onLost);
  const valueRef = useRef(value);
  useEffect(() => {
    commitRef.current = onCommit;
    lostRef.current = onLost;
    valueRef.current = value;
  });
  useEffect(
    () => () => {
      const text = pending.current;
      if (text === null) return;
      // 反映できなかった入力は、黙って捨てずに知らせる
      if (!isNumberText(text) || !commitRef.current(Number(text), true)) lostRef.current();
    },
    [],
  );
  /**
   * 「元に戻す」「やり直す」を押している間は、確定を保留する。確定すると新しい編集になり、
   * やり直しの履歴が消えるため。「元に戻す」を押した場合は、記録済みの編集を戻さずに
   * 確定前の入力だけを取り消す（テキストエディタと同じく、まず直前の入力を戻す）。
   * 「やり直す」が実際に行われたら入力を捨て、クリックをやめた（ボタンの外で離した）場合は
   * 通常どおり確定する。pointerdown は blur より先に起きるため、ボタンにフォーカスが移らない
   * ブラウザ（Safari など）でも働く。値は押したボタン（押していなければ null）
   */
  const awaitingHistory = useRef<Element | null>(null);
  /** ボタンの上で離した後、クリックが届かなかった場合に確定するためのタイマー */
  const clickTimer = useRef(0);
  /**
   * ポインターを押している間か。押した時のフォーカスの移動は document の pointerdown の処理で扱うため、
   * blur で「キーボードで履歴ボタンへ移った」とみなさない（右クリックでもフォーカスは移る）
   */
  const pressing = useRef(false);
  const discard = () => {
    awaitingHistory.current = null;
    clearTimeout(clickTimer.current);
    pending.current = null;
    setDraft(null);
    setInvalid(false);
  };
  const flush = (quiet: boolean) => {
    const text = pending.current;
    pending.current = null;
    if (isNumberText(text)) commitRef.current(Number(text), quiet);
    // 数値でない入力（空欄など）は元の値に戻し、理由を表示する
    setInvalid(text !== null && !isNumberText(text));
    setDraft(null);
  };
  const flushRef = useRef(flush);
  const discardRef = useRef(discard);
  useEffect(() => {
    flushRef.current = flush;
    discardRef.current = discard;
  });
  useEffect(() => {
    const onPointerDown = (e: globalThis.PointerEvent) => {
      pressing.current = true;
      // 右クリック・中クリックではボタンが押されない（click が届かない）ため、保留しない
      const button = historyButton(e.target);
      if (e.button === 0 && pending.current !== null && button) {
        awaitingHistory.current = button;
      }
    };
    // キーボードで履歴ボタンへ移って保留している間に、押さずにフォーカスを外したら確定する
    // （別の履歴ボタンへ移った時は、そのボタンで引き続き保留する）
    const onFocusOut = (e: FocusEvent) => {
      const button = awaitingHistory.current;
      if (!button || e.target !== button) return;
      const next = historyButton(e.relatedTarget);
      if (next) awaitingHistory.current = next;
      else commitNow();
    };
    const commitNow = () => {
      awaitingHistory.current = null;
      clearTimeout(clickTimer.current);
      flushRef.current(false);
    };
    const onPointerUp = (e: globalThis.PointerEvent) => {
      pressing.current = false;
      const button = awaitingHistory.current;
      if (!button) return;
      // ボタンの外で離した（押すのをやめた）なら、すぐに確定する。タッチでは pointerup の target が
      // 押した要素のままになるため、離した位置の要素で確かめる
      const released = document.elementFromPoint(e.clientX, e.clientY);
      if (!released || !button.contains(released)) {
        commitNow();
        return;
      }
      // ボタンの上で離したら、クリック（取り消し・やり直しの実行）を待つ。タッチではクリックが
      // pointerup より後のタスクで届くことがあるため、すぐには確定しない。届かなければ確定する
      clearTimeout(clickTimer.current);
      clickTimer.current = window.setTimeout(() => {
        if (awaitingHistory.current) commitNow();
      }, CLICK_WAIT_MS);
    };
    const onPointerCancel = () => {
      pressing.current = false;
      if (awaitingHistory.current) commitNow();
    };
    // 「元に戻す」のクリックは、ボタンに届く前（document の capture 段階）で止めて、入力だけを取り消す。
    // 入力が今の値と同じ（取り消しても何も変わらない）なら止めずに、通常どおり元に戻す
    // （元に戻すと、下の編集ストアの購読で入力を捨てる）
    const onClick = (e: MouseEvent) => {
      const text = pending.current;
      if (isNumberText(text) && Number(text) === valueRef.current) return;
      if (
        awaitingHistory.current?.matches('[data-history-action="undo"]:not(:disabled)') &&
        e.target instanceof Element &&
        awaitingHistory.current.contains(e.target)
      ) {
        e.stopPropagation();
        e.preventDefault();
        discardRef.current();
      }
    };
    const unsubscribe = useEditStore.subscribe((state, prev) => {
      if (!awaitingHistory.current) return;
      if (state.undoStack === prev.undoStack && state.redoStack === prev.redoStack) return;
      // やり直すと入力は捨てる（確定すると新しい編集になり、やり直した内容を上書きするため）。
      // 履歴ボタンにフォーカスしたまま Ctrl+Z を押した時など、元に戻した場合も同じく捨てる。
      // 今の値と違う入力を捨てた時は、黙って消さずに、どちらの操作で捨てたかを案内する
      const text = pending.current;
      const lost = isNumberText(text) && Number(text) !== valueRef.current;
      discardRef.current();
      if (lost) {
        // 元に戻すと、戻した編集がやり直しの履歴に積まれる
        setDropped(state.redoStack.length > prev.redoStack.length ? "元に戻した" : "やり直した");
      }
    });
    // 確定前の入力は記録済みの編集に含まれず、ページを閉じる前の確認の対象にならないため、ここで確認を出す
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isNumberText(pending.current)) return;
      e.preventDefault();
      // 古いブラウザは returnValue の設定で確認を出す
      e.returnValue = "";
    };
    // pointerup が届かない場合（コンテキストメニューやウィンドウの外で離した時など）に押したままと
    // みなし続けないよう、キーを押した時とウィンドウからフォーカスが外れた時にも戻す
    // （Tab の keydown は入力欄の blur より先に届くため、Tab での移動はキーボードの操作とみなせる）
    const release = () => {
      pressing.current = false;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("keydown", release, true);
    window.addEventListener("blur", release);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerCancel, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("focusout", onFocusOut, true);
    return () => {
      document.removeEventListener("focusout", onFocusOut, true);
      unsubscribe();
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("keydown", release, true);
      window.removeEventListener("blur", release);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerCancel, true);
      document.removeEventListener("click", onClick, true);
      clearTimeout(clickTimer.current);
    };
  }, []);
  const errorId = useId();
  return (
    <label>
      {label}{" "}
      <input
        aria-label={`ビブラート ${label}`}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        className="h-8 w-20 rounded-md border bg-card px-1"
        type="number"
        step="any"
        value={draft ?? String(value)}
        onChange={(e) => {
          pending.current = e.target.value;
          setDraft(e.target.value);
          setInvalid(false);
          setDropped(null);
        }}
        onBlur={(e) => {
          // 履歴ボタンを押している間は、離すまで確定を保留する
          if (awaitingHistory.current) return;
          // Tab で「元に戻す」「やり直す」へ移った時も、押す（Enter・Space）か離れるまで保留する
          const button = pressing.current ? null : historyButton(e.relatedTarget);
          if (button && pending.current !== null) {
            awaitingHistory.current = button;
            return;
          }
          flush(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            discard();
            e.currentTarget.blur();
          } else if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {invalid && (
        <span id={errorId} role="alert" className="ml-1 text-xs text-destructive">
          数値を入力してください（元の値に戻しました）
        </span>
      )}
      {dropped && (
        <output className="ml-1 text-xs text-muted-foreground">
          {dropped}ため、確定前の入力を取り消しました
        </output>
      )}
    </label>
  );
}
