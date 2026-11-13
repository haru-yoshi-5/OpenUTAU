import { Viewer } from "./features/viewer/Viewer";

export function App() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-6">
          <p className="text-base font-semibold tracking-tight">OpenUtau AI Tuning Studio</p>
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            仮称・非公式ツール
          </span>
          <p className="w-full text-xs text-muted-foreground sm:ml-auto sm:w-auto">
            OpenUtau の USTX を可視化して、調声の試行錯誤を支援します
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <h1 className="sr-only">OpenUtau AI Tuning Studio：USTX ビューア</h1>
        <Viewer />
      </main>

      <footer className="border-t">
        <div className="mx-auto max-w-7xl space-y-1 px-4 py-4 text-xs text-muted-foreground sm:px-6">
          <p>
            本ツールは OpenUtau の公式サービスではなく、OpenUtau
            プロジェクトとは提携していない独立した非公式ツールです。
          </p>
          <p>読み込んだファイルはブラウザ内でのみ処理され、サーバーへ送信・保存されません。</p>
        </div>
      </footer>
    </div>
  );
}
