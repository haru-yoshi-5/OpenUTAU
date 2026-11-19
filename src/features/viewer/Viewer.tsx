import { Loader2, Trash2 } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { computeBars } from "../../lib/ustx/bars";
import {
  applyEditsToProject,
  DEFAULT_VIBRATO_LENGTH,
  mergeNoteEdit,
  noteKey,
  parseNoteKey,
} from "../../lib/ustx/edits";
import { UstxError } from "../../lib/ustx/errors";
import type { LoadedUstx, Note } from "../../lib/ustx/load";
import { renderPartPitch } from "../../lib/ustx/pitch";
import { TimeAxis } from "../../lib/ustx/time-axis";
import { detectUnsupported } from "../../lib/ustx/unsupported";
import { useEditStore } from "../../stores/edit-store";
import { type RoundTripStatus, useProjectStore } from "../../stores/project-store";
import { EditToolbar } from "./EditToolbar";
import { ExportPanel } from "./ExportPanel";
import { FileDropZone } from "./FileDropZone";
import { NoteTable } from "./NoteTable";
import { ProjectSummary } from "./ProjectSummary";
import { RenderErrorBoundary } from "./RenderErrorBoundary";

// Konva を含むため、ファイルを読み込んだ後に遅延読み込みする
const PianoRoll = lazy(() =>
  import("../piano-roll/PianoRoll").then((m) => ({ default: m.PianoRoll })),
);

function PianoRollFallback() {
  return (
    <output className="flex h-[60vh] min-h-72 items-center justify-center gap-2 rounded-lg border text-sm text-muted-foreground">
      <Loader2 aria-hidden className="size-4 animate-spin" />
      ピアノロールを準備しています…
    </output>
  );
}

export function Viewer() {
  const load = useProjectStore((s) => s.load);
  const { loadFile, loadSample, close } = useProjectStore.getState();

  if (load.status === "loaded") {
    return (
      <RenderErrorBoundary onReset={close}>
        <LoadedView loaded={load.loaded} roundTrip={load.roundTrip} />
      </RenderErrorBoundary>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {load.status === "error" && (
        <Alert tone="error" title="読み込めませんでした">
          <p>{load.message}</p>
          {load.detail && <p className="font-mono text-xs break-all">{load.detail}</p>}
        </Alert>
      )}
      <FileDropZone
        loading={load.status === "loading"}
        onFile={(file) => void loadFile(file)}
        onLoadSample={() => void loadSample()}
      />
    </div>
  );
}

function LoadedView({ loaded, roundTrip }: { loaded: LoadedUstx; roundTrip: RoundTripStatus }) {
  const original = loaded.project;
  const partIndex = useProjectStore((s) => s.partIndex);
  const { selectPart, close } = useProjectStore.getState();
  const edits = useEditStore((s) => s.edits);
  const [editError, setEditError] = useState<string | null>(null);

  // 表示・ピッチ計算には差分を当てたプロジェクトを使う。変更の無いパートは同じオブジェクトのまま
  const project = useMemo(() => applyEditsToProject(original, edits), [original, edits]);

  // テンポ・拍子・ノートの位置は編集しないため、元データから一度だけ計算する
  const timeAxis = useMemo(() => new TimeAxis(original.tempos), [original.tempos]);
  const bars = useMemo(() => {
    const end = original.voiceParts.reduce(
      (max, p) =>
        Math.max(
          max,
          p.position + p.notes.reduce((e, n) => Math.max(e, n.position + n.duration), p.duration),
        ),
      0,
    );
    return computeBars(original.timeSignatures, end);
  }, [original]);
  const unsupported = useMemo(() => detectUnsupported(original), [original]);
  const part = project.voiceParts[partIndex];
  const pitch = useMemo(() => (part ? renderPartPitch(part, timeAxis) : null), [part, timeAxis]);
  const editedNotes = useMemo(() => {
    const set = new Set<number>();
    for (const key of edits.keys()) {
      const { partIndex: p, noteIndex } = parseNoteKey(key);
      if (p === partIndex) set.add(noteIndex);
    }
    return set;
  }, [edits, partIndex]);

  const toggleVibrato = (note: Note, enabled: boolean) => {
    setEditError(null);
    const key = noteKey(partIndex, note.index);
    const source = original.voiceParts[partIndex].notes.find((n) => n.index === note.index);
    if (!source) return;
    // オンにするときは OpenUtau と同じ既定の長さにし、周期・深さなどは今の値を引き継ぐ
    const length = enabled
      ? source.vibrato.length > 0
        ? source.vibrato.length
        : DEFAULT_VIBRATO_LENGTH
      : 0;
    try {
      const after = mergeNoteEdit(source, edits.get(key), {
        vibrato: { ...note.vibrato, length },
      });
      useEditStore
        .getState()
        .apply(enabled ? "ビブラートをオンにする" : "ビブラートをオフにする", [{ key, after }]);
    } catch (e) {
      setEditError(e instanceof UstxError ? e.message : "編集中に予期しないエラーが発生しました。");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card
        title={project.name}
        description={project.comment || undefined}
        action={
          <Button variant="ghost" size="sm" onClick={close}>
            <Trash2 aria-hidden />
            データを破棄
          </Button>
        }
      >
        <ProjectSummary project={project} fileName={loaded.fileName} />
        {loaded.warnings.length > 0 && (
          <Alert tone="warning" title="確認してください">
            <ul className="list-disc space-y-1 pl-4">
              {loaded.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Alert>
        )}
        {unsupported.length > 0 && (
          <Alert tone="info" title="表示に反映していないデータ">
            <ul className="list-disc space-y-1 pl-4">
              {unsupported.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <p className="mt-1">これらのデータは書き出し時もそのまま保持されます。</p>
          </Alert>
        )}
        <ExportPanel loaded={loaded} roundTrip={roundTrip} />
      </Card>

      <Card
        title="ピアノロール"
        description="ノート・歌詞と、OpenUtau の計算に準じて合成したピッチカーブを表示します。"
      >
        {project.voiceParts.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            このプロジェクトには歌声パートがありません。
          </p>
        ) : (
          <>
            <nav aria-label="パートの切り替え" className="-mx-1 overflow-x-auto">
              <ul className="flex gap-1 px-1 pb-1">
                {project.voiceParts.map((p) => (
                  <li key={p.index}>
                    <Button
                      size="sm"
                      variant={p.index === partIndex ? "primary" : "outline"}
                      aria-current={p.index === partIndex ? "true" : undefined}
                      onClick={() => selectPart(p.index)}
                      className="max-w-56"
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="text-xs opacity-70">
                        {project.tracks[p.trackNo]?.name ?? `トラック${p.trackNo + 1}`}・
                        {p.notes.length}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            </nav>
            {part && part.notes.length > 0 ? (
              <>
                <EditToolbar />
                {editError && (
                  <Alert tone="error" title="編集できませんでした">
                    <p>{editError}</p>
                  </Alert>
                )}
                <Suspense fallback={<PianoRollFallback />}>
                  <PianoRoll
                    part={part}
                    bars={bars}
                    tempos={project.tempos}
                    pitch={pitch}
                    // 編集では表示位置を保ち、パートやファイルが変わったときだけ先頭へ戻す
                    resetKey={original.voiceParts[partIndex]}
                  />
                </Suspense>
                <NoteTable part={part} editedNotes={editedNotes} onToggleVibrato={toggleVibrato} />
              </>
            ) : (
              <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                このパートにはノートがありません。
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
