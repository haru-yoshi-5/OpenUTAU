import { CheckCircle2, Download, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { UstxError } from "../../lib/ustx/errors";
import { editedFileName, exportEdited } from "../../lib/ustx/edits";
import { exportUnchanged } from "../../lib/ustx/export";
import type { LoadedUstx } from "../../lib/ustx/load";
import { useEditStore } from "../../stores/edit-store";
import type { RoundTripStatus } from "../../stores/project-store";

interface ExportPanelProps {
  loaded: LoadedUstx;
  roundTrip: RoundTripStatus;
}

/** Blob URL を破棄するまでの待ち時間。保存ダイアログの表示などで遅れても間に合うよう長めに取る */
const REVOKE_DELAY_MS = 40_000;

function downloadBytes(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/x-yaml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  // ダウンロードの開始は非同期のため、すぐに破棄すると保存に失敗するブラウザがある（Firefox など）
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

export function ExportPanel({ loaded, roundTrip }: ExportPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const edits = useEditStore((s) => s.edits);
  const hasEdits = edits.size > 0;

  const download = (mode: "edited" | "original") => {
    setError(null);
    try {
      if (mode === "edited") {
        downloadBytes(exportEdited(loaded, edits), editedFileName(loaded.fileName));
      } else {
        downloadBytes(exportUnchanged(loaded), loaded.fileName);
      }
    } catch (e) {
      setError(e instanceof UstxError ? e.message : "書き出し中に予期しないエラーが発生しました。");
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
