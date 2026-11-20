import { UstxError } from "./errors";
import type { PitchPoint, RawNote, Vibrato } from "./types";

/**
 * OpenUtau がピッチ点・ビブラートをどう解釈するかに合わせて、値をそろえる。
 * 読み込み（表示用）と編集・書き出しの両方で使う。
 */

/** OpenUtau でビブラートをオンにしたときの長さ（NotePresets.DefaultVibrato.VibratoLength） */
export const DEFAULT_VIBRATO_LENGTH = 75;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function invalidEdit(message: string, detail?: string): never {
  throw new UstxError("invalid-edit", message, detail);
}

/**
 * OpenUtau（UPitch）が前提とする形にそろえる。
 * - 読み込み時にソートされず、補間は x の昇順を前提にしているため、x の昇順に並べる
 * - snap_first が有効なとき、OpenUtau は先頭の点を無条件に参照するため、0 点を許さない
 */
export function normalizePitch(pitch: RawNote["pitch"]): RawNote["pitch"] {
  const data: PitchPoint[] = pitch.data.map(({ x, y, shape }) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      invalidEdit("ピッチ点の位置・高さに数値以外の値が含まれています。");
    }
    return { x, y, shape };
  });
  if (pitch.snap_first && data.length === 0) {
    invalidEdit("ピッチ点をすべて削除することはできません（OpenUtau で開けなくなるため）。");
  }
  // Array.prototype.sort は安定ソートなので、同じ x の点は元の順序を保つ
  data.sort((a, b) => a.x - b.x);
  return { data, snap_first: pitch.snap_first };
}

/**
 * YAML 上で out が in より後に設定されるか（OpenUtau は YAML のキー順にセッターを呼ぶ）。
 * 片方しか無い場合は、書かれている方が後に設定されたのと同じ結果になる。
 */
export function isOutSetLast(rawVibrato: unknown): boolean {
  if (typeof rawVibrato !== "object" || rawVibrato === null) return true;
  const keys = Object.keys(rawVibrato);
  return keys.indexOf("in") < keys.indexOf("out");
}

/**
 * OpenUtau（UVibrato）のセッターと同じ範囲に丸める。
 * in と out は合計が 100 を超えないよう、後から設定された方を優先して、先に設定された方を削る。
 * 戻り値は in + out ≤ 100 になるので、どの順序で読み込まれても OpenUtau で同じ値になる。
 */
export function normalizeVibrato(
  vibrato: Vibrato,
  outSetLast = true,
  /** 値が不正なときのエラー。読み込み時は構造の不正、編集時は編集の不正として報告する */
  source: "load" | "edit" = "edit",
): Vibrato {
  for (const [name, value] of Object.entries(vibrato)) {
    if (Number.isFinite(value)) continue;
    if (source === "load") {
      throw new UstxError(
        "invalid-structure",
        "USTX のビブラートに数値以外の値が含まれているため読み込めませんでした。",
        name,
      );
    }
    invalidEdit("ビブラートに数値以外の値が含まれています。", name);
  }
  let vin = clamp(vibrato.in, 0, 100);
  let vout = clamp(vibrato.out, 0, 100);
  if (outSetLast) vin = Math.min(vin, 100 - vout);
  else vout = Math.min(vout, 100 - vin);
  return {
    length: clamp(vibrato.length, 0, 100),
    period: clamp(vibrato.period, 5, 500),
    depth: clamp(vibrato.depth, 5, 200),
    in: vin,
    out: vout,
    shift: clamp(vibrato.shift, 0, 100),
    drift: clamp(vibrato.drift, -100, 100),
    vol_link: clamp(vibrato.vol_link, -100, 100),
  };
}
