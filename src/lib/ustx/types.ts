import { z } from "zod";

/**
 * USTX の読み取り用スキーマ。
 * OpenUtau（YamlDotNet）は欠損フィールドを既定値で補うため、ここでも同じ既定値を与える。
 * このスキーマは表示・計算用のビューを作るためだけに使い、書き出しは元の YAML 文書を基にする
 * （未対応フィールドを落とさないため）。
 */

const finite = z.number().finite();
const int = z.number().int();

export const pitchShapeSchema = z.enum(["io", "l", "i", "o", "sp"]);
export type PitchShape = z.infer<typeof pitchShapeSchema>;

export const pitchPointSchema = z.object({
  /** ノート先頭からの相対位置（ミリ秒） */
  x: finite,
  /** ノートの音高からの相対値（0.1 半音 = 10 cent 単位） */
  y: finite,
  shape: pitchShapeSchema.default("io"),
});
export type PitchPoint = z.infer<typeof pitchPointSchema>;

export const vibratoSchema = z.object({
  /** ノート長に対する割合（%） */
  length: finite.default(0),
  /** 周期（ミリ秒） */
  period: finite.default(175),
  /** 深さ（cent） */
  depth: finite.default(25),
  /** ビブラート長に対するフェードイン割合（%） */
  in: finite.default(10),
  /** ビブラート長に対するフェードアウト割合（%） */
  out: finite.default(10),
  /** 位相（周期に対する %） */
  shift: finite.default(0),
  drift: finite.default(0),
  vol_link: finite.default(0),
});
export type Vibrato = z.infer<typeof vibratoSchema>;

export const noteSchema = z.object({
  position: int,
  duration: int,
  tone: int,
  /** 数字だけの歌詞などが数値として解釈されても文字列として扱う */
  lyric: z
    .union([z.string(), z.number(), z.boolean()])
    .transform(String)
    .default("a"),
  tuning: finite.default(0),
  pitch: z
    .object({
      data: z.array(pitchPointSchema).default([]),
      snap_first: z.boolean().default(true),
    })
    .default({ data: [], snap_first: true }),
  vibrato: vibratoSchema.default(vibratoSchema.parse({})),
});
export type RawNote = z.infer<typeof noteSchema>;

export const curveSchema = z.object({
  abbr: z.string(),
  xs: z.array(int).default([]),
  ys: z.array(int).default([]),
});
export type Curve = z.infer<typeof curveSchema>;

export const voicePartSchema = z.object({
  name: z.string().default("New Part"),
  comment: z.string().nullish(),
  track_no: int.default(0),
  position: int.default(0),
  duration: int.default(0),
  notes: z.array(noteSchema).default([]),
  curves: z.array(curveSchema).default([]),
});
export type RawVoicePart = z.infer<typeof voicePartSchema>;

export const tempoSchema = z.object({
  position: int,
  bpm: finite.positive(),
});
export type Tempo = z.infer<typeof tempoSchema>;

export const timeSignatureSchema = z.object({
  bar_position: int,
  beat_per_bar: int.positive(),
  beat_unit: int.positive(),
});
export type TimeSignature = z.infer<typeof timeSignatureSchema>;

export const trackSchema = z.object({
  singer: z.string().nullish(),
  track_name: z.string().default("New Track"),
  track_color: z.string().default("Blue"),
  mute: z.boolean().default(false),
  solo: z.boolean().default(false),
});
export type RawTrack = z.infer<typeof trackSchema>;

export const projectSchema = z.object({
  name: z.string().default("New Project"),
  comment: z.string().nullish(),
  // ustx_version は "0.10" が数値 0.1 と解釈されてしまうため、ここでは型を問わず受け取り、原文から別途取得する
  ustx_version: z.unknown(),
  bpm: finite.positive().default(120),
  beat_per_bar: int.positive().default(4),
  beat_unit: int.positive().default(4),
  key: int.default(0),
  time_signatures: z.array(timeSignatureSchema).optional(),
  tempos: z.array(tempoSchema).optional(),
  tracks: z.array(trackSchema).default([]),
  voice_parts: z.array(voicePartSchema).default([]),
  wave_parts: z.array(z.unknown()).default([]),
});
export type RawProject = z.infer<typeof projectSchema>;
