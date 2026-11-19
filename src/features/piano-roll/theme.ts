import { useSyncExternalStore } from "react";

/** Canvas は CSS 変数を参照できないため、ピアノロールの配色はここで持つ */
export interface RollTheme {
  background: string;
  blackKeyRow: string;
  grid: string;
  octaveLine: string;
  barLine: string;
  rulerBackground: string;
  rulerText: string;
  tempoText: string;
  whiteKey: string;
  blackKey: string;
  keyText: string;
  keyBorder: string;
  note: string;
  noteBorder: string;
  noteText: string;
  pitchLine: string;
}

const light: RollTheme = {
  background: "#fcfcfd",
  blackKeyRow: "#f1f3f7",
  grid: "#e6e9ef",
  octaveLine: "#c4cad6",
  barLine: "#aeb6c4",
  rulerBackground: "#ffffff",
  rulerText: "#64748b",
  tempoText: "#0f172a",
  whiteKey: "#ffffff",
  blackKey: "#334155",
  keyText: "#64748b",
  keyBorder: "#e2e8f0",
  note: "#bcd4f6",
  noteBorder: "#3b6fc4",
  noteText: "#172554",
  pitchLine: "#e0453a",
};

const dark: RollTheme = {
  background: "#111827",
  blackKeyRow: "#0d1320",
  grid: "#1f2a3c",
  octaveLine: "#334155",
  barLine: "#475569",
  rulerBackground: "#111827",
  rulerText: "#94a3b8",
  tempoText: "#e2e8f0",
  whiteKey: "#cbd5e1",
  blackKey: "#1e293b",
  keyText: "#475569",
  keyBorder: "#94a3b8",
  note: "#2f4f86",
  noteBorder: "#8db4f0",
  noteText: "#eef4ff",
  pitchLine: "#ff8a70",
};

const QUERY = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

const isDark = () => window.matchMedia(QUERY).matches;

/** OS のダークモード設定に合わせた配色を返し、設定の変更にも追従する */
export function useRollTheme(): RollTheme {
  return useSyncExternalStore(subscribe, isDark, () => false) ? dark : light;
}
