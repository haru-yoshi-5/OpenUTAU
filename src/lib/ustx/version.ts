export interface UstxVersion {
  /** ファイルに書かれていた表記そのまま（例: "0.10"） */
  raw: string;
  major: number;
  minor: number;
}

/** 動作確認済みの最新バージョン（OpenUtau の kUstxVersion = 0.10） */
export const LATEST_SUPPORTED: UstxVersion = {
  raw: "0.10",
  major: 0,
  minor: 10,
};
/** tempos / time_signatures が導入されたバージョン。これより古い場合は bpm 等から補う */
export const TEMPO_MAP_SINCE: UstxVersion = { raw: "0.6", major: 0, minor: 6 };

export function parseVersion(raw: string): UstxVersion | null {
  const m = /^\s*['"]?(\d+)\.(\d+)(?:\.\d+)*['"]?\s*$/.exec(raw);
  if (!m) return null;
  return {
    raw: raw.trim().replace(/^['"]|['"]$/g, ""),
    major: Number(m[1]),
    minor: Number(m[2]),
  };
}

/** バージョンは小数ではなく「メジャー.マイナー」として比較する（0.10 > 0.9） */
export function compareVersion(a: UstxVersion, b: UstxVersion): number {
  return a.major !== b.major ? a.major - b.major : a.minor - b.minor;
}
