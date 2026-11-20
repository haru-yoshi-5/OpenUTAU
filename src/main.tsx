import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

// E2E テスト用の入口は開発ビルドでだけ読み込む（本番ビルドでは条件ごと取り除かれる）
if (import.meta.env.DEV) {
  void import("./dev/test-hooks").then((m) => m.installTestHooks());
}

const root = document.getElementById("root");
if (!root) throw new Error("#root が見つかりません");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
