import { CheckCircle2, Download, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { downloadBytes } from "../../lib/download";
import { type EditMap, editedFileName, exportEdited } from "../../lib/ustx/edits";
import { UstxError } from "../../lib/ustx/errors";
import { exportUnchanged } from "../../lib/ustx/export";
import type { LoadedUstx } from "../../lib/ustx/load";
import { useEditStore } from "../../stores/edit-store";
import type { RoundTripStatus } from "../../stores/project-store";

interface ExportPanelProps {
  loaded: LoadedUstx;
  roundTrip: RoundTripStatus;
}

/** 編集版を書き出す。失敗すると UstxError などを投げる（描画エラー時の代替画面からも使う） */
export function downloadEdited(loaded: LoadedUstx, edits: EditMap) {
  downloadBytes(exportEdited(loaded, edits), editedFileName(loaded.fileName));
}

export const exportErrorMessage = (e: unknown) =>
  e instanceof UstxError ? e.message : "書き出し中に予期しないエラーが発生しました。";

export function ExportPanel({ loaded, roundTrip }: ExportPanelProps) {
  const edits = useEditStore((s) => s.edits);
  // エラーは、そのとき書き出そうとした編集の状態と組で持つ。編集や Undo で状態が変わったら表示しない
  const [failure, setFailure] = useState<{ message: string; edits: EditMap } | null>(null);
  const error = failure?.edits === edits ? failure.message : null;
  const hasEdits = edits.size > 0;

  const download = (mode: "edited" | "original") => {
    setFailure(null);
    try {
      if (mode === "edited") downloadEdited(loaded, edits);
      else downloadBytes(exportUnchanged(loaded), loaded.fileName);
    } catch (e) {
      setFailure({ message: exportErrorMessage(e), edits });
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2 text-sm">
        {roundTrip.ok ? (
          <>
            <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
            <span>
              互換性チェック：再シリアライズ後も元データと一致しました（未対応フィールドも保持）。
            </span>
          </>
        ) : (
          <>
            <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span>互換性チェック：{roundTrip.message}</span>
          </>
        )}
      </p>
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {hasEdits && (
            <Button
              onClick={() => download("edited")}
              // 再シリアライズで元データと一致しないファイルは、編集後の書き出しを止める
              disabled={!loaded.exportable || !roundTrip.ok}
            >
              <Download aria-hidden />
              編集を反映して書き出す
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => download("original")}
            disabled={!loaded.exportable}
          >
            <Download aria-hidden />
            {hasEdits ? "元のまま書き出す" : "USTX を書き出す（無変更）"}
          </Button>
        </div>
        {hasEdits && (
          <p className="text-xs text-muted-foreground">
            編集版は「{editedFileName(loaded.fileName)}」として保存します。
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
