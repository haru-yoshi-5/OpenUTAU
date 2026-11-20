import { Download, Trash2, Undo2 } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";

interface RenderErrorBoundaryProps {
  children: ReactNode;
  /** 読み込んだデータを破棄する（書き出していない編集があれば、呼び出し側で確認する） */
  onDiscard: () => void;
  /** 直前の編集を取り消す。取り消せる編集が無ければ undefined */
  onUndo?: () => void;
  /** 編集版を書き出す（失敗すると例外を投げる）。書き出せる編集が無ければ undefined */
  onExport?: () => void;
  /** 書き出しに失敗したときに表示するメッセージ */
  exportErrorMessage: (e: unknown) => string;
}

interface RenderErrorBoundaryState {
  failed: boolean;
  exportError: string | null;
}

/**
 * 読み込み後の表示（ピッチ計算・ピアノロールの描画など）で起きた例外を受け止める。
 * これが無いと React がツリー全体を外し、画面が真っ白になって操作できなくなる。
 * 編集が原因のこともあるため、直前の編集の取り消しと、編集版の書き出しも選べるようにする。
 */
export class RenderErrorBoundary extends Component<
  RenderErrorBoundaryProps,
  RenderErrorBoundaryState
> {
  override state: RenderErrorBoundaryState = { failed: false, exportError: null };

  static getDerivedStateFromError(): Partial<RenderErrorBoundaryState> {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // ファイルの中身は外部へ送らず、開発者ツールでの調査用にだけ残す
    console.error("USTX の表示中にエラーが発生しました", error, info.componentStack);
  }

  private undo = () => {
    this.props.onUndo?.();
    // 取り消した状態で、もう一度表示を試みる
    this.setState({ failed: false, exportError: null });
  };

  private export = () => {
    try {
      this.props.onExport?.();
      this.setState({ exportError: null });
    } catch (e) {
      this.setState({ exportError: this.props.exportErrorMessage(e) });
    }
  };

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const { onDiscard, onUndo, onExport } = this.props;
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert tone="error" title="表示できませんでした">
          <p>このファイルの表示中に予期しないエラーが発生しました。</p>
          {(onUndo || onExport) && (
            <p>
              直前の編集が原因の場合は、取り消すと表示できることがあります。編集を残したい場合は、先に書き出してください。
            </p>
          )}
        </Alert>
        <div className="flex flex-wrap gap-2">
          {onUndo && (
            <Button variant="outline" onClick={this.undo}>
              <Undo2 aria-hidden />
              直前の編集を取り消す
            </Button>
          )}
          {onExport && (
            <Button variant="outline" onClick={this.export}>
              <Download aria-hidden />
              編集を反映して書き出す
            </Button>
          )}
          <Button variant="outline" onClick={onDiscard}>
            <Trash2 aria-hidden />
            データを破棄
          </Button>
        </div>
        {this.state.exportError && (
          <p role="alert" className="text-sm text-destructive">
            {this.state.exportError}
          </p>
        )}
      </div>
    );
  }
}
