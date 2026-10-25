export type UstxErrorCode =
  | "invalid-extension"
  | "file-too-large"
  | "empty-file"
  | "invalid-encoding"
  | "yaml-syntax"
  | "multiple-documents"
  | "forbidden-alias"
  | "forbidden-tag"
  | "not-ustx"
  | "invalid-structure"
  | "too-many-items"
  | "unsupported-version"
  | "export-blocked";

/** 画面にそのまま表示できる日本語メッセージを持つ USTX 処理エラー */
export class UstxError extends Error {
  readonly code: UstxErrorCode;
  readonly detail?: string;

  constructor(code: UstxErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "UstxError";
    this.code = code;
    this.detail = detail;
  }
}
