import {
  type Document,
  type DocumentOptions,
  isAlias,
  isCollection,
  isMap,
  isScalar,
  type ParseOptions,
  parseAllDocuments,
  type SchemaOptions,
  visit,
} from "yaml";
import type { z } from "zod";
import { UstxError } from "./errors";
import {
  type Curve,
  projectSchema,
  type RawNote,
  type RawProject,
  type Tempo,
  type TimeSignature,
} from "./types";
import {
  compareVersion,
  LATEST_SUPPORTED,
  parseVersion,
  TEMPO_MAP_SINCE,
  type UstxVersion,
} from "./version";

export const LIMITS = {
  /** 一般的な USTX は数 MB 以内。巨大ファイルによるブラウザの停止を防ぐ */
  maxFileBytes: 20 * 1024 * 1024,
  maxVoiceParts: 1000,
  maxNotes: 100_000,
  maxCurvePoints: 2_000_000,
  maxTempos: 10_000,
} as const;

/**
 * 安全な YAML 読み込み設定。
 * - core スキーマのみ（独自型・任意コード実行に繋がるタグは解決しない）
 * - マージキー（<<）無効、キー重複はエラー
 * OpenUtau はエイリアスもタグも出力しないため、それらを含む文書は別途拒否する。
 */
export const YAML_OPTIONS: ParseOptions & DocumentOptions & SchemaOptions = {
  schema: "core",
  merge: false,
  uniqueKeys: true,
  strict: true,
  prettyErrors: true,
};

const ALLOWED_TAGS = new Set(
  ["str", "int", "float", "bool", "null", "map", "seq"].map(
    (t) => `tag:yaml.org,2002:${t}`,
  ),
);

export interface Note extends RawNote {
  /** YAML 上の notes 配列内の位置（編集時に元文書の該当ノードを特定するため） */
  index: number;
}

export interface VoicePart {
  index: number;
  name: string;
  trackNo: number;
  /** プロジェクト先頭からの tick */
  position: number;
  duration: number;
  /** position 昇順 */
  notes: Note[];
  curves: Curve[];
}

export interface Track {
  name: string;
  color: string;
  singer: string | null;
  mute: boolean;
}

export interface Project {
  name: string;
  comment: string;
  version: UstxVersion;
  key: number;
  tempos: Tempo[];
  timeSignatures: TimeSignature[];
  tracks: Track[];
  voiceParts: VoicePart[];
  wavePartCount: number;
  noteCount: number;
}

export interface LoadedUstx {
  fileName: string;
  /** 読み込んだバイト列そのもの（無変更書き出しはこれを返す） */
  original: Uint8Array;
  hasBom: boolean;
  eol: "\n" | "\r\n";
  /** 書き出し用に保持する元の YAML 文書（未対応フィールドも含む） */
  doc: Document.Parsed;
  project: Project;
  warnings: string[];
  /** false の場合、書き出しを停止する理由が warnings に含まれる */
  exportable: boolean;
}

export function validateFileMeta(fileName: string, size: number): void {
  if (!/\.ustx$/i.test(fileName)) {
    throw new UstxError(
      "invalid-extension",
      "拡張子が .ustx のファイルを選択してください。",
    );
  }
  if (size === 0) {
    throw new UstxError("empty-file", "ファイルが空です。");
  }
  if (size > LIMITS.maxFileBytes) {
    throw new UstxError(
      "file-too-large",
      `ファイルサイズが上限（${LIMITS.maxFileBytes / 1024 / 1024}MB）を超えています。`,
    );
  }
}

export function decodeUtf8(bytes: Uint8Array): {
  text: string;
  hasBom: boolean;
} {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new UstxError(
      "invalid-encoding",
      "文字コードを UTF-8 として読み取れませんでした。OpenUtau で保存した USTX を選択してください。",
    );
  }
  const hasBom = text.charCodeAt(0) === 0xfeff;
  return { text: hasBom ? text.slice(1) : text, hasBom };
}

export function loadUstx(fileName: string, bytes: Uint8Array): LoadedUstx {
  validateFileMeta(fileName, bytes.byteLength);
  const { text, hasBom } = decodeUtf8(bytes);
  const doc = parseSafeDocument(text);
  const warnings: string[] = [];
  let exportable = true;

  const root = doc.contents;
  if (!isMap(root) || !root.has("ustx_version")) {
    throw new UstxError(
      "not-ustx",
      "USTX ファイルではないようです（ustx_version が見つかりません）。",
    );
  }
  const version = readVersion(doc, text);
  if (compareVersion(version, LATEST_SUPPORTED) > 0) {
    warnings.push(
      `この USTX（v${version.raw}）は対応確認済みの形式（v${LATEST_SUPPORTED.raw}）より新しいため、表示のみ可能です。書き出しは停止しています。`,
    );
    exportable = false;
  }

  const parsed = projectSchema.safeParse(doc.toJS({ maxAliasCount: 0 }));
  if (!parsed.success) {
    throw new UstxError(
      "invalid-structure",
      "USTX の構造が想定と異なるため読み込めませんでした。",
      formatZodIssue(parsed.error),
    );
  }
  const project = buildProject(parsed.data, version, warnings);

  return {
    fileName,
    original: bytes,
    hasBom,
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    doc,
    project,
    warnings,
    exportable,
  };
}

/** YAML を解析し、USTX として不正・危険な構造を拒否する */
export function parseSafeDocument(text: string): Document.Parsed {
  const docs = parseAllDocuments(text, YAML_OPTIONS);
  if (!Array.isArray(docs) || docs.length === 0) {
    throw new UstxError("empty-file", "ファイルに有効なデータがありません。");
  }
  if (docs.length > 1) {
    throw new UstxError(
      "multiple-documents",
      "複数の YAML 文書を含むファイルには対応していません。",
    );
  }
  const doc = docs[0];
  if (doc.errors.length > 0) {
    throw new UstxError(
      "yaml-syntax",
      "YAML の構文エラーにより読み込めませんでした。",
      doc.errors[0].message,
    );
  }
  visit(doc, (_key, node) => {
    if (
      isAlias(node) ||
      ((isCollection(node) || isScalar(node)) && node.anchor)
    ) {
      throw new UstxError(
        "forbidden-alias",
        "アンカー・エイリアスを含む YAML には対応していません（OpenUtau は出力しない形式です）。",
      );
    }
    if (
      (isCollection(node) || isScalar(node)) &&
      node.tag &&
      !ALLOWED_TAGS.has(node.tag)
    ) {
      throw new UstxError(
        "forbidden-tag",
        "許可されていない YAML タグが含まれています。",
        node.tag,
      );
    }
  });
  return doc;
}

export function readVersion(doc: Document.Parsed, text: string): UstxVersion {
  const node = doc.get("ustx_version", true);
  // 0.10 は数値として読むと 0.1 になってしまうため、原文の表記を使う
  const raw =
    isScalar(node) && node.range
      ? text.slice(node.range[0], node.range[1])
      : String(node);
  const version = parseVersion(raw);
  if (!version) {
    throw new UstxError(
      "unsupported-version",
      "ustx_version の値を解釈できませんでした。",
      raw,
    );
  }
  return version;
}

function buildProject(
  raw: RawProject,
  version: UstxVersion,
  warnings: string[],
): Project {
  if (raw.voice_parts.length > LIMITS.maxVoiceParts) {
    throw new UstxError("too-many-items", "パート数が上限を超えています。");
  }
  const noteCount = raw.voice_parts.reduce((sum, p) => sum + p.notes.length, 0);
  if (noteCount > LIMITS.maxNotes) {
    throw new UstxError("too-many-items", "ノート数が上限を超えています。");
  }
  const curvePoints = raw.voice_parts.reduce(
    (sum, p) => sum + p.curves.reduce((s, c) => s + c.xs.length, 0),
    0,
  );
  if (curvePoints > LIMITS.maxCurvePoints) {
    throw new UstxError(
      "too-many-items",
      "カーブのデータ量が上限を超えています。",
    );
  }

  const legacy = compareVersion(version, TEMPO_MAP_SINCE) < 0;
  if (legacy) {
    warnings.push(
      `古い形式（v${version.raw}）の USTX です。テンポ・拍子はプロジェクト全体の値で表示しています。OpenUtau で開いて保存し直すと最新形式になります。`,
    );
  }
  const tempos =
    !legacy && raw.tempos && raw.tempos.length > 0
      ? raw.tempos
      : [{ position: 0, bpm: raw.bpm }];
  if (tempos.length > LIMITS.maxTempos) {
    throw new UstxError(
      "too-many-items",
      "テンポ変更の数が上限を超えています。",
    );
  }
  const timeSignatures =
    !legacy && raw.time_signatures && raw.time_signatures.length > 0
      ? raw.time_signatures
      : [
          {
            bar_position: 0,
            beat_per_bar: raw.beat_per_bar,
            beat_unit: raw.beat_unit,
          },
        ];

  const voiceParts: VoicePart[] = raw.voice_parts.map((part, partIndex) => {
    const curves = part.curves.filter((curve) => {
      if (curve.xs.length === curve.ys.length) return true;
      warnings.push(
        `パート「${part.name}」のカーブ「${curve.abbr}」は点の数が不一致のため表示から除外しました（データは保持されます）。`,
      );
      return false;
    });
    return {
      index: partIndex,
      name: part.name,
      trackNo: part.track_no,
      position: part.position,
      duration: part.duration,
      notes: part.notes
        .map((note, index) => ({
          ...note,
          duration: Math.max(10, note.duration),
          index,
        }))
        .sort((a, b) => a.position - b.position || a.index - b.index),
      curves,
    };
  });

  return {
    name: raw.name,
    comment: raw.comment ?? "",
    version,
    key: raw.key,
    tempos: [...tempos].sort((a, b) => a.position - b.position),
    timeSignatures: [...timeSignatures].sort(
      (a, b) => a.bar_position - b.bar_position,
    ),
    tracks: raw.tracks.map((t) => ({
      name: t.track_name,
      color: t.track_color,
      singer: t.singer ?? null,
      mute: t.mute,
    })),
    voiceParts,
    wavePartCount: raw.wave_parts.length,
    noteCount,
  };
}

function formatZodIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "";
  const path = issue.path
    .map((p, i) =>
      typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`,
    )
    .join("");
  return `${path || "(root)"}: ${issue.message}`;
}
