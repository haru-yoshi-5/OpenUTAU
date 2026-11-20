import { downloadBytes } from "../../lib/download";
import { type EditMap, editedFileName, exportEdited } from "../../lib/ustx/edits";
import { UstxError } from "../../lib/ustx/errors";
import type { LoadedUstx } from "../../lib/ustx/load";

/*
 * 書き出し操作。書き出しパネルと、描画エラー時の代替画面の両方から使う。
 * コンポーネントのファイルから関数を export すると Vite の Fast Refresh が効かなくなるため、
 * コンポーネントとは別のファイルに置く。
 */

/** 編集版を書き出す。失敗すると UstxError などを投げる */
export function downloadEdited(loaded: LoadedUstx, edits: EditMap) {
  downloadBytes(exportEdited(loaded, edits), editedFileName(loaded.fileName));
}

export const exportErrorMessage = (e: unknown) =>
  e instanceof UstxError ? e.message : "書き出し中に予期しないエラーが発生しました。";
