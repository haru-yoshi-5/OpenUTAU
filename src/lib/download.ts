/** Blob URL を破棄するまでの待ち時間。保存ダイアログの表示などで遅れても間に合うよう長めに取る */
const REVOKE_DELAY_MS = 40_000;

/** バイト列をファイルとして保存させる（ブラウザのダウンロード） */
export function downloadBytes(bytes: Uint8Array, fileName: string, type = "application/x-yaml") {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  // ダウンロードの開始は非同期のため、すぐに破棄すると保存に失敗するブラウザがある（Firefox など）
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
