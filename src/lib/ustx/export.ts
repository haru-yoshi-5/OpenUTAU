import { isDeepStrictEqual } from "./deep-equal";
import { UstxError } from "./errors";
import { type LoadedUstx, parseSafeDocument, readVersion } from "./load";

/** OpenUtau（YamlDotNet）の出力に近い書式。シーケンスをキーと同じ字下げで並べ、折り返さない */
const STRINGIFY_OPTIONS = {
  indentSeq: false,
  lineWidth: 0,
  minContentWidth: 0,
  flowCollectionPadding: false,
} as const;

const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

/** 変更が無い場合は、読み込んだバイト列をそのまま返す（完全一致の往復） */
export function exportUnchanged(loaded: LoadedUstx): Uint8Array {
  assertExportable(loaded);
  return loaded.original;
}

/**
 * 保持している YAML 文書を文字列化して書き出す。
 * 元ファイルの改行コード・BOM の有無を引き継ぐ。
 */
export function serializeDocument(loaded: LoadedUstx): Uint8Array {
  assertExportable(loaded);
  let text = loaded.doc.toString(STRINGIFY_OPTIONS);
  if (loaded.eol === "\r\n") text = text.replace(/\r?\n/g, "\r\n");
  const body = new TextEncoder().encode(text);
  if (!loaded.hasBom) return body;
  const out = new Uint8Array(BOM.length + body.length);
  out.set(BOM);
  out.set(body, BOM.length);
  return out;
}

export interface RoundTripExpectation {
  /** 再解析後に一致すべきデータ */
  data: unknown;
  /** ustx_version の原文表記（"0.10" が "0.1" に化けていないかを確認する） */
  versionRaw: string;
}

export interface RoundTripResult {
  ok: boolean;
  /** 不一致があった場合、最初に食い違った位置 */
  diffPath?: string;
}

/** 書き出し結果を再度解析し、期待するデータと意味的に一致するか検証する */
export function verifyRoundTrip(
  expected: RoundTripExpectation,
  outputBytes: Uint8Array,
): RoundTripResult {
  // TextDecoder は既定で先頭の BOM を取り除く
  const text = new TextDecoder("utf-8").decode(outputBytes);
  try {
    const doc = parseSafeDocument(text);
    if (readVersion(doc, text).raw !== expected.versionRaw) {
      return { ok: false, diffPath: "$.ustx_version" };
    }
    const diff = isDeepStrictEqual(
      expected.data,
      doc.toJS({ maxAliasCount: 0 }),
    );
    return diff === null ? { ok: true } : { ok: false, diffPath: diff };
  } catch {
    return { ok: false, diffPath: "(再解析に失敗)" };
  }
}

/** 文書を再シリアライズし、期待するデータと一致する場合だけ返す。一致しなければ出力を止める */
export function serializeVerified(
  loaded: LoadedUstx,
  expectedData: unknown = loaded.doc.toJS({ maxAliasCount: 0 }),
): Uint8Array {
  const bytes = serializeDocument(loaded);
  const result = verifyRoundTrip(
    { data: expectedData, versionRaw: loaded.project.version.raw },
    bytes,
  );
  if (!result.ok) {
    throw new UstxError(
      "export-blocked",
      "書き出し結果が元データと一致しないため、互換性保護のため出力を停止しました。",
      result.diffPath,
    );
  }
  return bytes;
}

function assertExportable(loaded: LoadedUstx) {
  if (!loaded.exportable) {
    throw new UstxError(
      "export-blocked",
      "このファイルは互換性を保証できないため書き出しできません。",
      loaded.warnings.join("\n"),
    );
  }
}
