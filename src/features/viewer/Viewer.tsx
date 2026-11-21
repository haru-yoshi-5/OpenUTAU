import { Loader2, Trash2 } from "lucide-react";
import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { computeBars } from "../../lib/ustx/bars";
import {
  applyEditsToProject,
  DEFAULT_VIBRATO_LENGTH,
  noteKey,
  parseNoteKey,
} from "../../lib/ustx/edits";
import { UstxError } from "../../lib/ustx/errors";
import type { LoadedUstx, Note } from "../../lib/ustx/load";
import { partEndTick } from "../../lib/ustx/part";
import { renderPartPitch } from "../../lib/ustx/pitch";
import { TimeAxis } from "../../lib/ustx/time-axis";
import { detectUnsupported } from "../../lib/ustx/unsupported";
import { PRESETS } from "../../lib/tuning/presets";
import { useEditStore } from "../../stores/edit-store";
import { usePresetStore } from "../../stores/preset-store";
import { type RoundTripStatus, useProjectStore } from "../../stores/project-store";
import { selectedNotesIn, useSelectionStore } from "../../stores/selection-store";
import { buildPresetChanges, candidateTickRanges, withCandidate } from "../presets/candidate";
import { PresetPanel } from "../presets/PresetPanel";
import { DiscardDialog } from "./DiscardDialog";
import { EditToolbar } from "./EditToolbar";
import { ExportPanel } from "./ExportPanel";
import { downloadEdited, exportErrorMessage } from "./export-actions";
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
    return <LoadedRoot loaded={load.loaded} roundTrip={load.roundTrip} onClose={close} />;
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

interface LoadedProps {
  loaded: LoadedUstx;
  roundTrip: RoundTripStatus;
}

/**
 * 読み込み後の画面の外枠。編集を失わないための処理（破棄の確認・ページ離脱の警告）は、
 * 表示でエラーが起きても働くよう、ErrorBoundary の外に置く
 */
function LoadedRoot({ loaded, roundTrip, onClose }: LoadedProps & { onClose: () => void }) {
  const editCount = useEditStore((s) => s.edits.size);
  const canUndo = useEditStore((s) => s.undoStack.length > 0);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const hasEdits = editCount > 0;

  // 編集が残っているときにページを閉じる・再読み込みすると、ブラウザ標準の確認を出す
  useEffect(() => {
    if (!hasEdits) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 古いブラウザは returnValue の設定で確認を出す
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasEdits]);

  const requestDiscard = () => {
    if (hasEdits) setConfirmingDiscard(true);
    else onClose();
  };
  const canExportEdits = hasEdits && loaded.exportable && roundTrip.ok;

  return (
    <>
      <RenderErrorBoundary
        onDiscard={requestDiscard}
        onUndo={canUndo ? () => useEditStore.getState().undo() : undefined}
        onExport={
          canExportEdits ? () => downloadEdited(loaded, useEditStore.getState().edits) : undefined
        }
        exportErrorMessage={exportErrorMessage}
      >
        <LoadedView loaded={loaded} roundTrip={roundTrip} onDiscard={requestDiscard} />
      </RenderErrorBoundary>
      <DiscardDialog
        open={confirmingDiscard}
        editCount={editCount}
        onCancel={() => setConfirmingDiscard(false)}
        onConfirm={() => {
          setConfirmingDiscard(false);
          onClose();
        }}
      />
    </>
  );
}

function LoadedView({ loaded, roundTrip, onDiscard }: LoadedProps & { onDiscard: () => void }) {
  const original = loaded.project;
  const partIndex = useProjectStore((s) => s.partIndex);
  const { selectPart } = useProjectStore.getState();
  const edits = useEditStore((s) => s.edits);
  const [editError, setEditError] = useState<string | null>(null);

  // 表示・ピッチ計算には差分を当てたプロジェクトを使う。変更の無いパートは同じオブジェクトのまま
  const project = useMemo(() => applyEditsToProject(original, edits), [original, edits]);

  // テンポ・拍子・ノートの位置は編集しないため、元データから一度だけ計算する
  const timeAxis = useMemo(() => new TimeAxis(original.tempos), [original.tempos]);
  const bars = useMemo(() => {
    const end = original.voiceParts.reduce(
      (max, p) => Math.max(max, p.position + partEndTick(p)),
      0,
    );
    return computeBars(original.timeSignatures, end);
  }, [original]);
  const unsupported = useMemo(() => detectUnsupported(original), [original]);
  const part = project.voiceParts[partIndex];
  const pitch = useMemo(() => (part ? renderPartPitch(part, timeAxis) : null), [part, timeAxis]);
  // プリセットの候補。表示している間は、選択・プリセット・強さ・編集の変更に合わせて作り直す
  const selected = useSelectionStore((s) => selectedNotesIn(s, partIndex));
  const preset = usePresetStore(
    useShallow((s) => ({ id: s.presetId, strength: s.strength, previewing: s.previewing })),
  );
  // スライダーを動かしている間は、候補の作り直し（全体への差分の適用とピッチの計算）を後回しにして、
  // スライダーの反応を優先する。採用するのも、この値で作った候補
  const strength = useDeferredValue(preset.strength);
  const candidateChanges = useMemo(
    () =>
      preset.previewing && part
        ? buildPresetChanges(
            part,
            original.voiceParts[partIndex],
            edits,
            selected,
            timeAxis,
            preset.id,
            strength / 100,
          )
        : [],
    [preset.previewing, preset.id, strength, part, original, partIndex, edits, selected, timeAxis],
  );
  const candidate = useMemo(() => {
    if (candidateChanges.length === 0 || !part) return null;
    const candidateProject = applyEditsToProject(original, withCandidate(edits, candidateChanges));
    const pitch = renderPartPitch(candidateProject.voiceParts[partIndex], timeAxis);
    if (!pitch) return null;
    // 変わるノートの区間だけに点線を描き、変わらない区間で今のカーブと重ならないようにする
    return { pitch, ranges: candidateTickRanges(part, candidateChanges) };
  }, [candidateChanges, original, edits, part, partIndex, timeAxis]);

  const acceptCandidate = () => {
    setEditError(null);
    try {
      const { label } = PRESETS[preset.id];
      useEditStore
        .getState()
        .apply(`プリセット「${label}」（強さ ${strength}%）`, candidateChanges);
      usePresetStore.getState().stopPreview();
    } catch (e) {
      setEditError(e instanceof UstxError ? e.message : "編集中に予期しないエラーが発生しました。");
    }
  };

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
      // 元データと同じ値に戻った項目は、ストアが差分から外す
      const after = { ...edits.get(key), vibrato: { ...note.vibrato, length } };
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
          <Button variant="ghost" size="sm" onClick={onDiscard}>
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
            {/* ほかのパートで編集した内容も戻せるよう、表示中のパートに関係なく出す */}
            <EditToolbar />
            {part && part.notes.length > 0 && (
              <PresetPanel
                selectedCount={selected.size}
                changeCount={candidateChanges.length}
                onAccept={acceptCandidate}
              />
            )}
            {editError && (
              <Alert tone="error" title="編集できませんでした">
                <p>{editError}</p>
              </Alert>
            )}
            {part && part.notes.length > 0 ? (
              <>
                <Suspense fallback={<PianoRollFallback />}>
                  <PianoRoll
                    part={part}
                    bars={bars}
                    tempos={project.tempos}
                    pitch={pitch}
                    candidate={candidate}
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
