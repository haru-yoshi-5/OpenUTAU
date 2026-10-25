"use client";

import { AlertTriangle, CircleX, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { computeBars } from "@/lib/ustx/bars";
import { UstxError } from "@/lib/ustx/errors";
import { serializeVerified } from "@/lib/ustx/export";
import {
  LIMITS,
  type LoadedUstx,
  loadUstx,
  validateFileMeta,
} from "@/lib/ustx/load";
import { renderPartPitch } from "@/lib/ustx/pitch";
import { TimeAxis } from "@/lib/ustx/time-axis";
import { ExportPanel, type RoundTripStatus } from "./export-panel";
import { FileDropZone } from "./file-drop-zone";
import { NoteTable } from "./note-table";
import { PianoRoll } from "./piano-roll";
import { ProjectSummary } from "./project-summary";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string; detail?: string }
  | { status: "loaded"; loaded: LoadedUstx; roundTrip: RoundTripStatus };

const SAMPLE_URL = "/samples/demo.ustx";

function checkRoundTrip(loaded: LoadedUstx): RoundTripStatus {
  if (!loaded.exportable)
    return { ok: false, message: "この形式は書き出し対象外です。" };
  try {
    serializeVerified(loaded);
    return { ok: true };
  } catch (e) {
    const detail = e instanceof UstxError && e.detail ? `（${e.detail}）` : "";
    return {
      ok: false,
      message: `元データとの不一致を検出したため、編集後の書き出しは停止されます${detail}。`,
    };
  }
}

export function Studio() {
  const [state, setState] = useState<State>({ status: "idle" });
  const [partIndex, setPartIndex] = useState(0);

  const load = async (
    fileName: string,
    getBytes: () => Promise<Uint8Array>,
  ) => {
    setState({ status: "loading" });
    try {
      const bytes = await getBytes();
      // 読み込み中の表示を先に描画させてから重い解析を行う
      await new Promise((r) => setTimeout(r, 0));
      const loaded = loadUstx(fileName, bytes);
      setPartIndex(0);
      setState({ status: "loaded", loaded, roundTrip: checkRoundTrip(loaded) });
    } catch (e) {
      if (e instanceof UstxError) {
        setState({ status: "error", message: e.message, detail: e.detail });
      } else {
        setState({
          status: "error",
          message: "ファイルの読み込み中に予期しないエラーが発生しました。",
        });
      }
    }
  };

  const onFile = (file: File) =>
    load(file.name, async () => {
      // 中身を読む前に、拡張子とサイズを確認する
      validateFileMeta(file.name, file.size);
      return new Uint8Array(await file.arrayBuffer());
    });

  const onLoadSample = () =>
    load("demo.ustx", async () => {
      const res = await fetch(SAMPLE_URL);
      if (!res.ok)
        throw new UstxError(
          "empty-file",
          "サンプルファイルを取得できませんでした。",
        );
      const buf = await res.arrayBuffer();
      if (buf.byteLength > LIMITS.maxFileBytes)
        throw new UstxError("file-too-large", "サンプルが大きすぎます。");
      return new Uint8Array(buf);
    });

  if (state.status !== "loaded") {
    return (
      <div className="flex flex-col gap-4">
        {state.status === "error" && (
          <Alert variant="destructive">
            <CircleX />
            <AlertTitle>読み込めませんでした</AlertTitle>
            <AlertDescription>
              <p>{state.message}</p>
              {state.detail && (
                <p className="font-mono text-xs break-all">{state.detail}</p>
              )}
            </AlertDescription>
          </Alert>
        )}
        <FileDropZone
          loading={state.status === "loading"}
          onFile={onFile}
          onLoadSample={onLoadSample}
        />
      </div>
    );
  }

  return (
    <LoadedView
      loaded={state.loaded}
      roundTrip={state.roundTrip}
      partIndex={partIndex}
      onPartChange={setPartIndex}
      onClose={() => setState({ status: "idle" })}
    />
  );
}

interface LoadedViewProps {
  loaded: LoadedUstx;
  roundTrip: RoundTripStatus;
  partIndex: number;
  onPartChange: (index: number) => void;
  onClose: () => void;
}

function LoadedView({
  loaded,
  roundTrip,
  partIndex,
  onPartChange,
  onClose,
}: LoadedViewProps) {
  const { project } = loaded;
  const timeAxis = useMemo(
    () => new TimeAxis(project.tempos),
    [project.tempos],
  );
  const bars = useMemo(() => {
    const end = project.voiceParts.reduce(
      (m, p) =>
        Math.max(
          m,
          p.position +
            p.notes.reduce(
              (e, n) => Math.max(e, n.position + n.duration),
              p.duration,
            ),
        ),
      0,
    );
    return computeBars(project.timeSignatures, end);
  }, [project]);
  const part = project.voiceParts[partIndex];
  const pitch = useMemo(
    () => (part ? renderPartPitch(part, timeAxis) : null),
    [part, timeAxis],
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="truncate text-lg">{project.name}</CardTitle>
          {project.comment && (
            <CardDescription className="line-clamp-2">
              {project.comment}
            </CardDescription>
          )}
          <CardAction>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <Trash2 />
              データを破棄
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ProjectSummary project={project} fileName={loaded.fileName} />
          {loaded.warnings.length > 0 && (
            <Alert>
              <AlertTriangle />
              <AlertTitle>確認してください</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4">
                  {loaded.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <ExportPanel loaded={loaded} roundTrip={roundTrip} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ピアノロール</CardTitle>
          <CardDescription>
            ノート・歌詞と、OpenUtau
            の計算に準じて合成したピッチカーブを表示します。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {project.voiceParts.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              このプロジェクトには歌声パートがありません。
            </p>
          ) : (
            <>
              <nav
                aria-label="パートの切り替え"
                className="-mx-1 overflow-x-auto"
              >
                <ul className="flex gap-1 px-1">
                  {project.voiceParts.map((p) => (
                    <li key={p.index}>
                      <Button
                        size="sm"
                        variant={p.index === partIndex ? "default" : "outline"}
                        aria-current={
                          p.index === partIndex ? "true" : undefined
                        }
                        onClick={() => onPartChange(p.index)}
                        className="max-w-48"
                      >
                        <span className="truncate">{p.name}</span>
                        <span className="text-xs opacity-70">
                          {project.tracks[p.trackNo]?.name ??
                            `トラック${p.trackNo + 1}`}
                          ・{p.notes.length}
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </nav>
              {part && part.notes.length > 0 ? (
                <>
                  <PianoRoll
                    part={part}
                    bars={bars}
                    tempos={project.tempos}
                    pitch={pitch}
                  />
                  <NoteTable part={part} />
                </>
              ) : (
                <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                  このパートにはノートがありません。
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
