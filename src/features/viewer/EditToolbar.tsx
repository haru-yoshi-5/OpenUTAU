import { Redo2, Undo2 } from "lucide-react";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "../../components/ui/button";
import { useEditStore } from "../../stores/edit-store";

/** 文字入力中は、ブラウザ標準の取り消し（入力欄の Undo）を優先する */
function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return (
    target instanceof HTMLInputElement &&
    !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(
      target.type,
    )
  );
}

/**
 * モーダルのダイアログ（破棄の確認など）が開いているか。
 * :modal に対応していないブラウザ（Safari 15.4〜15.5 など）では querySelector が例外になるため、
 * そのときは開いている dialog があるかで判定する
 */
function isModalOpen(): boolean {
  try {
    return document.querySelector("dialog:modal") !== null;
  } catch {
    return document.querySelector("dialog[open]") !== null;
  }
}

/** 取り消し・やり直しのボタンと、Ctrl（⌘）+Z / Ctrl（⌘）+Shift+Z / Ctrl+Y のショートカット */
export function EditToolbar() {
  const { editCount, undoLabel, redoLabel } = useEditStore(
    useShallow((s) => ({
      editCount: s.edits.size,
      undoLabel: s.undoStack.at(-1)?.label,
      redoLabel: s.redoStack.at(-1)?.label,
    })),
  );
  const { undo, redo } = useEditStore.getState();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isTextInput(e.target)) return;
      // モーダル（破棄の確認など）を開いている間は、背後の編集を変えない
      // （モーダルでない dialog を開いたままにする画面でも、ショートカットは効くよう :modal に絞る）
      if (isModalOpen()) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || (key === "y" && !e.metaKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={undo}
        disabled={!undoLabel}
        data-history-action="undo"
        title={undoLabel ? `元に戻す：${undoLabel}（Ctrl / ⌘ + Z）` : "元に戻す操作はありません"}
      >
        <Undo2 aria-hidden />
        元に戻す
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={redo}
        disabled={!redoLabel}
        data-history-action="redo"
        title={
          redoLabel ? `やり直す：${redoLabel}（Ctrl / ⌘ + Shift + Z）` : "やり直す操作はありません"
        }
      >
        <Redo2 aria-hidden />
        やり直す
      </Button>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {editCount > 0 ? `${editCount} 個のノートを編集中` : "編集はありません"}
      </p>
    </div>
  );
}
