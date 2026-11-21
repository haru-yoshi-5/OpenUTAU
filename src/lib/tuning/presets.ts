import type { NoteEdit } from "../ustx/edits";
import type { Note } from "../ustx/load";
import type { TimeAxis } from "../ustx/time-axis";
import {
  type Attack,
  composePitch,
  DEFAULT_TRANSITION_MS,
  type FallParams,
  type VibratoParams,
  vibratoFor,
} from "./techniques";

/*
 * 表現プリセット（「自然」「力強く」「切なく」）。テクニックとパラメータの組み合わせとして定義する。
 * AI（Phase 4）は、このプリセットの種類と強さを提案する役割にとどめる。
 *
 * 強さ（0〜1）の意味：
 * - 効果の深さ（しゃくり・オーバーシュート・フォールの深さ、ビブラートの長さと深さ）を比例させ、
 *   音程遷移の長さを OpenUtau の新規ノートの既定値（80ms）からプリセットの値へ近づける
 * - 0 なら何も変えない。0 より大きければ、選んだノートのピッチ点は強さに関係なくプリセットの曲線に
 *   置き換わる（元のピッチ点と混ぜるのではない）。手で調声した曲線を残したいノートは選ばない
 */

export type ExpressionId = "natural" | "strong" | "wistful";
/** テクニックを 1 つだけ当てる「個別プリセット」 */
export type TechniqueId = "smooth" | "scoop" | "overshoot" | "fall" | "vibrato";
export type PresetId = ExpressionId | TechniqueId;

interface ExpressionPreset {
  label: string;
  description: string;
  /** ノートの入り。無ければピッチ点は変えない（ビブラートだけのプリセット） */
  attack?: Attack;
  /** フレーズの終わり（次のノートとの間に隙間がある、または最後のノート）に付けるフォール */
  phraseEndFall?: FallParams;
  /** 選んだすべてのノートの終わりに付けるフォール（個別プリセット用） */
  everyNoteFall?: FallParams;
  /**
   * これ以上長いノート（ms）にだけビブラートを付ける。短いノートのビブラートは変えない。
   * 120 BPM の 4 分音符（500ms）には付けず、2 分音符（1000ms）前後から付く値にする
   */
  vibrato?: VibratoParams & { minNoteMs: number };
}

export const EXPRESSION_PRESETS: Readonly<Record<ExpressionId, ExpressionPreset>> = {
  natural: {
    label: "自然",
    description: "音と音を少しなめらかにつなぎ、長い音に控えめなビブラートを付けます。",
    attack: { kind: "transition", params: { lengthMs: 110 } },
    vibrato: {
      minNoteMs: 700,
      lengthPct: 50,
      periodMs: 180,
      depthCents: 20,
      fadeInPct: 30,
      fadeOutPct: 15,
    },
  },
  strong: {
    label: "力強く",
    description: "音の入りを素早くし、少し上に越えてから落ち着かせます。ビブラートは深めです。",
    attack: { kind: "overshoot", params: { transitionMs: 50, depth: 0.6, lengthMs: 90 } },
    vibrato: {
      minNoteMs: 800,
      lengthPct: 40,
      periodMs: 160,
      depthCents: 35,
      fadeInPct: 15,
      fadeOutPct: 10,
    },
  },
  wistful: {
    label: "切なく",
    description:
      "下からしゃくり上げて入り、フレーズの終わりで音を落とします。ビブラートはゆったりです。",
    attack: { kind: "scoop", params: { transitionMs: 80, depth: 1, lengthMs: 120 } },
    phraseEndFall: { depth: 1.5, lengthMs: 180 },
    vibrato: {
      minNoteMs: 650,
      lengthPct: 60,
      periodMs: 210,
      depthCents: 25,
      fadeInPct: 45,
      fadeOutPct: 15,
    },
  },
};

/** 個別プリセットのビブラート（「自然」と同じ控えめな値）。長い音にだけ付ける */
const SINGLE_VIBRATO = {
  minNoteMs: 650,
  lengthPct: 55,
  periodMs: 185,
  depthCents: 25,
  fadeInPct: 30,
  fadeOutPct: 15,
};

/**
 * 個別プリセット。テクニックを 1 つだけ当てる。ピッチ点を作るものは、ほかの部分を OpenUtau の
 * 既定の音程遷移（80ms）にそろえる（ピッチ点はノートごとに置き換わるため）。
 */
export const TECHNIQUE_PRESETS: Readonly<Record<TechniqueId, ExpressionPreset>> = {
  smooth: {
    label: "なめらかな遷移",
    description: "前の音から時間をかけて移り、音と音をなめらかにつなぎます。",
    attack: { kind: "transition", params: { lengthMs: 160 } },
  },
  scoop: {
    label: "しゃくり",
    description: "下からしゃくり上げて音に入ります。",
    attack: { kind: "scoop", params: { transitionMs: 80, depth: 1, lengthMs: 120 } },
  },
  overshoot: {
    label: "オーバーシュート",
    description: "目標の音を少し越えてから落ち着かせ、音の頭を強調します。",
    attack: { kind: "overshoot", params: { transitionMs: 60, depth: 0.6, lengthMs: 90 } },
  },
  fall: {
    label: "フォール",
    description: "選んだ各ノートの終わりで音を落とします。",
    attack: { kind: "transition", params: { lengthMs: DEFAULT_TRANSITION_MS } },
    everyNoteFall: { depth: 1.5, lengthMs: 180 },
  },
  vibrato: {
    label: "ビブラート",
    description: "長い音にビブラートを付けます。ピッチ点は変えません。",
    vibrato: SINGLE_VIBRATO,
  },
};

export const PRESETS: Readonly<Record<PresetId, ExpressionPreset>> = {
  ...EXPRESSION_PRESETS,
  ...TECHNIQUE_PRESETS,
};

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/** しゃくり・オーバーシュートの、音程遷移の長さと深さを強さに合わせる（戻る時間は変えない） */
function scaleBend<T extends { transitionMs: number; depth: number; lengthMs: number }>(
  params: T,
  strength: number,
): T {
  return {
    ...params,
    transitionMs: lerp(DEFAULT_TRANSITION_MS, params.transitionMs, strength),
    depth: params.depth * strength,
  };
}

/** 強さに合わせて入りを弱める。0 なら OpenUtau の既定の音程遷移、1 ならプリセットどおり */
export function scaleAttack(attack: Attack, strength: number): Attack {
  switch (attack.kind) {
    case "transition":
      return {
        kind: "transition",
        params: { lengthMs: lerp(DEFAULT_TRANSITION_MS, attack.params.lengthMs, strength) },
      };
    case "scoop":
      return { kind: "scoop", params: scaleBend(attack.params, strength) };
    case "overshoot":
      return { kind: "overshoot", params: scaleBend(attack.params, strength) };
  }
}

/** 強さに合わせてビブラートを弱める（長さと深さを比例させる。深さは OpenUtau の下限 5 cent まで） */
export function scaleVibrato(params: VibratoParams, strength: number): VibratoParams {
  return {
    ...params,
    lengthPct: params.lengthPct * strength,
    depthCents: Math.max(5, params.depthCents * strength),
  };
}

export interface PresetInput {
  /** パートのノート（position の昇順） */
  notes: readonly Note[];
  /** 適用するノートの Note.index */
  targets: ReadonlySet<number>;
  /** パートの位置（プロジェクト先頭からの tick）。ms への換算に使う */
  partPosition: number;
  timeAxis: TimeAxis;
}

/**
 * 選んだノートに表現プリセットを当てた差分を、Note.index ごとに返す。
 * 返す差分はノートのピッチ点・ビブラート全体で、編集ストアの apply にそのまま渡せる
 * （元と同じ値になった項目は、ストアが差分から外す）。
 */
export function generatePresetEdits(
  input: PresetInput,
  id: PresetId,
  strength: number,
): Map<number, NoteEdit> {
  const edits = new Map<number, NoteEdit>();
  const s = Math.min(1, Math.max(0, strength));
  if (s === 0 || !Number.isFinite(strength)) return edits;

  const preset = PRESETS[id];
  const attack = preset.attack && scaleAttack(preset.attack, s);
  const { notes, targets, partPosition, timeAxis } = input;

  notes.forEach((note, i) => {
    if (!targets.has(note.index)) return;
    const start = partPosition + note.position;
    const durationMs = timeAxis.tickToMs(start + note.duration) - timeAxis.tickToMs(start);
    const prev = notes[i - 1];
    const next = notes[i + 1];
    // OpenUtau と同じく、前のノートの終わりがちょうどこのノートの頭のときだけ「つながっている」とみなす
    const hasPrev = prev !== undefined && prev.position + prev.duration === note.position;
    const isPhraseEnd = !next || next.position > note.position + note.duration;
    const fallParams = preset.everyNoteFall ?? (isPhraseEnd ? preset.phraseEndFall : undefined);
    const fall = fallParams && { ...fallParams, depth: fallParams.depth * s };

    const edit: NoteEdit = {};
    if (attack) edit.pitch = composePitch(attack, durationMs, fall, hasPrev);
    if (preset.vibrato && durationMs >= preset.vibrato.minNoteMs) {
      const { minNoteMs: _, ...params } = preset.vibrato;
      edit.vibrato = vibratoFor(scaleVibrato(params, s), note.vibrato);
    }
    if (edit.pitch || edit.vibrato) edits.set(note.index, edit);
  });
  return edits;
}
