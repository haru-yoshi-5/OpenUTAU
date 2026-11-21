import type { VoicePart } from "./load";

/**
 * パートの終わり（パート先頭からの tick）。パートの長さと、最後に終わるノートの終わりの遅い方。
 * ノートがパートの長さをはみ出していても、最後まで表示・スクロールできるようにする。
 * 小節線の範囲（Viewer）とスクロールの範囲（ピアノロール）で同じ値を使うため、ここにまとめる。
 */
export function partEndTick(part: Pick<VoicePart, "duration" | "notes">): number {
  return part.notes.reduce((max, n) => Math.max(max, n.position + n.duration), part.duration);
}
