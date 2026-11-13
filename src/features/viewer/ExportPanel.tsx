import { CheckCircle2, Download, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { UstxError } from "../../lib/ustx/errors";
import { exportUnchanged } from "../../lib/ustx/export";
import type { LoadedUstx } from "../../lib/ustx/load";
import type { RoundTripStatus } from "../../stores/project-store";

interface ExportPanelProps {
  loaded: LoadedUstx;
  roundTrip: RoundTripStatus;
}

function downloadBytes(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/x-yaml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportPanel({ loaded, roundTrip }: ExportPanelProps) {
  const [error, setError] = useState<string | null>(null);

  const download = () => {
    setError(null);
    try {
      downloadBytes(exportUnchanged(loaded), loaded.fileName);
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
        <Button variant="outline" onClick={download} disabled={!loaded.exportable}>
          <Download aria-hidden />
          USTX を書き出す（無変更）
        </Button>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
