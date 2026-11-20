import { useEffect, useId, useRef } from "react";
import { Button } from "../../components/ui/button";

interface DiscardDialogProps {
  open: boolean;
  /** 書き出していない編集があるノートの数 */
  editCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 書き出していない編集を破棄してよいかを確かめる。
 * window.confirm はブラウザの設定でダイアログが抑止されると常に「キャンセル」扱いになり、
 * 編集がある限り破棄できなくなるため、ページ内の <dialog> で確認する。
 */
export function DiscardDialog({ open, editCount, onConfirm, onCancel }: DiscardDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // 誤操作で消さないよう、ボタンの並び順に関係なく、最初のフォーカスは「キャンセル」に置く。
      // React の autoFocus はマウント時（ダイアログが閉じていてフォーカスできないとき）にしか働かない
      dialog.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descId}
      // Esc で閉じたときもキャンセルとして扱う
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border bg-card p-0 text-foreground shadow-lg backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-4 p-5">
        <h2 id={titleId} className="text-base font-semibold">
          編集を破棄しますか？
        </h2>
        <p id={descId} className="text-sm text-muted-foreground">
          {editCount} 個のノートの編集は、まだ書き出していません。破棄すると元に戻せません。
          残す場合は「キャンセル」を押し、「編集を反映して書き出す」で保存してください。
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onCancel} data-initial-focus>
            キャンセル
          </Button>
          <Button onClick={onConfirm}>破棄する</Button>
        </div>
      </div>
    </dialog>
  );
}
