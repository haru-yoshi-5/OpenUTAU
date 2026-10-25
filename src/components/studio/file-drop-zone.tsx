"use client";

import { FileMusic, Loader2, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FileDropZoneProps {
  loading: boolean;
  onFile: (file: File) => void;
  onLoadSample: () => void;
}

export function FileDropZone({
  loading,
  onFile,
  onLoadSample,
}: FileDropZoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <section
      aria-labelledby={`${inputId}-title`}
      className={cn(
        "flex flex-col items-center gap-4 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors sm:px-8",
        dragging ? "border-primary bg-muted" : "border-border",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        if (!loading) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && !loading) onFile(file);
      }}
    >
      {loading ? (
        <Loader2
          aria-hidden
          className="size-10 animate-spin text-muted-foreground"
        />
      ) : (
        <FileMusic aria-hidden className="size-10 text-muted-foreground" />
      )}
      <div className="space-y-1">
        <h2 id={`${inputId}-title`} className="text-lg font-semibold">
          {loading ? "解析しています…" : "USTX ファイルを読み込む"}
        </h2>
        <p className="text-sm text-muted-foreground">
          ここにドラッグ＆ドロップするか、ファイルを選択してください（.ustx・20MB
          まで）
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".ustx"
          className="sr-only"
          disabled={loading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            // 同じファイルを続けて選び直せるようにする
            e.target.value = "";
          }}
        />
        <Button
          size="lg"
          disabled={loading}
          onClick={() => inputRef.current?.click()}
        >
          <Upload />
          ファイルを選択
        </Button>
        <Button
          size="lg"
          variant="outline"
          disabled={loading}
          onClick={onLoadSample}
        >
          デモ用サンプルを開く
        </Button>
      </div>
      <ul className="max-w-xl space-y-1 text-left text-xs text-muted-foreground">
        <li>
          ・ファイルはお使いのブラウザ内でのみ解析され、サーバーへは送信・保存されません。
        </li>
        <li>
          ・ご自身で制作した、または利用許諾を得た USTX
          のみを読み込んでください。
        </li>
        <li>
          ・ページを閉じるか「データを破棄」を押すと、読み込んだ内容は破棄されます。
        </li>
      </ul>
    </section>
  );
}
