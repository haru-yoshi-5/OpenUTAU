import { Trash2 } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";

interface RenderErrorBoundaryProps {
  children: ReactNode;
  /** 読み込んだデータを破棄して、ファイル選択の画面に戻す */
  onReset: () => void;
}

interface RenderErrorBoundaryState {
  failed: boolean;
}

/**
 * 読み込み後の表示（ピッチ計算・ピアノロールの描画など）で起きた例外を受け止める。
 * これが無いと React がツリー全体を外し、画面が真っ白になって操作できなくなる。
 */
export class RenderErrorBoundary extends Component<
  RenderErrorBoundaryProps,
  RenderErrorBoundaryState
> {
  override state: RenderErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): RenderErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // ファイルの中身は外部へ送らず、開発者ツールでの調査用にだけ残す
    console.error("USTX の表示中にエラーが発生しました", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert tone="error" title="表示できませんでした">
          <p>
            このファイルの表示中に予期しないエラーが発生しました。データを破棄して、別のファイルを読み込んでください。
          </p>
        </Alert>
        <Button variant="outline" onClick={this.props.onReset}>
          <Trash2 aria-hidden />
          データを破棄
        </Button>
      </div>
    );
  }
}
