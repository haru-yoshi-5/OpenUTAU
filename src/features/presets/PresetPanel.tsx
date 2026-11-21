import { Check, Eye, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "../../components/ui/button";
import {
  EXPRESSION_PRESETS,
  type PresetId,
  PRESETS,
  TECHNIQUE_PRESETS,
} from "../../lib/tuning/presets";
import { usePresetStore } from "../../stores/preset-store";

interface PresetPanelProps {
  /** 表示中のパートで選んでいるノートの数 */
  selectedCount: number;
  /** 候補で変わるノートの数（候補を表示していないときは 0） */
  changeCount: number;
  /** 候補を採用する（編集として確定する） */
  onAccept: () => void;
}

/**
 * 調声プリセットを選び、強さを決め、候補を見比べてから採用・却下するパネル。
 * 候補を表示している間は、選択・プリセット・強さを変えると候補も作り直す。
 */
export function PresetPanel({ selectedCount, changeCount, onAccept }: PresetPanelProps) {
  const titleId = useId();
  const groupName = useId();
  const strengthId = useId();
  const statusId = useId();
  const { presetId, strength, previewing } = usePresetStore(
    useShallow((s) => ({ presetId: s.presetId, strength: s.strength, previewing: s.previewing })),
  );
  const { setPreset, setStrength, startPreview, stopPreview } = usePresetStore.getState();
  const preset = PRESETS[presetId];
  const hasSelection = selectedCount > 0;

  // 押したボタンが消えて置き換わるため、そのままではフォーカスが body に戻る。
  // ボタンで切り替えたときだけ、置き換わった先のボタンへフォーカスを移す
  // （ファイルの読み込み直しやパートの切り替えで候補が消えたときは動かさない）
  const acceptRef = useRef<HTMLButtonElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  const focusAfterToggle = useRef(false);
  useEffect(() => {
    if (!focusAfterToggle.current) return;
    focusAfterToggle.current = false;
    const target = previewing
      ? acceptRef.current && !acceptRef.current.disabled
        ? acceptRef.current
        : rejectRef.current
      : showRef.current;
    target?.focus();
  }, [previewing]);
  const toggleBy = (action: () => void) => () => {
    focusAfterToggle.current = true;
    action();
  };

  const status = !hasSelection
    ? "ピアノロールかノート一覧でノートを選ぶと、プリセットを試せます。"
    : !previewing
      ? `選んだ ${selectedCount} 個のノートに「${preset.label}」を試せます。`
      : changeCount > 0
        ? `候補：${changeCount} 個のノートが変わります（ピアノロールの点線）。`
        : "この設定では、選んだノートは変わりません。";

  const option = (id: PresetId, label: string) => (
    <label
      key={id}
      className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
    >
      <input
        type="radio"
        name={groupName}
        value={id}
        checked={presetId === id}
        onChange={() => setPreset(id)}
        className="size-4"
      />
      {label}
    </label>
  );

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3 rounded-lg border p-3">
      <h3 id={titleId} className="text-sm font-semibold">
        調声プリセット
      </h3>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs text-muted-foreground">表現</legend>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(EXPRESSION_PRESETS).map(([id, p]) => option(id as PresetId, p.label))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs text-muted-foreground">個別のテクニック</legend>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(TECHNIQUE_PRESETS).map(([id, p]) => option(id as PresetId, p.label))}
          </div>
        </fieldset>
      </div>
      <p className="text-xs text-muted-foreground">{preset.description}</p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label htmlFor={strengthId} className="text-sm">
          強さ
        </label>
        <input
          id={strengthId}
          type="range"
          min={0}
          max={100}
          step={5}
          value={strength}
          onChange={(e) => setStrength(Number(e.target.value))}
          aria-valuetext={`${strength}%`}
          className="w-40 max-w-full"
        />
        <output htmlFor={strengthId} className="w-10 text-sm tabular-nums">
          {strength}%
        </output>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p id={statusId} className="text-sm text-muted-foreground" aria-live="polite">
          {status}
        </p>
        <div className="flex flex-wrap gap-2">
          {previewing ? (
            <>
              <Button
                ref={acceptRef}
                size="sm"
                onClick={toggleBy(onAccept)}
                disabled={changeCount === 0}
                aria-describedby={statusId}
              >
                <Check aria-hidden />
                採用
              </Button>
              <Button ref={rejectRef} size="sm" variant="outline" onClick={toggleBy(stopPreview)}>
                <X aria-hidden />
                却下
              </Button>
            </>
          ) : (
            <Button
              ref={showRef}
              size="sm"
              variant="outline"
              onClick={toggleBy(startPreview)}
              disabled={!hasSelection}
              aria-describedby={statusId}
            >
              <Eye aria-hidden />
              候補を表示
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
